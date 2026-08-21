# FP01 Design QA

## Comparison input

- Source reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-b29bdb06-ad2e-473c-b2d7-d53da319a3e3.png`
- Implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-unified-history-orbs-20px.jpg`
- Combined dark-theme settled-row comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-native-vs-unified-orbs.jpg`
- Live tool state: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-live-bash-status.jpg`

The source and implementation crops were normalized to the same 536px row-region width and the same settled-history state before comparison.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the nine small visual primitives intentionally share a quiet monochrome particle language; their silhouette, dynamic label, and motion state carry differentiation.

## Verified behavior

- 20px orbs occupy the native 16px leading slot without changing the 24px row rhythm.
- Settled history is paused; only rows explicitly marked `running` animate.
- Final idle browser measurement: 69 history orbs, all 69 paused, 0 playing.
- Hover and expanded states return the native chevron.
- Error and stopped rows retain native semantic status markers.
- Dark theme and 390px narrow layout preserve contrast and show no horizontal overflow.
- Browser live run synchronized Think, Bash, main status, and sidebar state.

final result: passed

---

# Agent Builder Dual-pane Design QA

## Comparison input

- User reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-8d8c9ecd-87a0-41fd-89ca-89591ae1bce5.png` (`4266 x 2970`; the red annotation identifies the intended form-and-conversation split).
- Live Harness implementation: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f0b-14ce-7851-9ca3-2993ac3bb988/agent-center-dual-pane-delivered-1280x720.png` (`1280 x 720`, live `http://127.0.0.1:3080/`).
- Native-session restoration: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f0b-14ce-7851-9ca3-2993ac3bb988/agent-center-session-restore-1280x720.png`.
- Native Session-tree re-entry: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f0b-14ce-7851-9ca3-2993ac3bb988/agent-authoring-session-click-reopen-1280x720.png` (`1280 x 720`; selected from the normal Harness Session tree after first opening an ordinary Session).

The reference and implementation were reviewed together. The delivered state converts the annotated empty right area into the real Harness conversation while keeping the editable Agent brief on the left; no parallel message renderer, Session store, or shadow Agent identity was added.

## Findings

- P0: none.
- P1: none after the native conversation became visible, interactive, and session-bound in the Builder.
- P2: none after the Builder surface stopped the outer scroll chain and gave the left form its own mouse-wheel scroll region.
- P3: Harness still renders the configuration draft payload in its canonical conversation history; this is intentional runtime ownership rather than duplicated PAIMind chat UI.

## Verified behavior

- At `1280 x 720`, the Builder is a true split surface: left form `x=280..845` (`565px`) and native conversation `x=845..1280` (`435px`). The page has zero horizontal overflow.
- The right pane is the unique native Harness conversation content, marked through the compatibility lease; the PAIMind Builder does not contain another composer.
- The real authoring Session appears immediately in the native Session tree and the connection state reaches `Harness native configuration conversation connected`.
- Selecting an existing canonical `Agent authoring` Session from the native Session tree reopens the same dual-pane Builder and reconstructs the editable brief from real Harness history. Ordinary Sessions do not open Agent Center, and closing the Builder does not loop-open it until the user switches away and selects the authoring Session again.
- A real mouse-wheel gesture changed the left form scroll position from `18` to `538` (`+520px`) without moving or covering the native conversation.
- The native Composer accepted `双屏右侧原生输入联动验收`; closing the Builder restored the prior Session, while `Start conversation` keeps the newly selected Agent Session active.
- Independent authoring Sessions can progress concurrently; duplicate work in the same Session remains guarded.
- Model-proposed Skills are restricted to exact installed Harness Skills, so an uninstalled suggestion no longer aborts the generated brief.
- Browser Console errors: `0`. Targeted Vitest: `2 files / 37 tests` passed. Package TypeScript build, package-only client build, and `git diff --check` passed.

final result: passed

---

# FP-17 PAIMind Visual Experience Design QA

## Comparison input

