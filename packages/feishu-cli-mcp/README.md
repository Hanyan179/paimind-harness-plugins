# @hansen/feishu-cli-mcp

[Plugin authoring standard](../../docs/standards/plugin-authoring.md)

## Responsibility

Translate structured document operations and optional scoped Base exports into profile-pinned local CLI argument arrays. Credentials stay in the CLI. Business selection, catalog rendering, schedules and Context Library publication belong to callers.

## Public entry points

Root optional headless host plugin plus schemas, argument builder and runner; /invariant; /server standard MCP stdio server.

## Dependencies

Official MCP SDK 1.30.0 already selected by native MCP; zod; `@hansen/harness-compat/managed-files` for confined atomic local file operations. The optional Center peer is used only for the template type contract; standalone server execution imports no Center runtime. Requires an independently installed and authorized lark-cli.

## Lifecycle and failure

Every invocation fixes --profile; document operations also fix --as user (auth status does not accept --as). Writes send content on stdin, handle cancellation and bound output. Unknown writes are reported and never retried. The host plugin contributes only a source-owned connection template; unload removes that template and leaves saved connection configuration intact. Server unload closes transport; CLI authorization is retained.

Default servers retain their four existing document tools. `--read-only` removes document creation/update. An explicit `--export-root`, `--base-token` and comma-separated `--table-ids` adds `feishu_export_base_records` and `feishu_download_base_attachments`. Exports paginate complete projected snapshots, reject revision drift and never overwrite a different snapshot. Attachment batches validate source scope and relative paths, reject symlinks, bound CLI concurrency, and reuse cache only after verifying file bytes and source identity. Remote Base operations are read-only; local export writes are correctly marked as side effects. This is application-level confinement, not OS isolation.

## Published files

Compiled JavaScript, source maps and TypeScript declarations under `lib/`; package manifest and this README. No local configuration, credentials, test documents or screenshots.

## Verification

Run repository typecheck, focused tests, build and package gates. See [implementation scope](../../docs/plans/mcp-center-feishu.md) and the [connection-center acceptance report](../../docs/acceptance/mcp-center-feishu-2026-09-07.md) for native/browser evidence. Multi-user isolation is not claimed.
