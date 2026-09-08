# @hansen/workspace-editors

[Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

文档、幻灯片和表格共用本地内容服务 `paimindWorkspaceEditors`，模型通过 `paimind_workspace_document` 访问。工作区文件是唯一权威内容；浏览器草稿、导出文件和操作回执不建立第二份编辑源。

## Public entry points

Host service, browser-safe contract, strict remote descriptors, client and invariant.

## Dependencies

Native compatibility and shared UI; workspace editors consume the existing sidebar adapter.

## Lifecycle and failure

Unload removes registrations and subscriptions, never user files. Invalid identity, stale versions and unsafe paths fail closed.

## Published files

Built runtime exports and required bundled resources only. Tests and user data are excluded.

## Verification

Focused tests, typecheck, package gates, real Harness composition and browser acceptance.

## Product contract

[产品流程与范围](../../docs/product/context-library-workspaces.md) · [集成契约](../../docs/integration/context-library-workspace-editors-contract.md) · [验收证据](../../docs/acceptance/context-library-workspaces.md)。源码来源见 `PROVENANCE.json`；编辑器包中的第三方源码另附 `LICENSE` 和 `NOTICE`。
