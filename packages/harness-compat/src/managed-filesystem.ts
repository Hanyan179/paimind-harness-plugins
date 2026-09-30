import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { FsError, type FsErrorCode, type FsTarget, type FsWriteIntent, type FsVersion, type FsEditRequest } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem, type Config } from '@deepseek-ai/dsh-fs-local'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ManagedHarnessExecutionDomain } from './managed-subprocess.js'
import { createRequire } from 'node:module'
import { constants, readFileSync } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const nativeVersion = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-fs-local/package.json'), 'utf8')) as { version: string }
const operations = ['resolve', 'stat', 'lstat', 'readText', 'readBytes', 'listDir', 'directoryView', 'fileChunk', 'streamText', 'writeText', 'editText'] as const
type Operation = typeof operations[number]
type Frame = { type: 'ready' | 'chunk' | 'result'; value?: unknown } | { type: 'error'; code: FsErrorCode; message: string }
interface Request {
  operation: Operation
  args: unknown[]
  config: Config
  policy: SandboxExecutionPolicy
  maxFrameBytes: number
}

/** Detached directory metadata. No native target keys or file contents. */
export interface ManagedHarnessDirectoryView {
  readonly path: string
  readonly entries: readonly { readonly name: string; readonly path: string; readonly type: 'file' | 'directory' | 'other';
    readonly symlink: boolean; readonly unavailable: boolean }[]
  readonly truncated: boolean
}

/** Private bounded read projection, not a file registry or a reusable grant. */
export interface ManagedHarnessFileChunk {
  readonly path: string; readonly offset: number; readonly size: number; readonly version: string
  readonly data: string; readonly nextOffset: number | null
}
const FILE_CHUNK_BYTES = 65536
function fileSelection(offset: number, version: string | undefined): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % FILE_CHUNK_BYTES !== 0
    || version !== undefined && (typeof version !== 'string' || !/^[a-f0-9]{64}$/u.test(version)) || offset !== 0 && version === undefined) {
    throw new FsError('Invalid managed file chunk selection', 'FS_SANDBOX_DENIED')
  }
}

export async function readManagedHarnessFileChunk(context: { get(name: 'fs'): unknown }, root: string, path: string,
  offset: number, version: string | undefined, signal: AbortSignal): Promise<ManagedHarnessFileChunk> {
  signal.throwIfAborted(); fileSelection(offset, version)
  const fs = context.get('fs') as { fileChunk?: (root: string, path: string, offset: number, version: string | undefined,
    signal: AbortSignal) => Promise<ManagedHarnessFileChunk> } | undefined
  if (typeof fs?.fileChunk !== 'function') throw new FsError('受管文件读取服务不可用', 'FS_SANDBOX_DENIED')
  return fs.fileChunk(root, path, offset, version, signal)
}

function ownedDirectory(root: string, path: string): string {
  if (typeof root !== 'string' || typeof path !== 'string' || !isAbsolute(root) || !isAbsolute(path)
    || root === sep || root.length > 4096 || path.length > 4096 || root.includes('\0') || path.includes('\0')
    || normalize(root) !== root || normalize(path) !== path || !(path === root || path.startsWith(root + sep))) {
    throw new FsError('只能读取当前会话所属的工作区目录', 'FS_SANDBOX_DENIED')
  }
  return path
}

/** Only the managed native provider implements this private deployment seam.
 * The caller supplies a cwd read from the original Session, not browser input. */
export async function readManagedHarnessDirectoryView(context: { get(name: 'fs'): unknown }, root: string, path: string,
  signal: AbortSignal): Promise<ManagedHarnessDirectoryView> {
  signal.throwIfAborted()
  const fs = context.get('fs') as { directoryView?: (root: string, path: string, signal: AbortSignal) => Promise<ManagedHarnessDirectoryView> } | undefined
  if (typeof fs?.directoryView !== 'function') throw new FsError('受管目录读取服务不可用', 'FS_SANDBOX_DENIED')
  return fs.directoryView(root, path, signal)
}

/** Transport bounds are explicit; large text can use the native chunk stream. */
export interface ManagedHarnessFilesystemOptions {
  executionWorld: Pick<ManagedHarnessExecutionDomain, 'nodeExecutable' | 'moduleAnchor' | 'lookupCwd'>
  /** Maximum UTF-8 JSON frame, not a limit on the complete streamed file. Default 64 MiB. */
  maxFrameBytes?: number
}

