# `@paimind/skill-market`

PAIMind full-page Skill Center, catalog adapter, and recoverable installer product layer over native Harness Session skills.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It contributes a `sidebar.footer.action` entry and `shell.overlay` workspace, while the same package mounts the product-layer Installer Remote used by that surface. Harness remains the canonical discovery, invocation, and execution owner; this package does not create a second Skill registry, run history, identity model, or permission system.

## User journey and state projection

- `Catalog`, `Installed`, and `Favorites` form one keyboard-navigable scope instead of duplicate navigation.
- Search and filters operate only on real catalog or installed metadata. Source, license, package contents, and runtime ownership use progressive disclosure.
- Catalog and local `SKILL.md` / ZIP packages enter the same inspect-first pipeline. Install and update are explicit confirmation actions; an update uses staging, backup, atomic replacement, and rollback on commit failure.
- Managed uninstall moves the Skill to a recoverable backup. Externally installed Skills remain visible but fall back to management by their original source.
- The client projects Harness-native status as no Session, checking, available now, unavailable, waiting for discovery, or new-conversation refresh required. “Use in conversation” writes `/${name} ` into the active Harness draft and never executes through a PAIMind shadow runtime.
- Light, Dark, and System themes consume `--paimind-*` visual tokens with Harness fallbacks. Desktop uses list-plus-detail; narrow screens keep the list in the first viewport and open detail as a full-height sheet.
- Loading, empty, error, disabled, upload-cancel, install/update review, and recoverable-uninstall states are keyboard and screen-reader reachable.

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
- External runtime or peer dependencies: `@deepseek-ai/dsh-home-paths` (`0.1.0-rc.8`), `fflate` (`^0.8.3`), `yaml` (`^2.9.0`), `yauzl` (`^3.2.0`), `zod` (`^4.4.3`), `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-ui-conversation`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-slots`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. The full-page surface uses the native sidebar and overlay Slots and owns no route or domain state. UI, listeners and registrations are scoped so hot reload or uninstall removes them without affecting the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/skill-market/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/skill-market/tests`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs install-v1`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs update-v2`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs uninstall`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
