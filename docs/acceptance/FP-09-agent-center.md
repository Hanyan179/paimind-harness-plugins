# FP09 智能体中心验收

## 当前状态

`Product E2E Verified`，最近验收日期为 2026-08-17。当前规范为 [`../product/RQ-106-agent-center-prd.md`](../product/RQ-106-agent-center-prd.md)。历史只读目录验收已被“平台智能体 + 我的智能体 + 真实会话验证”替代。

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
14. 创建个人智能体先打开紧凑草稿弹窗，只收集名称和基础运行模式；继续后进入完整 Builder，并可通过右侧自然语言对话同步角色、目标、行为规范、补充要求和已安装会话技能。只有最终保存才创建真实 Harness Preset。

## 2026-08-21 两阶段创建 Local Pre-Acceptance

- 真实 `http://127.0.0.1:3080/` 已验证“创建个人智能体”先打开名称与基础运行模式弹窗，继续后进入左侧可编辑配置、右侧配置对话的 Builder。
- 输入“角色是产品交互验收助手，目标是检查交互并输出证据，专业且有证据，并使用 openai-docs。”后，角色、目标、描述、行为规范、补充要求和 `openai-docs` 会话技能同步到左侧，并展示字段回执。
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
