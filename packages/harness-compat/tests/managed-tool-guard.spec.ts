// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ToolRuntime, type ToolDefinition, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { definePaimindHarnessTool } from '../src/host.js'
import { installManagedHarnessToolGuard, type ManagedHarnessToolGuard } from '../src/managed-runtime.js'

// Real published Cordis, scope and ToolRuntime dispatch, not a mock registry.
// This deliberately does not represent member admission or browser acceptance.
const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose() })
function rootContext() { const root = new Context(); roots.push(root); return root }
async function nativeTools(root: Context, mode: 'native' | 'both' = 'native') {
  await root.plugin(SystemPrompt, {})
  return await root.plugin(ToolRuntime, { mode })
}
function tool(name: string, execute = vi.fn(async () => ({ ran: true }))) {
  const definition = definePaimindHarnessTool({ name, description: 'Managed guard test fixture', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { ran: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute }) as ToolDefinition
  return { definition, execute }
}
function call(name: string, extra: Partial<ToolExecutionInput> = {}): ToolExecutionInput {
  return { name, callId: 'managed-test-call' as ToolExecutionInput['callId'], arguments: {},
    signal: new AbortController().signal, ...extra }
}

describe('root-owned native execution guard', () => {
  it('waits for the native registry, denies before the body, and releases readiness on disposal', async () => {
    const root = rootContext()
    const guard = installManagedHarnessToolGuard(root, () => 'candidate-not-admitted')
    expect(() => guard.assertReady()).toThrow('not active')
    await nativeTools(root)
    await vi.waitFor(() => guard.assertReady())
    const target = tool('managed_target'); root.tools.register(target.definition)
    const result = await root.tools.execute(call('managed_target'))
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('candidate-not-admitted')
    expect(target.execute).not.toHaveBeenCalled()
    await root.fiber.dispose()
    expect(() => guard.assertReady()).toThrow('not active')
  })

  it('cannot be turned into permission by pre-execute allow, scoped guards, or scoped shadow tools', async () => {
    const root = rootContext()
    const guard = installManagedHarnessToolGuard(root, () => 'managed-denial')
    await nativeTools(root); await vi.waitFor(() => guard.assertReady())
    root.on('tools/pre-execute', async () => ({ kind: 'allow' }))
    const ancestor = {}; const agent = { id: 'native-test-agent', session: { id: 'native-test-session', events: [] } }
    await root.inject(['tools'], async context => {
      const parentScope = createScope(context, ancestor)
      const child = createScope(parentScope.ctx, agent, { parent: ancestor })
      const target = tool('scoped_target'); child.ctx.tools.register(target.definition)
      child.ctx.tools.guard(() => undefined)
      const result = await root.tools.execute(call('scoped_target', { agent: agent as ToolExecutionInput['agent'] }))
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('managed-denial')
      expect(target.execute).not.toHaveBeenCalled()
      await child.dispose(); await parentScope.dispose()
    })
  })

  it('does not expose live services and preserves the native frozen call arguments', async () => {
    const root = rootContext()
    const check = vi.fn(() => undefined)
    const guard = installManagedHarnessToolGuard(root, check)
    await nativeTools(root); await vi.waitFor(() => guard.assertReady())
    const target = tool('read_projection'); root.tools.register(target.definition)
    const agent = { id: 'owned-agent', session: { id: 'owned-session', events: [] } }
    await root.tools.execute(call('read_projection', { arguments: { nested: { value: 'original' } },
      agent: agent as ToolExecutionInput['agent'] }))
    const [projection] = check.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(Object.keys(projection).sort()).toEqual(['agentId', 'arguments', 'callId', 'name', 'rootCallId', 'sessionId'])
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.arguments)).toBe(true)
    expect(Object.isFrozen((projection.arguments as { nested: object }).nested)).toBe(true)
    expect(projection).toMatchObject({ agentId: 'owned-agent', sessionId: 'owned-session' })
  })

  it.each([
    ['throw', () => { throw new Error('private policy failure') }],
    ['empty reason', () => ''], ['blank reason', () => '  '], ['boolean allow', () => true],
    ['async allow', async () => undefined], ['async reject', async () => { throw Error('private async failure') }],
  ])('fails closed for a misconfigured %s policy without disclosing its error', async (_name, check) => {
    const root = rootContext()
    const guard = installManagedHarnessToolGuard(root, check as ManagedHarnessToolGuard)
    await nativeTools(root); await vi.waitFor(() => guard.assertReady())
    const target = tool('guard_failure'); root.tools.register(target.definition)
    const result = await root.tools.execute(call('guard_failure'))
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('could not authorize')
    expect(JSON.stringify(result)).not.toContain('private')
    expect(target.execute).not.toHaveBeenCalled()
  })

  it('rejects duplicate or child-owned installation and does not affect a separate native root', async () => {
    const sealed = rootContext(); const ordinary = rootContext()
    const guard = installManagedHarnessToolGuard(sealed, () => 'sealed-root')
    expect(() => installManagedHarnessToolGuard(sealed, () => undefined)).toThrow('already belongs')
    expect(() => installManagedHarnessToolGuard(sealed.extend(), () => undefined)).toThrow('application root')
    await Promise.all([nativeTools(sealed), nativeTools(ordinary)])
    await vi.waitFor(() => guard.assertReady())
    const first = tool('separate_roots'); const second = tool('separate_roots')
    sealed.tools.register(first.definition); ordinary.tools.register(second.definition)
    expect((await sealed.tools.execute(call('separate_roots'))).isError).toBe(true)
    expect((await ordinary.tools.execute(call('separate_roots'))).isError).toBe(false)
    expect(first.execute).not.toHaveBeenCalled(); expect(second.execute).toHaveBeenCalledOnce()
  })

  it('seals the reserved native Code Mode transport before it can request an execution backend', async () => {
    const root = rootContext()
    const guard = installManagedHarnessToolGuard(root, () => 'code-execution-sealed')
    await nativeTools(root, 'both'); await vi.waitFor(() => guard.assertReady())
    const result = await root.tools.execute(call('run_code', { arguments: { code: 'return 1' } }))
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('code-execution-sealed')
    expect(JSON.stringify(result)).not.toContain('codeRuntime')
  })

  it('keeps a withdrawn registry fail-closed and guards the replacement before readiness', async () => {
    const root = rootContext()
    const guard = installManagedHarnessToolGuard(root, () => undefined)
    const provider = await nativeTools(root); await vi.waitFor(() => guard.assertReady())
    const oldTools = root.tools
    const oldTarget = tool('retained_registry'); oldTools.register(oldTarget.definition)
    expect((await oldTools.execute(call('retained_registry'))).isError).toBe(false)
    oldTarget.execute.mockClear()
    await provider.dispose()
    await vi.waitFor(() => expect(() => guard.assertReady()).toThrow('not active'))
    const oldResult = await oldTools.execute(call('retained_registry'))
    expect(oldResult.isError).toBe(true); expect(JSON.stringify(oldResult)).toContain('could not authorize')
    expect(oldTarget.execute).not.toHaveBeenCalled()
    await root.plugin(ToolRuntime, {})
    await vi.waitFor(() => guard.assertReady())
    const replacement = tool('retained_registry'); root.tools.register(replacement.definition)
    expect((await root.tools.execute(call('retained_registry'))).isError).toBe(false)
    expect((await oldTools.execute(call('retained_registry'))).isError).toBe(true)
    expect(oldTarget.execute).not.toHaveBeenCalled()
  })
})
