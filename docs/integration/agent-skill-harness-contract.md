# 智能体与技能的宿主集成契约

本文件是 Agent（智能体）、Skill（技能）与 Harness（宿主）运行时边界及验收的权威开发说明。修改这些领域时读取；普通文案与无关插件修改不需要预读。插件通用编写规则仍由 [插件编写规范](../standards/plugin-authoring.md) 唯一维护。

这些约束用于开发与验证，不应整体复制进 System Prompt（系统提示词）、Persona（人设）或用户工作区上下文。

## Standard foundation

- PAIMind 新建 Agent（智能体）统一基于 Harness `standard` Preset（预设）组合；`minimal`、`standard`、`ptc`、`code`、`cordis` 等 Harness Mode（宿主模式）属于内部实现，不进入普通用户的 Agent 创建、编辑或选择界面。
- 新的通用能力优先扩展这个 Standard Foundation（标准底座），不得通过新增用户可选 Mode（模式）、复制一套 Agent Runtime（智能体运行时）或向所有 Agent Persona（智能体人设）重复追加 Prompt（提示词）实现。

## System Skill and Business Skill isolation

| Dimension（维度） | System Skill（系统级技能） | Business Skill（业务级技能） |
| --- | --- | --- |
| Definition（定义） | 平台源码或已启用系统插件提供、可复用于 Standard Foundation（标准底座）的通用能力说明与工作流 | 用户、业务团队或平台市场安装并维护的领域方法、规范与交付知识 |
| Current examples（当前示例） | `genui`、`paimind-agent-authoring`、`paimind-skill-installation`、`paimind-skill-authoring` | Skill Center（技能中心）创建、上传、目录安装或从 GitHub 安装的 Skill（技能） |
| Owner（所有者） | Harness 或提供该能力的源码 Plugin（插件） | `@paimind/skill-market` 的 Business Skill Repository（业务技能仓库） |
| Registration（注册） | 通过 Harness 原生 Skill Registry（技能注册表）/`ctx.skills` 注册；不得再写入 Skill Center | 安装到 `$DSH_HOME/.paimind-skill-market/skills`；不得注册到全局 Harness Skill Root（宿主技能根目录） |
| Runtime scope（运行时作用域） | Mandatory（必需）能力始终属于 Standard Foundation；Optional（可选）能力由用户在 Skill Center 启用或停用，不由 Agent 单独挂载 | 安装后默认只进入 Skill Center；用户先控制可用状态，再选择普通对话默认范围、当前 Session 临时范围或目标 Agent 持久范围 |
| Runtime loading（运行时加载） | 用户启用的 System Skill 先提供摘要，模型按需加载完整 `SKILL.md` | 只有通过用户可用门禁且命中 Direct/Agent/Session 作用域的唯一并集进入目录摘要，并按需加载完整 `SKILL.md` |

