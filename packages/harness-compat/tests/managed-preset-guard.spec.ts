// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, type ToolDefinition, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { definePaimindHarnessTool } from '../src/host.js'
import { installManagedHarnessToolGuard, type ManagedHarnessPresetGuard } from '../src/managed-runtime.js'

const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose() })
async function fixture(check: ManagedHarnessPresetGuard) {
  const root = new Context(); roots.push(root)
  const guard = installManagedHarnessToolGuard(root, () => undefined, check)
  await root.plugin(SystemPrompt, {})
  const provider = await root.plugin(ToolRuntime, {})
  await vi.waitFor(() => guard.assertReady())
  const execute = vi.fn(async () => ({ ran: true }))
  root.tools.register(definePaimindHarnessTool({ name: 'read', description: 'Synthetic body behind real native dispatcher', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { ran: { type: 'boolean', required: true } } }, render: () => [] }, execute }) as ToolDefinition)
  const agent = (selected: string | undefined, header = 'standard') => ({ id: 'owned-agent', session: { id: 'owned-session', events: [], header: { agentPreset: header } },
    ctx: { get: () => ({ composedPreset: () => selected }) } }) as unknown as NonNullable<ToolExecutionInput['agent']>
  const step = (selected: string | undefined, header?: string) => root.waterfall('agent/pre-step', {
    agent: agent(selected, header), turn: 1, step: 1, signal: new AbortController().signal, messages: [],
  } as never, () => Promise.resolve({ kind: 'enter', messages: [] }))
  const tool = (selected: string | undefined) => root.tools.execute({ name: 'read', agent: agent(selected),
    callId: 'read-test' as ToolExecutionInput['callId'], arguments: {}, signal: new AbortController().signal })
  return { root, guard, provider, execute, step, tool }
}

describe('managed native preset floor, not live enterprise authorization', () => {
  const deny = (scope: { presetId?: string }) => !scope.presetId || scope.presetId.startsWith('paimind-enterprise-') ? 'publication-execution-pending' : undefined
  it('uses mounted native identity after selection, denies before later steps/tool bodies, and leaves personal execution intact', async () => {
    const f = await fixture(deny), next = vi.fn(async (_event, onward) => onward())
    f.root.on('agent/pre-step', next)
    await expect(f.step('paimind-enterprise-owned', 'standard')).rejects.toThrow('publication-execution-pending')
    expect(next).not.toHaveBeenCalled()
    expect((await f.tool('paimind-enterprise-owned')).isError).toBe(true); expect(f.execute).not.toHaveBeenCalled()
    await f.step('hansen-personal', 'paimind-enterprise-old')
    expect(next).toHaveBeenCalledOnce()
    expect((await f.tool('hansen-personal')).isError).toBe(false); expect(f.execute).toHaveBeenCalledOnce()
  })
  it('does not fall back to a permitted stale header when the native owner cannot identify the mounted preset', async () => {
    const f = await fixture(deny)
    await expect(f.step(undefined)).rejects.toThrow('publication-execution-pending')
    expect((await f.tool(undefined)).isError).toBe(true); expect(f.execute).not.toHaveBeenCalled()
  })
  it('rechecks each native step and each tool call rather than retaining an earlier allow', async () => {
    let allowed = true
    const f = await fixture(() => allowed ? undefined : 'revoked-fixture')
    await f.step('assigned'); expect((await f.tool('assigned')).isError).toBe(false)
    allowed = false
    await expect(f.step('assigned')).rejects.toThrow('revoked-fixture')
    expect((await f.tool('assigned')).isError).toBe(true); expect(f.execute).toHaveBeenCalledOnce()
  })
  it.each(['throw', 'async', 'empty'])('fails closed on a %s policy and does not leak internal failure details', async kind => {
    const check = kind === 'throw' ? () => { throw Error('private failure') } : kind === 'async' ? async () => undefined : () => ''
    const f = await fixture(check as ManagedHarnessPresetGuard)
    await expect(f.step('personal')).rejects.toThrow('could not authorize')
    const result = await f.tool('personal')
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain('private failure')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('keeps root policy active through provider withdrawal without a business plugin owning it', async () => {
    const f = await fixture(() => undefined)
    await f.step('personal'); await f.provider.dispose()
    await vi.waitFor(() => expect(() => f.guard.assertReady()).toThrow())
    await expect(f.step('personal')).rejects.toThrow('could not authorize')
  })
})
