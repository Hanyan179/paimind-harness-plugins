# `@paimind/walmart-proposal-adapter`

Native Harness Tool adapter for deterministic Walmart proposal analysis and outline CLIs.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Headless plugin**. It adapts the frozen PAIMind Python analysis baseline to native Harness Tools, Jobs and Artifacts without owning a second runtime registry or persistence layer.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Host plugin and Tool identifiers. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Composition invariant. |

## Dependencies

- `@paimind/artifact-runtime` owns Job and Artifact publication.
- `@paimind/presentation-contracts` validates the generated Outline.
- Runtime resources use Python 3.12 through the packaged hash-locked `uv.lock`.
- The analysis source baseline is `1f9fd80ea073a4ab4b5665b2300f7930f3f0520f`.

## Lifecycle and failure

The plugin registers three Tools and three generator providers. Each call starts a bounded Python CLI process through the native Harness command Tool. Missing sources, hash mismatches, unknown Artifact IDs, wrong producers, dependency-lock failures and invalid output fail the native Job and publish no successful Artifact. No Python service remains after execution.

## Published files

Built JavaScript and declarations plus the explicitly allowlisted Python runner, upstream CLI sources, category profile, SQL template, `pyproject.toml`, `uv.lock` and source commit marker are published. Skills, credentials, fixtures, live database configuration and generated outputs are excluded.

## Verification

- `pnpm exec tsc -b packages/walmart-proposal-adapter/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/walmart-proposal-adapter/tests`
- `uv run --project packages/walmart-proposal-adapter/runtime --locked --python 3.12 python packages/walmart-proposal-adapter/runtime/runner.py --help`
- `pnpm run check:packages`
- `pnpm run check:packs`
