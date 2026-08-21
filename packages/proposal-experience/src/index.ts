/** Client-owned feature host companion required by the Harness Loader. */
export const name = 'paimind-proposal-experience'

/** Proposal execution stays with the selected Agent and native Harness Tools. */
export function apply(): void {}

export const PROPOSAL_QUESTION_NAMESPACE = 'paimind.proposal.'
export const PROPOSAL_QUESTION_IDS = Object.freeze({
  customer: 'paimind.proposal.customer/v1',
  department: 'paimind.proposal.departments/v1',
  deckType: 'paimind.proposal.deck-type/v1',
  deckStyle: 'paimind.proposal.deck-style/v1',
})
