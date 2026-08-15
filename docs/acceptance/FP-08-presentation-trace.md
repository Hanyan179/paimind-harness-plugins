# FP08 Presentation Trace Acceptance

## Current status

`Product E2E Verified` at R3. A real presentation Generator emitted the explicit `traceId` and structured lineage through the same native Tool Result and Artifact Session Projection as the generated PPTX. FP09 remains unstarted until FP05's final product-UI gate closes. Evidence: [`../checkpoints/R3-real-ai-generation.md`](../checkpoints/R3-real-ai-generation.md).

## URL and preparation

- Runtime URL: `http://127.0.0.1:3080/?paimindArtifactPreview=1&paimindTracePreview=1`
- Workspace: `fp06-fixtures`; use the existing `FP07 Bento Deck` Artifact and structured FP08 QA trace source.
- Entry: `PAIMind Artifacts / PAIMind 产物` → traceable Bento row → `Trace / 追溯`. The action must open the single independent Trace tab.

## Browser sequence

1. Confirm only the Bento Artifact with an explicit `traceId` has a Trace action; filename/body/prose must not make other rows traceable.
2. Open Trace and confirm the header identifies the same Artifact, Session and review status.
3. Select a slide and Business Block, then a Metric/Fact. Confirm Source file, Conclusion definition and Formula & method definition are explicit structured values.
4. Open Technical Trace and inspect Data Lineage, Calculation Logic and Code & Runtime. Missing fields must say `Not registered / 未登记`.
5. Return to Business Evidence and confirm the same Fact remains selected.
6. Open the Bento preview, change to a slide that emits an allowlisted runtime event, and confirm Trace follows only the matching stable slide number.
7. Switch to a non-traceable Artifact or a different Session and confirm the old trace is not displayed.
8. Disable the Trace Side Card tab, confirm preview and native conversation continue, then restore it.
9. Check Chinese/English, Light/Dark, narrow drawer, refresh and Harness restart recovery.

## Expected boundaries

- No source, lineage, formula, SQL, code path or runtime is inferred from HTML, visuals, model text or file names.
- The Trace package imports neither Better Sidebar nor version-sensitive Harness values directly.
- Artifact actions and Bento events are public disposable contracts; renderers and Artifact sources do not import Presentation Trace.
- Trace failure removes only its tab/action. Bento, provider viewers, Artifact list and native conversation remain available.

## Automated and browser evidence

Result: `Product E2E Verified`.

- Revision-3 `r3-validation-deck.pptx` exposed Trace only from its explicit real `traceId`.
- Browser Trace showed the exact Artifact, three slides, generated review status and `generate_presentation_artifact input` source.
- Technical drill-down showed Validate structured input → Render editable slide → Publish atomically lineage, calculation definition and `packages/generator-office/src/cli.ts`.
- Page refresh and full Harness restart replayed the same Trace while process-local Job history reset to zero.
- Projection correlation tests reject mismatched Artifact/Session/Workspace/Job/revision trace facts; source and render failures remain isolated.
- Full current gate: 41 test files / 122 tests, strict Type Check, Production Build, 12-client framework verification, exact Harness rc.6 + Better Sidebar 0.11.0 composition and zero upstream delta.

## Explicit later ownership

- A production importer/producer must register stable visual binding ids before object-level canvas selection becomes available; FP08 never fabricates them.
- Permissions and source-file authorization: FP15.
- Scheduled traced output: FP13.
- Cloud sources: Goal B.
