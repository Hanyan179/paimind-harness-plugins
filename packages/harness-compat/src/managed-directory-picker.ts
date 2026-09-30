import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import NativeBrowseDirectoryPicker, { type Config } from '@deepseek-ai/dsh-host-directory-picker-browse'
import { DirectoryPickerError, type DirectoryPickerBrowseCapability, type DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker'
import { constants, readFileSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ManagedHarnessExecutionDomain } from './managed-subprocess.js'

const require = createRequire(import.meta.url)
const version = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-host-directory-picker-browse/package.json'), 'utf8')) as { version: string }
const inputLimit = 16 * 1024
const outputLimit = 16 * 1024 * 1024
type Operation = 'list' | 'createDirectory'
interface Request { operation: Operation; root: string; path: string; name?: string | undefined; config: Config }
type Response = { ok: true; value: DirectoryListing | string }
  | { ok: false; code: DirectoryPickerError['code']; message: string }

/** Image-owned location only, never a root supplied by a browser request. */
export interface ManagedHarnessDirectoryPickerOptions {
  executionWorld: Pick<ManagedHarnessExecutionDomain, 'nodeExecutable' | 'moduleAnchor' | 'lookupCwd'>
}

const helperProgram = `import{createRequire}from'node:module';import{realpath}from'node:fs/promises';
import{pathToFileURL}from'node:url';const r=createRequire(await realpath(process.argv[1]));
const m=await import(pathToFileURL(r.resolve('@paimind/harness-compat/managed-directory-picker')).href);
await m.runManagedHarnessDirectoryOperation();`

function ownedPath(root: string, path: string | undefined, operation: Operation): string {
  const target = path ?? root
  if (typeof target !== 'string' || target.length > 4096 || target.includes('\0') || !isAbsolute(target)
    || target.split(sep).includes('..') || !(resolve(target) === root || resolve(target).startsWith(root + sep))) {
    throw new DirectoryPickerError(operation === 'list' ? 'directory-unreadable' : 'directory-create-failed',
      typeof target === 'string' ? target : root, '只能访问当前成员的受管工作区目录')
  }
  return resolve(target)
}

/** Selects a managed implementation of the existing native browse service.
 * The native UI, schemas, bounded scan, name validation and mkdir remain
 * upstream-owned. Every filesystem operation runs through the already managed
 * subprocess provider; no member request reaches the host filesystem here. */
export function createManagedHarnessDirectoryPickerProvider(options: ManagedHarnessDirectoryPickerOptions): typeof NativeBrowseDirectoryPicker {
  assert.equal(version.version, '0.1.1-rc.2', 'Unsupported native directory-picker contract')
  const world = Object.freeze({ ...options.executionWorld })
  assert.ok(isAbsolute(world.nodeExecutable) && isAbsolute(world.moduleAnchor)
    && isAbsolute(world.lookupCwd) && resolve(world.lookupCwd) === world.lookupCwd && world.lookupCwd !== sep)
  return class ManagedHarnessDirectoryPicker extends NativeBrowseDirectoryPicker {
    static inject = ['subprocess', 'sandbox', 'sandboxPolicy']
    private withdrawn = false
    private readonly nativeConfig: Config
    private readonly managedCapability: DirectoryPickerBrowseCapability = Object.freeze({
      kind: 'browse',
      list: (path?: string, signal?: AbortSignal) => this.transfer('list', path, undefined, signal) as Promise<DirectoryListing>,
      createDirectory: (path: string, name: string) => this.transfer('createDirectory', path, name) as Promise<string>,
    })
    constructor(ctx: Context, config: Config) {
      super(ctx, config)
      this.nativeConfig = Object.freeze({ ...config })
      ctx.effect(() => () => { this.withdrawn = true }, 'managed directory-picker lifetime')
    }
    override capability() { return this.managedCapability }
    private async transfer(operation: Operation, path?: string, name?: string, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const target = ownedPath(world.lookupCwd, path, operation)
      const failure = (message: string) => new DirectoryPickerError(
        operation === 'list' ? 'directory-unreadable' : 'directory-create-failed', target, message)
      if (this.withdrawn) throw failure('目录选择服务已停止，请重新加载页面')
      // Platform defaults cannot promote this narrow native operation to a
      // full-access filesystem request. A read-only native policy still wins.
      if (operation === 'createDirectory' && this.ctx.sandboxPolicy.defaultMode === 'read-only') {
        throw failure('当前工作区为只读，无法创建目录')
      }
      const input = JSON.stringify({ operation, root: world.lookupCwd, path: target, name, config: this.nativeConfig } satisfies Request)
      if (Buffer.byteLength(input) > inputLimit) throw failure('目录请求过大')
      const command = [world.nodeExecutable, '--input-type=module', '-e', helperProgram, world.moduleAnchor]
      const confined = this.ctx.sandbox.confine(command, { mode: operation === 'list' ? 'read-only' : 'workspace-write',
        workspaceRoot: world.lookupCwd })
      if (confined.enforcement !== 'full') throw failure('目录选择所需的隔离环境未就绪')
      // Native spawn keeps its handle/lifecycle contract; the managed placement
      // subclass consumes this additional narrowing field before launching.
      const spec = { argv: confined.argv, cwd: world.lookupCwd, graceMs: 1000, directoryTarget: target,
        stdio: { stdin: 'pipe' as const, stdout: { maxBytes: outputLimit }, stderr: { maxBytes: 4096 } } }
      const handle = this.ctx.subprocess.spawn(spec)
      let release: (() => Promise<void>) | undefined
      const cancel = () => { handle.terminate() }
      handle.stdin!.on('error', cancel)
      try {
        release = this.ctx.effect(() => async () => { handle.terminate(); await handle.waitForExit() }, 'managed native directory operation')
        signal?.addEventListener('abort', cancel, { once: true })
        handle.stdin!.end(input)
        if (signal?.aborted) cancel()
        const outcome = await handle.done
        signal?.throwIfAborted()
        if (this.withdrawn) throw failure('目录选择服务已停止，请重新加载页面')
        const output = handle.collected.stdout!.readFrom(0)
        if (outcome.exitCode !== 0 || output.lossy) throw failure(operation === 'list'
          ? '无法读取受管工作区目录' : '目录创建结果未确认，请刷新目录后再重试')
        const result = JSON.parse(output.text) as Response
        assert.ok(result && typeof result.ok === 'boolean', 'Invalid native directory response')
        if (!result.ok) {
          assert.ok(['directory-unreadable', 'directory-exists', 'directory-create-failed'].includes(result.code))
          throw new DirectoryPickerError(result.code, target, result.message)
        }
        return result.value
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof DirectoryPickerError) throw error
        throw failure(operation === 'list' ? '无法读取受管工作区目录' : '目录创建结果未确认，请刷新目录后再重试')
      } finally {
        signal?.removeEventListener('abort', cancel)
        handle.stdin!.destroy()
        if (release) await release()
        else { handle.terminate(); await handle.waitForExit() }
        handle.stdin!.off('error', cancel)
      }
    }
  }
}

