# 组件与分支地图

## 权威入口

- [插件编写规范](../standards/plugin-authoring.md)：包角色、入口、依赖、生命周期及验证规则
- [包角色登记](../standards/package-roles.json)：当前包名称、目录和角色
- [框架架构](../architecture/plugin-framework.md)：系统边界和所有权
- [兼容矩阵](../compatibility/matrix.md)：唯一选定的运行时、provider 与工具链组合
- [产品路线图](../plans/plugin-product-roadmap.md)：产品主线与跨插件冲突评审
- [迁移记录](../migration/ledger.md)：历史状态和证据，不作为第二套开发规范

本地图只提供导航，不复制或重新定义上述契约。

## 组件分组

| 目录入口 | 职责 |
| --- | --- |
| `packages/harness-bundle` | 依赖选择与有序组合 |
| `packages/harness-compat` | Harness 版本差异隔离 |
| `packages/contracts`、`ui-foundation`、`testkit` | 契约、共享界面基础和测试支持 |
| `agent-market`、`agent-builder`、`skill-market` | 智能体/技能产品层，宿主仍拥有原生运行时实体 |
| `workspace-project`、`workspace-blueprints`、`context-library`、`workspace-editors` | 工作区与资料/编辑能力 |
| `scheduler`、`scheduler-adapter-*`、`notifications`、`platform-api`、`platform-sdk` | 调度、通知、平台 API 与 Adapter |
| `generator-*`、`renderer-*`、`artifact-runtime`、`presentation-*` | 交付物生成、呈现和追踪 |
| `examples/`、`resources/` | 示例/导入资源，各有来源和授权边界 |
| `scripts/` | 构建、检查、组合验证与迁移工具 |

目录名不一定等于 npm 包名，例如 `packages/scheduler` 对应的平台 Scheduler 应以 manifest 为准。具体包职责读取包内 README，不按相似页面合并领域状态。

## 分支

2026-10-02 核对时存在以下业务/历史分支：

| 分支 | 阅读边界 |
| --- | --- |
| `main` | 当前产品主线，本轮文档基线 |
| `agent/unified-plugin-suite` | 历史插件套件工作线，不据此替代当前 main |
| `codex/product-latest-20260901` | 产品线历史检查点 |
| `codex/cloud-handoff-product-20260930` | 产品交接检查点，实际差异需比较对应 SHA |
| `codex/cloud-handoff-enterprise-20260930` | 企业交接线，企业工作仍按现有主线说明暂停隔离 |

本轮只在独立文档分支更新导航，未合并或改写这些分支。分支存在不证明内容已经发布、通过所有测试或具备统一外发许可。

## 与原型的关系

PAIMind prototype 是冻结的产品/视觉参考，其模拟数据和浏览器本地状态不能直接成为生产数据源。Harness 是运行时来源；本仓不因此取得复制其主体源码、企业页面、业务资料或第三方技能的统一权利。
