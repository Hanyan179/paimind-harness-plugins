import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { paimindFileRevision, paimindRelativePath, readPaimindManagedBytes, resolvePaimindManagedFile, withPaimindFileLock, writePaimindManagedBytes } from '@hansen/harness-compat/managed-files'
import { feishuBaseRecordsInput, feishuBaseDownloadInput, runFeishuCli, type FeishuCliConfiguration, type FeishuOperation, type FeishuCliResult } from './index.js'

export const exportRecordsInput = feishuBaseRecordsInput.omit({ offset: true }).extend({ path: z.string().min(1).max(1000) }).strict()
const downloadRequest = feishuBaseDownloadInput.omit({ output: true }).extend({ path: z.string().min(1).max(1000) }).strict()
export const downloadBatchInput = z.object({ manifestPath: z.string().min(1).max(1000), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(20) }).strict()
const downloadManifest = z.object({ schema: z.literal('paimind.feishu-attachment-requests/v1'), requests: z.array(downloadRequest).max(5000) }).strict()
const pageSchema = z.object({ data: z.array(z.array(z.unknown())), fields: z.array(z.string()), record_id_list: z.array(z.string()), has_more: z.boolean(), rev: z.union([z.string(), z.number()]) })
type Runner = (configuration: FeishuCliConfiguration, operation: FeishuOperation, input: unknown, signal?: AbortSignal) => Promise<FeishuCliResult>
function source(config: FeishuCliConfiguration, baseToken: string, tableId: string): string {
  if (!config.exportRoot || !config.baseToken || !config.tableIds?.length) throw new Error('Base exports require an explicit local directory and allowed source tables')
  if (baseToken !== config.baseToken || !config.tableIds.includes(tableId)) throw new Error('Base/table outside this connection scope')
  return config.exportRoot
}
async function optionalRead(root: string, path: string): Promise<Buffer | null> {
  return readPaimindManagedBytes(root, path).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e })
}

/** Paginate and project using the fixed CLI identity; never stream the complete table through the model context. */
export async function exportBaseRecords(config: FeishuCliConfiguration, value: unknown, signal?: AbortSignal, runner: Runner = runFeishuCli) {
  const input = exportRecordsInput.parse(value), root = source(config, input.baseToken, input.tableId)
  paimindRelativePath(input.path)
  const records: Record<string, unknown>[] = [], seen = new Set<string>()
  let revision: string | number | undefined
  for (let offset = 0; ; ) {
    signal?.throwIfAborted()
    const result = await runner(config, 'base-records', { baseToken: input.baseToken, tableId: input.tableId, fields: input.fields, offset }, signal)
    if (!result.ok) throw new Error('Feishu Base read failed; check this connection and source permissions')
    const page = pageSchema.parse((result.result as { data: unknown }).data)
    if (revision !== undefined && revision !== page.rev) throw new Error('SOURCE_CHANGED: table changed during pagination; retry in a new snapshot')
    revision = page.rev
    if (page.fields.length !== input.fields.length || input.fields.some(f => !page.fields.includes(f))) throw new Error('Requested fields missing from Base response')
    if (page.data.length !== page.record_id_list.length || (page.has_more && page.data.length === 0)) throw new Error('Incomplete Base pagination')
    for (const [i, row] of page.data.entries()) {
      const id = page.record_id_list[i]!
      if (seen.has(id) || row.length !== page.fields.length) throw new Error('Duplicate record or malformed Base row')
      seen.add(id)
      records.push({ record_id: id, ...Object.fromEntries(page.fields.map((field, col) => [field, row[col]])) })
    }
    if (records.length > 5000) throw new Error('Base snapshot exceeds 5000 records')
    if (!page.has_more) break
    offset += page.data.length
  }
  const data = { schema: 'paimind.feishu-base-snapshot/v1', source: { baseToken: input.baseToken, tableId: input.tableId, fields: input.fields, revision }, records }
  const bytes = Buffer.from(JSON.stringify(data, null, 2) + '\n')
  await withPaimindFileLock(root + '/' + input.path, async () => {
    const previous = await optionalRead(root, input.path)
    if (previous?.equals(bytes)) return
    await writePaimindManagedBytes(root, input.path, bytes, null, async () => {}, signal)
  })
  return { path: input.path, records: records.length, sourceRevision: revision, revision: paimindFileRevision(bytes), bytes: bytes.length }
}

/** Download only explicitly listed tokens into the connection's managed directory; remote tables stay read-only. */
export async function downloadBaseAttachments(config: FeishuCliConfiguration, value: unknown, signal?: AbortSignal, runner: Runner = runFeishuCli) {
  const input = downloadBatchInput.parse(value)
  if (!config.exportRoot) throw new Error('Base export directory is not configured')
  const manifest = downloadManifest.parse(JSON.parse((await readPaimindManagedBytes(config.exportRoot, input.manifestPath)).toString('utf8')))
  // Validate the entire batch before creating transfer files.
  const batch = manifest.requests.slice(input.offset, input.offset + input.limit)
  for (const request of batch) { source(config, request.baseToken, request.tableId); paimindRelativePath(request.path) }
  const results: { path: string; bytes: number; revision: string; cached: boolean }[] = []
  async function download(request: z.infer<typeof downloadRequest>) {
    const root = config.exportRoot!
    return withPaimindFileLock(root + '/' + request.path, async () => {
      signal?.throwIfAborted()
      const key = paimindFileRevision(JSON.stringify([request.baseToken, request.tableId, request.recordId, request.fileToken]))
      const existing = await optionalRead(root, request.path), receiptBytes = await optionalRead(root, request.path + '.receipt.json')
      if (existing && receiptBytes) {
        const receipt = JSON.parse(receiptBytes.toString('utf8')) as { source: string; revision: string }
        if (receipt.source === key && receipt.revision === paimindFileRevision(existing)) return { path: request.path, bytes: existing.length, revision: receipt.revision, cached: true }
      }
      const transfer = '.transfer-' + randomUUID()
      await resolvePaimindManagedFile(root, transfer + '/attachment.bin', true)
      try {
        const result = await runner({ ...config, cwd: root }, 'base-download', { baseToken: request.baseToken, tableId: request.tableId, recordId: request.recordId, fileToken: request.fileToken, output: transfer + '/attachment.bin' }, signal)
        if (!result.ok) throw new Error('Feishu attachment download failed; previous files retained')
        const bytes = await readPaimindManagedBytes(root, transfer + '/attachment.bin')
        if (!bytes.length) throw new Error('Empty attachment download')
        const revision = await writePaimindManagedBytes(root, request.path, bytes, existing ? paimindFileRevision(existing) : null, async () => {}, signal)
        const receipt = Buffer.from(JSON.stringify({ source: key, revision }) + '\n')
        await writePaimindManagedBytes(root, request.path + '.receipt.json', receipt, receiptBytes ? paimindFileRevision(receiptBytes) : null, async () => {}, signal)
        return { path: request.path, bytes: bytes.length, revision, cached: false }
      } finally { await rm(join(root, transfer), { recursive: true, force: true }) }
    })
  }
  // Keep local CLI concurrency bounded and preserve the requested attachment order.
  for (let i = 0; i < batch.length; i += 3) {
    const group = await Promise.allSettled(batch.slice(i, i + 3).map(download))
    for (const item of group) { if (item.status === 'rejected') throw item.reason; results.push(item.value) }
  }
  return { results, total: manifest.requests.length, nextOffset: input.offset + batch.length < manifest.requests.length ? input.offset + batch.length : null }
}
