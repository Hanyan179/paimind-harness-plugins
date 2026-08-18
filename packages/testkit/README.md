# `@paimind/testkit`

Shared PAIMind test helpers for lifecycle and Harness compatibility verification.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Shared support package**. It has no independent Harness lifecycle or product surface; runtime packages consume its exported contract.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: None.
- Client service injection: None.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Consumers import the public exports. The package registers no UI, listeners or services, so uninstall has no residual runtime resources. Incompatible imports fail through the exports or type boundary.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/testkit/tsconfig.json --pretty false`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
