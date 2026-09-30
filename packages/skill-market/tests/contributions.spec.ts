import { describe, expect, it, vi } from 'vitest'
import { SkillCenterContributionRegistry } from '../src/client/contributions.js'
const contribution = { id: 'enterprise', zh: '企业分配的', en: 'Assigned', Panel: () => null }
describe('Skill Center UI-only contribution lifecycle', () => {
  it('freezes one provider, rejects duplicates and disposes idempotently', () => {
    const owner = new SkillCenterContributionRegistry(), listener = vi.fn(); owner.subscribe(listener)
    const empty = owner.getSnapshot(); expect(owner.getSnapshot()).toBe(empty)
    const remove = owner.register(contribution); expect(Object.isFrozen(owner.getSnapshot().contribution)).toBe(true)
    expect(() => owner.register(contribution)).toThrow(); remove(); remove(); expect(listener).toHaveBeenCalledTimes(2)
  })
  it('does not let old cleanup remove a replacement provider and cannot register after owner unload', () => {
    const owner = new SkillCenterContributionRegistry(), remove = owner.register(contribution); remove(); owner.register(contribution); remove()
    expect(owner.getSnapshot().contribution).not.toBeNull(); owner.dispose(); owner.dispose()
    expect(owner.getSnapshot().contribution).toBeNull(); expect(() => owner.register(contribution)).toThrow()
  })
  it('validates descriptors without changing the original snapshot', () => {
    const owner = new SkillCenterContributionRegistry(), empty = owner.getSnapshot()
    for (const patch of [{ id: '../unsafe' }, { zh: '' }, { en: ' untrimmed' }, { en: 'a'.repeat(81) }, { SourceAction: 'invalid' as never }]) {
      expect(() => owner.register({ ...contribution, ...patch })).toThrow(); expect(owner.getSnapshot()).toBe(empty)
    }
  })
})
