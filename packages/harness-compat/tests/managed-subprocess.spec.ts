// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { createManagedHarnessSubprocessProvider, type ManagedHarnessExecutionDomain } from '../src/managed-subprocess.js'

// Real native provider/child processes. The identity mapper is NOT a sandbox;
// Linux namespace and PTY behavior are checked in the separate real-image probe.
const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose() })
const identity: ManagedHarnessExecutionDomain = {
  nodeExecutable: process.execPath,
  moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)),
  lookupCwd: process.cwd(),
  prepare: request => ({ argv: request.argv, cwd: request.cwd, env: request.env }),
}
async function provider(domain = identity) {
  const root = new Context(); roots.push(root)
  await root.plugin(createManagedHarnessSubprocessProvider(domain))
  return root
}
const spec = (code: string) => ({ argv: [process.execPath, '-e', code], cwd: process.cwd(), graceMs: 100,
  stdio: { stdin: 'ignore' as const, stdout: { maxBytes: 256 }, stderr: { maxBytes: 256 } } })

describe('managed placement over the original native subprocess provider', () => {
  it('retains independent native output readers and spill recovery', async () => {
    const root = await provider()
    const input = spec("process.stdout.write('x'.repeat(2048));process.stderr.write('diagnostic')")
    input.stdio.stdout = { maxBytes: 256, ...{ spill: { maxBytes: 8192 } } }
    const handle = root.subprocess.spawn(input)
    expect(await handle.done).toEqual({ exitCode: 0, signal: null })
    const first = handle.collected.stdout!.readFrom(0)
    expect(first.lossy).toBe(true); expect(first.nextOffset).toBe(2048)
    expect(handle.collected.stdout!.readFrom(0)).toEqual(first)
    expect(await readFile(first.spillPath!, 'utf8')).toBe('x'.repeat(2048))
    expect(handle.collected.stderr!.readFrom(0).text).toBe('diagnostic')
    expect(await handle.waitForExit()).toBe(true)
  })
  it('retains native raw streams and stdin byte transport', async () => {
    const root = await provider()
    const handle = root.subprocess.spawn({ ...spec('process.stdin.pipe(process.stdout)'),
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 128 } } })
    const chunks: Buffer[] = []; handle.stdout!.on('data', chunk => chunks.push(chunk))
    handle.stdin!.end('Hansen / Alex\n')
    await handle.done
    expect(Buffer.concat(chunks).toString()).toBe('Hansen / Alex\n')
    expect(handle.collected.stdout).toBeUndefined()
  })
  it('passes immutable input to the deployment and preserves explicit tombstones', async () => {
    let observed = false
    const root = await provider({ ...identity, prepare(request) {
      expect(Object.isFrozen(request)).toBe(true); expect(Object.isFrozen(request.argv)).toBe(true)
      expect(Object.isFrozen(request.env)).toBe(true)
      expect(request.env).toEqual({ PAIMIND_PROBE: 'explicit', PATH: undefined })
      observed = true; return identity.prepare(request)
    } })
    const handle = root.subprocess.spawn({ ...spec('process.stdout.write(process.env.PAIMIND_PROBE)'), env: { PAIMIND_PROBE: 'explicit', PATH: undefined } })
    await handle.done
    expect(observed).toBe(true); expect(handle.collected.stdout!.readFrom(0).text).toBe('explicit')
  })
  it('runs native executable lookup through the same deployment projection', async () => {
    let lookups = 0
    const root = await provider({ ...identity, prepare(request) { lookups++; return identity.prepare(request) } })
    expect(await root.subprocess.resolveExecutable(process.execPath)).toBe(process.execPath)
    await expect(root.subprocess.resolveExecutable('./relative-node')).rejects.toThrow('lookup failed')
    await expect(root.subprocess.resolveExecutable('/definitely-missing-managed-executable')).rejects.toThrow('lookup failed')
    expect(lookups).toBe(3)
  })
  it('retains native cancellation and awaited disposal of a live process', async () => {
    const root = await provider()
    const abort = new AbortController()
    const handle = root.subprocess.spawn({ ...spec('setInterval(()=>{},1000)'), signal: abort.signal })
    abort.abort()
    await handle.done
    expect(await handle.waitForExit(AbortSignal.timeout(3000))).toBe(true)
    const second = root.subprocess.spawn(spec('setInterval(()=>{},1000)'))
    await root.fiber.dispose()
    expect(await second.waitForExit(AbortSignal.timeout(3000))).toBe(true)
  })
  it('rejects process, terminal and executable lookup through a withdrawn native provider before placement', async () => {
    let projections = 0
    const root = await provider({ ...identity, prepare(request) { projections++; return identity.prepare(request) } })
    const previous = root.subprocess
    await root.fiber.dispose()
    expect(() => previous.spawn(spec('process.exit(0)'))).toThrow('withdrawn')
    expect(() => previous.spawnTerminal({ argv: [process.execPath], cwd: process.cwd(), env: {},
      rows: 24, cols: 80, graceMs: 1000 })).toThrow('withdrawn')
    await expect(previous.resolveExecutable(process.execPath)).rejects.toThrow('withdrawn')
    expect(projections).toBe(0)
  })
  it('rejects placement errors before launching and aborts lookup before projection', async () => {
    const root = await provider({ ...identity, prepare() { throw Error('execution domain denied') } })
    expect(() => root.subprocess.spawn(spec('process.exit(0)'))).toThrow('execution domain denied')
    await expect(root.subprocess.resolveExecutable(process.execPath, {}, AbortSignal.abort())).rejects.toThrow()
  })
  it.each([
    ['async success', async () => ({ argv: [process.execPath], cwd: process.cwd(), env: {} })],
    ['async failure', async () => { throw Error('private deployment failure') }],
  ])('rejects an accidental %s projection without spawning or leaking an unhandled rejection', async (_name, prepare) => {
    const root = await provider({ ...identity, prepare: prepare as unknown as ManagedHarnessExecutionDomain['prepare'] })
    expect(() => root.subprocess.spawn(spec('process.exit(0)'))).toThrow('must be synchronous')
    await new Promise(resolve => setImmediate(resolve))
  })
  it('derives the read-only prefix from the native owner and only tightens placement', async () => {
    const prefixes: string[][] = []
    // A value-level fixture, NOT an enforcing backend. The real Linux image
    // suite separately executes the original native sandbox and kernel checks.
    const sandbox = { confine(argv: readonly string[], policy: { mode: string; workspaceRoot: string }) {
      expect(policy.workspaceRoot).toBe(identity.lookupCwd)
      const wrapped = policy.mode === 'read-only' ? ['/native-runner-fixture', '--readonly-fixture', '--', ...argv] :
        ['/native-runner-fixture', '--writable-fixture', policy.workspaceRoot, '--', ...argv]
      prefixes.push(wrapped)
      return { argv: wrapped, enforcement: 'full' }
    } } as unknown as SandboxProvider
    const modes: string[] = []
    const root = new Context(); roots.push(root)
    await root.plugin(createManagedHarnessSubprocessProvider({ ...identity, prepare(request) {
      modes.push(request.fileAccess); throw Error('projection captured without execution')
    } }, sandbox))
    expect(prefixes).toHaveLength(2)
    const original = ['/native-runner-fixture', '--readonly-fixture', '--', process.execPath, '-e', 'process.exit(0)']
    expect(() => root.subprocess.spawn({ ...spec(''), argv: original, env: { DSH_PERMISSION_MODE: 'danger-full-access' } })).toThrow('captured')
    expect(() => root.subprocess.spawn({ ...spec(''), env: { DSH_PERMISSION_MODE: 'read-only' } })).toThrow('captured')
    expect(modes).toEqual(['read-only', 'workspace-write'])
    expect(original).toEqual(['/native-runner-fixture', '--readonly-fixture', '--', process.execPath, '-e', 'process.exit(0)'])
  })
  it('projects the native per-call writable directory and never treats an environment claim as its owner', async () => {
    const sandbox = { confine(argv: readonly string[], policy: { mode: string; workspaceRoot: string }) {
      return { argv: ['/native-runner-fixture', policy.mode, policy.workspaceRoot, '--', ...argv], enforcement: 'full' }
    } } as unknown as SandboxProvider
    const seen: string[] = []
    const root = new Context(); roots.push(root)
    await root.plugin(createManagedHarnessSubprocessProvider({ ...identity, prepare(request) {
      seen.push(request.workspaceRoot); throw Error('projection captured without execution')
    } }, sandbox))
    const directory = identity.lookupCwd + '/client-project'
    const input = { ...spec(''), argv: ['/native-runner-fixture', 'workspace-write', directory, '--', process.execPath],
      env: { DSH_WORKSPACE_ROOT: '/not-an-authorized-root' } }
    expect(() => root.subprocess.spawn(input)).toThrow('captured')
    expect(() => root.subprocess.spawn(spec(''))).toThrow('captured')
    expect(seen).toEqual([directory, identity.lookupCwd])
  })
  it.each([
    { argv: ['/native-runner', '--', '/__paimind_native_readonly_profile_probe__'], enforcement: 'partial' },
    { argv: ['/__paimind_native_readonly_profile_probe__'], enforcement: 'full' },
    { argv: ['/native-runner', '--wrong', '/__paimind_native_readonly_profile_probe__'], enforcement: 'full' },
  ])('rejects a partial or unsupported native sandbox wrapper: $enforcement $argv', result => {
    expect(() => createManagedHarnessSubprocessProvider(identity, { confine: () => result } as unknown as SandboxProvider)).toThrow()
  })
})
