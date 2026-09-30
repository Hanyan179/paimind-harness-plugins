/** Versioned 0.17.1 presentation reads. This is neither a settings owner nor
 * permission to create a terminal, update preferences or execute a URL. */
export interface PaimindSidebarPresentationRead {
  readonly kind: 'shell' | 'preferences'
  projectResponse(body: Uint8Array): Uint8Array
}
const fail = (): never => { throw Error('Unsupported sidebar presentation carrier') }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : fail()
const keys = (value: Record<string, unknown>, expected: string[]) => {
  if (Object.keys(value).sort().join(',') !== expected.toSorted().join(',')) fail()
}
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : fail()
const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value)
  && value >= min && value <= max ? value : fail()
const boolean = (value: unknown) => typeof value === 'boolean' ? value : fail()
const booleans = new Set(['openByDefault', 'autoOpenSubagent', 'autoOpenJobs', 'agentTerminalTools', 'agentOpenTools',
  'bottomPanelAutoTerminal', 'interceptOpenPath', 'editorExplorer', 'titleBarCompat', 'browserInterceptLinks', 'browserInterceptHttp', 'browserInterceptHttps'])
const ranges: Record<string, readonly [number, number]> = { defaultWidthPercent: [20, 60], terminalFontSize: [9, 32], titleBarStripPx: [0, 120] }
const strings: Record<string, number> = { terminalFontFamily: 512, terminalShell: 4096, titleBarPresetId: 200, customCss: 64 * 1024 }
const falseOnly = new Set(['htmlViewerNoSandbox', 'htmlViewerDefaultUnsafe', 'browserNoSandbox'])
function presentation(value: unknown): Record<string, unknown> {
  const source = record(value), result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (booleans.has(key)) result[key] = boolean(item)
    else if (Object.hasOwn(ranges, key)) result[key] = integer(item, ...ranges[key]!)
    else if (Object.hasOwn(strings, key)) result[key] = text(item, strings[key]!)
    else if (falseOnly.has(key)) {
      // Do not silently switch off an actual unsafe native setting and claim
      // equality; reject the unsupported member composition instead.
      if (item !== false) fail()
      result[key] = item
    } else if (key === 'browserAllowedLoopback') {
      if (item !== '') fail()
      result[key] = item
    } else if (key === 'titleBarScheme') {
      if (typeof item !== 'string' || !['auto', 'web', 'preset', 'custom'].includes(item)) fail()
      result[key] = item
    } else if (key === 'tabsEnabled' || key === 'viewersEnabled') {
      const map = record(item)
      if (Object.keys(map).length > 256) fail()
      const entries = Object.entries(map).map(([id, enabled]) => {
        if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/u.test(id)) fail()
        return [id, boolean(enabled)] as const
      })
      result[key] = Object.fromEntries(entries)
    }
    // terminalShellArgs and open-ended pluginSettings are not presentation
    // contracts; unknown provider fields are not accidentally disclosed.
  }
  return result
}

/** Exact empty plain-JSON requests. The gateway must route to the currently
 * admitted cell and reauthorize before releasing this read-only projection. */
export function preparePaimindSidebarPresentationRead(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): PaimindSidebarPresentationRead | undefined {
  const path = new URL(target, 'http://sidebar.invalid').pathname
  const kind = path === '/sidebar/api/shell.get' ? 'shell' : path === '/sidebar/api/settings.get' ? 'preferences' : undefined
  if (kind === undefined) return undefined
  if (target !== path || method !== 'POST' || contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
    || !body.byteLength || body.byteLength > 4096) fail()
  keys(record(decode(body)), [])
  return Object.freeze({ kind, projectResponse(bytes: Uint8Array): Uint8Array {
    if (!bytes.byteLength || bytes.byteLength > 256 * 1024) fail()
    const response = record(decode(bytes)); keys(response, ['ok', 'value'])
    if (response.ok !== true) fail()
    const view = record(response.value)
    let projected: Record<string, unknown>
    if (kind === 'shell') {
      keys(view, ['shell', 'name'])
      projected = { shell: text(view.shell, 4096), name: text(view.name, 200) }
    } else {
      // The original owner explicitly reports absence when its optional
      // settings service is not mounted. Do not invent a resolved document.
      const present = Object.hasOwn(view, 'value')
      keys(view, present ? ['value', 'revision', 'externalDisable'] : ['externalDisable'])
      projected = { ...(present ? { value: presentation(view.value), revision: integer(view.revision, 0, Number.MAX_SAFE_INTEGER) } : {}),
        externalDisable: boolean(view.externalDisable) }
    }
    return Buffer.from(JSON.stringify({ ok: true, value: projected }))
  } })
}
