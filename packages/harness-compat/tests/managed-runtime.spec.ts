// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { Context, symbols } from '@deepseek-ai/cordis'
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader'
import NativeWorkflow from '@deepseek-ai/dsh-workflow-worker-thread'
import NativeBrowseDirectoryPicker from '@deepseek-ai/dsh-host-directory-picker-browse'
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { createRequire } from 'node:module'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { ApiProxyService } from '@deepseek-ai/dsh-host-apiproxy'
import { fileURLToPath } from 'node:url'

const nativeBoot = vi.hoisted(() => vi.fn())
vi.mock('@deepseek-ai/dsh-app-boot', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-app-boot')>(), boot: nativeBoot,
}))
import { bootManagedHarnessProfile, prepareManagedHarnessModuleRoot, type ManagedHarnessProfileOptions } from '../src/managed-runtime.js'

const cleanup: (() => void)[] = []
const roots: string[] = []
function modes(path: string, mode: number) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return
  chmodSync(path, mode)
  if (stat.isDirectory()) for (const name of readdirSync(path)) modes(join(path, name), mode)
}
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  for (const path of roots.splice(0)) { modes(path, 0o700); rmSync(path, { recursive: true }) }
  vi.restoreAllMocks()
  nativeBoot.mockReset()
})
function fixture(patch = '- id: enterprise\n  disabled: false\n', capabilities = false, clientRoster = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'paimind-managed-profile-test-')))
  roots.push(root)
  const runtimeRoot = join(root, 'runtime')
  const profileHome = join(root, 'managed')
  const profile = join(profileHome, 'profiles/web')
  const installation = join(runtimeRoot, 'node_modules/@deepseek-ai/dsh')
  const bundle = join(runtimeRoot, 'node_modules/@fixture/bundle')
  const write = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  write(join(runtimeRoot, 'package.json'), '{}')
  write(join(runtimeRoot, 'profiles/package.json'), '{"private":true,"type":"module"}')
  write(join(installation, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' }))
  const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
  symlinkSync(dirname(native.resolve('@deepseek-ai/dsh-jobs-local/package.json')),
    join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-jobs-local'))
  symlinkSync(dirname(native.resolve('@deepseek-ai/dsh-tool-jobs/package.json')),
    join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-tool-jobs'))
  // The paired origin guard uses this exact native renderer. Keep the profile
  // fixture's dependency closure aligned with production instead of failing
  // module resolution before queue/job/delegation readiness can be tested.
  symlinkSync(dirname(native.resolve('@deepseek-ai/dsh-skill/package.json')),
    join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-skill'))
  for (const name of ['@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-commands', '@deepseek-ai/dsh-session-log-export', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-tools']) {
    symlinkSync(dirname(native.resolve(name + '/package.json')), join(runtimeRoot, 'node_modules', name))
  }
  mkdirSync(join(installation, 'config/agent-presets'), { recursive: true })
  write(join(bundle, 'package.json'), JSON.stringify({ name: '@fixture/bundle', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  write(join(bundle, 'cordis.patch.yml'), `- insert:
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config: { includeUserRoot: true }
    - id: hmr
      name: '@deepseek-ai/cordis-plugin-hmr'
      disabled: true
    - id: enterprise
      name: '@fixture/enterprise'
      disabled: true
${capabilities ? `    - id: subprocess
      name: '@deepseek-ai/dsh-subprocess-local'
    - id: fs-sandbox
      name: '@deepseek-ai/dsh-fs-sandbox'
    - id: sandbox
      name: '@deepseek-ai/dsh-sandbox-local'
    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
    - id: code-runtime
      name: '@deepseek-ai/dsh-code-runtime-worker-thread'
` : ''}
${clientRoster ? `    - id: cordis-client-runner
      name: '@deepseek-ai/dsh-cordis-client-runner'
    - id: ui-cordis
      name: '@deepseek-ai/dsh-client-ui-cordis'
    - id: ui-settings-general
      name: '@deepseek-ai/dsh-client-ui-settings-general'
    - id: ui-settings-models
      name: '@deepseek-ai/dsh-client-ui-settings-models'
    - id: ui-settings-plugins
      name: '@deepseek-ai/dsh-client-ui-settings-plugins'
    - id: ui-settings-plugin-inventory
      name: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'
    - id: ui-conversation
      name: '@deepseek-ai/dsh-client-ui-conversation'
    - id: ui-settings
      name: '@deepseek-ai/dsh-client-ui-settings'
    - id: modules
      name: '@deepseek-ai/dsh-client-modules'
    - id: cordis-host-runner
      name: '@deepseek-ai/dsh-cordis-host-runner'
    - id: paimind-extension-center
      name: '@paimind/extension-center'
` : ''}
`)
  write(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@fixture/bundle'] } } }))
  write(join(profile, 'cordis.yml'), '[]\n')
  write(join(profile, 'cordis.patch.yml'), patch)
  modes(runtimeRoot, 0o555); modes(profileHome, 0o555)
  const options: ManagedHarnessProfileOptions = { runtimeRoot, profileHome, profileName: 'web',
    installationManifest: join(installation, 'package.json'), args: ['--port', '3210'],
    environment: { HOME: join(root, 'member-home'), DSH_HOME: join(root, 'member-data') }, requestExit: vi.fn() }
  const context = { provide: vi.fn(), on: vi.fn(), effect: (fn: () => () => void) => cleanup.push(fn()), fiber: { dispose: vi.fn() } }
  nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => { await prepare(context); return context })
  return { root, runtimeRoot, profileHome, profile, installation, bundle, options, context, write }
}

describe('image-owned native profile adapter', () => {
  it('does not enable connector configuration without the paired private execution and authorization boundary', async () => {
    const f = fixture(), directory = join(f.options.environment.DSH_HOME!, '.enterprise-connectors')
    await expect(bootManagedHarnessProfile({ ...f.options, nativeConnectorDirectory: directory })).rejects.toThrow('managed private execution boundary')
    expect(nativeBoot).not.toHaveBeenCalled()
    expect(() => readFileSync(join(directory, 'cordis.json'))).toThrow()
  })
  it('projects only the exact management client roster through native disabled rows and leaves the default intact', async () => {
    const f = fixture(undefined, false, true)
    const before = readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')
    await bootManagedHarnessProfile(f.options)
    expect(f.context.on).not.toHaveBeenCalled()
    const defaultRows = composeEntries([nativeBoot.mock.calls.at(-1)![2]])
    await bootManagedHarnessProfile({ ...f.options, clientAudience: 'member' })
    const memberRows = composeEntries([nativeBoot.mock.calls.at(-1)![2]])
    const disabled = new Set(['cordis-client-runner', 'ui-cordis',
      'ui-settings-models', 'ui-settings-plugins', 'ui-settings-plugin-inventory'])
    expect(memberRows).toEqual(defaultRows.map(row => disabled.has(row.id!) ? { ...row, disabled: true } : row))
    expect(defaultRows.filter(row => disabled.has(row.id!))).toHaveLength(5)
    // General owns the native Settings shell as well as its General section.
    // Removing it also removes the member's account and logout entry.
    expect(memberRows.find(row => row.id === 'ui-settings-general')?.disabled).not.toBe(true)
    expect(defaultRows.filter(row => disabled.has(row.id!)).every(row => row.disabled !== true)).toBe(true)
    expect(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')).toBe(before)
    expect(f.context.on).toHaveBeenCalledOnce()
    const [event, inject] = f.context.on.mock.calls[0]!
    expect(event).toBe('webserver/index-inject')
    const existing = { kind: 'script', text: 'native script unchanged' }
    const table = [existing]
    inject(table)
    expect(table).toEqual([existing, { kind: 'global', name: '__PAIMIND_CLIENT_AUDIENCE__',
      value: { schemaVersion: 1, audience: 'member' } }])
    expect(() => inject(table)).toThrow('already has an index owner')
  })
  it('rejects a missing, aliased or duplicate management owner and an unknown audience before native boot', async () => {
    const absent = fixture()
    await expect(bootManagedHarnessProfile({ ...absent.options, clientAudience: 'member' })).rejects.toThrow('member client owner')
    const replaced = fixture('- id: ui-cordis\n  name: "@fixture/replacement"\n', false, true)
    await expect(bootManagedHarnessProfile({ ...replaced.options, clientAudience: 'member' })).rejects.toThrow('name mismatch for "ui-cordis"')
    const duplicate = fixture('- insert:\n    - id: extra-runner\n      name: "@deepseek-ai/dsh-cordis-client-runner"\n', false, true)
    await expect(bootManagedHarnessProfile({ ...duplicate.options, clientAudience: 'member' })).rejects.toThrow('member client owner')
    await expect(bootManagedHarnessProfile({ ...absent.options, clientAudience: 'admin' as 'member' })).rejects.toThrow('client audience')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('prepares the native dependency closure only in a fresh private carrier', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'paimind-managed-modules-test-')))
    roots.push(root)
    const app = join(root, 'node_modules/@deepseek-ai/dsh')
    const dependency = join(root, 'node_modules/@fixture/native-service')
    mkdirSync(app, { recursive: true }); mkdirSync(dependency, { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@paimind/enterprise-worker-runtime', private: true }))
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', dependencies: { '@fixture/native-service': '1.0.0' } }))
    writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: '@fixture/native-service', version: '1.0.0' }))
    prepareManagedHarnessModuleRoot(root)
    expect(realpathSync(join(root, 'profiles/node_modules/@fixture/native-service'))).toBe(dependency)
    expect(isAbsolute(readlinkSync(join(root, 'profiles/node_modules/@fixture/native-service')))).toBe(false)
    expect(readFileSync(join(root, 'profiles/package.json'), 'utf8')).toBe('{"private":true,"type":"module"}\n')
    expect(() => prepareManagedHarnessModuleRoot(root)).toThrow('fresh build-owned target')
    expect(realpathSync(join(root, 'profiles/node_modules/@fixture/native-service'))).toBe(dependency)
    const relocated = `${root}-relocated`
    renameSync(root, relocated)
    roots[roots.indexOf(root)] = relocated
    expect(realpathSync(join(relocated, 'profiles/node_modules/@fixture/native-service')))
      .toBe(join(relocated, 'node_modules/@fixture/native-service'))
  })
  it('rejects build preparation in an unrelated package before creating a target', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'paimind-managed-modules-denied-test-')))
    roots.push(root)
    writeFileSync(join(root, 'package.json'), '{"name":"unrelated","private":true}')
    expect(() => prepareManagedHarnessModuleRoot(root)).toThrow()
    expect(readdirSync(root)).toEqual(['package.json'])
  })
  it('uses native bundle composition, preserves personal presets, and only reads inherited environment', async () => {
    const f = fixture()
    // Poison both locations the interactive CLI legitimately reads. Neither
    // should become a configuration or environment input for this embedding.
    f.write(join(f.options.environment.DSH_HOME!, 'cordis.patch.yml'), 'invalid: user patch')
    f.write(join(f.options.environment.DSH_HOME!, '.env'), 'MANAGED_ATTACK=home\n')
    f.write(join(f.options.environment.HOME!, '.env'), 'MANAGED_ATTACK=workspace\n')
    const original = readFileSync(join(f.profile, 'cordis.yml'), 'utf8')
    const prepare = vi.fn()
    expect(await bootManagedHarnessProfile({ ...f.options, prepare })).toBe(f.context)
    expect(prepare).toHaveBeenCalledWith(f.context)
    const [name, rootConfig, patches, , base] = nativeBoot.mock.calls[0]!
    expect(name).toBe('paimind-managed'); expect(rootConfig).toBe(join(f.profile, 'cordis.yml'))
    expect(base).toBe(new URL(`file://${f.runtimeRoot}/profiles/package.json`).href)
    expect(patches.at(-1)).toEqual({ id: 'agent-presets', config: { includeUserRoot: true,
      roots: [{ path: join(f.installation, 'config/agent-presets'), trust: 'system' }] } })
    const environment = f.context.provide.mock.calls.find(call => call[0] === 'launchEnvironment')![1]
    expect(environment.get('HOME')?.source).toBe('process')
    expect(environment.get('MANAGED_ATTACK')).toBeUndefined()
    expect(readFileSync(rootConfig, 'utf8')).toBe(original)
  })
  it('rejects writable files and writable parent directories before native boot', async () => {
    const f = fixture()
    const root = join(f.profile, 'cordis.yml')
    chmodSync(root, 0o644)
    await expect(bootManagedHarnessProfile(f.options)).rejects.toThrow('read-only')
    chmodSync(root, 0o444); chmodSync(f.profile, 0o755)
    await expect(bootManagedHarnessProfile(f.options)).rejects.toThrow('read-only')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('rejects alternate roots, traversal and unmanaged configuration contents', async () => {
    const f = fixture()
    await expect(bootManagedHarnessProfile({ ...f.options, profileName: '../web' })).rejects.toThrow()
    chmodSync(join(f.profile, 'cordis.yml'), 0o644)
    writeFileSync(join(f.profile, 'cordis.yml'), '- name: attacker\n')
    chmodSync(join(f.profile, 'cordis.yml'), 0o444)
    await expect(bootManagedHarnessProfile(f.options)).rejects.toThrow('empty native include')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('rejects missing or escaping bundle data and image profile aliases', async () => {
    const f = fixture()
    const alias = join(f.root, 'managed-alias')
    symlinkSync(f.profileHome, alias)
    await expect(bootManagedHarnessProfile({ ...f.options, profileHome: alias })).rejects.toThrow('canonical')
    chmodSync(f.bundle, 0o755)
    rmSync(join(f.bundle, 'cordis.patch.yml'))
    f.write(join(f.root, 'outside.patch.yml'), '- id: enterprise\n  disabled: true\n')
    symlinkSync(join(f.root, 'outside.patch.yml'), join(f.bundle, 'cordis.patch.yml'))
    chmodSync(f.bundle, 0o555)
    await expect(bootManagedHarnessProfile(f.options)).rejects.toThrow('escapes')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('rejects an enabled configuration watcher instead of silently creating one', async () => {
    const f = fixture('- id: hmr\n  disabled: false\n')
    await expect(bootManagedHarnessProfile(f.options)).rejects.toThrow('cannot enable native config HMR')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('releases its native failure listener when preparation/boot fails', async () => {
    const f = fixture()
    const count = process.listenerCount('unhandledRejection')
    await expect(bootManagedHarnessProfile({ ...f.options, prepare: () => { throw Error('preparation rejected') } })).rejects.toThrow('preparation rejected')
    expect(process.listenerCount('unhandledRejection')).toBe(count)
  })
  it('returns the original native context and owns no shadow session registry', async () => {
    const f = fixture()
    const events: unknown[] = []
    let cwd = '/fixture/hansen'
    const directoryView = vi.fn(async (_root: string, path: string) => ({ path, entries: [], truncated: false }))
    const fileChunk = vi.fn(async (_root: string, path: string) => ({ path, offset: 0, size: 0, version: 'a'.repeat(64), data: '', nextOffset: null }))
    const readNative = vi.fn(() => ({ id: 'owned-session', header: { id: 'owned-session', agentPreset: 'standard', cwd }, events }))
    const connectorRows: unknown[] = [], entries = vi.fn(() => connectorRows.values())
    Object.assign(f.context, { sessions: { get: readNative }, get: (name: string) => name === 'fs' ? { directoryView, fileChunk } : name === 'loader' ? { entries } : undefined })
    const result: Context = await bootManagedHarnessProfile(f.options)
    expect(result).toBe(f.context)
    expect(f.context.provide.mock.calls.map(call => call[0])).toEqual(['launchEnvironment', 'cmdlineArgs', 'appExit', 'paimindNativeConnectorReferences', 'paimindNativeSessionReferences'])
    const connectors = f.context.provide.mock.calls.find(call => call[0] === 'paimindNativeConnectorReferences')![1]
    expect(Object.keys(connectors)).toEqual(['read']); expect(Object.isFrozen(connectors)).toBe(true)
    expect(entries).not.toHaveBeenCalled()
    expect(connectors.read(new AbortController().signal)).toEqual({ schema: 'paimind.native-connectors/v1', scope: 'loader-tree', connection: 'not-probed', entries: [] })
    expect(entries).toHaveBeenCalledTimes(1)
    const references = f.context.provide.mock.calls.find(call => call[0] === 'paimindNativeSessionReferences')![1]
    expect(Object.keys(references)).toEqual(['read', 'creation', 'turnState', 'events', 'approval', 'directory', 'file']); expect(Object.isFrozen(references)).toBe(true)
    expect(await references.read('owned-session', new AbortController().signal))
      .toEqual({ sessionId: 'owned-session', agentPreset: 'standard', hasForkBoundary: false })
    expect(await references.creation('owned-session', new AbortController().signal))
      .toEqual({ sessionId: 'owned-session', kind: 'existing', agentPreset: 'standard' })
    events.push({ type: 'agent-preset/selected', data: { agentPreset: 'hansen-personal' } }, { type: 'turn/end' })
    expect(await references.read('owned-session', new AbortController().signal))
      .toEqual({ sessionId: 'owned-session', agentPreset: 'hansen-personal', hasForkBoundary: true })
    expect(await references.creation('owned-session', new AbortController().signal))
      .toEqual({ sessionId: 'owned-session', kind: 'existing', agentPreset: 'hansen-personal' })
    expect(readNative).toHaveBeenCalledTimes(6)
    expect(await references.directory('owned-session', undefined, new AbortController().signal))
      .toEqual({ path: cwd, entries: [], truncated: false })
    expect(directoryView).toHaveBeenCalledExactlyOnceWith(cwd, cwd, expect.any(AbortSignal))
    directoryView.mockImplementationOnce(async (_root, path) => { cwd = '/fixture/changed'; return { path, entries: [], truncated: false } })
    await expect(references.directory('owned-session', '/fixture/hansen/docs', new AbortController().signal)).rejects.toThrow('directory changed')
    expect(readNative).toHaveBeenCalledTimes(10)
    cwd = '/fixture/hansen'
    expect(await references.file('owned-session', '说明.txt', 0, undefined, new AbortController().signal)).toMatchObject({ path: '/fixture/hansen/说明.txt' })
    expect(fileChunk).toHaveBeenCalledExactlyOnceWith(cwd, '/fixture/hansen/说明.txt', 0, undefined, expect.any(AbortSignal))
    fileChunk.mockImplementationOnce(async (_root, path) => { cwd = '/fixture/changed'; return { path, offset: 0, size: 0, version: 'a'.repeat(64), data: '', nextOffset: null } })
    await expect(references.file('owned-session', '说明.txt', 0, undefined, new AbortController().signal)).rejects.toThrow('directory changed')
    expect(readNative).toHaveBeenCalledTimes(14)
    for (const dispose of cleanup.splice(0)) dispose()
    expect(() => connectors.read(new AbortController().signal)).toThrow()
    expect(entries).toHaveBeenCalledTimes(1)
    await expect(references.read('owned-session', new AbortController().signal)).rejects.toThrow()
    await expect(references.creation('owned-session', new AbortController().signal)).rejects.toThrow()
    await expect(references.directory('owned-session', undefined, new AbortController().signal)).rejects.toThrow()
    await expect(references.file('owned-session', '说明.txt', 0, undefined, new AbortController().signal)).rejects.toThrow()
    expect(readNative).toHaveBeenCalledTimes(14)
    expect(directoryView).toHaveBeenCalledTimes(2)
  })
  it('rejects boot and disposes its real root when a requested tool policy never activates', async () => {
    const f = fixture()
    const root = new Context()
    const disposed = vi.fn()
    root.effect(() => disposed)
    const count = process.listenerCount('unhandledRejection')
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => { await prepare(root); return root })
    await expect(bootManagedHarnessProfile({ ...f.options, toolGuard: () => 'sealed' })).rejects.toThrow('not active')
    expect(disposed).toHaveBeenCalledOnce()
    expect(process.listenerCount('unhandledRejection')).toBe(count)
  })
  it('rejects missing, duplicate or unsupported native capability owners before boot', async () => {
    const f = fixture()
    const executionDomain = { nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)),
      lookupCwd: f.root, prepare: () => { throw Error('must not execute') } }
    await expect(bootManagedHarnessProfile({ ...f.options, executionDomain })).rejects.toThrow('capability owner')
    const duplicate = fixture('- insert:\n    - id: extra-fs\n      name: "@deepseek-ai/dsh-fs-sandbox"\n', true)
    await expect(bootManagedHarnessProfile({ ...duplicate.options, executionDomain })).rejects.toThrow('capability owner')
    const expression = fixture('- id: fs-sandbox\n  config:\n    cwd: !!js process.cwd()\n', true)
    await expect(bootManagedHarnessProfile({ ...expression.options, executionDomain })).rejects.toThrow('filesystem cwd')
    const attributes = fixture('- id: fs-sandbox\n  isolate: { fs: private }\n', true)
    await expect(bootManagedHarnessProfile({ ...attributes.options, executionDomain })).rejects.toThrow('row attributes')
    const codeDuplicate = fixture('- insert:\n    - id: alternate-code\n      name: "@deepseek-ai/dsh-code-runtime-worker-thread"\n', true)
    await expect(bootManagedHarnessProfile({ ...codeDuplicate.options, executionDomain })).rejects.toThrow('owner: code-runtime')
    const codeExpression = fixture('- id: code-runtime\n  config: { computeMs: !!js "1000" }\n', true)
    await expect(bootManagedHarnessProfile({ ...codeExpression.options, executionDomain })).rejects.toThrow('literal native configuration')
    const codeAttributes = fixture('- id: code-runtime\n  isolate: { codeRuntime: private }\n', true)
    await expect(bootManagedHarnessProfile({ ...codeAttributes.options, executionDomain })).rejects.toThrow('code row attributes')
    const codeUnknown = fixture('- id: code-runtime\n  config: { customLimit: 1000 }\n', true)
    await expect(bootManagedHarnessProfile({ ...codeUnknown.options, executionDomain })).rejects.toThrow('literal native configuration')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('fails closed and disposes when the requested native pair cannot activate', async () => {
    const f = fixture(undefined, true)
    const root = new Context()
    const disposed = vi.fn(); root.effect(() => disposed)
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => { await root.plugin(Loader); await prepare(root); return root })
    await expect(bootManagedHarnessProfile({ ...f.options, executionDomain: {
      nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)),
      lookupCwd: f.root, prepare: () => { throw Error('must not execute') },
    } })).rejects.toThrow('capability pair is not active')
    expect(disposed).toHaveBeenCalledOnce()
  })
  it.each(['originCheck', 'queueCheck'] as const)('rejects an unpaired %s before native boot', async key => {
    const f = fixture()
    await expect(bootManagedHarnessProfile({ ...f.options, [key]: async () => {} })).rejects.toThrow('must be paired')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it.each(['managed', 'jobs-bypass', 'jobs-absent'])('selects and verifies the original queue and job owners without an execution-domain substitution: %s', async mode => {
    const f = fixture(), root = new Context()
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => {
      await root.plugin(Loader); root.provide('userQuestions', { registerProvider: () => () => {} } as never)
      await prepare(root)
      const Provider = root.loader.unwrapExports({ default: ApiProxyService }) as typeof ApiProxyService
      expect(Provider).not.toBe(ApiProxyService)
      new Provider(root, {})
      const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
      const Web = root.loader.unwrapExports(native('@deepseek-ai/dsh-host-webserver')) as any
      const Commands = root.loader.unwrapExports(native('@deepseek-ai/dsh-commands')) as any
      expect(Web).not.toBe(native('@deepseek-ai/dsh-host-webserver').WebServer)
      expect(Commands).not.toBe(native('@deepseek-ai/dsh-commands').CommandRuntime)
      new Web(root, { host: '127.0.0.1', port: 0 }); new Commands(root)
      const Export = native('@deepseek-ai/dsh-session-log-export'), selectedExport = root.loader.unwrapExports(Export) as any
      expect(selectedExport).not.toBe(Export); expect(selectedExport.inject).toBe(Export.inject)
      const OriginalJobs = native('@deepseek-ai/dsh-jobs-local').LocalJobRegistry
      const Jobs = root.loader.unwrapExports({ default: OriginalJobs }) as typeof OriginalJobs
      expect(Jobs).not.toBe(OriginalJobs); expect(Jobs.Config).toBe(OriginalJobs.Config)
      const OriginalController = native('@deepseek-ai/dsh-tool-jobs')
      const Controller = root.loader.unwrapExports(OriginalController) as typeof OriginalController
      expect(Controller).not.toBe(OriginalController); expect(Controller.Config).toBe(OriginalController.Config)
      expect(Controller.inject).toBe(OriginalController.inject)
      if (mode !== 'jobs-absent') await root.plugin(mode === 'jobs-bypass' ? OriginalJobs : Jobs, { maxConcurrentJobsPerOwner: 3 })
      return root
    })
    try {
      const pending = bootManagedHarnessProfile({ ...f.options, originCheck: async () => {}, queueCheck: async () => {}, skillUseCheck: async () => undefined,
        jobOriginSeal: async input => ({ nativeSessionId: input.nativeSessionId, sources: [] }) })
      if (mode === 'managed') expect(await pending).toBe(root)
      else await expect(pending).rejects.toThrow('job authority is not active')
    } finally { await root.fiber.dispose() }
  })
  it('refuses readiness if the native API owner bypasses managed queue selection', async () => {
    const f = fixture(), root = new Context()
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => {
      await root.plugin(Loader); root.provide('userQuestions', { registerProvider: () => () => {} } as never)
      await prepare(root); new ApiProxyService(root, {}); return root
    })
    await expect(bootManagedHarnessProfile({ ...f.options, originCheck: async () => {}, queueCheck: async () => {}, skillUseCheck: async () => undefined })).rejects.toThrow('queue authority is not active')
  })
  it('rejects delegation without the active-turn and queue guards before native boot', async () => {
    const f = fixture()
    await expect(bootManagedHarnessProfile({ ...f.options, originDerive: async () => ({ nativeSessionId: 'unused', sources: [] }) })).rejects.toThrow('requires paired')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('rejects managed boot without the paired loaded-Skill owner check', async () => {
    const f = fixture()
    await expect(bootManagedHarnessProfile({ ...f.options, originCheck: async () => {}, queueCheck: async () => {} }))
      .rejects.toThrow('loaded Skill authority must be paired')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it('rejects job-completion signing without the paired current-execution and queue guards', async () => {
    const f = fixture()
    await expect(bootManagedHarnessProfile({ ...f.options, jobOriginSeal: async input => ({ nativeSessionId: input.nativeSessionId, sources: [] }) })).rejects.toThrow('requires paired')
    expect(nativeBoot).not.toHaveBeenCalled()
  })
  it.each(['managed', 'agents-bypass', 'subagents-bypass'])('selects exact original child owners and checks readiness: %s', async mode => {
    const f = fixture(), root = new Context(), local = createRequire(import.meta.url)
    const native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
    modes(f.runtimeRoot, 0o755)
    for (const name of ['@deepseek-ai/dsh-subagent-spawn-in-process', '@deepseek-ai/dsh-subagent-fork-in-process']) {
      symlinkSync(dirname(native.resolve(name + '/package.json')), join(f.runtimeRoot, 'node_modules', name))
    }
    modes(f.runtimeRoot, 0o555)
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => {
      await root.plugin(Loader); root.provide('userQuestions', { registerProvider: () => () => {} } as never)
      await prepare(root)
      const Api = root.loader.unwrapExports(ApiProxyService) as typeof ApiProxyService
      const Web = root.loader.unwrapExports(native('@deepseek-ai/dsh-host-webserver')) as any
      const Commands = root.loader.unwrapExports(native('@deepseek-ai/dsh-commands')) as any
      new Web(root, { host: '127.0.0.1', port: 0 }); new Commands(root)
      const Agents = root.loader.unwrapExports(AgentRegistry) as typeof AgentRegistry
      const Subagents = root.loader.unwrapExports(SubagentRuntime) as typeof SubagentRuntime
      await root.plugin(root.loader.unwrapExports(native('@deepseek-ai/dsh-jobs-local')), {})
      expect(Agents).not.toBe(AgentRegistry); expect(Subagents).not.toBe(SubagentRuntime)
      new Api(root, {}); await root.plugin(mode === 'agents-bypass' ? AgentRegistry : Agents)
      await root.plugin(mode === 'subagents-bypass' ? SubagentRuntime : Subagents)
      const spawn = native('@deepseek-ai/dsh-subagent-spawn-in-process'), selected = root.loader.unwrapExports(spawn) as typeof spawn
      expect(selected).not.toBe(spawn); expect(selected.Config).toBe(spawn.Config); expect(selected.inject).toBe(spawn.inject)
      expect(root.loader.unwrapExports(spawn)).toBe(selected)
      await root.plugin(selected, { providerName: 'native-renamed' })
      expect(root.subagents.getProvider('native-renamed')?.name).toBe('native-renamed')
      return root
    })
    try {
      const pending = bootManagedHarnessProfile({ ...f.options, originCheck: async () => {}, queueCheck: async () => {}, skillUseCheck: async () => undefined,
        originDerive: async input => ({ nativeSessionId: input.targetSessionId, sources: [] }) })
      if (mode === 'managed') expect(await pending).toBe(root)
      else await expect(pending).rejects.toThrow(mode === 'agents-bypass' ? 'child creation authority is not active' : 'delegation authority is not active')
    } finally { await root.fiber.dispose() }
  })
  it('preserves an explicitly disabled Code Runtime instead of enabling a new backend', async () => {
    const f = fixture('- id: code-runtime\n  disabled: true\n', true)
    const root = new Context()
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => {
      await root.plugin(Loader)
      await prepare(root)
      await root.plugin({ apply: (ctx: Context) => { ctx.provide('sandbox', {
        confine: (argv: string[], policy: { mode: string; workspaceRoot: string }) => ({
          argv: ['/fixture/sandbox', policy.mode, policy.workspaceRoot, '--', ...argv], enforcement: 'full',
        }),
      }) } })
      await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: f.root })
      return root
    })
    try {
      await bootManagedHarnessProfile({ ...f.options, executionDomain: {
        nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)),
        lookupCwd: f.root, prepare: () => { throw Error('must not execute') },
      } })
      expect(root.get('codeRuntime')).toBeUndefined()
      expect(root.get('fs')).toBeTruthy(); expect(root.get('subprocess')).toBeTruthy()
    } finally { await root.fiber.dispose() }
  })
  it.each(['sandbox', 'policy'])('replaces both native rows, preserves file config and withdraws the real pair with its %s owner', async dependency => {
    const f = fixture('- id: fs-sandbox\n  config: { diffBasisMaxBytes: 4096 }\n- id: code-runtime\n  config: { computeMs: 500, maxWallMs: 2000, maxOutputBytes: 1024, maxOldGenerationSizeMb: 128 }\n', true)
    const root = new Context()
    // Real native DI, policy, subprocess and filesystem. The wrapper/placement
    // here is an explicitly non-enforcing fixture, not kernel acceptance.
    const sandbox = { confine: (argv: string[], policy: { mode: string; workspaceRoot: string }) => ({
      argv: ['/fixture/sandbox', policy.mode, policy.workspaceRoot, '--', ...argv], enforcement: 'full',
    }) }
    const executionDomain = { nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)),
      lookupCwd: f.root, prepare: (request: { argv: readonly string[]; cwd: string; env: Readonly<NodeJS.ProcessEnv> }) => ({
        argv: request.argv[0] === '/fixture/sandbox' ? [...request.argv.slice(4)] : [...request.argv], cwd: request.cwd, env: request.env,
      }) }
    let policy!: ReturnType<Context['plugin']>
    let sandboxOwner!: ReturnType<Context['plugin']>
    const provideSandbox = () => root.plugin({ name: 'identity-sandbox-fixture', apply: (ctx: Context) => { ctx.provide('sandbox', sandbox) } })
    const pair = () => new Promise<void>(resolve => { root.inject(['fs', 'subprocess', 'codeRuntime'], () => { resolve() }) })
    nativeBoot.mockImplementation(async (_name, _file, patches, prepare) => {
      const rows = composeEntries([patches])
      expect(rows.find(row => row.id === 'subprocess')?.disabled).toBe(true)
      expect(rows.find(row => row.id === 'fs-sandbox')?.disabled).toBe(true)
      expect(rows.find(row => row.id === 'code-runtime')?.disabled).toBe(true)
      await root.plugin(Loader)
      await prepare(root)
      const ready = pair()
      sandboxOwner = provideSandbox(); await sandboxOwner
      policy = root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: f.root })
      await policy; await ready
      return root
    })
    try {
      expect(await bootManagedHarnessProfile({ ...f.options, executionDomain })).toBe(root)
      const previousFs = root.fs; const previousProcess = root.subprocess; const previousCode = root.codeRuntime
      expect(previousCode.isolation).toBe('process')
      expect(await previousCode.run({ program: 'return await tools.name({})', bindings: [
        { global: 'tools', functions: { name: async () => 'Hansen' } },
      ] })).toEqual({ logs: [], value: 'Hansen' })
      expect((await previousCode.run({ program: 'return "x".repeat(2000)', bindings: [] })).error?.kind).toBe('output-limit')
      expect(Reflect.get(previousFs, 'config')).toEqual({ cwd: f.root, diffBasisMaxBytes: 4096 })
      const target = await root.fs.resolve('Hansen-native-pair.txt')
      await root.fs.writeText(target, 'Hansen')
      expect(await root.fs.readText(target)).toBe('Hansen')
      await (dependency === 'policy' ? policy : sandboxOwner).dispose()
      expect(root.get('subprocess')).toBeUndefined(); expect(root.get('fs')).toBeUndefined()
      expect(root.get('codeRuntime')).toBeUndefined()
      await expect(previousCode.run({ program: 'return 1', bindings: [] })).rejects.toThrow('withdrawn')
      await expect(previousFs.readText(target)).rejects.toMatchObject({ code: 'FS_ABORTED' })
      expect(() => previousProcess.spawn({ argv: [process.execPath, '-e', ''], cwd: f.root, graceMs: 1000,
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' } })).toThrow('withdrawn')
      const ready = pair()
      if (dependency === 'policy') {
        policy = root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: f.root }); await policy
      } else { sandboxOwner = provideSandbox(); await sandboxOwner }
      await ready
      expect(root.fs).not.toBe(previousFs); expect(root.subprocess).not.toBe(previousProcess)
      expect(root.codeRuntime).not.toBe(previousCode)
      expect(await root.codeRuntime.run({ program: 'return 2', bindings: [] })).toEqual({ logs: [], value: 2 })
      expect(await root.fs.readText(await root.fs.resolve('Hansen-native-pair.txt'))).toBe('Hansen')
    } finally { await root.fiber.dispose() }
  })
  it.each(['alternate', 'own-original'])('refuses a competing Loader normalizer (%s) without overwriting its owner', async kind => {
    const f = fixture(undefined, true); const root = new Context()
    let loader!: Loader; let other!: Loader['unwrapExports']
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => {
      await root.plugin(Loader)
      loader = Reflect.get(root.loader, symbols.original) as Loader
      other = kind === 'own-original' ? Loader.prototype.unwrapExports : value => value
      Object.defineProperty(loader, 'unwrapExports', { value: other, configurable: true })
      await prepare(root); return root
    })
    await expect(bootManagedHarnessProfile({ ...f.options, executionDomain: {
      nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)),
      lookupCwd: f.root, prepare: () => { throw Error('must not execute') },
    } })).rejects.toThrow('another owner')
    expect(loader.unwrapExports).toBe(other)
    expect(Object.hasOwn(loader, 'unwrapExports')).toBe(true)
  })
  it('selects original workflow entries per native realm without changing another Loader or persistent rows', async () => {
    const f = fixture(undefined, true)
    const root = new Context(); const separate = new Context()
    root.baseUrl = new URL('../', import.meta.url).href
    await separate.plugin(Loader)
    const untouched = Reflect.get(separate.loader, symbols.original) as Loader
    const original = Loader.prototype.unwrapExports
    let owned!: Loader
    nativeBoot.mockImplementation(async (_name, _file, _patches, prepare) => {
      await root.plugin(Loader)
      root.loader.builtins.group = Group
      owned = Reflect.get(root.loader, symbols.original) as Loader
      await prepare(root)
      await root.plugin({ apply: (ctx: Context) => {
        ctx.provide('sandbox', { confine: (argv: string[], policy: { mode: string; workspaceRoot: string }) => ({
          argv: ['/fixture/sandbox', policy.mode, policy.workspaceRoot, '--', ...argv], enforcement: 'full',
        }) })
        // Loader/configuration test only. No native child-provider or model claim.
        ctx.provide('subagents', { getProvider: () => ({}) } as unknown as Context['subagents'])
      } })
      await root.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: f.root })
      return root
    })
    try {
      await bootManagedHarnessProfile({ ...f.options, executionDomain: {
        nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)),
        lookupCwd: f.root, prepare: request => ({ argv: request.argv[0] === '/fixture/sandbox' ? [...request.argv.slice(4)] : [...request.argv],
          cwd: request.cwd, env: request.env }),
      } })
      expect(owned.unwrapExports({ default: NativeWorkflow })).not.toBe(NativeWorkflow)
      expect(untouched.unwrapExports({ default: NativeWorkflow })).toBe(NativeWorkflow)
      expect(Loader.prototype.unwrapExports).toBe(original)
      const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
      const mcp = native('@deepseek-ai/dsh-mcp-client')
      const selectedMcp = owned.unwrapExports(mcp) as typeof mcp
      expect(selectedMcp).not.toBe(mcp); expect(selectedMcp.Config).toBe(mcp.Config)
      expect(selectedMcp.inject).toBe(mcp.inject); expect(selectedMcp.name).toBe(mcp.name)
      expect(owned.unwrapExports({ default: mcp })).toBe(selectedMcp)
      expect(untouched.unwrapExports(mcp)).toBe(mcp)
      const NativeTools = native('@deepseek-ai/dsh-tools').ToolRuntime
      expect(owned.unwrapExports(NativeTools)).not.toBe(NativeTools)
      expect(owned.unwrapExports({ default: NativeTools })).toBe(owned.unwrapExports(NativeTools))
      expect(untouched.unwrapExports(NativeTools)).toBe(NativeTools)
      const pickerClass = owned.unwrapExports({ default: NativeBrowseDirectoryPicker })
      expect(pickerClass).not.toBe(NativeBrowseDirectoryPicker)
      expect(untouched.unwrapExports({ default: NativeBrowseDirectoryPicker })).toBe(NativeBrowseDirectoryPicker)
      const pickerId = await root.loader.create({ name: '@deepseek-ai/dsh-host-directory-picker-browse' })
      await root.loader.await()
      expect(root.loader.resolve(pickerId).options.name).toBe('@deepseek-ai/dsh-host-directory-picker-browse')
      expect(Reflect.get(root.directoryPicker, symbols.original)).toBeInstanceOf(pickerClass)
      const capability = root.directoryPicker.capability()
      expect(capability.kind).toBe('browse')
      if (capability.kind === 'browse') await expect(capability.list('/')).rejects.toMatchObject({ code: 'directory-unreadable' })
      await root.loader.update(pickerId, { disabled: true })
      if (capability.kind === 'browse') await expect(capability.list()).rejects.toThrow('已停止')
      const unrelated = { apply: () => {} }; expect(owned.unwrapExports({ default: unrelated })).toBe(unrelated)
      const selected = owned.unwrapExports({ default: NativeWorkflow })
      expect(owned.unwrapExports({ default: { __esModule: true, default: NativeWorkflow } })).toBe(selected)
      const disabled = await root.loader.create({ name: '@deepseek-ai/dsh-workflow-worker-thread', disabled: true })
      await root.loader.await()
      expect(root.loader.resolve(disabled).fiber).toBeUndefined()
      expect(root.get('workflowEngine')).toBeUndefined()
      const engines: Context['workflowEngine'][] = []
      for (const [member, limit] of [['Hansen', 2], ['Alex', 3]] as const) {
        const group = await root.loader.create({ name: 'cordis:group', group: true,
          isolate: { workflowEngine: true }, config: [] })
        const id = await root.loader.create({ name: '@deepseek-ai/dsh-workflow-worker-thread',
          config: { provider: 'spawn', maxTotalAgents: limit, disposeGraceMs: 100 } }, group)
        await root.loader.await()
        const entry = root.loader.resolve(id)
        expect(entry.options.name).toBe('@deepseek-ai/dsh-workflow-worker-thread')
        expect(entry.fiber!.runtime.callback).toBe(selected)
        const engine = entry.ctx.get('workflowEngine')!
        engines.push(engine)
        expect(Reflect.get(engine, symbols.original)).toBeInstanceOf(selected)
        const parent = { id: member } as Agent
        const request = { parent, meta: { name: 'review', description: 'Review', phases: [{ title: 'Review' }] }, script: 'return args', args: member }
        expect(() => engine.start({ ...request, maxTotalAgents: limit + 1 })).toThrow('engine ceiling')
        const run = engine.start(request)
        try { expect((await run.result).value).toBe(member) } finally { await run.dispose() }
        await root.loader.update(id, { disabled: true })
        expect(() => engine.start(request)).toThrow('withdrawn')
        expect(entry.ctx.get('workflowEngine')).toBeUndefined()
        await root.loader.update(id, { disabled: false }); await root.loader.await()
        expect(Reflect.get(entry.ctx.get('workflowEngine')!, symbols.original)).toBeInstanceOf(selected)
        expect(Reflect.get(entry.ctx.get('workflowEngine')!, symbols.original)).not.toBe(Reflect.get(engine, symbols.original))
      }
      expect(root.get('workflowEngine')).toBeUndefined()
      expect(Reflect.get(engines[0]!, symbols.original)).not.toBe(Reflect.get(engines[1]!, symbols.original))
      const retained = owned.unwrapExports
      await root.fiber.dispose()
      expect(owned.unwrapExports).toBe(original)
      expect(() => retained({ default: NativeWorkflow })).toThrow('withdrawn')
      expect(untouched.unwrapExports).toBe(original)
    } finally { await root.fiber.dispose(); await separate.fiber.dispose() }
  })
})
