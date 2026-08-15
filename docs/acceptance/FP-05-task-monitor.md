# FP05 Independent Task Monitor Acceptance

## Current status

`Product E2E Verified`. The prior Better Sidebar tab, PAIMind task registry and `paimindTaskPreview` evidence are retired. R2/R3 proved real Generator Tool calls, Native Jobs, durable Artifact correlation, failures and restart truth; the final isolated-removal plus Dark/narrow UI gates passed on 2026-08-15. Evidence: [`../checkpoints/FP05-product-ui-completion.md`](../checkpoints/FP05-product-ui-completion.md).

## URL and preparation

- URL: `http://127.0.0.1:3080/` with no QA query.
- Entry: the independent `任务 / Tasks` button in the active Session header.
- Prepare: an empty native Harness Workspace and an empty Session whose Agent Preset can use `generate_html_artifact`.
- Do not pre-create the target file.

## Product E2E sequence

1. Open the independent Task button before generation. It shows a localized empty state.
2. Ask the real Agent to generate one standalone HTML report at a new Workspace-relative path and explicitly use the registered generator Tool.
3. While the Tool runs, open Task Monitor. A Job of exact kind `paimind-artifact` appears as `running`; no generic Bash/Search/other Job is copied.
4. After success, the same row becomes `completed` and shows the matching Artifact title/revision from exact `taskId` correlation.
5. Confirm the native conversation shows one clickable Produced File/Deliverable. Click it and open the matching HTML Viewer.
6. Refresh the browser. The Job row and Artifact correlation reappear while the same Harness process is running.
7. Restart Harness. The file, conversation Deliverable and Artifact Projection recover; process-local Job history is absent and Task Monitor truthfully returns to empty.
8. Trigger one invalid or denied generation. The Native Job becomes `failed`, the failed envelope is visible for correlation, and no clickable Deliverable location is produced.
9. Switch Chinese/English, Light/Dark and a narrow viewport. Copy, semantic colors, Popover/Drawer behavior, keyboard Escape and focus return remain correct.
10. Remove only `@paimind/task-monitor` in an isolated Profile. The button disappears while Native Jobs, generated artifacts and conversation continue.

## Expected boundaries

- Entry is always a Session-header button, never a Better Sidebar tab or Extension Center navigation link.
- Extension Center lists FP05 under `Automation` and reports technical/product status only.
- Native statuses are exactly `running`, `stopping`, `completed`, `killed`, `failed`; no synthetic `queued`, `waiting` or fake percentage appears.
- Labels, commands and model prose never classify a Job.
- Missing/malformed Artifact Projection does not hide the authoritative Native Job.
- A Task Monitor render failure affects only its own action and cannot block native conversation.

## Automated evidence required before completion

- Focused Task Monitor projection/client tests.
- Artifact runtime execution/projection tests including failed-without-location.
- Full PAIMind test suite, Type Check and production build.
- Framework gates for Better Sidebar independence, Extension Center category, no duplicate task state and compatibility-only Harness imports.
- Exact Profile install/boot/serve/remove/restore and Harness upstream zero-delta proof.
- Browser captures for empty, running/completed correlation, failed-without-Deliverable, Light/Dark and independent narrow Drawer.

No Fixture, preview query or pre-existing target file can satisfy Product E2E completion.

Result: `Product E2E Verified`. Keep this sequence as a regression checklist; it is no longer a pending completion gate.