const helperProgram = `import{createRequire}from'node:module';import{realpath}from'node:fs/promises';
import{pathToFileURL}from'node:url';const r=createRequire(await realpath(process.argv[1]));
const m=await import(pathToFileURL(r.resolve('@paimind/harness-compat/managed-filesystem')).href);
await m.runManagedHarnessFilesystemOperation();`
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new FsError('Managed filesystem operation aborted', 'FS_ABORTED')
}
function frameLimit(value: number): number {
  assert.ok(Number.isSafeInteger(value) && value >= 1024 && value <= 256 * 1024 * 1024, 'Invalid filesystem transport frame bound')
  return value
}

/**
 * Native filesystem implementation with out-of-process file placement. The
 * published local owner still supplies opaque targets, pure path/URI/containment
 * methods and its per-target FIFO; actual storage/edits run in the same world as
 * native subprocesses. The original sandbox filesystem owns mutation policy.
 * Not automatically installed and not member admission.
 */
export function createManagedHarnessFilesystemProvider(options: ManagedHarnessFilesystemOptions): typeof LocalFileSystem {
  assert.equal(nativeVersion.version, '0.1.1-rc.2', 'Unsupported native filesystem locking contract')
  // RC.2 exposes no public transaction/lock hook. Reuse this version-gated owner
  // method rather than copying its lock map, weakening same-version writes, or
  // pretending separate one-call processes share an in-memory critical section.
  const lock = Reflect.get(LocalFileSystem.prototype, 'withLock') as <T>(key: FsTarget['targetKey'], operation: () => Promise<T>) => Promise<T>
  assert.equal(typeof lock, 'function', 'Native filesystem transaction seam is missing')
  const world = Object.freeze({ ...options.executionWorld })
  assert.ok(isAbsolute(world.nodeExecutable) && isAbsolute(world.moduleAnchor) && isAbsolute(world.lookupCwd))
  const maximum = frameLimit(options.maxFrameBytes ?? 64 * 1024 * 1024)
  return class ManagedHarnessFileSystem extends LocalFileSystem {
    static inject = ['subprocess', 'sandbox', 'sandboxPolicy']
    private withdrawn = false
    constructor(ctx: Context, config: Config) {
      super(ctx, config)
      assert.equal(this.config.cwd, world.lookupCwd, 'Native filesystem cwd must match the execution world')
      ctx.effect(() => () => { this.withdrawn = true }, 'managed filesystem admission lifetime')
    }
    override get sandboxMode() { return this.ctx.sandboxPolicy.defaultMode }

    private async *transfer(operation: Operation, args: unknown[], signal?: AbortSignal, suppliedPolicy?: SandboxExecutionPolicy): AsyncGenerator<Frame> {
      aborted(signal)
      if (this.withdrawn) throw new FsError('Managed filesystem provider has been withdrawn', 'FS_ABORTED')
      const mutation = operation === 'writeText' || operation === 'editText'
      const policy = mutation ? suppliedPolicy ?? this.ctx.sandboxPolicy.resolve() : { mode: 'read-only' as const, workspaceRoot: world.lookupCwd }
      const request: Request = { operation, args, policy, config: this.config, maxFrameBytes: maximum }
      const input = JSON.stringify(request)
      if (Buffer.byteLength(input) > maximum) throw new FsError('Filesystem request exceeds its transport frame bound', 'FS_TOO_LARGE')
      const command = [world.nodeExecutable, '--input-type=module', '-e', helperProgram, world.moduleAnchor]
      const confined = policy.mode === 'danger-full-access' ? undefined : this.ctx.sandbox.confine(command, { ...policy, mode: policy.mode })
      if (confined && confined.enforcement !== 'full') throw new FsError('Native filesystem execution placement is not fully enforced', 'FS_SANDBOX_DENIED')
      // An approved native escalation still stays inside the deployment world;
      // it never means executing on the host outside managed subprocess placement.
      const directoryTarget = operation === 'directoryView' ? ownedDirectory(world.lookupCwd, args[0] as string)
        : operation === 'fileChunk' ? dirname(ownedDirectory(world.lookupCwd, args[0] as string)) : undefined
      const spec = { argv: confined?.argv ?? command, cwd: world.lookupCwd,
        ...(directoryTarget === undefined ? {} : { directoryTarget }),
        graceMs: 1000, stdio: { stdin: 'pipe' as const, stdout: 'pipe' as const, stderr: { maxBytes: 4096 } } }
      const handle = this.ctx.subprocess.spawn(spec)
      let release: (() => Promise<void>) | undefined
      let fallback: ReturnType<typeof setTimeout> | undefined
      let terminal = false
      const uncertainMutation = () => new FsError(
        'Native filesystem mutation outcome unavailable; read back the target before retrying', 'FS_IO_ERROR')
      const cancel = () => {
        if (terminal) return
        // Give the original filesystem an opportunity to abort and remove its
        // atomic staging directory before the native process-tree fallback.
        if (!handle.stdin?.destroyed) handle.stdin?.write('{"type":"abort"}\n')
        fallback ??= setTimeout(() => handle.terminate(), 1000)
      }
      const inputError = () => handle.terminate()
      handle.stdin!.on('error', inputError)
      const lines = createInterface({ input: handle.stdout!, crlfDelay: Infinity })
      try {
        release = this.ctx.effect(() => async () => {
          handle.terminate()
          await handle.waitForExit()
        }, 'managed native filesystem operation')
        // The request must precede cancellation on the same pipe. A signal
        // that fired during spawn must not become the helper's first request.
        handle.stdin!.write(input + '\n')
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
        for await (const line of lines) {
          // Reads/streams can stop immediately. For a mutation the native
          // owner alone knows whether atomic publication already happened.
          // Let its result/error settle the race; a late cancel is not rollback.
          if (!mutation) {
            aborted(signal)
            if (this.withdrawn) throw new FsError('Managed filesystem provider has been withdrawn', 'FS_ABORTED')
          }
          if (Buffer.byteLength(line) > maximum) throw new FsError('Filesystem response exceeds its transport frame bound', 'FS_TOO_LARGE')
          const frame = JSON.parse(line) as Frame
          assert.ok(!terminal && frame && ['ready', 'chunk', 'result', 'error'].includes(frame.type), 'Invalid native filesystem response')
          if (frame.type === 'result' || frame.type === 'error') {
            terminal = true
            if (fallback) clearTimeout(fallback)
            signal?.removeEventListener('abort', cancel)
          }
          if (frame.type === 'error') throw new FsError(frame.message, frame.code)
          yield frame
        }
        const outcome = await handle.done
        if (!mutation) {
          aborted(signal)
          if (this.withdrawn) throw new FsError('Managed filesystem provider has been withdrawn', 'FS_ABORTED')
        }
        if (outcome.exitCode !== 0 || !terminal) throw mutation ? uncertainMutation()
          : new FsError('Native filesystem helper did not finish its response', 'FS_IO_ERROR')
      } catch (error) {
        if (!mutation) {
          aborted(signal)
          if (this.withdrawn) throw new FsError('Managed filesystem provider has been withdrawn', 'FS_ABORTED')
        }
        if (error instanceof FsError) throw error
        if (mutation) throw uncertainMutation()
        throw new FsError('Invalid native filesystem transport response', 'FS_IO_ERROR', { cause: error })
      } finally {
        lines.close()
        signal?.removeEventListener('abort', cancel)
        if (fallback) clearTimeout(fallback)
        handle.stdin!.destroy()
        if (release) await release()
        else { handle.terminate(); await handle.waitForExit() }
        handle.stdin!.off('error', inputError)
      }
    }
    private async value<T>(operation: Operation, args: unknown[], signal?: AbortSignal, policy?: SandboxExecutionPolicy): Promise<T> {
      let result: T | undefined
      for await (const frame of this.transfer(operation, args, signal, policy)) {
        assert.equal(frame.type, 'result', 'Unexpected streaming filesystem response')
        result = (frame as { value?: unknown }).value as T
      }
      return result as T
    }
    override resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }) {
      return this.value<FsTarget>('resolve', [path, { cwd: opts?.cwd }], opts?.signal)
    }
    override stat(target: FsTarget, signal?: AbortSignal) { return this.value<Awaited<ReturnType<LocalFileSystem['stat']>>>('stat', [target], signal) }
    override lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal) { return this.value<Awaited<ReturnType<LocalFileSystem['lstat']>>>('lstat', [path, opts], signal) }
    override readText(target: FsTarget, signal?: AbortSignal) { return this.value<string>('readText', [target], signal) }
    override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number) {
      return new Uint8Array(Buffer.from(await this.value<string>('readBytes', [target, maxBytes], signal), 'base64'))
    }
    override listDir(target: FsTarget, signal?: AbortSignal) { return this.value<Awaited<ReturnType<LocalFileSystem['listDir']>>>('listDir', [target], signal) }
    directoryView(root: string, path: string, signal: AbortSignal): Promise<ManagedHarnessDirectoryView> {
      ownedDirectory(world.lookupCwd, root)
      return this.value('directoryView', [ownedDirectory(root, path)], signal)
    }
    fileChunk(root: string, path: string, offset: number, version: string | undefined, signal: AbortSignal): Promise<ManagedHarnessFileChunk> {
      ownedDirectory(world.lookupCwd, root); ownedDirectory(root, path); fileSelection(offset, version)
      if (path === root) throw new FsError('不能把会话根作为文件读取', 'FS_NOT_REGULAR_FILE')
      return this.value('fileChunk', [path, offset, version], signal)
    }
    override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const frames = this.transfer('streamText', [target], signal)
      const ready = await frames.next()
      assert.ok(!ready.done && ready.value.type === 'ready', 'Native file stream did not open')
      return { async *[Symbol.asyncIterator]() {
        try {
          for await (const frame of frames) {
            if (frame.type === 'result') continue
            assert.ok(frame.type === 'chunk' && typeof frame.value === 'string')
            yield frame.value
          }
        } finally { await frames.return(undefined) }
      } }
    }
    override writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, policy?: SandboxExecutionPolicy) {
      return lock.call(this, target.targetKey, () => this.value<Awaited<ReturnType<LocalFileSystem['writeText']>>>('writeText', [target, content, expected], signal, policy)) as ReturnType<LocalFileSystem['writeText']>
    }
    override editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, policy?: SandboxExecutionPolicy) {
      return lock.call(this, target.targetKey, () => this.value<Awaited<ReturnType<LocalFileSystem['editText']>>>('editText', [target, edit, expected], signal, policy)) as ReturnType<LocalFileSystem['editText']>
    }
  }
}

