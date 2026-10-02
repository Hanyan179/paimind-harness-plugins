# 开发、配置和验证入口

## 环境与安装

工具链范围只以 [兼容矩阵](../compatibility/matrix.md) 和 [根 package.json](../../package.json) 为当前依据，避免复制成第二套版本策略。根 manifest 固定包管理器，外部 provider 由 bundle 依赖与矩阵共同约束。

具备仓库/依赖读取权限且已审查安装脚本和包构建策略后，在独立工作副本执行：

```bash
git clone https://github.com/Hanyan179/paimind-harness-plugins.git
cd paimind-harness-plugins
pnpm --version
pnpm install --frozen-lockfile
pnpm run check
```

先确保当前 Node/pnpm 满足矩阵；不使用未核验的 latest，不为绕过安装失败而禁用 `pnpm-workspace.yaml` 的最低发布时间或构建许可策略。不要在承载真实会话/任务的 Harness Home 中试验安装和迁移。

## 命令实际做什么

| 命令 | 当前含义 |
| --- | --- |
| `pnpm run build` | 执行本仓构建脚本 |
| `pnpm run typecheck` | TypeScript project build 检查 |
| `pnpm run test` | Vitest 单次运行 |
| `pnpm run test:watch` | Vitest 监听 |
| `pnpm run check` | 映射到 check:fast，串联包规范、类型、测试、构建、包/Bundle/API、publint、NodeNext、示例、框架、来源与文档检查 |
| `pnpm run check:release` | 上述检查后执行真实 Harness composition 验证 |
| `pnpm run check:docs` | 本仓 Markdown 相对链接等文档检查 |
| `pnpm run migrate:scheduler-v2` | 调度存储迁移工具，具体 Dry Run/Apply 规则见既有运行手册 |

这些命令会执行项目代码并可能创建构建/测试产物；不属于本轮静态核对。没有单独的根 `dev` 或 `start` 脚本可直接启动整个产品。不要编造 `pnpm dev`、独立第二运行时或已完成安装的结果。

## Harness 组合

[Bundle README](../../packages/harness-bundle/README.md)、[bundle manifest](../../packages/harness-bundle/package.json) 和 [Cordis patch](../../packages/harness-bundle/cordis.patch.yml) 分别说明职责、依赖和加载顺序。功能包保持独立，主 Bundle 在 Harness Web bundle 后应用；保持既有 Owner、生命周期和卸载边界。

现有 [组合验证脚本](../../scripts/verify-harness-composition.mjs) 接受以下源码中定义的参数：

- `--harness`：上游检出路径；或 `--runtime` 与 `--dsh-bin` 指向已安装运行时
- `--provider`：被选中的 Better Sidebar 路径
- `--office-provider`：相关 Office provider 路径
- 可选预期版本与上游检出参数，详见脚本使用说明和矩阵

该脚本会寻找本地运行时依赖，并创建临时 `DSH_HOME`，执行安装、启动、卸载/恢复等子进程，最后删除临时 Home。不能把 `check:release` 当作不联网、不写盘的检查，也不要替换为已有生产 Home。全新机器需要先具备匹配的 Harness 和 provider 环境；仅克隆本仓不足以保证此门禁可直接运行。

当前没有一份经本轮验证的、面向任意新机器的通用宿主部署流程。遇到依赖、权限或 provider 版本问题，应先记录阻塞而非改动版本针脚或复制运行时源码。

## 配置分层

- 品牌设置通过产品的 Settings → Branding 入口，见 [branding](../../packages/branding/README.md)
- 产品配置/存储由对应插件和 Harness 域负责，不能直接读写其他包私有状态
- 平台调度、HTTP/飞书 Adapter 和反向代理配置见 [部署手册](../operations/platform-scheduler-deployment.md)
- 手册中的环境变量样例是结构占位，不是真实密钥；不要把服务凭据、Webhook、数据库或 `.dsh-home` 放入 Git
- 企业线的部署文档不能直接当作 main 产品线已经上线的证明

## 测试和验收记录

矩阵与 `docs/acceptance/` 记载的是对应日期、提交和环境的历史证据；本轮文档整理没有重跑它们。静态链接检查、单元测试、真实组合、浏览器验收与依赖/许可审查是不同阶段。

贡献记录需要给出确切 SHA、环境、命令、通过/失败/未运行结果，覆盖反复操作、失效会话、版本不匹配和失败恢复。不存在新的通过结果时，不添加成功徽章或声称所有功能已满足验收。
