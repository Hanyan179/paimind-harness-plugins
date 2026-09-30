// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createManagedHarnessFilesystemProvider } from '../src/managed-filesystem.js'
import { filesystemCheckpointProgram } from './managed-filesystem-checkpoints.mjs'

// Actual native filesystem/subprocess/policy implementations and real files.
// The command wrapper below is explicitly an identity fixture, NOT a sandbox.
// Kernel confinement is accepted only by the separate Linux image tests.
const roots: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await root.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function provider(maxFrameBytes?: number, checkpoint?: { phase: string; armed: boolean; abort: AbortController; reached: number }) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'paimind-native-fs-test-'))); directories.push(cwd)
  const root = new Context(); roots.push(root)
  const handles: SubprocessHandle[] = []
  class RecordingNativeRuntime extends LocalSubprocessRuntime {
    override spawn(spec: SubprocessSpawnSpec) {
      const active = checkpoint?.armed ? checkpoint : undefined
      const argv = [...spec.argv]
      if (active) argv[3] = filesystemCheckpointProgram(active.phase, argv[3]!)
      const handle = super.spawn(active ? { ...spec, argv, stdio: { ...spec.stdio, stderr: 'pipe' } } : spec)
      handles.push(handle)
      if (active) {
        if (active.phase === 'spawn') { active.reached++; active.abort.abort(); return handle }
        let text = ''
        const stream = active.phase === 'result' ? handle.stdout! : handle.stderr!
        stream.on('data', chunk => {
          text += chunk.toString()
          if (active.reached || !text.includes(active.phase === 'result' ? '"type":"result"' : 'NATIVE_FILE_CHECKPOINT')) return
          active.reached++; active.abort.abort()
        })
      }
      return handle
    }
  }
  root.provide('sandbox', { confine: (argv: string[]) => ({ argv, enforcement: 'full' }) })
  await root.plugin(RecordingNativeRuntime)
  await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: cwd })
  await root.plugin(createManagedHarnessFilesystemProvider({ executionWorld: {
    nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)), lookupCwd: cwd,
  }, ...(maxFrameBytes ? { maxFrameBytes } : {}) }), { cwd })
  return { root, fs: root.fs, cwd, handles }
}

