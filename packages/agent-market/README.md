# `@paimind/agent-market`

PAIMind full-page Agent Center and governance product layer over native Harness Agent Presets.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It contributes a `sidebar.footer.action` entry and `shell.overlay` workspace; Harness remains the canonical runtime and domain owner.

Reconnecting a saved creation conversation first proves its original native
history is readable, then resumes that exact Session with its native listed cwd
through the original create/resume verb. It does not override the preset, move
the workspace, create a replacement identity, send a model prompt, or save the
profile. The resumed identity and Standard preset are verified before the
existing authoring seal/context steps. Missing or changed cwd, failed history,
denied resume, different identity/preset, and unload keep the draft and fail
without falling back to another conversation.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/agent-builder` (`workspace:^`), `@paimind/contracts` (`workspace:^`), `@paimind/harness-compat` (`workspace:^`), `@paimind/skill-market` (`workspace:^`), `@paimind/ui-foundation` (`workspace:^`).
- External runtime or peer dependencies: `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-ui-conversation`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-workspaces`.

The manifest is authoritative for dependency direction and version selection.

The client also provides `paimindAgentCenterContributions`, a single-provider UI contribution service whose types are exported by `./client`. Enterprise administration is its real consumer. It accepts owned catalog panels and a personal-card action, not resource records, permissions, native APIs or a second runtime. No provider means the original product navigation remains unchanged.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. The full-page surface uses the native sidebar and overlay Slots; its secondary advanced action reopens Harness's native Agent Preset settings through the compatibility adapter. UI, listeners and registrations are scoped so hot reload or uninstall removes them without affecting the native shell.

In managed member presentation, the same surface retains personal authoring and use, omits the advanced navigation adapter, and prevents business creation/editing entry points from starting a native authoring flow. Unknown startup presentation fails before remote mounting. The compatibility marker is not role authority: the authenticated gateway and native/resource owners still authorize every operation. Business catalog metadata is not presented as proof of enterprise assignment.

The Builder owns unsaved-change confirmation. Its existing product-surface controller registers a disposable close guard for keyboard, buttons and cross-surface navigation; cancelled native-sidebar clicks cannot change the current Session. Browser reload uses the normal before-unload protection. No draft is auto-saved, and no second persisted draft store is introduced. Closing a saved form or leaving the browsing list remains unchanged.

## Published files

The manifest includes built JavaScript, declarations and their maps, excluding the internal `lib/types/client/styles.d.ts` and its map because no public type entry consumes them. Runtime styling remains in the client bundle. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/agent-market/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/agent-market/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
