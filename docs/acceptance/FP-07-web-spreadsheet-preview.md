# FP07 HTML, Bento and Spreadsheet Preview Acceptance

## Current status

`Product E2E Verified` at R3. A real Agent generated and revised formula-bearing XLSX, self-contained HTML and isolated Bento through the canonical Job/Session Artifact chain from an initially empty Workspace. Evidence: [`../checkpoints/R3-real-ai-generation.md`](../checkpoints/R3-real-ai-generation.md).

## URL and preparation

- Runtime URL: `http://127.0.0.1:3080/?paimindArtifactPreview=1`
- Entry: open Better Sidebar and select the existing `PAIMind Artifacts` / `PAIMind 产物` tab.
- Prepare a Harness Workspace containing a normal HTML document, an HTML Deck, a trusted self-contained Bento HTML file and an XLSX workbook.
- The QA query registers deterministic association rows only; file bytes remain Workspace files and viewers remain provider-owned.

## Browser sequence

1. Open the Artifact tab and confirm HTML, HTML Deck, Bento and XLSX rows appear in the same Session/Workspace list as PDF/PPTX.
2. Open normal HTML. Confirm Better Sidebar's HTML viewer starts in Preview with the green sandbox-on status and exposes Edit without changing the conversation.
3. Open HTML Deck. Confirm it renders through the same sandboxed provider viewer and is labelled `HTML Deck`, not inferred from body text.
4. Open Bento. Confirm its explicit `Bento` label opens the independent `Bento Preview` / `Bento 预览` tab, the existing self-contained runtime can use local storage, and the helper text says it is an isolated origin with no Harness network channel.
5. Open XLSX. Confirm the workbook loads, sheet navigation/grid are visible, and download/error behavior remains provider-owned.
6. Return to the Artifact tab, reopen the same files and confirm path-keyed previews refresh instead of duplicating.
7. Disable HTML in the unified Side Card settings and verify the Artifact tab reports an unavailable viewer while the independently registered Bento tab and native conversation remain usable; restore the setting afterward.
8. Switch Chinese/English and Light/Dark, then refresh and restart Harness. Artifact labels, states and associations recover.

## Expected boundaries

- `html-document`, `html-deck` and `bento-deck` are explicit source metadata; native `.html` deliverables default to `html-document`.
- `spreadsheet` is valid only for `.xlsx`.
- HTML, HTML Deck and XLSX stay in Better Sidebar's existing viewer tabs. Bento contributes one independent tab to the same Side Card lifecycle and settings inventory.
- No PAIMind package imports Better Sidebar directly outside `@paimind/better-sidebar-adapter`.
- No PAIMind renderer copies the provider's HTML/XLSX implementation or modifies Harness/Better Sidebar state stores.
- Unsafe or out-of-Workspace paths never reach the provider.

## Error, permission, theme and responsive checks

- Provider HTML is sandboxed by default; no automatic unsafe override is allowed.
- Bento runs on a random `127.0.0.1` origin with a token-bound Session path, `connect-src 'none'`, no forms/objects/base URI/referrer and no access to the Harness GUI origin.
- Malformed or unavailable content is contained in the provider surface.
- Disabled editor/HTML/XLSX capabilities fail closed.
- Semantic theme tokens remain legible in Light/Dark; document content keeps its own authored appearance.
- Better Sidebar owns the narrow merged drawer; the Artifact list remains one column without page-level overflow.

## Automated and browser evidence

Result: `Product E2E Verified`.

- The no-fixture R3 batch produced `r3-formula-workbook.xlsx`, `r3-verification-page.html` and `r3-bento-verification.html`, then updated all three in place to revision 2.
- ExcelJS structural read-back confirmed `SUM(B2:C2)`, `SUM(B3:C3)` and `SUM(B4:C4)` as real formulas; the live spreadsheet viewer showed the added Gamma row.
- HTML and Bento had no external URL/script/link dependencies. The live HTML viewer and independent Bento renderer showed revision-2 content.
- Shared Native Job, Deliverable, permission-failure, refresh and Harness-restart gates passed with no QA query parameters.

- Focused FP07 tests: 7 files, 19 tests passed for artifact contracts, client routing, Bento host confinement/CSP/injection, client service/tab and invariant disposal.
- Full PAIMind gate: 25 files, 87 tests passed; strict typecheck, 8-client production build and framework scan passed.
- Provider regression: 6 files, 94 tests passed for HTML routes/sandbox, lazy chunks, viewer loading, service lifecycle and Side Card settings.
- Exact composition: npm `@deepseek-ai/dsh@0.1.0-rc.6` plus `dsh-better-sidebar@0.11.0` installed, booted with all 8 PAIMind client manifests, removed and restored; Harness upstream worktree had zero new delta.
- Browser URL: `http://127.0.0.1:3080/?paimindArtifactPreview=1`, Workspace `fp06-fixtures`, real Harness Session `session-b54e4ac6-0706-42b3-b7b8-45f2a52e510d`.
- HTML document rendered in the provider sandbox; HTML Deck interaction advanced to slide 2/2. Evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp07-html-sandbox-zh-light.jpg`, `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp07-html-deck-slide-2-zh-light.jpg`.
- Existing 25-slide Bento runtime rendered in the independent tab. Browser inspected iframe origin `http://127.0.0.1:54033`, sandbox `allow-scripts allow-same-origin allow-popups allow-downloads allow-modals`, empty `allow`, and `no-referrer`; response headers confirmed `connect-src 'none'`, no forms/objects/base URI and `nosniff`. Evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp07-bento-isolated-zh-light.jpg` and English/Dark capture `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp07-bento-en-dark.jpg`.
- Real XLSX workbook rendered its `Opportunity Model` sheet, values and formulas through the native provider viewer. Evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp07-xlsx-zh-light.jpg`.
- Disabling the provider HTML viewer produced a bounded Artifact-tab error while Bento and the main Composer stayed usable; the setting was restored.
- Browser refresh preserved the 9-row artifact projection. Harness restart released the old Bento port, allocated new origin `http://127.0.0.1:54586`, restored the full runtime and kept the native Composer usable.
- Normal HTML cannot run the existing Bento runtime under the provider's strict CSP because it requires local storage. PAIMind records this provider boundary and uses its own isolated renderer; no upstream unsafe toggle, source patch or duplicated HTML/XLSX renderer was introduced.

## Explicit later ownership

- Bento/HTML Deck presentation trace: FP08.
- Bento editing/import/export: later dedicated package.
- Scheduled artifact creation: FP13.
- Enterprise visibility and unsafe-preview policy: FP15.
- Cloud storage: Goal B.
