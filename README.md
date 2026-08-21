# PAIMind Harness Plugins

Out-of-tree PAIMind product plugins for DeepSeek Harness. DeepSeek Harness remains the only runtime; this repository supplies an installable bundle, version-isolated compatibility interfaces, domain contracts, product plugins, and acceptance evidence.

The durable program scope and autonomous gate policy are defined in [`docs/plans/GOAL-A-plugin-migration.md`](docs/plans/GOAL-A-plugin-migration.md). Goal A covers F0, FP01-FP16, final cross-plugin E2E, and prototype runtime retirement; it does not stop after the current feature package or wait for per-package human approval.

## Development

```bash
pnpm install
pnpm run check
```

The active compatibility matrix is exact npm `@deepseek-ai/dsh@0.1.0-rc.8`, `dsh-better-sidebar@0.14.0` and its external Office viewer `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0`. External provider upgrades are isolated and verified before the bundle pin moves; the suite never follows `latest` or an unverified branch.

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
