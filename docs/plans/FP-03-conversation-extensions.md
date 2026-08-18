# FP03 Conversation Extensions

> R1 result: `Harness Native Reuse`. The empty marker is absent from Bundle and client discovery; this document preserves only the native-capability mapping.

## Outcome

FP03 keeps DeepSeek Harness as the sole conversation renderer. Its former compatibility marker is retired; no second question flow, plan store, attachment queue, artifact list, retry machine, or renderer for Think/Read/Grep/Tool Call is retained.

## Capability mapping

| Prototype capability | Harness owner | FP03 decision |
|---|---|---|
| Structured question card | `@deepseek-ai/dsh-client-ui-user-questions` over the native pending-interaction/composer chain | Reuse. Single choice, multiple choice, custom answer, plan review, request identity, reconnect restoration, and bilingual copy remain native. |
| Plan progress | `@deepseek-ai/dsh-tool-todo` projection + `TodoPanel` in `conversation.input.dock` | Reuse. Harness `pending / in_progress / completed` is the only plan state. PAIMind does not mirror it. |
| Image attachment | `@deepseek-ai/dsh-attachment` + `@deepseek-ai/dsh-client-ui-attachment` + the native composer | Reuse. Browser draft bytes and durable image references stay Harness-owned. |
| Existing Workspace file reference | Harness input-reference pipeline and filesystem tools; later Better Sidebar explorer may provide an additional picker | Reuse as a file reference, not as a second uploaded attachment object. |
| Local PDF/PPT/DOC/XLS binary upload | No current public Harness byte-write/upload contract | Move to FP04/FP06. FP03 must not pretend that browser-only staging is a durable attachment. |
| Produced-file entry | `@deepseek-ai/dsh-client-ui-deliverables` in `conversation.chat.turnTail` | Reuse. Only successful file mutations produce openable chips and inline mentions. Preview routing is FP06-FP07. |
| Automatic model retry and terminal failure receipt | Harness `llm/retry`, `llm/retry-started`, and `turn/end` projections in `ui-conversation` | Reuse. Keep the native countdown, sanitized failure reason, terminal error row, and usable composer. Do not submit a duplicate turn from a PAIMind button. |
| Think, Read, Grep, Tool Call | Harness native conversation/tool renderers | Reuse unchanged. FP03 owns no keyed renderer for these rows. |

## Code boundary

The retired compatibility marker historically documented these native seams:

- exports a frozen capability manifest for later diagnostics and FP16 Developer Resources;
- declares the native client modules it relies on through `dsh.client.inject`;
- contributes no conversation slot and stores no Session data;
- registers only its standard invariant ownership companion;
- is installed and removed through `@paimind/harness-bundle` like other PAIMind packages.

No new Service, Slot, Event, persistence store, or permission decision is introduced in FP03. Native owners retain their existing authorization and failure paths.

## Data and state

- Questions: Harness pending interaction request/resolution frames.
- Plans: Harness `todos` projection.
- Images: Harness draft image controller and durable `ImageAttachmentRef`.
- Workspace files: plain reference identity/path resolved by Harness tools.
- Deliverables: successful tool mutation locations folded by Harness.
- Recovery: durable retry/error events folded by Harness.

The package manifest is descriptive and immutable; it never becomes a parallel runtime source of truth.

## Verification

1. Unit tests freeze and validate the capability inventory, including the explicit document-upload deferral.
2. A client integration test proves FP03 registers no native conversation slot and does not replace a renderer.
3. The standard invariant, type, production build, framework-boundary, install/remove, boot-manifest, and zero-upstream-delta gates pass.
4. Browser pre-acceptance exercises native question, Todo, image attachment, deliverable, retry/error, bilingual, theme, and narrow-layout states where the live Harness can produce them deterministically.
5. Think/Read/Grep/Tool Call visual regression proves FP01 remains the only PAIMind change to active row icons.

## Upgrade impact

Harness package names in `dsh.client.inject` and DOM/browser verification live at the composition boundary. Source code outside `@paimind/harness-compat` must not import version-sensitive Harness APIs. A Harness upgrade must re-run the native capability matrix; a missing provider blocks FP03 verification instead of silently switching to a PAIMind clone.
