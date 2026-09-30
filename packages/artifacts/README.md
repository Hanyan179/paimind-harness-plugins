# `@paimind/artifacts`

Session/Workspace artifact projection with direct file and Bento workbench routing.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns the Artifact registry, projection and path/deep-link routers. It deliberately registers no fixed sidebar overview; exact Artifact links open the matching file viewer or hidden Bento workbench. Harness remains the canonical runtime and domain owner.

`projectSessionArtifactRead` is a stateless Node-safe view over original native
produced-file facts and the existing `paimind.artifacts` projection. It validates
explicit Session/Workspace association, preserves source identities/revisions
and failed states, and returns no trace document or file bytes. Missing product
projection is explicitly `unavailable`, not a ready empty list. Listed
`available` means recorded by the producer, not a fresh filesystem existence
check or authorization to open the file. There is no additional registry,
directory discovery, persistent cache or runtime service.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/better-sidebar-adapter` (`workspace:^`), `@paimind/contracts` (`workspace:^`), `@paimind/harness-compat` (`workspace:^`), `@paimind/renderer-bento` (`workspace:^`), `@paimind/workspace-project` (`workspace:^`).
- External runtime or peer dependencies: `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-slots`, `@paimind/better-sidebar-adapter`, `@paimind/renderer-bento`, `@paimind/workspace-project`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. UI, listeners and registrations must be installed through scoped effects so unload removes them. Missing host services delay activation; package-local rendering failures must not corrupt the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/artifacts/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/artifacts/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
