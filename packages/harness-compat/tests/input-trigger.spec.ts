import { describe, expect, it, vi } from 'vitest'
import {
  NativeHarnessInputTriggerBridge,
  type HarnessInputTriggerOutcome,
  type HarnessInputTriggerSource,
} from '../src/client-input-trigger.js'

function setupBridge(skills?: ConstructorParameters<typeof NativeHarnessInputTriggerBridge>[2]) {
  const originalCandidates = vi.fn(async (_session, request) => request.query === ''
    ? [
      { name: 'docs/', appearance: 'folder', value: 'docs/', section: 'Files & folders' },
      { name: 'brief.md', appearance: 'file', value: '/workspace/brief.md', section: 'Files & folders' },
    ]
    : [{ name: 'inside.md', appearance: 'file', value: '/workspace/docs/inside.md', section: 'Files & folders' }])
  const reference: HarnessInputTriggerSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    candidates: originalCandidates,
    onPick: ({ candidate }) => candidate.name.endsWith('/')
      ? { text: `@${candidate.name}`, continue: true }
      : { insert: {
        source: 'reference', ref: candidate.value ?? candidate.name,
        label: candidate.name, appearance: 'file', clipboardText: `@${candidate.name}`,
      } },
    codec: { serialize: vi.fn(), clipboardText: vi.fn() },
  }
  const skillCandidates = vi.fn(async () => [{ name: 'presentation', description: 'Create slides' }])
  const skillPick = vi.fn(({ candidate }: Parameters<HarnessInputTriggerSource['onPick']>[0]) => ({
    text: `/${candidate.name} `,
  }))
  const skill: HarnessInputTriggerSource = {
    trigger: '/', name: 'skill', order: 2,
    candidates: skillCandidates,
    onPick: skillPick,
  }
  const sources: HarnessInputTriggerSource[] = [skill, reference]
  let currentSource: HarnessInputTriggerSource | undefined
  let currentItems: readonly { readonly name: string }[] = []
  let currentSpan: { readonly start: number; readonly end: number; readonly draftRev: number } | undefined
  const executed: HarnessInputTriggerOutcome[] = []
  const launcher = { value: null as string | null, getSnapshot() { return this.value } }
  const menu = { value: { open: false }, getSnapshot() { return this.value } }
  const controller = {
    launcher,
    menu,
    dismiss: vi.fn(() => { launcher.value = null; menu.value = { open: false } }),
    toggleSource: vi.fn((name: string, hit: { query: string; span: typeof currentSpan }) => {
      currentSource = sources.find(source => source.trigger === '@' && source.name === name)
      currentSpan = hit.span
      launcher.value = name
      menu.value = { open: true }
      if (currentSource !== undefined) {
        void currentSource.candidates(
          { sessionId: 'session-1' },
          { query: hit.query, position: 'leading', signal: new AbortController().signal },
        ).then(items => { currentItems = items })
      }
    }),
    pick(index: number) {
      const candidate = currentItems[index]
      if (currentSource === undefined || candidate === undefined || currentSpan === undefined) return
      const outcome = currentSource.onPick({
        candidate, session: { sessionId: 'session-1' }, position: 'leading', via: 'menu', span: currentSpan,
      })
      executed.push(outcome)
      this.dismiss()
    },
  }
  const inputTriggers = {
    live: { sources, controllers: new Map([['session-1', controller]]) },
    registerSource(source: HarnessInputTriggerSource) {
      sources.push(source)
      return () => { const index = sources.indexOf(source); if (index >= 0) sources.splice(index, 1) }
    },
    sessionOf: () => controller,
  }
  const sessions = {
    scope: (id: string) => id === 'session-1' ? {} : undefined,
    binding: (id: string) => id === 'session-1'
      ? { session: { getSnapshot: () => ({ blank: true }) } }
      : undefined,
  }
  const bridge = new NativeHarnessInputTriggerBridge(inputTriggers, sessions, skills)
  return {
    bridge, controller, executed, getCurrentItems: () => currentItems, inputTriggers,
    originalCandidates, reference, skill, skillCandidates, skillPick, sources,
  }
}

