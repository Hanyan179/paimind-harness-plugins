// @vitest-environment node
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { readSkillContent, SKILL_CONTENT_PAGE_BYTES, type SkillContentSelection } from '../src/skill-content.js'
import { SKILL_PUBLICATION_CHUNK_BYTES } from '@paimind/skill-market/publication'
const { zipSync } = createRequire(new URL('../../../packages/skill-market/package.json', import.meta.url))('fflate') as {
  zipSync: (files: Record<string, Uint8Array>, options: { level: number }) => Uint8Array
}
const signal = () => new AbortController().signal
const fixture = (files: Record<string, Uint8Array> = { 'SKILL.md': Buffer.from('---\nname: customer-notes\n---\nRead provided notes.'),
  'assets/': new Uint8Array(), 'assets/sample.bin': randomBytes(320000), 'empty/': new Uint8Array(), 'empty.txt': new Uint8Array() }, level = 0) => {
  const bytes = Buffer.from(zipSync(files, { level }))
  const archive = { archiveBytes: bytes.length, expandedBytes: Object.values(files).reduce((n, v) => n + v.length, 0), entryCount: Object.keys(files).length }
  const chunk = vi.fn(async (offset: number) => bytes.subarray(offset, offset + SKILL_PUBLICATION_CHUNK_BYTES))
  return { bytes, files, archive, chunk, read: (selected: SkillContentSelection, abort = signal()) => readSkillContent(archive, selected, chunk, abort) }
}
describe('bounded immutable source-export content reader; no native install or Browser E2E', () => {
  it('retains full paths, empty directories and files, reads exact binary ranges and does not load the complete archive', async () => {
    const f = fixture(), index = await f.read({ kind: 'entries', cursor: 0 })
    expect(index).toMatchObject({ kind: 'entries', total: 5, nextCursor: null })
    if (index.kind !== 'entries') throw Error('Missing index')
    expect(index.entries.map(x => x.path)).toEqual(['SKILL.md', 'assets', 'assets/sample.bin', 'empty', 'empty.txt'])
    expect(f.chunk.mock.calls.length).toBeLessThan(3)
    const result = await f.read({ kind: 'file', index: 2, offset: SKILL_CONTENT_PAGE_BYTES })
    expect(result.kind).toBe('file')
    if (result.kind !== 'file') throw Error('Missing bytes')
    expect(Buffer.from(result.data, 'base64')).toEqual(Buffer.from(f.files['assets/sample.bin']!).subarray(SKILL_CONTENT_PAGE_BYTES, SKILL_CONTENT_PAGE_BYTES * 2))
    expect(result.nextOffset).toBe(SKILL_CONTENT_PAGE_BYTES * 2)
    expect(await f.read({ kind: 'file', index: 4, offset: 0 })).toMatchObject({ kind: 'file', data: '', nextOffset: null })
  })
  it('pages the entire index without dropping entries beyond the first page', async () => {
    const files: Record<string, Uint8Array> = { 'SKILL.md': Buffer.from('instructions') }
    for (let i = 0; i < 101; i++) files['resource-' + i] = Buffer.from(String(i))
    const f = fixture(files)
    expect(await f.read({ kind: 'entries', cursor: 0 })).toMatchObject({ total: 102, nextCursor: 100, entries: expect.any(Array) })
    const last = await f.read({ kind: 'entries', cursor: 100 })
    if (last.kind !== 'entries') throw Error('Missing index')
    expect(last.entries).toHaveLength(2); expect(last.entries[0]?.index).toBe(100); expect(last.nextCursor).toBeNull()
  })
  it.each(['../escape', './alias', '/absolute', 'assets//bad', '.paimind-install.json', 'missing-parent/item'])('rejects unsafe or non-canonical %s without returning a partial index', async path => {
    const f = fixture({ 'SKILL.md': Buffer.from('instructions'), [path]: Buffer.from('inert') })
    await expect(f.read({ kind: 'entries', cursor: 0 })).rejects.toThrow()
  })
  it('rejects a file/directory collision and compressed non-owner format', async () => {
    await expect(fixture({ 'SKILL.md': Buffer.from('body'), assets: Buffer.from('file'), 'assets/': new Uint8Array() })
      .read({ kind: 'entries', cursor: 0 })).rejects.toThrow()
    await expect(fixture({ 'SKILL.md': Buffer.from('body'.repeat(100)) }, 6).read({ kind: 'entries', cursor: 0 })).rejects.toThrow()
  })
  it.each([{ kind: 'entries', cursor: 1 }, { kind: 'entries', cursor: -1 }, { kind: 'file', index: 500, offset: 0 },
    { kind: 'file', index: 2, offset: 1 }, { kind: 'file', index: 1, offset: 0 }, { kind: 'file', index: 0, offset: SKILL_CONTENT_PAGE_BYTES }])('rejects invalid selection %j', async selection => {
    await expect(fixture().read(selection as SkillContentSelection)).rejects.toThrow()
  })
  it('rejects metadata mismatch, missing chunks, cancellation and corrupt local header names', async () => {
    const f = fixture()
    await expect(readSkillContent({ ...f.archive, entryCount: 4 }, { kind: 'entries', cursor: 0 }, f.chunk, signal())).rejects.toThrow()
    await expect(readSkillContent({ ...f.archive, expandedBytes: 1 }, { kind: 'entries', cursor: 0 }, f.chunk, signal())).rejects.toThrow()
    await expect(readSkillContent(f.archive, { kind: 'entries', cursor: 0 }, async () => Buffer.alloc(1), signal())).rejects.toThrow()
    const controller = new AbortController()
    await expect(readSkillContent(f.archive, { kind: 'entries', cursor: 0 }, async offset => {
      controller.abort(); return f.chunk(offset)
    }, controller.signal)).rejects.toThrow()
    f.bytes[30] = 'X'.charCodeAt(0)
    await expect(f.read({ kind: 'file', index: 0, offset: 0 })).rejects.toThrow()
  })
  it('cancels a stuck underlying read without waiting for its late settlement', async () => {
    const f = fixture(), abort = new AbortController(), chunk = vi.fn(() => new Promise<Buffer>(() => {}))
    const pending = readSkillContent(f.archive, { kind: 'entries', cursor: 0 }, chunk, abort.signal)
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(chunk).toHaveBeenCalled()); abort.abort(); await rejected
  })
})
