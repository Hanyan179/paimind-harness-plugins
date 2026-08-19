# `@paimind/harness-compat`

Version-scoped compatibility boundary for DeepSeek Harness and Cordis APIs.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Shared support package**. It has no independent Harness lifecycle or product surface; runtime packages consume its exported contract.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./host` | `./lib/types/host.d.ts`, `./lib/host.js` | Public package export. |
| `./client-icons` | `./lib/types/client-icons.d.ts`, `./lib/client-icons.js` | RC6-native semantic icon facade for PAIMind client surfaces. |
| `./client-surface` | `./lib/types/client-surface.d.ts`, `./lib/client-surface.js` | Client-only full-page surface coordination and focus lifecycle. |

## Dependencies

- Internal runtime dependencies: `@paimind/contracts` (`workspace:^`).
- External runtime or peer dependencies: `@deepseek-ai/cordis` (`^4.0.1`), `@deepseek-ai/dsh-client-ui-primitives` (`0.1.0-rc.6`), `@deepseek-ai/dsh-agent` (`^0.1.0-rc.6`), `@deepseek-ai/dsh-llm` (`^0.1.0-rc.6`), `@deepseek-ai/dsh-schedule` (`^0.1.0-rc.6`), `@deepseek-ai/dsh-storage-domain` (`^0.1.0-rc.6`), `@deepseek-ai/dsh-settings` (`^0.1.0-rc.6`), `@deepseek-ai/dsh-tools` (`^0.1.0-rc.6`), `@deepseek-ai/dsh-typert-protocol` (`^0.1.0-rc.6`), `@deepseek-ai/schemastery` (`^3.18.1`).
- Client service injection: None.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Consumers import the public exports. The package registers no UI or services; the client-surface controller owns only document listeners and removes them on disposal. Incompatible imports fail through the exports or type boundary.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/harness-compat/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/harness-compat/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
