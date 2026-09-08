import { it, expect, vi } from 'vitest'
import {
  paimindContextSession,
  requirePaimindContextCaller,
  assertPaimindContextMutation,
  installPaimindContextSkill,
  type PaimindContextSkillHost,
} from '../src/context-access.js'
function fixture() {
  const agent = {
    id: 'a',
    session: { id: 's', header: { cwd: '/foreign', agentPreset: 'standard' } },
  }
  const workspace = { id: 'w', path: '/work', sessionIds: ['s'] }
  const host = {
    agents: { list: () => [agent] },
    sessions: { get: (id: string) => (id === 's' ? agent.session : undefined) },
    workspaceRegistry: { list: () => [workspace] },
    get: () => ({
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/work' }),
    }),
  }
  return { agent, host }
}
it('uses native session membership rather than a model path and rejects copied caller objects', () => {
  const { host, agent } = fixture()
  expect(paimindContextSession(host, 's').workspace?.id).toBe('w')
  expect(requirePaimindContextCaller(host, { agent } as never)).toBe('s')
  expect(() =>
    requirePaimindContextCaller(host, { agent: { ...agent } } as never),
  ).toThrow('无效')
  expect(() => paimindContextSession(host, 'forged')).toThrow()
})
it('never widens native write policy, including similarly prefixed paths', async () => {
  const { host, agent } = fixture()
  await assertPaimindContextMutation(host, { agent } as never, '/work/output')
  await expect(
    assertPaimindContextMutation(host, { agent } as never, '/work-other'),
  ).rejects.toThrow('ACCESS_DENIED')
  await expect(
    assertPaimindContextMutation(
      { ...host, get: () => undefined },
      { agent } as never,
      '/work',
    ),
  ).rejects.toThrow('SANDBOX_UNAVAILABLE')
})
it('invalidates the native catalog before a step and removes its source on disposal', async () => {
  const { host, agent } = fixture()
  const listeners = new Map<string, Function>()
  let provider: any
  const invalidate = vi.fn(),
    off = vi.fn()
  const scoped = {
    ...agent,
    ctx: {
      get: () => ({
        registerProvider: (factory: Function) => {
          provider = factory({ invalidate })
          return off
        },
      }),
    },
  }
  const definition = {
    name: 'context-library',
    description: '资料',
    content: '当前资料',
  }
  let enabled = true
  const dispose = installPaimindContextSkill(
    {
      ...host,
      agents: { list: () => [scoped] },
      on: (name: string, fn: Function) => {
        listeners.set(name, fn)
        return () => listeners.delete(name)
      },
    } as unknown as PaimindContextSkillHost,
    'paimind-context-library',
    async () => (enabled ? definition : undefined),
  )
  expect(await provider.list()).toHaveLength(1)
  enabled = false
  await listeners.get('agent/pre-step')!({ agent: scoped }, async () => {})
  expect(invalidate).toHaveBeenCalledOnce()
  expect(await provider.get({ name: 'context-library' })).toBeUndefined()
  dispose()
  expect(off).toHaveBeenCalledOnce()
  expect(listeners.size).toBe(0)
  expect(await provider.list()).toEqual([])
})
