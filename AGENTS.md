# PAIMind Harness Plugins

## Purpose

本项目是 PAIMind 面向 DeepSeek Harness 的独立 Plugin Suite（插件套件）。一个项目包含现有与未来的全部 PAIMind 产品能力，以及配套的 Adapter、SDK、公共契约、文档和验收证据；不以某一个功能或定时任务为项目边界。

## Goal

在不修改 Harness 主体源码的前提下，将 PAIMind 能力建设为可安装、可卸载、可升级、可测试和可交付的 Harness 插件。

## References

- DeepSeek Harness：上游 Runtime（运行时）与兼容性参考，不是 PAIMind 代码仓库。
- `../paimind-agent-skill-prototype`：冻结的产品与视觉参考，不是生产代码来源。
- `docs/architecture/`、`docs/plans/`、`docs/migration/` 与 `docs/acceptance/`：架构、需求、功能清单和验收事实来源。

## Boundaries

- 只在本仓库开发 PAIMind 插件，不修改、复制或内嵌 DeepSeek Harness 源码。
- Harness 版本相关逻辑统一放在 `@paimind/harness-compat`。
- 平台 Core、业务 Adapter 与 Harness Runtime 保持分层；业务逻辑和业务页面不进入通用平台核心。
- 不导入原型 Mock Data、浏览器本地状态或业务系统内部页面。
- 用户可见能力必须完成定向测试、真实 Harness 组合和浏览器预验收，并保留验收证据。
- 不提交凭证、本地 Harness Home、生成的构建产物或浏览器截图。
