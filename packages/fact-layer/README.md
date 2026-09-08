# `@hansen/fact-layer`

Immutable source-linked Fact Set publication for PAIMind generators.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Headless plugin**. It resolves current-Session `paimind.data-result/v2` Artifacts, validates and merges their sources and Facts, rejects conflicts, and publishes one `paimind.fact-set/v1` Artifact. It owns no domain analysis, proposal workflow, deck narrative, rendering or trace UI.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Host plugin, provider and Tool identifier. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Composition invariant. |
| `./package.json` | `./package.json` | Package metadata. |

## Dependencies

- `@hansen/artifact-runtime` owns native Job and Artifact publication.
- `@hansen/presentation-contracts` validates data-result and Fact Set documents.

## Lifecycle and failure

The package registers one provider and one Tool through scoped effects. Cross-Session, missing, failed or non-JSON Artifacts fail before execution. Schema errors, conflicting source IDs, conflicting Fact IDs and invalid hashes publish no available Fact Set.

## Published files

Only built JavaScript, declarations and the deterministic merge runner are published. Source data, credentials, local Harness homes and generated Fact Sets are excluded.

## Verification

- `pnpm exec tsc -b packages/fact-layer/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/fact-layer/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
