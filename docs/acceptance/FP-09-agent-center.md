# FP09 智能体中心验收

## 当前状态

历史主链路为 `Product E2E Verified`，最近验收日期为 2026-08-17。2026-08-21 原生 Shell 与统一 Builder 的外壳、布局、入口和保存后测试对话已完成本地 Pre-Acceptance（预验收）；此前把前端本地规则造成的字段同步当作“创建助手真实 AI”的证据是错误的，该结论已撤回。当前工作树已经改为 Harness 原生 `cordis` Session（会话）驱动的创建链路，但新的真实模型 Browser E2E（浏览器端到端）证据仍待本轮补齐，共享测试环境验收继续单列为待办。当前规范为 [`../product/RQ-106-agent-center-prd.md`](../product/RQ-106-agent-center-prd.md)。

## 验收入口

- URL：`http://127.0.0.1:3080/`
- 入口：`侧边栏 → 智能体中心`
- 高级入口：`智能体中心 → 高级配置` 打开 Harness 原生 `Agent Presets`

## 必须通过

1. 智能体相关业务入口只有“智能体中心”；没有独立 Agent 构建器页面，原生 Agent Presets 导航默认隐藏。
2. “高级配置”仍能打开原生 Agent Presets；兼容层失配时 Fail Open，卸载时恢复原生导航。
3. 平台智能体使用“平台模式 / 业务智能体”固定切换；业务智能体目录直接提供创建入口；业务分类通过动态下拉框出现，分类数量增长不得扩张为横排按钮。
4. 业务智能体表单增加必填业务分类，可选择已有分类或直接输入新分类；其余字段为名称、描述、运行模式、角色、目标、行为规范、会话注入技能和补充要求。技能支持搜索、产品分类和只看已选，极简模式禁用并清空技能选择。
5. 标准、PTC、极简平台智能体可通过“复制并编辑”创建个人版本；官方原版保持只读，创造模式通过原生高级配置管理。
6. 创建后重新读取 Harness 真实 Preset；损坏时不标记成功。
7. `开始对话` 复用当前或创建新的真实空白 Session，并在首轮前绑定目标 Preset 和配置版本；顶部原生选择器必须稳定显示同一 Preset。
8. 发送中性问题，回复真实体现角色与行为；首轮验证记录为 Passed。
9. 修改后新对话使用新版本；打开旧对话会迁移到新版并显示可见摘要。
10. 页面不出现 Preset ID、配置哈希、文件路径和会话 ID。
11. 技能中心可发现全部真实已安装 Skill；个人智能体新会话只注入已封装 Skill，未选择技能不进入 `skill-catalog`。
12. 通过类型检查、构建、插件隔离以及桌面/受限宽度浏览器检查。
13. 新建业务智能体必须先复制真实 Harness Preset，再把产品归属与分类写入同一 Preset 的 PAIMind Profile；保存后出现在业务目录，并可编辑、删除、设为默认和开始真实对话。
14. 创建个人智能体先打开 Purpose-first（用途优先）的紧凑草稿弹窗，用户描述用途并可确认名称与基础运行模式；继续后必须创建 Harness 原生 `cordis` Session，并由真实模型生成或调整角色、目标、行为规范、补充要求和已安装会话技能。不得用前端正则、固定模板或字符串拼接冒充创建助手。只有最终保存才创建真实 Harness Preset。
15. 智能体中心和 Builder 只占用 Harness 原生对话中央列；Sidebar 保持可见，不出现产品自有顶栏、独立返回栏或整页模态遮罩，Sidebar 内不重复展示“助手”目录。
16. 创建与编辑复用同一 Builder；同一次配置过程的多轮消息复用同一个 `cordis` Session。只有正常完成且包含可见助手回复的模型轮次才可以生成 Proposal（提案）；提案可预览、确认或撤回，未处理前不能继续发送或保存。会话技能默认折叠并按需披露搜索、分类、只看已选和完整列表。
17. 测试对话只运行已保存配置。未保存草稿必须提示先保存；保存后测试使用同一真实 Agent Preset 与配置版本，不创建临时 Agent 或 Preset 副本。
18. Harness 原生 `cordis` 只承担“个人智能体创建助手”能力。智能体中心入口和主对话 `@` 入口汇入同一 Builder，不新增 PAIMind Agent 实体、ID、存储、运行时或权限模型。
19. 配置对话必须显示真实模型的等待、思考和可见流式文本；结构化提案块不作为面向用户的流式正文。模型失败、取消、超时、无可用模型或非 `completed` 结束时不得生成提案，也不得回退成本地规则结果。
20. 真实 AI 验收必须能通过创建参数、创建结果或原生 Session Header（会话头）核对该创建会话使用 `agentPreset=cordis`，并在原生记录中核对用户输入、带模型路由的请求、可见助手回复和 `turn/end reason=completed`；字段变化、页面截图、模拟测试返回值或另一个已保存智能体的模型回复均不能单独证明创建助手接入 AI。

