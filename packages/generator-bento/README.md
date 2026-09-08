# `@hansen/generator-bento`

Native Harness Tool provider for PAIMind Bento presentation artifacts.

It is also the owning package for `paimind.html-presentation/v1`: registered
HTML templates, visual style tokens, the fixed 16:9 canvas, deterministic
layout rendering, and edit-lock annotations all live here rather than in the
Skill ZIP or an Agent-authored HTML blob.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns the product projection described above; Harness remains the canonical runtime and domain owner.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./presentation-spec` | `./lib/types/presentation-spec.d.ts`, `./lib/presentation-spec.js` | HTML presentation template and style registry. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@hansen/artifact-runtime` (`workspace:^`), `@hansen/contracts` (`workspace:^`), `@hansen/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-ui-slots`.

The manifest is authoritative for dependency direction and version selection.

## HTML presentation specification

- Logical canvas: 1280×720, fixed 16:9; the isolated viewer scales and
  letterboxes the canvas without changing slide geometry.
- Registered templates: `generic-dark`, `wmt-kids-mod`.
- Registered style presets: `startup-pitch`, `data-intelligence`,
  `storytelling-with-data`, `warm-editorial`, `financial-elite`, `wmt-retail`.
- Registered densities: `airy`, `balanced`, `dense`.
- Ordinary slide headings, explanations, and `presentationOnly` copy are
  editable in the current viewer session. Source values and derived metrics
  carry `data-edit-lock="fact"` and remain read-only.

The two template identities are Harness-native adaptations of the registry in
`paimind python` commit `1f9fd80ea073a4ab4b5665b2300f7930f3f0520f`.
The plugin does not embed the Python renderer, sample deck data, or PPTX
conversion runtime.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. UI, listeners and registrations must be installed through scoped effects so unload removes them. Missing host services delay activation; package-local rendering failures must not corrupt the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/generator-bento/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/generator-bento/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
