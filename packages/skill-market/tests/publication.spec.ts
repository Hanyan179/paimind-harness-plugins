// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync } from 'fflate'
import { PaimindSkillInstallerService } from '../src/installer.js'
import { SkillPublicationExports } from '../src/publication-export.js'
import { readSkillPublicationExport, readSkillPublicationSelection, readSkillPublicationChunkInput,
  transferSkillPublication, SKILL_PUBLICATION_CHUNK_BYTES, SKILL_PUBLICATION_EXPORT_TTL_MS,
  SKILL_PUBLICATION_MAX_EXPANDED_BYTES, type SkillPublicationTransfer } from '../src/publication.js'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => { vi.useRealTimers(); for (const dispose of disposers.splice(0).reverse()) await dispose() })
async function fixture(member = 'Hansen') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'paimind-skill-export-')))
  disposers.push(() => rm(directory, { recursive: true, force: true }))
  const skillRoot = join(directory, 'skills'), stateRoot = join(directory, 'state')
  const effects: Array<() => void | Promise<void>> = [], systemNames: string[] = []
  const context = { reflect: { provide() {} }, webServer: { register: () => () => {} },
    skills: { list: async () => systemNames.map(name => ({ name, description: name, source: 'bundled', provider: 'fixture' })), register: () => () => {} },
    effect(install: () => void | (() => void | Promise<void>)) { const dispose = install(); if (dispose) effects.push(dispose) } }
  const service = new PaimindSkillInstallerService(context as never, { skillRoot, stateRoot })
  const dispose = async () => { for (const effect of effects.splice(0).reverse()) await effect() }
  disposers.push(dispose)
  await service.saveSkillSource({ name: 'client-notes', description: `${member} source`, instructions: `${member} owned instructions` })
  const source = join(skillRoot, 'client-notes')
  await mkdir(join(source, 'assets')); await mkdir(join(source, 'empty')); await mkdir(join(source, 'scripts'))
  const binary = Buffer.alloc(3 * SKILL_PUBLICATION_CHUNK_BYTES + 7)
  for (let index = 0; index < binary.length; index++) binary[index] = index % 256
  await writeFile(join(source, 'assets', 'sample.bin'), binary)
  await writeFile(join(source, 'scripts', 'example.sh'), '#!/bin/sh\nexit 77\n')
  const current = await service.getSkillPackage({ skillId: 'client-notes' })
  const selected = { skillId: current.skillId, expectedDigest: current.digest }
  const transport: SkillPublicationTransfer = {
    begin: (input, signal) => service.beginPublicationExport(input, signal),
    read: (input, signal) => service.readPublicationExport(input, signal),
    release: input => service.releasePublicationExport(input),
  }
  const capture = async (channel = transport, signal = new AbortController().signal) => {
    const chunks: Buffer[] = []
    const result = await transferSkillPublication(selected, channel, async bytes => { chunks.push(Buffer.from(bytes)) }, signal)
    return { result, bytes: Buffer.concat(chunks) }
  }
  return { service, source, directory, stateRoot, skillRoot, selected, binary, capture, transport, dispose, systemNames }
}

