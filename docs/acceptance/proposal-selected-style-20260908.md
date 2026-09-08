# Proposal selected-style acceptance — 2026-09-08

## Scope and ownership

Existing Walmart adapter enhancement; no new plugin or runtime state.

| Boundary | Decision |
| --- | --- |
| Product surface | Existing proposal question cards and Bento workbench |
| Domain entity | Presentation Outline design, owned by presentation contracts |
| Writable state | Native artifact generator writes new Workspace artifacts; Skill Center maintains installed business Skill source |
| Runtime service | Walmart adapter forwards selected style to its packaged outline runner; Bento generator renders registered templates |
| Harness compatibility | No upstream code or new compatibility access |
| Failure and unload | Unsupported explicit styles fail before generation; omitted style retains legacy retail compatibility; existing lifecycle unchanged |

## Defect and correction

The Walmart outline conversion hardcoded `wmt-retail` / `wmt-kids-mod`, ignoring the style question. The adapter now accepts `style_preset`, forwards it to the packaged CLI, and resolves its registered template. Orchestration and outline Skills preserve the selected style and check design metadata before rendering. The complete-demo Skill also explicitly requires five independently answered question IDs, including a fixed-category confirmation.

| Selected style | Template |
| --- | --- |
| strategy-consulting | strategy-grid |
| paramont-signature | paramont-mountain |
| playful-storybook | storybook-cutpaper |
| wmt-retail (legacy omission) | wmt-kids-mod |

## Executed checks

- Walmart adapter: 11 tests passed, including native Python data → analyses → 25-page Outline, all three styles, invalid style rejection, unchanged facts/slides/sources and demo disclosure.
- Bento generator and presentation contracts: 17 tests passed.
- Repository build including TypeScript declarations, package compliance, documentation links and diff whitespace passed.
- API snapshot: refreshed only the changed Walmart adapter entry; 11 other package runtime-export hashes still differ from the repository snapshot. They are outside this change and remain unresolved, so the full repository release gate is not claimed.
- Skill parsed by Harness Skill Center's actual `parseSkillMetadata` and updated through `saveSkillSource` with expected digest. The generic Codex validator rejects the existing Harness-specific `display-name` field; it is retained because the target parser supports it.
- Local Harness composition at port 3080 restarted with the updated adapter. No upstream changes, push or release.
- Fresh browser conversation with one sentence `帮我做一份完整的提案演示。`, explicit Proposal Assistant selection and Playful Storybook produced `proposal-demo/walmart-storybook/deck/walmart-kids-crafts-growth-investment.bento.html` and corresponding Outline/Trace/Validation in the existing test Workspace.
- Actual Outline: 25 pages, `playful-storybook` / `storybook-cutpaper`. Validation: 104/104 bindings, source hashes verified, no changed facts, no errors.
- Browser: full workbench displayed complete 16:9 page; selected page 2; traced $5.2M to 5,151,512.58 in `walmart.fineline.data-result.json`, FY2025 WK31–WK52; edited title successfully in temporary edit mode. Data remained locked. Browser screenshots are in the task evidence, not committed.

## Final fresh-conversation acceptance

A second blank conversation in the visible in-app browser used exactly `帮我做一份完整的提案演示。` after selecting Proposal Assistant. It showed Customer → Department/category → Deck purpose → Visual style → Content & data in that order. Selections were Walmart, fixed Kids Crafts, Growth & investment ask, Playful Storybook, and the complete paired-analysis package. Selecting the style updated the right-hand explanation/preview. No supplemental user prompt or sixth approval was used.

The run produced `proposal-demo/walmart-fresh/deck/walmart-kids-crafts-growth-ask.bento.html`, with its Outline, Trace and Validation sidecars. Its Outline has 25 slides and the exact selected `playful-storybook` / `storybook-cutpaper` pair. Validation resolves 104/104 bindings, verifies source hashes, reports no errors and no changed facts. The native conversation shows all seven execution tasks complete.

All 25 pages were advanced through the actual browser player. Each active slide reported `data-fit-overflow=false` and `data-fit-scale=1`; the long-title page 7 was also visually inspected. The final artifact was left open on its cover in the full workbench. This is local demo acceptance, not a production/release gate. Preview, trace and transient title editing were exercised on the immediately preceding generated deck using the same code.

Browser verification used explicit Agent selection; inherited/default binding is not accepted by this check. The deck uses the registered cut-paper theme; this test does not claim it reproduces every illustration shown in the style-choice reference image. All financial values are synthetic demo data.

