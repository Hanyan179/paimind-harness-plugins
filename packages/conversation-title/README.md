# @paimind/conversation-title

## Responsibility

Owns PAIMind conversation auto-naming, its model-service setting, and the exact first-message title prompt. Harness remains the owner of Sessions, title events, model adapters, and persistence.

## Public entry points

- `@paimind/conversation-title`: Host plugin and product policy.
- `@paimind/conversation-title/settings`: durable setting contract.
- `@paimind/conversation-title/client`: Models Service settings page.
- `@paimind/conversation-title/invariant`: runtime invariant registration.

## Dependencies

Uses `@paimind/harness-compat` for every Harness-version-sensitive Session, title, LLM, Settings, and client surface.

## Lifecycle and failure

The Host listener is mounted with the Product Experience pack. Unload aborts active title calls and removes all listeners and client styles. Failure preserves the deterministic temporary title and never interrupts the conversation.

## Published files

Only built runtime JavaScript, declarations, source maps, and package metadata are published.

## Verification

Run package type checking, focused tests, the repository fast gate, and real Harness browser acceptance. See [the plugin authoring standard](../../docs/standards/plugin-authoring.md).
