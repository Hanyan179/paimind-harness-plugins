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

## Product development model

- 本仓库是 PAIMind Product Line（产品线）的长期开发基线；新能力、既有能力优化、Adapter（适配器）与组合验收都在这里完成。Enterprise Line（企业线）只有在用户明确恢复时才进入当前交付范围。
- 新需求先判断是新增 Plugin（插件）、扩展既有 Plugin，还是只需修改共享 Adapter；不因页面相近就把不同 Domain（领域）的业务状态合并到一个包。
- 每个用户入口、可写状态、Runtime Service（运行时服务）与持久化 Namespace（命名空间）必须有唯一 Owner（所有者）。跨包复用通过 Contract（契约）和 Service（服务）完成，不直接读写其他包的内部状态。
- Harness 没有公开的稳定能力必须通过 `@paimind/harness-compat` 隔离；不允许多个功能包各自实现同一组 Harness DOM（页面结构）或版本兼容逻辑。
- 新能力进入开发前按 [`docs/plans/plugin-product-roadmap.md`](docs/plans/plugin-product-roadmap.md) 完成 Ownership（所有权）与 Conflict Review（冲突评审），完成后再进入真实 Harness 组合和浏览器验收。

## Agent and Skill runtime model

本节是本仓库的长期开发约束，只指导 Codex 和开发者如何实现能力；不得把整份 `AGENTS.md` 复制进 Harness System Prompt（系统提示词）、Agent Persona（智能体人设）或用户工作区上下文。

### Standard foundation

- PAIMind 新建 Agent（智能体）统一基于 Harness `standard` Preset（预设）组合；`minimal`、`standard`、`ptc`、`code`、`cordis` 等 Harness Mode（宿主模式）属于内部实现，不进入普通用户的 Agent 创建、编辑或选择界面。
- 新的通用能力优先扩展这个 Standard Foundation（标准底座），不得通过新增用户可选 Mode（模式）、复制一套 Agent Runtime（智能体运行时）或向所有 Agent Persona（智能体人设）重复追加 Prompt（提示词）实现。

### System Skill and Business Skill isolation

| Dimension（维度） | System Skill（系统级技能） | Business Skill（业务级技能） |
| --- | --- | --- |
| Definition（定义） | 平台源码或已启用系统插件提供、可复用于 Standard Foundation（标准底座）的通用能力说明与工作流 | 用户、业务团队或平台市场安装并维护的领域方法、规范与交付知识 |
| Current examples（当前示例） | `genui`、`paimind-agent-authoring`、`paimind-skill-installation` | Skill Center（技能中心）上传、目录安装或从 GitHub 安装的 Skill（技能） |
| Owner（所有者） | Harness 或提供该能力的源码 Plugin（插件） | `@paimind/skill-market` 的 Business Skill Repository（业务技能仓库） |
| Registration（注册） | 通过 Harness 原生 Skill Registry（技能注册表）/`ctx.skills` 注册；不得再写入 Skill Center | 安装到 `$DSH_HOME/.paimind-skill-market/skills`；不得注册到全局 Harness Skill Root（宿主技能根目录） |
| Agent scope（智能体作用域） | 按 Harness Policy（宿主策略）对 Standard Session（标准会话）可发现，不由用户逐个挂载 | 由 Agent Center（智能体中心）选择，且只链接到目标 Agent 的 `.paimind-skills` |
| Runtime loading（运行时加载） | Skill Catalog（技能目录）先提供摘要，模型按需加载完整 `SKILL.md` | 只有当前 Agent 已选择的技能进入其目录摘要，并按需加载完整 `SKILL.md` |

