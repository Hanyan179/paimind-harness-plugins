// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaimindAgentProfileService, type AgentBuilderHostSession } from '../src/index.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'paimind-session-integrity-')); roots.push(base)
  const presetRoot = join(base, 'presets'), stateRoot = join(base, 'state')
  const presetId = 'own-agent', source = join(presetRoot, presetId)
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: base\n")
  await writeFile(join(source, 'preset.yml'), 'name: Own Agent\n')
  const live = new Map<string, AgentBuilderHostSession>()
  const inspect = vi.fn(async (_id: string) => { throw Error('Native session not found') })
  const remove = vi.fn(async (_presetId: string) => { await rm(source, { recursive: true }) })
  const context = {
    reflect: { provide: () => {} }, effect(install: () => void) { install() },
    get: (name: string) => name === 'sessionPersistence' ? { inspect } : undefined,
    sessions: { get: (id: string) => live.get(id) },
    agents: { get: () => undefined, list: () => [] },
    tools: { guard: () => () => {} }, agentPresets: { composedPreset: () => undefined, remove }, on: () => () => {},
  }
  const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot, now: () => 100 })
  const input = { agentId: presetId, presetId, name: 'Own Agent', description: '', basePresetId: 'standard',
    role: 'Role', goal: 'Goal', behavior: 'Behavior', preferredSkillNames: [], instructions: '' }
  const profile = await service.saveProfile(input)
  const native = (sessionId: string, selected = presetId): AgentBuilderHostSession => ({
    id: sessionId, header: { id: sessionId, agentPreset: 'standard' },
    events: [{ type: 'agent-preset/selected', data: { agentPreset: selected } }],
  })
  const binding = (sessionId: string, configVersion = profile.configVersion) => ({
    sessionId, agentId: presetId, presetId, configVersion, purpose: 'conversation' as const,
  })
  const persisted = () => readFile(join(stateRoot, 'state.json'), 'utf8').catch(() => undefined)
  const writeState = async (value: string) => {
    await mkdir(stateRoot, { recursive: true })
    await writeFile(join(stateRoot, 'state.json'), value)
  }
  return { service, context, live, inspect, remove, input, profile, native, binding, persisted, writeState, stateRoot, presetRoot }
}

