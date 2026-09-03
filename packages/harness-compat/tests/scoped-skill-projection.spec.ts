import { describe, expect, it, vi } from 'vitest'
import {
  installPaimindScopedSkillProjection,
  resolvePaimindLiveAgentPreset,
  type PaimindScopedSkillAgent,
} from '../src/host.js'

function fixture() {
  let provider: {
    readonly name: string
    list(): Promise<readonly Record<string, unknown>[]>
    get(candidate: Record<string, unknown>): Promise<Record<string, unknown> | undefined>
  } | undefined
  const invalidate = vi.fn()
  const dispose = vi.fn()
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: {} },
    ctx: {
      get(name: 'skills') {
        expect(name).toBe('skills')
        return {
          registerProvider(create: (control: { readonly signal: AbortSignal; invalidate(): void }) => typeof provider) {
            provider = create({ signal: new AbortController().signal, invalidate })
            return dispose
          },
        }
      },
    },
  } as unknown as PaimindScopedSkillAgent
  return { agent, invalidate, dispose, provider: () => provider }
}

describe('scoped Skill projection compatibility seam', () => {
  it('waits for an in-flight initial refresh before serving native reads', async () => {
    const test = fixture()
    const projection = installPaimindScopedSkillProjection(test.agent, [])
    let finish!: () => void
    const refresh = new Promise<void>((resolve) => { finish = resolve })
    projection.setRefreshBarrier(refresh)
    const pendingRows = test.provider()!.list()
    projection.replace([{
      name: 'selected-method',
      description: 'Selected before the live Agent was created.',
      content: 'Selected method instructions.',
    }])

    let settled = false
    void pendingRows.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    finish()

    await expect(pendingRows).resolves.toMatchObject([{ name: 'selected-method' }])
  })

  it('prefers the live composed Preset over a stale Session header', () => {
    const agent = {
      id: 'session-1',
      session: { id: 'session-1', header: { agentPreset: 'paimind' } },
      ctx: {
        get(name: 'skills' | 'agentPresets') {
          return name === 'agentPresets' ? { composedPreset: () => 'managed-agent' } : undefined
        },
      },
    } as unknown as PaimindScopedSkillAgent
    expect(resolvePaimindLiveAgentPreset(agent)).toBe('managed-agent')
  })

  it('falls back to the Session header only when the native Preset service is unavailable', () => {
    const withoutService = {
      id: 'session-1', session: { id: 'session-1', header: { agentPreset: 'legacy-agent' } },
      ctx: { get: () => undefined },
    } as unknown as PaimindScopedSkillAgent
    const unjoinedLiveAgent = {
      id: 'session-2', session: { id: 'session-2', header: { agentPreset: 'stale-agent' } },
      ctx: {
        get(name: 'skills' | 'agentPresets') {
          return name === 'agentPresets' ? { composedPreset: () => undefined } : undefined
        },
      },
    } as unknown as PaimindScopedSkillAgent

    expect(resolvePaimindLiveAgentPreset(withoutService)).toBe('legacy-agent')
    expect(resolvePaimindLiveAgentPreset(unjoinedLiveAgent)).toBeUndefined()
  })

  it('registers one native Agent-scoped provider and replaces its immutable catalog', async () => {
    const test = fixture()
    const projection = installPaimindScopedSkillProjection(test.agent, [{
      name: 'risk-review',
      description: 'Review delivery risk',
      content: 'Use the risk checklist.',
      resourceDirectory: '/skills/risk-review',
    }])
    const first = await test.provider()?.list()
    expect(first).toEqual([expect.objectContaining({
      name: 'risk-review',
      provider: 'paimind-session-business-skills',
      resourceBase: { kind: 'directory', path: '/skills/risk-review' },
    })])
    await expect(test.provider()?.get(first?.[0] ?? {})).resolves.toEqual(expect.objectContaining({
      name: 'risk-review',
      content: 'Use the risk checklist.',
    }))

    projection.replace([{
      name: 'shipment-check',
      description: 'Check shipment dates',
      content: 'Check every promised date.',
    }])
    expect(test.invalidate).toHaveBeenCalledTimes(1)
    expect((await test.provider()?.list())?.map(row => row.name)).toEqual(['shipment-check'])
  })

  it('rejects a duplicate replacement before changing the live snapshot', () => {
    const test = fixture()
    const projection = installPaimindScopedSkillProjection(test.agent, [{
      name: 'risk-review', description: 'Review delivery risk', content: 'Initial body.',
    }])
    expect(() => projection.replace([
      { name: 'risk-review', description: 'First', content: 'First.' },
      { name: 'risk-review', description: 'Second', content: 'Second.' },
    ])).toThrow('duplicate scoped Skill name')
    expect(projection.snapshot()).toHaveLength(1)
    expect(test.invalidate).not.toHaveBeenCalled()
  })

  it('supports non-invocable tombstones and disposes the native registration once', async () => {
    const test = fixture()
    const projection = installPaimindScopedSkillProjection(test.agent, [{
      name: 'disabled-business-skill',
      description: 'Disabled by user policy',
      content: '',
      modelInvocable: false,
      userInvocable: false,
    }])
    expect(await test.provider()?.list()).toEqual([expect.objectContaining({
      name: 'disabled-business-skill',
      invocation: { modelInvocable: false, userInvocable: false },
    })])
    projection.dispose()
    projection.dispose()
    expect(test.dispose).toHaveBeenCalledTimes(1)
    expect(() => projection.replace([])).toThrow('disposed')
  })
})
