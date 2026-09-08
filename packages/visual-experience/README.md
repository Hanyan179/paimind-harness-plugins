# `@hansen/visual-experience`

Reversible configurable visual and interaction experience layer for DeepSeek Harness.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns theme overrides, shared design tokens, semantic experience markers, welcome presentation, Quick Agents, compact Agent Preset presentation and focus/workbench density. `@hansen/branding` remains the owner of product identity; Harness remains the canonical owner of Agent Presets, Sessions, Settings and runtime state.

Compact sidebar navigation projects live source-plugin footer contributions into
an Agent shortcut, one optional pinned shortcut, and a searchable resource
library. Notifications and Settings retain their native controls in one utility
row. Source plugins provide short label, description and group metadata on their
existing trigger; new ids remain discoverable without a second registry.
The optional shortcut id is a browser-local preference owned by this package
(`paimind.visual-experience.navigation.pinned.v1`), not an Agent or Skill binding.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Host Settings namespace registration. |
| `./settings` | `./lib/types/settings.d.ts`, `./lib/settings.js` | Experience-mode contract and decoder. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Package ownership invariant. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Browser experience contribution. |
| `./package.json` | `./package.json` | Harness client discovery export. |

## UI foundation

Shared tokens, controls and motion: [UI foundation contract](../../docs/standards/ui-foundation.md).

## Dependencies

- Internal runtime dependencies: `@hansen/ui-foundation` (`workspace:^`), `@hansen/branding`, `@hansen/harness-compat` (`workspace:^`).
- Host Settings dependencies: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`.
- External peer dependencies: `react`, `react-dom` (`>=18.0.0 <20.0.0`).
- Client injection: native connection, locale, runtime, Agent Preset, conversation, layout, primitives, Settings, slots, theme and workspace services.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

The default mode is `paimind`; `native` disposes theme overrides and the single-slot Preset replacement while retaining only the Settings row and package description. Roster or native-seat discovery failures leave `conversation.hero.agentPreset` untouched. Unload removes styles, theme layers, observers, events, portals, slots and semantic markers; persisted Settings may remain for reinstall recovery.

Native mode, rendering failure, or navigation unmount restores the original
footer controls. The compatibility adapter owns all footer/settings DOM seams;
source unload removes the corresponding library entry and active shortcut.

## Published files

The manifest allowlist contains built JavaScript, declarations, source maps, optimized WebP assets and their provenance documents. Source PNGs, generation evidence, tests, local Harness homes, screenshots and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/visual-experience/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/visual-experience/tests packages/harness-compat/tests/experience.spec.ts`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
- Selected Harness + Better Sidebar browser matrix and reversible install/uninstall rehearsal

## Motion preference

The existing native Settings namespace `paimind.visual-experience` owns `motion: system | on | off`, defaulting to `system`. The client controller projects it to document attributes for independently bundled consumers, handles live OS changes, rejects overlapping writes, and rolls back failures. No browser persistence is introduced. Native visual mode preserves the separate motion preference for PAIMind consumers.

The client contributes to the optional `paimind.personalization.appearance` child slot owned by User Settings. When that owner is absent, General Settings renders the same source-owned component. Unload removes both contribution and DOM projection; consumers revert to the system preference.