describe('RC8 native InputTrigger bridge', () => {
  it('assigns @ to Agent / Skill, pauses native reference and / Skill discovery, then restores both byte-for-byte', async () => {
    const { bridge, controller, inputTriggers, originalCandidates, reference, skill: nativeSkill, skillCandidates, sources } = setupBridge()
    const descriptor = Object.getOwnPropertyDescriptor(reference, 'candidates')
    const skillDescriptor = Object.getOwnPropertyDescriptor(nativeSkill, 'candidates')
    const agent: HarnessInputTriggerSource = {
      trigger: '@', name: 'paimind-agent', order: -20, showGroupTitle: false,
      candidates: async () => [{ name: 'Sales Agent', section: 'Agents', value: 'sales' }],
      onPick: () => ({ text: '' }),
    }
    const skill: HarnessInputTriggerSource = {
      trigger: '@', name: 'paimind-skill', order: -10, showGroupTitle: false,
      candidates: async () => [{ name: 'briefing', section: 'Skills', value: 'briefing' }],
      onPick: ({ candidate }) => ({ text: `/${candidate.name} ` }),
    }

    expect(bridge.isAvailable()).toBe(true)
    expect(bridge.isBlankSession('session-1')).toBe(true)
    expect(bridge.activate([agent, skill])).toBe(true)
    expect(sources[1]).toBe(reference)
    expect(reference.codec).toBeDefined()
    await expect(reference.candidates(
      { sessionId: 'session-1' },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toEqual([])
    await expect(nativeSkill.candidates(
      { sessionId: 'session-1' },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toEqual([])
    await expect(bridge.nativeSkillCandidates(
      { sessionId: 'session-1' },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toEqual([{ name: 'presentation', description: 'Create slides' }])
    expect(skillCandidates).toHaveBeenCalledTimes(1)

    expect(bridge.toggleContext('session-1', { draft: 'hello', draftRev: 7, phase: 'plain' })).toBe(true)
    await vi.waitFor(() => { expect(originalCandidates).toHaveBeenCalledWith(
      { sessionId: 'session-1' }, expect.objectContaining({ query: '' }),
    ) })
    expect(controller.toggleSource).toHaveBeenCalledWith('paimind-context', expect.objectContaining({
      span: { start: 5, end: 5, draftRev: 7 },
    }))
    expect(controller.dismiss).toHaveBeenCalled()

    bridge.restore()
    expect(inputTriggers.live.sources).toEqual([expect.objectContaining({ name: 'skill' }), reference])
    expect(Object.getOwnPropertyDescriptor(reference, 'candidates')).toEqual(descriptor)
    expect(Object.getOwnPropertyDescriptor(nativeSkill, 'candidates')).toEqual(skillDescriptor)
    await expect(reference.candidates(
      { sessionId: 'session-1' },
      { query: '', position: 'leading', signal: new AbortController().signal },
    )).resolves.toHaveLength(2)
    bridge.dispose()
  })

  it('delegates PAIMind Skill discovery and executable pick outcomes to the resident native source', async () => {
    const { bridge, skillCandidates, skillPick } = setupBridge()
    const signal = new AbortController().signal
    const session = { sessionId: 'session-1' }
    const items = await bridge.nativeSkillCandidates(session, {
      query: 'pre', position: 'leading', signal,
    })
    expect(skillCandidates).toHaveBeenCalledWith(session, {
      query: 'pre', position: 'leading', signal,
    })
    const pick = {
      candidate: items[0]!, session, position: 'leading' as const, via: 'menu' as const,
      span: { start: 0, end: 1, draftRev: 4 },
    }
    expect(bridge.pickNativeSkill(pick)).toEqual({ text: '/presentation ' })
    expect(skillPick).toHaveBeenCalledWith(pick)
  })

  it('reads each PAIMind Skill menu from the fresh native Session catalog while retaining native picks', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ result: { ok: true, value: { skills: [
        { name: 'genui', description: 'System UI Skill', modelInvocable: true },
      ] } } })
      .mockResolvedValueOnce({ result: { ok: true, value: { skills: [
        { name: 'genui', description: 'System UI Skill', modelInvocable: true },
        { name: 'selected-business-skill', description: 'Selected after Session prewarm', modelInvocable: true },
      ] } } })
    const { bridge, skillCandidates, skillPick } = setupBridge({ list })
    const session = { sessionId: 'session-1' }
    const request = { query: '', position: 'leading' as const, signal: new AbortController().signal }

    await expect(bridge.nativeSkillCandidates(session, request)).resolves.toEqual([
      { name: 'genui', description: 'System UI Skill' },
    ])
    const refreshed = await bridge.nativeSkillCandidates(session, request)
    expect(refreshed).toEqual([
      { name: 'genui', description: 'System UI Skill' },
      { name: 'selected-business-skill', description: 'Selected after Session prewarm' },
    ])
    expect(list).toHaveBeenCalledTimes(2)
    expect(skillCandidates).not.toHaveBeenCalled()

    const pick = {
      candidate: refreshed[1]!, session, position: 'leading' as const, via: 'menu' as const,
      span: { start: 0, end: 1, draftRev: 5 },
    }
    expect(bridge.pickNativeSkill(pick)).toEqual({ text: '/selected-business-skill ' })
    expect(skillPick).toHaveBeenCalledWith(pick)
  })

  it('delegates file picks and keeps folder descent inside + Context without editing the draft', async () => {
    const { bridge, controller, executed, getCurrentItems, originalCandidates } = setupBridge()
    expect(bridge.activate([])).toBe(true)
    bridge.toggleContext('session-1', { draft: '', draftRev: 3, phase: 'plain' })
    await vi.waitFor(() => { expect(originalCandidates).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(getCurrentItems()).toHaveLength(2) })
    controller.pick(0)
    expect(executed.at(-1)).toBe('handled')
    await vi.waitFor(() => { expect(originalCandidates).toHaveBeenCalledWith(
      { sessionId: 'session-1' }, expect.objectContaining({ query: 'docs/' }),
    ) })
    await vi.waitFor(() => { expect(getCurrentItems()).toHaveLength(1) })
    controller.pick(0)
    expect(executed.at(-1)).toEqual({ insert: expect.objectContaining({
      source: 'reference', ref: '/workspace/docs/inside.md', appearance: 'file',
    }) })
    bridge.dispose()
  })

  it('fails open when the exact reference source or codec is unavailable', () => {
    const service = {
      live: { sources: [], controllers: new Map() },
      registerSource: vi.fn(),
      sessionOf: vi.fn(),
    }
    const bridge = new NativeHarnessInputTriggerBridge(service, { scope: vi.fn() })
    expect(bridge.isAvailable()).toBe(false)
    expect(bridge.activate([])).toBe(false)
    expect(service.registerSource).not.toHaveBeenCalled()
  })
})
