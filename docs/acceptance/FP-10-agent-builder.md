# FP10 智能体构建器验收

## 当前状态

`Retired as an independent UI`。能力已经并入 [`FP-09-agent-center.md`](FP-09-agent-center.md)。

## 保留边界

- `@paimind/agent-builder` 仍作为 Headless Workflow Service（无界面工作流服务）加载。
- Package manifest 不得包含 `dsh.client` 或浏览器构建入口。
- 它只负责个人智能体业务配置、版本绑定、迁移摘要和验收记录。
- Preset 创建、删除、发现、选择和会话执行继续调用 Harness 原生能力。
- Harness 原生 Agent Presets 页面继续作为高级配置入口。

验收以“智能体中心只有一个业务入口”和真实会话结果为准，不再验收 Creator handoff、独立双栏页面、回执哈希或 Host 路径展示。

