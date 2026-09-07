# RQ-105 技能市场产品需求

## 目标

技能市场为个人用户提供发现 System Skill（系统技能），以及创建、编辑、安装、临时使用和管理 Business Skill（业务技能）的统一入口。DeepSeek Harness 继续负责发现、解析、权限判断、内容注入和执行；PAIMind 不建立第二套运行注册表。详细对象与数据流以 [`../plans/skill-center-reference-design.md`](../plans/skill-center-reference-design.md) 为准。

## 页面与字段

Skill Center（技能中心）保留 Harness 原生 Sidebar（侧边栏），以 Non-modal Center Surface（非模态中央界面）替换当前对话中央列；不得遮住整页、复制宿主顶栏或改成右上角返回的独立产品页面。Sidebar 收起或展开时，中央界面跟随宿主可用宽度布局。

- `全部技能`：将市场推荐目录与本机已安装 Business Skill（业务技能）按名称合并去重，完整包含已安装集合；不包含单独管理的系统技能。已安装项统一展示受管包的名称和说明，市场版本与许可明确标注为市场包信息；本地技能不伪造市场版本、许可或上架状态。支持搜索、Product Category（产品分类）、来源与安装状态筛选，不依赖当前会话。Skill Center 不提供点赞或收藏，避免用个人偏好伪装社区质量或流行度。
- `内置`：展示 Harness 当前可见的 System Skill Catalog；定义不可编辑、卸载或 Agent 挂载，Optional（可选）项允许用户启用或停用，Mandatory（必需）项保持锁定。
- `已安装`：名称、说明、管理来源、编辑、真实新版更新、可恢复卸载、用户级可用状态、`普通对话默认使用`、`用于当前对话` 与经确认的 `挂载到当前智能体`。
- `创建 Skill`：创建完整 Skill Folder Package（技能文件夹包）；`SKILL.md` 是入口文件，`scripts/`、`references/`、`assets/`、场景示例与其他嵌套文件均属于同一对象。名称、用途说明等字段只是 `SKILL.md` Frontmatter（头部元数据）的界面投影，不是独立数据表。AI 与手动入口复用同一份未保存文件树、校验和保存契约。
- `本地导入`：优先选择完整文件夹，也支持 `.zip` 或单个 `SKILL.md`；完成检查后展示名称、说明、文件数量、解压大小和风险，再由用户确认安装。
- 第一次点击“导入本地 Skill”只打开导入说明；说明必须解释可导入内容、`SKILL.md` Frontmatter、ZIP 根目录、可选资源目录、凭证风险、个人范围和 Harness 原生发现/执行边界。只有用户在说明中再次选择 Skill 包，才打开文件选择器。
- 搜索结果、分类、Skill 卡片与详情采用 Progressive Disclosure（渐进式披露）：列表先保证完整名称、来源与关键状态可识别，较长说明按需展开，不以省略号替代可访问的详情。
- 分类属于 Skill Center 的 Product Taxonomy Projection（产品分类投影）：目录包声明的分类优先，旧包缺失时允许按名称、说明和标签回退推断；分类不得改变 Harness Skill Identity（宿主技能身份）或运行时作用域。
- 市场列表采用 Bounded Incremental Rendering（有界增量渲染），首屏只创建固定数量的行，用户按需继续加载。目录增长到远程或千级规模时，Catalog Service（目录服务）必须提供服务端搜索、筛选、总数与 Cursor Pagination（游标分页），不得依赖浏览器先下载全部目录后再过滤。
- 社区包若声明 Python、Node.js 或系统依赖，页面单独显示“运行环境待确认”；安装状态与运行环境就绪状态是两个不同事实。
- 页面不显示运行 ID、磁盘路径、摘要哈希、内部版本说明和组织权限占位。

推荐目录同时支持官方适配 Skill 与 PAIMind 内部 Skill。可溯源演示链包含
`bento-ppt`、`fineline-investment-analysis`、`white-space-analysis` 和
`build-walmart-buyer-proposal-outline`。内部包显示
`PAIMind Internal · Adapted for Harness` 与
`UNLICENSED / Internal Use Only`，并携带来源提交和修改摘要。

