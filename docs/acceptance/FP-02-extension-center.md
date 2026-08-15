# FP02 Extension Center Acceptance

## Current status

`Technically Verified` and `Product E2E Verified` in R1 on 2026-08-14. The former Launcher is retired from Bundle and client discovery; its source remains private migration history until repository deletion has a recoverable Git baseline.

## Target entry

- URL: `http://127.0.0.1:3080/`
- Entry: Harness Settings → `Extension Center` / `扩展中心`.
- The page is a capability management surface, not a launcher.

## Product acceptance

1. The page shows exactly seven product categories: Experience, Content & Rendering, Agents, Skills & Tools, Automation, Governance and Developer.
2. Installed PAIMind capabilities appear from their self-registered descriptors; category, description, maturity and actual entry surface are accurate.
3. Technical module/load/enablement/Fiber state comes from Harness Plugin Registry and matches Settings → Plugins for the same package. Version/dependency remain Harness-owned but are not exposed by the current public Remote, so v1 does not display guessed values.
4. Cards do not open Agent Center, Task Monitor, Viewer or other workflows. Configuration opens only a registered Settings contribution.
5. No install/remove/enable control appears while the Harness management API is read-only.
6. Removing one extension removes only its descriptor/card and contribution; other extensions and native conversation continue.
7. Removing Extension Center leaves Harness Settings → Plugins and every independent feature entry surface intact.
8. Chinese/English, Light/Dark, reduced motion, keyboard/focus and narrow layouts are usable.
9. One malformed descriptor or failed technical-state read produces a bounded card/page error and never blocks native Settings.

## Verified browser procedure

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
