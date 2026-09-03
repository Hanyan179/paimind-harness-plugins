# RQ-106 智能体中心产品需求

## 目标与边界

智能体中心是智能体的唯一业务入口；Agent Builder（智能体构建器）不再提供独立业务页面，而是作为创建、编辑和自然语言配置共用的交互区域与后台工作流服务。DeepSeek Harness 继续拥有 Agent Preset（智能体预设）、真实会话、模型、工具和技能运行时。

## 页面

- `平台智能体` 与 `业务智能体` 是 Catalog Category（目录分类），不映射 Harness Runtime Mode（宿主运行模式）。平台智能体展示 PAIMind 官方维护的 Agent，业务智能体展示官方或当前用户维护的业务 Agent。
- “业务智能体”目录直接提供“创建业务智能体”，不是只读目录。创建时选择已有业务分类或输入新分类；保存后留在业务目录，并提供编辑、删除、设为默认和开始对话。
- 业务分类来自绑定真实 Preset 的 Product Taxonomy Projection（产品分类投影）与同一 Preset 目录内的 PAIMind Profile（配置档案）。页面用单个动态下拉框展示当前有真实智能体的分类，不渲染固定分类按钮或空分类；分类数量增长不改变页面结构。
- 当前只展示 Harness 返回的真实 Preset；没有真实业务智能体时显示空状态和创建入口，不填充 Demo（演示）卡片。
- 平台官方原版只读；复制后统一基于 Standard Foundation（标准底座）创建可编辑的个人版本，官方业务智能体复制后创建可编辑的本地业务版本。
- `我的智能体`：创建、编辑、删除、设为默认、开始真实对话。
- 未接入真实组织身份前，不展示组织智能体和组织权限。
- 设置导航不再单独显示 `Agent 构建器` 或 `Agent 预设`；原生 `Agent Presets` 通过智能体中心的 `高级配置` 打开。

### Harness Shell（宿主外壳）与 Builder（构建器）交互

- 智能体中心保留 Harness 原生 Sidebar（侧边栏）、工作区与会话导航，只替换原生对话中央列；中心不是遮住整页的 Modal（模态层），也不新增产品自有返回栏。
- Sidebar（侧边栏）不重复展示“助手”目录；智能体中心与技能中心继续作为侧边栏底部的业务入口。侧边栏收起或展开时，中央列都跟随宿主可用宽度布局。
- 创建个人智能体先用紧凑弹窗收集用途，再在中央列自然展开 Builder（构建器）；编辑已有智能体复用同一 Builder，不进入另一套页面或表单。
- Builder 左侧是可直接编辑的智能体说明书，右侧是贯穿页面高度的配置对话；右侧在“配置对话 / 测试对话”之间切换。配置对话产生的是待确认草稿，用户确认并保存前不得修改运行配置。
- 会话技能默认折叠，仅展示已选数量；展开后再披露搜索、分类、只看已选与技能列表，避免长名称和说明被固定宽度截断。
- 测试对话存在 Unsaved Changes Gate（未保存变更门禁）：未保存的新建或编辑草稿不能测试，也不能创建临时 Preset 副本；保存后测试必须复用刚保存的同一 Agent Preset。

`paimind-agent-authoring` 是 Standard Foundation（标准底座）可发现的 System Skill（系统级技能）。智能体中心入口和普通对话入口加载同一份 Canonical `SKILL.md`（权威技能说明）与结构化 Authoring Tool（创作工具），生成或调整 Builder（构建器）的未保存草稿；不需要用户先选择 `cordis`、创造模式或专用角色，也不产生第二套 Agent、Preset、ID、存储或权限模型。

### 真实 AI 配置对话