- Skill（技能）负责描述场景、方法和 Tool Usage（工具使用方式）；Tool（工具）负责 Schema（结构定义）、权限校验和实际副作用。不得把 Tool（工具）计为 Skill（技能），也不得用 Skill 文本替代 Tool 的执行边界。
- 一个 System Skill（系统级技能）的目录摘要、完整正文、必需 Tool（工具）和 Lifecycle（生命周期）必须由同一个 Source Plugin（来源插件）在同一 Runtime Scope（运行时作用域）共同负责；不得发布“全局可发现但只在个别 Agent 可执行”或“Skill 已卸载但 Tool 仍存在”的半套能力。
- System Prompt（系统提示词）只承载平台身份、安全规则和运行时不变量。通用能力的场景说明写进对应 System Skill（系统级技能），业务方法写进 Business Skill（业务级技能）；不得把两类内容长期堆入全局 Prompt（提示词）。专用 Session（会话）可以增加 Tool Allowlist（工具允许列表）和不可信输入隔离等安全约束，但能力工作流必须复用同一份 Canonical `SKILL.md`（权威技能说明），不得维护第二份独立流程 Prompt（提示词）。
- Skill Catalog（技能目录）只注入可发现摘要，不一次性注入全部完整内容；完整 `SKILL.md` 由模型按场景渐进加载。禁止把同一 Skill（技能）同时通过 System Prompt、全局目录和 Agent Persona 重复注入。
- Skill Center（技能中心）唯一拥有 User Skill Policy（用户技能策略）：Optional System Skill 的启停、Business Skill 的可用状态和普通对话默认范围。用户级 `启用` 是 Eligibility Gate（可用性门禁），不是对全部 Session 的自动注入；Mandatory System Skill 和平台安全不变量不得伪装成可关闭能力。
- 只有 Source Plugin（来源插件）能在同一用户作用域原子启停 Skill 摘要、完整正文、必需 Tool（工具）、Prompt Section（提示词段）和客户端能力时，System Skill 才能声明为 Optional（可选）；否则必须作为 Mandatory（必需）能力锁定显示，不得提供只改目录摘要的虚假开关。
- 当前四项 Standard Foundation（标准底座）通用能力均由 Skill Center（技能中心）的 User Skill Policy（用户技能策略）作为 Optional（可选）能力控制，并且默认开启：`paimind-skill-installation` 与 `paimind-skill-authoring` 由 `@paimind/skill-market` 原子启停各自 Skill（技能）与私有 Tool（工具）；`paimind-agent-authoring` 通过 `@paimind/agent-builder` 的 Source-owned Actuator（来源插件执行器）原子启停 Authoring Skill（创作技能）与 `paimind_agent_prepare_create`，但 Agent Binding Tool（智能体绑定工具）和专用会话安全 Guard（守卫）保持常驻；`genui` 通过其独立 Harness Loader Entry（宿主加载器条目）整体启停。Host Runtime（宿主运行时）无需重启；涉及 GenUI Client Module Graph（客户端模块图）变化时，只重新加载浏览器应用壳。
- Agent Persona（智能体人设）只描述角色、目标和行为，不保存、不列举已选择的 Business Skill（业务技能）名称或正文；持久选择关系只由 Agent Center（智能体中心）的 Agent Profile Reference（智能体配置引用）表达，临时选择关系只由当前 Session（会话）的原生投影表达。不得再建立 `.paimind-skills` 文件扫描提供方。
- 不为 Create Agent（创建智能体）、Install Skill（安装技能）等场景增加关键词意图路由。模型根据 Skill Catalog（技能目录）的描述加载对应 System Skill（系统级技能），再调用其 Tool（工具）；界面状态只由结构化 Tool Result（工具结果）驱动，不根据用户原文猜测。
- `paimind-skill-installation` 是 System Skill（系统级技能），但它安装出的对象始终是 Business Skill（业务级技能）：普通对话默认只安装到 Skill Center（技能中心）；创建 Agent（智能体）时可加入未保存草稿；给既有 Agent 挂载前必须获得用户明确确认。
- Business Skill（业务技能）不得与当前可见的任何 System Skill（系统级技能）同名。安装、保存、Session 临时选择和 Agent 持久绑定全部入口都必须执行 Collision Check（名称冲突检查）并 Fail Closed（失败关闭），不得利用 Harness 的就近 Scope（作用域）覆盖系统能力。
- Skill Center（技能中心）拥有 Business Skill Repository（业务技能仓库）与 Current Session Selection（当前会话临时选择）的产品投影；Agent Center（智能体中心）拥有 Persona（人设）、Persistent Business Skill Selection（持久业务技能选择）和 Harness Preset/Session（宿主预设/会话）的产品投影。Harness 继续唯一拥有 Preset（预设）、Session（会话）、Skill Registry（技能注册表）与 Tool Execution（工具执行）。不得增加 Shadow Registry（影子注册表）、重复 Runtime（运行时）或额外 Invocation RPC（调用接口）。
- Skill Scope Resolver（技能作用域解析器）由 `@paimind/skill-market` 唯一提供无持久状态的 Runtime Service（运行时服务），通过公开 Contract（契约）读取 Harness System Provider、User Skill Policy、Agent 持久选择与 Session 临时选择，只输出 Skill Reference（技能引用）；`@paimind/harness-compat` 负责把解析结果投影进原生作用域注册表。不得保存第二份目录或直接读取其他包内部状态。
- 当前 Harness 尚未提供下游 Plugin（插件）可注册的持久化 Session Event Vocabulary（会话事件词表）；`Session.append()` 写入未知事件会导致 Persistence Restore（持久化恢复）拒绝该会话。因此 Session 临时选择只能保存在当前进程内的原生 Session/Agent Scope（会话/智能体作用域）并随目录提供方热更新，不得追加自定义未知 Session Event、写入 Persona、借用无关宿主事件或建立影子持久化。宿主未来提供安全注册契约后再迁移，迁移前产品必须明确它是 Runtime-ephemeral（运行时临时）状态。
- 不计工作区蓝图绑定时，普通 Session 的 Effective Skill Catalog 恒等于 `Mandatory System Skills ∪ User-enabled Optional System Skills ∪ User-default Business Skills ∪ Session-selected Business Skills`；Agent Session 则以 `Agent-selected Business Skills` 替换 `User-default Business Skills`，再叠加 Session 临时选择。所有 Business Skill 必须先通过用户可用门禁；三层引用按 Canonical Skill Identity（权威技能身份）去重，完整正文仍由同一个 Harness `skill` Tool 按需加载。蓝图工作区的引用按文末相关契约额外合并。
- Skill（技能）、Connector/MCP（连接器/模型上下文协议）和 Agent/Expert（智能体/专家）可以在同一个 Extension Discovery（扩展发现）入口中并列展示，但必须保持不同领域对象：Skill 是指令与资源包，Connector/MCP 提供外部数据与可执行 Tool，Agent/Expert 组合 Persona、Skill 与 Connector。不得把三者仅作为名称翻译后写入同一存储或注册表。

## Change and acceptance gate

