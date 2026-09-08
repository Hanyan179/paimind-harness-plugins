# `@hansen/user-settings`

PAIMind-owned live preferences in the canonical Harness Settings document.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns the product projection described above; Harness remains the canonical runtime and domain owner.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./preferences` | `./lib/types/preferences.d.ts`, `./lib/preferences.js` | Public package export. |
| `./remote` | `./lib/types/remote.d.ts`, `./lib/remote.js` | Public package export. |
| `./typert` | `./lib/types/typert.d.ts`, `./lib/typert.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## UI foundation

Shared tokens, controls and motion: [UI foundation contract](../../docs/standards/ui-foundation.md).

## Dependencies

- Internal runtime dependencies: `@hansen/ui-foundation` (`workspace:^`), `@hansen/contracts` (`workspace:^`), `@hansen/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `zod` (`^4.4.3`), `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. UI, listeners and registrations must be installed through scoped effects so unload removes them. Missing host services delay activation; package-local rendering failures must not corrupt the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/user-settings/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/user-settings/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`

## Appearance contributions

The native `settings.section` entry declares and renders `paimind.personalization.appearance` as an optional root list. Source plugins own those controls and their data; this package only hosts the slot. Collaboration unavailability or its enabled switch does not disable appearance. Visual fields never enter `paimind-user-settings`, its migration, or the personalization prompt.

## Editing and recovery

The source-owned `saveText` Remote commits Work Background (`aboutMe`) and Response Requirements (`customInstructions`) as a single native revision-protected operation batch. Existing `describe`/`mutate` contracts and public component scope signatures remain available. The live client requires the matching atomic-save method; it reports failure when unavailable rather than splitting a live text form into partial writes.

Unsaved editor state is bound to the plugin's client scope and survives section navigation. It is not written to local/session storage or model context. Source reloads reconcile saved fields without replacing dirty text; write failures keep the draft and expose the committed values separately. Unload disposes the editor, subscriptions and dirty-page warning. The save controls retain keyboard focus while the controller rejects overlapping writes.

The saved preview uses business-language fields and does not expose internal context markup. Communication Style, Work Background, and Response Requirements use consistent labels across editing, saved content, and both locales. Disabled assistant preferences retain editable saved values and report that they apply only after re-enabling. Browser refresh and plugin reload do not persist drafts.
