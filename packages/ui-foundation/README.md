# `@paimind/ui-foundation`

Shared PAIMind client tokens and lightweight UI primitives over Harness theme variables.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Shared support package**. It defines presentation-only tokens and scoped primitive styles. It does not register a Harness lifecycle, own a product surface, or replace native Harness components.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Scoped PAIMind UI foundation CSS consumed by client plugins. |

## Dependencies

- Internal runtime dependencies: None.
- External runtime or peer dependencies: None.
- Client service injection: None.

## Lifecycle and failure

Client plugins include the exported CSS in their own Cordis-managed style node. All rules are scoped below `data-paimind-ui-scope`, so missing consumers or unloads cannot alter native Harness UI.

## Published files

Only built JavaScript, source maps and declarations under `lib/` are published. Tests and local evidence are excluded.

## Verification

- `pnpm exec tsc -b packages/ui-foundation/tsconfig.json --pretty false`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