/** Trusted helper entry used by the same native subprocess provider, not an API endpoint. */
export async function runManagedHarnessFilesystemOperation(): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const abort = new AbortController()
  let first = true
  let resolveRequest: (value: Request) => void
  let rejectRequest: (reason: unknown) => void
  const request = new Promise<Request>((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject })
  input.on('line', line => {
    try {
      if (first) { first = false; resolveRequest(JSON.parse(line) as Request) }
      else { assert.equal(JSON.parse(line).type, 'abort'); abort.abort() }
    } catch (error) { abort.abort(); rejectRequest(error) }
  })
  input.on('close', () => { if (first) rejectRequest(new Error('Missing native filesystem request')) })
  const root = new Context()
  let maximum = 64 * 1024 * 1024
  async function send(frame: Frame) {
    const text = JSON.stringify(frame) + '\n'
    if (Buffer.byteLength(text) > maximum) throw new FsError('Filesystem response exceeds its transport frame bound', 'FS_TOO_LARGE')
    if (!process.stdout.write(text)) await once(process.stdout, 'drain')
  }
  try {
    const value = await request
    maximum = frameLimit(value.maxFrameBytes)
    assert.ok(operations.includes(value.operation) && Array.isArray(value.args))
    await root.plugin(SandboxPolicyService, value.policy)
    await root.plugin(SandboxedFileSystem, value.config)
    const fs = root.fs
    const args = value.args
    const signal = abort.signal
    let result: unknown
    switch (value.operation) {
      case 'resolve': result = await fs.resolve(args[0] as string, { ...args[1] as { cwd?: string }, signal }); break
      case 'stat': result = await fs.stat(args[0] as FsTarget, signal); break
      case 'lstat': result = await fs.lstat(args[0] as string, args[1] as { cwd?: string }, signal); break
      case 'readText': result = await fs.readText(args[0] as FsTarget, signal); break
      case 'readBytes': result = Buffer.from(await fs.readBytes(args[0] as FsTarget, signal, args[1] as number)).toString('base64'); break
      case 'listDir': result = await fs.listDir(args[0] as FsTarget, signal); break
      case 'fileChunk': {
        assert.equal(process.platform, 'linux', 'File chunks require the managed Linux placement')
        const cwd = value.config.cwd
        if (cwd === undefined) throw new FsError('Managed file root unavailable', 'FS_SANDBOX_DENIED')
        const path = ownedDirectory(cwd, args[0] as string), offset = args[1] as number
        const expected = args[2] == null ? undefined : args[2] as string
        fileSelection(offset, expected)
        // The original launcher pins the exact NOFOLLOW parent directory at
        // cwd. Resolve through the native FS, then pin the final regular-file
        // descriptor too. Native readBytes is whole-file-only, so this private
        // range capability belongs to the existing managed provider, not a new
        // filesystem service. No raw file handle/path key leaves this helper.
        const placed = join(cwd, basename(path)), target = await fs.resolve(placed, { signal })
        if (fs.processPath(target) !== placed || (await fs.lstat(placed, undefined, signal))?.type !== 'file') {
          throw new FsError('File aliases and nonregular entries are not readable', 'FS_SANDBOX_DENIED')
        }
        const handle = await open(placed, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const before = await handle.stat({ bigint: true })
          if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new FsError('File identity is not an isolated regular file', 'FS_SANDBOX_DENIED')
          }
          const fingerprint = (info: typeof before) => createHash('sha256').update(
            [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.nlink].join(':')).digest('hex')
          const version = fingerprint(before), size = Number(before.size)
          if (expected !== undefined && expected !== version) throw new FsError('文件已变化，请重新读取', 'FS_STALE_VERSION')
          if (offset > size || offset === size && size !== 0) throw new FsError('File offset is outside its content', 'FS_NOT_FOUND')
          const bytes = Buffer.alloc(Math.min(FILE_CHUNK_BYTES, size - offset))
          let read = 0
          while (read < bytes.length) {
            signal.throwIfAborted()
            const part = await handle.read(bytes, read, bytes.length - read, offset + read)
            if (!part.bytesRead) throw new FsError('File changed during read', 'FS_STALE_VERSION')
            read += part.bytesRead
          }
          signal.throwIfAborted()
          if (fingerprint(await handle.stat({ bigint: true })) !== version) throw new FsError('File changed during read', 'FS_STALE_VERSION')
          const current = await lstat(placed, { bigint: true })
          if (!current.isFile() || fingerprint(current) !== version) {
            throw new FsError('File path changed during read', 'FS_STALE_VERSION')
          }
          result = { path, offset, size, version, data: bytes.toString('base64'), nextOffset: offset + read < size ? offset + read : null } satisfies ManagedHarnessFileChunk
        } finally { await handle.close() }
        break
      }
      case 'directoryView': {
        assert.equal(process.platform, 'linux', 'Directory view requires the managed Linux placement')
        const cwd = value.config.cwd
        assert.equal(typeof cwd, 'string')
        if (cwd === undefined) throw new FsError('Managed directory root unavailable', 'FS_SANDBOX_DENIED')
        const path = ownedDirectory(cwd, args[0] as string)
        // The existing launcher pinned the exact requested directory at the
        // execution world's cwd. All native probes stay inside that read-only
        // namespace, including probes of malicious symlinks.
        const target = await fs.resolve(cwd, { signal })
        const rows = await fs.listDir(target, signal)
        const entries: ManagedHarnessDirectoryView['entries'][number][] = []
        let bytes = Buffer.byteLength(JSON.stringify({ path, entries: [], truncated: true }))
        for (const row of rows) {
          signal.throwIfAborted()
          if (entries.length >= 1000) break
          const info = await fs.lstat(join(cwd, row.name), undefined, signal)
          if (!info) continue // An entry removed during the native scan is absent.
          const entry = { name: row.name, path: join(path, row.name), type: row.type,
            symlink: info.type === 'symlink', unavailable: info.type === 'symlink' }
          const size = Buffer.byteLength(JSON.stringify(entry)) + 1
          if (bytes + size > 192 * 1024) break
          bytes += size; entries.push(entry)
        }
        result = { path, entries, truncated: entries.length < rows.length } satisfies ManagedHarnessDirectoryView
        break
      }
      case 'writeText': result = await fs.writeText(args[0] as FsTarget, args[1] as string, args[2] as FsWriteIntent | undefined, signal, value.policy); break
      case 'editText': result = await fs.editText(args[0] as FsTarget, args[1] as FsEditRequest, args[2] as { version: FsVersion } | undefined, signal, value.policy); break
      case 'streamText': {
        const chunks = await fs.streamText(args[0] as FsTarget, signal)
        await send({ type: 'ready' })
        for await (const chunk of chunks) await send({ type: 'chunk', value: chunk })
        break
      }
    }
    await send({ type: 'result', value: result })
  } catch (error) {
    const known = error instanceof FsError
    await send({ type: 'error', code: known ? error.code : 'FS_IO_ERROR',
      message: known ? error.message : 'Native filesystem operation failed' })
  } finally {
    input.close(); process.stdin.destroy()
    await root.fiber.dispose()
  }
}