- Source prototype: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-3ba83237-9a85-4520-b7f4-5ea41e5c9af7.png` (`1611 x 781`, clean PAIMind new-conversation reference).
- Live Harness implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/02-welcome-light-1512x982.png` (`1512 x 982`, System resolving to Light).
- Same-canvas comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-visual-experience-plugin-plan/implementation/reference-implementation-comparison.png` (`2560 x 720`; the source was proportionally normalized and centered on a `1280 x 720` canvas before comparison).
- Dark theme: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/07-welcome-dark-1280x720.png`.
- Native rollback and PAIMind restoration: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/08-native-mode-persisted-after-refresh.png` and `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/09-paimind-restored-after-refresh.png`.
- Workbench density: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/10-workbench-density-better-sidebar.png`.
- Focus density, Task Monitor and real approval: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/18-focus-density-approval-rejection.png`, `19-task-monitor-themed-long-run.png` and `20-real-approval-card.png`.
- Responsive new conversation and picker: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-completion-audit/23-welcome-light-900x720.png`, `04-welcome-light-390x844.png` and `05-agent-picker-bottom-sheet-390x844.png`.
- Source annotation for the sidebar brand and Composer `@` follow-up: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-0fcdd648-6e9e-4e9e-a471-72e0b514be20.png` (`4506 x 2562`).
- Browser-rendered `@` state: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/01-composer-at-1280x720.png` (`1280 x 720` CSS viewport and pixels, Light, expanded sidebar) and `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/02-composer-at-390x844.png` (`390 x 844` CSS viewport and pixels, mobile rail).
- Restored expanded brand: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/03-expanded-brand-restored-1280x720.png`.
- Full-view follow-up comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-20-fp17-composer-feedback/04-reference-implementation-comparison.png` (`2560 x 720`; the annotated source was proportionally normalized to `1280 x 720` beside the `1280 x 720` implementation).

The prototype and live implementation were compared in the same new-conversation state. The reference image was normalized to the live `1280 x 720` canvas without changing its content hierarchy; the implementation intentionally retains Harness workspace, permission and model controls rather than reproducing prototype mock data.

The follow-up annotation describes a desired interaction region rather than a rendered open-menu target, so a separate pixel-fidelity crop would create false precision. The full-view comparison preserves every annotation, while browser measurements verify the focused Composer and brand geometry directly.

## Iterations

1. Corrected Better Sidebar detection so an empty `data-dsh-sidebar-collapsed` attribute means collapsed rather than open.
2. Made the Agent bridge await the canonical native seat load before reading the roster, preserving the native selector on failure.
3. Replaced trust-based Quick Agent filtering with the native non-broken recommended roster because installed PAIMind official Presets can retain Harness `user` trust provenance.
4. Moved Quick Agents below the main Composer to match the source hierarchy and suppressed them in active conversations.
5. Rechecked the combined reference/implementation image after each layout change.
6. Limited Focus Density to semantically collapsed Think, Tool and Context rows; expanded content, errors and approvals remain full-size.
7. Fixed the `390px` hero selector row so the Agent trigger ends at `372px` instead of overflowing the viewport.
8. Mapped the logical `paimind.visual-experience` namespace to Harness rc.8's native `paimind-visual-experience` key so Native / PAIMind mode survives refresh.
9. Re-anchored the native Harness input overlay above the Composer without replacing its candidate data, draft state, highlight, keyboard behavior or selection route; its height uses measured room above the Composer and restores Quick Agents after dismissal.
10. Added border-box sizing after the first live pass showed the menu's padding extending five pixels past the `866px` viewport; the revised `1280 x 720` and `390 x 844` captures keep the complete menu inside the viewport.
11. Made the expanded Paramont wordmark flex within the native brand seat and verified the mark, official wordmark and `HARNESS` suffix all remain inside the `216 x 24px` host button.
12. Added 96×96 WebP portraits from the frozen prototype and one Paramont brand avatar. The same canonical-Preset resolver now drives `@` Agent candidates, Quick Agents and the visible Preset picker; valid unknown ids receive a deterministic visual projection without creating identity metadata.
13. P2 observed: the first `390 x 844` avatar captures were covered by Better Sidebar, and the first narrow `@` capture exposed native fixed row height that caused name/description overlap. The desktop listbox also allowed the welcome heading to remain visible through the material.
14. P2 fix: closed the right panel before capture, changed narrow candidate rows to auto-height two-row layout with a two-line description clamp, and raised Light/System and Dark listbox backgrounds to solid theme-derived surfaces while retaining blur and shadow.
15. P2 post-fix: `30` proves the unobscured 390px new-conversation Quick Agent and Preset trigger; `31` proves the 390px `@` menu; `32`, `33` and `34` prove System, Light and Dark desktop listbox opacity. All eight visible mobile Agent rows measured `66px`, name-to-description gap `2px`, row/list horizontal overflow `0`, and 96×96 decoded images in 32px circular slots.
16. Release-blocker follow-up: the shared fresh in-app `1280 x 720` matrix found `@` settling with eight Agents and zero Skills, the Settings Native radio not changing its checked or persisted state, and Agent Center managed cards exposing no portrait images.
17. Source-level fix: PAIMind `@ Skill` now delegates candidates and picks to rc.8's resident native `skill` source instead of owning a second `skills.list` Promise cache; the runtime manifest adds the native Skill package as a load-order dependency. The Settings radio owns its complete hit target and the mode controller always reconciles with the committed native Settings snapshot. The avatar presenter consumes Agent Center's semantic `[data-paimind-agent-avatar-seat][data-paimind-agent-id]` contract, defers to any native image, and removes only its own projection on Native or Dispose.
18. Post-fix browser verification is pending because viewport-override tab creation caused the shared in-app Browser control channel to time out and reset for both the owner and Root. Existing `3080` tabs received the new HMR revision, but this infrastructure limitation is not counted as interaction evidence.
19. Post-restart browser verification recovered in fresh in-app tab `14` at `1280 x 720`. The default `Paramont 助手` correctly showed eight Agents and zero Skills because that canonical Preset had no packaged Session Skills. Switching through Quick Agents to `官方技能验证助手` exposed the same `@` listbox with 11 options: eight Agents plus the three native Session Skills `openai-docs`, `skill-creator` and `skill-installer`. Picking `openai-docs` wrote the exact executable draft `/openai-docs `. This verifies native capability-scoped delegation; it does not imply a fixed Skill count for every Agent.
20. Settings rollback passed after the controlled Harness process restart (`PID 72183`). Clicking the real Native radio changed its checked state and `data-paimind-experience` to `native`; Quick Agents, PAIMind avatars, the hero and Composer marker all dropped to zero. Native `@` restored 70 File, Folder and Session reference candidates. Fresh tab `15` persisted Native with every PAIMind surface still absent, and clicking PAIMind restored the experience marker, Quick Agents, avatars, hero and Composer treatment.
21. Agent Center managed-card avatar coverage passed in the same live browser run: My Agents exposed three semantic seats for `agent-center-4e4319`, `genui-163d65` and `my-agent-80ef93`; the resolver projected three distinct assets (`content-expression`, `project-progress`, `technical-expert`), each decoded at its natural `96 x 96` size and reported `ready=true`. Platform Mode cards exposed zero portrait seats and zero injected portrait images, preserving their native mode icons. The post-fix screenshot was visually inspected with no broken image or layout regression.

