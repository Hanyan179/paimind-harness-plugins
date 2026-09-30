import type { IncomingMessage } from 'node:http'
import { EnterpriseError } from './errors.js'

export const COOKIE = 'paimind_haas_session'
export function header(request: IncomingMessage, name: string): string | undefined {
  const values = request.headersDistinct[name]
  if (!values) return undefined
  if (values.length !== 1) throw new EnterpriseError(400, 'ambiguous-header', '请求头不明确')
  return values[0]
}
export function sessionToken(request: IncomingMessage): string | undefined {
  const value = header(request, 'cookie')
  if (!value) return undefined
  const matches = value.split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`))
  if (matches.length > 1) throw new EnterpriseError(400, 'ambiguous-cookie', '登录信息不明确，请清除该站点的登录信息后重试')
  return matches[0]?.slice(COOKIE.length + 1)
}
/** Shared by HTTP and Upgrade; never let the upgrade carrier bypass host,
 * origin, canonical-path or caller-supplied identity rejection. */
export function validateRequest(request: IncomingMessage, origin: URL, upgrade = false): URL {
  if (header(request, 'host') !== origin.host) throw new EnterpriseError(421, 'host-not-allowed', '访问地址不受信任')
  const target = request.url
  if (!target?.startsWith('/') || target.startsWith('//') || /[\\#\u0000-\u0020\u007f]/u.test(target)) {
    throw new EnterpriseError(400, 'invalid-url', '访问地址无效')
  }
  const url = new URL(target, origin)
  if (url.origin !== origin.origin || url.pathname !== target.split('?')[0]) throw new EnterpriseError(400, 'invalid-url', '访问地址无效')
  if (Object.keys(request.headers).some(name => name === 'authorization' || name.startsWith('x-paimind-'))) {
    throw new EnterpriseError(400, 'identity-header-not-allowed', '此入口不接受外部身份头')
  }
  const requestOrigin = header(request, 'origin')
  // A user opening an application entry document (including from an external
  // page or an opaque error document) can legitimately be cross-site. This
  // exception admits navigation only, never data, frames, writes or upgrades;
  // the normal login, runtime and operation gates still run afterwards.
  // Fetch Metadata: https://www.w3.org/TR/fetch-metadata/#sec-fetch-user-header
  const userDocumentNavigation = !upgrade && request.method === 'GET'
    && ['/', '/index.html', '/haas/login', '/haas/recover'].includes(url.pathname)
    && header(request, 'sec-fetch-mode') === 'navigate'
    && header(request, 'sec-fetch-dest') === 'document'
    && header(request, 'sec-fetch-user') === '?1'
    && header(request, 'accept')?.split(',').some(value => value.split(';')[0]?.trim().toLowerCase() === 'text/html')
  if ((requestOrigin !== undefined && requestOrigin !== origin.origin)
    || ((upgrade || !['GET', 'HEAD'].includes(request.method ?? '')) && requestOrigin !== origin.origin)
    || header(request, 'sec-fetch-site') === 'cross-site' && !userDocumentNavigation) {
    throw new EnterpriseError(403, 'origin-not-allowed', '请求来源不受信任，请从本应用重试')
  }
  return url
}
