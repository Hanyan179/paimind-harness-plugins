import { describe, expect, it } from 'vitest'
import { createHarnessModelRead, decodeHarnessModelRead } from '../src/gateway-transport.js'
const reply = (value: unknown, rpcId = 'models') => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } })
const settings = (provider = 'deepseek-official', extra = {}) => ({ namespaces: [
  { ns: 'agent-default-model', value: { provider, model: 'deepseek-v4-flash', reasoningEffort: 'off', secret: 'DO_NOT_RETURN' }, ...extra },
  { ns: 'llm-deepseek', value: {}, base: { apiKey: 'DO_NOT_RETURN' } },
  { ns: 'llm-pi-ai', value: { providers: { named: { apiKeyEnv: 'NAMED_API_KEY' }, record: {} } } },
] })
describe('safe original model state projection, not configuration ownership', () => {
  it('encodes only four readonly operations with at most one named credential reference', () => {
    for (const [kind, method] of Object.entries({ settings: 'settings.describe', providers: 'llm.providers', catalog: 'llm.models', credentials: 'credentials.describe' })) {
      const refs = kind === 'credentials' ? ['DEEPSEEK_API_KEY'] : []
      const wire = createHarnessModelRead(kind as never, 'models', refs)
      expect(wire.path).toBe('/api/' + method)
      expect(JSON.parse(wire.body)).toEqual({ type: 'client-request', rpcId: 'models', method, payload: refs.length ? { refs } : {} })
    }
    for (const kind of ['set', 'settings.replace', 'toString', '__proto__']) expect(() => createHarnessModelRead(kind as never, 'models')).toThrow()
    expect(() => createHarnessModelRead('credentials', 'models', [])).toThrow()
    expect(() => createHarnessModelRead('credentials', 'models', ['A', 'B'])).toThrow()
    expect(() => createHarnessModelRead('providers', 'models', ['A'])).toThrow()
  })
  it('projects the original default route while stripping raw settings and authentication material', () => {
    const result = decodeHarnessModelRead(reply(settings()), 'models', 'settings')
    expect(result).toEqual({ selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'off' }, credentialRef: 'DEEPSEEK_API_KEY' })
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN')
    expect(decodeHarnessModelRead(reply(settings('named')), 'models', 'settings').credentialRef).toBe('NAMED_API_KEY')
    expect(decodeHarnessModelRead(reply(settings('record')), 'models', 'settings').credentialRef).toBeNull()
    expect(decodeHarnessModelRead(reply(settings('unknown')), 'models', 'settings').credentialRef).toBeNull()
    expect(decodeHarnessModelRead(reply({ namespaces: [] }), 'models', 'settings').selection).toBeNull()
  })
  it('returns credential presence only and rejects wrong, missing or extra references', () => {
    const info = { configured: true, source: 'DO_NOT_RETURN', value: 'DO_NOT_RETURN', writable: true }
    expect(decodeHarnessModelRead(reply({ credentials: { KEY: info } }), 'models', 'credentials', ['KEY'])).toEqual([{ ref: 'KEY', configured: true }])
    for (const credentials of [{}, { OTHER: info }, { KEY: info, OTHER: info }, { KEY: { configured: 'yes' } }]) {
      expect(() => decodeHarnessModelRead(reply({ credentials }), 'models', 'credentials', ['KEY'])).toThrow('Native model state unavailable')
    }
  })
  it('projects catalog and registration without endpoints, descriptions or raw failure details', () => {
    expect(decodeHarnessModelRead(reply({ providers: [{ provider: 'deepseek-official', displayName: 'DeepSeek', active: true, baseURL: 'DO_NOT_RETURN' }] }), 'models', 'providers'))
      .toEqual([{ provider: 'deepseek-official', name: 'DeepSeek', active: true }])
    const catalog = { groups: [{ id: 'good', name: 'Good', models: [{ id: 'm', name: 'Model', description: 'DO_NOT_RETURN' }] }], failures: [{ id: 'bad', name: 'Bad', message: 'DO_NOT_RETURN' }] }
    expect(decodeHarnessModelRead(reply(catalog), 'models', 'catalog')).toEqual({ groups: [{ provider: 'good', name: 'Good', models: [{ id: 'm', name: 'Model' }] }], failedProviders: ['bad'] })
  })
  it('rejects duplicates, wrong correlation, malformed values and protocol errors with a constant error', () => {
    const duplicate = settings(); duplicate.namespaces.push(duplicate.namespaces[0]!)
    const failure = JSON.stringify({ type: 'server-response', rpcId: 'models', result: { ok: false, error: { code: 'internal', message: 'DO_NOT_RETURN', details: {} } } })
    for (const wire of [reply(duplicate), reply(settings(), 'wrong'), reply({ namespaces: [{ ns: 'agent-default-model', value: {} }] }), failure, 'DO_NOT_RETURN']) {
      expect(() => decodeHarnessModelRead(wire, 'models', 'settings')).toThrow('Native model state unavailable')
    }
    expect(() => decodeHarnessModelRead(reply({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }, { id: 'm', name: 'M' }] }], failures: [] }), 'models', 'catalog')).toThrow()
  })
})
