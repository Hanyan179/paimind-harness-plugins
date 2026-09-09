#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { paimindRelativePath, readPaimindManagedBytes, writePaimindManagedBytes, withPaimindFileLock } from '@hansen/harness-compat/managed-files'
import { prepareCatalog, renderCatalog, SOL_FIELDS, TRACKER_FIELDS, sha, revision } from './catalog.mjs'

const MAX = 64 * 1024 * 1024
const read = (root, path) => readPaimindManagedBytes(root, path, MAX)
const json = async (root, path) => JSON.parse((await read(root, path)).toString('utf8'))
async function optional(root, path) { try { return await read(root, path) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
async function immutable(root, path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n')
  return withPaimindFileLock(root + '/' + path, async () => {
    const old = await optional(root, path)
    if (old?.equals(bytes)) return revision(bytes)
    return writePaimindManagedBytes(root, path, bytes, null, async () => {}, undefined, MAX)
  })
}
function runPath(path) { if (!/^runs\/[a-f0-9-]{36}$/.test(path)) throw new Error('Invalid run path'); return path }
function config(value) {
  if (!/^[A-Za-z0-9]{10,100}$/.test(value?.baseToken) || !/^tbl[A-Za-z0-9]{8,100}$/.test(value.solTableId) || !/^tbl[A-Za-z0-9]{8,100}$/.test(value.trackerTableId) || !/^[a-f0-9-]{32,36}$/.test(value.collectionId)) throw new Error('Invalid local workflow configuration')
  return value
}
export async function execute(root, command, args) {
  const source = config(await json(root, 'sol-sync.json'))
  if (command === 'start') {
    const expectedRevision = args[0] === 'null' ? null : args[0]
    if (expectedRevision !== null && !/^sha256:[a-f0-9]{64}$/.test(expectedRevision)) throw new Error('Read current catalog.html via context tool before starting; supply its revision, or null only when list proves absent')
    const run = 'runs/' + randomUUID()
    const bytes = await Promise.all(['catalog.mjs', 'run.mjs', 'reference/catalog_fields.mjs', 'reference/composition_renderer.mjs', 'reference/layout_engine.mjs'].map(f => readFile(new URL(f, import.meta.url))))
    await immutable(root, run + '/start.json', { expectedRevision, source, rendererHash: sha(Buffer.concat(bytes)) })
    return { run, exports: [
      { baseToken: source.baseToken, tableId: source.solTableId, fields: SOL_FIELDS, path: run + '/sol.json' },
      { baseToken: source.baseToken, tableId: source.trackerTableId, fields: TRACKER_FIELDS, path: run + '/tracker.json' },
    ] }
  }
  const run = runPath(args[0]), start = await json(root, run + '/start.json')
  if (JSON.stringify(start.source) !== JSON.stringify(source)) throw new Error('Configuration changed during this run')
  if (command === 'prepare') {
    const plan = prepareCatalog(await json(root, run + '/sol.json'), await json(root, run + '/tracker.json'), source)
    plan.fingerprint = sha(plan.fingerprint + start.rendererHash)
    await immutable(root, run + '/plan.json', plan)
    await immutable(root, run + '/attachments.json', plan.manifest)
    return { run, products: plan.products.length, noImage: plan.products.filter(p => !p.attachments.length).length, attachments: plan.manifest.requests.length, manifestPath: run + '/attachments.json', fingerprint: plan.fingerprint }
  }
  if (command !== 'render') throw new Error('Use start, prepare or render')
  const plan = await json(root, run + '/plan.json')
  const output = 'candidates/' + plan.fingerprint + '/catalog.html'
  paimindRelativePath(output)
  // Read and verify every original even for an unchanged candidate. Damaged cache is a failure.
  const originals = new Map()
  for (const request of plan.manifest.requests) {
    const bytes = await read(root, request.path), receipt = await json(root, request.path + '.receipt.json')
    const key = revision(JSON.stringify([request.baseToken, request.tableId, request.recordId, request.fileToken]))
    if (receipt.source !== key || receipt.revision !== revision(bytes)) throw new Error('ATTACHMENT_CACHE_INVALID: re-download before publication')
    originals.set(request.path, bytes)
  }
  const contentKey = sha(JSON.stringify([...originals].map(([path, bytes]) => [path, sha(bytes)])))
  let candidate
  await withPaimindFileLock(root + '/' + output + ':render', async () => {
    const old = await optional(root, output), oldReceipt = await optional(root, output + '.json')
    if (old && oldReceipt) {
      candidate = JSON.parse(oldReceipt.toString('utf8'))
      if (candidate.contentKey !== contentKey || candidate.revision !== revision(old)) throw new Error('CANDIDATE_CONFLICT: source attachment bytes changed or candidate damaged')
      return
    }
    const seedBytes = await optional(root, output + '.seed.json')
    const seed = seedBytes ? JSON.parse(seedBytes.toString('utf8')) : { contentKey, generatedAt: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()) + ' 北京时间' }
    if (seed.contentKey !== contentKey) throw new Error('CANDIDATE_CONFLICT: attachment content changed')
    await immutable(root, output + '.seed.json', seed)
    const generatedAt = seed.generatedAt
    const rendered = await renderCatalog(plan, async a => originals.get(a.path), generatedAt)
    candidate = { path: output, fingerprint: plan.fingerprint, contentKey, revision: rendered.revision, products: plan.products.length, bytes: rendered.bytes.length, generatedAt }
    await immutable(root, output, rendered.bytes)
    await immutable(root, output + '.json', candidate)
  })
  const result = { ...candidate, unchanged: candidate.revision === start.expectedRevision, publication: candidate.revision === start.expectedRevision ? null : { action: 'import', collectionId: source.collectionId, path: 'catalog.html', toPath: output, contentType: 'text/html', expectedRevision: start.expectedRevision, operationId: 'sol-' + run.slice(5), description: 'SOL 当前有效商品目录。文件开头 catalog-facts 包含全部来源事实、页码与 IMU；图片为 PRD Render Image 的展示副本。' } }
  await immutable(root, run + '/result.json', result)
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  execute(process.cwd(), command, args).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
