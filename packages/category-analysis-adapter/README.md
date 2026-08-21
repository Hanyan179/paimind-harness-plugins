# `@paimind/category-analysis-adapter`

Deterministic synthetic category-analysis Tools for the Proposal Assistant demo.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Headless plugin**. It provisions one clearly labeled synthetic Dollar General frozen-data scenario and publishes performance and opportunity `paimind.data-result/v2` Artifacts through native Harness Tools and Jobs. It owns no proposal workflow, Fact Set, deck, renderer, trace UI or model route.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Host plugin, providers and Tool identifiers. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Composition invariant. |
| `./package.json` | `./package.json` | Package metadata. |

## Dependencies

- `@paimind/artifact-runtime` owns native Job and Artifact publication.
- `@paimind/presentation-contracts` owns source, Fact and data-result validation.
- The packaged runtime uses only Node.js standard-library modules.

## Lifecycle and failure

All providers and Tools are registered through Cordis-owned effects and fully disposed on unload. Invalid Workspace paths, unknown or cross-Session Artifact IDs, source hash mismatches and malformed data fail the native Job and publish no available result.

## Published files

Built JavaScript and declarations plus the deterministic Node runner and three synthetic CSV fixtures are published. Credentials, customer uploads, local Harness homes and generated outputs are excluded.

## Verification

- `pnpm exec tsc -b packages/category-analysis-adapter/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/category-analysis-adapter/tests`
- `node packages/category-analysis-adapter/runtime/runner.mjs --help`
- `pnpm run check:packages`
- `pnpm run check:packs`
