import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { createClientContextFixture } from '@hansen/testkit'
import type {
  HarnessSessionListSnapshot,
  HarnessSessionService,
  PaimindLocaleSource,
} from '@hansen/harness-compat'
import type {
  PaimindArtifactService,
  PaimindArtifactSnapshot,
  PaimindArtifactView,
} from '@hansen/artifacts'
import {
  ConversationArtifactCards,
  apply,
  artifactForConversationPath,
  formatForConversationArtifact,
} from '../src/client/index.js'

const sessionSnapshot: HarnessSessionListSnapshot = Object.freeze({
  current: 'session-1',
  ids: Object.freeze(['session-1']),
  byId: Object.freeze({
    'session-1': Object.freeze({ id: 'session-1', cwd: '/workspace', running: false }),
  }),
})

const sessions: HarnessSessionService = {
  list: {
    getSnapshot: () => sessionSnapshot,
    subscribe: () => () => {},
  },
  open: () => {},
}

const locale: PaimindLocaleSource = {
  getLocale: () => ({ active: 'zh' }),
  subscribe: () => () => {},
}

const bentoArtifact: PaimindArtifactView = Object.freeze({
  id: 'artifact-bento',
  sourceId: 'projection',
  origin: 'paimind-product',
  kind: 'html',
  state: 'available',
  title: 'Dollar General Category Growth',
  path: 'proposal/deck.bento.html',
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  updatedAt: 1,
  previewKind: 'bento-deck',
  traceId: 'trace-1',
})

const artifactSnapshot: PaimindArtifactSnapshot = Object.freeze({
  revision: 1,
  artifacts: Object.freeze([bentoArtifact]),
  diagnostics: Object.freeze([]),
})

const openArtifact = vi.fn(() => ({ state: 'opened' as const }))

const artifacts: PaimindArtifactService = {
  getSnapshot: () => artifactSnapshot,
  subscribe: () => () => {},
  registerSource: () => () => {},
  registerAction: () => () => {},
  actionsFor: () => Object.freeze([]),
  runAction: () => ({ state: 'failed', messageZh: '不可用', messageEn: 'Unavailable' }),
  open: openArtifact,
  focus: () => false,
  dispose: () => {},
}

const turn = {
  turn: 3,
  data: {
    get(key: string): unknown {
      return key === 'deliverables' ? {
        produced: [
          { seq: 2, path: 'notes/readme.md' },
          { seq: 3, path: 'proposal/deck.bento.html' },
          { seq: 3, path: 'proposal/deck.bento.html' },
          { seq: 5, path: 'future.json' },
        ],
      } : undefined
    },
  },
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('conversation Artifact format projection', () => {
  it('requires exact Artifact semantics before presenting HTML as Bento', () => {
    expect(formatForConversationArtifact('proposal/deck.bento.html').key).toBe('html')
    expect(formatForConversationArtifact('proposal/deck.bento.html', bentoArtifact).key).toBe('bento')
    expect(formatForConversationArtifact('facts.json').key).toBe('json')
    expect(formatForConversationArtifact('deck.pptx').actionZh).toBe('预览幻灯片')
    expect(formatForConversationArtifact('brief.md').badge).toBe('MD')
  })

  it('matches only an exact active-Session path inside the Workspace', () => {
    expect(artifactForConversationPath('proposal/deck.bento.html', 'session-1', '/workspace', [bentoArtifact]))
      .toBe(bentoArtifact)
    expect(artifactForConversationPath('../proposal/deck.bento.html', 'session-1', '/workspace', [bentoArtifact]))
      .toBeUndefined()
    expect(artifactForConversationPath('proposal/deck.bento.html', 'session-2', '/workspace', [bentoArtifact]))
      .toBeUndefined()
  })
})

describe('conversation Artifact cards', () => {
  it('renders dedicated Markdown, JSON, Bento, PPTX and PDF cards and delegates opening', () => {
    openArtifact.mockClear()
    const openFile = vi.fn()
    render(<ConversationArtifactCards
      matched={[
        'notes/brief.md',
        'facts/category.json',
        'proposal/deck.bento.html',
        'proposal/editable.pptx',
        'proposal/appendix.pdf',
      ]}
      openFile={openFile}
      turn={turn}
      seq={3}
      sessions={sessions}
      artifacts={artifacts}
      locale={locale}
    />)

    expect(screen.getByRole('region', { name: '已生成文件' })).toBeInTheDocument()
    expect(screen.getByText('Markdown 文档 · 可用')).toBeInTheDocument()
    expect(screen.getByText('结构化数据 · 可用')).toBeInTheDocument()
    expect(screen.getByText('可溯源 Bento 演示 · 可用')).toBeInTheDocument()
    expect(screen.getByText('PowerPoint 演示文稿 · 可用')).toBeInTheDocument()
    expect(screen.queryByText('PDF 文档 · 可用')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '显示其余 1 个文件' }))
    expect(screen.getByText('PDF 文档 · 可用')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开演示: Dollar General Category Growth' }))
    expect(openArtifact).toHaveBeenCalledWith('artifact-bento', 'projection')
    expect(openFile).not.toHaveBeenCalled()
  })

  it('registers ahead of the official row and disposes without leaving styles or slots', () => {
    const fixture = createClientContextFixture()
    const context = Object.assign(fixture.context, { sessions, paimindArtifacts: artifacts })
    apply(context)

    const entry = fixture.slots.find(candidate => candidate.injectedName === 'conversation.chat.turnTail')
    expect(entry?.options).toMatchObject({
      id: 'paimind-conversation-artifact-renderer',
      priority: -10,
    })
    const select = entry?.options.select as (owner: { readonly turn: typeof turn; readonly seq: number; readonly openFile: (path: string) => void }) => readonly string[] | null
    expect(select({ turn, seq: 3, openFile: () => {} })).toEqual([
      'notes/readme.md',
      'proposal/deck.bento.html',
    ])
    const Card = entry?.component as ComponentType<{
      readonly matched: readonly string[]
      readonly turn: typeof turn
      readonly seq: number
      readonly openFile: (path: string) => void
    }>
    render(<Card matched={['notes/readme.md']} turn={turn} seq={3} openFile={() => {}} />)
    expect(screen.getByText('readme.md')).toBeInTheDocument()
    expect(document.querySelector('style[data-paimind-plugin="@hansen/conversation-artifact-renderer"]')).not.toBeNull()

    fixture.disposeEffects()
    expect(entry?.disposed()).toBe(true)
    expect(document.querySelector('style[data-paimind-plugin="@hansen/conversation-artifact-renderer"]')).toBeNull()
  })
})
