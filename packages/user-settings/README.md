# `@paimind/user-settings`

PAIMind-owned live preferences in the canonical Harness Settings document.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns the product projection described above; Harness remains the canonical runtime and domain owner.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./preferences` | `./lib/types/preferences.d.ts`, `./lib/preferences.js` | Public package export. |
| `./remote` | `./lib/types/remote.d.ts`, `./lib/remote.js` | Public package export. |
| `./typert` | `./lib/types/typert.d.ts`, `./lib/typert.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/contracts` (`workspace:^`), `@paimind/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `zod` (`^4.4.3`), `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. UI, listeners and registrations must be installed through scoped effects so unload removes them. Missing host services delay activation; package-local rendering failures must not corrupt the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/user-settings/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/user-settings/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
