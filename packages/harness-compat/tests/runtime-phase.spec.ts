import { describe, expect, it } from 'vitest'
import {
  deriveRuntimePhase, locateRuntimeActivityIconSlots, locateRuntimeSidebarActivitySlots, locateRuntimeTurnStatus,
  phaseForToolName, runtimePresentation,
  type HarnessConversationSnapshot,
} from '../src/index.ts'

function snapshot(overrides: Partial<HarnessConversationSnapshot> = {}): HarnessConversationSnapshot {
  return {
    openState: 'open',
    composerPhase: 'active',
    running: false,
    runningCalls: [],
    pending: [],
    partial: null,
    ...overrides,
  }
}

describe('Harness runtime compatibility', () => {
  it('maps only public runtime facts to semantic phases', () => {
    expect(deriveRuntimePhase(snapshot({ openState: 'loading' }))).toBe('loading')
    expect(deriveRuntimePhase(snapshot({ running: true }))).toBe('thinking')
    expect(deriveRuntimePhase(snapshot({ partial: { blocks: [{ kind: 'reasoning' }] } }))).toBe('thinking')
    expect(deriveRuntimePhase(snapshot({ partial: { blocks: [{ kind: 'text' }] } }))).toBe('replying')
    expect(deriveRuntimePhase(snapshot({ running: true, nodes: [{ kind: 'context' }] }))).toBe('working')
    expect(deriveRuntimePhase(snapshot({ pending: [{ kind: 'question' }] }))).toBe('waiting')
    expect(deriveRuntimePhase(snapshot())).toBeNull()
  })

  it('maps exact tool ids and never display labels', () => {
    expect(phaseForToolName('update_plan')).toBe('planning')
    expect(phaseForToolName('generate_pdf')).toBe('shaping')
    expect(phaseForToolName('read')).toBe('working')
    expect(phaseForToolName('grep')).toBe('searching')
    expect(phaseForToolName('web_search')).toBe('searching')
    expect(phaseForToolName('Search the web now')).toBe('tool-use')
  })

  it('gives pending interaction precedence over a still-running turn', () => {
    const presentation = runtimePresentation(snapshot({
      running: true,
      runningCalls: [{ name: 'generate_pdf' }],
      pending: [{ kind: 'question' }],
    }))
    expect(presentation).toMatchObject({ phase: 'waiting', state: 'breathing' })
  })

  it('finds the native current-turn and active-session status surfaces only', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div role="treeitem" aria-selected="true"><span data-current><svg data-state="ongoing"></svg></span></div>
      <div role="treeitem" aria-selected="false"><span data-background><svg data-state="ongoing"></svg></span></div>
      <div role="treeitem" aria-selected="false"><span data-idle><span data-state="done"></span></span></div>
      <div data-chat-flow><div role="status" data-turn-status>Deep diving...</div></div>
      <div data-variant="think" data-state="running"><div role="status" data-row-status /></div>
    `
    expect(locateRuntimeTurnStatus(root)).toHaveAttribute('data-turn-status')
    expect(locateRuntimeSidebarActivitySlots('thinking', root)).toEqual([
      root.querySelector('[data-current]'), root.querySelector('[data-background]'),
    ])
  })

  it('includes a selected warning slot only for the waiting phase', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div role="treeitem" aria-selected="true"><span data-current><span data-state="warning"></span></span></div>
      <div role="treeitem" aria-selected="false"><span data-other><span data-state="warning"></span></span></div>
    `
    expect(locateRuntimeSidebarActivitySlots('thinking', root)).toEqual([])
    expect(locateRuntimeSidebarActivitySlots('waiting', root)).toEqual([root.querySelector('[data-current]')])
  })

  it('maps every parallel running leaf while settled rows remain native', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-chat-flow>
        <div data-variant="think" data-state="ok"><div data-disclosure-row><span data-think></span></div></div>
        <div data-variant="tool" data-tool="grep" data-state="running"><div data-disclosure-row><span data-grep></span></div></div>
        <div data-variant="tool" data-tool="web_search" data-state="running"><div data-disclosure-row><span data-web></span></div></div>
        <div data-variant="tool" data-tool="read" data-state="ok"><div data-disclosure-row><span data-read></span></div></div>
        <div data-variant="tool" data-tool="bash" data-state="error"><div data-disclosure-row><span data-error></span></div></div>
        <div><div data-disclosure-row><span data-context></span><span data-context-source></span></div></div>
        <div data-open="true" data-variant="think" data-state="ok"><div data-disclosure-row><span data-expanded></span></div></div>
        <div data-sample="bash" data-variant="bash" data-state="ok"><span data-bash></span><span>Bash</span></div>
      </div>
    `
    expect(locateRuntimeActivityIconSlots(root).map(slot => ({
      marker: slot.host.getAttributeNames().find(name => name.startsWith('data-')),
      state: slot.state,
    }))).toEqual([
      { marker: 'data-grep', state: 'searching' },
      { marker: 'data-web', state: 'searching' },
    ])
  })

  it('suppresses a running parent when concurrent leaf rows expose exact progress', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-chat-flow>
        <div data-variant="others" data-state="running">
          <div data-disclosure-row><span data-parent></span></div>
          <div data-variant="tool" data-tool="grep" data-state="running">
            <div data-disclosure-row><span data-child></span></div>
          </div>
        </div>
      </div>
    `
    expect(locateRuntimeActivityIconSlots(root).map(slot => (
      slot.host.getAttributeNames().find(name => name.startsWith('data-'))
    ))).toEqual(['data-child'])
  })

  it('keeps a contiguous parallel tool batch animated until its final call settles', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-chat-flow>
        <div data-chat-flow-kind="tool-call"><div data-variant="tool" data-tool="web_search" data-state="ok"><div data-disclosure-row><span data-first-search></span></div></div></div>
        <div data-chat-flow-kind="tool-call"><div data-variant="tool" data-tool="web_search" data-state="ok"><div data-disclosure-row><span data-second-search></span></div></div></div>
        <div data-chat-flow-kind="tool-call"><div data-variant="tool" data-tool="web_search" data-state="running"><div data-disclosure-row><span data-third-search></span></div></div></div>
        <div data-chat-flow-kind="assistant-text"><p>later response</p></div>
        <div data-chat-flow-kind="tool-call"><div data-variant="tool" data-tool="read" data-state="ok"><div data-disclosure-row><span data-unrelated></span></div></div></div>
      </div>
    `
    expect(locateRuntimeActivityIconSlots(root).map(slot => ({
      marker: slot.host.getAttributeNames().find(name => name.startsWith('data-')),
      state: slot.state,
    }))).toEqual([
      { marker: 'data-first-search', state: 'searching' },
      { marker: 'data-second-search', state: 'searching' },
      { marker: 'data-third-search', state: 'searching' },
    ])
  })
})
