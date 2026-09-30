import { describe, expect, it } from 'vitest'
import { createHarnessModelConfigurationRead, decodeHarnessModelConfiguration, decodeHarnessModelCredentialState,
  prepareHarnessModelSelectionChange, prepareHarnessModelCredentialChange } from '../src/model-configuration.js'

const reply = (value: unknown, rpcId = 'model-change') => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } })
const error = (code: string, details: object, rpcId = 'model-change') => JSON.stringify({ type: 'server-response', rpcId,
  result: { ok: false, error: { code, details, message: 'SECRET_FROM_OWNER' } } })
const namespace = (extra = {}) => ({ ns: 'agent-default-model', schema: { secret: 'DO_NOT_RETURN' },
  value: { provider: 'deepseek-official', model: 'current-model', reasoningEffort: 'off', extraSecret: 'DO_NOT_RETURN' },
  base: { private: 'DO_NOT_RETURN' }, user: { private: 'DO_NOT_RETURN' }, secrets: [], applies: 'live', revision: 7, ...extra })
const settings = (extra = {}) => ({ writable: true, hasDocument: true, namespaces: [namespace(),
  { ns: 'llm-deepseek', schema: {}, value: { apiKeyEnv: 'MODEL_KEY', secret: 'DO_NOT_RETURN' }, revision: 0, secrets: [], applies: 'restart' }], ...extra })
const configuration = () => decodeHarnessModelConfiguration(reply(settings()), 'model-change')
const providers = [{ provider: 'deepseek-official', name: 'DeepSeek', active: true }]
const catalog = { groups: [{ provider: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'chosen-model', name: 'Chosen' }] }], failedProviders: [] }
const desired = { provider: 'deepseek-official', model: 'chosen-model', reasoningEffort: 'off' }
const prepared = () => prepareHarnessModelSelectionChange(configuration(), providers, catalog, desired, 'model-change')