describe('Agent-owned binding integrity over native Session identity', () => {
  it.each(['unknown-session', 'other-member-known-session'])('rejects %s without writing a phantom binding', async sessionId => {
    const f = await fixture(), before = await f.persisted()
    await expect(f.service.bindSession(f.binding(sessionId))).rejects.toThrow()
    expect(await f.persisted()).toBe(before)
    await expect(f.service.listSessionBindings()).resolves.toEqual({ bindings: [] })
  })

  it.each(['wrong-native-identity', 'wrong-selected-preset'])('rejects %s without changing state', async kind => {
    const f = await fixture(), id = 'own-session', before = await f.persisted()
    f.live.set(id, kind === 'wrong-native-identity' ? f.native('different-id') : f.native(id, 'other-agent'))
    await expect(f.service.bindSession(f.binding(id))).rejects.toThrow()
    expect(await f.persisted()).toBe(before)
  })

  it('binds a real selected native Session, retains a stable receipt on retry, and refuses rewriting its historical version', async () => {
    const f = await fixture(), id = 'own-session'
    f.live.set(id, f.native(id))
    const first = await f.service.bindSession(f.binding(id)), stored = await f.persisted()
    await expect(f.service.bindSession(f.binding(id))).resolves.toEqual(first)
    expect(await f.persisted()).toBe(stored)
    f.live.set(id, { ...f.native(id), events: [...f.native(id).events!,
      { type: 'user/message', data: { source: { kind: 'user' } } }] })
    const next = await f.service.saveProfile({ ...f.input, behavior: 'Updated behavior', expectedVersion: f.profile.configVersion })
    await expect(f.service.bindSession(f.binding(id, next.configVersion))).rejects.toThrow()
    expect(await f.persisted()).toBe(stored)
  })

  it('does not use a preset selected after the first human turn to relabel historical execution', async () => {
    const f = await fixture(), id = 'own-session'
    f.live.set(id, { id, header: { id, agentPreset: 'other-agent' }, events: [
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'agent-preset/selected', data: { agentPreset: f.profile.presetId } },
    ] })
    await expect(f.service.bindSession(f.binding(id))).rejects.toThrow()
    expect(await f.persisted()).toBeUndefined()
  })

  it('reads cold historical identity through the native persistence inspector without publishing a live Session', async () => {
    const f = await fixture(), id = 'cold-session', native = f.native(id)
    f.inspect.mockResolvedValue({ meta: native.header, events: native.events } as never)
    await expect(f.service.bindSession(f.binding(id))).resolves.toMatchObject(f.binding(id))
    expect(f.inspect).toHaveBeenCalledWith(id, expect.any(AbortSignal))
    expect(f.live.size).toBe(0)
  })

  it('validates migration source, exact server plan and native target before writing the binding', async () => {
    const f = await fixture(), sourceId = 'old-session', targetId = 'new-session'
    f.live.set(sourceId, f.native(sourceId))
    await f.service.bindSession(f.binding(sourceId))
    const updated = await f.service.saveProfile({ ...f.input, behavior: 'Updated', expectedVersion: f.profile.configVersion })
    const plan = await f.service.migrationPlan({ sourceSessionId: sourceId })
    expect(plan?.toVersion).toBe(updated.configVersion)
    const before = await f.persisted()
    await expect(f.service.recordMigration({ ...plan!, targetSessionId: targetId })).rejects.toThrow()
    expect(await f.persisted()).toBe(before)
    f.live.set(targetId, f.native(targetId))
    for (const forged of [{ sourceSessionId: 'unknown-source' }, { toVersion: 'invented-version' },
      { fromVersion: 'invented-version' }, { summary: 'invented-summary' }, { targetSessionId: sourceId }]) {
      await expect(f.service.recordMigration({ ...plan!, targetSessionId: targetId, ...forged })).rejects.toThrow()
      expect(await f.persisted()).toBe(before)
    }
    const record = await f.service.recordMigration({ ...plan!, targetSessionId: targetId })
    await expect(f.service.recordMigration({ ...plan!, targetSessionId: targetId })).resolves.toEqual(record)
    const audit = await f.service.listAudit()
    expect(audit.migrations).toEqual([record])
    const bindings = (await f.service.listSessionBindings()).bindings
    expect(bindings).toHaveLength(2)
    expect(bindings.find(row => row.sessionId === sourceId)?.configVersion).toBe(f.profile.configVersion)
    expect(bindings.find(row => row.sessionId === targetId)?.configVersion).toBe(updated.configVersion)
  })

  it.each([
    ['truncated JSON', '{"schemaVersion":1,"bindings":'],
    ['future version', JSON.stringify({ schemaVersion: 2, bindings: {}, migrations: [], verifications: [] })],
    ['array bindings', JSON.stringify({ schemaVersion: 1, bindings: [], migrations: [], verifications: [] })],
    ['null binding', JSON.stringify({ schemaVersion: 1, bindings: { kept: null }, migrations: [], verifications: [] })],
    ['incomplete binding', JSON.stringify({ schemaVersion: 1, bindings: { kept: { sessionId: 'kept' } }, migrations: [], verifications: [] })],
    ['incomplete migration', JSON.stringify({ schemaVersion: 1, bindings: {}, migrations: [{}], verifications: [] })],
    ['incomplete verification', JSON.stringify({ schemaVersion: 1, bindings: {}, migrations: [], verifications: [{}] })],
  ])('does not treat %s as an empty history or overwrite it', async (_name, raw) => {
    const f = await fixture(), id = 'new-session'
    f.live.set(id, f.native(id))
    await f.writeState(raw)
    await expect(f.service.listSessionBindings()).rejects.toThrow('状态')
    await expect(f.service.listAudit()).rejects.toThrow('状态')
    await expect(f.service.bindSession(f.binding(id))).rejects.toThrow('状态')
    await expect(f.service.removeProfile({ presetId: f.profile.presetId })).rejects.toThrow('状态')
    expect(f.remove).not.toHaveBeenCalled()
    expect(await f.persisted()).toBe(raw)
    expect((await f.service.listProfiles()).profiles).toHaveLength(1)
  })

  it('rejects mismatched binding identity and invalid row values without losing valid adjacent history', async () => {
    const f = await fixture(), id = 'kept-session'
    const valid = { ...f.binding(id), boundAt: 100 }
    for (const patch of [{ sessionId: 'different-session' }, { presetId: '../foreign-agent' },
      { configVersion: '' }, { boundAt: -1 }, { purpose: 'enterprise-admin' }]) {
      const raw = JSON.stringify({ schemaVersion: 1, bindings: { [id]: { ...valid, ...patch } }, migrations: [], verifications: [] })
      await f.writeState(raw)
      await expect(f.service.removeProfile({ presetId: f.profile.presetId })).rejects.toThrow('状态')
      expect(await f.persisted()).toBe(raw)
    }
    expect(f.remove).not.toHaveBeenCalled()
  })

  it('fails closed on an unreadable state path rather than deleting a profile', async () => {
    const f = await fixture()
    await mkdir(join(f.stateRoot, 'state.json'), { recursive: true })
    await expect(f.service.listSessionBindings()).rejects.toThrow('状态')
    await expect(f.service.removeProfile({ presetId: f.profile.presetId })).rejects.toThrow('状态')
    expect(f.remove).not.toHaveBeenCalled()
  })

  it('preserves valid legacy rows without purpose across a service restart and blocks deletion', async () => {
    const f = await fixture(), id = 'legacy-session'
    const { purpose: _purpose, ...binding } = f.binding(id)
    const row = { ...binding, boundAt: 100 }
    const raw = JSON.stringify({ schemaVersion: 1, bindings: { [id]: row }, migrations: [], verifications: [] })
    await f.writeState(raw)
    const restarted = new PaimindAgentProfileService(f.context as never, { presetRoot: f.presetRoot, stateRoot: f.stateRoot })
    await expect(restarted.listSessionBindings()).resolves.toEqual({ bindings: [row] })
    await expect(restarted.removeProfile({ presetId: f.profile.presetId })).rejects.toThrow('仍被 1 个历史会话使用')
    expect(f.remove).not.toHaveBeenCalled()
    expect(await f.persisted()).toBe(raw)
  })

  it('keeps binding writes behind native deletion in the existing product mutation queue', async () => {
    const f = await fixture(), id = 'racing-session'
    f.live.set(id, f.native(id))
    const entered = Promise.withResolvers<void>(), proceed = Promise.withResolvers<void>()
    f.remove.mockImplementationOnce(async () => {
      entered.resolve(); await proceed.promise
      await rm(join(f.presetRoot, f.profile.presetId), { recursive: true })
    })
    // Remove filesystem timing from the queue assertion. The public binding
    // still validates the real profile and real fixture native identity.
    const internal = f.service as unknown as {
      readState(): Promise<{ schemaVersion: 1; bindings: {}; migrations: []; verifications: [] }>
      requireBindingProfile(input: unknown): Promise<unknown>
    }
    const readState = vi.spyOn(internal, 'readState').mockResolvedValue({ schemaVersion: 1, bindings: {}, migrations: [], verifications: [] })
    const checkProfile = vi.spyOn(internal, 'requireBindingProfile')
    const deleting = f.service.removeProfile({ presetId: f.profile.presetId })
    await entered.promise
    const binding = f.service.bindSession(f.binding(id))
    let outcomes: PromiseSettledResult<unknown>[] = []
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(checkProfile).not.toHaveBeenCalled()
    } finally {
      proceed.resolve()
      outcomes = await Promise.allSettled([deleting, binding])
      readState.mockRestore(); checkProfile.mockRestore()
    }
    expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(await f.persisted()).toBeUndefined()
  })

  it('does not poison the mutation queue after native deletion fails', async () => {
    const f = await fixture(), id = 'usable-session'
    f.remove.mockRejectedValueOnce(new Error('Native deletion unavailable'))
    await expect(f.service.removeProfile({ presetId: f.profile.presetId })).rejects.toThrow('Native deletion unavailable')
    f.live.set(id, f.native(id))
    await expect(f.service.bindSession(f.binding(id))).resolves.toMatchObject(f.binding(id))
    await expect(f.service.removeProfile({ presetId: f.profile.presetId })).rejects.toThrow('仍被 1 个历史会话使用')
    expect(f.remove).toHaveBeenCalledTimes(1)
  })
})
