# `@paimind/ui-foundation`

Shared PAIMind client tokens and lightweight UI primitives over Harness theme variables.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Shared support package**. It defines presentation-only tokens, scoped primitive styles and the shared motion contract. It does not register a Harness lifecycle, own a product surface, or replace native Harness components.

Canonical usage: [UI foundation contract](../../docs/standards/ui-foundation.md).

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Scoped PAIMind UI foundation CSS consumed by client plugins. |

## Dependencies

- Internal runtime dependencies: None.
- External runtime or peer dependencies: None.
- Client service injection: None.

## Lifecycle and failure

Client plugins include the exported CSS in their own Cordis-managed style node. Primitive rules are scoped below `data-paimind-ui-scope`; motion duration tokens also support explicitly owned `data-paimind-motion-scope` roots. Consumers opt into these rules and clean up their own styles on unload.

## Published files

Only built JavaScript, source maps and declarations under `lib/` are published. Tests and local evidence are excluded.

## Verification

- `pnpm exec tsc -b packages/ui-foundation/tsconfig.json --pretty false`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`

## Motion lifecycle

`resolvePaimindMotion` defines system/on/off behavior. `installPaimindMotionPreference` is installed once by Visual Experience; `readPaimindMotion` and `subscribePaimindMotion` work across independently bundled clients and fall back to the OS when the source is absent. The foundation has no storage, network service, host lifecycle, or business state. Motion CSS only defines opt-in duration tokens; it does not suppress arbitrary host or generated-content animations.

## Shared controls and keyboard

`data-paimind-ui-switch` provides a 44 px target and shared track/knob geometry while leaving layout to its consumer. Narrow-screen controls and radio labels use 44 px targets. `handlePaimindTabKey` activates and focuses local tabs using arrow keys, Home and End, excluding disabled, hidden and nested tabs. The consumer owns selected state and roving `tabIndex`. Motion loops consume `--paimind-motion-iterations` together with duration tokens.
