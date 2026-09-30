import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { Context } from '@deepseek-ai/cordis'

/** Deployment-owned execution-world projection. It is not itself an admission policy. */
export interface ManagedHarnessExecutionRequest {
  readonly kind: 'process' | 'terminal'
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Readonly<NodeJS.ProcessEnv>
  /** A matching native read-only wrapper can only tighten the base world. */
  readonly fileAccess: 'read-only' | 'workspace-write'
  /** Native per-call writable root, or the deployment's base root for raw calls. */
  readonly workspaceRoot: string
  /** Optional narrower browse target. Deployment pins it without symlinks and
   * mounts only that directory at lookupCwd for this one helper process. */
  readonly directoryTarget?: string
}

export interface ManagedHarnessExecutionLaunch {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Readonly<NodeJS.ProcessEnv>
}

export interface ManagedHarnessExecutionDomain {
  /** Trusted Node executable and dependency anchor visible INSIDE this execution world. */
  readonly nodeExecutable: string
  readonly moduleAnchor: string
  readonly lookupCwd: string
  /** Synchronous and fail-closed. No lifecycle, timeout or stdio policy belongs here. */
  prepare(request: ManagedHarnessExecutionRequest): ManagedHarnessExecutionLaunch
}

// Reuse the published executable lookup in the same execution world as spawn.
// No copied PATH resolver, host-side filesystem shortcut or second process manager.
const lookupProgram = `
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {realpath} from 'node:fs/promises';
const require=createRequire(await realpath(process.argv[1]));
const {Context}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const {LocalSubprocessRuntime}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-subprocess-local')).href);
const root=new Context();
try {
  await root.plugin(LocalSubprocessRuntime);
  process.stdout.write(JSON.stringify(await root.subprocess.resolveExecutable(process.argv[2],process.env)));
} finally {await root.fiber.dispose();}
`

/**
 * One native subprocess provider, retaining its original handles, readers,
 * cancellation, spill files, terminals and awaited disposal. Only command
 * placement changes. A managed profile must replace, not also load, the local
 * provider. Filesystem alignment and kernel confinement remain deployment gates.
 */
