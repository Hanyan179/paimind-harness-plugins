import assert from 'node:assert/strict'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { constants } from 'node:fs'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import { NATIVE_CONTROL_LIMIT, NATIVE_CONTROL_PATH, NATIVE_ORIGIN_PATH, createNativeControlPeer, validateNativeControlInput } from './native-control.mjs'

export async function readPrivateCellFile(name) {
  // A separate operator volume, absent from the native/runtime execution
  // namespace. Never load a transport key from a member workspace or env.
  assert.equal(process.platform, 'linux')
  assert.ok(['transport-key', 'member-policy.json'].includes(name))
  const root = '/run/paimind-cell'
  assert.equal(await realpath(root), root)
  const directory = await lstat(root)
  assert.ok(directory.isDirectory() && directory.uid === process.getuid() && (directory.mode & 0o077) === 0)
  const mounts = (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line => line.split(' '))
    .filter(fields => fields[4] === root)
  assert.ok(mounts.length === 1 && mounts[0][5].split(',').includes('ro'), 'Private transport configuration must be its own read-only mount')
  const file = await open(`${root}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o400
      && (name === 'transport-key' ? stat.size === 64 : stat.size > 0 && stat.size <= 4096))
    return await file.readFile('utf8')
  } finally { await file.close() }
}

export async function startPrivateNativeIngress(control) {
  const token = await readPrivateCellFile('transport-key')
  const ingress = createNativeIngress({ token, control })
  try {
    await new Promise((resolve, reject) => {
      ingress.server.once('error', reject)
      ingress.server.listen(3211, '0.0.0.0', () => { ingress.server.off('error', reject); resolve() })
    })
    return ingress
  } catch (error) { await ingress.close(); throw error }
}

/** Private transport only. The native server stays on container loopback. This
 * accepts no browser requests, identity or URL selection. The optional private
 * control route is a bounded launcher channel, never a native/public HTTP RPC.
 * A separate per-cell secret is held by the trusted gateway and launcher only.
 * Publishing this listener is NOT member admission or object authorization.
 */
export function createNativeIngress({ token, nativePort = 3210, control }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('A private 256-bit cell transport key is required')
  assert.ok(Number.isInteger(nativePort) && nativePort >= 1024 && nativePort <= 65535 && nativePort !== 3080)
  const expected = createHash('sha256').update(token).digest()
  assert.ok(control === undefined || typeof control === 'function')
  const authorized = request => {
    const keys = request.headersDistinct['x-paimind-cell-token']
    return keys?.length === 1 && /^[a-f0-9]{64}$/.test(keys[0])
      && timingSafeEqual(createHash('sha256').update(keys[0]).digest(), expected)
  }
  const sockets = new Set()
  let originPeer
  let closing
  const reject = (socket, status = 403) => {
    if (!socket.destroyed) {
      socket.setTimeout(1000, () => socket.destroy())
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`)
    }
  }
  const server = createServer({ maxHeaderSize: 4096, headersTimeout: 5000, requestTimeout: 5000 }, (request, res) => {
    const end = status => { if (!res.destroyed && !res.headersSent) res.writeHead(status, { connection: 'close', 'content-length': '0', 'cache-control': 'no-store' }).end() }
    if (closing || !authorized(request) || request.method !== 'POST' || request.url !== NATIVE_CONTROL_PATH
      || request.headers.origin !== undefined || request.headers.cookie !== undefined
      || request.headers['content-type'] !== 'application/json' || request.headers['content-encoding'] !== undefined
      || request.headers['transfer-encoding'] !== undefined || !/^\d{1,6}$/u.test(request.headers['content-length'] ?? '')
      || Number(request.headers['content-length']) > NATIVE_CONTROL_LIMIT) { end(403); return }
    if (!control) { end(503); return }
    const abort = new AbortController(), cancel = () => abort.abort()
    request.once('aborted', cancel); res.once('close', cancel)
    void (async () => {
      const chunks = []; let size = 0
      for await (const bytes of request) {
        size += bytes.length; if (size > NATIVE_CONTROL_LIMIT) throw new Error('Invalid control request')
        chunks.push(bytes)
      }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'input,operation') { end(400); return }
      validateNativeControlInput(body.operation, body.input); abort.signal.throwIfAborted()
      const value = await control(body.operation, body.input, abort.signal)
      abort.signal.throwIfAborted()
      const output = Buffer.from(JSON.stringify({ ok: true, value }))
      if (output.length > NATIVE_CONTROL_LIMIT) throw new Error('Invalid control result')
      res.writeHead(200, { connection: 'close', 'content-type': 'application/json', 'content-length': String(output.length), 'cache-control': 'no-store' }); res.end(output)
    })().catch(error => end(error?.code === 'NATIVE_CONTROL_REJECTED' ? 409 : 503)).finally(() => {
      request.off('aborted', cancel); res.off('close', cancel)
    })
  })
  server.maxConnections = 256
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(5000, () => socket.destroy())
  })
  server.on('clientError', (_error, socket) => reject(socket, 400))
  server.on('upgrade', (request, socket, head) => {
    if (closing || originPeer || !authorized(request) || request.method !== 'GET' || request.url !== NATIVE_ORIGIN_PATH || head.length
      || request.headers.origin !== undefined || request.headers.cookie !== undefined
      || request.headersDistinct.upgrade?.length !== 1 || request.headers.upgrade !== 'paimind-native-origins'
      || request.headersDistinct.connection?.length !== 1 || request.headers.connection?.toLowerCase() !== 'upgrade'
      || request.headers['content-length'] !== undefined || request.headers['transfer-encoding'] !== undefined) { reject(socket); return }
    socket.setTimeout(0)
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: paimind-native-origins\r\n\r\n')
    originPeer = createNativeControlPeer(socket, {
      handle: async () => { throw new Error('Origin channel does not accept native commands') },
      onClose: () => { originPeer = undefined },
    })
  })
  server.on('checkContinue', (_request, response) => { response.writeHead(403, { connection: 'close' }); response.end() })
  server.on('connect', (request, client, head) => {
    if (closing || request.url !== `127.0.0.1:${nativePort}` || head.length
      || request.headers['content-length'] !== undefined || request.headers['transfer-encoding'] !== undefined
      || !authorized(request)) {
      reject(client); return
    }
    // Never forward CONNECT headers (especially its key) to the native host.
    // Only the constant deployment-selected loopback endpoint can be dialled.
    client.pause()
    const upstream = connect({ host: '127.0.0.1', port: nativePort })
    sockets.add(upstream)
    let connected = false
    const deadline = setTimeout(() => { reject(client, 502); upstream.destroy() }, 5000)
    upstream.once('connect', () => {
      clearTimeout(deadline)
      if (closing || client.destroyed) { upstream.destroy(); return }
      connected = true; client.setTimeout(0)
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(client); client.pipe(upstream); client.resume()
    })
    upstream.on('error', () => { if (!connected) reject(client, 502); else client.destroy() })
    upstream.once('close', () => {
      clearTimeout(deadline); sockets.delete(upstream)
      // A clean native EOF makes pipe() end the downstream only after its
      // queued bytes drain. Destroying it here truncates closing HTTP replies
      // (notably concurrent browser bundles). Abrupt/error closure still fails
      // closed, and explicit ingress shutdown still owns both sockets.
      if (connected && !upstream.readableEnded) client.destroy()
    })
    client.once('close', () => { clearTimeout(deadline); upstream.destroy() })
  })
  return {
    server,
    checkOrigins(input, signal) { return originPeer?.ready ? originPeer.checkOrigins(input, signal) : Promise.reject(new Error('Origin authority disconnected')) },
    authorizeExecution(input, signal) { return originPeer?.ready ? originPeer.authorizeExecution(input, signal) : Promise.reject(new Error('Execution authority disconnected')) },
    readSkillEligibility(input, signal) { return originPeer?.ready ? originPeer.readSkillEligibility(input, signal) : Promise.reject(new Error('Skill eligibility authority disconnected')) },
    readConnectorApproval(input, signal) { return originPeer?.ready ? originPeer.readConnectorApproval(input, signal) : Promise.reject(new Error('Connector authority disconnected')) },
    authorizeConnectorExecution(input, signal) { return originPeer?.ready ? originPeer.authorizeConnectorExecution(input, signal) : Promise.reject(new Error('Connector authority disconnected')) },
    deriveOrigins(input, signal) { return originPeer?.ready ? originPeer.deriveOrigins(input, signal) : Promise.reject(new Error('Delegation authority disconnected')) },
    sealJobOrigins(input, signal) { return originPeer?.ready ? originPeer.sealJobOrigins(input, signal) : Promise.reject(new Error('Job origin authority disconnected')) },
    close() {
      closing ??= new Promise(resolve => {
        originPeer?.close()
        server.close(() => resolve())
        // closeAllConnections does not join upgraded / CONNECT sockets.
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}
