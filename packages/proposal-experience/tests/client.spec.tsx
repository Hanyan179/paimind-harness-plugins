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
    expect(container.querySelector('[data-paimind-agent-avatar-seat][data-paimind-agent-id="proposal-assistant"]')).not.toBeNull()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dollar General' }).querySelector('[data-brand="dollar-general"]')).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Walmart' }).querySelector('[data-brand="walmart"]')).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Dollar General' })).toHaveAttribute('data-focused', 'false')
    expect(screen.queryByRole('button', { name: /Back to/i })).not.toBeInTheDocument()
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
      id: PROPOSAL_QUESTION_IDS.deckStyle, question: 'Which visual style should shape this deck?',
      options: [
        { label: 'Strategy Consulting' },
        { label: 'Paramont Signature (Recommended)' },
        { label: 'Playful Storybook' },
      ],
    })
    render(<ProposalQuestionComposer matched={pending} />)
    expect(screen.getByText('Paramont-owned client and leadership stories')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Paramont Signature storyboard with official mountain identity and enterprise slides' })).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByRole('radio', { name: 'Playful Storybook' }))
    expect(screen.getByText('Family, children and youth-facing concepts')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Playful storybook storyboard with colorful cut-paper illustrations and children' })).toBeInTheDocument()
    expect(pending.respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Playful Storybook' }))
    expect(pending.respond).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Playful Storybook' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Use this deck style' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{
        id: PROPOSAL_QUESTION_IDS.deckStyle,
        selected: ['Playful Storybook'],
      }] } },
    }))
  })

  it('previews the three deck types and keeps the selection staged until explicit use', async () => {
    const pending = wait({
      id: PROPOSAL_QUESTION_IDS.deckType, question: 'What type of deck should we prepare?',
      options: [
        { label: 'Category Analysis (Recommended)' },
        { label: 'Internal Kick Off' },
        { label: 'Line Review Proposal' },
      ],
    })
    render(<ProposalQuestionComposer matched={pending} />)
    expect(screen.getByText('Performance analysis')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByRole('radio', { name: 'Internal Kick Off' }))
    expect(screen.getByText('Internal alignment')).toBeInTheDocument()
    expect(screen.getByText('Sales, Category and Product Development teams')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Internal Kick Off' }))
    expect(pending.respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use this deck type' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{
        id: PROPOSAL_QUESTION_IDS.deckType,
        selected: ['Internal Kick Off'],
      }] } },
    }))
  })

  it('returns a navigation intent to the AI instead of locally rewinding the workflow', async () => {
    const pending = wait({
      id: PROPOSAL_QUESTION_IDS.deckType, question: 'What type of deck should we prepare?',
      options: [{ label: 'Category Analysis' }, { label: 'Internal Kick Off' }],
    })
    render(<ProposalQuestionComposer matched={pending} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to Department' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{
        id: PROPOSAL_QUESTION_IDS.deckType,
        selected: [],
        custom: `PAIMIND_PROPOSAL_NAVIGATION:BACK:${PROPOSAL_QUESTION_IDS.department}`,
      }] } },
    }))
  })

  it('returns an explicit cancel intent to the AI instead of surfacing a native question error', async () => {
    const pending = wait({
      id: PROPOSAL_QUESTION_IDS.department, question: 'Which Dollar General department(s) should this deck cover?',
      options: [{ label: '102 · Beauty Care' }, { label: '140 · Stationery' }], multiSelect: true,
    })
    render(<ProposalQuestionComposer matched={pending} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel proposal question' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{
        id: PROPOSAL_QUESTION_IDS.department,
        selected: [],
        custom: 'PAIMIND_PROPOSAL_NAVIGATION:CANCEL',
      }] } },
    }))
  })

  it('keeps multi-select departments in one native structured answer', async () => {
    const pending = wait({
      id: PROPOSAL_QUESTION_IDS.department,
      question: 'Which Dollar General department(s) should this deck cover?',
      detail: 'Select all departments whose performance and opportunities should appear in the analysis.',
      multiSelect: true,
      options: [
        { label: '102 · Beauty Care' },
        { label: '140 · Stationery' },
        { label: '410 · Holiday Events' },
      ],
    })
    const { container } = render(<ProposalQuestionComposer matched={pending} />)
    expect(Array.from(container.querySelectorAll('[data-paimind-department-code]')).map(node => node.textContent)).toEqual(['102', '140', '410'])
    expect(screen.getByText('Cosmetics & Cosmetic Tools')).toBeInTheDocument()
    expect(screen.getByText('Stickers & Creative Crafts')).toBeInTheDocument()
    expect(screen.getByText('Party Favors & Balloons')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '102 · Beauty Care' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '410 · Holiday Events' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(pending.respond).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: 'session-one', answer: { answers: [{
        id: PROPOSAL_QUESTION_IDS.department,
        selected: ['102 · Beauty Care', '410 · Holiday Events'],
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
