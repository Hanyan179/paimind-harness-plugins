import { isDeepStrictEqual } from 'node:util'

const keys = ['applicationUrl', 'bootstrapSecret', 'containerId', 'evidence', 'masterKey', 'ownerUrl', 'tenantId']
const fail = () => { throw Error('Resumed database identity or observed loopback endpoint changed') }
function checked(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !isDeepStrictEqual(Object.keys(config).sort(), keys)
    || keys.some(key => typeof config[key] !== 'string' || !config[key])
    || !/^[a-f0-9]{64}$/.test(config.containerId)) fail()
  let urls
  try { urls = [config.ownerUrl, config.applicationUrl].map(text => new URL(text)) } catch { return fail() }
  for (const url of urls) {
    if (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e'
      || !url.username || !url.password || url.search || url.hash || !url.port
      || Number(url.port) < 1024 || Number(url.port) > 65535 || ['3080', '5432', '10012'].includes(url.port)) fail()
  }
  if (urls[0].port !== urls[1].port) fail()
  return urls
}

/** Same retained database only. A new private file may update the published
 * loopback port after Docker reallocation; no other identity or credential
 * change is accepted. Never connects, mutates config, or prints URL values. */
export function verifyResumedDatabaseConfig(previous, current, observed) {
  const oldUrls = checked(previous), nextUrls = checked(current)
  const normalized = { ...current }
  for (const [index, key] of ['ownerUrl', 'applicationUrl'].entries()) {
    const url = new URL(nextUrls[index]); url.port = oldUrls[index].port
    if (url.href !== oldUrls[index].href) fail()
    normalized[key] = previous[key]
  }
  if (!isDeepStrictEqual(normalized, previous)) fail()
  if (observed?.Id !== current.containerId || observed?.State?.Running !== true
    || observed?.Config?.Labels?.['paimind.role'] !== 'identity-e2e-only'
    || !isDeepStrictEqual(observed?.NetworkSettings?.Ports?.['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: nextUrls[0].port }])) fail()
  return Object.freeze({ databaseId: current.containerId, previousPort: oldUrls[0].port,
    currentPort: nextUrls[0].port, portChanged: oldUrls[0].port !== nextUrls[0].port })
}
