// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaimindAgentProfileService, type AgentBuilderHostSession } from '../src/index.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'paimind-verification-integrity-')); roots.push(base)
  const presetRoot = join(base, 'presets'), presetId = 'own-agent', sessionId = 'own-session'
  await mkdir(join(presetRoot, presetId), { recursive: true })
  await writeFile(join(presetRoot, presetId, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: base\n")
  await writeFile(join(presetRoot, presetId, 'preset.yml'), 'name: Own Agent\n')
  const live = new Map<string, AgentBuilderHostSession>([[sessionId, { id: sessionId, header: { id: sessionId, agentPreset: presetId }, events: [] }]])
  const inspect = vi.fn(async (_id: string): Promise<unknown> => { throw Error('Absent native session') })
  let now = 100
  const context = { reflect: { provide: () => {} }, effect(install: () => void) { install() },
    get: (name: string) => name === 'sessionPersistence' ? { inspect } : undefined,
    sessions: { get: (id: string) => live.get(id) }, agents: { get: () => undefined, list: () => [] },
    tools: { guard: () => () => {} }, agentPresets: { composedPreset: () => undefined }, on: () => () => {} }
  const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, 'state'), now: () => ++now })
  const profile = await service.saveProfile({ agentId: presetId, presetId, name: 'Own Agent', description: '', basePresetId: 'standard',
    role: 'Role', goal: 'Goal', behavior: 'Behavior', preferredSkillNames: [], instructions: '' })
  await service.bindSession({ sessionId, agentId: presetId, presetId, configVersion: profile.configVersion, purpose: 'builder-test' })
  const claimed = { sessionId, agentId: presetId, presetId, configVersion: profile.configVersion, firstTurnId: 'event:3',
    result: 'passed' as const, message: 'Caller-provided success must not be evidence' }
  const set = (events: readonly unknown[]) => { live.set(sessionId, { id: sessionId, header: { id: sessionId, agentPreset: presetId }, events }) }
  const persisted = () => readFile(join(base, 'state/state.json'), 'utf8')
  return { service, live, inspect, profile, sessionId, claimed, set, persisted }
}

function nativeTurn(reason: string | null = 'completed') {
  return [
    { type: 'turn/start', seq: 0, data: { turn: 1 } },
    { type: 'step/start', seq: 1, data: { turn: 1, step: 1 } },
    { type: 'user/message', seq: 2, surfaceOp: 'append', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic request' }] } },
    { type: 'assistant/message', seq: 3, surfaceOp: 'append', data: { turn: 1, step: 1,
      message: { role: 'assistant', source: { kind: 'model', provider: 'fixture-provider', model: 'fixture-model' },
        content: [{ type: 'text', text: 'Synthetic visible reply' }] } } },
    { type: 'step/end', seq: 4, data: { turn: 1, step: 1 } },
    ...(reason === null ? [] : [{ type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: reason } } }]),
  ]
}

