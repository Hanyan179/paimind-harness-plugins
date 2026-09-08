# `@hansen/agent-builder`

Headless PAIMind business-profile service over native Harness Agent Presets.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Headless plugin**. It owns its service or adapter boundary and exposes no independent browser surface.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./remote` | `./lib/types/remote.d.ts`, `./lib/remote.js` | Public package export. |
| `./typert` | `./lib/types/typert.d.ts`, `./lib/typert.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@hansen/contracts` (`workspace:^`), `@hansen/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `@deepseek-ai/dsh-home-paths` (`0.1.0-rc.8`), `zod` (`^4.4.3`).
- Client service injection: None.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

The bundle mounts the Node entry in Cordis. Declared services must be available before activation, and all actions, listeners and resources must be scoped to unload cleanup. Invalid configuration fails at the package boundary without mutating upstream Harness state.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/agent-builder/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/agent-builder/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