describe('native filesystem through managed subprocess transport', () => {
  it('keeps native opaque alias identity, process paths, URLs, containment and sorted listing', async () => {
    const { fs, cwd } = await provider()
    await writeFile(join(cwd, 'Hansen notes.txt'), 'Hansen')
    await symlink(join(cwd, 'Hansen notes.txt'), join(cwd, 'alias'))
    const target = await fs.resolve('Hansen notes.txt')
    expect((await fs.resolve('alias')).targetKey).toBe(target.targetKey)
    expect(fs.processPath(target)).toBe(join(cwd, 'Hansen notes.txt'))
    expect(fs.fileUrl(target)).toBe(pathToFileURL(join(cwd, 'Hansen notes.txt')).href)
    expect(fs.contains(await fs.resolve('.'), target)).toBe(true)
    expect(await fs.lstat('alias')).toMatchObject({ type: 'symlink' })
    expect(await fs.stat(target)).toMatchObject({ type: 'file', size: 6 })
    expect(await fs.stat(await fs.resolve('missing'))).toBeUndefined()
    // Native listDir uses locale-aware name order, not ASCII code-point order.
    expect((await fs.listDir(await fs.resolve('.'))).map(row => row.name)).toEqual(['alias', 'Hansen notes.txt'])
  })
  it('preserves native create/replace guards, edit errors and before/after outcomes', async () => {
    const { fs } = await provider()
    const target = await fs.resolve('Alex.txt')
    const created = await fs.writeText(target, 'Alex\nAlex\n', { kind: 'createIfAbsent' })
    expect(created).toMatchObject({ operation: 'create', before: null, after: 'Alex\nAlex\n' })
    await expect(fs.writeText(target, 'bad', { kind: 'createIfAbsent' })).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    await expect(fs.editText(target, { oldString: 'Alex', newString: 'Hansen', replaceAll: false })).rejects.toMatchObject({ code: 'FS_AMBIGUOUS_EDIT' })
    const edited = await fs.editText(target, { oldString: 'Alex', newString: 'Hansen', replaceAll: true }, { version: created.version })
    expect(edited).toMatchObject({ before: 'Alex\nAlex\n', after: 'Hansen\nHansen\n' })
    await expect(fs.writeText(target, 'stale', { kind: 'replaceIfVersion', version: created.version })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    await expect(fs.editText(target, { oldString: 'missing', newString: '', replaceAll: false })).rejects.toMatchObject({ code: 'FS_EDIT_NOT_FOUND' })
    expect(await fs.readText(target)).toBe('Hansen\nHansen\n')
  })
  it('uses the native owner lock across separate helper processes so one guarded concurrent write wins', async () => {
    const { fs } = await provider()
    const target = await fs.resolve('concurrent.txt')
    const first = await fs.writeText(target, 'initial')
    const results = await Promise.allSettled(['Hansen', 'Alex', 'Morgan'].map(name => fs.writeText(target, name,
      { kind: 'replaceIfVersion', version: first.version })))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(row => row.status === 'rejected').map(row => row.reason.code)).toEqual(['FS_STALE_VERSION', 'FS_STALE_VERSION'])
    expect(await fs.readText(target)).toBe('Hansen')
  })
  it('retains native per-call read-only denial and does not hide structured missing-file errors', async () => {
    const { fs, cwd } = await provider()
    const target = await fs.resolve('readonly.txt')
    await expect(fs.writeText(target, 'bad', undefined, undefined, { mode: 'read-only', workspaceRoot: cwd })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    expect(await fs.stat(target)).toBeUndefined()
    await expect(fs.readText(target)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await expect(fs.editText(target, { oldString: 'x', newString: 'y', replaceAll: true }, { version: FsVersion('missing') })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  })
  it('keeps binary reads bounded and preserves original streaming UTF-8 semantics', async () => {
    const { fs, cwd } = await provider()
    const bytes = new Uint8Array([0, 1, 2, 255])
    await writeFile(join(cwd, 'binary'), bytes)
    const binary = await fs.resolve('binary')
    expect(await fs.readBytes(binary, undefined, 4)).toEqual(bytes)
    await expect(fs.readBytes(binary, undefined, 3)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
    await expect(fs.readText(binary)).rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
    const text = 'Hansen 和 Alex\n'.repeat(20_000)
    await writeFile(join(cwd, 'stream'), text)
    let actual = ''
    for await (const chunk of await fs.streamText(await fs.resolve('stream'))) actual += chunk
    expect(actual).toBe(text)
  })
  it('rejects a pre-aborted mutation, supports early stream return and withdraws old provider references', async () => {
    const { root, fs, cwd } = await provider()
    const target = await fs.resolve('abort.txt')
    await expect(fs.writeText(target, 'bad', undefined, AbortSignal.abort())).rejects.toMatchObject({ code: 'FS_ABORTED' })
    await expect(readFile(join(cwd, 'abort.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(join(cwd, 'stream'), 'x'.repeat(512_000))
    const stream = await fs.streamText(await fs.resolve('stream'))
    for await (const chunk of stream) { expect(chunk.length).toBeGreaterThan(0); break }
    await root.fiber.dispose()
    await expect(fs.resolve('anything')).rejects.toMatchObject({ code: 'FS_ABORTED' })
  })
  it('enforces explicit request and response frame bounds instead of truncating file data', async () => {
    const { fs, cwd } = await provider(4096)
    const target = await fs.resolve('large.txt')
    await expect(fs.writeText(target, 'x'.repeat(5000))).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
    await writeFile(join(cwd, 'large.txt'), 'x'.repeat(5000))
    await expect(fs.readText(target)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
    expect((await readFile(join(cwd, 'large.txt'))).length).toBe(5000)
  })
  it('cancels an already-open stream and joins its actual native helper tree', async () => {
    const { fs, cwd, handles } = await provider()
    await writeFile(join(cwd, 'stream'), 'x'.repeat(8 * 1024 * 1024))
    const abort = new AbortController()
    const iterator = (await fs.streamText(await fs.resolve('stream'), abort.signal))[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    abort.abort()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'FS_ABORTED' })
    for (const handle of handles) expect(await handle.waitForExit(AbortSignal.timeout(3000))).toBe(true)
  })
  it('disposes an unconsumed live stream and rejects buffered reads through the withdrawn provider', async () => {
    const { root, fs, cwd, handles } = await provider()
    await writeFile(join(cwd, 'stream'), 'x'.repeat(8 * 1024 * 1024))
    const stream = await fs.streamText(await fs.resolve('stream'))
    await root.fiber.dispose()
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'FS_ABORTED' })
    for (const handle of handles) expect(await handle.waitForExit(AbortSignal.timeout(3000))).toBe(true)
  })
  it.each(['write', 'create', 'edit'])('preserves native publication outcomes for %s when cancellation crosses the process pipe', async operation => {
    for (const phase of ['spawn', 'staged', 'published', 'result', 'published-lost-result']) {
      const checkpoint = { phase, armed: false, abort: new AbortController(), reached: 0 }
      const { fs, cwd, handles } = await provider(undefined, checkpoint)
      if (operation !== 'create') await writeFile(join(cwd, 'atomic.txt'), 'original')
      const target = await fs.resolve('atomic.txt')
      checkpoint.armed = true
      const request = operation === 'edit'
        ? fs.editText(target, { oldString: 'original', newString: 'updated', replaceAll: false }, undefined, checkpoint.abort.signal)
        : fs.writeText(target, 'updated', operation === 'create' ? { kind: 'createIfAbsent' } : undefined, checkpoint.abort.signal)
      if (phase === 'staged' || phase === 'spawn') {
        await expect(request).rejects.toMatchObject({ code: 'FS_ABORTED' })
        if (operation === 'create') await expect(readFile(join(cwd, 'atomic.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
        else expect(await readFile(join(cwd, 'atomic.txt'), 'utf8')).toBe('original')
      } else if (phase === 'published-lost-result') {
        await expect(request).rejects.toMatchObject({ code: 'FS_IO_ERROR', message: expect.stringContaining('outcome unavailable') })
        expect(await readFile(join(cwd, 'atomic.txt'), 'utf8')).toBe('updated')
      } else {
        await expect(request).resolves.toMatchObject({ after: 'updated', before: operation === 'create' ? null : 'original' })
        expect(await readFile(join(cwd, 'atomic.txt'), 'utf8')).toBe('updated')
      }
      expect(checkpoint.reached).toBe(1)
      expect((await readdir(cwd)).filter(name => name.endsWith('.tmpdir'))).toEqual([])
      for (const handle of handles) expect(await handle.waitForExit(AbortSignal.timeout(3000))).toBe(true)
    }
  })
  it('cancels a queued mutation before another helper starts while the original FIFO owner unwinds', async () => {
    const checkpoint = { phase: 'staged', armed: false, abort: new AbortController(), reached: 0 }
    const { fs, cwd, handles } = await provider(undefined, checkpoint)
    await writeFile(join(cwd, 'queued.txt'), 'original')
    const target = await fs.resolve('queued.txt'); const existing = handles.length
    checkpoint.armed = true
    const queued = new AbortController()
    checkpoint.abort.signal.addEventListener('abort', () => queued.abort(), { once: true })
    const first = fs.writeText(target, 'first', undefined, checkpoint.abort.signal)
    const second = fs.writeText(target, 'second', undefined, queued.signal)
    const outcomes = await Promise.allSettled([first, second])
    expect(outcomes.map(outcome => outcome.status === 'rejected' ? outcome.reason.code : 'WRITTEN')).toEqual(['FS_ABORTED', 'FS_ABORTED'])
    expect(checkpoint.reached).toBe(1); expect(handles.length - existing).toBe(1)
    expect(await readFile(join(cwd, 'queued.txt'), 'utf8')).toBe('original')
    expect((await readdir(cwd)).filter(name => name.endsWith('.tmpdir'))).toEqual([])
  })
})