## Findings

- P0: none after fresh capability-scoped `@` Agent + Skill composition, Settings persistence/rollback and Agent Center managed-card portraits passed in the post-restart browser run.
- P1: none.
- P2: none.
- P3: the implementation keeps a 56px collapsed Harness navigation rail and the canonical workspace / permission / model controls. These are deliberate runtime affordances, not prototype mismatches.
- P3: unknown but valid canonical Presets receive a deterministic portrait from the six-file prototype pool. This is intentionally a visual projection rather than identity metadata; future Harness native avatar metadata has higher priority. Mobile keeps a two-line description clamp instead of removing the explanation.

## Verified behavior

- `1280 x 720` new conversation uses Calm density, has zero document overflow, places Quick Agents 16px below the Composer and shows three current non-broken recommended Presets.
- The desktop Agent picker is grouped into Recommended Agent and Platform Mode, measures `333px` high (below the `360px` limit), updates its explanation on focus and hover, and returns focus to its trigger after Escape.
- Quick Agent selection changed the canonical native Preset to `Paramont 助手`; selecting `极简模式` in the custom picker restored the native staged selection.
- `1512 x 982`, `1280 x 720`, `900 x 720` and `390 x 844` all have zero horizontal overflow. Visible Quick Agents reduce from three to two to one. Mobile uses a bottom-aligned `390 x 483px` Bottom Sheet with a scrim and `22px` top corners.
- Workbench density hides the mountain environment and subtitle, limits Quick Agents to two and does not change the user's Better Sidebar preference. Focus density hides Quick Agents and leaves the collapsed Think row at `24px` while preserving full message content.
- Expanded and compact native navigation both render the Paramont identity; no visible DeepSeek brand remains outside the selected model name.
- Light, Dark and System controls were exercised. System resolved to Light under the current macOS preference; Dark used the optimized dark ridge asset.
- `PAIMind -> Native -> PAIMind` removed and restored the title, theme projection, Quick Agents and custom picker while keeping the settings row. Both Native rollback and restored PAIMind mode persisted after refresh.
- In PAIMind mode the `@` list is anchored above the Composer. At `390 x 844` it occupies `x=83..355`, `y=9..422`; each Agent row is `66px`, retains a clamped two-line explanation and has zero horizontal overflow. The final `1280 x 720` Light/System and Dark captures likewise place the solid theme-derived listbox above the Composer with no welcome-heading bleed-through.
- Post-fix browser result: PAIMind `@` retains the native controller route and scopes `paimind-skill` candidates to the selected canonical Preset's packaged Session Skills. `Paramont 助手` truthfully returned zero Skills; `官方技能验证助手` returned `openai-docs`, `skill-creator` and `skill-installer` alongside eight Agents, and selecting `openai-docs` produced the exact executable draft `/openai-docs `. No fixed Skill count is asserted across Agents.
- Expanded brand geometry is fully visible: mark `x=16..40`, wordmark group `x=48..205.7`, inside the native button `x=16..232`. The follow-up browser console contained zero Error entries.
- Prior FP17 baseline: the earlier follow-up Type Check passed through the direct local TypeScript binary with five focused test files / eight tests. The current Composer/avatar package-local result is recorded separately below; the `pnpm` command wrapper remains blocked by its time-based minimum-release-age policy for the expected Harness rc.8 lockfile entries, not by product code.
- Agent-avatar post-fix evidence: `/Users/hansen/.codex/visualizations/2026/08/20/01a01f49-e994-75f1-ba8d-a00ccf6dd2fb/fp17-composer-audit/30-postfix-avatar-quick-preset-system-390x844.jpg`, `31-postfix-avatar-at-menu-system-390x844.jpg`, `32-postfix-avatar-at-menu-system-1280x720.jpg`, `33-postfix-avatar-at-menu-light-1280x720.jpg`, and `34-postfix-avatar-at-menu-dark-1280x720.jpg`.
- At 390px the document and Composer listbox each had zero horizontal overflow; one Quick Agent, the official Paramont Preset avatar and the `@` Agent portrait set were visible with no broken image or bitmap upscaling. The mobile menu remained inside `x=83..355`, `y=9..422`.
- Post-fix Native rollback: the Settings radio became checked, every PAIMind-only surface and presenter image dropped to zero, and Native `@` restored 70 untouched File/Folder/Session reference candidates. Fresh tab `15` persisted Native; selecting PAIMind restored the experience marker, Quick Agents, avatars, hero and Composer treatment.
- Post-fix Agent Center avatar coverage: three managed-card semantic seats resolved to three distinct 96×96 prototype portraits with `ready=true`; platform Mode cards retained their native mode icons and received no portrait seats or images.
- Current release-blocker package-local gate: 10 package-local files / 40 tests passed; direct local `tsc -b packages/harness-compat/tsconfig.json packages/visual-experience/tsconfig.json` passed; both packages completed isolated esbuild output. Dry pack produced `@paimind/harness-compat` at 89,422 bytes / 22 entries and `@paimind/visual-experience` at 137,690 bytes / 31 entries, including seven 96×96 avatar WebPs totaling 12,908 bytes plus `assets/ASSETS.md`. The `pnpm exec` wrapper remains blocked before test execution by the time-based minimum-release-age policy for the expected rc.8 lockfile entries; the direct installed Vitest runner passed.
- A real out-of-workspace write produced the Harness approval card; rejection restored the conversation without creating the requested Desktop file.
- Final browser log contained zero error entries. The only warnings were expected connection retries from deliberate Harness restarts; GenUI reported its existing informational DOM-channel fallback.
- Final Root-coordinated `pnpm run check:fast` passed: forced Type Check and the single final Root Build passed; full Vitest passed `78` files / `309` tests. Package compliance, all `33` dry packs, strict publint, `101` NodeNext exports, examples, `91` Markdown documents, framework verification and `git diff --check` all passed. The protected API snapshot passed `33` package contracts with SHA-256 `b0afe007e09700ad2bdb7d582aa1d7b9d6c7dba44d53b34a7be76150027b168a`; the shared Build hash is `81dfea4f527e21e30feda5f8b74982325e31f30e8378e031aca9ba37a666179d`. This owner independently reran the read-only API snapshot check after the Ready Signal and received the same protected-baseline pass.
- Exact Harness `0.1.0-rc.8` verification passed Agent Center and Skill Center together, each center independently absent, Native restore and zero upstream source delta. Exact Harness `0.1.0-rc.8` + Better Sidebar `0.12.2` + Office Viewer `0.1.0` composition passed full install/start/remove/restore, independent Visual Experience install/remove and cleanup, Extension Center absence and each key product-plugin absence. The read-only upstream status remains only the pre-existing untracked `ppt-output/` directory.
- Final post-restart `1280 x 720` PAIMind new-conversation check, performed without another viewport override, retained Calm density, the hero, four Quick Agents, four natural `96 x 96` portraits and zero horizontal overflow. The session was returned to `Paramont 助手` with an empty Composer; the earlier `@` Agent/Skill, executable Skill draft, Native persistence/rollback and Agent Center portrait evidence remained valid.

