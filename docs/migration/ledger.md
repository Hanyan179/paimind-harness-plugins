# PAIMind Harness Migration Ledger

## Baselines

- Frozen PAIMind prototype commit: `baa8a0f3bdf5b0787491c4c4fac627f2a8a30321`.
- Active Harness runtime: exact npm `@deepseek-ai/dsh@0.1.0-rc.6`.
- Harness source-integrity sentinel: checkout `47f943859bef60e4160492346772ded9b24f765a`; it is not treated as the source provenance of the npm `rc.6` artifact.
- Harness upstream source policy: zero PAIMind changes.
- Prototype data policy: synthetic and browser-local data are not formally migrated.

## Status dimensions

- Technical State records code, build, isolation, security and component verification.
- Product State records native reuse, retirement, or the real Agent → Native Job → native `tool/result.meta` → Session Projection → Deliverable → Viewer product loop.
- Historical `Verified` evidence is preserved below, but a user-facing package is complete only when its Product State is `Product E2E Verified`, `Native Reuse`, or `Retired`.

## PRR-01 revised status

| Unit | Capability | Technical State | Product State | Next gate |
|---|---|---|---|---|
| F0 | Plugin framework | Technically Verified | Not Applicable | Keep Artifact truth-plane and compatibility regression gates |
| FP01 | Runtime Orb | Technically Verified | Product E2E Verified | Keep regression coverage |
| FP02 | Launcher → Extension Center | Technically Verified | Product E2E Verified | Keep native inventory/descriptor/browser regression coverage |
| FP03 | Conversation extensions | Native regression verified | Native Reuse | Empty marker retired from Bundle and client discovery |
| FP04 | Workspace bridge | Headless adapter Technically Verified | Not Applicable | Keep `Project = Workspace` context and zero-visible-slot regression |
| FP05 | Task Monitor | Technically Verified | Product E2E Verified | Keep real Native Job, isolated-removal, Dark/narrow and restart-truth regression gates |
| FP06 | PDF/PPT artifact preview | Technically Verified | Product E2E Verified | Keep real-generator, local PDF.js and provider-fallback regression gates |
| FP07 | HTML/Bento/XLSX preview | Technically Verified | Product E2E Verified | Keep formulas, CSP, revision and restart regression gates |
| FP08 | Presentation Trace | Technically Verified | Product E2E Verified | Keep exact Envelope correlation, real lineage and restart replay gates |
| FP09 | Agent Center | Technically Verified | Product E2E Verified | Keep business configuration, real first turn, version binding and old-conversation migration as regression gates |
| FP10 | Agent Builder | Headless Service | Retired as independent UI | Keep profile/version/migration service; no Settings entry or browser bundle |
| FP11 | Skill Market | Technically Verified | Product E2E Verified | Keep streaming install/update/uninstall, live discovery and real slash invocation as regression gates |
| FP12 | Notification Center | Technically Verified | Product E2E Verified | Keep trusted Artifact producer, read persistence, exact deep-link, portal stacking, failure and isolated-removal regression gates |
| FP13 | Scheduled Tasks | Technically Verified | Product E2E Verified | Keep native create/due/restart/delete/error/isolation and capability-boundary regression gates |
| FP14 | Settings | Technically Verified | Product E2E Verified | Keep canonical Settings, live Prompt, reduced-motion, notification-policy, isolated-removal and rc.6 Remote-adapter regression gates |
| FP15 | Permissions/Admin | Technically Verified | Native Reuse + Retired | Keep native Read Only denial, provider-absence, no-fake-Governance, failure-notification and upstream-isolation regression gates |
| FP16 | Developer Resources | Technically Verified | Product E2E Verified | Keep exact native inventory, single Slot ownership, outage/no-stale-state, isolated-removal and bundled-reference regression gates |

## Historical technical evidence

