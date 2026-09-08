# @hansen/mcp-center

[Plugin authoring standard](../../docs/standards/plugin-authoring.md)

## Responsibility

Own personal connection configuration, owner references, management UI and native Agent scope reconciliation. Never execute tools through management RPC.

## Public entry points

Root runtime service; /contract schemas; /remote and /typert management descriptors; /invariant; /client UI.

The read-only `summarizeSession` contract supplies owner-scoped connection names, deterministic native namespaces and live mount state for optional consumers such as Task Monitor. It neither connects nor probes services, exposes executable configuration or credentials, invokes tools, nor persists another registry.

## Dependencies

Harness native MCP through harness-compat. No vendor adapter dependency. Optional source plugins contribute validated stdio or HTTP configuration templates through the local registerTemplate contract, returning a lifecycle disposer; template registration is not a Remote method. Agent profiles supply references through a structural public service.

## Lifecycle and failure

Disable blocks new calls synchronously, disposes native tools and transport, and preserves Agent configuration. Restore probes again. Unload releases guards, listeners, processes and tools. Configuration remains in a private local repository; discovery and operation evidence are transient.

## Published files

Compiled JavaScript, source maps and TypeScript declarations under `lib/`; package manifest and this README. No local configuration, credentials, test documents or screenshots.

## Verification

Run repository typecheck, focused tests, build and package gates. See [implementation scope](../../docs/plans/mcp-center-feishu.md) and the [connection-center acceptance report](../../docs/acceptance/mcp-center-feishu-2026-09-07.md) for native/browser evidence. Multi-user isolation is not claimed.