## 2026-08-21 创建助手 AI 缺陷更正

### 已撤回的错误证据

- 旧实现的“生成智能体说明书”和“配置对话”直接运行前端本地规则，对自然语言做正则匹配、固定角色/目标/行为模板拼接和补充要求追加；它没有创建 `cordis` Session，也没有调用模型。
- 因此，下方历史 Browser E2E 中“字段同步、撤回和确认”的观察只能证明界面状态变化，不能证明真实 AI。此前将其列为创建助手 AI 通过项的结论已经撤回。
- `session-62fc6434-c28f-401f-b18b-7e47d138fc73` 仍是保存后同 Preset 测试对话的真实模型证据，但它不属于 `cordis` 创建会话，不能移作创建助手证据。

### 当前工作树 Implementation Review（实现检查）

- 首轮用途提交通过 Harness 原生 Session API 创建 `agentPreset=cordis` 的真实 Session；后续调整复用同一个创建 Session，不复制 `cordis`，也不把它作为最终个人或业务智能体的运行底座。
- 每轮请求携带当前说明书、用户本轮输入和真实已安装 Skill 清单。模型可以只返回澄清问题；信息足够时才附带一个结构化 Proposal（提案）。
- UI 从原生 Session 的 Partial Blocks（部分输出块）读取并展示可见流式文本，结构化提案标签之后的内容不会作为流式正文展示，也不向用户暴露隐藏推理。
- Runtime（运行时）只读取本轮基线序号之后的原生事件；仅当出现 `turn/end` 且 `reason.kind=completed`，并能读取非空 `assistant/message` 时，才接纳本轮回复。失败、非正常结束和超时都进入真实错误状态。
- 提案只允许业务分类、名称、用途、角色、目标、行为规范、补充要求和会话技能字段；未知字段不会进入草稿，技能名称会再次限制为真实已安装清单，基础 Preset、产品类型、身份、版本、存储和权限不能由模型改变。
- 提案可以在左侧表单预览，但进入 Pending Confirmation（待确认）状态后，用户必须选择“保留更新”或“撤销”；处理前配置输入与保存按钮均不可用。运行配置只在最终保存时写入，模型回复本身不复制 Preset、不保存 Profile。
- 当前自动化测试对原生 Session 创建、多轮复用、`completed` 门禁和提案字段过滤使用模拟事件，属于代码契约证据，不是本轮真实模型 Browser E2E。

### 本轮真实模型 Browser E2E（浏览器端到端）待验证

