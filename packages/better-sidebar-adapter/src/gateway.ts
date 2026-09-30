/** Exact 0.17.1 host-to-browser push seats, not the interactive terminal or
 * general sidebar API. Ownership and role authorization belong to the gateway. */
export const PAIMIND_SIDEBAR_DOWNLINK_PATHS = Object.freeze([
  '/sidebar/ws/agent-terminals', '/sidebar/ws/agent-opens',
] as const)

export function parsePaimindSidebarDownlink(method: string, target: string): Readonly<{ sessionId: string }> | undefined {
  if (method !== 'GET') return undefined
  try {
    const url = new URL(target, 'http://sidebar.invalid')
    if (url.origin !== 'http://sidebar.invalid' || url.hash
      || !PAIMIND_SIDEBAR_DOWNLINK_PATHS.some(path => path === url.pathname)) return undefined
    const keys = [...url.searchParams.keys()]
    const sessionId = url.searchParams.get('sessionId')
    if (keys.length !== 1 || keys[0] !== 'sessionId' || sessionId === null
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(sessionId)) return undefined
    if (target !== `${url.pathname}?${new URLSearchParams({ sessionId })}`) return undefined
    return Object.freeze({ sessionId })
  } catch { return undefined }
}

/** The published 0.17.1 file tree uses plain JSON, not Typert RPC. cwd and
 * repoRoot are display hints and are never sent to the directory reader. */
export function parsePaimindSidebarTreeRequest(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): Readonly<{ sessionId: string; path?: string }> | undefined {
  if (method !== 'POST' || target !== '/sidebar/api/fs.tree') return undefined
  if (contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || body.byteLength > 16 * 1024) throw Error('Invalid sidebar tree request')
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['sessionId', 'cwd', 'repoRoot', 'path'].includes(key))
    || typeof value.sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value.sessionId)
    || ['cwd', 'repoRoot', 'path'].some(key => value[key] !== undefined && (typeof value[key] !== 'string'
      || (value[key] as string).length > 4096 || (value[key] as string).includes('\0')))) throw Error('Invalid sidebar tree request')
  return Object.freeze({ sessionId: value.sessionId, ...(value.path === undefined ? {} : { path: value.path as string }) })
}

/** Native filesystem metadata -> original provider's display carrier only.
 * No absolute target keys, controller paths or authority travel to the UI. */
export function projectPaimindSidebarTree(value: unknown): Readonly<{ ok: true; value: {
  path: string; entries: readonly { name: string; path: string; isDir: boolean; hidden: boolean; isSymlink: boolean; broken: boolean }[]; truncated: boolean
} }> {
  const view = value as { path?: unknown; entries?: unknown; truncated?: unknown } | undefined
  if (!view || typeof view !== 'object' || Array.isArray(view) || Object.keys(view).sort().join(',') !== 'entries,path,truncated'
    || typeof view.path !== 'string' || !view.path.startsWith('/') || view.path.length > 4096
    || view.path.includes('\0') || view.path.split('/').some(part => part === '.' || part === '..')
    || typeof view.truncated !== 'boolean' || !Array.isArray(view.entries) || view.entries.length > 1000) throw Error('Invalid native directory view')
  const path = view.path, names = new Set<string>()
  const entries = view.entries.map((entry: unknown) => {
    const row = entry as Record<string, unknown> | undefined
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'name,path,symlink,type,unavailable'
      || typeof row.name !== 'string' || !row.name || row.name === '.' || row.name === '..' || row.name.includes('/') || row.name.includes('\0')
      || names.has(row.name) || row.path !== `${path}/${row.name}` || !['file', 'directory', 'other'].includes(row.type as string)
      || typeof row.symlink !== 'boolean' || typeof row.unavailable !== 'boolean') throw Error('Invalid native directory entry')
    names.add(row.name)
    return Object.freeze({ name: row.name, path: row.path as string, isDir: row.type === 'directory' && !row.unavailable,
      hidden: row.name.startsWith('.'), isSymlink: row.symlink, broken: row.unavailable })
  }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return Object.freeze({ ok: true, value: Object.freeze({ path, entries: Object.freeze(entries), truncated: view.truncated }) })
}

/** Original 0.17.1 editor preview carrier. Browser cwd/repoRoot are not roots. */
export function parsePaimindSidebarFileRequest(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): Readonly<{ sessionId: string; path: string }> | undefined {
  if (method !== 'POST' || target !== '/sidebar/api/fs.read') return undefined
  const selected = parsePaimindSidebarTreeRequest(method, '/sidebar/api/fs.tree', contentType, body)
  if (!selected || !selected.path || /[\u0000-\u001f\u007f]/u.test(selected.path)
    || selected.path.split('/').some(part => part === '.' || part === '..')) throw Error('Invalid sidebar file request')
  return Object.freeze({ sessionId: selected.sessionId, path: selected.path })
}

/** Match the original editor preview (512 KiB / 4 KiB binary header), never
 * promote file content to application HTML or claim a complete large file. */
export function projectPaimindSidebarFile(bytes: Uint8Array, size: number): Readonly<{ ok: true; value:
  { kind: 'text'; content: string; truncated: boolean } | { kind: 'binary'; size: number; head: string; truncated: boolean } }> {
  if (!Number.isSafeInteger(size) || size < 0 || bytes.byteLength !== Math.min(524288, size)) throw Error('Incomplete native file preview')
  const value = Buffer.from(bytes), truncated = size > bytes.byteLength
  return Object.freeze({ ok: true, value: value.includes(0)
    ? Object.freeze({ kind: 'binary', size, head: value.subarray(0, 4096).toString('base64'), truncated })
    : Object.freeze({ kind: 'text', content: value.toString('utf8'), truncated }) })
}

/** Original 0.17.1 media/download URL. This is selection, never authority.
 * Keep the provider's default 20 MiB resource ceiling; do not silently truncate
 * a download or allow caller cwd to broaden the original Session root. */
export function parsePaimindSidebarFileResource(method: string, target: string): Readonly<{
  sessionId: string; path: string; download: boolean; contentType: string; maximumBytes: number
}> | undefined {
  if (target !== '/sidebar/file' && !target.startsWith('/sidebar/file?')) return undefined
  if (method !== 'GET') throw Error('Invalid sidebar file method')
  const url = new URL(target, 'http://sidebar.invalid'), entries = [...url.searchParams]
  if (url.hash || url.pathname !== '/sidebar/file' || entries.length > 4
    || entries.some(([key]) => !['sessionId', 'path', 'cwd', 'download'].includes(key))
    || new Set(entries.map(([key]) => key)).size !== entries.length
    || url.searchParams.has('download') && url.searchParams.get('download') !== '1') throw Error('Invalid sidebar resource selection')
  const values = Object.fromEntries(entries), { download: _download, ...selection } = values
  const file = parsePaimindSidebarFileRequest('POST', '/sidebar/api/fs.read', 'application/json', new TextEncoder().encode(JSON.stringify(selection)))
  if (!file) throw Error('Invalid sidebar resource selection')
  const basename = file.path.split('/').at(-1)!, dot = basename.lastIndexOf('.')
  const extension = dot > 0 ? basename.slice(dot).toLowerCase() : ''
  const media: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
    '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html' }
  return Object.freeze({ ...file, download: values.download === '1', contentType: media[extension] ?? 'application/octet-stream', maximumBytes: 20971520 })
}