- Skill（技能）负责描述场景、方法和 Tool Usage（工具使用方式）；Tool（工具）负责 Schema（结构定义）、权限校验和实际副作用。不得把 Tool（工具）计为 Skill（技能），也不得用 Skill 文本替代 Tool 的执行边界。
- 一个 System Skill（系统级技能）的目录摘要、完整正文、必需 Tool（工具）和 Lifecycle（生命周期）必须由同一个 Source Plugin（来源插件）在同一 Runtime Scope（运行时作用域）共同负责；不得发布“全局可发现但只在个别 Agent 可执行”或“Skill 已卸载但 Tool 仍存在”的半套能力。
- System Prompt（系统提示词）只承载平台身份、安全规则和运行时不变量。通用能力的场景说明写进对应 System Skill（系统级技能），业务方法写进 Business Skill（业务级技能）；不得把两类内容长期堆入全局 Prompt（提示词）。专用 Session（会话）可以增加 Tool Allowlist（工具允许列表）和不可信输入隔离等安全约束，但能力工作流必须复用同一份 Canonical `SKILL.md`（权威技能说明），不得维护第二份独立流程 Prompt（提示词）。
- Skill Catalog（技能目录）只注入可发现摘要，不一次性注入全部完整内容；完整 `SKILL.md` 由模型按场景渐进加载。禁止把同一 Skill（技能）同时通过 System Prompt、全局目录和 Agent Persona 重复注入。
- Agent Persona（智能体人设）只描述角色、目标和行为，不保存、不列举已选择的 Business Skill（业务技能）名称或正文；选择关系只由 Agent Center（智能体中心）和目标 Agent 的 `.paimind-skills` 表达。
- 不为 Create Agent（创建智能体）、Install Skill（安装技能）等场景增加关键词意图路由。模型根据 Skill Catalog（技能目录）的描述加载对应 System Skill（系统级技能），再调用其 Tool（工具）；界面状态只由结构化 Tool Result（工具结果）驱动，不根据用户原文猜测。
- `paimind-skill-installation` 是 System Skill（系统级技能），但它安装出的对象始终是 Business Skill（业务级技能）：普通对话默认只安装到 Skill Center（技能中心）；创建 Agent（智能体）时可加入未保存草稿；给既有 Agent 挂载前必须获得用户明确确认。
- Business Skill（业务技能）不得与当前可见的任何 System Skill（系统级技能）同名。安装、绑定和保存三个入口都必须执行 Collision Check（名称冲突检查）并 Fail Closed（失败关闭），不得利用 Harness 的就近 Scope（作用域）覆盖系统能力。
- Agent Center（智能体中心）只拥有 Persona（人设）、Business Skill Selection（业务技能选择）和 Harness Preset/Session（宿主预设/会话）的产品投影；Harness 继续唯一拥有 Preset（预设）、Session（会话）、Skill Registry（技能注册表）与 Tool Execution（工具执行）。不得增加 Shadow Registry（影子注册表）、重复 Runtime（运行时）或额外 Invocation RPC（调用接口）。

### Change and acceptance gate

- 新增 Skill（技能）前必须先完成 Classification（分类）：只有源码开发、平台级复用且明确由系统 Plugin（插件）拥有的能力才是 System Skill（系统级技能）；用户上传、GitHub 拉取、市场安装和业务团队维护的内容默认都是 Business Skill（业务级技能）。
- System Skill（系统级技能）变更必须验证原生注册、恰好一条目录摘要、按需加载同一份完整正文、必需 Tool（工具）同 Scope 可调用和普通 Standard Session（标准会话）；Business Skill（业务级技能）变更必须验证安装仓库隔离、全局目录缺席、名称冲突拒绝、按 Agent 选择性挂载和跨 Agent 不泄漏。
- 两类 Skill（技能）共同启用时必须增加 Negative Assertion（反向断言）：同名安装或绑定必须被拒绝，未选择的 Business Skill（业务技能）不得进入当前 Session（会话），Persona（人设）不得重复列出 Skill（技能），禁用提供方 Plugin（插件）后对应 Skill 摘要、完整正文、Tool（工具）、Prompt Section（提示词段）和客户端能力必须共同消失。
- Create Agent（创建智能体）验收必须同时覆盖普通对话和专用创建会话：两条入口都加载同一份 Authoring Skill（创建技能），只由结构化 Tool Result（工具结果）打开未保存草稿；不得存在关键词路由、第二份独立工作流 Prompt（提示词）或自动保存。

## Governance sources

- [`docs/standards/plugin-authoring.md`](docs/standards/plugin-authoring.md) 是本仓库唯一的插件编写规范，定义 Package Role、Manifest、入口、依赖、发布内容、生命周期、失败与验证规则；其他文档只引用，不复制这些规则。
- [`docs/architecture/plugin-framework.md`](docs/architecture/plugin-framework.md) 只记录系统边界、所有权和架构决策，不承担逐包编写清单。
- [`docs/migration/ledger.md`](docs/migration/ledger.md) 只记录迁移状态、历史证据和验收结论，不作为当前编写规范或版本来源。
- [`docs/compatibility/matrix.md`](docs/compatibility/matrix.md) 是 Harness、Cordis、Better Sidebar、Office Viewer、Node.js 与 pnpm 组合的唯一版本来源。
- [`docs/standards/package-roles.json`](docs/standards/package-roles.json) 是 Package Identity、目录和角色的机器可读登记；数量只作为当前验收快照，长期门禁验证角色、消费者和依赖图可达性，不固定包数。
- [`docs/plans/plugin-product-roadmap.md`](docs/plans/plugin-product-roadmap.md) 记录 Product Line（产品线）基线、后续能力扩展顺序与跨插件冲突门禁；它不复制插件编写规范。
