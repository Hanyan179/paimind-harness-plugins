# Skill Center Reference Design

> Status（状态）：Research-backed Design（调研完成的设计）
> Scope（范围）：Skill Center（技能中心）的 Information Architecture（信息架构）、Domain Ownership（领域归属）与 Runtime Scope（运行时作用域）
> Evidence date（证据日期）：2026-09-02

## 1. Decision（决策）

PAIMind 不新建第二套 Skill Runtime（技能运行时）。Skill Center（技能中心）复用 Harness 已有的 folder-based Skill（文件夹技能）、`ctx.skills` Layered Registry（分层注册表）、Skill Catalog（技能目录）、按需正文加载与目录 Watcher（监听器）。PAIMind 只补齐用户级 Skill Policy（技能策略）、Business Skill（业务技能）的发现与生命周期，以及 Session（会话）和 Agent（智能体）的作用域选择。

Skill Center 采用 Qwen Work（千问办公）已经验证的三个主视图：

1. `市场`：可安装的 Business Skill Package（业务技能包）。
2. `内置`：Harness 当前可见的 System Skill Catalog（系统技能目录）投影；定义只读，可选系统技能允许用户启用或停用。
3. `已安装`：Skill Center 受管 Business Skill Repository（业务技能仓库）。

Agent Center（智能体中心）继续保持独立入口，不与 Skill Center 合并。Connector/MCP（连接器/模型上下文协议）属于后续独立领域能力；即使未来进入统一 Extension Center（扩展中心），也只统一发现入口，不统一存储、权限或运行注册表。

Skill Center 与 Agent Center 不各自生成一份目录。两者只提供不同层级的 Policy Input（策略输入），由一个无持久状态的 Skill Scope Resolver（技能作用域解析器）在 Session 创建或目录变化时计算一次 Effective Skill References（有效技能引用），再交给 Harness 原生作用域注册表。Agent Persona（智能体人设）与 Skill Catalog 分层注入，Skill 正文不会因 Agent 绑定再次注入。

## 2. Reference findings（参考产品结论）

| Reference（参考产品） | Observed pattern（已观察模式） | PAIMind adoption（采用结论） |
| --- | --- | --- |
| Qwen Work（千问办公） | `扩展` 下区分专家套件、技能、连接器；技能页面区分 `市场 / 内置 / 已安装`，内置中包含 `create-skill`、文档和检索等平台能力 | 直接采用三主视图；`内置` 对应 Harness System Skill Catalog（系统技能目录） |
| WorkBuddy（工作伙伴） | 首层区分 Experts、Skills、Connectors；Skills 页面提供 Featured、Recommended、SkillHub、Plugins、Installed 与 Add Skill | 复用统一搜索、来源分区、已安装计数和单一 Add Skill（添加技能）入口；不复制其市场数据 |
| Doubao Work（豆包工作） | 在同一个技能发现页面混排 Skill 与 Connector，但 Connector 卡片持续显示类型标签；Partner 保持独立入口 | 可统一 Discovery Surface（发现界面），但 Skill、Connector 与 Agent/Partner 仍是三个对象 |
| Agent Skills open format（开放格式） | Skill 是至少包含 `SKILL.md` 的目录，可选 `scripts/`、`references/`、`assets/`；通过 Metadata → Instructions → Resources 渐进加载 | Skill Center 管理完整目录包，不把 Skill 降级为一张说明表，也不一次性把全部正文注入模型 |
| MCP（模型上下文协议） | Tool、Resource 与 Prompt 是外部能力暴露协议，负责动作、数据和模板 | Connector/MCP 不是 Skill 的别名；Skill 可以说明何时及如何使用 MCP Tool，但不替代 Tool 的 Schema、认证和副作用边界 |

## 3. Domain model（领域模型）