- 新增 Skill（技能）前必须先完成 Classification（分类）：只有源码开发、平台级复用且明确由系统 Plugin（插件）拥有的能力才是 System Skill（系统级技能）；用户上传、GitHub 拉取、市场安装和业务团队维护的内容默认都是 Business Skill（业务级技能）。
- System Skill（系统级技能）变更必须验证原生注册、恰好一条目录摘要、按需加载同一份完整正文、必需 Tool（工具）同 Scope 可调用和普通 Standard Session（标准会话）；Business Skill（业务级技能）变更必须验证安装仓库隔离、全局目录缺席、名称冲突拒绝、按 Session 临时选择、按 Agent 持久选择以及跨 Session/Agent 不泄漏。
- 两类 Skill（技能）共同启用时必须增加 Negative Assertion（反向断言）：同名安装或绑定必须被拒绝，未选择的 Business Skill（业务技能）不得进入当前 Session（会话），Session 临时选择不得改写 Agent Profile（智能体配置），Persona（人设）不得重复列出 Skill（技能），禁用提供方 Plugin（插件）后对应 Skill 摘要、完整正文、Tool（工具）、Prompt Section（提示词段）和客户端能力必须共同消失。
- Create Agent（创建智能体）验收必须同时覆盖普通对话和专用创建会话：两条入口都加载同一份 Authoring Skill（创建技能），只由结构化 Tool Result（工具结果）打开未保存草稿；不得存在关键词路由、第二份独立工作流 Prompt（提示词）或自动保存。
- Authoring Tool Allowlist（创作工具允许列表）只适用于 Agent Center 创建的 Dedicated Authoring Session（专用创作会话）。普通 Standard Session（标准会话）调用 `paimind_agent_prepare_create` 后只驱动未保存草稿 UI，不得因此在后续轮次被永久标记为创作会话或丢失标准 Tool（工具）。
- Create Skill（创建技能）必须复用 Skill Center（技能中心）的 Authoring Service（创作服务）和受管 Business Skill Repository（业务技能仓库）：普通对话只由 `paimind-skill-authoring` 的结构化 Tool Result（工具结果）打开未保存草稿，页面手动创建使用同一编辑与保存契约；不得把 Creator/Installer 再作为 Business Skill（业务技能）上架或自动保存。

## 原生创建会话与草稿交接

- 个人与业务智能体的一句话入口只提供“确定”：创建并封锁原生配置会话、准备上下文、将需求填入原生输入框；不发送消息、不调用模型、不保存智能体。用户可以修改输入内容，只有手动发送才启动模型轮次，界面须明确说明这一边界。
- 普通对话与智能体中心专用创建会话复用 [创建技能](../../packages/agent-builder/SKILL.md)。专用入口创建原生 `standard` 会话，并由 `sealAuthoringSession` 校验同一会话的实际预设；普通对话调用创建工具后仍保留标准工具范围。
- 每轮提交前记录原生历史基线，按本轮 `rpcId` 与用户消息关联新增事件；混入其他用户消息、失败、取消、超时或非正常终态时失败关闭。只有目标轮次正常完成且存在非空可见回复时，才能交付该轮结果。
- 草稿由 `paimind_agent_prepare_create` 的结构化结果交接；客户端按原生事件投影。流式展示只包含可见文本，不暴露隐藏推理、控制标记或传输数据，不按用户原文的关键词打开界面。
- 草稿字段由公开契约限制为名称、用途、角色、目标、行为、补充要求、适用业务分类及已安装的业务技能引用；身份、版本、存储、权限与基础预设不由模型任意写入。
- 提案可预览并保留更新前快照。待确认时禁止下一轮配置与保存；撤销恢复快照，保留更新只确认草稿。模型调用、工具返回和提案确认都不得自动保存智能体。
- 缺少原生会话、标准预设、创建能力或模型执行失败时，界面显示真实错误并保留草稿，不用本地规则生成替代提案。PAIMind（产品）不保存第二套创建对话历史，也不维护第二份创作流程提示词。

## 保存、绑定与验证

- Agent Builder（智能体构建器）通过公开服务管理配置及其原生预设投影。使用原生预设创建与选择能力，不构造模拟会话。
- 预设保存采用目录级暂存、备份与重命名；写入失败恢复原目录。`expectedVersion` 防止编辑覆盖，会话绑定保存 `sessionId + presetId + configVersion`。
- 创建会话验证与保存后测试分开：前者证明专用会话使用 `standard` 并完成真实模型轮次；后者证明测试会话选择保存后的预设与配置版本，并同时具有真实会话头、用户消息及可见助手消息。两类证据不能替代。
- 测试对话只运行已保存配置，选择该配置对应的预设与版本；未保存草稿不得复制临时预设或伪造测试智能体。

## 相关契约

采用模板后的工作区技能与入口会话绑定见 [工作区蓝图集成契约](workspace-blueprint-harness-contract.md)。该工作区范围在本文件的普通或智能体会话选择之上合并，仍须通过相同的用户可用门禁和摘要校验。