- [ ] 首轮用途提交创建新的原生 `cordis` Session，原生事件可核对真实模型路由、用户输入、助手可见回复及 `turn/end reason=completed`。
- [ ] 使用旧前端规则无法解析的真实业务描述完成首轮生成；页面先显示思考/流式文本，完成后才出现待确认提案。
- [ ] 至少追加一轮补充要求；两轮复用同一个创建 Session，第二轮回复体现第一轮上下文。
- [ ] 对同一提案分别验证“撤销”和“保留更新”；未处理提案时不能继续发送、不能保存，撤销后恢复上一版草稿。
- [ ] 模型失败或非正常结束时保留用户草稿，不出现伪造的“助手已更新”，也不回退到本地规则生成。
- [ ] 保存后再运行测试对话；创建 Session 使用 `cordis`，测试 Session 使用刚保存的目标 `presetId + configVersion`，两者职责和事件证据明确分离。

## 2026-08-21 原生 Shell 与统一 Builder Local Pre-Acceptance

### 已完成的 Implementation Review（实现检查）

- 当前工作树通过 `@paimind/harness-compat` 将智能体中心安装到 Harness 原生对话中央列；中心交互为 Non-modal（非模态），关闭后精确恢复宿主内容。
- 创建、编辑和主对话 `@cordis` 请求汇入同一 Builder；Builder 包含智能体说明书、配置对话、折叠式会话技能和测试对话。
- Host Contract（宿主契约）拒绝 `agentId`、`presetId` 或基础 Preset 身份漂移；测试对话创建或复用真实空白 Session，并选择同一保存 Preset。
- 以下 Implementation Review（实现检查）与 Browser E2E 分别记录代码契约和本地运行事实；两者都不替代共享测试环境 Product Acceptance（产品验收）。

### 历史 Shell 与界面 Browser E2E（浏览器端到端）

- [x] Sidebar 展开与收起：智能体中心/Builder 均只占中央列，Logo 完整，左右边界对称，无产品自有返回栏。
- [撤回 AI 结论] 创建与编辑两条入口进入同一 Builder、字段同步、撤回和确认曾在浏览器中出现，但字段同步来自旧前端本地规则，不是模型生成。Skill 展开后 8 个真实名称与说明完整可读的界面事实仍保留。
- [x] 未保存门禁：新建和编辑产生未保存变更时，测试对话显示“请先保存智能体配置”，未产生临时 Preset。
- [x] 同 Preset 测试：`presetId=0821-074942`、`configVersion=v1-a07a37d8a3d77343`、`sessionId=session-62fc6434-c28f-401f-b18b-7e47d138fc73`；Session 事件记录 `agent-preset/selected=0821-074942`，完整 Harness 对话展示真实首轮回复并显示“真实首轮验证通过”。
- [x] `@` 入口界面：主对话同时展示 Agent 与 Skill；选择“个人智能体创建助手”后原生模式变为 `cordis` 的“创造模式”，并自然展开同一用途优先 Builder，未创建第二套实体。本项只证明入口与模式切换，不证明 Builder 已发起模型请求。
- [x] 响应式与可访问性：`1486×1059`、`900×720`、`390×844` 检查通过；窄屏先显示配置/测试对话再显示说明书，焦点未再滚动外层 Center，Console 仅有重启期间既有连接信息，无本轮新增运行错误。

视觉与响应式对照详见 [`agent-center-design-qa-2026-08-21.md`](agent-center-design-qa-2026-08-21.md)。本节是本地 Pre-Acceptance（预验收），不替代共享测试环境 Product Acceptance（产品验收）。

### Shared Environment（共享测试环境）待办

- [ ] 在共享测试环境按上述 Browser E2E 清单重跑；只有共享环境证据可以把本轮状态升级为 Product Acceptance。

## 2026-08-21 两阶段创建 Local Pre-Acceptance（历史交互）

本节保留本轮原生 Shell 重构前的浏览器事实，不代表当前统一 Builder 的验收结论；当前交互以“原生 Shell 与统一 Builder Local Pre-Acceptance”待回填清单为准。