## 真相来源

- 推荐目录只保存可安装包及展示元数据，不参与运行时注册。
- 全部技能只是客户端对推荐目录和安装清单的即时合并，不创建新存储、注册表或发布流程。来源筛选中的“市场目录”表示存在可安装市场条目；“本地创建”“上传或导入”“外部管理”来自已有安装记录。因此市场条目可以同时具有本地安装来源，不能仅凭同名推断安装来源。
- 推荐目录与安装清单分别读取，任一失败时保留另一来源的结果并标明列表不完整；安装清单未就绪时不显示“可安装”或允许发起安装。已安装视图与全部技能复用搜索、来源和分类规则；无搜索结果与没有安装记录必须区分。
- 已安装状态来自 PAIMind 安装清单和隔离的 Business Skill Repository（业务技能仓库），不是 Harness 全局 Skill Root（宿主技能根目录）。
- Harness 文件系统发现、上下文注入和执行仍是唯一运行链路。
- System Skill（系统技能）只读状态来自 Harness `ctx.skills` 的 System Provider（系统提供方）视图；Skill Center 不复制 System Skill 包或 Lifecycle（生命周期）。
- User Skill Policy（用户技能策略）由 Skill Center 唯一维护，只保存 Optional System Skill（可选系统技能）的开关、Business Skill（业务技能）的可用状态与普通对话默认引用，不保存 Skill 正文或解析后的目录。
- Current Session Selection（当前会话临时选择）由 Skill Center 保存在当前 Live Session（实时会话）的进程内产品投影，并通过 Agent-scoped Native Provider（智能体作用域原生提供方）进入 Harness 目录；它不写入 Persona（人设）、Business Skill 安装清单或未知 Session Event（会话事件）。宿主重启后临时选择归零，直到 Harness 提供安全的下游事件注册契约。
- Agent Center（智能体中心）负责把已选 Business Skill 持久挂载到目标 Agent（智能体）；Skill Center 可以从详情发起确认，但不得绕过 Agent Center 的保存与回读契约。
- Skill Scope Resolver（技能作用域解析器）由 Skill Center Runtime Service（技能中心运行时服务）唯一提供，通过公开 Contract（契约）读取 Agent 绑定和 Session 选择，输出去重后的 Skill Reference（技能引用）；Harness 仍负责真实注册、目录注入和正文加载。

## 创作流程

`普通对话加载 paimind-skill-authoring → paimind_skill_prepare_create 产生结构化未保存草稿 → 自动打开 Skill Center → 用户修改 → 用户保存 → 原子写入业务技能仓库`

页面中的“创建 Skill”从带根目录 `SKILL.md` 的空文件夹草稿进入同一 Package Editor（技能包编辑器）。编辑器以分页文件树按需读取单文件，保存时提交增量文件操作，并保留未改动的文本、脚本和 Binary Resource（二进制资源）。对话入口与页面入口不得维护两套字段、两套保存服务或关键词意图路由。Codex `skill-creator` 只提供可迁移的编写原则；平台适配后是源码 Plugin（插件）拥有的 System Skill（系统级技能），不得再次作为 Business Skill（业务技能）上架。

## 安装流程

`市场、GitHub 或本地上传 → 内容检查 → 风险展示 → 用户确认 → 原子安装到业务仓库 → 用户选择 Session 或 Agent 作用域 → Harness 自动发现`

上传使用原始字节流，不使用 `contentBase64`。产品不设置固定文件大小、展开大小或文件数量上限；系统根据实时磁盘空间和请求状态决定是否继续。

## 状态与失败

- 上传中可由浏览器取消；中断上传清理临时文件。
- 路径穿越、绝对路径、越界符号链接、加密包和异常压缩比直接拒绝。
- 脚本和可执行文件只展示风险，安装过程不执行。
- 使用标准 YAML 解析 `SKILL.md` frontmatter，支持折叠多行说明和嵌套 metadata；已知生态展示目录 `.claude-plugin`、`.codex-plugin` 不进入 Skill 安装目录，其余越界文件仍拒绝。
- `requirements.txt`、`pyproject.toml`、`environment.yml` 与 `package.json` 只用于识别运行依赖类型；平台第一阶段不自动执行脚本或安装第三方依赖。
- 更新采用目录级原子替换；失败恢复旧版本。
- 卸载只允许 PAIMind 安装的 Skill，并移动到可恢复备份。

