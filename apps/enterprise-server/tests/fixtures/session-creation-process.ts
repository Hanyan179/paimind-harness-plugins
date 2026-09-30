// Separate, killable command-owner process. Exact PG and native transports are
// real; this fixture adds only an explicit pause before native dispatch.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { Identity } from '../../src/identity.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../../src/runtime-bindings.js'
import { NativeGateway } from '../../src/native-gateway.js'
import { CellTransport } from '../../src/cell-transport.js'
import { SessionCreation } from '../../src/session-creation.js'
import { isolatedDatabase } from './isolated-database.js'

assert.equal(process.env.PAIMIND_SESSION_CREATE_PROCESS_TEST, '1')
assert.ok(process.send)
const config = isolatedDatabase()
process.once('message', async (input: { tenantId: string; token: string; publicOrigin: string; pin: PrivateRuntimeCell;
  transportKey: string; nativePort: number; request: object; context: { key: string; requestId: string }; pause: boolean }) => {
  const sql = postgres(config.applicationUrl, { max: 3, onnotice: () => {} })
  const identity = new Identity(sql, input.tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  const bindings = new RuntimeBindings(sql, identity, input.publicOrigin, [], [input.pin])
  const transport = new CellTransport(input.pin.origin, input.transportKey, input.nativePort)
  const gateway = new NativeGateway({ publicOrigin: input.publicOrigin, transports: new Map([[input.pin.origin, transport]]),
    resolve: (token, id) => bindings.resolve(token, id),
    authorize: (token, id, grant, request, verify) => identity.authorizeRuntimeOperation(token, id, grant, request, verify),
    agentPresetEligibility: (token, id, grant, ids) => bindings.readAgentPresetEligibility(token, id, grant, ids) })
  if (input.pause) {
    const original = gateway.sessionCreation.bind(gateway)
    gateway.sessionCreation = async (...args) => {
      if (args[4]) {
        process.send!({ phase: 'reservation-committed-before-native-dispatch' })
        await new Promise(() => {})
      }
      return original(...args)
    }
  }
  try {
    const result = await new SessionCreation(identity, gateway).create(input.token, input.request, input.context, AbortSignal.timeout(15000))
    process.send!({ phase: 'completed', result })
  } catch (error) {
    process.send!({ phase: 'failed', error: error instanceof Error ? error.message : 'Command failed' })
    process.exitCode = 1
  } finally {
    gateway.close(); transport.destroy(); await sql.end({ timeout: 5 }); process.disconnect()
  }
})