final result: passed — Development Complete after final Root-coordinated shared gates; Product Accepted remains gated by the shared test environment

---

# Agent Center and Skill Center Full-page Design QA

## Comparison input

- Agent Center reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-a6068cd9-4e62-423c-86bc-d148d0652b5f.png`.
- Skill Center reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-fd52808d-21e0-41e7-ac05-6001c7e4b46e.png`.
- Agent Center implementation: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/agent-center-final-1700x850.png`.
- Skill Center implementation: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/skill-center-final-1700x850.png`.
- Same-viewport combined comparison: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/reference-vs-implementation-1700x850.png`.
- Dark theme: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/skill-center-dark-1700x850.png`.
- Narrow single-column layout: `/Users/hansen/.codex/visualizations/2026/08/17/01a00e6b-9e54-76b1-9a6f-827755d8a525/agent-center-narrow-880x900.png`.

Both references were normalized to the same `1700 x 850` viewport as the live
Harness implementation before comparison. The references define hierarchy,
density and visual language; demo identities, counts, permissions and usage were
intentionally not reproduced.

## Findings

- P0: none.
- P1: none.
- P2: none after fixing surface clipping, collapsed-rail action overflow and the focused-heading outline.
- P3: the implementation keeps the reference's spacious hero, filter hierarchy and card/list-detail rhythm while using only live Harness data and official icons.

