// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareHarnessCommandListRequest } from '../src/command-list.js'

const encode = (value: unknown) => Buffer.from(JSON.stringify(value))
const request = { type: 'client-request', rpcId: 'native-list', method: 'commands/list', payload: { args: { agentId: 'hansen-session' } } }
const read = (body = request, target = '/api/commands/list', method = 'POST', mime = 'application/json') =>
  prepareHarnessCommandListRequest(method, target, mime, encode(body))
const reply = (value: unknown) => ({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } })
describe('original agent-addressed command list carrier; not an execution grant or shadow catalog', () => {
  it('preserves exact native order, descriptions, input contract and bytes', () => {
    const original = encode(reply([{ name: 'z-local', description: '作用域命令', input: { hint: '提供材料', images: true } },
      { name: 'a-global', description: '' }]))
    const before = Buffer.from(original), prepared = read()!
    expect(prepared.sessionId).toBe('hansen-session'); prepared.assertResponse(original)
    expect(original).toEqual(before); expect(Object.isFrozen(prepared)).toBe(true)
    expect(() => prepared.assertResponse(encode(reply([])))).not.toThrow()
  })
  it('preserves a native owner refusal as a failure, never an empty success', () => {
    const original = encode({ type: 'server-response', rpcId: request.rpcId,
      result: { ok: false, error: { code: 'command-error', message: 'Original command owner unavailable', details: {} } } })
    const before = Buffer.from(original); expect(() => read()!.assertResponse(original)).not.toThrow()
    expect(original).toEqual(before); expect(JSON.parse(original.toString()).result.ok).toBe(false)
  })
  it('rejects aliases, selectors and malformed carrier fields', () => {
    for (const target of ['/api/commands/list?x=1', '/api/commands/list#x', 'http://native.invalid/api/commands/list']) expect(() => read(request, target)).toThrow()
    for (const args of [{}, { agentId: '' }, { agentId: ' another ' }, { agentId: '\n' }, { agentId: 'a'.repeat(201) },
      { agentId: 'owned', userId: 'alex' }, { agentId: 'owned', sessionId: 'foreign' }, { agentId: 'owned', cwd: '/private' }]) {
      expect(() => read({ ...request, payload: { args } } as typeof request)).toThrow()
    }
    for (const patch of [{ role: 'admin' }, { type: 'server-request' }, { method: 'commands/execute' },
      { payload: { args: request.payload.args, role: 'admin' } }]) expect(() => read({ ...request, ...patch } as typeof request)).toThrow()
    expect(() => read(request, undefined, 'GET')).toThrow(); expect(() => read(request, undefined, undefined, 'text/plain')).toThrow()
    for (const body of [Buffer.from([0xff]), Buffer.alloc(4097), Buffer.from('{')]) {
      expect(() => prepareHarnessCommandListRequest('POST', '/api/commands/list', 'application/json', body)).toThrow()
    }
    expect(read(request, '/api/session.history')).toBeUndefined()
  })
  it('rejects uncorrelated, oversized, malformed or expanded original descriptors', () => {
    const row = { name: 'inspect', description: 'Native description' }
    for (const value of [undefined, {}, [row, row], [{ ...row, name: '' }], [{ ...row, private: 'not-a-descriptor' }],
      [{ ...row, description: 'x'.repeat(4097) }], [{ ...row, input: {} }], [{ ...row, input: { hint: 'x', images: 'yes' } }],
      [{ ...row, input: { hint: 'x', command: 'not-a-selector' } }], Array.from({ length: 513 }, (_, index) => ({ ...row, name: String(index) }))]) {
      expect(() => read()!.assertResponse(encode(reply(value)))).toThrow()
    }
    for (const value of [{ ...reply([row]), rpcId: 'foreign' }, { ...reply([row]), private: true },
      { ...reply([row]), result: { ok: true, value: [row], error: {} } }]) expect(() => read()!.assertResponse(encode(value))).toThrow()
    for (const bytes of [Buffer.from([0xff]), Buffer.alloc(256 * 1024 + 1)]) expect(() => read()!.assertResponse(bytes)).toThrow()
  })
})
