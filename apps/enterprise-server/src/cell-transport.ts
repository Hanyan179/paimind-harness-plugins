import { Agent, request, type ClientRequest, type ClientRequestArgs } from 'node:http'
import { Socket } from 'node:net'
import type { IncomingMessage } from 'node:http'
import { createNativeControlPeer, NATIVE_ORIGIN_PATH, type NativeControlPeer, type NativeOriginInput, type NativeExecutionInput, type NativeDelegationInput, type NativeJobOriginInput, type NativeSkillPublicationReference, type NativeConnectorApprovalInput, type NativeConnectorExecutionInput } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const unavailable = () => new Error('Private cell transport unavailable')
export class CellControlRejected extends Error {
  constructor() { super('Private native operation rejected') }
}

/** A fixed operator-selected cell, not an HTTP proxy chosen by a browser or DB
 * row. The secret is used only at the private launcher (CONNECT/control),
 * never sent to the native application or nested member execution.
 * Gateway admission/revocation still owns whether any request may use this.
 */
export class CellTransport extends Agent {
  private readonly pending = new Set<ClientRequest>()
  private readonly owned = new Set<Socket>()
  private stopped = false
  private originPeer: NativeControlPeer | undefined
  private openingOrigins = false
  readonly nativeOrigin: string
  constructor(readonly ingressOrigin: string, private readonly token: string, private readonly nativePort = 3210) {
    super({ keepAlive: false, maxSockets: 128, maxTotalSockets: 128 })
    const url = new URL(ingressOrigin)
    if (url.origin !== ingressOrigin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
      || !url.port || Number(url.port) < 1024 || ['3080', String(nativePort)].includes(url.port)
      || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || !Number.isInteger(nativePort) || nativePort < 1024 || nativePort > 65535 || nativePort === 3080) {
      throw new Error('Invalid private cell transport configuration')
    }
    this.nativeOrigin = `http://127.0.0.1:${nativePort}`
  }
  override createConnection(options: ClientRequestArgs, callback?: Parameters<Agent['createConnection']>[1]): undefined {
    if (!callback) throw new Error('Private transport requires an asynchronous connection callback')
    // No fallback to a direct connection, even after a failed handshake.
    if (this.stopped || options.host !== '127.0.0.1' || Number(options.port) !== this.nativePort) {
      queueMicrotask(() => callback(unavailable(), new Socket().destroy())); return
    }
    const target = new URL(this.ingressOrigin)
    const outbound = request({ host: target.hostname, port: target.port, method: 'CONNECT', path: `127.0.0.1:${this.nativePort}`,
      agent: false, headers: { host: `127.0.0.1:${this.nativePort}`, 'x-paimind-cell-token': this.token }, maxHeaderSize: 4096 })
    this.pending.add(outbound)
    let settled = false
    const finish = (socket?: Socket) => {
      if (settled) { socket?.destroy(); return }
      settled = true; clearTimeout(deadline); this.pending.delete(outbound)
      if (!socket || this.stopped) { socket?.destroy(); outbound.destroy(); callback(unavailable(), new Socket().destroy()); return }
      this.owned.add(socket); socket.once('close', () => this.owned.delete(socket))
      callback(null, socket)
    }
    const deadline = setTimeout(() => finish(), 5000)
    outbound.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200 || head.length !== 0) { socket.destroy(); finish(); return }
      finish(socket)
    })
    outbound.on('error', () => finish())
    outbound.once('response', response => { response.destroy(); finish() })
    outbound.end()
    return undefined
  }
  /** A fixed private launcher path, not a native HTTP RPC. Input is never an
   * origin, method name or bearer credential supplied by the browser. */
  requestControl(operation: 'publication.snapshot' | 'publication.adopt' | 'publication.receipt' | 'skill.export.begin' | 'skill.export.read' | 'skill.export.release'
    | 'skill.adopt.begin' | 'skill.adopt.write' | 'skill.adopt.commit' | 'skill.adopt.release' | 'skill.adopt.receipt'
    | 'feature.describe' | 'feature.plan' | 'feature.apply' | 'session.preset' | 'session.creation' | 'session.turn-state' | 'session.events' | 'session.approval' | 'session.directory' | 'session.file' | 'connector.inventory' | 'connector.configuration' | 'connector.activation-state' | 'connector.activate' | 'connector.prepare' | 'connector.configure' | 'connector.release' | 'connector.restore', input: object,
    signal?: AbortSignal, timeoutMs = 4000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.stopped || signal?.aborted || this.pending.size >= 128 || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000
        || !['publication.snapshot', 'publication.adopt', 'publication.receipt', 'skill.export.begin', 'skill.export.read', 'skill.export.release',
          'skill.adopt.begin', 'skill.adopt.write', 'skill.adopt.commit', 'skill.adopt.release', 'skill.adopt.receipt',
          'feature.describe', 'feature.plan', 'feature.apply', 'session.preset', 'session.creation', 'session.turn-state', 'session.events', 'session.approval', 'session.directory', 'session.file', 'connector.inventory', 'connector.configuration', 'connector.activation-state', 'connector.activate', 'connector.prepare', 'connector.configure', 'connector.release', 'connector.restore'].includes(operation)) { reject(unavailable()); return }
      let body: Buffer
      try { body = Buffer.from(JSON.stringify({ operation, input })); if (body.length > 262144) throw unavailable() }
      catch { reject(unavailable()); return }
      const origin = new URL(this.ingressOrigin)
      let settled = false, incoming: IncomingMessage | undefined, deadline: ReturnType<typeof setTimeout>
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return
        settled = true; clearTimeout(deadline); signal?.removeEventListener('abort', abort); this.pending.delete(outbound)
        if (error) { incoming?.destroy(); outbound.destroy(); reject(error) } else resolve(value)
      }
      const abort = () => finish(unavailable())
      const outbound = request({ hostname: origin.hostname, port: origin.port, path: '/_paimind/native-control', method: 'POST', agent: false,
        headers: { 'x-paimind-cell-token': this.token, 'content-type': 'application/json', 'content-length': String(body.length), connection: 'close' },
        maxHeaderSize: 4096 }, response => {
        incoming = response
        if (response.statusCode !== 200) { finish(response.statusCode === 409 ? new CellControlRejected() : unavailable()); return }
        if (response.headers['content-type'] !== 'application/json' || response.headers['content-encoding'] !== undefined) { finish(unavailable()); return }
        const chunks: Buffer[] = []; let size = 0
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 262144) finish(unavailable()); else if (!settled) chunks.push(chunk) })
        response.once('error', () => finish(unavailable()))
        response.once('end', () => {
          if (settled) return
          try {
            const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
            if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).sort().join(',') !== 'ok,value'
              || (result as { ok: unknown }).ok !== true) throw unavailable()
            finish(undefined, (result as { value: unknown }).value)
          } catch { finish(unavailable()) }
        })
      })
      this.pending.add(outbound); outbound.once('error', () => finish(unavailable()))
      deadline = setTimeout(abort, timeoutMs); signal?.addEventListener('abort', abort, { once: true })
      outbound.end(body)
    })
  }
  /** Gateway-initiated private reverse channel. Native code supplies only
   * signed source associations; the closure pins the actual cell independently.
   * This is not a native invocation endpoint or a transferable permission. */
  openOriginAuthority(check: (input: NativeOriginInput, signal: AbortSignal) => Promise<void>,
    authorizeExecution?: (input: NativeExecutionInput, signal: AbortSignal) => Promise<void>,
    deriveOrigins?: (input: NativeDelegationInput, signal: AbortSignal) => Promise<NativeOriginInput>,
    sealJobOrigins?: (input: NativeJobOriginInput, signal: AbortSignal) => Promise<NativeOriginInput>,
    readSkillEligibility?: (input: readonly NativeSkillPublicationReference[], signal: AbortSignal) => Promise<readonly string[]>,
    readConnectorApproval?: (input: NativeConnectorApprovalInput, signal: AbortSignal) => Promise<number>,
    authorizeConnectorExecution?: (input: NativeConnectorExecutionInput, signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.stopped || this.originPeer || this.openingOrigins) return Promise.reject(unavailable())
    this.openingOrigins = true
    return new Promise((resolve, reject) => {
      const target = new URL(this.ingressOrigin)
      let settled = false, peer: NativeControlPeer | undefined
      const outbound = request({ hostname: target.hostname, port: target.port, method: 'GET', path: NATIVE_ORIGIN_PATH,
        agent: false, maxHeaderSize: 4096, headers: { 'x-paimind-cell-token': this.token,
          connection: 'Upgrade', upgrade: 'paimind-native-origins' } })
      const finish = (error?: Error) => {
        if (settled) return
        settled = true; clearTimeout(deadline); this.pending.delete(outbound); this.openingOrigins = false
        if (error) { peer?.close(); outbound.destroy(); reject(error) } else resolve()
      }
      const deadline = setTimeout(() => finish(unavailable()), 5000); deadline.unref()
      this.pending.add(outbound)
      outbound.once('upgrade', (response, socket, head) => {
        if (this.stopped || response.statusCode !== 101 || response.headers.upgrade !== 'paimind-native-origins'
          || response.headers['content-length'] !== undefined || response.headers['transfer-encoding'] !== undefined || head.length > 262144) {
          socket.destroy(); finish(unavailable()); return
        }
        socket.pause(); socket.setTimeout(0); this.owned.add(socket)
        socket.once('close', () => this.owned.delete(socket))
        peer = createNativeControlPeer(socket, {
          checkOrigins: check,
          ...(authorizeExecution ? { authorizeExecution } : {}),
          ...(deriveOrigins ? { deriveOrigins } : {}),
          ...(sealJobOrigins ? { sealJobOrigins } : {}),
          ...(readSkillEligibility ? { readSkillEligibility } : {}),
          ...(readConnectorApproval ? { readConnectorApproval } : {}),
          ...(authorizeConnectorExecution ? { authorizeConnectorExecution } : {}),
          onReady: () => { this.originPeer = peer; finish() },
          onClose: () => { if (this.originPeer === peer) this.originPeer = undefined; finish(unavailable()) },
        })
        // A correct ready frame may share the HTTP upgrade packet. Feed it to
        // the bounded protocol parser, never drop it or require packet timing.
        if (head.length) socket.unshift(head)
        socket.resume()
      })
      outbound.once('response', response => { response.destroy(); finish(unavailable()) })
      outbound.once('error', () => finish(unavailable())); outbound.end()
    })
  }
  override destroy(): void {
    this.stopped = true
    this.originPeer?.close()
    for (const request of this.pending) request.destroy(unavailable())
    // WebSocket takes sockets out of Agent's normal pool; retain ownership.
    for (const socket of this.owned) socket.destroy()
    super.destroy()
  }
}
