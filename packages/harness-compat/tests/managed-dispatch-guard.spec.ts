// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { TOOL_RUNTIME_SCHEDULER, ToolRuntime, type ToolDefinition, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { definePaimindHarnessTool } from '../src/host.js'
import { installManagedHarnessToolGuard, type ManagedHarnessToolGuard, type ManagedHarnessPresetGuard } from '../src/managed-runtime.js'

// The installed registry's staged scheduler is the same one used by native
// Agent Loop and Code Mode. No replacement registry or model provider is used.
const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose() })
async function fixture(check: ManagedHarnessToolGuard = () => undefined, presetGuard?: ManagedHarnessPresetGuard) {
  const root = new Context(); roots.push(root)
  const guard = installManagedHarnessToolGuard(root, check, presetGuard)
  await root.plugin(SystemPrompt, {})
  const provider = await root.plugin(ToolRuntime, {})
  await vi.waitFor(() => guard.assertReady())
  const execute = vi.fn(async (_args: unknown, _context: unknown) => ({ ran: true }))
  root.tools.register(definePaimindHarnessTool({ name: 'dispatch_target', description: 'Real staged dispatch test', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { ran: { type: 'boolean', required: true } } },
      render: () => [] }, execute }) as ToolDefinition)
  let selected = 'hansen-personal'
  // No approval is requested in these policy tests. Retain the native Session
  // event surface so the dispatch persistence barrier can inspect its interval.
  const agent = { id: 'hansen-agent', session: { id: 'hansen-session', header: { agentPreset: 'standard' }, events: [] },
    ctx: { get: () => ({ composedPreset: () => selected }) } } as unknown as NonNullable<ToolExecutionInput['agent']>
  const scheduler = root.tools[TOOL_RUNTIME_SCHEDULER]
  const prepare = async (selectedAgent = agent) => {
    const prepared = await scheduler.prepare({ agent: selectedAgent, name: 'dispatch_target', callId: 'staged-native-call' as ToolExecutionInput['callId'],
      arguments: {}, signal: new AbortController().signal })
    expect(prepared.kind).toBe('dispatch')
    if (prepared.kind !== 'dispatch') throw Error('Fixture was not admitted to native scheduler')
    return prepared.exec
  }
  const dispatch = async (exec: Awaited<ReturnType<typeof prepare>>) => {
    const result = await scheduler.dispatch(exec)
    return result.kind === 'post-result' ? scheduler.finalize(exec, result.result) : scheduler.finish(exec, result.result)
  }
  return { root, guard, provider, execute, agent, prepare, dispatch, select: (value: string) => { selected = value } }
}

describe('managed policy at actual native scheduler dispatch', () => {
  it('rechecks current policy after preparation instead of carrying an earlier allow across the queue', async () => {
    let allowed = true
    const check = vi.fn(() => allowed ? undefined : 'revoked-after-prepare')
    const f = await fixture(check), prepared = await f.prepare()
    expect(check).toHaveBeenCalledOnce(); allowed = false
    const result = await f.dispatch(prepared)
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('revoked-after-prepare')
    expect(f.execute).not.toHaveBeenCalled(); expect(check).toHaveBeenCalledTimes(2)
  })
  it('cannot execute a queued personal call after its mounted native preset changes to a closed enterprise preset', async () => {
    const f = await fixture(undefined, scope => scope.presetId?.startsWith('paimind-enterprise-') ? 'enterprise-execution-pending' : undefined)
    const prepared = await f.prepare(); f.select('paimind-enterprise-forbidden')
    const result = await f.dispatch(prepared)
    expect(result.isError).toBe(true); expect(f.execute).not.toHaveBeenCalled()
  })
  it('does not rebind an already-prepared call to another permitted native preset', async () => {
    const f = await fixture(), prepared = await f.prepare()
    f.select('hansen-another-personal')
    const result = await f.dispatch(prepared)
    expect(result.isError).toBe(true); expect(f.execute).not.toHaveBeenCalled()
  })
  it('does not revive a prepared execution from a withdrawn registry when a replacement becomes ready', async () => {
    const f = await fixture(), prepared = await f.prepare()
    await f.provider.dispose(); await vi.waitFor(() => expect(() => f.guard.assertReady()).toThrow())
    await f.root.plugin(ToolRuntime, {}); await vi.waitFor(() => f.guard.assertReady())
    const result = await f.dispatch(prepared)
    expect(result.isError).toBe(true); expect(f.execute).not.toHaveBeenCalled()
  })
  it('keeps an unchanged call on the same native execution with one actual body invocation', async () => {
    const check = vi.fn(() => undefined), f = await fixture(check), prepared = await f.prepare()
    const result = await f.dispatch(prepared)
    expect(result.isError).toBe(false); expect(f.execute).toHaveBeenCalledOnce()
    // Preparation, before the async approval checkpoint, and immediately after
    // it must all retain the same exact policy scope.
    expect(check).toHaveBeenCalledTimes(3)
    expect(check.mock.calls[0]).toEqual(check.mock.calls[1])
    expect(check.mock.calls[0]).toEqual(check.mock.calls[2])
  })
  it('does not confuse independent executions with identical call IDs or stop another permitted session', async () => {
    let revoked: string | undefined
    const f = await fixture(call => call.sessionId === revoked ? 'session-policy-revoked' : undefined)
    const other = { ...f.agent, id: 'alex-agent', session: { id: 'alex-session', header: { agentPreset: 'standard' }, events: [] } } as unknown as typeof f.agent
    const first = await f.prepare(), second = await f.prepare(other)
    revoked = 'hansen-session'
    expect((await f.dispatch(first)).isError).toBe(true)
    expect((await f.dispatch(second)).isError).toBe(false)
    expect(f.execute).toHaveBeenCalledOnce()
    expect(f.execute.mock.calls[0]?.[1]).toMatchObject({ agent: other })
  })
  it('fails closed for a policy exception occurring only at dispatch without exposing the internal error', async () => {
    let failed = false
    const f = await fixture(() => { if (failed) throw Error('private current-authority failure'); return undefined })
    const prepared = await f.prepare(); failed = true
    const result = await f.dispatch(prepared)
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('could not authorize')
    expect(JSON.stringify(result)).not.toContain('private current-authority')
    expect(f.execute).not.toHaveBeenCalled()
  })
})
