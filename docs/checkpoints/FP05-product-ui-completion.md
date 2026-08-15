# FP05 Product UI Completion Checkpoint

**Date:** 2026-08-15  
**State:** `Product E2E Verified`

## Decision

FP05 is complete as an independent Task Monitor product surface. It is managed as an `Automation` capability in Extension Center, but its live entry remains the Harness Session-header button. It consumes native Harness Jobs and the canonical Artifact Session Projection; it does not depend on Better Sidebar and owns no task lifecycle store.

The Product E2E chain itself was proved in R2 and regressed across the ten successful plus one failed real generation Jobs in R3. This checkpoint closes the two remaining product-UI gates: independent Dark/narrow behavior and isolated single-package removal.

## Browser evidence

The browser checks used the live Harness URL without `paimindTaskPreview`:

| Gate | Result |
|---|---|
| Dark desktop | Passed at 1280 × 720. The independent header button opened a 380px anchored panel using Harness theme tokens: `rgb(35,35,36)` background and `rgb(249,250,251)` foreground. |
| Narrow drawer | Passed in a real Chromium context at 560 × 800. `max-width: 640px` matched; the surface became `position: fixed` with exact 12px left/right/bottom insets and 536px width. |
| Localization | Chinese label, empty state and restart-truth note rendered; earlier English/Dark evidence remains valid. |
| Isolation from Side Card | The entry stayed in the Session header; no Better Sidebar tab or Extension Center navigation action was created. |

Evidence:

- `codex-output/qa/FP05-task-monitor-dark.png`
- `codex-output/qa/FP05-task-monitor-narrow.png`

## Isolated removal evidence

The exact Harness composition gate now adds a third isolated Profile:

1. Install Extension Center, generators, Artifact Runtime, viewers and trace without `@paimind/task-monitor`.
2. Verify the dump contains neither the Task Monitor row nor package id.
3. Boot Harness and prove all remaining client manifests load while `@paimind/task-monitor` is absent.
4. Remove that composition and prove clean restoration.
5. Compare the Harness upstream worktree before and after.

Result: Harness `0.1.0-rc.6` plus Better Sidebar `0.11.0` passed full install/boot/remove/restore, Extension Center absence, Task Monitor absence, cleanup and zero-upstream-delta gates.

## Regression gate

- Type Check: passed.
- Tests: 41 files / 122 tests passed.
- Production Build: passed.
- Framework gate: 12 client plugins, exact seven Extension Center categories, Registry technical-only, Task Monitor independent, Bento adapter-only, zero direct Harness imports outside compat and zero Better Sidebar imports outside adapter.
- Adapter contract: v3, reflecting the stable file-viewer registration added during R3.

R4 may now begin with FP09. Goal A remains active.
