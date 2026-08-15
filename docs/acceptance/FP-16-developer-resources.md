# FP16 Developer Resources Acceptance

## Current status

`Technically Verified; Product E2E Verified` on 2026-08-15.

## URL and entry

- URL: `http://127.0.0.1:3080/`.
- Entry: native sidebar `Settings` → `Developer Resources`.
- Capability management: `Settings` → `Extension Center` → `Developer` → `Developer Resources`.
- Native comparison: `Settings` → `Plugins` remains the sole technical Plugin Registry view.

## Preparation

- Exact Harness `0.1.0-rc.6` and the formal PAIMind Bundle.
- Native Plugin Inventory available.
- At least Runtime Orb, Task Monitor, Artifact/Viewer, Agent Center, Skill Market, Scheduler and Extension Center installed.
- No Preview query parameters or prepared fixtures are required.

## Acceptance sequence

1. Open Developer Resources → Live Diagnostics. Confirm only `@paimind/*` entries appear and summary counts match visible native facts.
2. Expand or inspect representative rows. Confirm exact `moduleName`, `entryId`, effective enablement and `fiberPhase`; no guessed version, dependency graph or failure stack appears.
3. Compare a representative row with native Plugins and confirm the same technical lifecycle.
4. Open Surface Catalog. Confirm current contributed product surfaces appear by their seven-category taxonomy and actual surface. Confirm Launcher, Conversation marker and fake Administration do not appear.
5. Open Integration Reference. Confirm every card is marked `Bundled reference`, names its owner and points to an actually implemented Slot, Service, Adapter, Event or Projection.
6. Refresh and restart Harness. Confirm diagnostics reload from the native Remote and Surface Catalog recovers from live slot contributions.
7. Check Chinese/Dark, English/Light and `560×800`.
8. Disable or remove only Developer Resources. Confirm native Plugins, Extension Center and all PAIMind runtime features continue. Restore the formal Bundle.

## Required automated evidence

- Focused Developer Resources unit/client tests.
- Full Type Check, test suite, Production Build and framework boundary scan.
- Exact Harness composition including Developer-Resources-absent isolation.
- Browser screenshots for Chinese/Dark diagnostics, live surface catalog, bundled integration reference and English/Light narrow layout.
- Zero Harness upstream worktree delta relative to the pre-run sentinel.

## Completed verification

1. The formal profile exposed 38 exact `@paimind/*` native Loader entries; all were `active`. `@paimind/developer-resources` matched the native Plugins row `mounted, enabled`.
2. Surface Catalog was built from current immutable Slot contributions and contained the real Orb, Task, Artifact/Viewer, Agent, Skill, Scheduler and Developer surfaces. Launcher, empty Conversation marker and fake Administration were absent.
3. Integration Reference contained eight implemented Slot/Service/Adapter/Event/Projection boundaries, each explicitly labeled `Bundled reference`.
4. Refresh, browser reload and a full Harness stop/start reread the native inventory successfully.
5. A real Host outage caused Refresh to discard the prior success snapshot and show the explicit unavailable/Retry state; restart plus Retry recovered the live snapshot.
6. Chinese/Dark, English/Light and `560×800` passed. The formal profile was restored to Chinese/Dark.
7. Full gates passed: 59 test files / 186 tests, Type Check, Production Build, 19-client framework scan, exact Harness composition, FP16-absent isolation and zero upstream delta.

## Browser evidence

- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP16-live-diagnostics-zh-dark.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP16-live-surface-catalog-zh-dark.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP16-bundled-integration-reference-zh-dark.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP16-developer-resources-en-light-560.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP16-inventory-unavailable-en-light.png`

## Explicit non-features

- No second Plugin Registry or technical enable/disable switch.
- No version or dependency claims absent from native inventory.
- No synthetic health score, preview-state simulator or component screenshots presented as runtime truth.
- No navigation Launcher.
- No filesystem/package-manager scrape from the browser.
- No Better Sidebar internal dependency.
