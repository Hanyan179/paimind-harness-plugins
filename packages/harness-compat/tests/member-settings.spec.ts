// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareHarnessMemberSettingsRead } from '../src/member-settings.js'

const wire = (payload: object = {}) => Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'display-read', method: 'settings.describe', payload }))
async function nativeRows() {
  const rows: any[] = []
  for (const name of ['dsh-client-locale', 'dsh-client-ui-theme']) {
    const candidates = readdirSync('node_modules/.pnpm').filter(row => row.startsWith(`@deepseek-ai+${name}@0.1.1-rc.2_`))
    expect(candidates).toHaveLength(1)
    const module = await import(pathToFileURL(resolve('node_modules/.pnpm', candidates[0]!, 'node_modules/@deepseek-ai', name, 'lib/index.js')).href)
    // Execute the actual installed registration: numeric schema IDs must not
    // be invented or assumed stable across native package loading order.
    module.apply({ inject: (_deps: unknown, install: (ctx: unknown) => void) => install({ settings: {
      register: (ns: string, schema: { toJSON(): unknown }) => rows.push({ ns, schema: schema.toJSON(),
        value: { preference: ns === 'locale' ? 'zh' : 'dark' }, applies: 'live', secrets: [], revision: 17,
        base: { hidden: 'DO_NOT_EXPOSE_BASE' }, user: { hidden: 'DO_NOT_EXPOSE_USER' } }),
    } }), on: () => () => {} })
  }
  return rows
}
const reply = (namespaces: unknown[]) => ({ type: 'server-response', rpcId: 'display-read', result: {
  ok: true, value: { writable: true, hasDocument: true, namespaces },
} })
const project = (value: unknown) => JSON.parse(Buffer.from(prepareHarnessMemberSettingsRead('POST', '/api/settings.describe',
  'application/json', wire())!.projectResponse(Buffer.from(JSON.stringify(value)))).toString())

describe('native member display projection, not a settings owner or role grant', () => {
  it('consumes actual published schemas and only returns current two-namespace values', async () => {
    const rows = await nativeRows()
    rows.push({ ns: 'llm-secret', schema: { private: 'MODEL_SCHEMA' }, value: { token: 'MODEL_SECRET' },
      base: { token: 'BASE_SECRET' }, user: { token: 'USER_SECRET' }, secrets: [{ path: ['token'], set: true }], applies: 'restart', revision: 0 })
    const result = project(reply(rows))
    expect(result.result.value).toMatchObject({ writable: false, hasDocument: false })
    expect(result.result.value.namespaces.map((r: any) => r.ns)).toEqual(['locale', 'ui-theme'])
    expect(result.result.value.namespaces[0]).toEqual({ ns: 'locale', schema: rows[0].schema, value: { preference: 'zh' }, applies: 'live', secrets: [], revision: 17 })
    expect(JSON.stringify(result)).not.toMatch(/SECRET|HIDDEN|DO_NOT_EXPOSE|llm-secret|MODEL_SCHEMA/)
    expect(reply(rows).result.value.writable).toBe(true)
  })
  it('keeps an actually absent namespace absent, not a synthetic registered default', () => {
    expect(project(reply([])).result.value.namespaces).toEqual([])
  })
  it('allows the native locale absence but not an invalid or missing effective theme', async () => {
    const rows = await nativeRows(); rows[0].value = {}
    expect(project(reply(rows)).result.value.namespaces[0].value).toEqual({})
    for (const value of [{}, { preference: 'custom-theme' }, { preference: 'dark', token: 'SECRET' }]) {
      rows[1].value = value; expect(() => project(reply(rows))).toThrow()
    }
  })
  it('refuses arbitrary schema metadata, orphan/cyclic graphs, extra fields and enum changes', async () => {
    const original = (await nativeRows())[0]
    for (const change of [
      (row: any) => { row.schema.secret = 'SECRET' },
      (row: any) => { row.schema.refs['999999'] = { value: 'SECRET' } },
      (row: any) => { row.schema.refs[row.schema.uid].meta.description = 'SECRET' },
      (row: any) => { row.schema.refs[row.schema.uid].dict.secret = 123 },
      (row: any) => { row.schema.refs[row.schema.uid].dict.preference = row.schema.uid },
      (row: any) => { Object.values<any>(row.schema.refs).find(r => r.type === 'const')!.value = 'SECRET' },
      (row: any) => { row.secrets = [{ path: ['preference'], set: true }] },
      (row: any) => { row.revision = -1 },
      (row: any) => { row.applies = 'restart' },
    ]) { const row = structuredClone(original); change(row); expect(() => project(reply([row]))).toThrow() }
    expect(() => project(reply([original, original]))).toThrow()
  })
  it('refuses mismatched correlations, source failures, invalid JSON and large responses', async () => {
    const value = reply(await nativeRows())
    expect(() => project({ ...value, rpcId: 'another-request' })).toThrow()
    expect(() => project({ ...value, result: { ok: false, error: { code: 'unexpected', message: 'SECRET' } } })).toThrow()
    const read = prepareHarnessMemberSettingsRead('POST', '/api/settings.describe', 'application/json', wire())!
    for (const bytes of [Buffer.from([0xff]), Buffer.from('no'), Buffer.alloc(2 * 1024 * 1024 + 1)]) expect(() => read.projectResponse(bytes)).toThrow()
  })
  it('accepts only the canonical no-argument published read, not an expanded settings permission', () => {
    for (const payload of [{ role: 'admin' }, { ns: 'llm-secret' }, { userId: 'another' }]) {
      expect(() => prepareHarnessMemberSettingsRead('POST', '/api/settings.describe', 'application/json', wire(payload))).toThrow()
    }
    for (const target of ['/api/settings.describe?x=1', '/api/settings.describe#x', 'http://native.invalid/api/settings.describe']) {
      expect(() => prepareHarnessMemberSettingsRead('POST', target, 'application/json', wire())).toThrow()
    }
    expect(prepareHarnessMemberSettingsRead('POST', '/api/session.list', 'application/json', wire())).toBeUndefined()
    expect(() => prepareHarnessMemberSettingsRead('GET', '/api/settings.describe', 'application/json', wire())).toThrow()
    expect(() => prepareHarnessMemberSettingsRead('POST', '/api/settings.describe', 'text/plain', wire())).toThrow()
  })
})
