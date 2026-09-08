# FP01 Runtime Orbs Implementation Plan

## Outcome

Add the PAIMind runtime-state orb family to the native Harness conversation and unify the compact activity-icon language without replacing messages, disclosures, composer behavior, or the agent loop.

## Native reuse and PAIMind contribution

- Reuse Harness `ConversationSnapshot`, native ReasoningRow/Tool row disclosures, Session replay, theme tokens, and `conversation.input.dock`.
- Replace the two native live-status visuals: the current Session sidebar indicator and the `Deep diving...` turn status.
- Replace the active collapsed leaf Context/Think/Tool/Bash leading icon with a type-mapped animated orb. A contiguous parallel tool-call batch animates as one unit until its final call settles, so faster siblings never mix static and animated icons inside the same batch. Running parent rows yield to precise children. Sequential completed rows, failed/stopped rows, hovered rows, and expanded rows keep native Harness semantics.
- Reuse `thinking-orbs` for the nine visual primitives.
- Keep visual phase derivation in `@hansen/harness-compat`; the component receives only a resolved presentation.

## Runtime mapping

| Harness fact | Phase | Orb |
|---|---|---|
| `openState=loading` or `composerPhase=engaging` | loading | working |
| latest structural node is `context`, or exact `read`/`read_file` tool | working | working |
| streaming partial ends in `reasoning` | thinking | solving |
| exact `create_plan`, `update_plan`, or `todo_write` tool | planning | weaving |
| exact `grep`, `rg`, `ripgrep`, `search`, or `web_search` tool | searching | searching |
| exact `generate_pdf`, `generate_ppt`, or `create_presentation` tool | shaping | shaping |
| another running tool | tool-use | connecting |
| streaming partial ends in `text` | replying | composing |
| pending question or approval | waiting | breathing |

`listening` remains an available visual primitive but has no automatic phase until Harness exposes an explicit listening event. Display labels and model prose never select an orb.

## Failure and accessibility behavior

- Idle sessions render no live-status row; settled history always uses native icons.
- One sequential running leaf or every member of an active contiguous parallel batch plays an activity orb. The entire batch returns to native icons together after its final call settles; unrelated completed rows remain native. While any row owns an orb, the turn-status surface keeps a localized dynamic label without rendering an extra orb; phases without a matching row use the status orb as fallback.
- Pending user interaction has precedence over a still-running tool.
- The status uses `role=status` and localized text.
- Dark mode follows `data-ds-dark-theme`.
- reduced-motion follows `prefers-reduced-motion` and pauses the canvas.
- An animation render failure is caught locally; native icons/status remain available through CSS `:has()` fallbacks and the native conversation remains mounted.

## Verification

- Mapping unit tests for every automatic phase and idle state.
- Component tests for reasoning, file generation, waiting, Chinese/English labels, native status replacement, parallel-leaf arbitration, native settled history, Bash specialization, multi-session activity, registration, disposal, and render failure containment.
- Client bundle build and `dsh.client` discovery.
- Real Harness profile composition.
- Browser acceptance in light, dark, reduced-motion, reasoning, tool, file-generation, and pending-interaction states.
