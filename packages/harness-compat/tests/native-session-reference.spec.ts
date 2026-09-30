// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listPaimindNativeFirstHumanTurnReplies, readPaimindNativeSessionReference, readPaimindNativeSessionPresetReference, readPaimindNativeSessionCreationReference, readPaimindNativeSessionDirectoryReference } from '../src/host.js'

describe('native Session reference compatibility boundary', () => {
  it('reads only the original live or cold directory without resuming or changing the existing detached reference', async () => {
    const session = { header: { id: 'owned', cwd: '/workspace/Hansen 项目', agentPreset: 'standard' }, events: [] }
    const inspect = vi.fn(async () => ({ meta: session.header, events: session.events }))
    for (const live of [undefined, session]) {
      const context = { sessions: { get: () => live }, get: () => ({ inspect }) }
      expect(await readPaimindNativeSessionDirectoryReference(context, 'owned', new AbortController().signal))
        .toEqual({ sessionId: 'owned', cwd: '/workspace/Hansen 项目' })
      expect((await readPaimindNativeSessionReference(context, 'owned')).header).toEqual({ id: 'owned', agentPreset: 'standard' })
    }
    expect(inspect).toHaveBeenCalledTimes(2)
    const get = vi.fn()
    await expect(readPaimindNativeSessionDirectoryReference({ sessions: { get }, get }, 'owned', AbortSignal.abort())).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })
  it.each([undefined, '', 'relative', '/workspace/../escape', '/workspace\0'])('rejects unavailable or noncanonical session cwd %s', async cwd => {
    const context = { sessions: { get: () => ({ header: { id: 'owned', cwd }, events: [] }) }, get: () => undefined }
    await expect(readPaimindNativeSessionDirectoryReference(context, 'owned', new AbortController().signal)).rejects.toThrow('目录无法验证')
  })
  it('resolves an absent preallocated ID through native revision absence and the original default owner', async () => {
    const revision = vi.fn(async () => undefined), resolve = vi.fn(async () => ({ id: 'allowed-default' }))
    const context = { sessions: { get: () => undefined }, get: (name: string) => name === 'sessionPersistence' ? { readStoredRevision: revision } : { resolve } }
    const result = await readPaimindNativeSessionCreationReference(context, 'new-id', new AbortController().signal)
    expect(result).toEqual({ sessionId: 'new-id', kind: 'new', agentPreset: 'allowed-default' })
    expect(revision).toHaveBeenCalledTimes(2); expect(resolve).toHaveBeenCalledExactlyOnceWith()
    expect(await readPaimindNativeSessionCreationReference(context, undefined, new AbortController().signal))
      .toEqual({ sessionId: null, kind: 'new', agentPreset: 'allowed-default' })
    expect(revision).toHaveBeenCalledTimes(2)
  })
  it('does not turn failed or unsupported persistence into a new session', async () => {
    const resolve = vi.fn(async () => ({ id: 'standard' }))
    for (const persistence of [{}, { readStoredRevision: async () => { throw Error('Storage failed') } },
      { readStoredRevision: async () => 'stored-corrupt', inspect: async () => { throw Error('Corrupt history') } }]) {
      const context = { sessions: { get: () => undefined }, get: (name: string) => name === 'sessionPersistence' ? persistence : { resolve } }
      await expect(readPaimindNativeSessionCreationReference(context, 'existing', new AbortController().signal)).rejects.toThrow()
    }
    expect(resolve).not.toHaveBeenCalled()
  })
  it('prefers an original session published while the default lookup was in flight', async () => {
    let current: object | undefined
    const resolve = vi.fn(async () => { current = { header: { id: 'owned', agentPreset: 'original-history' }, events: [] }; return { id: 'standard' } })
    const context = { sessions: { get: () => current }, get: (name: string) => name === 'sessionPersistence'
      ? { readStoredRevision: async () => undefined } : { resolve } }
    expect(await readPaimindNativeSessionCreationReference(context, 'owned', new AbortController().signal))
      .toEqual({ sessionId: 'owned', kind: 'existing', agentPreset: 'original-history' })
  })
  it('uses the original last-selection resolver and returns no messages or header metadata', async () => {
    const session = { id: 'owned', header: { id: 'owned', agentPreset: 'creation-preset' }, events: [
      { type: 'agent-preset/selected', data: { agentPreset: 'first-selection' } },
      { type: 'agent-preset/selected', data: { agentPreset: 'actual-selection' } },
      { type: 'user/message', data: { content: 'PRIVATE_HISTORY' } }, { type: 'turn/end', data: {} },
    ] }
    const context = { sessions: { get: () => session }, get: () => undefined }
    expect(await readPaimindNativeSessionPresetReference(context, 'owned', new AbortController().signal))
      .toEqual({ sessionId: 'owned', agentPreset: 'actual-selection', hasForkBoundary: true })
    const abort = new AbortController(); abort.abort()
    await expect(readPaimindNativeSessionPresetReference(context, 'owned', abort.signal)).rejects.toThrow()
  })
  it('distinguishes an uncomposed/blank source and fails closed on malformed selected identity', async () => {
    const session = { header: { id: 'owned' }, events: [] as object[] }, context = { sessions: { get: () => session }, get: () => undefined }
    expect(await readPaimindNativeSessionPresetReference(context, 'owned', new AbortController().signal))
      .toEqual({ sessionId: 'owned', agentPreset: null, hasForkBoundary: false })
    session.events.push({ type: 'agent-preset/selected', data: { agentPreset: '../foreign' } })
    await expect(readPaimindNativeSessionPresetReference(context, 'owned', new AbortController().signal)).rejects.toThrow('身份无法验证')
  })
  it.each(['', ' own-session', 'own-session\0', 'x'.repeat(201)])('rejects noncanonical identity before consulting a native owner', async id => {
    const get = vi.fn(), context = { sessions: { get }, get: vi.fn() }
    await expect(readPaimindNativeSessionReference(context, id)).rejects.toThrow('标识无效')
    expect(get).not.toHaveBeenCalled(); expect(context.get).not.toHaveBeenCalled()
  })

  it('rejects absent historical capability, corrupt metadata and cold read failures', async () => {
    const sessions = { get: () => undefined }
    await expect(readPaimindNativeSessionReference({ sessions, get: () => undefined }, 'owned')).rejects.toThrow('检查服务不可用')
    await expect(readPaimindNativeSessionReference({ sessions, get: () => ({
      inspect: async () => ({ meta: { id: 'foreign' }, events: [] }),
    }) }, 'owned')).rejects.toThrow('身份或历史无法验证')
    await expect(readPaimindNativeSessionReference({ sessions, get: () => ({
      inspect: async () => { throw Error('private backend path must not escape') },
    }) }, 'owned')).rejects.toThrow('原生会话不存在或历史无法读取')
  })

  it('prefers a concurrently published native Session over an earlier cold snapshot', async () => {
    const current = { id: 'owned', header: { id: 'owned', agentPreset: 'newer-agent' }, events: [] }
    const get = vi.fn().mockReturnValueOnce(undefined).mockReturnValue(current)
    const result = await readPaimindNativeSessionReference({ sessions: { get }, get: () => ({
      inspect: async () => ({ meta: { id: 'owned', agentPreset: 'old-agent' }, events: [] }),
    }) }, 'owned')
    expect(result.header.agentPreset).toBe('newer-agent')
    expect(Object.isFrozen(result.events)).toBe(true)
  })

  it('reads actual native live and cold JSONL Sessions across owner restarts without publishing or changing history', async () => {
    // Resolve exact installed first-party owners through the selected CLI web
    // composition, not a copied implementation or a new production dependency.
    const local = createRequire(new URL('../../../package.json', import.meta.url))
    const cli = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
    const web = createRequire(cli.resolve('@deepseek-ai/dsh-web-app/package.json'))
    const { SessionStore } = web('@deepseek-ai/dsh-session')
    const { JsonlSessionPersistence } = web('@deepseek-ai/dsh-session-persistence-jsonl')
    const { createUserMessage, createAssistantMessage } = web('@deepseek-ai/dsh-llm')
    const base = await mkdtemp(join(tmpdir(), 'paimind-native-session-ref-'))
    const roots: Context[] = []
    const boot = async (folder: string) => {
      const root = new Context(); roots.push(root)
      await root.plugin(SessionStore)
      await root.plugin(JsonlSessionPersistence, { root: join(base, folder), compression: 'none' })
      return root
    }
    try {
      const first = await boot('hansen')
      const sessions = first.get('sessions')
      const session = sessions.create('native-owned-session', { meta: { cwd: base, agentPreset: 'own-agent' } })
      session.append('agent-preset/selected', { agentPreset: 'own-selected-agent' })
      // Synthetic messages exercise real durable event validation; this is
      // explicitly NOT a model reply or a business conversation acceptance.
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Synthetic request' }] }), { surfaceOp: 'append' })
      const message = createAssistantMessage({ source: { provider: 'fixture-provider', model: 'fixture-model' },
        content: [{ type: 'text', text: 'Synthetic response; no model was called' }] })
      session.append('assistant/message', { turn: 1, step: 1, message }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await sessions.flush(session)
      const warm = await readPaimindNativeSessionReference(first as never, session.id)
      const directoryReference = await readPaimindNativeSessionDirectoryReference(first as never, session.id, new AbortController().signal)
      expect(directoryReference).toEqual({ sessionId: session.id, cwd: base })
      const presetReference = await readPaimindNativeSessionPresetReference(first as never, session.id, new AbortController().signal)
      expect(presetReference).toEqual({ sessionId: session.id, agentPreset: 'own-selected-agent', hasForkBoundary: true })
      const creationReference = { sessionId: session.id, kind: 'existing', agentPreset: 'own-selected-agent' }
      expect(await readPaimindNativeSessionCreationReference(first as never, session.id, new AbortController().signal)).toEqual(creationReference)
      const replies = listPaimindNativeFirstHumanTurnReplies(warm)
      expect(replies).toEqual([{ seq: expect.any(Number), content: message.content }])
      const stored = await first.get('sessionPersistence').readRaw(session.id)
      expect(stored?.content).toContain('turn/end')
      await first.fiber.dispose()
      const recovered = await boot('hansen')
      expect(recovered.get('sessions').get(session.id)).toBeUndefined()
      expect(await readPaimindNativeSessionDirectoryReference(recovered as never, session.id, new AbortController().signal)).toEqual(directoryReference)
      await expect(readPaimindNativeSessionReference(recovered as never, session.id)).resolves.toEqual(warm)
      await expect(readPaimindNativeSessionPresetReference(recovered as never, session.id, new AbortController().signal)).resolves.toEqual(presetReference)
      expect(await readPaimindNativeSessionCreationReference(recovered as never, session.id, new AbortController().signal)).toEqual(creationReference)
      expect(listPaimindNativeFirstHumanTurnReplies(await readPaimindNativeSessionReference(recovered as never, session.id))).toEqual(replies)
      expect(recovered.get('sessions').list()).toHaveLength(0)
      expect((await recovered.get('sessionPersistence').readRaw(session.id))?.content).toBe(stored?.content)
      const other = await boot('alex')
      await expect(readPaimindNativeSessionDirectoryReference(other as never, session.id, new AbortController().signal)).rejects.toThrow('原生会话不存在')
      await expect(readPaimindNativeSessionReference(other as never, session.id)).rejects.toThrow('原生会话不存在')
      expect(other.get('sessions').list()).toHaveLength(0)
      expect(await other.get('sessionPersistence').list()).toHaveLength(0)
    } finally {
      for (const root of roots.reverse()) await root.fiber.dispose()
      await rm(base, { recursive: true, force: true })
    }
  }, 20_000)
})