- 真实 `http://127.0.0.1:3080/` 已验证“创建个人智能体”先打开名称与基础运行模式弹窗，继续后进入左侧可编辑配置、右侧配置对话的 Builder。
- 输入“角色是产品交互验收助手，目标是检查交互并输出证据，专业且有证据，并使用 openai-docs。”后，角色、目标、描述、行为规范、补充要求和 `openai-docs` 会话技能曾同步到左侧并展示字段回执；该同步由当时的前端本地规则完成，不是模型生成，仅作为历史交互观察保留，已从真实 AI 证据中撤回。
- 本轮浏览器检查只使用临时草稿并取消，没有保存新的 Harness Preset；正式 Product Acceptance 仍以共享测试环境为准。

## 真实验收证据

- 创建个人智能体“验收助手”，Harness Preset 为 `my-agent-1a0cca`；业务页面未展示该内部标识。
- 第一版配置 `v1-b0bbd374ea9c770b` 在真实 Session `session-4ce99918-2181-4a74-8e4c-73b38178ef19` 中完成模型回复，回复遵循 `AGENT_ACCEPTED` 前缀和两行结构。
- 修改行为规范后生成第二版配置 `v2-707e080f810b45df`；新 Session `session-c924e8eb-fefb-423a-b4c1-05663d517d10` 在首轮前绑定同一 Preset，并由真实 DeepSeek 模型返回 `AGENT_V2_ACCEPTED`。
- 旧 Session 自动迁移到 `session-ddc1d13a-f3b6-4277-b83a-ffe6fb1ff381`；迁移记录包含旧/新版本、可见摘要和原会话引用，首轮 Verification 为 `passed`。
- 验证器按首个用户消息前的原生 `agent-preset/selected` 事件计算实际 Preset，避免把 Session 创建时的默认头字段误判为运行 Preset；同一首轮记录会去重。
- 窄屏检查中智能体区域 `scrollWidth` 与可见宽度均为 `564px`，没有模块内横向溢出。

## RQ-106 本轮验收记录

- Settings（设置）中不再出现“智能体中心”和“技能中心”产品入口；Agent 构建器入口为 0，原生 Agent Presets 导航默认不可见，“高级配置”可正常激活原生内容页。
- 平台智能体真实显示标准、PTC、极简、创造四张卡片；创造模式来源为 Harness 原生 `cordis`。
- 创建并保留个人智能体“官方技能验证助手”，内部 Preset 为 `my-agent-80ef93`，配置版本为 `v1-d14a0c9b0ffd7234`；这些内部字段未出现在业务页面。
- 真实会话 `session-5eaedc3a-d049-4259-ae1f-6fe480c98f95` 绑定该 Preset，并分别产生 `Skill openai-docs`、`Skill skill-creator`、`Skill skill-installer` 原生调用事件和模型答复。
- 首轮验证器曾把仅含工具调用的 Assistant Step 误判为最终回复，留下一个修复前 `failed` 记录；修复后会等待运行稳定，并选择第二个用户消息前最后一个可见 Assistant Reply。
- 修复后新建真实会话 `session-b8404ca8-e959-4692-b6c9-d8d8900aa2d6`；绑定 Preset 与配置版本一致，最终首轮事件为 `event:294`，持久化 Verification 为 `passed`。
- 2026-08-16 回归从顶部 `PTC 模式` 进入智能体中心并启动 `标准模式`；设置关闭后顶部原生选择器稳定显示 `标准模式` 超过 3.2 秒，中性问题已预填，未再被默认 Preset 回写覆盖。
- 当前设置内容区实际宽度为 `556px`，`clientWidth = scrollWidth = 556px`，没有模块内横向溢出。

## 2026-08-17 会话技能隔离验收