- 首次提交用途或配置消息时，Builder 必须复用当前 Standard Session（标准会话），或创建同样基于 Standard Foundation 的专用 Authoring Session（创作会话）；两者都加载同一份 `paimind-agent-authoring`，同一次创建或编辑过程中的后续消息复用该 Session，以保留真实多轮上下文。不得用前端正则、固定模板、关键词映射或字符串追加替代模型生成。
- 页面必须区分 Waiting（等待）、Thinking（思考）、Streaming（流式生成）、Pending Confirmation（待确认）、Completed（完成）和 Error（错误）。流式区域只显示面向用户的可见文本；结构化提案和隐藏推理不作为流式正文展示。
- 一轮配置只有在原生事件出现 `turn/end reason=completed`，且同轮存在非空可见助手回复后才能完成。失败、取消、超时、无模型或其他结束原因不得生成提案、修改运行配置或回退到本地规则结果。
- 模型可以在信息不足时只提出最多两个关键澄清问题，不生成 Proposal（提案）。信息足够时，回复可以附带一个严格结构化提案；只允许业务分类、名称、用途、角色、目标、行为规范、补充要求和完整会话技能清单。未知字段忽略，技能必须来自当前真实已安装清单，基础 Preset、产品类型、智能体身份、版本、存储和权限不能由模型修改。
- 提案可以在左侧说明书中预览，但必须保持待确认状态。用户选择“保留更新”后才把本轮建议作为当前草稿继续编辑；选择“撤销”必须恢复提案前草稿。提案未处理前禁止继续发送配置消息和保存，模型运行期间发生的手动修改不得被晚到回复覆盖。
- AI 配置 Session 只保存 Harness 原生对话历史；它不创建第二套 Agent、Preset 或权限对象。模型只负责理解、澄清和提出草稿建议；PAIMind UI 负责字段校验、确认和最终保存。
- 只有由 Agent Center 创建的 Dedicated Authoring Session（专用创作会话）可以使用 Authoring Tool Allowlist（创作工具允许列表）。普通 Standard Session（标准会话）调用结构化 Tool 后只打开未保存 Builder 草稿，不得永久降级其 Tool Catalog（工具目录）；关闭 Builder 返回原对话后仍保留完整标准能力。

## 业务字段

- 名称、描述
- 业务分类（仅业务智能体；可选择已有分类或新建分类）
- 角色、目标、行为规范
- 会话注入技能
- 自然语言补充要求

`智能体业务技能` 不是全局安装清单，而是当前智能体的 Persistent Skill Scope（持久技能范围）。技能中心继续维护用户级 Skill Policy（技能策略）和全部真实已安装 Business Skill，并允许普通 Session 临时选择。智能体只保存 Persona（人设）与 Business Skill Reference（业务技能引用），不复制 Skill 名称清单、摘要或正文到 Persona。

智能体新会话由同一个 Skill Scope Resolver（技能作用域解析器）计算“用户启用的 System Skill + 当前智能体持久选择且用户仍启用的 Business Skill + 当前 Session 临时选择”的唯一并集。它默认不继承用户的普通对话 Business Skill 默认范围，以保持智能体业务边界；用户仍可在该 Session 临时增加 Skill。PAIMind 新建 Agent 统一继承 Standard Foundation（标准底座），不再以用户可选 Mode（模式）控制技能能力。

技能选择器必须支持搜索、Product Category（产品分类）、分类数量和“只看已选”，以便已安装技能规模增长后仍可管理。当前分类为通用、调研与知识、数据分析、内容与演示、产品与 PDM、工程研发、智能体工具；分类是 PAIMind 的产品投影，不替代 Harness 原生 Skill 元数据和运行时发现。

页面不显示 Preset ID、配置版本、会话 ID、文件路径、配置哈希或插件组合。

## 保存与运行

创建个人或业务智能体时，通过 Harness 原生接口复制固定 Standard Foundation（标准底座），再由后台服务在同一真实 Preset 目录写入业务 Persona（角色设定）、产品归属、业务分类和 Business Skill Reference（业务技能引用）。Agent Center 不创建或扫描智能体专属 Skill Filesystem Root（技能文件系统根目录）；同一个 Skill Scope Resolver（技能作用域解析器）在运行时把引用投影到 Harness 原生会话作用域。保存后必须重新读取原生预设；已选技能缺失、引用冲突或预设损坏时不得标记成功。旧版未记录产品归属的 Profile 默认按个人智能体读取，旧 `.paimind-skills` 扫描配置在保存或读取修复时清理。

`开始对话` 优先复用当前真实空白会话；当前会话已运行时创建新空白会话。目标智能体必须通过 Harness 原生 Agent Preset Seat（预设选择器）绑定；只有 Session（会话）绑定和顶部选择器的稳定状态都与目标 Preset（预设）一致时，智能体中心才能关闭。完成后记录配置版本，并预填一个不重复配置的中性问题，由用户决定是否发送；任一状态不一致时保留在智能体中心并显示真实错误。

