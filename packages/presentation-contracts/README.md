# `@paimind/presentation-contracts`

Validated outline, fact, binding and trace contracts shared by presentation generators and provenance consumers.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Shared support package**. It validates producer-owned presentation data and does not own a Harness lifecycle or browser surface.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public contract types, validators and deterministic trace derivation. |

## Dependencies

- Internal runtime dependencies: None.
- External runtime or peer dependencies: None.
- Client service injection: None.

## Lifecycle and failure

Consumers validate untrusted model or Tool output before publishing an Artifact. Invalid identities, missing sources, unresolved bindings, unknown selectors and changed fact values fail closed.

## Published files

Only built JavaScript, source maps and declarations under `lib/` are published. Tests, fixtures and local evidence are excluded.

## Verification

- `pnpm exec tsc -b packages/presentation-contracts/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/presentation-contracts/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
