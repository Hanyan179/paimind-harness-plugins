# `@paimind/skill-market`

PAIMind center-column Skill Center, Business Skill authoring workspace, catalog adapter, and recoverable installer product layer over native Harness Skills.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client + host product plugin**. It contributes a `sidebar.footer.action` entry and `shell.overlay` workspace, while the same package mounts one Authoring/Installer Remote. It also registers the source-owned `paimind-skill-authoring` and `paimind-skill-installation` System Skills with their Tools. Harness remains the canonical discovery, invocation, and execution owner; this package does not create a second Skill registry, run history, identity model, or permission system.

## User journey and state projection

- `All Skills`, `Built-in`, and `Installed` form one keyboard-navigable scope. All Skills is an ephemeral, name-deduplicated union of the market catalog and installed business packages; Installed is its subset and shares descriptions, search, category and source filters. Built-in System Skills remain separate. Independent source failures retain the other source with an incomplete-list notice; unknown installation state never claims availability or enables installation.
- Search, product categories, source and install-state filters operate only on real catalog or installed metadata. The browser incrementally renders bounded result batches; a future remote-scale catalog must add server-side cursor pagination. The product intentionally exposes no like or favorite control. Source, license, package contents, and runtime ownership use progressive disclosure.
- Catalog and local `SKILL.md` / ZIP packages enter the same inspect-first pipeline. Install and update are explicit confirmation actions; an update uses staging, backup, atomic replacement, and rollback on commit failure.
- `Create Skill` opens the same reviewable Package Editor used by conversational drafts. The Skill folder is the source of truth: `SKILL.md` is the entry file, while `scripts/`, `references/`, `assets/`, nested text files, and visible binary resources stay in the same managed package. The UI lazily pages the directory tree, reads one file on demand, and submits only file-level changes; untouched files remain byte-for-byte unchanged.
- An ordinary Standard conversation loads `paimind-skill-authoring` from the System Skill catalog. Its structured `paimind_skill_prepare_create` Tool result opens an unsaved draft in this existing Skill Center; no keyword router or automatic Save exists.
- Managed uninstall moves the Skill to a recoverable backup. Externally installed Skills remain visible but fall back to management by their original source.
- Runtime invocation does not appear as Skill Center product state. Agent Center owns Business Skill selection, and Harness owns the selected Session catalog and execution.
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

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. The non-modal Center keeps the native sidebar visible and uses `@paimind/harness-compat` to portal only into the native conversation column; while open, only that column's native conversation occupant is inert and accessibility-hidden. A missing or ambiguous native anchor fails closed with no `document.body` fallback. The overlay Slot owns no route or domain state, and UI, listeners and registrations are scoped so hot reload or uninstall restores the native shell exactly.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`, `SKILL.md`, and `SKILL_AUTHORING.md`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/skill-market/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/skill-market/tests`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs install-v1`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs update-v2`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs uninstall`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
