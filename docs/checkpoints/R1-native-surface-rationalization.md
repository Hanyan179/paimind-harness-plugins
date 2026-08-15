# R1 Native Surface Rationalization Checkpoint

Date: 2026-08-14  
State: `Verified`  
Next stage: `R2 Product Truth Plane`

## Product outcome

- Harness Plugin Registry remains the sole technical loading authority.
- PAIMind Extension Center is an independent Harness Settings section and capability-management page, not a launcher.
- The fixed product taxonomy is Experience, Content & Rendering, Agents, Skills & Tools, Automation, Governance and Developer.
- Former PAIMind Launcher and the FP03 empty marker are absent from Bundle, client discovery and the live browser surface.
- FP04 is a headless `Project = Workspace` adapter: it publishes `paimindWorkspaceProject`, registers zero visible slots and creates no second Project store.
- Bento remains an independent PAIMind Renderer Plugin. Its core has no direct Better Sidebar dependency; the external provider is reachable only through `@paimind/better-sidebar-adapter`.
- Task Monitor is honestly shown as `Reopened` on its current Side Card surface. R2 owns the independent button and Native Job migration.

## Runtime architecture

`@paimind/extension-center` declares a `paimind.extension` child Slot. User-visible packages contribute immutable product descriptors through the native Harness Slot ledger. Extension Center joins the exact package module id to the read-only Harness Plugin Inventory at render time and stores no technical-state mirror. An inventory failure shows an unavailable state and never replays cached success.

Harness rc.6 currently exposes module id, effective enablement and Fiber phase. Version and dependency remain Harness-owned, but Extension Center does not invent fields absent from the public Remote.

## Verified packages and descriptors

| Package | Category | Product maturity | Current surface |
|---|---|---|---|
| `@paimind/runtime-orbs` | Experience | Available | Native conversation |
| `@paimind/artifacts` | Content & Rendering | Technical preview | Side card |
| `@paimind/renderer-bento` | Content & Rendering | Technical preview | Preview channel |
| `@paimind/presentation-trace` | Content & Rendering | Technical preview | Side card |
| `@paimind/task-monitor` | Automation | Reopened | Side card; R2 target is independent button |
| `@paimind/extension-center` | Developer | Available | Settings |

Headless packages do not create cards: `@paimind/workspace-project` and `@paimind/better-sidebar-adapter`.

## Verification evidence

- Type Check: passed.
- Tests: `32 files / 102 tests passed`.
- Production Build: passed.
- Framework gate: `8` client plugins; descriptor completeness passed; version-sensitive imports and Better Sidebar boundary passed.
- Exact composition: Harness `0.1.0-rc.6`, Better Sidebar `0.11.0`, full Bundle install/boot/remove/restore passed.
- Absence composition: seven independent feature packages booted through a test Loader composition without Extension Center; the Extension Center, Launcher and FP03 marker manifests were absent; cleanup passed.
- Browser: Chinese/English, Light/Dark, seven categories, Automation filter, Bento search, six live `Active` states, Launcher absence and FP04 visible-entry absence passed.
- Upstream source: Harness Git status remained byte-for-byte identical before and after the isolated gates.

Screenshots are non-versioned QA evidence:

- `codex-output/qa/R1-extension-center-verified.png`
- `codex-output/qa/R1-extension-center-dark-verified.png`

## R2 entry conditions

R2 must replace the current Task Monitor registry and Better Sidebar tab with an independent button backed by native Harness Job facts. Source grounding after this checkpoint selected a versioned Artifact envelope in native `tool/result.meta` plus Session Projection because the runtime exposes no safe custom-event registration seam. Conversation, Task Monitor, Artifacts, Preview and Trace consume that canonical chain. QA Preview sources cannot satisfy R2 Product State.
