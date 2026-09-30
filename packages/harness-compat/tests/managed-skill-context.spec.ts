// @vitest-environment node
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureManagedHarnessTerminalOrigins, installManagedHarnessOriginGuard } from '../src/managed-origins.js'

const local = createRequire(import.meta.url), native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const web = createRequire(native.resolve('@deepseek-ai/dsh-web-app/package.json'))
const { Context } = web('@deepseek-ai/cordis'), { AgentLoop } = web('@deepseek-ai/dsh-agent-loop')
const { AgentRegistry } = web('@deepseek-ai/dsh-agent'), { SessionStore, Session } = web('@deepseek-ai/dsh-session')
const { SystemPrompt } = web('@deepseek-ai/dsh-system-prompt'), { ToolRuntime } = web('@deepseek-ai/dsh-tools')
const { LlmRuntime, LlmAdapter, createUserMessage } = web('@deepseek-ai/dsh-llm')
const { SkillRegistry, renderSkillContent } = native('@deepseek-ai/dsh-skill'), ToolSkill = native('@deepseek-ai/dsh-tool-skill')
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })
const origin = (letter: string) => 'paimind-origin-v1.e30.' + letter.repeat(43)
const messages = (agent: any) => agent.session.events.filter((event: any) => event.type === 'user/message').map((event: any) => event.data)
const skillId = '11111111-1111-4111-8111-111111111111'
const jobSource = (requirements: unknown = [skillId]) => ({ kind: 'plugin', plugin: 'tool-jobs', form: 'notice',
  summary: 'Owned task finished', nativeJobId: 'job-hansen', paimindOrigins: ['paimind-origin-v1.' + Buffer.from(JSON.stringify({
    nativeJobId: 'job-hansen', nativeSessionId: 'hansen', delegatedPresetId: 'standard', requiredSkillIds: requirements,
  })).toString('base64url') + '.' + 'j'.repeat(43)] })

