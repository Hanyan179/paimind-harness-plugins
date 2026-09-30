// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareHarnessExportCommandRequest, COMMAND_ORIGIN_HEADER, COMMAND_BINDING_HEADER, commandInvocationBinding } from '../src/command-execution.js'
const encode = (value: unknown) => Buffer.from(JSON.stringify(value))
const source = 'paimind-origin-v1.c3ludGhldGlj.' + 's'.repeat(43)
const request = { type: 'client-request', rpcId: 'browser-export', method: 'commands/execute', payload: { args: { agentId: 'hansen-owned', line: '/export', images: [] } } }
const prepare = (input: any = request, target = '/api/commands/execute') => prepareHarnessExportCommandRequest('POST', target, 'application/json', encode(input))
describe('exact native export carrier; no role or object authority', () => {
  it('preserves original arguments, stamps only provenance/correlation and binds the exact invocation', () => {
    const native = prepare()!, stamped = JSON.parse(Buffer.from(native.stamp(source)).toString())
    expect(stamped).toEqual({ ...request, rpcId: source }); expect(request.rpcId).toBe('browser-export')
    expect(native.privateHeaders(source)).toEqual({ [COMMAND_ORIGIN_HEADER]: source,
      [COMMAND_BINDING_HEADER]: commandInvocationBinding(source, 'hansen-owned', '/export') })
    expect(commandInvocationBinding(source, 'another', '/export')).not.toBe(native.privateHeaders(source)[COMMAND_BINDING_HEADER])
    expect(native.requiresPresetEligibility).toBe(true)
  })
  it('restores the exact browser correlation while preserving native success and failure', () => {
    const native = prepare()!
    for (const result of [{ ok: true, value: { commandId: 'cmd-native-1', result: { kind: 'success', text: 'Session log download requested.' } } },
      { ok: true, value: { commandId: 'cmd-native-1', result: { kind: 'error', text: 'The Web /export command does not accept a path.' } } },
      { ok: false, error: { code: 'internal', message: 'Original owner refused', details: {} } }]) {
      expect(JSON.parse(Buffer.from(native.restoreResponse(encode({ type: 'server-response', rpcId: source, result }), source)).toString()))
        .toEqual({ type: 'server-response', rpcId: request.rpcId, result })
    }
  })
  it('never opens another command or a prefix match', () => {
    for (const line of ['/compact', '/permission unrestricted', '/plan task', '/goal work', '/feedback text', '/export-all', ' /export']) {
      expect(prepare({ ...request, payload: { args: { ...request.payload.args, line } } })).toBeUndefined()
    }
    expect(prepare(request, '/api/session.history')).toBeUndefined()
  })
  it('rejects aliases, forged identities, extra fields, invalid ids and expanded image input', () => {
    for (const target of ['/api/commands/execute?x=1', '/api/commands/execute#x', 'http://native.invalid/api/commands/execute']) expect(() => prepare(request, target)).toThrow()
    for (const args of [{ ...request.payload.args, role: 'admin' }, { ...request.payload.args, userId: 'alex' },
      { ...request.payload.args, agentId: ' another ' }, { ...request.payload.args, agentId: 'x'.repeat(201) },
      { ...request.payload.args, images: ['unexpected'] }, { ...request.payload.args, line: '/export ' + 'x'.repeat(4096) },
      { ...request.payload.args, line: '/export \0' }]) expect(() => prepare({ ...request, payload: { args } })).toThrow()
    expect(() => prepare({ ...request, rpcId: 'x'.repeat(201) })).toThrow()
    // A caller may choose correlation text; it is still replaced by the
    // gateway's newly sealed actual login, never accepted as authentication.
    expect(prepare({ ...request, rpcId: source })!.clientRpcId).toBe(source)
    expect(() => prepare({ ...request, role: 'admin' })).toThrow()
    expect(() => prepare()!.privateHeaders('caller-controlled')).toThrow()
  })
  it('refuses malformed, mismatched or expanded native output', () => {
    for (const result of [{ ok: true }, { ok: true, value: {} }, { ok: true, value: { commandId: 'cmd', result: { kind: 'success', text: 'x', file: '/private' } } }]) {
      expect(() => prepare()!.restoreResponse(encode({ type: 'server-response', rpcId: source, result }), source)).toThrow()
    }
    expect(() => prepare()!.restoreResponse(Buffer.alloc(256 * 1024 + 1), source)).toThrow()
    expect(() => prepare()!.restoreResponse(encode({ type: 'server-response', rpcId: 'different', result: { ok: false, error: { code: 'internal', message: 'refused', details: {} } } }), source)).toThrow()
  })
})
