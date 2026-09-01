---
name: proposal-assistant-orchestration
description: Orchestrate adaptive proposal background questions, internal Skill matching, user-facing content and data selection, verified analysis, and a traceable Bento presentation final deliverable. Use when a user starts, resumes, edits, or goes back in a proposal workflow.
---

# Proposal Assistant Orchestration for Harness

You own the workflow. Native Tools own deterministic data, validation, rendering, trace generation, Jobs, and Artifacts. The client only renders questions and returned Artifacts.

## Adaptive intake

Use the native question Tool for one decision at a time and keep visible copy in English. Reason from the user's request and already-known Session context; ask only questions whose answers materially change the proposal, capability match, evidence path, story, or visual delivery. Do not implement or simulate a fixed step machine.

Useful semantic question contracts are available when relevant:

- `paimind.proposal.customer/v1` for the target customer.
- `paimind.proposal.departments/v1` for one or more exact retailer department codes and names. When this question needs explanatory detail, keep the detail as metadata on the same question object; never emit it as a second question.
- `paimind.proposal.deck-type/v1` for the proposal's decision purpose.
- `paimind.proposal.deck-style/v1` for visual direction; available registered pairs include Strategy Consulting (`strategy-grid` plus `strategy-consulting`), Paramont Signature (`paramont-mountain` plus `paramont-signature`), and Playful Storybook (`storybook-cutpaper` plus `playful-storybook`).
- Any other namespaced `paimind.proposal.<context>/v1` question the current proposal genuinely needs, such as decision audience, market, approved source, time period, or commercial ask.

Skip questions the user has already answered. Customer and retailer-specific department questions are examples, not a configured sequence. Persist confirmed context in `proposal-context.md`. Before changing that file, check whether it already exists and read it when it does; update the existing context instead of attempting a blind overwrite. Do not ask for a separate confirmation step: the later Content & data selection confirms execution scope. Treat `PAIMIND_PROPOSAL_NAVIGATION:BACK` as an AI navigation request: decide which earlier material decision should be revisited, preserve facts that remain valid, invalidate dependent later choices and generated Artifacts, then ask the most useful prior question. Treat `PAIMIND_PROPOSAL_NAVIGATION:CANCEL` as a request to pause: acknowledge it briefly, preserve confirmed context, and do not continue until the user resumes.

## Internal capability matching and content selection

When the context is sufficient, use the native Skill catalog and loader as AI capabilities: inspect available Skill descriptions, select candidate Skills whose declared purpose and data requirements fit the proposal, load them, and read their `Selectable content offering` sections. The match is a model decision grounded in the current brief and available evidence; do not consult a customer-to-Skill mapping table, local configuration, filename convention, or hard-coded option registry.

Ask one multi-select question with id `paimind.proposal.content-data/v1`, header `Content & data`, question "What content and data should this proposal include?", and detail "These options come from capabilities matched to your proposal background." Compose its options dynamically from the loaded Skills' offerings that are actually executable with current data. Do not display Skill names, implementation names, Tool names, or ask the user to choose a Skill. Require at least one content choice. This answer confirms execution scope.

Before offering customer-specific content, verify that its Skill prerequisites are available. Walmart content is executable when either an approved Workspace `paimind.analysis-source-manifest/v1` exists or the current request is explicitly a synthetic demonstration that can call `prepare_walmart_demo_data`. If neither condition is true, ask for the evidence source rather than offering unavailable content. Immediately after the user confirms Content & data, load `bento-ppt` as the presentation-delivery capability before authoring the outline blueprint. It is an internal capability, not a user choice. The primary final rendering step must use the Bento pipeline. Only after the Bento Artifact succeeds, and only when the current user explicitly requested an editable PPTX export, call `generate_pptx_from_outline` with the same exact verified Outline Artifact ID.

## Execution

After Content & data is confirmed, execute only the loaded Skill capabilities required by the selected content and follow those Skills' Tool and data contracts. The supported retail paths below are current capabilities, not a matching configuration; future Skills can participate through the same discovery, offering, selection, and execution pattern without editing this orchestration flow.

### Dollar General synthetic demonstration

