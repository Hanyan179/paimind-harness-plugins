# FP02 Extension Center Acceptance

## Current status

R1 was `Technically Verified` and `Product E2E Verified` on 2026-08-14. The 2026-08-20 capability-management upgrade is accepted: package-local gates, the serial shared full-repository gate, real Harness composition and browser acceptance all passed.

## Target entry

- URL: `http://127.0.0.1:3080/`
- Entry: Harness Settings → `Extension Center` / `扩展中心`.
- The page is a capability management surface, not a launcher.

## Product acceptance

1. The page shows exactly seven product categories: Experience, Content & Rendering, Agents, Skills & Tools, Automation, Governance and Developer.
2. Installed PAIMind capabilities appear from their self-registered descriptors; category, description, maturity and actual entry surface are accurate.
3. Technical module/load/enablement/Fiber state comes from Harness Plugin Registry and matches Settings → Plugins for the same package. Version/dependency remain Harness-owned but are not exposed by the current public Remote, so v1 does not display guessed values.
4. Rows do not open Agent Center, Task Monitor, Viewer or other workflows. They explain the real use/configuration location; the owning package keeps the entry.
5. No install/remove/enable control appears while the Harness management API is read-only.
6. Removing one extension removes only its descriptor/card and contribution; other extensions and native conversation continue.
7. Removing Extension Center leaves Harness Settings → Plugins and every independent feature entry surface intact.
8. Chinese/English, Light/Dark, reduced motion, keyboard/focus and narrow layouts are usable.
9. One malformed descriptor or failed technical-state read produces a bounded card/page error and never blocks native Settings.

## Verified browser procedure

The following procedure is the retained R1 evidence. It must not be treated as 2026-08-20 upgrade acceptance.

1. Open `http://127.0.0.1:3080/` and expand the native sidebar.
2. Choose Settings → Extension Center.
3. Verify seven categories and six current cards. Every card reports `Active / 已加载` from the live Harness inventory.
4. Choose Automation: only Task Monitor remains, marked `Reopened / 纠偏中` and its current `Side card / 侧卡` surface.
5. Search `Bento`: only Bento Renderer remains.
6. Switch Harness language between Chinese and English, and appearance between Light and Dark; the section, categories, descriptions, maturity, surface and technical state all localize and remain legible.
7. Return to Chinese and Light after verification.

## Automated and composition evidence

- Full repository tests: `32 files / 102 tests passed`.
- Type Check: passed.
- Production Build: passed; build now emits all workspace Node exports before client bundles.
- Framework gate: `8 client plugins`; every user-visible client contributes exactly one descriptor; two headless adapters are explicit exemptions; zero direct Harness imports outside `harness-compat`; zero Better Sidebar imports outside its adapter.
- Exact composition: Harness `0.1.0-rc.6` + Better Sidebar `0.11.0`; install, boot, manifest probe, remove, restore, then boot seven independent features through a test Loader composition without Extension Center and cleanly remove them.
- Harness upstream Git status: identical before and after.
- Browser evidence:
  - `codex-output/qa/R1-extension-center-verified.png`
  - `codex-output/qa/R1-extension-center-dark-verified.png`

## Deferred by design

- Task Monitor independent button and Native Job projection: R2.
- Real AI artifact generation and five-format Product E2E: R3.
- Agent/Skill/Automation/Governance product packages appear in their categories only when their real packages are implemented; Extension Center does not create planned placeholder cards.

## 2026-08-20 upgrade acceptance matrix

### Package-local gate

1. Run Extension Center tests and type check without invoking the root build that clears every package `lib` directory.
2. Build only Extension Center, inspect the package allowlist with a dry-run pack, and reject source/tests/screenshots from published content.
3. In an independent browser tab, compare Extension Center against native Settings → Plugins at identical viewports.
4. Verify search, category counts, expansion, Light/Dark/System, Chinese/English, keyboard/focus, 390px narrow layout and loading/error/empty states.

Package-local result on 2026-08-20:

- Extension Center tests: `3 files / 13 tests passed`; the upstream `dsh-client-ui-primitives` package emits a missing source-map warning without failing tests.
- Extension Center Type Check: passed through the installed workspace `tsc` binary. The equivalent `pnpm exec` entry was blocked before compiler execution because 65 Harness rc.8 lockfile entries remain inside the active `minimumReleaseAge` policy window; the shared lockfile was not rewritten or relaxed.
- Package-only esbuild: `index.js`, `invariant.js` and `client.js` generated. A source-only alias was required for the client build because a concurrent root build had temporarily cleared generated `contracts` and `harness-compat` `lib` outputs; no shared source or contract was changed.
- `npm pack --dry-run --json`: 14 published entries, `47,916` packed bytes; no source, tests, screenshots, credentials or Harness Home included.
- Live Harness rc.8 browser: Extension Center joined `18` capability descriptors to `18` active technical states. Native Settings → Plugins independently showed the exact `extension-center` and `extension-center/invariant` entries as Mounted/Enabled.
- In-app Chromium evidence covers English and Chinese, Light/Dark/System, 1280×720 and 390×844, search/detail, honest Governance empty state and visible focus treatment. Evidence is intentionally stored outside this repository and was visually re-opened after capture. Any additional supported-browser matrix remains part of the shared gate.

### Shared environment gate

Only the coordinating task may mark this upgrade accepted after one serial full-repository Build and real Harness Composition pass proves:

1. Native Plugin Inventory read-through still matches the same installed package modules.
2. Removing and restoring Extension Center in an isolated profile leaves native Settings → Plugins, conversation and other PAIMind feature surfaces operational.
3. The supported Harness/browser matrix passes and the shared test environment reproduces the package-local browser evidence.
4. Harness upstream source stays unchanged and Extension Center owns no lifecycle mutation or duplicate Registry state.

Root-coordinated shared development gate result on 2026-08-20 (not the shared test environment Product Acceptance):

- Type Check and the one final serial root Build passed.
- Full repository tests passed: `78 files / 309 tests`.
- Package compliance, `33` dry packs, strict publint, `101` NodeNext exports, examples, `91` Markdown documents, framework verification and `git diff --check` all passed.
- Aggregate API Snapshot passed for `33` package contracts. Snapshot SHA-256: `b0afe007e09700ad2bdb7d582aa1d7b9d6c7dba44d53b34a7be76150027b168a`.
- Shared Build Hash: `81dfea4f527e21e30feda5f8b74982325e31f30e8378e031aca9ba37a666179d`.
- Agent/Skill Center composition passed on Harness `0.1.0-rc.8`: dual install, each center independently absent, native restore and zero upstream delta.
- Full composition passed on Harness `0.1.0-rc.8`, Better Sidebar `0.12.2` and Office Viewer `0.1.0`: install, boot, remove and restore; independent Visual Experience lifecycle; independent features without Extension Center; and every required product-absence probe.
- The final real Harness browser retained the package-local Extension Center matrix and a clean `1280x720` PAIMind new session with calm density, Hero, four Quick Agents, four natural `96x96` avatars and zero horizontal overflow. Paramont Agent and an empty Composer were restored after verification.
- Native Plugin Inventory read-through, Extension Center absence/recovery, Native/PAIMind rollback and the other plugin surfaces remained operational. Harness upstream source stayed unchanged; its only status entry remained the pre-existing untracked `ppt-output/` directory.
