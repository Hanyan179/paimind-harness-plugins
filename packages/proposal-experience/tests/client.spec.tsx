import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClientContextFixture } from '@paimind/testkit'
import type { HarnessQuestionWait } from '@paimind/harness-compat'
import { PROPOSAL_QUESTION_IDS } from '../src/index.ts'
import { apply, ProposalQuestionComposer, selectProposalQuestion } from '../src/client/index.tsx'

function wait(question: HarnessQuestionWait['payload']['questions'][number]): HarnessQuestionWait {
  return {
    kind: 'question', key: 'proposal-q', sessionId: 'session-one', payload: { questions: [question] },
    respond: vi.fn(async () => ({ accepted: true })),
  }
}

describe('Proposal Assistant Experience', () => {
  it('registers exactly one AI-question renderer and disposes cleanly', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    const entries = fixture.slots.filter(row => row.injectedName === 'conversation.composer')
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry?.options).toMatchObject({ name: 'conversation.composer', priority: -20 })
    expect(document.getElementById('@paimind/proposal-experience')).not.toBeNull()
    fixture.disposeEffects()
    expect(entry?.disposed()).toBe(true)
    expect(document.getElementById('@paimind/proposal-experience')).toBeNull()
  })

  it('claims only one namespaced proposal question and leaves generic waits native', () => {
    const proposal = wait({ id: PROPOSAL_QUESTION_IDS.customer, question: 'Choose a customer' })
    expect(selectProposalQuestion({ interactions: [proposal] })).toBe(proposal)
    expect(selectProposalQuestion({ interactions: [wait({ id: 'generic', question: 'Generic?' })] })).toBeNull()
    const batch = { ...proposal, payload: { questions: [proposal.payload.questions[0]!, proposal.payload.questions[0]!] } }
    expect(selectProposalQuestion({ interactions: [batch] })).toBeNull()
  })

  it('renders compact brand marks in an inline conversation card and returns the exact native answer label', async () => {
    const pending = wait({
      id: PROPOSAL_QUESTION_IDS.customer, question: 'Which customer are you preparing this deck for?',
      options: [{ label: 'Dollar General' }, { label: 'Walmart' }],
    })
    const { container } = render(<ProposalQuestionComposer matched={pending} />)
    expect(container.querySelectorAll('[data-paimind-brand-logo]')).toHaveLength(2)
    expect(container.querySelector('[data-mode="ai-tool-question"][data-trigger="ask-user-question"]')).not.toBeNull()
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dollar General' }).querySelector('[data-brand="dollar-general"]')).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Walmart' }).querySelector('[data-brand="walmart"]')).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Dollar General' })).toHaveAttribute('data-focused', 'false')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Walmart' }))
    expect(pending.respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{ id: PROPOSAL_QUESTION_IDS.customer, selected: ['Walmart'] }] } },
    }))
  })

  it('previews on hover and requires an explicit deck-style confirmation', async () => {
    const pending = wait({
      id: PROPOSAL_QUESTION_IDS.deckType, question: 'What type of deck would you like to create?',
      options: [
        { label: 'Executive Proposal (Recommended)' },
        { label: 'Category Growth Strategy' },
        { label: 'Line Review & Assortment' },
      ],
    })
    render(<ProposalQuestionComposer matched={pending} />)
    expect(screen.getByText('Senior buyer and leadership decisions')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByRole('radio', { name: 'Category Growth Strategy' }))
    expect(screen.getByText('Category planning and growth workshops')).toBeInTheDocument()
    expect(pending.respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Category Growth Strategy' }))
    expect(pending.respond).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Category Growth Strategy' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Use this deck style' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{
        id: PROPOSAL_QUESTION_IDS.deckType,
        selected: ['Category Growth Strategy'],
      }] } },
    }))
  })

  it('keeps multi-select departments in one native structured answer', async () => {
    const pending = wait({
      id: PROPOSAL_QUESTION_IDS.departments, question: 'Which teams should this proposal speak to?', multiSelect: true,
      options: [{ label: 'Merchandising' }, { label: 'Executive Leadership' }],
    })
    render(<ProposalQuestionComposer matched={pending} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Merchandising' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Executive Leadership' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{
        id: PROPOSAL_QUESTION_IDS.departments,
        selected: ['Merchandising', 'Executive Leadership'],
      }] } },
    }))
  })

  it('does not synthesize a workflow from the selected preset without an AI question interaction', () => {
    const fixture = createClientContextFixture()
    apply(fixture.context)
    const entry = fixture.slots.find(row => row.injectedName === 'conversation.composer')
    const select = entry?.options.select as ((owner: { readonly interactions: readonly unknown[]; readonly session?: unknown }) => unknown)
    expect(select({ interactions: [], session: { sessionId: 'session-one', running: false, agentPreset: 'proposal-assistant' } })).toBeNull()
    fixture.disposeEffects()
  })
})