describe('Verification receipts require native evidence, not caller claims', () => {
  it('rejects a forged pass for an unknown Session without recording it', async () => {
    const f = await fixture(), before = await f.service.listAudit()
    await expect(f.service.recordVerification({ ...f.claimed, sessionId: 'unknown-session' })).rejects.toThrow()
    expect(await f.service.listAudit()).toEqual(before)
  })
  it('rejects a forged pass for a bound but unused Session', async () => {
    const f = await fixture(), before = await f.service.listAudit()
    await expect(f.service.recordVerification(f.claimed)).rejects.toThrow()
    expect(await f.service.listAudit()).toEqual(before)
  })
  it.each(['running', 'error', 'cancelled', 'aborted', 'rejected'])('does not pass visible text from a %s first turn', async reason => {
    const f = await fixture(); f.set(nativeTurn(reason === 'running' ? null : reason))
    await expect(f.service.verifySession({ sessionId: f.sessionId })).resolves.toMatchObject({ result: 'failed' })
    expect((await f.service.listAudit()).verifications.some(row => row.result === 'passed')).toBe(false)
  })
  it.each(['wrong-turn', 'wrong-step', 'interrupted', 'non-model', 'model-missing', 'provider-missing', 'replacement-only',
    'no-matching-step-end', 'missing-turn-start', 'wrong-turn-end', 'wrong-step-end', 'bad-sequence', 'replaced-human'])('rejects %s reply evidence', async kind => {
    const f = await fixture()
    const events: any[] = nativeTurn()
    const reply = events[3]
    if (kind === 'wrong-turn') reply.data.turn = 2
    if (kind === 'wrong-step') reply.data.step = 2
    if (kind === 'interrupted') reply.data.interrupted = true
    if (kind === 'non-model') reply.data.message.source.kind = 'plugin'
    if (kind === 'model-missing') reply.data.message.source.model = ''
    if (kind === 'provider-missing') reply.data.message.source.provider = ' '
    if (kind === 'replacement-only') reply.surfaceOp = { op: 'replace', start: 2, end: 2 }
    if (kind === 'no-matching-step-end') events.splice(4, 1)
    if (kind === 'missing-turn-start') events.shift()
    if (kind === 'wrong-turn-end') events[5].data.turn = 2
    if (kind === 'wrong-step-end') events[4].data.step = 2
    if (kind === 'bad-sequence') reply.seq = 2
    if (kind === 'replaced-human') events[2].surfaceOp = undefined
    f.set(events)
    await expect(f.service.verifySession({ sessionId: f.sessionId })).resolves.toMatchObject({ result: 'failed' })
  })
  it.each(['tool-only', 'reasoning-only', 'hidden-draft-only', 'empty'])('does not pass %s content as a visible reply', async kind => {
    const f = await fixture(), events: any[] = nativeTurn()
    events[3].data.message.content = kind === 'tool-only' ? [{ type: 'tool-call', name: 'fixture-tool' }]
      : kind === 'reasoning-only' ? [{ type: 'reasoning', text: 'Not visible' }]
        : [{ type: 'text', text: kind === 'hidden-draft-only' ? '<!--PAIMIND_AGENT_DRAFT\n{"goal":"Hidden"}\n-->' : ' ' }]
    f.set(events)
    await expect(f.service.verifySession({ sessionId: f.sessionId })).resolves.toMatchObject({ result: 'failed' })
  })
  it('accepts the final visible reply after an earlier tool-only step within the same completed turn', async () => {
    const f = await fixture(), first: any[] = nativeTurn()
    first[3].data.message.content = [{ type: 'tool-call', name: 'fixture-tool' }]
    const finalStep: any[] = nativeTurn().slice(1, 5)
    finalStep.splice(1, 1)
    for (const event of finalStep) event.data.step = 2
    first.splice(5, 0, ...finalStep)
    for (const [seq, event] of first.entries()) event.seq = seq
    f.set(first)
    await expect(f.service.verifySession({ sessionId: f.sessionId })).resolves.toMatchObject({ result: 'passed', firstTurnId: 'event:6' })
  })
  it('uses the first native human turn even when it contains a queued batch, and keeps exact verification retries stable', async () => {
    const f = await fixture(), events: any[] = nativeTurn()
    events.splice(3, 0, { type: 'user/message', surfaceOp: 'append', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Second queued input' }] } })
    for (const [seq, event] of events.entries()) event.seq = seq
    f.set(events)
    const first = await f.service.verifySession({ sessionId: f.sessionId })
    const stored = await f.persisted()
    expect(first).toMatchObject({ result: 'passed', firstTurnId: 'event:4' })
    await expect(f.service.verifySession({ sessionId: f.sessionId })).resolves.toEqual(first)
    expect((await f.service.listAudit()).verifications).toEqual([first])
    expect(await f.persisted()).toBe(stored)
  })
  it('cannot use a later successful turn to approve the failed first turn', async () => {
    const f = await fixture()
    f.set([...nativeTurn('error'), ...nativeTurn().map(row => ({ ...row, seq: row.seq + 6,
      data: 'turn' in row.data ? { ...row.data, turn: 2 } : row.data }))])
    await expect(f.service.verifySession({ sessionId: f.sessionId })).resolves.toMatchObject({ result: 'failed' })
  })
  it('derives a valid cold-history result and rejects forged legacy metadata without rewriting evidence', async () => {
    const f = await fixture(); f.live.clear()
    f.inspect.mockResolvedValue({ meta: { id: f.sessionId, agentPreset: f.profile.presetId }, events: nativeTurn() })
    const valid = await f.service.verifySession({ sessionId: f.sessionId })
    expect(valid).toMatchObject({ result: 'passed', firstTurnId: 'event:3' })
    for (const forged of [{ agentId: 'forged' }, { presetId: 'forged' }, { configVersion: 'forged' },
      { firstTurnId: 'event:999' }, { result: 'failed' as const }]) {
      await expect(f.service.recordVerification({ ...f.claimed, ...forged })).rejects.toThrow()
      expect((await f.service.listAudit()).verifications).toEqual([valid])
    }
    await expect(f.service.recordVerification(f.claimed)).resolves.toEqual(valid)
    expect(valid.message).not.toContain('Caller-provided')
    expect(f.live.size).toBe(0)
  })
  it.each(['unreadable', 'wrong-identity'])('rejects %s cold history without writing a receipt', async kind => {
    const f = await fixture(), before = await f.persisted(); f.live.clear()
    if (kind === 'wrong-identity') f.inspect.mockResolvedValue({ meta: { id: 'foreign', agentPreset: f.profile.presetId }, events: nativeTurn() })
    await expect(f.service.verifySession({ sessionId: f.sessionId })).rejects.toThrow()
    expect(await f.persisted()).toBe(before)
  })
  it('serializes Profile updates before verification and refuses a stale configuration pass', async () => {
    const f = await fixture(); f.set(nativeTurn())
    const update = f.service.saveProfile({ ...f.profile, behavior: 'Changed configuration', expectedVersion: f.profile.configVersion })
    const check = f.service.verifySession({ sessionId: f.sessionId })
    await update
    await expect(check).resolves.toMatchObject({ result: 'failed', configVersion: f.profile.configVersion })
  })
})