| Object（对象） | Canonical owner（权威所有者） | Persistence（持久化） | Product surface（产品界面） |
| --- | --- | --- | --- |
| System Skill Definition（系统技能定义） | Harness 或提供能力的 Source Plugin（来源插件） | 源码包、Bundled Root（内置目录）或 `ctx.skills.register()` | Skill Center 的 `内置` 定义只读视图 |
| Business Skill Package（业务技能包） | `@hansen/skill-market` | `$DSH_HOME/.paimind-skill-market/skills/<name>/` | `市场 / 已安装 / 添加技能` |
| User Skill Policy（用户技能策略） | `@hansen/skill-market` | 用户级可用状态、普通对话默认选择；只保存 Skill Reference（技能引用） | `内置 / 已安装` 的开关和使用范围 |
| Session Skill Attachment（会话技能挂载） | 当前 Live Session（实时会话）；Skill Center 只做产品投影 | 当前进程内的 Agent-scoped Native Provider（智能体作用域原生提供方），不得写入 Persona 或自定义未知 Session Event（会话事件） | 已安装详情中的 `用于当前对话` |
| Agent Skill Attachment（智能体技能挂载） | Harness Agent Preset（宿主智能体预设）；Agent Center 只做产品投影 | Agent Profile（智能体配置）中的 Business Skill Reference（业务技能引用）；不生成第二个可扫描技能目录 | Agent Builder（智能体构建器）及已安装详情中的确认入口 |
| Skill Scope Resolver（技能作用域解析器） | `@hansen/skill-market` Runtime Service（运行时服务） | 不持久化结果；通过公开 Contract（契约）读取用户策略、Agent 绑定和 Session 选择 | 无独立页面 |
| Connector/MCP（连接器/模型上下文协议） | MCP Client/Tool Registry（连接器客户端/工具注册表） | 独立连接配置、授权与 Tool 生命周期 | 后续 Connector Center（连接器中心） |

Skill Center 不创建 Skill Runtime ID（技能运行标识）、Skill Body Store（技能正文存储）、Invocation RPC（调用接口）或重复注册表。业务目录中的稳定身份仍是符合 Agent Skills 规范的 `name` 与目录。

## 4. Runtime data flow（运行时数据流）

```text
Harness/System Plugins -> System Skill Definitions
Skill Center -> User Skill Policy + Business Skill Repository
Agent Center -> Agent Definition + Agent Business Skill References
Live Harness Session -> Runtime-ephemeral Session Business Skill References

Skill Scope Resolver(userId, sessionId, agentId?)
  -> Mandatory System Skills
  -> User-enabled Optional System Skills
  -> Direct chat: User-default Business Skills
  -> Agent chat: Agent-selected Business Skills
  -> Current Session-selected Business Skills
  -> filter by User-enabled Business Skills
  -> collision check + deduplicate by canonical Skill identity
  -> one Effective Session Skill Catalog
  -> summary only: name + description
  -> Harness skill({ name }) loads canonical SKILL.md on demand
  -> references/scripts/assets are read only when required
```

### Resolution formula（解析公式）

```text
EligibleSystem = MandatorySystem ∪ UserEnabledOptionalSystem
EligibleBusiness = InstalledBusiness ∩ UserEnabledBusiness

DirectSessionCatalog
  = EligibleSystem
  ∪ (EligibleBusiness ∩ UserDefaultBusiness)
  ∪ (EligibleBusiness ∩ SessionAttachments)

AgentSessionCatalog
  = EligibleSystem
  ∪ (EligibleBusiness ∩ AgentAttachments)
  ∪ (EligibleBusiness ∩ SessionAttachments)
```

用户级 `启用` 只表示 Skill 可以被作用域解析器使用，不等于每个 Session 都注入。Business Skill 还必须进入普通对话默认范围、目标 Agent 或当前 Session 之一。这样即使用户安装一千个 Skill，也不会把一千条摘要全部注入模型。

Agent Session（智能体会话）默认不继承 `UserDefaultBusiness`，以保持 Agent 的业务边界；用户仍可为当前 Session 临时增加 Skill。System Skill 属于 Standard Foundation（标准底座），按用户开关统一继承。平台身份、安全规则和不可关闭的 Runtime Invariant（运行时不变量）不伪装成可关闭 Skill。

### Merge rules（合并规则）

