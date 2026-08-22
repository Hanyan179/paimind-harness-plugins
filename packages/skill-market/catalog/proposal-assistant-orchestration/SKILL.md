---
name: proposal-assistant-orchestration
description: Orchestrate the English-only Proposal Assistant intake and the full Frozen Data to Analysis to Fact Layer to Bento Deck to Trace Mode workflow. Use when a user starts, resumes, edits, or goes back in a proposal demo.
---

# Proposal Assistant Orchestration for Harness

You own the workflow. Native Tools own deterministic data, validation, rendering, trace generation, Jobs, and Artifacts. The client only renders questions and returned Artifacts.

## Intake

Use the native question Tool for exactly one decision at a time. Keep all visible copy in English.

1. Customer: Dollar General, Walmart, or Target.
2. Department: Sales, Category Management, Product Development, or Executive Leadership.
3. Deck Type:
   - Category Analysis — performance, mix, momentum, and opportunity evidence.
   - Internal Kick Off — aligns sales, category, and product-development teams around priorities.
   - Line Review Proposal — formal buyer-facing recommendation and decision ask.
4. Deck Style:
   - Strategy Consulting — `strategy-grid` plus `strategy-consulting`.
   - Paramont Signature — `paramont-mountain` plus `paramont-signature`.
   - Playful Storybook — `storybook-cutpaper` plus `playful-storybook`.

Do not ask for Horizon during intake and do not add a separate Confirm step. The final Deck Style answer is the human confirmation that starts execution. Persist confirmed choices in `proposal-context.md`. If the user says Back, Edit, Change, or names an earlier field, revise the working file and return to that decision; never force a restart. Treat `PAIMIND_PROPOSAL_NAVIGATION:BACK:<question-id>` as a navigation control result rather than a business answer: preserve earlier confirmed fields, invalidate the target and later fields, then immediately issue the canonical target question. Treat `PAIMIND_PROPOSAL_NAVIGATION:CANCEL` as a request to pause the intake: acknowledge it briefly, do not mutate confirmed context, do not run downstream skills, and do not ask another question until the user resumes.

## Execution

After Deck Style is confirmed, immediately execute this Tool chain:

1. `prepare_category_demo_data` -> `proposal-demo/frozen/source-manifest.json`.
2. `analyze_category_performance` -> `proposal-demo/analysis/category.performance.data-result.json`.
3. `analyze_category_opportunity` -> `proposal-demo/analysis/category.opportunity.data-result.json`.
4. `build_presentation_fact_set` with both exact analysis Artifact IDs -> `proposal-demo/facts/category.fact-set.json`.
5. Read the Fact Set only far enough to select exact Fact IDs needed for the story. Do not copy full Fact records, Sources, values, hashes, bindings, technical lineage, or trace groups into model output.
6. Build a concise five-to-seven slide `paimind.presentation-outline-blueprint/v1` story:
   - Cover: momentum and next growth opportunity.
   - Momentum: total sales, units, average price, and weekly comparison.
   - Department roles: performance table with Cosmetics, Party Favors, Stickers & Craft Kits, and supporting departments.
   - Opportunity priorities: Build, Expand, and Develop recommendations.
   - Action path: Momentum -> Whitespace -> Market Signal -> Growth Action.
   Add a decision/ask slide only when the selected Deck Type needs it.
7. Call `create_fact_bound_presentation_outline` with the exact Fact Set Artifact ID and the compact blueprint -> `proposal-demo/deck/category.outline.json`. The Tool must hydrate exact Sources, Facts, values, selectors, trace groups, Fact Set ID, and Fact Set hash.
8. Call `generate_traceable_bento_from_outline` with the exact Outline Artifact ID and exact Fact Set Artifact ID -> `proposal-demo/deck/category.bento.html`. Do not read or resend the complete generated Outline.
9. Return the Bento Artifact first, then one short English note: "Select any KPI, chart point, or table cell in Trace Mode to inspect its source, field, formula, filters, and lineage."

Load `category-performance-analysis`, `category-opportunity-analysis`, and `bento-ppt` when following this workflow. Never write HTML directly, use screenshot text as evidence, treat the supplied example deck as raw data, or claim completion unless the Fact Set, Outline, Bento, Trace, and Validation Artifacts are all available.