export function createManagedHarnessSubprocessProvider(domain: ManagedHarnessExecutionDomain, sandbox?: SandboxProvider): typeof LocalSubprocessRuntime {
  assert.ok(isAbsolute(domain.nodeExecutable) && isAbsolute(domain.moduleAnchor) && isAbsolute(domain.lookupCwd),
    'Managed execution world requires absolute trusted paths')
  const nodeExecutable = domain.nodeExecutable
  const moduleAnchor = domain.moduleAnchor
  const lookupCwd = domain.lookupCwd
  const prepare = domain.prepare.bind(domain)
  let readOnlyPrefix: readonly string[] | undefined
  let writablePrefix: readonly string[] | undefined
  let writableRootIndices: readonly number[] = []
  if (sandbox) {
    // Obtain the profile from its native owner rather than reproducing runner
    // flags, parsing an environment permission claim, or introducing a ticket
    // registry. The sentinel is never executed. A match only removes writes;
    // the complete original native runner remains in the actual launch argv.
    const sentinel = '/__paimind_native_readonly_profile_probe__'
    const confined = sandbox.confine([sentinel], { mode: 'read-only', workspaceRoot: lookupCwd })
    assert.equal(confined.enforcement, 'full', 'Managed read-only composition requires a fully enforcing native runner')
    assert.ok(confined.argv.length >= 3 && confined.argv.at(-1) === sentinel && confined.argv.at(-2) === '--',
      'Unsupported native sandbox wrapper contract')
    assert.ok(confined.argv.slice(0, -1).every(value => typeof value === 'string' && value !== sentinel && !value.includes('\0')))
    readOnlyPrefix = Object.freeze(confined.argv.slice(0, -1))
    const writable = sandbox.confine([sentinel], { mode: 'workspace-write', workspaceRoot: lookupCwd })
    assert.equal(writable.enforcement, 'full', 'Managed writable composition requires a fully enforcing native runner')
    assert.ok(writable.argv.length >= 3 && writable.argv.at(-1) === sentinel && writable.argv.at(-2) === '--', 'Unsupported native writable wrapper')
    assert.ok(writable.argv.slice(0, -1).every(value => typeof value === 'string' && value !== sentinel && !value.includes('\0')))
    writablePrefix = Object.freeze(writable.argv.slice(0, -1))
    writableRootIndices = Object.freeze(writablePrefix.flatMap((value, index) => value === lookupCwd ? [index] : []))
    assert.ok(writableRootIndices.length > 0, 'Native writable wrapper must identify its workspace root')
  }
  function project(kind: ManagedHarnessExecutionRequest['kind'], spec: Pick<SubprocessSpawnSpec, 'argv' | 'cwd' | 'env'>) {
    const fileAccess = readOnlyPrefix && spec.argv.length > readOnlyPrefix.length &&
      readOnlyPrefix.every((value, index) => spec.argv[index] === value) ? 'read-only' : 'workspace-write'
    let workspaceRoot = lookupCwd
    if (fileAccess === 'workspace-write' && writablePrefix && spec.argv.length > writablePrefix.length) {
      const candidate = spec.argv[writableRootIndices[0]!]
      if (typeof candidate === 'string' && writablePrefix.every((value, index) =>
        spec.argv[index] === (writableRootIndices.includes(index) ? candidate : value))) workspaceRoot = candidate
    }
    const directoryTarget: unknown = Reflect.get(spec, 'directoryTarget')
    assert.ok(directoryTarget === undefined || kind === 'process' && typeof directoryTarget === 'string'
      && isAbsolute(directoryTarget), 'Invalid managed directory target')
    const result = prepare(Object.freeze({ kind, argv: Object.freeze([...spec.argv]), cwd: spec.cwd,
      env: Object.freeze({ ...spec.env }), fileAccess, workspaceRoot,
      ...(typeof directoryTarget === 'string' ? { directoryTarget } : {}) }))
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => undefined)
      throw Error('Managed execution projection must be synchronous')
    }
    assert.ok(result && typeof result === 'object', 'Managed execution projection requires a launch')
    assert.ok(Array.isArray(result.argv) && result.argv.length > 0 && result.argv.every(value => typeof value === 'string' && !value.includes('\0')),
      'Managed execution projection requires an argv')
    assert.ok(isAbsolute(result.argv[0]!) && isAbsolute(result.cwd), 'Managed launch requires absolute executable and cwd')
    assert.ok(result.env && typeof result.env === 'object' && !Array.isArray(result.env), 'Managed launch requires explicit environment')
    return { argv: [...result.argv], cwd: result.cwd, env: { ...result.env } }
  }
  return class ManagedHarnessSubprocessRuntime extends LocalSubprocessRuntime {
    private withdrawn = false
    constructor(ctx: Context) {
      super(ctx)
      // Native teardown joins existing handles but RC.2 does not reject new
      // spawns through retained references. Withdraw placement before teardown;
      // the native owner still performs all process/terminal cleanup.
      ctx.effect(() => () => { this.withdrawn = true }, 'managed subprocess admission lifetime')
    }
    private assertAvailable() { assert.ok(!this.withdrawn, 'Managed subprocess provider has been withdrawn') }
    override spawn(spec: SubprocessSpawnSpec) {
      this.assertAvailable()
      return super.spawn({ ...spec, ...project('process', spec) })
    }
    override spawnTerminal(spec: SubprocessTerminalSpawnSpec) {
      this.assertAvailable()
      // RC.2's shared childEnv implements tombstones for both primitives, while
      // its terminal declaration only lists strings. Keep that version-specific
      // narrowing here so a deployment can scrub the PTY launcher's ambient env.
      return super.spawnTerminal({ ...spec, ...project('terminal', spec) } as SubprocessTerminalSpawnSpec)
    }
    override async resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal) {
      this.assertAvailable()
      signal?.throwIfAborted()
      const spec: SubprocessSpawnSpec = {
        argv: [nodeExecutable, '--input-type=module', '-e', lookupProgram, moduleAnchor, command],
        cwd: lookupCwd, env, signal, graceMs: 1000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 16_384 }, stderr: { maxBytes: 4096 } },
      }
      const handle = this.spawn(spec)
      try {
        const outcome = await handle.done
        signal?.throwIfAborted()
        assert.equal(outcome.exitCode, 0, 'Managed executable lookup failed in execution world')
        const output = handle.collected.stdout!.readFrom(0)
        assert.ok(!output.lossy, 'Managed executable lookup response exceeds bound')
        const resolved: unknown = JSON.parse(output.text)
        assert.ok(typeof resolved === 'string' && isAbsolute(resolved) && !resolved.includes('\0'), 'Invalid managed executable path')
        return resolved
      } finally {
        handle.terminate()
        await handle.waitForExit()
      }
    }
  }
}
