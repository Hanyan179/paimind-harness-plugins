import { describe, expect, it, vi } from 'vitest'
import { AgentCenterContributionRegistry, type AgentCenterContribution } from '../src/client/contributions.js'
const contribution: AgentCenterContribution = { id: 'enterprise', personalLabel: { zh: '我创建的', en: 'Created by me' },
  tabs: [{ id: 'assigned', zh: '企业分配的', en: 'Assigned', Panel: () => null }], PersonalAction: () => null }

describe('Agent Center UI owner contribution lifecycle', () => {
  it('has a stable empty snapshot, freezes descriptors and rejects duplicate providers', () => {
    const owner = new AgentCenterContributionRegistry(), listener = vi.fn()
    expect(owner.getSnapshot()).toBe(owner.getSnapshot()); owner.subscribe(listener)
    const remove = owner.register(contribution), snapshot = owner.getSnapshot()
    expect(Object.isFrozen(snapshot.contribution?.tabs)).toBe(true)
    expect(Object.isFrozen(snapshot.contribution?.tabs[0])).toBe(true)
    expect(() => owner.register({ ...contribution, id: 'another' })).toThrow(/already present/)
    expect(owner.getSnapshot()).toBe(snapshot)
    remove(); remove(); expect(owner.getSnapshot().contribution).toBeNull(); expect(listener).toHaveBeenCalledTimes(2)
  })
  it('does not let an old disposer remove a returning provider and becomes terminal on owner unload', () => {
    const owner = new AgentCenterContributionRegistry(), listener = vi.fn(), off = owner.subscribe(listener)
    const old = owner.register(contribution); old(); owner.register(contribution); old()
    expect(owner.getSnapshot().contribution).not.toBeNull()
    off(); const calls = listener.mock.calls.length; owner.dispose(); owner.dispose()
    expect(owner.getSnapshot().contribution).toBeNull(); expect(listener).toHaveBeenCalledTimes(calls)
    expect(() => owner.register(contribution)).toThrow(/disposed/)
  })
  it('rejects reserved or duplicate tabs before changing the owner snapshot', () => {
    const owner = new AgentCenterContributionRegistry(), empty = owner.getSnapshot()
    for (const tabs of [[], [{ ...contribution.tabs[0]!, id: 'mine' }], [contribution.tabs[0]!, contribution.tabs[0]!]]) {
      expect(() => owner.register({ ...contribution, tabs })).toThrow(/Invalid/)
      expect(owner.getSnapshot()).toBe(empty)
    }
  })
})
