/** Read-only UI correlation from an already authorized native history page.
 * This does NOT authenticate an origin: only the enterprise identity owner can
 * verify its HMAC and current exact login/cell/policy at execution time.
 * No history rewriting, bearer token, registry or fallback-to-last-message. */
export function readHarnessPromptCorrelation(source: unknown, nativeSessionId: string): string | null {
  if (source === null || typeof source !== 'object') return null
  const user = source as { kind?: unknown; rpcId?: unknown }
  if (user.kind !== 'user' || typeof user.rpcId !== 'string') return null
  const validId = (value: unknown): value is string => typeof value === 'string'
    && value.length > 0 && value.length <= 200 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)
  if (!user.rpcId.startsWith('paimind-origin-')) return validId(user.rpcId) ? user.rpcId : null
  if (!validId(nativeSessionId) || user.rpcId.length > 8192) return null
  const match = /^paimind-origin-v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u.exec(user.rpcId)
  if (!match) return null
  try {
    const binary = atob(match[1]!.replace(/-/g, '+').replace(/_/g, '/'))
    if (btoa(binary).replace(/=+$/u, '').replace(/\+/g, '-').replace(/\//g, '_') !== match[1]) return null
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true })
      .decode(Uint8Array.from(binary, char => char.charCodeAt(0))))
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
    const origin = payload as Record<string, unknown>
    if (origin.nativeSessionId !== nativeSessionId || Object.hasOwn(origin, 'delegatedPresetId')
      || Object.hasOwn(origin, 'nativeJobId') || !validId(origin.clientRpcId)) return null
    return origin.clientRpcId
  } catch { return null }
}
