// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportBaseRecords, downloadBaseAttachments } from '../src/base-export.js'
import type { FeishuCliResult, FeishuCliConfiguration } from '../src/index.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'sol-mcp-')); roots.push(cwd)
  return { cwd, executable: 'unused', profile: 'fixed', exportRoot: cwd, baseToken: 'Base1234567890', tableIds: ['tblSource12345'] }
}
const ok = (data: unknown): FeishuCliResult => ({ ok: true, outcome: 'succeeded', result: { ok: true, data } }) as FeishuCliResult
describe('scoped read-only Base exports', () => {
  it('reads all pages, preserves exact field values, rejects changed revision and replacement', async () => {
    const c = await setup(), input = { baseToken: c.baseToken, tableId: c.tableIds[0], fields: ['ITEM#'], path: 'runs/a.json' }
    const offsets: number[] = []
    const runner = async (_: FeishuCliConfiguration, __: unknown, args: any) => { offsets.push(args.offset); return ok({ fields: ['ITEM#'], data: [[args.offset ? '' : 'A']], record_id_list: [args.offset ? 'recSecond12' : 'recFirst123'], has_more: !args.offset, rev: 1 }) }
    expect(await exportBaseRecords(c, input, undefined, runner)).toMatchObject({ records: 2 })
    expect(offsets).toEqual([0, 1]); expect(JSON.parse(await readFile(join(c.cwd, input.path), 'utf8')).records[1]['ITEM#']).toBe('')
    const drift = async (a: FeishuCliConfiguration, b: any, d: any) => { const r: any = await runner(a, b, d); r.result.data.rev = d.offset; return r }
    await expect(exportBaseRecords(c, { ...input, path: 'drift.json' }, undefined, drift)).rejects.toThrow('SOURCE_CHANGED')
    await expect(readFile(join(c.cwd, 'drift.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects unauthorized sources, escaped paths, symlinks and cancellation without CLI side effects', async () => {
    const c = await setup(), input = { baseToken: c.baseToken, tableId: c.tableIds[0], fields: ['ITEM#'], path: 'x.json' }
    let calls = 0
    const runner = async () => { calls++; return ok({ fields: ['ITEM#'], data: [], record_id_list: [], has_more: false, rev: 1 }) }
    await expect(exportBaseRecords(c, { ...input, tableId: 'tblDifferent12' }, undefined, runner)).rejects.toThrow('outside')
    await expect(exportBaseRecords(c, { ...input, path: '../x' }, undefined, runner)).rejects.toThrow()
    await expect(exportBaseRecords(c, input, AbortSignal.abort(), runner)).rejects.toThrow()
    expect(calls).toBe(0)
    await symlink(tmpdir(), join(c.cwd, 'link'))
    await expect(exportBaseRecords(c, { ...input, path: 'link/x' }, undefined, runner)).rejects.toThrow()
  })
  it('downloads only allowed manifest items, verifies cache bytes, re-downloads corruption and leaves no transfer files', async () => {
    const c = await setup(), path = 'originals/one.bin'
    await writeFile(join(c.cwd, 'requests.json'), JSON.stringify({ schema: 'paimind.feishu-attachment-requests/v1', requests: [{ baseToken: c.baseToken, tableId: c.tableIds[0], recordId: 'recSource123', fileToken: 'Token123456789', path }] }))
    let calls = 0
    const runner = async (config: FeishuCliConfiguration, operation: unknown, args: any) => { expect(operation).toBe('base-download'); calls++; await writeFile(join(config.cwd, args.output), 'picture'); return ok({}) }
    const first = await downloadBaseAttachments(c, { manifestPath: 'requests.json' }, undefined, runner)
    expect(first).toMatchObject({ nextOffset: null, results: [{ cached: false, bytes: 7 }] })
    expect((await downloadBaseAttachments(c, { manifestPath: 'requests.json' }, undefined, runner)).results[0]?.cached).toBe(true)
    expect(calls).toBe(1)
    await writeFile(join(c.cwd, path), 'corrupt')
    expect((await downloadBaseAttachments(c, { manifestPath: 'requests.json' }, undefined, runner)).results[0]?.cached).toBe(false)
    expect(calls).toBe(2)
  })
})