async function fixture(guarded = true, useTool = false, hansenSeed?: readonly any[], attest = false, compound?: 'success' | 'failure' | 'cancel') {
  const root = new Context(), requests: any[] = [], revoked = new Set<string>(), loaded = new Set<string>()
  cleanups.push(async () => {
    for (const agent of root.get('agents')?.list() ?? []) agent.cancel({ kind: 'user' })
    await root.fiber.dispose()
  })
  const check = vi.fn(async (input: any) => {
    if (input.sources.some((value: string) => revoked.has(value))) throw Error('Explicit fixture login revoked')
    if (input.requirements?.some((value: string) => revoked.has(value))) throw Error('Explicit fixture Skill revoked')
  })
  const skillCheck = vi.fn(async (_input: any, value: any) => ({ name: value.name,
    publicationId: value.name === 'hansen-method' ? skillId : '22222222-2222-4222-8222-222222222222', packageDigest: 'sha256:' + 'b'.repeat(64) }))
  if (guarded) installManagedHarnessOriginGuard(root, check, attest ? { check: skillCheck, render: renderSkillContent } : undefined)
  // Explicit local code-provider fixture. Original run_code owns the nested
  // tool dispatch, result normalization and context ferry; no real sandbox claim.
  if (compound) root.provide('codeRuntime', { language: 'typescript', isolation: 'process', async run(request: any) {
    const value = await request.bindings[0].functions.skill(JSON.parse(request.program))
    if (compound === 'cancel') root.agents.requireInitiator().cancel({ kind: 'user' })
    return compound === 'failure' ? { logs: [], error: { kind: 'runtime', message: 'Explicit failure after Skill read' } } : { logs: [], value }
  } })
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [SystemPrompt, {}], [LlmRuntime], [ToolRuntime, compound ? { mode: 'code' } : {}], [SkillRegistry], [ToolSkill, {}]]) {
    await root.plugin(plugin, config)
  }
  root.llm.registerAdapter(['local-only'], new class extends LlmAdapter {
    async *stream(request: any) {
      requests.push(request)
      if (useTool && !loaded.has(request.model)) {
        loaded.add(request.model)
        const id = request.model + '-skill-call', name = compound ? 'run_code' : 'skill'
        const args = { name: request.model + '-method' }
        const argumentsText = JSON.stringify(compound ? { code: JSON.stringify(args), description: 'Explicit nested dispatch fixture' } : args)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Explicit local fixture response, not a real model acceptance' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Explicit local fixture response, not a real model acceptance' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  await root.plugin(AgentLoop, { agents: [] })
  const member = async (name: string, letter: string) => {
    const handle = await root.agents.create({ sessionId: name, meta: { agentPreset: 'standard' },
      ...(name === 'hansen' && hansenSeed ? { seed: hansenSeed } : {}), agentOptions: { provider: 'local-only', model: name } })
    let remove = () => {}
    await handle.agent.ctx.plugin({ name: 'fixture-' + name + '-method', inject: ['skills'], apply(context: any) {
      remove = context.skills.register({ name: name + '-method', description: name + ' own method summary',
        content: name + ' private method instructions', source: 'custom' })
    } })
    const prompt = async (text: string, source: object = { kind: 'user', rpcId: origin(letter) }) => {
      handle.agent.followup(createUserMessage({ source, content: [{ type: 'text', text }] }))
      await handle.agent.whenIdle()
    }
    return { handle, agent: handle.agent, remove, prompt, origin: origin(letter) }
  }
  return { root, check, skillCheck, requests, revoked, hansen: await member('hansen', 'h'), alex: await member('alex', 'a') }
}

describe('real native skill catalog/invocation and managed origins with explicit local-only principals/models', () => {
  it.each(['success', 'failure', 'cancel'] as const)('retains newly read provenance through original nested run_code %s delivery', async mode => {
    const f = await fixture(true, true, undefined, true, mode)
    await f.hansen.prompt('Run nested owned method')
    expect(f.skillCheck).toHaveBeenCalledOnce()
    const native = f.hansen.agent.session.events
    const accepted = messages(f.hansen.agent).filter((row: any) => row.source.paimindSkillUse)
    const queued = native.filter((event: any) => event.type === 'agent/inbox/spliced').flatMap((event: any) => event.data.inserted)
      .filter((row: any) => row.source.paimindSkillUse)
    expect([...accepted, ...queued].some((row: any) => row.source.paimindSkillUse.publicationId === skillId)).toBe(true)
    const human = messages(f.hansen.agent).findLast((row: any) => row.source.kind === 'user')
    expect((await captureManagedHarnessTerminalOrigins(f.root, f.hansen.agent, [human, ...(accepted.length ? [] : queued)],
      new AbortController().signal)).input.requirements).toEqual([skillId])
    f.revoked.add(skillId)
    const before = f.requests.length
    await f.hansen.prompt('Continue after assignment denied')
    expect(f.requests).toHaveLength(before)
  })

  it.each(['invocation', 'tool'] as const)('retains newly loaded %s proof through original history and native restore without copying the tool or registry', async mode => {
    let f = await fixture(true, mode === 'tool', undefined, true)
    const definition = f.root.tools.get('skill', f.hansen.agent)
    await f.hansen.prompt(mode === 'tool' ? 'Use method' : '/hansen-method Use method')
    expect(f.requests).toHaveLength(mode === 'tool' ? 2 : 1)
    expect(f.root.tools.get('skill', f.hansen.agent)).toBe(definition)
    expect(f.skillCheck).toHaveBeenCalledOnce()
    expect(f.skillCheck.mock.calls[0]?.[1]).toMatchObject({ name: 'hansen-method', content: 'hansen private method instructions' })
    const used = messages(f.hansen.agent).filter((row: any) => row.source.paimindSkillUse)
    expect(used).toHaveLength(1)
    expect(used[0].source).toMatchObject({ kind: mode === 'tool' ? 'plugin' : 'skill-invocation',
      paimindSkillUse: { name: 'hansen-method', publicationId: skillId, packageDigest: 'sha256:' + 'b'.repeat(64) } })
    const current = messages(f.hansen.agent).findLast((row: any) => row.source.kind === 'user')
    expect((await captureManagedHarnessTerminalOrigins(f.root, f.hansen.agent, [current], new AbortController().signal)).input.requirements).toEqual([skillId])
    const original = f.hansen.agent.session
    const restored = Session.fromRestore('hansen', JSON.parse(JSON.stringify(original.events)), JSON.parse(JSON.stringify(original.header)))
    await f.root.fiber.dispose()
    f = await fixture(true, false, restored.events, true); f.hansen.remove(); f.revoked.add(skillId)
    await f.hansen.prompt('Continue after deselection and revocation')
    expect(f.requests).toHaveLength(0); expect(f.check.mock.calls.at(-1)?.[0].requirements).toEqual([skillId])
    await f.alex.prompt('/alex-method Use own content'); expect(f.requests).toHaveLength(1)
  })

  it('checks a native accepted but previously unconsumed Skill note before its first model request and at terminal capture', async () => {
    const f = await fixture(true, false, undefined, true)
    const note = createUserMessage({ source: { kind: 'plugin', plugin: '@paimind/harness-compat', form: 'notice',
      summary: '已读取企业技能：hansen-method', paimindSkillUse: { name: 'hansen-method', publicationId: skillId, packageDigest: 'sha256:' + 'b'.repeat(64) } },
      content: [{ type: 'text', text: 'Explicit original inbox fixture, not browser evidence' }] })
    const human = createUserMessage({ source: { kind: 'user', rpcId: f.hansen.origin }, content: [{ type: 'text', text: 'Current actor' }] })
    // Persisted by the actual Session owner but not yet accepted into its surface.
    f.hansen.agent.session.append('agent/inbox/spliced', { target: 'followup', start: 0, inserted: [human, note] })
    const stored = f.hansen.agent.session.events.at(-1).data.inserted
    expect((await captureManagedHarnessTerminalOrigins(f.root, f.hansen.agent, stored, new AbortController().signal)).input.requirements).toEqual([skillId])
    f.revoked.add(skillId)
    // Explicit native pre-step producer fixture selects this pending note in
    // the same batch; separate followup calls can start different turns.
    f.root.on('agent/pre-step', async (_event: any, next: any) => {
      const decision = await next(); return decision.kind === 'reject' ? decision : { ...decision, messages: [...decision.messages, note] }
    })
    f.hansen.agent.followup(human); await f.hansen.agent.whenIdle()
    expect(f.requests).toHaveLength(0)
    expect(f.check.mock.calls.at(-1)?.[0].requirements).toEqual([skillId])
  })

  it.each(['denied', 'mismatched-name', 'malformed-reference', 'ordinary'] as const)('handles %s loaded-body evidence without opening authority', async mode => {
    const f = await fixture(true, false, undefined, true)
    if (mode === 'denied') f.skillCheck.mockRejectedValue(Error('Explicit body/authority rejection'))
    if (mode === 'mismatched-name') f.skillCheck.mockResolvedValue({ name: 'alex-method', publicationId: skillId, packageDigest: 'sha256:' + 'b'.repeat(64) })
    if (mode === 'malformed-reference') f.skillCheck.mockResolvedValue({ name: 'hansen-method', publicationId: 'unknown', packageDigest: 'sha256:' + 'b'.repeat(64) })
    if (mode === 'ordinary') f.skillCheck.mockResolvedValue(undefined as never)
    await f.hansen.prompt('/hansen-method Use method')
    expect(f.skillCheck).toHaveBeenCalledOnce()
    expect(f.requests).toHaveLength(mode === 'ordinary' ? 1 : 0)
    expect(messages(f.hansen.agent).filter((row: any) => row.source.paimindSkillUse)).toHaveLength(0)
  })

  it.each([null, 'not-an-array', [skillId, skillId], ['not-a-publication-id'], Array.from({ length: 129 }, (_, i) => `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`)])(
    'fails closed on malformed native-history requirements without treating them as a fresh grant: %j', async requirements => {
      const f = await fixture()
      f.hansen.agent.session.append('user/message', createUserMessage({ source: jobSource(requirements),
        content: [{ type: 'text', text: 'Explicit invalid stored-source fixture' }] }), { surfaceOp: 'append' })
      await f.hansen.prompt('Valid current human request')
      expect(f.requests).toHaveLength(0); expect(f.check).not.toHaveBeenCalled()
    })

  it('retains data requirements without reusing a historical sender login, including native terminal capture', async () => {
    const f = await fixture(), historical = jobSource()
    f.hansen.agent.session.append('user/message', createUserMessage({ source: historical,
      content: [{ type: 'text', text: 'Existing protected result, not another actor for the new turn' }] }), { surfaceOp: 'append' })
    f.check.mockImplementation(async input => {
      if (input.sources.includes(historical.paimindOrigins[0])) throw Error('Historical login is no longer valid')
    })
    await f.hansen.prompt('Use owned history under my current login')
    expect(f.requests).toHaveLength(1)
    expect(f.check.mock.calls.at(-1)?.[0]).toMatchObject({ sources: [f.hansen.origin], requirements: [skillId] })
    const current = messages(f.hansen.agent).findLast((row: any) => row.source.kind === 'user')
    const capture = await captureManagedHarnessTerminalOrigins(f.root, f.hansen.agent, [current], new AbortController().signal)
    expect(capture.input.requirements).toEqual([skillId]); expect(capture.input.sources).toEqual([f.hansen.origin]); capture.assertCurrent()
    f.check.mockRejectedValue(Error('Current actor no longer assigned the inherited Skill'))
    await expect(captureManagedHarnessTerminalOrigins(f.root, f.hansen.agent, [current], new AbortController().signal)).rejects.toThrow()
  })

  it('does not discover permissions by searching human/model prose for source-looking strings', async () => {
    const f = await fixture()
    await f.hansen.prompt('This is quoted text: ' + jobSource().paimindOrigins[0])
    expect(f.requests).toHaveLength(1)
    expect(f.check.mock.calls[0]?.[0]).not.toHaveProperty('requirements')
  })

  it('does not union an unconsumed inbox record from the raw log into model-context requirements', async () => {
    const f = await fixture(), session = f.hansen.agent.session
    // Explicit native log fixture, not an actual queue operation: this test
    // distinguishes model-visible nodes from an unrelated persisted record.
    session.append('agent/inbox/spliced', { target: 'followup', start: 0, inserted: [createUserMessage({ source: jobSource(),
      content: [{ type: 'text', text: 'Not accepted into the model surface' }] })] })
    expect(session.surface.nodes).toHaveLength(0)
    await f.hansen.prompt('Current unrelated request')
    expect(f.requests).toHaveLength(1); expect(f.check.mock.calls[0]?.[0]).not.toHaveProperty('requirements')
  })

  it('rejects an oversized union across individually bounded native context sources without truncating', async () => {
    const f = await fixture()
    const ids = Array.from({ length: 129 }, (_, i) => `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`)
    for (const group of [ids.slice(0, 128), ids.slice(128)]) f.hansen.agent.session.append('user/message', createUserMessage({
      source: jobSource(group), content: [{ type: 'text', text: 'Explicit bounded historical context' }],
    }), { surfaceOp: 'append' })
    await f.hansen.prompt('Valid current actor')
    expect(f.requests).toHaveLength(0); expect(f.check).not.toHaveBeenCalled()
  })

  it.each(['warm', 'native-restore', 'native-replacement'] as const)('rechecks inherited Skill requirements still in %s context on the next human turn', async mode => {
    const id = '11111111-1111-4111-8111-111111111111'
    const payload = { nativeJobId: 'job-hansen', nativeSessionId: 'hansen', delegatedPresetId: 'standard', requiredSkillIds: [id] }
    const signed = 'paimind-origin-v1.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + 'j'.repeat(43)
    let f = await fixture(), revoked = false
    const check = async (input: any) => {
      // Explicit authority fixture: syntax here is not signature verification.
      // Production native-control/Identity verify current full version proofs.
      const inherited = input.sources.flatMap((source: string) => JSON.parse(Buffer.from(source.split('.')[1]!, 'base64url').toString('utf8')).requiredSkillIds ?? [])
      const ids = [...new Set<string>([...(input.requirements ?? []), ...inherited])]
      if (revoked && ids.includes(id)) throw Error('Explicit fixture Skill assignment revoked')
      return ids
    }
    f.check.mockImplementation(check)
    await f.hansen.prompt('Existing governed task output', { kind: 'plugin', plugin: 'tool-jobs', form: 'notice',
      summary: 'Owned task finished', nativeJobId: 'job-hansen', paimindOrigins: [signed] })
    expect(f.requests).toHaveLength(1)
    if (mode === 'native-restore') {
      const original = f.hansen.agent.session
      const restored = Session.fromRestore('hansen', JSON.parse(JSON.stringify(original.events)), JSON.parse(JSON.stringify(original.header)))
      await f.root.fiber.dispose()
      f = await fixture(true, false, restored.events); f.check.mockImplementation(check)
    }
    if (mode === 'native-replacement') for (let replacement = 0; replacement < 3; replacement++) {
      const session = f.hansen.agent.session, nodes = [...session.surface.nodes]
      session.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-compaction', form: 'recall' },
        content: [{ type: 'text', text: 'Explicit replacement fixture derived from the original governed result' }] }),
      { surfaceOp: { op: 'replace', start: nodes[0], end: nodes.at(-1) }, sourceEventSeqs: nodes })
      expect(session.deriveMessages().some((message: any) => message.source.plugin === 'tool-jobs')).toBe(false)
    }
    revoked = true
    const before = f.requests.length
    await f.hansen.prompt('Continue using the existing result')
    expect(f.requests).toHaveLength(before)
    expect(f.check.mock.calls.at(-1)?.[0]).toMatchObject({ nativeSessionId: 'hansen', requirements: [id] })
    await f.alex.prompt('An unrelated member conversation')
    expect(f.requests).toHaveLength(before + 1); expect(f.requests.at(-1).model).toBe('alex')
  })

  it('loads each scoped body through the original model-facing skill tool and preserves native result history', async () => {
    const f = await fixture(true, true)
    await f.hansen.prompt('Use my method'); await f.alex.prompt('Use my own method')
    expect(f.requests).toHaveLength(4)
    for (const member of [f.hansen, f.alex]) {
      const events = member.agent.session.events
      expect(events.filter((event: any) => event.type === 'tool/call').map((event: any) => event.data.name)).toEqual(['skill'])
      const results = events.filter((event: any) => event.type === 'tool/result')
      expect(results).toHaveLength(1); expect(JSON.stringify(results)).toContain(member.agent.id + ' private method instructions')
      expect(JSON.stringify(results)).not.toContain((member === f.hansen ? 'alex' : 'hansen') + ' private method instructions')
      expect(messages(member.agent).filter((row: any) => row.source.kind === 'skill-invocation')).toHaveLength(0)
      expect(f.check.mock.calls.filter(([input]) => input.nativeSessionId === member.agent.id).length).toBeGreaterThanOrEqual(4)
    }
  })
  it.each([false, true])('preserves native scoped catalogs and explicit body injection with guard=%s', async guarded => {
    const f = await fixture(guarded)
    await f.hansen.prompt('/hansen-method 核对客户报价'); await f.alex.prompt('/alex-method 检查市场资料')
    expect(f.requests).toHaveLength(2)
    for (const member of [f.hansen, f.alex]) {
      const rows = messages(member.agent), own = member.agent.id
      expect(rows.filter((row: any) => row.source.kind === 'skill-catalog')).toHaveLength(1)
      expect(rows.find((row: any) => row.source.kind === 'skill-catalog').source.entries)
        .toEqual([{ name: own + '-method', description: own + ' own method summary' }])
      expect(rows.find((row: any) => row.source.kind === 'skill-invocation').source)
        .toEqual({ kind: 'skill-invocation', name: own + '-method', form: 'instructions' })
      expect(JSON.stringify(rows)).toContain(own + ' private method instructions')
      expect(JSON.stringify(rows)).not.toContain((own === 'hansen' ? 'alex' : 'hansen') + ' private method instructions')
      const user = rows.find((row: any) => row.source.kind === 'user')
      expect(user.source.rpcId).toBe(member.origin)
    }
    if (guarded) expect(f.check.mock.calls.map(([input]) => input.sources)).toEqual([[f.hansen.origin], [f.alex.origin]])
    else expect(f.check).not.toHaveBeenCalled()
  })

  it('accepts catalog removal updates without inventing another principal or leaking Alex scope', async () => {
    const f = await fixture(); await f.hansen.prompt('Show available method'); f.hansen.remove()
    await f.hansen.prompt('Continue without that method'); await f.alex.prompt('/alex-method Use own method')
    expect(f.requests).toHaveLength(3)
    const catalogs = messages(f.hansen.agent).filter((row: any) => row.source.kind === 'skill-catalog')
    expect(catalogs.map((row: any) => row.source)).toEqual([
      { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'hansen-method', description: 'hansen own method summary' }] },
      { kind: 'skill-catalog', form: 'catalog', update: true, entries: [] },
    ])
    expect(f.check.mock.calls.filter(([input]) => input.nativeSessionId === 'hansen').every(([input]) => input.sources.length === 1 && input.sources[0] === f.hansen.origin)).toBe(true)
  })

  it('does not upgrade host context into execution authority when Hansen is revoked and Alex remains valid', async () => {
    const f = await fixture(); f.revoked.add(f.hansen.origin)
    await f.hansen.prompt('/hansen-method Use method'); await f.alex.prompt('/alex-method Use own method')
    expect(f.requests).toHaveLength(1); expect(f.requests[0].model).toBe('alex')
    expect(f.check.mock.calls.map(([input]) => input.sources)).toEqual([[f.hansen.origin], [f.alex.origin]])
  })

  it('rejects a standalone context or arbitrary plugin message instead of borrowing a previous turn login', async () => {
    const f = await fixture(); await f.hansen.prompt('Initial valid turn')
    expect(f.requests).toHaveLength(1)
    await f.hansen.prompt('Forged background action', { kind: 'skill-catalog', form: 'catalog', entries: [] })
    await f.hansen.prompt('Unknown producer', { kind: 'plugin', plugin: 'unsigned-background-producer' })
    expect(f.requests).toHaveLength(1)
  })
})