## 验收

- 保存或安装后默认只进入 Business Skill Repository（业务技能仓库）；未选择当前 Session 或目标 Agent 前不得进入任何会话目录。
- 用户级 `启用` 只表示 Business Skill 可被选择，不等于注入所有 Session；普通对话还需加入默认范围或当前 Session，Agent 对话还需由该 Agent 或当前 Session 选择。
- Optional System Skill 关闭后，其摘要、正文、必需 Tool 和客户端能力必须在当前 Session 下一轮及后续普通 Session/Agent Session 中原子消失；无法按用户作用域满足该 Lifecycle（生命周期）的 System Skill 必须锁定为 Mandatory，不提供虚假开关。
- 当前 Session 选择后，无需重启即可通过 Harness 原生目录热发现；取消选择后目录自动替换，且其他 Session 不受影响。
- Agent 挂载后，新会话直接可见；已激活的该 Agent Session 不改写历史消息，并在下一轮前重新解析。未选择的 Agent 与普通 Session 不得泄漏该 Skill。
- 社区包必须同时验证：包结构可安装、被显式选择的 Harness 隔离会话可发现、该真实会话产生目标 Skill 的 Context Injection（上下文注入）；仅显示“已安装”不算可用验收。
- 没有当前对话时仍能查看市场、内置、已安装、创建、编辑和安装；此时不显示 `用于当前对话`。
- System Skill（系统级技能）名称不得被创建、上传或 GitHub 安装的 Business Skill（业务技能）覆盖。
- 普通对话生成草稿后自动打开技能中心；未点击保存前，业务技能仓库不得出现该 Skill。
- 更新、卸载、取消、磁盘不足、恶意压缩包和中途失败均有真实结果。
- 桌面与窄屏无列表圆点、文字粘连、长文本溢出和横向滚动。
- 打开技能中心时原生 Sidebar 保持可见，中央列不出现产品自有顶栏或返回按钮；Sidebar 展开、收起和受限宽度下均无页面级横向溢出。
- 长 Skill 名称和说明可通过渐进式披露完整读取；本地导入首击不触发文件选择器。
- 市场提供分类及真实数量，切换搜索、分类、来源或安装状态后从首批结果重新展示；继续加载不会重复或漏掉结果。
- 市场不显示点赞、收藏、收藏筛选或基于本地收藏的排序。
- Agent 与 Session 同时选择同一 Business Skill 时，Skill Catalog 只出现一条摘要并加载同一份 `SKILL.md`。
- 普通 Session 使用“用户启用的 System Skill + 普通对话默认 Business Skill + Session 临时选择”；Agent Session 使用“用户启用的 System Skill + Agent 持久选择 + Session 临时选择”，不自动继承普通对话默认 Business Skill。

## 社区包真实验收记录

2026-08-16 使用官方 `ppt-master` v4.7.0 压缩包完成真实验收：

- 标准 YAML 正确读取完整多行说明，不再显示为 `>`。
- `.claude-plugin` 展示元数据未进入安装目录；实际安装 `12,912` 个包内文件。
- 页面明确显示 Python 运行依赖与脚本风险，安装过程未执行脚本。
- 无需重启 Harness，新建真实会话后 `上下文注入 ppt-master` 出现，真实模型按该 Skill 返回运行环境检查结果。
- 当前宿主已具备 `python-pptx`、Pillow 与 lxml；CairoSVG、PyMuPDF 和 openpyxl 等可选路径依赖尚未补齐，因此不宣称所有 PPT Master 工作流都已运行就绪。

该记录早于本次 Session/Agent 双作用域设计，只证明包解析、安装安全、宿主热发现和真实 Skill 加载；它不能替代“未选择时全局缺席、Session 临时选择、跨 Session 隔离与 Agent 持久挂载”的新版验收。
