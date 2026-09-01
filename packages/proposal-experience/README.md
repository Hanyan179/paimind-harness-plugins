# `@paimind/proposal-experience`

Guided proposal-question experience over native Harness pending interactions.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It renders only namespaced PAIMind proposal questions inside the native `conversation.composer` chain. It owns customer badges, deck-style previews, AI-navigation intents and responsive interaction presentation. Harness retains the Question request, answer, cancellation, Session and Agent lifecycle.

The selected Agent is the sole workflow owner: it reads current context, decides which background or style question is useful next, calls `ask_user_question`, consumes the human answer and decides the next action. Customer, Department, Deck Type and Deck Style are enhanced semantic question types, not a fixed step configuration; any `paimind.proposal.*` question authored by the Agent still receives the generic proposal treatment. After enough context exists, the Agent discovers and loads relevant Skills, then asks a `Content & data` multi-select question using those Skills' business offerings. Users choose proposal content and data, never Skills. This package never advances a local step machine, stores proposal answers, matches Skills, or writes the confirmed brief. `Back` returns a generic navigation intent; the Agent decides which prior context to revisit. `Cancel intake` also returns an explicit navigation intent so cancellation remains visible to the Agent as a normal Tool result. The Content & data answer starts the selected analysis path. The primary final delivery is an interactive, editable and traceable Bento Artifact generated from the exact verified Outline Artifact. An editable `.pptx` export is generated only when the current user explicitly requests it and never substitutes for the primary Bento delivery.

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

The client registers exactly one higher-priority selector that matches exactly one pending AI question whose id starts with `paimind.proposal.`. With no matching `ask_user_question` interaction it renders nothing, including when Proposal Assistant is the selected Preset. Other questions remain native. If the package is absent or its selector declines a request, Harness's generic question renderer answers it. Unload removes the slot registration, style and Extension Center descriptor.

## Published files

Only built JavaScript, declarations and source maps are published. The client bundle embeds three curated WebP style storyboards: Strategy Consulting, Paramont Signature and Playful Storybook. Generated PPT files, local runtime homes and customer data are excluded.

## Verification

- `pnpm exec tsc -b packages/proposal-experience/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/proposal-experience/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- Real Harness question, reconnect, Light/Dark and responsive browser pre-acceptance