describe('original model configuration protocol, no transport or permission grant', () => {
  it('reads native revisions and write support without exposing settings layers or credentials', () => {
    expect(createHarnessModelConfigurationRead('model-change')).toEqual({ path: '/api/settings.describe',
      body: JSON.stringify({ type: 'client-request', rpcId: 'model-change', method: 'settings.describe', payload: {} }) })
    expect(configuration()).toEqual({ selection: { provider: 'deepseek-official', model: 'current-model', reasoningEffort: 'off' },
      credentialRef: 'MODEL_KEY', writable: true, revision: 7, applies: 'live' })
    expect(JSON.stringify(configuration())).not.toContain('DO_NOT_RETURN')
    expect(decodeHarnessModelConfiguration(reply(settings({ namespaces: [] })), 'model-change')).toEqual({
      selection: null, credentialRef: null, writable: false, revision: null, applies: null })
  })
  it.each([-1, 1.1, Number.MAX_SAFE_INTEGER, '7', null, undefined])('rejects unusable owner revision %s', revision => {
    expect(() => decodeHarnessModelConfiguration(reply(settings({ namespaces: [namespace({ revision })] })), 'model-change')).toThrow('Native model configuration unavailable')
  })
  it('rejects duplicate namespaces, malformed owner metadata and wrong correlation', () => {
    for (const wire of [reply(settings(), 'wrong'), reply(settings({ namespaces: [namespace(), namespace()] })),
      reply(settings({ writable: 'yes' })), reply(settings({ namespaces: [namespace({ applies: 'sometimes' })] })),
      error('internal', {}), 'invalid', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      expect(() => decodeHarnessModelConfiguration(wire, 'model-change')).toThrow('Native model configuration unavailable')
    }
  })
  it('prepares only the exact native namespace and retains mandatory compare-and-swap revision', () => {
    const change = prepared()
    expect(change.path).toBe('/api/settings.update')
    expect(JSON.parse(change.body)).toEqual({ type: 'client-request', rpcId: 'model-change', method: 'settings.update',
      payload: { ns: 'agent-default-model', patch: desired, expectedRevision: 7 } })
    const omitted = prepareHarnessModelSelectionChange(configuration(), providers, catalog,
      { provider: desired.provider, model: desired.model }, 'model-change')
    expect(JSON.parse(omitted.body).payload.patch).not.toHaveProperty('reasoningEffort')
  })
  it('refuses unavailable providers, undiscovered models, owner write denial and unknown input fields', () => {
    expect(() => prepareHarnessModelSelectionChange({ ...configuration(), writable: false }, providers, catalog, desired, 'x')).toThrow()
    expect(() => prepareHarnessModelSelectionChange({ ...configuration(), revision: null }, providers, catalog, desired, 'x')).toThrow()
    expect(() => prepareHarnessModelSelectionChange(configuration(), [{ ...providers[0]!, active: false }], catalog, desired, 'x')).toThrow()
    expect(() => prepareHarnessModelSelectionChange(configuration(), providers, { ...catalog, failedProviders: [desired.provider] }, desired, 'x')).toThrow()
    for (const input of [{ ...desired, model: 'unknown' }, { ...desired, provider: 'unknown' }, { ...desired, ns: 'platform' },
      { ...desired, apiKey: 'DO_NOT_RETURN' }, { ...desired, reasoningEffort: '\n' }, { ...desired, model: '' }]) {
      expect(() => prepareHarnessModelSelectionChange(configuration(), providers, catalog, input, 'x')).toThrow('Native model configuration unavailable')
    }
  })
  it('confirms the exact selected model and strips owner-only metadata', () => {
    expect(prepared().decode(reply(namespace({ value: { ...desired, private: 'DO_NOT_RETURN' }, revision: 8 })))).toEqual({
      status: 'applied', value: { ...desired, revision: 8, applies: 'live' } })
  })
  it('never turns malformed, mismatched or uncertain native results into successful writes', () => {
    for (const wire of [reply(namespace(), 'wrong'), reply(namespace()), reply(namespace({ ns: 'other', value: desired })),
      reply(namespace({ value: desired, revision: 6 })), reply(namespace({ value: { ...desired, reasoningEffort: 'other' } })),
      error('internal', {}), error('settings-conflict', { ns: 'other', expected: 7, actual: 8 }), 'bad JSON']) {
      const result = prepared().decode(wire)
      expect(result).toEqual({ status: 'unconfirmed' }); expect(JSON.stringify(result)).not.toContain('SECRET')
    }
    expect(prepared().decode(error('settings-conflict', { ns: 'agent-default-model', expected: 7, actual: 8 }))).toEqual({ status: 'conflict' })
    expect(prepared().decode(error('settings-rejected', { ns: 'agent-default-model' }))).toEqual({ status: 'unconfirmed' })
  })
})

describe('write-only native credential protocol', () => {
  const state = { ref: 'MODEL_KEY', configured: false, writable: true }
  it('projects presence and writability for exactly one native reference, not source or value', () => {
    expect(decodeHarnessModelCredentialState(reply({ credentials: { MODEL_KEY: { configured: true, writable: true,
      value: 'DO_NOT_RETURN', source: 'DO_NOT_RETURN' } } }), 'model-change', 'MODEL_KEY')).toEqual({ ...state, configured: true })
    for (const credentials of [{}, { OTHER: state }, { MODEL_KEY: state, OTHER: state }, { MODEL_KEY: { configured: true } }]) {
      expect(() => decodeHarnessModelCredentialState(reply({ credentials }), 'model-change', 'MODEL_KEY')).toThrow('Native model configuration unavailable')
    }
  })
  it.each(['set', 'unset'] as const)('prepares %s only for the owner-selected named credential', action => {
    const input = action === 'set' ? { action, value: 'synthetic-no-external-use' } : { action }
    const change = prepareHarnessModelCredentialChange(configuration(), state, input, 'model-change')
    expect(change.path).toBe('/api/credentials.' + action)
    expect(JSON.parse(change.body)).toEqual({ type: 'client-request', rpcId: 'model-change', method: 'credentials.' + action,
      payload: { ref: 'MODEL_KEY', ...(action === 'set' ? { value: 'synthetic-no-external-use' } : {}) } })
    expect(change.decode(reply({}))).toEqual({ status: 'applied', value: { ref: 'MODEL_KEY' } })
    expect(change.decode(error('credential-rejected', { ref: 'MODEL_KEY' }))).toEqual({ status: 'unconfirmed' })
    for (const wire of [reply({ value: 'DO_NOT_RETURN' }), reply({}, 'wrong'), error('internal', {}),
      error('credential-rejected', { ref: 'OTHER' }), 'bad']) expect(change.decode(wire)).toEqual({ status: 'unconfirmed' })
  })
  it('denies arbitrary references, OAuth replacement, readonly credentials and hidden extra fields', () => {
    for (const [config, credential] of [[{ ...configuration(), credentialRef: null }, state], [configuration(), { ...state, ref: 'OTHER' }],
      [configuration(), { ...state, writable: false }]] as const) {
      expect(() => prepareHarnessModelCredentialChange(config, credential, { action: 'set', value: 'synthetic' }, 'x')).toThrow()
    }
    for (const input of [{ action: 'set', value: '' }, { action: 'set', value: 'x'.repeat(16385) }, { action: 'set', value: 'x\ny' },
      { action: 'set', value: 'synthetic', ref: 'OTHER' }, { action: 'unset', value: 'unexpected' }, { action: 'get' }]) {
      expect(() => prepareHarnessModelCredentialChange(configuration(), state, input as never, 'x')).toThrow('Native model configuration unavailable')
    }
  })
})