## Verified behavior

- Both centers render through `shell.overlay` as body portals and cover the full
  viewport, including Better Sidebar's fixed tool panel.
- Settings contains no Agent Center or Skill Center rows; the native Settings
  surface and Agent Preset advanced configuration remain available.
- Expanded and collapsed sidebar entries both work. Collapsed product actions
  stack vertically inside the native footer rail without horizontal overflow.
- Agent Center search, Platform/My tabs, Builder panel, Escape, mutual switching,
  focus return and real Session start were exercised in the live browser.
- The real personal Agent `官方技能验证助手` created a new native Session,
  selected that Preset and wrote the expected introduction draft.
- Skill Center search, source/status/favorite filters, detail selection and native
  Slash Draft handoff were exercised; `openai-docs` produced `/openai-docs ` in
  the current Harness conversation.
- Light, Dark and System theme controls were exercised. `1700 x 850`, `1024 x 850`
  and `880 x 900` states have zero document horizontal overflow; the `880px`
  state uses one-column cards.
- Browser Console produced zero new warning or error entries after the settled
  final reload. Earlier host-connection retries and one existing Better Sidebar
  `agent-terminals` error occurred while the local server was rebuilding.
- Disposable Harness composition passed with both centers, either center absent,
  both removed, native restoration and zero DeepSeek Harness worktree delta.

final result: passed

---

# Task Monitor Agent Identity Design QA

## Comparison input

- Source reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-b26f2a9d-a2f3-49fa-8e96-ab9bd414a702.png` (`1332×1560`, annotated pre-change Task Monitor).
- Implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-icons-hover-1332x1560.png` (`1332×1560`, live Harness with first Subagent tooltip visible).
- Side-by-side comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-reference-vs-implementation.png`.
- Narrow layout: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-560x800.png`.

The reference and implementation were captured at the same pixel dimensions and
the same parent Session with two Subagents. Blue rectangles in the reference are
user annotations, not visual components to reproduce.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the compact `420px` panel intentionally remains denser than the annotated
  reference while preserving the same summary-to-detail hierarchy.

## Verified behavior

- Checklist, Subagent and output summary statistics are icon buttons; clicking
  `2 子代理` focuses the real Subagent group.
- The main Agent has a fixed role icon. Two real Subagents render different
  `browse` and `think` variants from an eight-slot extensible registry.
