# `@paimind/proposal-experience`

Guided proposal-question experience over native Harness pending interactions.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It renders only namespaced PAIMind proposal questions inside the native `conversation.composer` chain. It owns customer badges, deck-type previews and responsive interaction presentation. Harness retains the Question request, answer, cancellation, Session and Agent lifecycle.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Package identity and proposal question ids. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Package ownership invariant. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Namespaced native-question renderer. |
| `./package.json` | `./package.json` | Harness client discovery export. |

## Dependencies

- `@paimind/harness-compat` isolates the native pending-question and composer-chain shape.
- React is a peer dependency supplied by the Harness Web client.
- The selected Agent still calls native `ask_user_question`; this package registers no model Tool.

## Lifecycle and failure

The client registers one higher-priority selector that matches exactly one question whose id starts with `paimind.proposal.`. Other questions remain native. If the package is absent or its selector declines a request, Harness's generic question renderer answers it. Unload removes the slot registration, style and Extension Center descriptor.

## Published files

Only built JavaScript, declarations and source maps are published. Deck previews are code-native CSS miniatures; screenshots, generated PPT files, local runtime homes and customer data are excluded.

## Verification

- `pnpm exec tsc -b packages/proposal-experience/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/proposal-experience/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- Real Harness question, reconnect, Light/Dark and responsive browser pre-acceptance