- 技能中心真实显示 `8` 个已安装 Skill；“官方技能验证助手”的编辑面板显示 `已封装 3 / 已安装 8`。
- 选择器展示通用、调研与知识、数据分析、内容与演示、产品与 PDM、工程研发、智能体工具七个业务分类，并提供搜索和“只看已选”。
- 个人 Preset `my-agent-80ef93` 的原生 `skill-filesystem` 配置使用 `providerName: paimind-agent-scope`、`includeDefaultRoots: false` 和该智能体专属 Skill Root；Root 中只有 `openai-docs`、`skill-creator`、`skill-installer` 三个到真实安装目录的链接。
- 真实 Session `session-aa4f92f8-37b8-4e47-8e58-208162b29d55` 绑定“官方技能验证助手”并完成模型回复；展开原生 `上下文注入 skill-catalog` 后只显示上述三个 Skill。
- 同一 Session 持久化记录中，`bento-ppt`、`ppt-master`、`fineline-investment-analysis`、`white-space-analysis`、`build-walmart-buyer-proposal-outline` 均为 `0` 次，证明其虽可在技能中心发现，但未泄漏进该会话。
- 定向测试为 `3` 个文件、`21` 项全部通过；全仓测试为 `73` 个文件、`274` 项全部通过，目标包 Type Check、Production Build、Framework Gate、Package Pack、Publint、NodeNext Consumer、Examples 和文档检查均通过。
- Disposable Harness Home 组合验证覆盖双中心同时安装、仅技能中心、仅智能体中心、全部卸载后原生启动，结果为 Harness `0.1.0-rc.6`、零上游源码差异。
- `check:release` 已执行并在 API Snapshot 阶段停止；本次三个目标包已无接口快照漂移，剩余 `27` 项均来自当前 Dirty Worktree 的其他包，未在本任务中批量覆盖。

## 2026-08-17 平台目录扩展性验收

- 删除“分类不等于模式”及通用、PDM、AIM 的解释文案；真实页面未再出现对应文本。
- 平台目录只保留“平台模式 / 业务智能体”两个固定入口；当前真实数据为平台模式 `4`、业务智能体 `0`。
- 没有真实业务智能体时不显示业务分类控件；后续分类选项只从绑定真实 Preset 的官方产品元数据动态生成，并集中在单个下拉框中。
- 目录投影单元测试覆盖 `48` 个并列业务分类，分类 ID 无重复且计数稳定；分类数量不增加页面固定入口数量。
- `640 × 900` 视口下，全页 `clientWidth = scrollWidth = 640px`，目录区域 `clientWidth = scrollWidth = 582px`，无横向溢出。
- 全仓 `73` 个测试文件、`276` 项测试通过；Production Build、Framework Gate 与 Harness `0.1.0-rc.6` 独立安装/卸载组合验证通过。

## 2026-08-17 业务智能体创建链路验收

- “业务智能体”目录的页面主操作和目录标题区均提供“创建业务智能体”；“我的智能体”使用独立的“创建个人智能体”，不会再把两类对象写入同一默认目录。
- 创建面板显示必填业务分类，支持选择已存在分类或直接输入新分类；分类和产品归属通过 Agent Builder 的严格 Remote Contract 跨进程传输，并写入同一真实 Harness Preset 目录的 `.paimind-agent.json`。
- 真实 `http://localhost:3080/` 中创建“E2E 业务智能体验证”后，业务目录计数由 `0` 变为 `1`，分类筛选出现 `PDM 验证 · 1`，卡片显示“业务智能体 · 本地维护”；编辑面板重新读取相同名称、分类、角色和目标。
- 验收发现并修复了 Remote Schema 未声明新字段导致 `productKind` 被剥离的问题；新增严格序列化测试防止该问题回归。
- 浏览器中通过真实删除操作移除验收智能体，随后清理其隔离备份；最终业务目录恢复为 `0`，用户原有个人智能体保持不变。
- 定向测试为 `3` 个文件、`25` 项通过；全仓测试为 `73` 个文件、`279` 项通过；全仓 Type Check、Production Build、Package Compliance、Pack Audit、Publint、NodeNext Consumer、Examples、Framework、Docs 与 Harness `0.1.0-rc.6` 安装/卸载组合验证通过。
- Agent Builder 与 Agent Market 的 API Snapshot 已同步到本次真实公共契约；全仓 `check:api` 剩余 `27` 项均为 Dirty Worktree 中其他包的既有差异，未越界批量覆盖。
