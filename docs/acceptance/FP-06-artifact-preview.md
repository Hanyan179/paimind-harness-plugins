# FP06 Artifact Bridge and PDF/PPT Preview Acceptance

## Current status

`Product E2E Verified` at R3. A real Agent generated and revised PPTX/PDF through Harness Tools, native Jobs, durable Tool Result metadata, Session Projection and clickable Conversation Deliverables from an initially empty Workspace. Evidence: [`../checkpoints/R3-real-ai-generation.md`](../checkpoints/R3-real-ai-generation.md).

## URL and preparation

- Runtime URL: `http://127.0.0.1:3080/?paimindArtifactPreview=1`
- Entry: open Better Sidebar's tab menu and select `PAIMind Artifacts` / `PAIMind 产物`.
- Prepare one Harness Workspace containing valid `fp06-preview.pdf` and `fp06-preview.pptx` files, then open a Session in that Workspace.
- The query flag registers QA-only association and error-state rows. It does not create files, persist artifacts or change the Workspace.

## Browser sequence

1. Open the Artifact tab and verify one PDF, one PPTX, one updating, one missing and one failed row are associated with the active Session and Workspace.
2. Open the PDF Preview. Better Sidebar opens one path-keyed editor tab, displays the PDF and exposes Download.
3. Return to Artifacts and open the same PDF again. The existing path editor is refreshed rather than duplicated.
4. Open the PPTX Preview. Verify slide count, Previous/Next navigation and Download.
5. Return to Artifacts and verify updating, missing and failed rows cannot open; each shows a localized bounded reason.
6. Switch Session and Workspace filters. Rows move only by explicit `sessionId` and `workspaceId`.
7. Change Chinese/English and Light/Dark settings. Labels, state copy and semantic colors update live.
8. Refresh Harness and restart the runtime. Reopen the tab and previews; Session/Workspace association remains derived from native state and the QA source registers once.
9. Disable a viewer or remove Better Sidebar in an isolated profile. PAIMind reports the unavailable capability or hides its tab; native Harness conversation remains usable.

## Expected states

- `available`: Preview enabled and delegated to the matching provider viewer.
- `updating`: Preview disabled; row remains associated with its target.
- `missing`: Preview disabled with a not-found reason.
- `failed`: Preview disabled with a bounded producer reason.
- Unsafe, non-PDF/PPTX or out-of-Workspace paths never reach `ctx.betterSidebar`.
- The Artifact tab owns association and status only; file bytes, rendering, download and viewer errors remain provider-owned.

## Error, permission, theme and responsive checks

- A failing artifact source produces one diagnostic while healthy sources remain visible.
- Provider fetch/render errors do not blank the conversation or Artifact tab.
- The download link remains present in PDF/PPTX preview and error fallback.
- The same Workspace file is read through the active Harness Session scope; FP06 adds no authorization bypass.
- Better Sidebar owns the narrow merged drawer. Artifact cards become one column at the PAIMind `720px` content breakpoint.

## Automated and browser evidence

- Focused FP06 and adapter suite: 5 files, 17 tests passed.
- Full PAIMind suite: 22 files, 79 tests passed; strict typecheck passed.
- Production build: seven client plugins built successfully.
- Framework scan: no version-sensitive Harness value import outside `@paimind/harness-compat`, and no Better Sidebar import outside `@paimind/better-sidebar-adapter`.
- Better Sidebar viewer/editor regression: 5 files, 75 tests passed after the provider's own production build.
- Exact composition: npm `@deepseek-ai/dsh@0.1.0-rc.6` plus `dsh-better-sidebar@0.11.0`; install, boot, seven served manifests, remove, restore and zero Harness source delta passed.
- Real browser: the active `fp06-fixtures` Workspace and Session exposed exactly five deterministic QA rows; PDF displayed one provider iframe and Download; PPTX displayed 40 slides, navigated `1 -> 2 -> 1`, and retained Download.
- Unified settings: `paimind:artifacts` appeared in Better Sidebar's existing Side Card inventory next to `paimind:task-monitor`; it could be disabled and enabled independently without replacing the conversation or creating a second settings page.
- Chinese/Light and English/Dark Artifact surfaces passed. Refresh and a full Harness process restart restored Workspace, Session, Artifact tab and preview state.

Browser captures are stored outside the source repository:

- `codex-output/qa/fp06-artifacts-zh-light.jpg`
- `codex-output/qa/fp06-artifacts-en-dark.jpg`
- `codex-output/qa/fp06-pdf-preview-zh-light.jpg`
- `codex-output/qa/fp06-pptx-preview-zh-light.jpg`
- `codex-output/qa/fp06-unified-sidecard-plugin-entry-zh-light.jpg`

### Verified provider correction

Better Sidebar `0.11.0`'s browser-native PDF Blob iframe rendered blank in the selected in-app Chromium surface while the valid file and Download control remained available. PAIMind does not patch that provider. Independent `@paimind/renderer-pdf` registers the higher-priority `paimind:pdf` channel through `@paimind/better-sidebar-adapter`, bundles PDF.js locally, visibly renders the real page, and falls back to the original provider viewer when removed. PPTX continues to reuse the provider viewer.

## Result

`Product E2E Verified`. Harness owns Workspace/Session/Job/Turn facts. FP06 owns Artifact semantics and safe preview routing; Better Sidebar owns the Side Card and PPTX viewer, while the removable PAIMind PDF renderer owns only its local PDF.js channel. No package takes over the native conversation.

## Explicit later ownership

- HTML/Bento/Spreadsheet: FP07.
- Presentation data trace: FP08.
- Scheduled-run artifact lifecycle: FP13.
- Enterprise visibility and administrator policy: FP15.
- Cloud storage and signed-download provider: Goal B.
