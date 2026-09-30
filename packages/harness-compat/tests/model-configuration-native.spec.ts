// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHarnessModelRead } from '../src/model-inspection.js'
import { createHarnessModelConfigurationRead, decodeHarnessModelConfiguration, decodeHarnessModelCredentialState,
  prepareHarnessModelSelectionChange, prepareHarnessModelCredentialChange } from '../src/model-configuration.js'

const local = createRequire(import.meta.url)
const base = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-base/package.json'))
const web = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = base('@deepseek-ai/cordis'), z = base('@deepseek-ai/schemastery')
const { FileSettingsProvider } = base('@deepseek-ai/dsh-settings-file')
const { LocalCredentialProvider } = base('@deepseek-ai/dsh-credentials-local')
const { AgentDefaultModelConfig } = base('@deepseek-ai/dsh-agent-default-model')
const { settingsNamespace } = base('@deepseek-ai/dsh-settings')
const { DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot } = base('@deepseek-ai/dsh-launch-environment')
const { createApiProxy, toFetchHandler } = web('@deepseek-ai/dsh-host-apiproxy')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

// Real selected-version settings/credential/default-model owners and fetch
// carrier. Explicit synthetic provider/catalog metadata; no model request,
// enterprise authentication, final container, PostgreSQL or browser claim.
const providers = [{ provider: 'deepseek-official', name: 'Synthetic directory', active: true }]
const catalog = { groups: [{ provider: 'deepseek-official', name: 'Synthetic directory',
  models: [{ id: 'diagnostic-first', name: 'First' }, { id: 'diagnostic-second', name: 'Second' }] }], failedProviders: [] }
async function home() { return mkdtemp(join(process.env.PAIMIND_HAAS_PROTOCOL_EVIDENCE ?? tmpdir(), 'model-owner-')) }
async function boot(directory: string) {
  const root = new Context()
  let closed = false
  const close = async () => { if (!closed) { closed = true; await root.fiber.dispose() } }
  cleanups.push(close)
  // Explicit empty launch environment prevents accidental use of real keys,
  // the current checkout's .env, or the user's main Harness home.
  root.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
  await root.plugin(FileSettingsProvider, { path: join(directory, 'settings.json'), dshHome: directory, watch: false })
  await root.plugin(LocalCredentialProvider, { path: join(directory, 'credentials.yaml'), dshHome: directory, watch: false })
  await root.plugin(AgentDefaultModelConfig, { provider: 'deepseek-official', model: 'diagnostic-first' })
  root.settings.register(settingsNamespace('llm-deepseek'), z.object({ apiKeyEnv: z.string().default('DIAGNOSTIC_MODEL_KEY') }))
  root.settings.register(settingsNamespace('unrelated-diagnostic'), z.object({ retained: z.string().default('original') }))
  root.provide('userQuestions', { registerProvider: () => () => {} })
  const carrier = toFetchHandler(createApiProxy(root, { defaultModelSelection: () => root.agentDefaultModel.currentSelection(), cwd: directory }))
  const call = async (wire: { path: string; body: string }) => {
    const result = await carrier.fetch(new Request('http://native.invalid' + wire.path, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: wire.body }))
    expect(result.status).toBe(200)
    return result.text()
  }
  const snapshot = async () => decodeHarnessModelConfiguration(await call(createHarnessModelConfigurationRead('read')), 'read')
  const credential = async () => decodeHarnessModelCredentialState(await call(createHarnessModelRead('credentials', 'credential-read', ['DIAGNOSTIC_MODEL_KEY'])),
    'credential-read', 'DIAGNOSTIC_MODEL_KEY')
  return { root, call, snapshot, credential, close }
}

