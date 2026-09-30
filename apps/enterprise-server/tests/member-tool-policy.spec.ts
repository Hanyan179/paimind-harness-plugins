// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMemberToolGuard, parseMemberCellPolicy, parseManagedCellPolicy, createManagedToolGuard } from '../../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'

const capsule = () => ({ schemaVersion: 1, role: 'member', policy: 'member-personal-v1', cellId: randomUUID(), userId: randomUUID(), tenantId: 'isolated-test' })
describe('immutable member tool policy, not runtime/member acceptance', () => {
  it('accepts one exact policy capsule and binds its digest to the exact bytes', () => {
    const text = JSON.stringify(capsule()); const parsed = parseMemberCellPolicy(text)
    expect(Object.isFrozen(parsed)).toBe(true); expect(parsed.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(parseMemberCellPolicy(text).digest).toBe(parsed.digest)
    expect(parseMemberCellPolicy(text + '\n').digest).not.toBe(parsed.digest)
  })
  it('rejects missing fields, role escalation, arbitrary capabilities and malformed identities', () => {
    for (const change of [{ role: 'admin' }, { policy: 'allow-all' }, { tools: ['*'] }, { cellId: '../foreign' }, { schemaVersion: 2 }, { tenantId: null }]) {
      expect(() => parseMemberCellPolicy(JSON.stringify({ ...capsule(), ...change }))).toThrow()
    }
    for (const text of ['null', '[]', '{}', '{', ' '.repeat(4097)]) expect(() => parseMemberCellPolicy(text)).toThrow()
  })
  it('allows personal authoring and already-managed file/command tools only in a native Agent/Session scope', () => {
    const guard = createMemberToolGuard(parseMemberCellPolicy(JSON.stringify(capsule())))
    for (const name of ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'skill', 'ask_user_question',
      'paimind_agent_prepare_create', 'paimind_agent_skill_binding', 'get_goal', 'create_goal', 'update_goal', 'job_output', 'job_list', 'job_kill']) {
      expect(guard({ name, agentId: 'owned-agent', sessionId: 'owned-session', arguments: {} })).toBeUndefined()
      expect(guard({ name, arguments: {} })).toBeTypeOf('string')
    }
  })
  it('never derives platform rights or network access from tool arguments, guessed names or a Skill', () => {
    const guard = createMemberToolGuard(parseMemberCellPolicy(JSON.stringify(capsule())))
    for (const name of ['web', 'cordis', 'eval', 'paimind_skill_prepare_create', 'paimind_skill_install',
      'credentials.set', 'paimind_plugin_enable', 'unknown_tool']) {
      expect(guard({ name, agentId: 'owned-agent', sessionId: 'owned-session', arguments: { role: 'admin', allow: true } })).toBeTypeOf('string')
    }
  })
})

describe('explicit administrator policy retains the same execution safety floor', () => {
  const admin = () => ({ ...capsule(), role: 'admin', policy: 'admin-authoring-v1' })
  it('requires the exact role-policy pair and does not widen the original member-only entry', () => {
    const text = JSON.stringify(admin()), policy = parseManagedCellPolicy(text)
    expect(policy.role).toBe('admin'); expect(Object.isFrozen(policy)).toBe(true)
    expect(parseManagedCellPolicy(text + '\n').digest).not.toBe(policy.digest)
    expect(() => parseMemberCellPolicy(text)).toThrow()
    expect(() => createMemberToolGuard(policy)).toThrow()
    for (const change of [{ role: 'member' }, { policy: 'member-personal-v1' }, { role: 'owner' },
      { policy: '*' }, { toolAllowlist: ['*'] }, { source: 'browser' }]) {
      expect(() => parseManagedCellPolicy(JSON.stringify({ ...admin(), ...change }))).toThrow()
    }
  })
  it('adds only original Skill authoring owners; missing scope and guessed privileged tools still reject', () => {
    const policy = parseManagedCellPolicy(JSON.stringify(admin())), guard = createManagedToolGuard(policy)
    const member = createManagedToolGuard(parseManagedCellPolicy(JSON.stringify(capsule())))
    for (const name of ['paimind_skill_prepare_create', 'paimind_skill_inspect_github', 'paimind_skill_install']) {
      const call = { name, agentId: 'own-agent', sessionId: 'own-session', arguments: {} }
      expect(guard(call)).toBeUndefined(); expect(member(call)).toBeTypeOf('string')
      expect(guard({ ...call, sessionId: '' })).toBeTypeOf('string')
    }
    for (const name of ['credentials.set', 'cordis', 'eval', 'web', 'docker', 'paimind_plugin_enable', 'unknown_tool']) {
      expect(guard({ name, agentId: 'own-agent', sessionId: 'own-session', arguments: { role: 'admin', allow: true } })).toBeTypeOf('string')
    }
    expect(guard({ name: 'read', agentId: 'own-agent', sessionId: 'own-session' })).toBeUndefined()
  })
})