describe('source-owned complete Skill publication capture, not approval or Browser E2E', () => {
  it('exports full deterministic ZIP bytes over bounded chunks, excluding the local install receipt and not changing policy', async () => {
    const f = await fixture(), before = await readFile(join(f.source, '.paimind-install.json'))
    const read = vi.fn(f.transport.read), first = await f.capture({ ...f.transport, read })
    const unpacked = unzipSync(first.bytes)
    expect(Object.keys(unpacked)).toEqual(['assets/', 'assets/sample.bin', 'empty/', 'scripts/', 'scripts/example.sh', 'SKILL.md'])
    expect(Buffer.from(unpacked['assets/sample.bin']!)).toEqual(f.binary)
    expect(Buffer.from(unpacked['scripts/example.sh']!).toString()).toBe('#!/bin/sh\nexit 77\n')
    expect(Buffer.from(unpacked['SKILL.md']!)).toEqual(await readFile(join(f.source, 'SKILL.md')))
    expect(first.result.entryCount).toBe(6); expect(first.result.archiveBytes).toBe(first.bytes.length)
    expect(first.result.packageDigest).toBe(f.selected.expectedDigest)
    expect(first.result.archiveDigest).toBe('sha256:' + createHash('sha256').update(first.bytes).digest('hex'))
    expect(read.mock.calls.length).toBeGreaterThan(3)
    for (const result of await Promise.all(read.mock.results.map(row => row.value))) expect(JSON.stringify(result).length).toBeLessThan(262144)
    expect((await f.capture()).bytes).toEqual(first.bytes)
    expect(await readdir(join(f.stateRoot, 'publication-exports'))).toEqual([])
    expect(await readFile(join(f.source, '.paimind-install.json'))).toEqual(before)
    await expect(readFile(join(f.stateRoot, 'user-skill-policy.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not substitute same-name Alex content or let another owner read or release Hansen handles', async () => {
    const hansen = await fixture(), alex = await fixture('Alex')
    await expect(alex.service.beginPublicationExport(hansen.selected)).rejects.toThrow('版本')
    const handle = await hansen.service.beginPublicationExport(hansen.selected)
    await expect(alex.service.readPublicationExport({ exportId: handle.exportId, offset: 0 })).rejects.toThrow()
    await alex.service.releasePublicationExport({ exportId: handle.exportId })
    expect((await hansen.service.readPublicationExport({ exportId: handle.exportId, offset: 0 })).data).not.toBe('')
    await hansen.service.releasePublicationExport({ exportId: handle.exportId })
    expect((await alex.capture()).result.packageDigest).toBe(alex.selected.expectedDigest)
  })
  it('captures immutable bytes without locking or changing later source edits', async () => {
    const f = await fixture(), handle = await f.service.beginPublicationExport(f.selected)
    await writeFile(join(f.source, 'assets', 'sample.bin'), 'changed source')
    const result = await f.capture({ ...f.transport, begin: async () => handle })
    expect(Buffer.from(unzipSync(result.bytes)['assets/sample.bin']!)).toEqual(f.binary)
    await expect(f.service.beginPublicationExport(f.selected)).rejects.toThrow('版本')
    expect(await readFile(join(f.source, 'assets', 'sample.bin'), 'utf8')).toBe('changed source')
  })
  it.each(['symlink', 'hardlink', 'unmanaged', 'identity', 'oversized'])('rejects %s source without partial publication artifacts', async mode => {
    const f = await fixture()
    if (mode === 'symlink') await symlink('/etc/hosts', join(f.source, 'linked'))
    if (mode === 'hardlink') await link(join(f.source, 'SKILL.md'), join(f.source, 'linked'))
    if (mode === 'unmanaged') await rm(join(f.source, '.paimind-install.json'))
    if (mode === 'identity') await writeFile(join(f.source, 'SKILL.md'), '---\nname: foreign-source\ndescription: mismatch\n---\nbody\n')
    if (mode === 'oversized') { const file = await open(join(f.source, 'large.bin'), 'wx'); await file.truncate(SKILL_PUBLICATION_MAX_EXPANDED_BYTES + 1); await file.close() }
    if (mode === 'unmanaged') await expect(f.service.beginPublicationExport(f.selected)).rejects.toMatchObject({ code: 'ENOENT' })
    else await expect(f.service.beginPublicationExport(f.selected)).rejects.toThrow(
      mode === 'symlink' ? '符号链接' : mode === 'hardlink' ? '硬链接' : mode === 'identity' ? '身份' : '超过上限')
    expect(await readdir(join(f.stateRoot, 'publication-exports')).catch(() => [])).toEqual([])
  })
  it('rejects a new System Skill name collision before exporting managed content', async () => {
    const f = await fixture(); f.systemNames.push('client-notes')
    await expect(f.service.beginPublicationExport(f.selected)).rejects.toThrow('系统能力冲突')
  })
  it('refuses modified staged bytes before serving a chunk and retains source content', async () => {
    const f = await fixture(), handle = await f.service.beginPublicationExport(f.selected)
    const [directory] = await readdir(join(f.stateRoot, 'publication-exports'))
    await writeFile(join(f.stateRoot, 'publication-exports', directory!, 'package.zip'), Buffer.alloc(handle.archiveBytes, 1))
    await expect(f.service.readPublicationExport({ exportId: handle.exportId, offset: 0 })).rejects.toThrow()
    await f.service.releasePublicationExport({ exportId: handle.exportId })
    expect((await f.service.getSkillPackage({ skillId: 'client-notes' })).digest).toBe(f.selected.expectedDigest)
  })
  it('preserves a replaced unowned cleanup target and makes cleanup failure observable on release, new capture and unload', async () => {
    const f = await fixture(), handle = await f.service.beginPublicationExport(f.selected)
    const [directory] = await readdir(join(f.stateRoot, 'publication-exports'))
    const path = join(f.stateRoot, 'publication-exports', directory!, 'package.zip')
    await rename(path, path + '.original'); await writeFile(path, 'unowned replacement fixture')
    await expect(f.service.releasePublicationExport({ exportId: handle.exportId })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('unowned replacement fixture')
    await expect(f.service.beginPublicationExport(f.selected)).rejects.toThrow()
    await expect(f.dispose()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('unowned replacement fixture')
  })
  it('bounds outstanding exports, releases exact handles, and rejects reads after plugin unload', async () => {
    const f = await fixture(), one = await f.service.beginPublicationExport(f.selected), two = await f.service.beginPublicationExport(f.selected)
    await expect(f.service.beginPublicationExport(f.selected)).rejects.toThrow()
    await f.service.releasePublicationExport({ exportId: one.exportId })
    await expect(f.service.readPublicationExport({ exportId: one.exportId, offset: 0 })).rejects.toThrow()
    const three = await f.service.beginPublicationExport(f.selected)
    await f.dispose()
    for (const value of [two, three]) await expect(f.service.readPublicationExport({ exportId: value.exportId, offset: 0 })).rejects.toThrow()
    await expect(f.service.beginPublicationExport(f.selected)).rejects.toThrow()
    expect(await readdir(join(f.stateRoot, 'publication-exports'))).toEqual([])
  })
  it('expires and removes abandoned handles without scanning or deleting unknown sibling directories', async () => {
    const f = await fixture(); vi.useFakeTimers()
    const handle = await f.service.beginPublicationExport(f.selected)
    await mkdir(join(f.stateRoot, 'publication-exports', 'unknown-previous-run'))
    await vi.advanceTimersByTimeAsync(SKILL_PUBLICATION_EXPORT_TTL_MS)
    await expect(f.service.readPublicationExport({ exportId: handle.exportId, offset: 0 })).rejects.toThrow()
    await f.dispose()
    expect(await readdir(join(f.stateRoot, 'publication-exports'))).toEqual(['unknown-previous-run'])
  })
  it.each(['aborted', 'sink-failure', 'corrupt-data', 'wrong-offset', 'wrong-eof', 'wrong-digest', 'wrong-source'])('releases staged export after %s and never returns approval', async mode => {
    const f = await fixture(), controller = new AbortController(), released = vi.fn(f.transport.release)
    const channel: SkillPublicationTransfer = { ...f.transport, release: released,
      begin: async (input, signal) => { const descriptor = await f.service.beginPublicationExport(input, signal)
        return mode === 'wrong-digest' ? { ...descriptor, archiveDigest: 'sha256:' + '0'.repeat(64) }
          : mode === 'wrong-source' ? { ...descriptor, name: 'another-skill' } : descriptor },
      read: async (input, signal) => { const value = await f.service.readPublicationExport(input, signal)
        if (mode === 'aborted') controller.abort()
        if (mode === 'corrupt-data') return { ...value, data: 'x' + value.data.slice(1) }
        if (mode === 'wrong-offset') return { ...value, offset: input.offset + 1 }
        if (mode === 'wrong-eof') return { ...value, eof: !value.eof }
        return value },
    }
    await expect(transferSkillPublication(f.selected, channel, async () => { if (mode === 'sink-failure') throw Error('staging unavailable') }, controller.signal)).rejects.toThrow()
    expect(released).toHaveBeenCalledOnce(); expect(released.mock.calls[0]![1].aborted).toBe(false)
    expect(await readdir(join(f.stateRoot, 'publication-exports'))).toEqual([])
  })
  it('cancels a capture during plugin disposal before it can issue a late handle', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>()
    const source = vi.fn(async (_selected, signal: AbortSignal) => {
      entered.resolve(); await resume.promise; signal.throwIfAborted()
      return { root: f.source, entries: [], digest: f.selected.expectedDigest }
    })
    const exports = new SkillPublicationExports(join(f.stateRoot, 'capture-race'), source)
    const capture = exports.begin(f.selected), rejected = expect(capture).rejects.toThrow()
    await entered.promise
    const disposed = exports.dispose(); resume.resolve(); await disposed; await rejected
    await expect(exports.begin(f.selected)).rejects.toThrow()
    await expect(readdir(join(f.stateRoot, 'capture-race'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects source drift during capture and removes only the failed capture', async () => {
    const f = await fixture(), body = await readFile(join(f.source, 'SKILL.md'))
    const source = vi.fn(async () => ({ root: f.source, entries: [{ path: 'SKILL.md', kind: 'binary' as const,
      size: body.length, digest: 'sha256:' + createHash('sha256').update(body).digest('hex') }],
      digest: f.selected.expectedDigest }))
    source.mockImplementationOnce(async () => { const first = await source(); source.mockResolvedValue({ ...first, digest: 'sha256:' + 'f'.repeat(64) }); return first })
    const exports = new SkillPublicationExports(join(f.stateRoot, 'capture-drift'), source)
    await expect(exports.begin(f.selected)).rejects.toThrow(); await exports.dispose()
    expect(await readdir(join(f.stateRoot, 'capture-drift'))).toEqual([])
    expect(await readFile(join(f.source, 'SKILL.md'))).toEqual(body)
  })
  it('removes captured but unissued bytes when cancellation arrives during final source validation', async () => {
    const f = await fixture(), controller = new AbortController(), body = await readFile(join(f.source, 'SKILL.md'))
    const value = { root: f.source, entries: [{ path: 'SKILL.md', kind: 'binary' as const, size: body.length,
      digest: 'sha256:' + createHash('sha256').update(body).digest('hex') }], digest: f.selected.expectedDigest }
    const source = vi.fn(async () => value).mockImplementationOnce(async () => value)
      .mockImplementationOnce(async () => { controller.abort(); return value })
    const exports = new SkillPublicationExports(join(f.stateRoot, 'capture-final-cancel'), source)
    await expect(exports.begin(f.selected, controller.signal)).rejects.toThrow()
    expect(source).toHaveBeenCalledTimes(2)
    expect(await readdir(join(f.stateRoot, 'capture-final-cancel'))).toEqual([])
    const fresh = await exports.begin(f.selected); await exports.release({ exportId: fresh.exportId }); await exports.dispose()
    expect(await readFile(join(f.source, 'SKILL.md'))).toEqual(body)
  })
  it('strictly rejects caller paths, extra authority, offsets and descriptor bounds', () => {
    for (const value of [{ skillId: '../outside', expectedDigest: 'sha256:' + 'a'.repeat(64) },
      { skillId: 'client-notes', expectedDigest: 'sha256:' + 'a'.repeat(64), tenantId: 'forged' }]) expect(() => readSkillPublicationSelection(value)).toThrow()
    for (const offset of [-1, 1, NaN, 216 * 1024 * 1024]) expect(() => readSkillPublicationChunkInput({ exportId: randomUUID(), offset })).toThrow()
    expect(() => readSkillPublicationExport({ schema: 'paimind.skill-export/v1', exportId: randomUUID(), name: 'client-notes',
      packageDigest: 'sha256:' + 'a'.repeat(64), archiveDigest: 'sha256:' + 'b'.repeat(64), archiveBytes: 1,
      expandedBytes: 1, entryCount: 10001 })).toThrow()
  })
})