- Business Skill 名称不得与任何当前可见 System Skill 同名；安装、保存、Session 选择与 Agent 绑定全部 Fail Closed（失败关闭）。
- 同一个 Business Skill 同时被 Agent 和 Session 选择时，只出现一次目录摘要，并加载同一份受管目录正文。
- User Policy（用户策略）是 Eligibility Gate（可用性门禁）：停用后保留 Agent 与 Session 的引用但不进入有效目录，重新启用后可恢复；界面必须提示受影响的引用数量。
- System Skill 定义不可由用户编辑或卸载；只有 Source Plugin 能按用户作用域原子关闭摘要、正文、必需 Tool 和客户端能力时，才可标记为 Optional（可选）。其余能力保持 Mandatory（必需）和锁定状态，并说明原因。
- 当前 Lifecycle Classification（生命周期分类）为：`paimind-skill-installation`、`paimind-skill-authoring`、`paimind-agent-authoring` 与 `genui` 均已接入同一 User Skill Policy（用户技能策略），默认开启并允许用户关闭。前两项由 `@hansen/skill-market` 管理 Skill（技能）与私有 Tool（工具）的原子生命周期；Agent Authoring（智能体创作）由 `@hansen/agent-builder` 的来源执行器控制并保留独立安全 Guard（守卫）；GenUI（生成式界面）通过独立 Harness Loader Entry（宿主加载器条目）整体启停。切换不重启 Host（宿主）；只有 GenUI 的浏览器 Client Module（客户端模块）变化需要重新加载应用壳。
- Session 选择是临时作用域，不修改 Agent Profile；Agent 选择是持久作用域，新会话直接使用，已激活会话在下一轮前重新解析。
- 当前 Harness 的持久化事件词表不接受下游 Plugin 自定义必需事件，公开 `Session.append()` 也不能为该事件安全写入 `ignorable` 标记；因此本版本的 Session 选择只在当前宿主进程和 Live Session 生命周期内有效。不得为了跨重启恢复而追加未知事件、借用无关事件或建立 PAIMind 影子会话存储。
- Agent Center 只保存 Persona、目标、行为约束和 Business Skill Reference；它不得拼接第二份 Skill Catalog 或把 Skill 名称、摘要、正文复制进 Persona。
- 安装、选择和加载是三个不同状态。安装成功不代表已进入当前 Session；进入当前 Session 不代表所有脚本依赖已经就绪。
- 目录变化通过 Harness `skills/change`、文件监听与 Catalog Replacement（目录替换）热更新，不要求重启 Harness。Provider 暂时不完整时保留 Last-good Catalog（最后一次完整目录），不得伪造空目录。

## 5. Product information architecture（产品信息架构）

### Primary views（主视图）

- `市场`：Business Skill 推荐目录，支持分类、来源、搜索、检查、安装和更新。页面不提供点赞或收藏；没有可信社区行为数据时，不用浏览器本地偏好制造流行度信号。
- `内置`：System Skill Catalog，显示名称、说明、来源插件、Mandatory/Optional（必需/可选）和用户启用状态；定义不可编辑或卸载，可选项可以启用或停用。
- `已安装`：用户已创建、导入或安装的 Business Skill，支持编辑、更新、可恢复卸载、用户级启用/停用、普通对话默认使用、当前对话选择和 Agent 挂载。

来源、分类、安装状态与是否只看已选都是 Filter（筛选），不再与三个主视图保持同级导航。分类使用目录显式元数据优先、旧包回退推断的 Product Taxonomy Projection（产品分类投影）；结果采用有界增量渲染，远程或千级目录必须进一步使用服务端搜索与 Cursor Pagination（游标分页）。

### Add Skill（添加技能）

页面只保留一个 `添加技能` 主操作，展开四个来源：

1. `用 AI 创建`：普通对话由 `paimind-skill-authoring` 加载同一 Authoring Skill（创作技能），结构化 Tool Result（工具结果）打开未保存草稿。
2. `手动创建`：进入同一未保存编辑器。
3. `从本地导入`：导入 `SKILL.md` 或包含资源目录的 ZIP。
4. `从 GitHub 安装`：由 `paimind-skill-installation` 走相同检查、确认和原子安装服务。

四条入口共享一个 Skill Package Validator（技能包校验器）、一个 Business Skill Repository、一个编辑合同和一个保存服务；不得维护四套字段或自动保存。

### Use actions（使用动作）

- `用于当前对话`：只在存在当前 Session 时显示；选择后立即刷新该 Session 的有效目录，取消后移除临时挂载。
- `普通对话默认使用`：把已启用 Business Skill 加入用户的 Direct Chat Default Scope（普通对话默认作用域）；不自动进入 Agent Session。
- `挂载到当前智能体`：只在当前 Session 绑定 PAIMind 托管 Agent 时显示；变更前明确确认。新会话直接使用，已激活会话不改写历史消息并在下一轮前重新解析。
- 未绑定 Agent 的普通 Session 可以临时使用 Business Skill，但不能静默创建或修改 Agent。
- 用户级开关变化不改写历史消息或正在运行的 Turn（轮次）；当前可见 Session 在下一轮前完成 Catalog Replacement（目录替换），其他 Session 在重新激活或下一轮运行前重新解析。

## 6. Object states（对象状态）

| State（状态） | Meaning（含义） | Source of truth（事实来源） |
| --- | --- | --- |
| Built-in（内置） | 当前 Harness 作用域可发现的 System Skill | `ctx.skills` 的 System Provider 视图 |
| Available（可安装） | 市场存在，但业务仓库未安装 | 推荐目录 + 安装清单差集 |
| Installed（已安装） | Business Skill 目录与管理清单存在 | Business Skill Repository |
| Enabled for user（用户可用） | 用户允许 Resolver 在作用域计算时使用该 Skill | User Skill Policy |
| Default in direct chat（普通对话默认） | 已启用 Business Skill 默认进入无 Agent 的新 Session | User Skill Policy |
| Used in this Session（用于当前对话） | 当前 Session 临时选择 | Live Session Object（实时会话对象）+ Agent-scoped Native Provider（智能体作用域原生提供方） |
| Attached to Agent（已挂载智能体） | Agent Profile 持久选择 | Agent Profile 的 Business Skill Reference 回读 |
| Runtime setup to verify（运行环境待确认） | 包声明的脚本、依赖或凭证尚未验收 | Package/Runtime Readiness Gate（包/运行就绪门禁） |