| Unit | Capability | State | Verification gate |
|---|---|---|---|
| F0 | Plugin framework | Verified | Passed |
| FP01 | Runtime Orb animations | Verified | Active sequential row or full contiguous parallel batch animates; an `ok / ok / running` three-search batch keeps all three orbs until group completion; the localized status keeps the native elapsed timer and never duplicates row orbs; 34-test full gate, build, composition, browser, and zero-upstream-delta checks passed |
| FP02 | Extension Center | Verified | Former Launcher retired from Bundle/client discovery; independent Harness Settings section with seven product categories and six current product descriptors; native Plugin Inventory load/enable/Fiber phase join; read-only failure state; `102/102` full tests, typecheck, production build, descriptor-completeness gate, exact Harness install/boot/remove/restore, seven-feature boot without Extension Center, Chinese/English, Light/Dark, category/search browser checks and zero-upstream-delta passed |
| FP03 | Conversation extensions | Verified | No duplicate UI/state; 4 focused PAIMind tests, 38-test full gate, 96 native-provider regressions, production build, isolated install/boot/remove, live question/Todo/deliverable/failure/restart browser gates, and zero-upstream-delta passed; durable document upload is assigned to FP04/FP06 because Harness rc.5 exposes no public byte-write/upload contract |
| FP04 | Project/Workspace bridge | Verified | `Project = Workspace`; visible header action retired; client publishes only `paimindWorkspaceProject`, registers zero slots/styles and keeps no second Project store; full R1 build/composition/browser zero-visible-entry gate passed |
| FP05 | Better Sidebar adapter and independent PAIMind Task Monitor | Verified | R2/R3 proved the real Native Job and Artifact correlation chain. The final checkpoint passed Dark desktop, a real 560px fixed Drawer, isolated Profile boot with Task Monitor absent while generators/viewers/Extension Center remain, 41 files / 122 tests, production build, adapter v3 boundary scan and zero-upstream-source-delta. Native Harness Tasks remain separate |
| FP06 | Artifact bridge and PDF/PPT preview | Verified | R3 real Agent generated 3-page PPTX and PDF from an empty Workspace, then updated both in place; native Job, Tool Result metadata, Session Projection, Deliverable, preview, failure-without-artifact, refresh and restart gates passed. `@paimind/renderer-pdf` renders the real PDF locally through the stable adapter because the provider's browser-native iframe was blank in the selected Chromium surface |
| FP07 | HTML/Bento/Spreadsheet preview | Verified | R3 real Agent generated and revised formula XLSX, self-contained HTML and isolated Bento; real formulas, no-external-resource, Viewer, Native Job, Deliverable, failure, refresh and restart gates passed |
| FP08 | Presentation trace | Verified | Revision-3 PPTX emitted structured provenance through the same native Tool Result and Artifact Session Projection; exact Trace action, 3-page Business Evidence, Validate/Render/Publish lineage, calculation/code drill-down, refresh/restart replay and failure isolation passed |
| FP09 | Agent Center | Verified | Same five native Preset ids in Harness and Agent Center; search/filter/favorite and restart recovery; blank Session selected native `minimal`, completed a real turn, then locked; Chinese/Dark, English/Light, 560px narrow, 44 files / 130 tests, build, isolated package removal and zero-upstream-delta passed |
| FP10 | Personal Agent Builder | Verified | Real native copy → `cordis` Creator Session → one-time Harness approval → actual `preset.yml` edit → metadata-aware Available receipt → native Preset execution passed; refresh/restart recovery, system modify exclusion, bounded Undo on disposable copies, Chinese/Dark, English/Light, 560px narrow, 47 files / 139 tests, build, isolated package removal and zero-upstream-delta passed |
| FP11 | Skill market | Verified | Exact native `/pai` catalog and policy match; real `/paimind-catalog-e2e` prefill/manual send produced native Skill injection and response; 50 files / 146 tests, build, themes, 560px, restart, isolated removal and zero-upstream-delta passed |
| FP12 | Notification center | Verified | Real Agent generated two HTML Artifacts through native Jobs and structured Tool Result metadata; unread/read-all, exact artifact focus, refresh/restart/reinstall persistence, real Read Only failure without false Artifact, Chinese/Dark, English/Light, 560px Drawer, portal stacking fix, 53 files / 156 tests, build, full exact composition, Notification-absent isolation and zero-upstream-delta passed |
| FP13 | Scheduled tasks | Verified | Official Schedule v1 enabled; real Agent create, canonical fold, due follow-up, trusted notification, refresh/restart recovery, delete, invalid-rule failure, themes/narrow and PAIMind-only isolation passed; model misrouting remained visible and was corrected through native events |
| FP14 | Personal Center and settings | Verified | Harness owns Language/Theme/Model/Permission/Composer; PAIMind canonical Settings namespace drives a real System Prompt, PAIMind-only reduced motion and future-notification policy. Real model, two Artifact/Job/Viewer/Notification branches, refresh/restart, themes, 560px, 57 files / 174 tests, production build, isolated removal and zero-upstream-delta gates passed; synthetic Memory/localStorage settings retired |
| FP15 | Permissions and administration | Verified | Harness Permission Preset is Native Reuse; browser role/RBAC and local Configuration Studio publication are Retired. Provider-neutral core fails closed without authenticated identity; real native Read Only denial, honest Governance empty state, safe failure notification, 57 files / 178 tests, build, exact composition and zero-upstream-delta gates passed |
| FP16 | Developer resources | Verified | Native Plugin Inventory exposed 38 exact PAIMind Loader rows; live Surface Catalog and eight bundled integration boundaries passed refresh, restart, outage/retry, themes, narrow layout, 59 files / 186 tests, build, FP16-absent isolation and zero-upstream-delta gates |