- Hovering the first avatar shows the exact native name with tooltip opacity `1`.
- Each full row remains clickable and navigates to the correct native child
  Session, where the parent/child breadcrumb is visible.
- Agent, Skill and MCP labels use a consistent library icon language; empty MCP
  evidence stays omitted.
- Desktop and `560×800` states have no document or panel horizontal overflow.
- No Task Monitor Console Error was observed. One existing Better Sidebar
  `agent-terminals` connection error remains outside this plugin's scope.

final result: passed

---

# Task Monitor Agent Resource Group Design QA

## Comparison input

- Source reference: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-e648292f-0918-44b0-b996-14e0021e356e.png` (`1308×1256`, Retina `2x`; focused source crop `840×1256`, normalized to `420×628`).
- Live desktop implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-v2.png` (`1550×768`, Chrome at the inspected `80%` visual scale).
- Model hover/focus state: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-model-tooltip-v2.png`.
- Normalized focused comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-comparison-v2.png` (`840×628`; implementation crop `340×680`, normalized to `420×840` and top-aligned to the source state).
- Narrow Bottom Sheet: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/task-monitor-2026-08-17/task-monitor-agent-group-narrow-v2.png`.

The live state is the same real parent Session with two native Subagents, four
used Skills and no exact used MCP call. Blue rectangles in the source are user
annotations rather than UI components.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the implementation intentionally keeps the existing compact panel rhythm;
  green chips communicate deterministic used state without adding a text suffix.

## Verified behavior

- Typography preserves the host title/body hierarchy; provider and model text is
  removed from the persistent layout and appears only in a compact tooltip.
- Spacing and layout place native child Sessions directly beneath the main Agent
  inside one resource group. The former duplicate child block is absent from
  Task Progress.
- Colors use the existing success token for used Skill and used MCP chips. No
  request-catalog-only MCP row or empty resource placeholder is shown.
- The main Agent keeps the fixed role icon. Subagent rows keep distinct variants
  from the extensible registry, exact-name tooltips and trailing navigation icons.
- Visible copy contains bare Skill names without the redundant `已使用` suffix.
- Clicking `2 子代理` focuses the Agent child group. Keyboard focus on the
  main Agent exposes `aliyun · deepseek-v4-flash-0731`; clicking a child row
  opens the exact native child Session and its parent/child breadcrumb.
- Desktop and the narrow Bottom Sheet both keep content inside the panel with no
  observed horizontal overflow; wrapped Skill chips remain readable.

final result: passed

---

# Bento Toolbar Harmonization Design QA

## Comparison input

- Source visual truth: `/var/folders/rm/83swjql96xg01d0jdshqkwkr0000gn/T/codex-clipboard-2f93b81b-e0b8-47d5-b823-15f143bf8a7e.png` (1241 x 548, Better Sidebar native HTML Viewer, Light, Preview).
- Rendered implementation: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/r5-bento-toolbar-alignment/bento-toolbar-final.png` (1280 x 720, live Harness at `127.0.0.1:3080`, Light, Preview with Trace hover).
- Focused implementation crop: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/r5-bento-toolbar-alignment/bento-toolbar-focus.png`.
- Side-by-side focused comparison: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/r5-bento-toolbar-alignment/toolbar-comparison.png`.

The comparison uses the host viewer as positional truth: document title first, an independent left-aligned mode toolbar beneath it, and content below the toolbar. Bento intentionally retains its icon-only controls and adds Trace as its third product-specific mode.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: Bento keeps a 40px icon group instead of copying the host's text buttons; this preserves the requested compact visual language while matching the host's information hierarchy.

## Verified behavior

- DOM order is `header -> toolbar -> workbench`; the toolbar is no longer placed at the right side of the title row.
- Live geometry at 1280 x 720: header `y=35..86`, toolbar `y=86..135`, workbench starts at `y=135`; toolbar and title share the same 12px left inset.
- Preview, Edit, and Trace remain icon-only buttons with accessible Chinese labels.
- Hovering Trace exposes only `溯源`; other mode tooltips remain hidden.
- Edit becomes active and shows the editable-copy / locked-fact guidance.
- Trace becomes active and mounts the trace inspector in the same workbench.
- The page has zero horizontal overflow, zero Console Error entries, and the Bento iframe contains zero external `src` / `href` references.
- Repository gates passed with 70 test files / 233 tests; exact Harness 0.1.0-rc.6 + Better Sidebar 0.12.2 + Office Viewer 0.1.0 install, boot, remove and restore composition also passed with zero upstream delta.

final result: passed
