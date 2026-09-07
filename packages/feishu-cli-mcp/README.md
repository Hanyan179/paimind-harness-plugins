# @paimind/feishu-cli-mcp

[Plugin authoring standard](../../docs/standards/plugin-authoring.md)

## Responsibility

Translate four structured document operations into profile-pinned local CLI argument arrays. Credentials stay in the CLI.

## Public entry points

Root optional headless host plugin plus schemas, argument builder and runner; /invariant; /server standard MCP stdio server.

## Dependencies

Official MCP SDK 1.30.0 already selected by native MCP; zod. The optional Center peer is used only for the template type contract; standalone server execution imports no Center runtime. Requires an independently installed and authorized lark-cli.

## Lifecycle and failure

Every invocation fixes --profile; document operations also fix --as user (auth status does not accept --as). Writes send content on stdin, handle cancellation and bound output. Unknown writes are reported and never retried. The host plugin contributes only a source-owned connection template; unload removes that template and leaves saved connection configuration intact. Server unload closes transport; CLI authorization is retained.

## Published files

Compiled JavaScript, source maps and TypeScript declarations under `lib/`; package manifest and this README. No local configuration, credentials, test documents or screenshots.

## Verification

Run repository typecheck, focused tests, build and package gates. See [implementation scope](../../docs/plans/mcp-center-feishu.md) and the [connection-center acceptance report](../../docs/acceptance/mcp-center-feishu-2026-09-07.md) for native/browser evidence. Multi-user isolation is not claimed.
