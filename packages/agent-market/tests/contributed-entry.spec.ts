import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCenterRuntime } from '../src/client/index.js'

const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.restoreAllMocks() })

/** Client service fixtures only. Server-side current grants and actual native
 * owner behavior are independently tested; this is not Browser E2E. */
function fixture(blank = true) {
  const rows: Record<string, { id: string; blank: boolean; agentPreset: string }> = {
    original: { id: 'original', blank, agentPreset: 'personal' },
  }
  let current = 'original', selected = 'personal'
  const listeners = new Set<() => void>(), emit = () => { for (const listener of listeners) listener() }
  const prompt = vi.fn(), setDraft = vi.fn(), ctx = {}
  const sessions = { list: { getSnapshot: () => ({ current, byId: rows }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    open: vi.fn((id: string) => { current = id }), binding: vi.fn(() => ({ ctx, session: { prompt } })) }
  const workspaces = { startSession: vi.fn(() => { rows.blank = { id: 'blank', blank: true, agentPreset: 'personal' }; current = 'blank'; emit() }) }
  const seat = { getSnapshot: () => ({ current: selected, busy: false, error: null }),
    select: vi.fn(async (presetId: string) => { selected = presetId; rows[current]!.agentPreset = presetId; emit() }) }
  const remote = { bindSession: vi.fn(), listAudit: vi.fn(async () => ({ ok: true, value: { migrations: [], verifications: [] } })),
    migrationPlan: vi.fn(async () => ({ ok: true, value: null })) }
  const runtime = new AgentCenterRuntime(seat as never, remote as never, sessions as never, workspaces as never,
    { input: { for: () => ({ setDraft }) } } as never)
  cleanup.push(() => runtime.dispose())
  return { runtime, rows, listeners, sessions, seat, workspaces, remote, setDraft, prompt, current: () => current,
    selectCurrent: (id: string) => { current = id; emit() } }
}

describe('contributed Agent entry preserves native owners and unsent drafts', () => {
  it('prepares a native blank selection without clearing its draft, binding a personal profile or sending', async () => {
    const f = fixture(), signal = new AbortController().signal
    await expect(f.runtime.prepareContributedConversation('paimind-enterprise-fixture', signal)).resolves.toBe('original')
    expect(f.seat.select).toHaveBeenCalledWith('paimind-enterprise-fixture'); expect(f.workspaces.startSession).not.toHaveBeenCalled()
    expect(f.sessions.open).toHaveBeenCalledWith('original'); expect(f.rows.original!.blank).toBe(true)
    expect(f.setDraft).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled(); expect(f.remote.bindSession).not.toHaveBeenCalled()
  })
  it('asks the native workspace for a blank conversation and keeps the historical preset unchanged', async () => {
    const f = fixture(false)
    await expect(f.runtime.prepareContributedConversation('assigned', new AbortController().signal)).resolves.toBe('blank')
    expect(f.workspaces.startSession).toHaveBeenCalledOnce(); expect(f.rows.original).toEqual({ id: 'original', blank: false, agentPreset: 'personal' })
    expect(f.rows.blank!.agentPreset).toBe('assigned'); expect(f.setDraft).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled()
  })
  it('cancels a blank-session wait and releases listeners before a late native session arrives', async () => {
    const f = fixture(false), abort = new AbortController(); f.workspaces.startSession.mockImplementation(() => {})
    const baseline = f.listeners.size, work = f.runtime.prepareContributedConversation('assigned', abort.signal)
    expect(f.listeners.size).toBe(baseline + 1); abort.abort(new Error('Account replaced'))
    await expect(work).rejects.toThrow('Account replaced'); expect(f.listeners.size).toBe(baseline)
    f.rows.late = { id: 'late', blank: true, agentPreset: 'personal' }; f.selectCurrent('late')
    expect(f.seat.select).not.toHaveBeenCalled(); expect(f.sessions.open).not.toHaveBeenCalled()
  })
  it('rejects duplicate preparation and ignores native completion after cancellation', async () => {
    const f = fixture(), abort = new AbortController(); let complete!: () => void
    f.seat.select.mockImplementation(() => new Promise<void>(done => { complete = done }))
    const work = f.runtime.prepareContributedConversation('assigned', abort.signal)
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await expect(f.runtime.prepareContributedConversation('different', new AbortController().signal)).rejects.toThrow('正在进行')
    abort.abort(new Error('Account lost')); await expect(work).rejects.toThrow('Account lost')
    complete(); await Promise.resolve(); expect(f.sessions.open).not.toHaveBeenCalled(); expect(f.seat.select).toHaveBeenCalledOnce()
  })
  it('fails closed if another native action starts the blank conversation while selection is in flight', async () => {
    const f = fixture(); f.seat.select.mockImplementation(async () => { f.rows.original!.blank = false })
    await expect(f.runtime.prepareContributedConversation('assigned', new AbortController().signal)).rejects.toThrow('对话已有内容')
    expect(f.sessions.open).not.toHaveBeenCalled(); expect(f.seat.select).toHaveBeenCalledOnce(); expect(f.prompt).not.toHaveBeenCalled()
  })
  it('fails on replaced navigation and does not open the original session later', async () => {
    const f = fixture(); f.seat.select.mockImplementation(async () => { f.selectCurrent('somewhere-else') })
    await expect(f.runtime.prepareContributedConversation('assigned', new AbortController().signal)).rejects.toThrow('被替换')
    expect(f.sessions.open).not.toHaveBeenCalled(); expect(f.setDraft).not.toHaveBeenCalled()
  })
  it('owner unload cancels pending entry and makes old references terminal', async () => {
    const f = fixture(false); f.workspaces.startSession.mockImplementation(() => {})
    const work = f.runtime.prepareContributedConversation('assigned', new AbortController().signal)
    f.runtime.dispose(); await expect(work).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.listeners.size).toBe(0); expect(f.seat.select).not.toHaveBeenCalled()
    await expect(f.runtime.prepareContributedConversation('assigned', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects invalid preset input and an already-aborted caller before native mutation', async () => {
    const f = fixture(); await expect(f.runtime.prepareContributedConversation('../foreign', new AbortController().signal)).rejects.toThrow('标识无效')
    const abort = new AbortController(); abort.abort(new Error('Replaced'))
    await expect(f.runtime.prepareContributedConversation('assigned', abort.signal)).rejects.toThrow('Replaced')
    expect(f.workspaces.startSession).not.toHaveBeenCalled(); expect(f.seat.select).not.toHaveBeenCalled()
  })
  it('does not overtake an unresolved native selection after a cancelled local continuation', async () => {
    const f = fixture(false)
    vi.spyOn(f.seat, 'getSnapshot').mockReturnValue({ current: 'personal', busy: true, error: null })
    await expect(f.runtime.prepareContributedConversation('assigned', new AbortController().signal)).rejects.toThrow('尚未结束')
    expect(f.workspaces.startSession).not.toHaveBeenCalled(); expect(f.seat.select).not.toHaveBeenCalled()
  })
})