/** One request inside the existing Linux execution world, not a network API.
 * The deployment launcher walks the target with NOFOLLOW and bind-fd mounts
 * that exact directory at root for this helper. Thus native path-based list /
 * mkdir can be reused without requiring /proc or a second filesystem owner. */
export async function runManagedHarnessDirectoryOperation(): Promise<void> {
  const context = new Context()
  let operation: Operation = 'list'
  let phase = 'input'
  let result: Response
  try {
    assert.equal(process.platform, 'linux', 'Managed directory scope requires Linux placement')
    let input = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) {
      input += chunk.toString()
      assert.ok(Buffer.byteLength(input) <= inputLimit, 'Directory request exceeds bound')
    }
    const request = JSON.parse(input) as Request
    assert.ok(request && ['list', 'createDirectory'].includes(request.operation))
    operation = request.operation
    assert.ok(typeof request.root === 'string' && isAbsolute(request.root) && resolve(request.root) === request.root && request.root !== sep)
    const target = ownedPath(request.root, request.path, operation)
    const parts = relative(request.root, target).split(sep).filter(Boolean)
    const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    phase = 'native-provider'
    await context.plugin(NativeBrowseDirectoryPicker, request.config)
    const native = context.directoryPicker.capability()
    assert.equal(native.kind, 'browse')
    const anchored = request.root
    phase = 'native-operation'
    if (operation === 'createDirectory') {
      assert.ok(typeof request.name === 'string')
      await native.createDirectory(anchored, request.name)
      result = { ok: true, value: join(target, request.name) }
    } else {
      const listing = await native.list(anchored)
      const entries: DirectoryListing['entries'] = []
      for (const row of listing.entries) {
        // Native browse follows directory symlinks; managed members deliberately
        // see only actual owned directories. Opening again also closes the race
        // between the native scan and this projection.
        let child: FileHandle | undefined
        try { child = await open(join(anchored, row.name), flags) }
        catch (error) {
          if (['ELOOP', 'ENOTDIR', 'ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
          throw error
        }
        finally { await child?.close() }
        entries.push({ ...row, path: join(target, row.name) })
      }
      let crumb = request.root
      const crumbs = [{ name: basename(crumb), path: crumb, hidden: false }]
      for (const part of parts) { crumb = join(crumb, part); crumbs.push({ name: part, path: crumb, hidden: false }) }
      result = { ok: true, value: { path: target, home: request.root, crumbs, entries, truncated: listing.truncated } }
    }
  } catch (error) {
    // Operator diagnostics only: never paths, names, payloads or credentials.
    process.stderr.write(JSON.stringify({ event: 'managed-directory-helper-failed', operation, phase,
      code: (error as NodeJS.ErrnoException)?.code ?? (error as Error)?.name ?? 'unknown' }) + '\n')
    const code = error instanceof DirectoryPickerError ? error.code : operation === 'list' ? 'directory-unreadable' : 'directory-create-failed'
    result = { ok: false, code, message: code === 'directory-exists' ? '同名目录已存在，请选择该目录或使用其他名称'
      : '无法访问或创建该受管目录；目录必须位于当前成员工作区内且不能是符号链接' }
  } finally {
    await context.fiber.dispose()
  }
  const output = JSON.stringify(result)
  assert.ok(Buffer.byteLength(output) <= outputLimit, 'Directory response exceeds bound')
  process.stdout.write(output)
}
