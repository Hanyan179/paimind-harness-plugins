# `@hansen/task-monitor`

Read-only Session and Project monitor derived from native Harness facts.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It consolidates the native `agent-preset`, `subagent-catalog`, `job-list`, and `session-log-download` header seats into one Task Monitor utility by reversible slot election. Exact-ID shadow seats suppress the three left-side renderers, while Task Monitor replaces the right-side Session Log cell without modifying the native registrations. The panel projects Session, Goal, Todo, Plan, Workflow, Subagent, Tool Call, Job, Artifact, Deliverable, Agent Preset, invoked Skill and evidenced MCP facts, while delegating Session Log export to the native Harness controller. Its summary exposes only non-zero facts; each visible statistic is a real button that scrolls and focuses its corresponding detail group. Optional sections and rows are omitted when their deterministic source is empty; dense collections show four primary rows (five for current Todo items), then place the remainder behind explicit disclosures. Subagents live inside the Agent resource group rather than Task Progress, use the full row as their keyboard-accessible native navigation target, keep running children first, and fall back to exact Session navigation only if the native child navigator throws. The main Agent uses a fixed role icon and keeps provider/model details in a hover/focus tooltip instead of a persistent chip. Subagents use a stable, extensible icon-variant registry with exact-name hover/focus tooltips; the variants distinguish siblings visually without inventing unsupported capabilities. Skill and MCP rows display only deterministically used resources, use a success-state treatment without a redundant `Used` suffix, and omit request-catalog-only MCP servers. It prefetches and session-caches the native paginated Session History outside the click path, so old Skill/MCP evidence and native `todo/write` checklist records remain visible without delaying panel open. Repeated Todo snapshots are grouped into current and historical checklist records in the ephemeral View Model; no copied log, checklist identity or Task Monitor state is persisted. Harness remains the canonical runtime and domain owner; this package owns no task store, status machine, export pipeline or mutation API.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@hansen/artifacts` (`workspace:^`), `@hansen/contracts` (`workspace:^`), `@hansen/harness-compat` (`workspace:^`), `@hansen/workspace-project` (`workspace:^`).
- External runtime or peer dependencies: `lucide-react` (`0.562.0`, exact), plus `react` and `react-dom` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-ui-conversation`, `@hansen/artifacts`, `@hansen/workspace-project`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. UI, listeners and registrations must be installed through scoped effects so unload removes them. The optional native Session History API fails closed to the already loaded render window. Its in-memory cache is performance-only and disappears with the client process; package-local rendering failures must not corrupt the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/task-monitor/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/task-monitor/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`

## 2026-08-17 Agent-icon and summary-drill-down read-back

- Non-zero checklist, Subagent and output summary values are native `<button>`
  controls. Browser read-back confirmed that `查看子代理：2` focuses the exact
  Subagent group rather than acting as decorative text.
- The main Agent row uses a fixed `Bot` role icon. Two real child Sessions used
  distinct `browse` and `think` variants from an eight-slot registry; every row
  retained its exact native Session name and Agent Preset.
- Hovering the first avatar showed `全量对账 outline 与数据源` with computed
  tooltip opacity `1`. Clicking the full row opened the exact child Session and
  exposed the native parent/child breadcrumb.
- Desktop and `560×800` browser checks found no document or panel horizontal
  overflow. The focused Task Monitor suite passed 3 files / 13 tests and the
  standalone browser bundle built successfully.
- Full repository Type Check remains blocked by the separately modified,
  untracked `@hansen/harness-compat/client-surface` implementation; that failure
  is not masked or accepted as part of this package read-back.

## 2026-08-17 Agent-resource grouping read-back

- Two real child Sessions moved from Task Progress into the Agent resource group.
  The `2 子代理` summary button focuses that group, and the full child row
  still opens the exact native child Session.
- Provider/model parameters are absent from the persistent row. Keyboard focus
  on the main Agent exposed the real `aliyun · deepseek-v4-flash-0731`
  tooltip.
- Four exact used Skills render as green bare-name chips. The selected Session
  has no exact used MCP call, so no MCP row is rendered; request-catalog-only
  availability remains hidden.
- Focused verification passed 3 files / 13 tests, package TypeScript and the
  standalone browser bundle. Real desktop and narrow Bottom Sheet interaction
  checks passed with no observed horizontal overflow.