After `PRR-01`, fixture-only automated/browser evidence may advance Technical State but never Product State. R1-R6 and the reopened FP05 product-UI gate are verified. R3 restored FP06-FP08 only after the complete real AI generation, Native Job, Deliverable, Viewer, Trace, revision, failure, refresh and Harness restart gates recorded in [`../checkpoints/R3-real-ai-generation.md`](../checkpoints/R3-real-ai-generation.md). FP05 evidence is recorded in [`../checkpoints/FP05-product-ui-completion.md`](../checkpoints/FP05-product-ui-completion.md); FP09 evidence is recorded in [`../checkpoints/FP09-agent-center.md`](../checkpoints/FP09-agent-center.md); FP10 evidence is recorded in [`../checkpoints/FP10-agent-builder.md`](../checkpoints/FP10-agent-builder.md); FP11 evidence is recorded in [`../checkpoints/FP11-skill-market.md`](../checkpoints/FP11-skill-market.md); FP12 evidence is recorded in [`../checkpoints/FP12-notifications.md`](../checkpoints/FP12-notifications.md); FP13 evidence is recorded in [`../checkpoints/FP13-scheduled-tasks.md`](../checkpoints/FP13-scheduled-tasks.md); FP14 evidence is recorded in [`../checkpoints/FP14-user-settings.md`](../checkpoints/FP14-user-settings.md); FP15 evidence is recorded in [`../checkpoints/FP15-permissions-administration.md`](../checkpoints/FP15-permissions-administration.md); FP16 evidence is recorded in [`../checkpoints/FP16-developer-resources.md`](../checkpoints/FP16-developer-resources.md).

R7 completed the final one-Session, five-format Product E2E on the promoted
provider, permission failure, refresh/restart recovery, controlled plugin
isolation and prototype runtime retirement. Evidence is recorded in
[`../checkpoints/R7-final-e2e-retirement.md`](../checkpoints/R7-final-e2e-retirement.md)
and the complete capability disposition is in
[`prototype-retirement-ledger.md`](prototype-retirement-ledger.md).

The post-branding completion audit re-ran the evidence instead of inheriting the
historical label. It repaired the Scheduler Host/Web schema boundary, then
passed `64` test files / `194` tests, full Type Check, Production Build,
`20`-client framework verification, exact selected-runtime composition, eight
independent-absence profiles, zero Harness upstream delta, live R7 Session
replay, independent Task Monitor Drawer, `3080` availability and `4187`
retirement. The prototype's current seven retained tracked modifications are
disclosed and preserved; Goal A makes no clean-worktree claim for user work.

The canonical-object completion audit subsequently reopened FP13 and removed
the shadow platform Scheduler from the formal Goal A runtime. The selected
`@paimind/scheduler` now folds official `schedule/change` events and submits
create/delete only through the current Harness Session prompt. The future
`@paimind/platform-scheduler` and its adapters remain buildable but unselected.
The final corrected gate passed 71 test files / 208 tests, Production Build, 21
buildable-client framework verification, a 20-client exact Harness composition,
zero upstream delta, and a real browser create → native fold → delete loop with
zero new Scheduler console errors.

The independent RQ-103 research Profile subsequently completed a real scheduled
Harness Agent → Native Job → final Run → exact Session navigation loop and the
Feishu PRD was read back at Revision 30. This is Local Pre-acceptance Passed for
the standalone research package only; the formal Goal A Bundle remains native
and no shared-environment or production activation is claimed.

The later user activation decision promotes RQ-103 into the local main `3080`
profile and formal PAIMind Bundle as the single PAIMind Scheduled Tasks surface.
The active PAIMind Bundle now selects only `@paimind/platform-scheduler` plus
the Harness, HTTP and Feishu-bot Adapter services. The old
`@deepseek-ai/dsh-schedule`, `@deepseek-ai/dsh-time-context` and
`@paimind/scheduler` rows are all unselected, eliminating the duplicate
technical plugin and product-entry ambiguity. Business action registrations
and credentials remain deployment-owned. This is local-main activation, not a
shared-environment production release.

## External provider matrix

| Provider | Candidate | Required Harness peers | Selected Harness | State | Upgrade rule |
|---|---:|---:|---:|---|---|
| `dsh-better-sidebar` | `0.12.1` | `^0.1.0-rc.6` | exact npm `@deepseek-ai/dsh@0.1.0-rc.6` | Selected and Verified in R7; adapter contract `3`; upgraded from verified `0.11.0` | Never follow `latest`, a caret range or a Git branch. Record a new release as Candidate and promote it only after the full isolated upgrade gate passes |
| `@huanlin/dsh-plugin-better-sidebar-plugin-office` | `0.1.0` | Declared `dsh-better-sidebar@^0.6.0`; observed metadata mismatch on selected `0.12.1` | exact npm `@deepseek-ai/dsh@0.1.0-rc.6` + `dsh-better-sidebar@0.12.1` | Selected technical viewer provider after real PPTX/XLSX composition and browser gates; peer warning retained as known risk | Keep exact; re-run real Office Viewer gates for either package upgrade and prefer a future release whose peer metadata matches the selected provider |