describe('selected native owners on fresh isolated files', () => {
  it('persists the default model through the original carrier, preserves unrelated state and restores on cold boot', async () => {
    const directory = await home(), first = await boot(directory)
    await first.root.settings.update(settingsNamespace('unrelated-diagnostic'), { retained: 'keep me' })
    const before = await first.snapshot(), desired = { provider: 'deepseek-official', model: 'diagnostic-second', reasoningEffort: 'off' }
    const change = prepareHarnessModelSelectionChange(before, providers, catalog, desired, 'change')
    const result = change.decode(await first.call(change))
    expect(result.status).toBe('applied')
    expect(first.root.agentDefaultModel.currentSelection()).toEqual(desired)
    expect((await first.snapshot()).revision).toBeGreaterThan(before.revision!)
    const stored = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))
    expect(stored['unrelated-diagnostic']).toEqual({ retained: 'keep me' })
    expect(stored['agent-default-model']).toEqual(desired)
    await first.close()
    const recovered = await boot(directory)
    expect(recovered.root.agentDefaultModel.currentSelection()).toEqual(desired)
    expect(recovered.root.settings.get(settingsNamespace('unrelated-diagnostic'))).toEqual({ retained: 'keep me' })
    // Native revisions are process-local. Control-plane preconditions MUST also
    // pin the cell incarnation; a numeric settings revision alone is unsafe.
    expect((await recovered.snapshot()).revision).toBe(0)
  })
  it('serializes competing original-owner writes and rejects the stale patch without overwriting the winner', async () => {
    const f = await boot(await home()), before = await f.snapshot()
    const a = prepareHarnessModelSelectionChange(before, providers, catalog, { provider: 'deepseek-official', model: 'diagnostic-second' }, 'a')
    const b = prepareHarnessModelSelectionChange(before, providers, catalog, { provider: 'deepseek-official', model: 'diagnostic-first' }, 'b')
    const results = await Promise.all([f.call(a).then(a.decode), f.call(b).then(b.decode)])
    expect(results.map(row => row.status)).toEqual(['applied', 'conflict'])
    expect(f.root.agentDefaultModel.currentSelection().model).toBe('diagnostic-second')
  })
  it('sets and removes a synthetic credential through the real write-only owner and survives restart', async () => {
    const directory = await home(), first = await boot(directory)
    expect(await first.credential()).toMatchObject({ configured: false, writable: true })
    const change = prepareHarnessModelCredentialChange(await first.snapshot(), await first.credential(),
      { action: 'set', value: 'synthetic-local-only-never-a-real-key' }, 'credential-change')
    const result = change.decode(await first.call(change))
    expect(result).toEqual({ status: 'applied', value: { ref: 'DIAGNOSTIC_MODEL_KEY' } })
    expect(JSON.stringify(result)).not.toContain('synthetic-local-only')
    expect(await first.credential()).toMatchObject({ configured: true, writable: true })
    await first.close()
    const recovered = await boot(directory)
    expect(await recovered.credential()).toMatchObject({ configured: true })
    const unset = prepareHarnessModelCredentialChange(await recovered.snapshot(), await recovered.credential(), { action: 'unset' }, 'remove')
    expect(unset.decode(await recovered.call(unset)).status).toBe('applied')
    expect(await recovered.credential()).toMatchObject({ configured: false })
  })
  it('keeps a native storage error unconfirmed even when bytes reached the original store', async () => {
    const directory = await home(), f = await boot(directory), original = f.root.settings.persist.bind(f.root.settings)
    vi.spyOn(f.root.settings, 'persist').mockImplementation(async (...args) => {
      await original(...args)
      throw Error('Injected failure after original persistence; private storage detail')
    })
    const change = prepareHarnessModelSelectionChange(await f.snapshot(), providers, catalog,
      { provider: 'deepseek-official', model: 'diagnostic-second' }, 'ambiguous')
    expect(change.decode(await f.call(change))).toEqual({ status: 'unconfirmed' })
    const stored = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))
    expect(stored['agent-default-model'].model).toBe('diagnostic-second')
  })
  it('does not interpret a credential refusal after persistence as proof that nothing changed', async () => {
    const f = await boot(await home()), original = f.root.credentials.set.bind(f.root.credentials)
    vi.spyOn(f.root.credentials, 'set').mockImplementation(async (...args) => {
      await original(...args)
      throw Error('Injected failure after original credential save; private detail')
    })
    const change = prepareHarnessModelCredentialChange(await f.snapshot(), await f.credential(),
      { action: 'set', value: 'synthetic-ambiguous-never-a-real-key' }, 'ambiguous-credential')
    expect(change.decode(await f.call(change))).toEqual({ status: 'unconfirmed' })
    expect(await f.credential()).toMatchObject({ configured: true })
  })
})
