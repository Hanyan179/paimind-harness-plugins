---
display-name: 采购提案助手
name: proposal-assistant-orchestration
description: 澄清提案需求，组织分析、演示制作和数据来源说明。
---

# Proposal Assistant Orchestration for Harness

You own the workflow. Native Tools own deterministic data, validation, rendering, trace generation, Jobs, and Artifacts. The client only renders questions and returned Artifacts.

## Complete interactive demo

Use this mode when the user requests a complete demo, every selection screen, or a full proposal walkthrough ending in a Bento HTML slide deck. A request for a demo is not a request for a Markdown report or an analysis-only handoff. The ordinary adaptive mode below still applies to other tasks.

For a new complete demo, present these decisions individually in order through native `ask_user_question`, waiting for each answer. Even when the brief suggests an answer, show it for interactive confirmation in this mode. On resume, preserve decisions already confirmed in this demo; do not restart completed steps.

1. Customer — `paimind.proposal.customer/v1`. Offer only executable synthetic scenarios, including Dollar General and Walmart.
2. Department or category — `paimind.proposal.departments/v1`. Use the exact supported scenario scope. For the Walmart demo, show Kids Crafts as the supported category without inventing department codes or unsupported alternatives. For Dollar General, use the supported departments described below. Explain fixed demo scope when only one choice is available.
3. Deck purpose — `paimind.proposal.deck-type/v1`. Present the relevant maintained purposes and descriptions; Walmart buyer purposes include Growth & investment ask, Seasonal reset proposal, and Performance & partnership review.
4. Visual style — `paimind.proposal.deck-style/v1`. Always show the existing Strategy Consulting, Paramont Signature and Playful Storybook choices and wait for the user's selection. Do not replace the style assets, select a style silently, or skip this screen because the customer or purpose is known. Preserve the selected style identifier for the supported presentation Tool inputs; never claim a style was applied without checking the returned deck metadata.
5. Content & data — `paimind.proposal.content-data/v1`. Load and match the analysis Skills first, then offer complete, executable business content packages. For Walmart, combine the two loaded offerings into one clearly described choice such as "Complete buyer proposal: investment priorities + assortment opportunities"; its selection explicitly authorizes both analyses required by the outline builder. Do not present the two required halves as independently sufficient deck packages. For the complete Dollar General demo, offer a package containing performance, department roles and opportunity priorities. Do not add non-executable options merely to create more choices. The answer confirms scope and starts execution; no extra confirmation screen is needed.

This sequence is owned by this Skill and the Agent's native question calls, not a client-side step machine. Do not copy the workflow into the Agent persona or plugin configuration. BACK returns to an earlier material decision while retaining valid answers. An explicit cancellation or a later user request for analysis only overrides the demo scope; acknowledge that the complete deck demo is paused rather than repeatedly requesting paired content.

### Demo delivery gate

After the last selection, load `bento-ppt` and execute the appropriate synthetic path below through its final rendering step. A complete content-package selection authorizes the individual analyses named in that package; apply the existing exact Artifact ID contracts to them.

- Save confirmed decisions in `proposal-context.md` as an intermediate record only. Use a fresh run subdirectory for generated outputs and preserve unrelated existing files.
- Wait for native background Jobs and read their actual outputs. A queued Job, a written Markdown file, an outline, or an analysis result is not the final deliverable.
- Continue from analysis to the verified Fact Set/Outline and `generate_traceable_bento_from_outline`. Never substitute hand-written HTML or a Markdown report.
- Resolve fixable validation failures using the returned diagnostics and retry the affected step with verified inputs. If a required Tool is unavailable or remains blocked, report the exact failed stage and preserve the unfinished state; do not claim the demo is complete.
- Before final delivery, verify successful rendering and the actual Bento HTML, Trace and Validation Artifacts. Return the clickable Bento Artifact as the primary deliverable and identify the available Preview, Edit and Trace modes. Do not report those modes as browser-tested unless they were actually exercised.
- The requested "PPT" in this complete Bento demo means the interactive HTML slide deck. Generate a separate `.pptx` only if the current user explicitly requests that additional export. Markdown is never a substitute for the requested slide deck.

## Adaptive intake

Use the native question Tool for one decision at a time and keep visible copy in English. Reason from the user's request and already-known Session context; ask only questions whose answers materially change the proposal, capability match, evidence path, story, or visual delivery. Do not implement or simulate a fixed step machine.

Useful semantic question contracts are available when relevant:

- `paimind.proposal.customer/v1` for the target customer.
- `paimind.proposal.departments/v1` for one or more exact retailer department codes and names. When this question needs explanatory detail, keep the detail as metadata on the same question object; never emit it as a second question.
- `paimind.proposal.deck-type/v1` for the proposal's decision purpose.
- `paimind.proposal.deck-style/v1` for visual direction; available registered pairs include Strategy Consulting (`strategy-grid` plus `strategy-consulting`), Paramont Signature (`paramont-mountain` plus `paramont-signature`), and Playful Storybook (`storybook-cutpaper` plus `playful-storybook`).
- Any other namespaced `paimind.proposal.<context>/v1` question the current proposal genuinely needs, such as decision audience, market, approved source, time period, or commercial ask.

Outside complete interactive demo mode, skip questions the user has already answered. Customer and retailer-specific department questions are examples, not a configured sequence. Persist confirmed context in `proposal-context.md`. Before changing that file, check whether it already exists and read it when it does; update the existing context instead of attempting a blind overwrite. Do not ask for a separate confirmation step: the later Content & data selection confirms execution scope. Treat `PAIMIND_PROPOSAL_NAVIGATION:BACK` as an AI navigation request: decide which earlier material decision should be revisited, preserve facts that remain valid, invalidate dependent later choices and generated Artifacts, then ask the most useful prior question. Treat `PAIMIND_PROPOSAL_NAVIGATION:CANCEL` as a request to pause: acknowledge it briefly, preserve confirmed context, and do not continue until the user resumes.

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
