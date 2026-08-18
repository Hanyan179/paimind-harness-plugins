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