Builder 内的 `测试对话` 使用同一绑定规则。保存成功后，测试链路创建或复用真实空白 Session，选择该 Profile 对应的同一个 Agent Preset，并记录相同的 `presetId + configVersion`；不得复制 Preset、构造临时 Agent 或绕过原生选择器。测试完成后可以打开完整 Harness 对话查看原生运行事件和模型回复。

## 版本迁移

每次保存产生新版本。新会话直接使用最新版；已激活会话在下一轮前重新解析 Skill Reference（技能引用），但不改写历史消息。需要迁移 Persona（人设）或其他 Preset 配置时，打开旧版会话自动创建新版会话、写入只含可见人机消息的摘要、记录原会话关系并导航到新版。摘要失败时不发送、不改写旧会话。

## 验收

- 创建后真实首轮对话的预设、配置版本、用户问题和模型回复可核对。
- 侧边栏只有一个智能体业务入口，Settings（设置）中不出现产品中心；高级配置可以打开原生预设页，兼容层失效时原生入口保持可见。
- 平台智能体与业务智能体作为 Catalog Category（目录分类）筛选；业务分类由真实业务智能体动态生成，并通过单个下拉框筛选，Harness Mode（宿主模式）不进入用户界面。
- 业务智能体目录内有直接创建入口；创建面板必须填写业务分类，保存后卡片出现在对应分类中，并可编辑、删除、设为默认和开始真实对话。
- 页面不出现“分类不等于模式”等解释文案，也不展示没有真实智能体的预设分类。
- 平台智能体可以复制为基于 Standard Foundation（标准底座）的个人版本并编辑；平台原版不被修改，PTC、极简、创造等 Harness Mode 不作为用户可选项或复制来源。
- 技能中心可发现全部已安装业务技能；个人智能体新会话的 `skill-catalog` 只包含 System Skill、该智能体持久选择与当前 Session 临时选择的唯一并集，未选择技能不得泄漏进会话。
- 用户在 Skill Center 停用已挂载的 Business Skill 时保留 Agent 引用但不进入新会话目录，并明确提示受影响智能体数量；重新启用后恢复，无需重新挂载。
- Agent Persona、System Prompt 和最终 `skill-catalog` 不得重复保存或注入同一 Skill 正文；Agent 与 Session 同时选择同一 Skill 时只出现一条摘要。
- 技能选择器支持搜索、产品分类及“只看已选”；分类数量来自当前真实已安装技能。
- 修改后新会话使用新版本；旧会话打开后迁移并保留原历史。
- 技能缺失、预设损坏、模型失败或版本不一致时不标记验证通过。
- 打开智能体中心或 Builder 时，原生 Sidebar 保持可见且可识别；中央列不覆盖 Sidebar，不出现第二套产品顶栏或右上角返回按钮。
- 创建和编辑复用同一 Builder；配置对话变更可确认或撤回，会话技能按需渐进披露；未保存草稿进入测试对话时必须提示先保存。
- 首轮与后续配置消息通过同一个 Harness 原生 Standard Session 与同一份 `paimind-agent-authoring` 调用真实模型；页面能显示可见流式文本，并且只有 `turn/end reason=completed`、非空助手回复与合法结构化 Tool Result（工具结果）同时存在时才接纳本轮草稿。
- 模型提案只影响允许的业务字段和真实已安装技能；提案待确认时不能继续对话或保存，撤销恢复上一版，模型失败时不得生成本地替代结果。
- 保存后的测试会话与被编辑智能体使用同一 `presetId + configVersion`，并能打开完整 Harness 对话核对真实回复。
- 普通对话中的自然语言创建请求与智能体中心创建入口汇入同一 Builder 请求；两条路径都加载同一份 `paimind-agent-authoring`，只由结构化 Tool Result 打开未保存草稿，不创建新的 Agent 类型或影子 Preset。
- 真实 AI 验收必须同时留存 Standard Foundation 绑定、`paimind-agent-authoring` 目录加载、结构化 Tool Result、用户输入、可见助手回复和正常完成事件；字段变化、页面文案、模拟返回值或保存后测试智能体的回复不能代替创建助手证据。
