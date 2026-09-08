# @hansen/context-library

[Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

资料库唯一拥有资料夹文件、说明、连接与访问授权。公开的连接、会话解析、文件访问契约位于 `./contract`；宿主服务为 `paimindContextLibrary`，模型入口为 `paimind_context`。身份、授权、存储实现可以通过 `ContextLibraryOptions` 替换。

## Public entry points

Host service, browser-safe contract, strict remote descriptors, client and invariant.

## Dependencies

宿主兼容包提供可信身份、权限、文件操作与工具适配；共享界面和侧栏适配器提供产品入口。资料库不依赖智能体中心或工作区编辑器的内部状态。

## Lifecycle and failure

Unload removes registrations and subscriptions, never user files. Invalid identity, stale versions and unsafe paths fail closed.

## Published files

Built runtime exports and required bundled resources only. Tests and user data are excluded.

## Verification

Focused tests, typecheck, package gates, real Harness composition and browser acceptance.

## Product contract

[产品流程与范围](../../docs/product/context-library-workspaces.md) · [集成契约](../../docs/integration/context-library-workspace-editors-contract.md) · [验收证据](../../docs/acceptance/context-library-workspaces.md)。源码来源见 `PROVENANCE.json`；编辑器包中的第三方源码另附 `LICENSE` 和 `NOTICE`。
