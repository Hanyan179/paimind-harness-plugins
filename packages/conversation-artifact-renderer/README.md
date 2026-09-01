# `@paimind/conversation-artifact-renderer`

Format-aware cards for files produced in Harness conversations.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It projects native Turn Deliverables into file-format cards in `conversation.chat.turnTail`. It owns no file bytes, Artifact state machine or viewer. An exact registered Bento Artifact opens through the owner-provided `PaimindArtifactService.open` route; every other file falls through to the native `openFile` route, so registered Bento, PDF and Office viewers remain authoritative.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | No-state Host plugin entry. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Turn-tail selector, format mapping and cards. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Package ownership companion. |
| `./package.json` | `./package.json` | Public package manifest. |

## Dependencies

- Internal runtime dependencies: `@paimind/artifacts` (`workspace:^`) and `@paimind/harness-compat` (`workspace:^`).
- External peer dependency: `react` (`>=18.0.0 <20.0.0`).
- Client service injection: Harness runtime, locale, slots, conversation, deliverables and `@paimind/artifacts`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. The plugin registers at priority `-10`, ahead of the official priority-`0` produced-file row. It claims only Turns with producer-declared Deliverables; removing or delaying this package restores the official row automatically. Bento identity requires an exact current-Session Artifact tuple and never comes from the suffix or model prose. Styles and Slot registration are scoped and reversible.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Source tests, local Harness homes, generated screenshots and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/conversation-artifact-renderer/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/conversation-artifact-renderer/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
