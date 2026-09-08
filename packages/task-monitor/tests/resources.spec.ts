import { describe, expect, it, vi } from 'vitest'
import { taskCapabilities, taskResourceReader, type TaskResourceConfiguration } from '../src/client/resources.js'

const config: TaskResourceConfiguration = {
  sessionId: 'session-a', presetId: 'internal-agent-id', names: { 'internal-agent-id': 'Writing assistant' },
  skillNames: ['human-writing'], connectionIds: ['a'.repeat(32)], profiles: 'ready', mcps: 'ready',
  connections: [{ id: 'a'.repeat(32), name: 'Personal docs', server: `paimind_${'b'.repeat(20)}`, enabled: true, mounted: true }],
}

describe('task summary configured and used resource projection', () => {
  it('shows bindings before the first call without claiming usage, and deduplicates later usage by exact identity', () => {
    expect(taskCapabilities({ skills: [], mcps: [] }, config, true)).toEqual({
      skills: [{ key: 'human-writing', text: 'human-writing', status: '已挂载' }],
      mcps: [{ key: 'a'.repeat(32), text: 'Personal docs', status: '已挂载' }],
    })
    const used = taskCapabilities({ skills: ['human-writing', 'another-skill'], mcps: [{ server: config.connections[0]!.server, status: 'used' }, { server: 'unused', status: 'available-last-request' }] }, config, true)
    expect(used.skills[0]?.status).toBe('已挂载 · 已加载')
    expect(used.mcps).toEqual([{ key: 'a'.repeat(32), text: 'Personal docs', status: '已挂载 · 已使用' }])
    expect(used.skills[1]?.status).toBe('已加载')
  })
  it('preserves past use after unbinding or disabling without claiming current availability', () => {
    const view = { skills: [], mcps: [{ server: config.connections[0]!.server, status: 'used' }] }
    expect(taskCapabilities(view, { ...config, connectionIds: [] }, false).mcps[0]?.status).toBe('Used')
    const disabled = { ...config, connections: [{ ...config.connections[0]!, enabled: false, mounted: false }] }
    expect(taskCapabilities(view, disabled, true).mcps[0]?.status).toBe('已挂载 · 已停用 · 已使用')
    expect(taskCapabilities(view, { ...config, connections: [], mcps: 'unavailable' }, true).mcps.every(row => !row.text.includes('paimind_') && !row.text.includes('aaaa'))).toBe(true)
  })
  it('reads optional providers independently and chooses the exact selected preset, not the first profile', async () => {
    const read = taskResourceReader({ get: name => ({
      'remote.paimindAgentProfiles': { listProfiles: async () => ({ ok: true, value: { profiles: [
        { presetId: 'other', name: 'Other', preferredSkillNames: ['private-skill'] },
        { presetId: 'internal-agent-id', name: 'Writing assistant', avatarId: 'research-partner', preferredSkillNames: ['human-writing'], connectionIds: config.connectionIds },
      ] } }) },
      'remote.paimindMcpConnections': { summarizeSession: vi.fn(async () => ({ ok: true, value: { items: config.connections } })) },
      connection: { api: { agentPresets: { list: async () => ({ result: { ok: true, value: { presets: [{ id: 'standard', name: 'General assistant' }] } } }) } } },
    })[name] })
    const result = await read('session-a', 'internal-agent-id')
    expect(result.skillNames).toEqual(['human-writing'])
    expect(result.names['internal-agent-id']).toBe('Writing assistant')
    expect(result.names.standard).toBe('General assistant')
    expect(result.avatars).toEqual({ 'internal-agent-id': 'research-partner' })
    expect(result.connectionIds).toEqual(config.connectionIds)
    const missing = await taskResourceReader({ get: () => undefined })('b', 'other')
    expect(missing.profiles).toBe('unavailable')
    expect(missing.skillNames).toEqual([])
    const failure = await taskResourceReader({ get: name => name === 'remote.paimindMcpConnections' ? { summarizeSession: async () => { throw new Error('secret response') } } : undefined })('b')
    expect(failure.mcps).toBe('error')
    expect(JSON.stringify(failure)).not.toContain('secret')
  })
})
