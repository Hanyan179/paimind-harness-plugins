# Hansen Harness Plugins

面向 DeepSeek Harness 的独立插件工作区，使用 `@hansen/*` 包命名空间。Harness 是唯一运行时；本仓提供组合 Bundle、兼容层、契约、产品插件及验收资料。本轮没有核实 npm registry 的发布状态，不把包名或历史打包记录当成已经对外发布的证明。

> **许可边界：** 当前仓库可公开访问，但没有统一的根 LICENSE；部分包明确为 `UNLICENSED`，技能和参考代码中还存在限制外发的声明。可见性不等于整仓开源或再分发授权。请先阅读 [第三方与许可范围](THIRD_PARTY_NOTICES.md)，不要擅自更改或忽略现有条款。

## 从哪里开始

1. 阅读 [开发与验证入口](docs/guides/repository-development.md)：环境、依赖、检查、真实 Harness 组合及配置边界
2. 阅读 [组件和分支地图](docs/guides/repository-map.md)：产品主线、暂停的企业线、包职责与当前规范入口
3. 修改插件前遵循现有 [插件编写规范](docs/standards/plugin-authoring.md)，版本以 [兼容矩阵](docs/compatibility/matrix.md) 为准
4. 提交前阅读 [贡献指南](CONTRIBUTING.md)、[协作约定](CODE_OF_CONDUCT.md) 和 [安全说明](SECURITY.md)

源码核对基线：`b55e45211bba92a981c3ee93e768f83c5b1a5c9c`。本次仅更新文档，没有安装依赖、运行检查、启动 Harness、接入企业系统或变更部署；历史验收保留其原有日期与范围。

Configure the product name, logos, browser icon and welcome messages in **Settings → Branding** (设置 → 品牌设置). Defaults use Hansen and name initials; no company logo is required. See [brand configuration](packages/branding/README.md) and the [namespace migration boundary](docs/plans/hansen-branding-migration.md).

The durable program scope and autonomous gate policy are defined in [`docs/plans/GOAL-A-plugin-migration.md`](docs/plans/GOAL-A-plugin-migration.md). Goal A covers F0, FP01-FP16, final cross-plugin E2E, and prototype runtime retirement; it does not stop after the current feature package or wait for per-package human approval.

## Product baseline and development

`main` is the single active product line. Enterprise work remains paused and isolated.
See the [product roadmap](docs/plans/plugin-product-roadmap.md) for integration scope.

```bash
pnpm install
pnpm run check
```

The active compatibility matrix is exact npm `@deepseek-ai/dsh@0.1.1-rc.2`, `dsh-better-sidebar@0.17.1` and its external Office viewer `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.2`. External provider upgrades are isolated and verified before the bundle pin moves; the suite never follows `latest` or an unverified branch.

The frozen PAIMind prototype is a specification and visual reference only. Its synthetic repositories and browser-local state are not production data sources.

## Platform capabilities

- [RQ-103 Platform Scheduler PRD](docs/product/RQ-103-platform-scheduler-prd.md)
- [RQ-104 Platform Notification PRD](docs/product/RQ-104-platform-notification-prd.md)
- [Architecture](docs/architecture/platform-scheduler.md)
- [Integration Contract](docs/integration/platform-contract.md)
- [Backend Standard](docs/standards/platform-scheduler-backend-standard.md)
- [SDK Guide](docs/guides/platform-sdk.md), [Adapter Guide](docs/guides/scheduler-adapters.md), and [Feishu Bot E2E Guide](docs/guides/feishu-bot-scheduler-e2e.md)
- [Deployment Runbook](docs/operations/platform-scheduler-deployment.md)
- [Acceptance specification](docs/acceptance/RQ-103-platform-scheduler.md) and [local pre-acceptance report](docs/acceptance/RQ-103-final-acceptance.md)

## 发布准备

现有受限材料授权、品牌/素材权利、私密报告渠道、历史隐私审查和实际运行验证仍需分别处理，详见 [发布核对清单](docs/guides/release-readiness.md)。本次未更改许可证、包许可字段、源码、真实配置、历史引用或仓库可见性。
