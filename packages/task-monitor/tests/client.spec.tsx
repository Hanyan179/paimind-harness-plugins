import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PaimindLocaleSource, PaimindSessionHeaderActionProps } from '@paimind/harness-compat'
import { createClientContextFixture } from '@paimind/testkit'
import { apply, inject, TaskMonitorAction } from '../src/client/index.js'

function locale(initial = 'en'): PaimindLocaleSource & { set(value: string): void } {
  let active = initial
  const listeners = new Set<() => void>()
  return {
    getLocale: () => ({ active }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(value) { active = value; for (const listener of listeners) listener() },
  }
}

const artifact = {
  schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:one', sessionId: 'session-1',
  workspaceId: 'workspace-1', path: '/work/report.html', title: 'Quarterly Report', kind: 'html',
  previewKind: 'html-document', revision: 2, producerId: 'paimind.generator.html-document',
  taskId: 'paimind-artifact-1', state: 'available', producedAt: 200,
} as const

function props(language: PaimindLocaleSource): PaimindSessionHeaderActionProps & { locale: PaimindLocaleSource } {
  return {
    sessionId: 'session-1',
    locale: language,
    useSessions: selector => selector({
      current: 'session-1', byId: {}, jobsBySession: { 'session-1': [
        { id: 'bash-1', kind: 'bash', label: 'unrelated', status: 'running', startedAt: 100 },
        { id: 'paimind-artifact-1', kind: 'paimind-artifact', label: 'Quarterly Report', status: 'completed', startedAt: 100, finishedAt: 180, detail: 'html revision 2' },
      ] },
    } as never),
    useProjection: (() => ({ schema: 'paimind.artifacts/v1', artifacts: [artifact], traces: [] })) as PaimindSessionHeaderActionProps['useProjection'],
  }
}

afterEach(() => {
  document.head.querySelectorAll('style[data-paimind-plugin="@paimind/task-monitor"]').forEach(node => { node.remove() })
})

describe('R2 independent Task Monitor', () => {
  it('filters exact native producer kinds, correlates the durable artifact and switches locale', () => {
    const language = locale('en')
    render(<TaskMonitorAction {...props(language)} />)
    fireEvent.click(screen.getByRole('button', { name: 'PAIMind Tasks (1)' }))
    expect(screen.getByRole('region', { name: 'PAIMind Task Monitor' })).toBeInTheDocument()
    expect(screen.getByText('Quarterly Report')).toBeInTheDocument()
    expect(screen.getByText('Artifact · Quarterly Report · r2')).toBeInTheDocument()
    expect(screen.queryByText('unrelated')).not.toBeInTheDocument()
    act(() => { language.set('zh') })
    expect(screen.getByRole('region', { name: 'PAIMind 任务监控' })).toBeInTheDocument()
    expect(screen.getByText('产物 · Quarterly Report · r2')).toBeInTheDocument()
  })

  it('registers a header action with no Better Sidebar service or task store', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    expect(inject).toEqual(['slots', 'locale'])
    expect(fixture.services.size).toBe(0)
    const header = fixture.slots.find(entry => entry.injectedName === 'conversation.session.header.actions')
    expect(header?.options).toMatchObject({ id: 'paimind-task-monitor', order: 24 })
    const extension = fixture.slots.find(entry => entry.injectedName === 'paimind.extension')
    expect(extension?.inject?.()).toMatchObject({ descriptor: {
      surface: 'header-button', maturity: 'technical-preview', category: 'automation',
    } })
    fixture.disposeEffects()
    expect(document.head.querySelector('style[data-paimind-plugin="@paimind/task-monitor"]')).toBeNull()
  })
})
