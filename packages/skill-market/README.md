# `@paimind/skill-market`

PAIMind full-page Skill Center and governance product layer over native Harness Session skills.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It contributes a `sidebar.footer.action` entry and `shell.overlay` workspace; Harness remains the canonical runtime and domain owner.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./catalog` | `./lib/types/catalog.d.ts`, `./lib/catalog.js` | Public package export. |
| `./recommended` | `./lib/types/recommended.d.ts`, `./lib/recommended.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./remote` | `./lib/types/remote.d.ts`, `./lib/remote.js` | Public package export. |
| `./typert` | `./lib/types/typert.d.ts`, `./lib/typert.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/contracts` (`workspace:^`), `@paimind/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `@deepseek-ai/dsh-home-paths` (`0.1.0-rc.6`), `fflate` (`^0.8.3`), `yaml` (`^2.9.0`), `yauzl` (`^3.2.0`), `zod` (`^4.4.3`), `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-ui-conversation`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-slots`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. The full-page surface uses the native sidebar and overlay Slots and owns no route or domain state. UI, listeners and registrations are scoped so hot reload or uninstall removes them without affecting the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/skill-market/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/skill-market/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
