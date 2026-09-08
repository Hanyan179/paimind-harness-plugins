# PAIMind Harness Plugins

## Purpose

本项目是 PAIMind 面向 DeepSeek Harness 的独立 Plugin Suite（插件套件）。一个项目包含现有与未来的全部 PAIMind 产品能力，以及配套的 Adapter、SDK、公共契约、文档和验收证据；不以某一个功能或定时任务为项目边界。

## Canonical local baseline

- 唯一本地开发与运行基线为 `main`，固定目录为 `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins`。
- 本地 `3080` 服务只加载此目录的插件；历史工作副本用于恢复和参考，不作为日常启动入口。新变更须从此分支派生并合回。
- 保留现有 `.dsh-home` 中的会话、工作区与用户配置；包路径更新不迁移或重建业务数据。

## Goal

在不修改 Harness 主体源码的前提下，将 PAIMind 能力建设为可安装、可卸载、可升级、可测试和可交付的 Harness 插件。

## References

- DeepSeek Harness：上游 Runtime（运行时）与兼容性参考，不是 PAIMind 代码仓库。
- `../paimind-agent-skill-prototype`：冻结的产品与视觉参考，不是生产代码来源。
- `docs/architecture/`、`docs/plans/`、`docs/migration/` 与 `docs/acceptance/`：架构、需求、功能清单和验收事实来源。

## Boundaries

- 只在本仓库开发 PAIMind 插件，不修改、复制或内嵌 DeepSeek Harness 源码。
- Harness 版本相关逻辑统一放在 `@hansen/harness-compat`。
- 平台 Core、业务 Adapter 与 Harness Runtime 保持分层；业务逻辑和业务页面不进入通用平台核心。
- 不导入原型 Mock Data、浏览器本地状态或业务系统内部页面。
- 用户可见能力必须完成定向测试、真实 Harness 组合和浏览器预验收，并保留验收证据。
- 不提交凭证、本地 Harness Home、生成的构建产物或浏览器截图。

## Product development model

- 本仓库是 PAIMind Product Line（产品线）的长期开发基线；新能力、既有能力优化、Adapter（适配器）与组合验收都在这里完成。Enterprise Line（企业线）只有在用户明确恢复时才进入当前交付范围。
- 新需求先判断是新增 Plugin（插件）、扩展既有 Plugin，还是只需修改共享 Adapter；不因页面相近就把不同 Domain（领域）的业务状态合并到一个包。
- 每个用户入口、可写状态、Runtime Service（运行时服务）与持久化 Namespace（命名空间）必须有唯一 Owner（所有者）。跨包复用通过 Contract（契约）和 Service（服务）完成，不直接读写其他包的内部状态。
- Harness 没有公开的稳定能力必须通过 `@hansen/harness-compat` 隔离；不允许多个功能包各自实现同一组 Harness DOM（页面结构）或版本兼容逻辑。
- 新能力进入开发前按 [`docs/plans/plugin-product-roadmap.md`](docs/plans/plugin-product-roadmap.md) 完成 Ownership（所有权）与 Conflict Review（冲突评审），完成后再进入真实 Harness 组合和浏览器验收。

## Agent, Skill and Workspace boundaries

以下是跨功能修改也必须保留的边界。相关领域细则按下方入口读取；不得把开发指令整体复制进 Harness System Prompt（系统提示词）、Agent Persona（智能体人设）或用户工作区上下文。

- 新建 Agent（智能体）使用 Harness `standard` Preset（预设）；宿主模式属于内部实现。普通对话与专用创建入口复用同一份创建技能，只由结构化工具结果打开未保存草稿，不按关键词路由、不自动保存。
- Harness（宿主）唯一拥有 Workspace（工作区）、Preset（预设）、Session（会话）、Skill Registry（技能注册表）与 Tool Execution（工具执行）。技能中心和智能体中心各自拥有业务仓库、用户策略及选择关系的产品投影，不增加影子注册表、第二套运行时或调用接口。
- System Skill（系统级技能）的摘要、正文、必需工具与生命周期由同一来源插件在同一作用域负责，启停保持原子性。Business Skill（业务级技能）保存在受管仓库，先通过用户可用门禁，再按明确选择进入作用域；同名冲突失败关闭，不写入全局技能根目录或人设。
- 技能目录只加载可发现摘要，正文按需读取；能力工作流由权威 `SKILL.md` 唯一维护，不重复注入全局提示词、人设或创建流程。专用会话的工具安全限制不得泄漏到普通会话。
- Workspace Blueprint（工作区蓝图）以文件夹为主体，引用明确选择的智能体与业务技能，不复制实体或修改默认用户策略；空绑定模板合法，模板脚本只复制、不自动执行。

## Task-specific references

只在任务触及对应领域时读取，不要求每次编辑遍历全部文档。

| 变更领域 | 必读的相关契约 |
| --- | --- |
| 智能体创建、绑定，技能分类、目录、范围、启停或相关验收 | [智能体与技能集成契约](docs/integration/agent-skill-harness-contract.md) |
| 工作区模板目录、编排、上传、物化、采用或工作区技能范围 | [工作区蓝图集成契约](docs/integration/workspace-blueprint-harness-contract.md) |

## Governance sources

- [`docs/standards/plugin-authoring.md`](docs/standards/plugin-authoring.md) 是本仓库唯一的插件编写规范，定义 Package Role、Manifest、入口、依赖、发布内容、生命周期、失败与验证规则；其他文档只引用，不复制这些规则。
- [`docs/architecture/plugin-framework.md`](docs/architecture/plugin-framework.md) 只记录系统边界、所有权和架构决策，不承担逐包编写清单。
- [`docs/migration/ledger.md`](docs/migration/ledger.md) 只记录迁移状态、历史证据和验收结论，不作为当前编写规范或版本来源。
- [`docs/compatibility/matrix.md`](docs/compatibility/matrix.md) 是 Harness、Cordis、Better Sidebar、Office Viewer、Node.js 与 pnpm 组合的唯一版本来源。
- [`docs/standards/package-roles.json`](docs/standards/package-roles.json) 是 Package Identity、目录和角色的机器可读登记；数量只作为当前验收快照，长期门禁验证角色、消费者和依赖图可达性，不固定包数。
- [`docs/plans/plugin-product-roadmap.md`](docs/plans/plugin-product-roadmap.md) 记录 Product Line（产品线）基线、后续能力扩展顺序与跨插件冲突门禁；它不复制插件编写规范。
