import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TestSessionHistory } from '../src/client/test-session-history.js'

afterEach(cleanup)

it('loads earlier native messages in order and excludes reasoning and internal event payloads', async () => {
  const runtime = { readTestHistory: vi.fn()
    .mockResolvedValueOnce({ ok: true, value: { hasMore: true, events: [
      { event: { type: 'assistant/message', seq: 20, data: { message: { content: [
        { type: 'thinking', text: 'hidden reasoning' }, { type: 'text', text: 'Latest visible reply' },
      ] } } } },
      { event: { type: 'internal/config', seq: 21, data: { content: [{ type: 'text', text: 'private internal config' }] } } },
      { event: { type: 'user/message', seq: 22, data: { source: { kind: 'injection' }, content: [{ type: 'text', text: 'private runtime context' }] } } },
    ] } })
    .mockResolvedValueOnce({ ok: true, value: { hasMore: false, events: [
      { event: { type: 'user/message', seq: 10, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Earlier request' }] } } },
    ] } }) }
  const { container } = render(<TestSessionHistory runtime={runtime} agentId="agent" sessionId="archived" title="Previous test" zh={false} close={() => {}} />)
  await screen.findByText('Latest visible reply')
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
  await screen.findByText('Earlier request')
  expect(runtime.readTestHistory).toHaveBeenLastCalledWith('agent', 'archived', 20, expect.any(AbortSignal))
  expect([...container.querySelectorAll('article pre')].map(node => node.textContent)).toEqual(['Earlier request', 'Latest visible reply'])
  expect(screen.queryByText('hidden reasoning')).toBeNull()
  expect(screen.queryByText('private internal config')).toBeNull()
  expect(screen.queryByText('private runtime context')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull()
})

it('keeps a real history failure visible and retries without submitting a model turn', async () => {
  const runtime = { readTestHistory: vi.fn()
    .mockResolvedValueOnce({ ok: false, error: { message: 'History unavailable' } })
    .mockResolvedValueOnce({ ok: true, value: { events: [], hasMore: false } }) }
  render(<TestSessionHistory runtime={runtime} agentId="agent" sessionId="archived" title="Empty test" zh={false} close={() => {}} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
  await waitFor(() => expect(screen.getByText('This test has no messages yet.')).toBeInTheDocument())
  expect(screen.queryByRole('alert')).toBeNull()
})