## 7. Acceptance gates（验收门禁）

1. `内置` 视图从 Harness 原生目录读取，每个 System Skill 只出现一次；可选项关闭后从当前 Session 下一轮及后续 Session 的有效目录消失，摘要、正文、必需 Tool 和客户端能力必须原子关闭；无法满足这一 Lifecycle（生命周期）的能力必须锁定为必需项。
2. 安装 Business Skill 后，它只进入业务仓库；未被 Session 或 Agent 选择时不得出现在任何会话目录。
3. 当前 Session 选择后，无需重启即可出现完整 Catalog Replacement 和真实 Context Injection（上下文注入）；其他 Session 不得出现。宿主进程重启后临时选择归零，直到 Harness 提供安全的下游 Session Event 注册契约。
4. Agent 绑定后，该 Agent 的新会话可见，已激活会话在下一个 Turn（轮次）前重新解析；其他 Agent 和普通 Session 不得出现。绑定或解绑都不改写已有消息历史。
5. Agent 与 Session 同时选择同名 Business Skill 时，目录中只有一条摘要，`skill({name})` 只返回同一份 Canonical `SKILL.md`。
6. Skill 包按 Agent Skills 目录规范保留 `scripts/`、`references/`、`assets/`；安装不执行第三方脚本，依赖与凭证单独确认。
7. 页面与对话创建、页面与对话安装均复用相同服务；未确认前不产生持久对象，失败不会污染旧版本。
8. Skill、Connector 和 Agent 的 UI 可以共享入口，但任何测试都必须分别核对 Skill Catalog、Tool Registry 与 Agent Preset，不得以卡片文案替代运行事实。
9. 普通 Session 只包含用户启用的 System Skill、普通对话默认 Business Skill 与当前 Session 临时 Skill；Agent Session 用 Agent 绑定替换普通对话默认 Business Skill，再叠加当前 Session 临时 Skill。
10. User、Agent 与 Session 三层同时引用同一 Skill 时只产生一个目录条目和一次正文加载；Agent Persona 与 System Prompt 中不得出现复制的 Skill 正文。

## 8. Delivery order（交付顺序）

1. Contract alignment（契约对齐）：先更新 PRD、对象归属、状态语义和反向断言。
2. User policy and resolver（用户策略与解析器）：建立必需/可选系统技能、业务技能可用状态、普通对话默认范围和无状态合并 Contract。
3. Built-in projection（内置投影）：增加 `内置` 主视图，直接读取 Harness System Skill Catalog，并只允许切换可选项。
4. Session attachment（会话挂载）：实现原生 Session Projection 与 scoped provider/reference，并验证热刷新与跨会话隔离。
5. Business lifecycle（业务生命周期）：收敛市场、创建、本地导入、GitHub 安装、编辑、更新和卸载。
6. Agent attachment（智能体挂载）：Agent Center 只持久化 Business Skill Reference，由同一个 Resolver 生成一次原生作用域目录；不得再建立 `.paimind-skills` 文件扫描提供方。
7. Connector evolution（连接器演进）：未来单独设计 Connector Center；不阻塞 Skill Center 首版。

## 9. Explicit non-goals（明确不做）

- 不把全部 Business Skill 注册到 Harness 全局 Skill Root。
- 不把完整 Skill 正文写入 System Prompt、Persona 或每轮用户消息。
- 不把 Skill、MCP Tool 与 Agent 合并为一张通用“能力表”。
- 不要求重启宿主才能识别安装、编辑、选择或解绑变化。
- 不为意图识别增加关键词路由；模型通过 Skill Catalog 描述按需加载 System Skill，再调用结构化 Tool。

## 10. Research sources（调研来源）

- 用户于 2026-09-02 提供的 WorkBuddy、Qwen Work 与 Doubao Work 桌面端真实截图；截图只作为本次设计证据，不提交到仓库。
- [WorkBuddy official product surface](https://www.workbuddy.ai/)
- [Agent Skills specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx)
- [MCP server primitives](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- DeepSeek Harness 本地权威文档：`../Deepseek harness/docs/subsystems/skills.md` 对应的仓库文件，定义 `ctx.skills` 分层作用域、目录替换、按需加载与热发现语义。
