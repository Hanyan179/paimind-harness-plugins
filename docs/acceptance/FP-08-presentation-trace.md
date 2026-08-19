# FP08 Presentation Trace Acceptance

## Current status

The existing R3 PPTX trace chain remains `Product E2E Verified`. The new
`paimind.presentation-trace/v3` traceable Bento chain is
`Local Product Pre-acceptance Passed · Shared Environment Pending`. A real
DeepSeek Agent installed `bento-ppt`, produced the validated Outline and Bento
through two native Jobs, and drove object-level browser trace selection.
Evidence: [`../checkpoints/R9-traceable-bento-skill-e2e.md`](../checkpoints/R9-traceable-bento-skill-e2e.md).

The later 41-slide run is a capacity and trace-density stress card created from
an explicit 41-slide request, not the default deck size. Normal generation uses
6–10 purposeful slides for a concise update, 10–18 for a standard presentation,
and 18–30 only for a comprehensive buyer proposal. More than 30 slides requires
an explicit long-form or stress-test request.

## URL and preparation

- Runtime URL: `http://127.0.0.1:3080/`
- Workspace: a clean external acceptance Workspace with a redacted, hash-locked
  frozen source manifest.
- Entry: `PAIMind Artifacts / PAIMind 产物` → traceable Bento row →
  `Preview / 预览`. The Bento workbench exposes icon-only Preview, Edit, and
  Trace controls with hover/focus tooltips. The Trace icon activates the exact
  `artifactId + sourceId + traceId` Sidecar in place; it does not create an
  independent product tab or require a second Artifact-list action.

## Browser sequence

1. Confirm only the Bento Artifact with an explicit `traceId` has a Trace action; filename/body/prose must not make other rows traceable.
2. Open Trace and confirm the header identifies the same Artifact, Session and review status.
3. Select a slide and Business Block, then a Metric/Fact. Confirm Source file, Conclusion definition and Formula & method definition are explicit structured values.
4. Open Technical Trace and inspect Data Lineage, Calculation Logic and Code & Runtime. Missing fields must say `Not registered / 未登记`.
5. Return to Business Evidence and confirm the same Fact remains selected.
6. Click a Bento object, chart point and table cell and confirm exact
   `slideId/objectId/selector/factId` forward selection; click Trace records and
   confirm reverse slide/object selection.
7. Switch to a non-traceable Artifact or a different Session and confirm the old trace is not displayed.
8. Disable the Trace Side Card tab, confirm preview and native conversation continue, then restore it.
9. Check Chinese/English, Light/Dark, narrow drawer, refresh and Harness restart recovery.

## Expected boundaries

- No source, lineage, formula, SQL, code path or runtime is inferred from HTML, visuals, model text or file names.
- The Trace package imports neither Better Sidebar nor version-sensitive Harness values directly.
- Artifact actions and Bento events are public disposable contracts; renderers and Artifact sources do not import Presentation Trace.
- Trace failure removes only its tab/action. Bento, provider viewers, Artifact list and native conversation remain available.

## Frozen prototype mapping

The production product semantics are intentionally mapped from frozen
prototype commit `baa8a0f3bdf5b0787491c4c4fac627f2a8a30321`:

| Prototype semantic | Harness implementation |
|---|---|
| Preview/Edit/Trace in one workbench | `@paimind/renderer-bento` mode service plus `@paimind/presentation-trace` Inspector |
| active slide plus Business Block, Metric and Fact | `paimind.presentation-trace/v3` Sidecar |
| `factId → visualBindings → objectId + selector` | bidirectional Bento postMessage focus/selection contract |
| business evidence first, technical lineage drill-down | Trace Inspector Business and Technical sheets |
| prototype `FileRecord` and synthetic fixtures | retired; native Artifact/Session/Job records and hash-verified external Sidecar are authoritative |

The mapping copies neither Mock Data nor browser-local state.

## Automated and browser evidence

Result: `Product E2E Verified`.

- Revision-3 `r3-validation-deck.pptx` exposed Trace only from its explicit real `traceId`.
- Browser Trace showed the exact Artifact, three slides, generated review status and `generate_presentation_artifact input` source.
- Technical drill-down showed Validate structured input → Render editable slide → Publish atomically lineage, calculation definition and `packages/generator-office/src/cli.ts`.
- Page refresh and full Harness restart replayed the same Trace while process-local Job history reset to zero.
- Projection correlation tests reject mismatched Artifact/Session/Workspace/Job/revision trace facts; source and render failures remain isolated.
- Full current gate: 41 test files / 122 tests, strict Type Check, Production Build, 12-client framework verification, exact Harness rc.6 + Better Sidebar 0.11.0 composition and zero upstream delta.

### 2026-08-17 HTML presentation and edit-mode card

- A real `DeepSeek-V4-Flash` High Session hot-loaded `bento-ppt@1.3.0`, read
  `r3-verification-page.html`, and called the Outline and Bento Tools in order.
- The result is exactly six slides with explicit
  `paimind.presentation-design/v1`, `generic-dark`,
  `storytelling-with-data`, 16:9, 1280×720 and `balanced` density.
- Browser Edit mode exposed eyebrow, title, narrative and presentation-only
  copy as `contenteditable=true`; source and derived Fact objects remained
  locked and labelled with their update boundary.
- Opening Preview and clicking the Trace icon directly selected the exact
  Sidecar. KPI, chart-point and table-cell clicks resolved to the registered
  source, definition, formula/method and scope; Trace page selection reversed
  into the exact slide and selector.

## Explicit later ownership

- A production importer/producer must register stable visual binding ids before object-level canvas selection becomes available; FP08 never fabricates them.
- Permissions and source-file authorization: FP15.
- Scheduled traced output: FP13.
- Cloud sources: Goal B.