1. `prepare_category_demo_data` -> `proposal-demo/frozen/source-manifest.json`.
2. If either `Sales Performance & Momentum (Recommended)` or `Department Mix & Roles` is selected, call `analyze_category_performance` -> `proposal-demo/analysis/category.performance.data-result.json`.
3. If either `Category Opportunity Priorities (Recommended)` or `White-space & Growth Actions` is selected, call `analyze_category_opportunity` -> `proposal-demo/analysis/category.opportunity.data-result.json`.
4. `build_presentation_fact_set` with the exact Artifact IDs returned by only the selected analyses -> `proposal-demo/facts/category.fact-set.json`.
5. Read the Fact Set only far enough to select exact Fact IDs needed for the story. Do not copy full Fact records, Sources, values, hashes, bindings, technical lineage, or trace groups into model output.
6. Build a concise five-to-seven slide `paimind.presentation-outline-blueprint/v1` story using only selected content:
   - Cover: momentum and next growth opportunity.
   - Momentum: total sales, units, average price, and weekly comparison.
    - Department roles: performance table scoped to 102 · Beauty Care, 140 · Stationery, and 410 · Holiday Events, with the corresponding Cosmetics, Stickers & Creative Crafts, and Party Favors & Balloons evidence.
   - Opportunity priorities: Build, Expand, and Develop recommendations.
   - Action path: Momentum -> Whitespace -> Market Signal -> Growth Action.
   Add a decision/ask slide only when the selected Deck Type needs it.
   Respect the blueprint binding contract on the first attempt:
   - `list` elements are presentation-only and must never reference a Fact. Use `text`, `kpi`, `chart`, or `table` for fact-bound content.
   - Bind each Fact ID at most once within a slide. If a chart or table already binds a Fact, any repeated narrative on that slide must be presentation-only copy without a Fact ID, or must use a different Fact.
   - For a fact-backed action path, use individual fact-bound `text` elements. If the same evidence is already bound elsewhere on that slide, keep the path label as presentation-only copy.
   - Prefer the smallest set of elements that communicates the selected story; do not add redundant bindings or duplicate evidence for decoration.
7. Choose a meaningful proposal slug from the current request and Session, then call `create_fact_bound_presentation_outline` with the exact Fact Set Artifact ID and the compact blueprint -> `proposal-demo/deck/<proposal-slug>.outline.json`. Do not reuse a fixed configured filename across proposals. The Tool must hydrate exact Sources, Facts, values, selectors, trace groups, Fact Set ID, and Fact Set hash.
8. Call `generate_traceable_bento_from_outline` with the exact Outline Artifact ID and exact Fact Set Artifact ID -> `proposal-demo/deck/<proposal-slug>.bento.html`. Do not read, copy, or resend the complete generated Outline.
9. Return the Bento Artifact as the single primary final deliverable, followed by one short English note stating that its Preview, Edit, and Trace modes are available in one workbench. Clearly label the Dollar General dataset as synthetic demonstration data. If the current user explicitly requested an editable PPTX export, return that requested Artifact after the Bento Artifact as a secondary export.

### Walmart synthetic demonstration

1. `prepare_walmart_demo_data` -> `proposal-demo/frozen/walmart/source-manifest.json`.
2. Pass the exact returned current-Session manifest Artifact ID to `analyze_fineline_investment` and `analyze_white_space` for the selected Walmart content -> `proposal-demo/analysis/walmart.fineline.data-result.json` and `proposal-demo/analysis/walmart.white-space.data-result.json`.
3. Pass only the two exact analysis Artifact IDs to `build_walmart_buyer_proposal_outline` -> `proposal-demo/deck/<proposal-slug>.outline.json`.
4. Call `generate_traceable_bento_from_outline` with that exact trusted complete Outline Artifact ID -> `proposal-demo/deck/<proposal-slug>.bento.html`.
5. Return the Bento Artifact as the primary deliverable and state clearly that every Walmart figure is synthetic demonstration data. If the current user explicitly requested editable PPT generation, call `generate_pptx_from_outline` only after Bento succeeds and return the PPTX as the secondary export.

### Walmart verified-data proposal

1. Require the approved Workspace manifest identified before content selection.
2. Run `analyze_fineline_investment` only when `Fineline Investment Priorities (Recommended)` is selected.
3. Run `analyze_white_space` only when `Assortment White-space Opportunities (Recommended)` is selected.
4. The current Walmart outline Tool requires both analysis Artifacts. If the user selected only one, explain this verified contract and ask whether to add the paired content; do not silently run unselected analysis.
5. Choose a meaningful proposal slug from the current request and Session, then call `build_walmart_buyer_proposal_outline` with the exact two Artifact IDs -> `proposal-demo/deck/<proposal-slug>.outline.json`. Do not reuse a fixed configured filename across proposals.
6. Call `generate_traceable_bento_from_outline` with that exact trusted complete Outline Artifact ID -> `proposal-demo/deck/<proposal-slug>.bento.html`. Do not pass a fabricated Fact Set ID and do not copy the complete Outline into the Tool call.
7. Return the Bento Artifact as the primary final deliverable. If the current user explicitly requested an editable PPTX export, return that requested Artifact after the Bento Artifact as a secondary export. Never claim external-data acceptance unless the approved manifest and its source hashes were actually verified in this Session.

Never write HTML directly, call `generate_pptx_from_outline` without an explicit current-user request or before the primary Bento succeeds, use screenshot text as evidence, treat an example deck as raw data, expose matched Skill names as choices, or claim completion unless the required Analysis, Fact Set or Walmart Outline, final Bento, Trace, and Validation Artifacts are all available.
