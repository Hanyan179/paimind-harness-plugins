// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error executable business example
import { execute } from './run.mjs'
// @ts-expect-error executable business example
import { SOL_FIELDS, TRACKER_FIELDS } from './catalog.mjs'
const roots: string[] = []
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }) })
it('reuses the same candidate across runs and restart; stale target revision remains fixed for CAS import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sol-workflow-')); roots.push(root)
  const source = { baseToken: 'Base1234567890', solTableId: 'tblSol12345678', trackerTableId: 'tblArt12345678', collectionId: 'a'.repeat(32) }
  await writeFile(join(root, 'sol-sync.json'), JSON.stringify(source))
  async function candidate(expected: string, retail = '4') {
    const start = await execute(root, 'start', [expected])
    const rows = [{ record_id: 'recProduct12', ...Object.fromEntries(SOL_FIELDS.map((f: string) => [f, ''])), 'Item Status': 'ACTIVE', Retail: retail }]
    for (const [i, ex] of start.exports.entries()) await writeFile(join(root, ex.path), JSON.stringify({ schema: 'paimind.feishu-base-snapshot/v1', source: { baseToken: source.baseToken, tableId: ex.tableId, fields: i ? TRACKER_FIELDS : SOL_FIELDS, revision: 1 }, records: i ? [] : rows }))
    await execute(root, 'prepare', [start.run])
    return { ...await execute(root, 'render', [start.run]), run: start.run }
  }
  const a = await candidate('null')
  expect(a.publication.expectedRevision).toBe(null)
  expect(a.products).toBe(1)
  const b = await candidate(a.revision)
  expect(b).toMatchObject({ unchanged: true, publication: null, revision: a.revision, generatedAt: a.generatedAt })
  const c = await candidate(a.revision, '5')
  expect(c.revision).not.toBe(a.revision)
  expect(c.publication.expectedRevision).toBe(a.revision)
  expect(await readFile(join(root, a.path))).toBeTruthy()
  // Simulated interrupted commit between immutable candidate and receipt creation.
  await rm(join(root, c.path + '.json'))
  await rm(join(root, c.run + '/result.json'))
  expect(await execute(root, 'render', [c.run])).toMatchObject({ revision: c.revision, generatedAt: c.generatedAt })
})

it('keeps adopted reference sources identical to their recorded provenance', async () => {
  const { createHash } = await import('node:crypto')
  const { readFile } = await import('node:fs/promises')
  const provenance = JSON.parse(await readFile(new URL('./provenance.json', import.meta.url), 'utf8'))
  for (const file of provenance.files) {
    const bytes = await readFile(new URL(file.destination, import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
  }
})
