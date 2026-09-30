import { describe, expect, it } from 'vitest'
import { preparePaimindSidebarPresentationRead } from '../src/presentation.js'
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const prepare = (kind = 'settings', input: unknown = {}) => preparePaimindSidebarPresentationRead('POST', `/sidebar/api/${kind}.get`, 'application/json', bytes(input))!
const project = (value: unknown, kind = 'settings') => JSON.parse(Buffer.from(prepare(kind).projectResponse(bytes({ ok: true, value }))).toString())
describe('original sidebar presentation only, not configuration or execution authority', () => {
  it('preserves actual shell metadata and explicit absent settings without inventing defaults', () => {
    expect(project({ shell: '/bin/bash', name: 'bash' }, 'shell')).toEqual({ ok: true, value: { shell: '/bin/bash', name: 'bash' } })
    expect(project({ externalDisable: false })).toEqual({ ok: true, value: { externalDisable: false } })
  })
  it('retains actual layout/style and feature switches while omitting non-presentation and unknown fields', () => {
    const value = { openByDefault: true, defaultWidthPercent: 42, autoOpenJobs: false, terminalFontFamily: 'monospace', terminalFontSize: 16,
      terminalShell: '/bin/bash', titleBarScheme: 'custom', titleBarPresetId: 'original', customCss: '.sidebar { color: inherit; }',
      titleBarCompat: true, titleBarStripPx: 32, htmlViewerNoSandbox: false, htmlViewerDefaultUnsafe: false,
      browserNoSandbox: false, browserAllowedLoopback: '', tabsEnabled: { explorer: true, terminal: false }, viewersEnabled: { html: false } }
    expect(project({ value: { ...value, pluginSettings: { editor: { apiKey: 'PRIVATE' } }, terminalShellArgs: '--token PRIVATE', futureSecret: 'PRIVATE' }, revision: 7, externalDisable: true }))
      .toEqual({ ok: true, value: { value, revision: 7, externalDisable: true } })
  })
  it.each(['settings', 'shell'])('rejects authority selectors and noncanonical %s request carriers', kind => {
    for (const input of [[], null, { userId: 'alex' }, { sessionId: 'foreign' }, { cwd: '/etc' }, { patch: {} }, { role: 'admin' }]) expect(() => prepare(kind, input)).toThrow()
    const path = `/sidebar/api/${kind}.get`
    for (const target of [path + '?x=1', 'http://sidebar.invalid' + path]) expect(() => preparePaimindSidebarPresentationRead('POST', target, 'application/json', bytes({}))).toThrow()
    for (const [method, mime, body] of [['GET', 'application/json', bytes({})], ['POST', 'text/plain', bytes({})], ['POST', 'application/json', new Uint8Array([255])],
      ['POST', 'application/json', Buffer.from(' '.repeat(4097))]] as const) expect(() => preparePaimindSidebarPresentationRead(method, path, mime, body)).toThrow()
    expect(preparePaimindSidebarPresentationRead('POST', '/sidebar/api/settings.update', 'application/json', bytes({}))).toBeUndefined()
    expect(preparePaimindSidebarPresentationRead('POST', '/sidebar/api/%73ettings.get', 'application/json', bytes({}))).toBeUndefined()
  })
  it.each([
    { defaultWidthPercent: 100 }, { defaultWidthPercent: 42.1 }, { openByDefault: 'yes' }, { terminalFontSize: 8 },
    { terminalShell: '\0' }, { titleBarScheme: ['custom'] }, { titleBarStripPx: -1 }, { tabsEnabled: { editor: 'yes' } },
    { tabsEnabled: { '': true } }, { viewersEnabled: [] }, { customCss: 'x'.repeat(65537) },
    { htmlViewerNoSandbox: true }, { htmlViewerDefaultUnsafe: true }, { browserNoSandbox: true }, { browserAllowedLoopback: '127.0.0.1' },
  ])('fails closed rather than falsifying unsupported resolved values %j', value => {
    expect(() => project({ value, revision: 1, externalDisable: false })).toThrow()
  })
  it('does not turn provider failures, missing revisions, extra envelopes or oversize responses into success', () => {
    for (const input of [{ ok: false, error: { message: 'private path' } }, { ok: true, value: { value: {}, externalDisable: false } },
      { ok: true, value: { value: {}, revision: -1, externalDisable: false } }, { ok: true, value: { externalDisable: false }, private: 1 },
      { ok: true, value: { externalDisable: 'no' } }, { ok: true, value: { externalDisable: false, future: true } }]) {
      expect(() => prepare().projectResponse(bytes(input))).toThrow()
    }
    expect(() => prepare().projectResponse(Buffer.from(' '.repeat(256 * 1024 + 1)))).toThrow()
    expect(() => project({ shell: '/bin/sh', name: 'sh', args: ['SECRET'] }, 'shell')).toThrow()
  })
})
