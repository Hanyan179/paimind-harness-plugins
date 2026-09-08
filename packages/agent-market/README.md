# `@hansen/agent-market`

PAIMind full-page Agent Center and governance product layer over native Harness Agent Presets.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It contributes a `sidebar.footer.action` entry and `shell.overlay` workspace; Harness remains the canonical runtime and domain owner.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@hansen/agent-builder` (`workspace:^`), `@hansen/contracts` (`workspace:^`), `@hansen/harness-compat` (`workspace:^`), `@hansen/skill-market` (`workspace:^`), `@hansen/ui-foundation` (`workspace:^`).
- External runtime or peer dependencies: `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-ui-conversation`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-workspaces`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. The full-page surface uses the native sidebar and overlay Slots; its secondary advanced action reopens Harness's native Agent Preset settings through the compatibility adapter. UI, listeners and registrations are scoped so hot reload or uninstall removes them without affecting the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/agent-market/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/agent-market/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
