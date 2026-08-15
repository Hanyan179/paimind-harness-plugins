# FP09 智能体中心验收

## 当前状态

`Product E2E Verified`，验收日期为 2026-08-15。当前规范为 [`../product/RQ-106-agent-center-prd.md`](../product/RQ-106-agent-center-prd.md)。历史只读目录验收已被“平台智能体 + 我的智能体 + 真实会话验证”替代。

## 验收入口

- URL：`http://127.0.0.1:3080/`
- 入口：`设置 → 智能体中心`
- 高级入口：`智能体中心 → 高级配置` 打开 Harness 原生 `Agent Presets`

## 必须通过

1. 智能体相关业务入口只有“智能体中心”；没有独立 Agent 构建器页面，原生 Agent Presets 导航默认隐藏。
2. “高级配置”仍能打开原生 Agent Presets；兼容层失配时 Fail Open，卸载时恢复原生导航。
3. 平台智能体包含标准、PTC、极简、创造四种模式；创造模式不进入个人智能体的基础模板。
4. 业务表单只有名称、描述、基础能力模板、角色、目标、行为规范、首选已安装技能和补充要求；极简模式禁用并清空技能选择。
5. 创建后重新读取 Harness 真实 Preset；损坏时不标记成功。
6. `开始对话` 创建真实空白 Session，并在首轮前绑定目标 Preset 和配置版本。
7. 发送中性问题，回复真实体现角色与行为；首轮验证记录为 Passed。
8. 修改后新对话使用新版本；打开旧对话会迁移到新版并显示可见摘要。
9. 页面不出现 Preset ID、配置哈希、文件路径和会话 ID。
10. 通过类型检查、构建、插件隔离以及桌面/受限宽度浏览器检查。

## 真实验收证据

- 创建个人智能体“验收助手”，Harness Preset 为 `my-agent-1a0cca`；业务页面未展示该内部标识。
- 第一版配置 `v1-b0bbd374ea9c770b` 在真实 Session `session-4ce99918-2181-4a74-8e4c-73b38178ef19` 中完成模型回复，回复遵循 `AGENT_ACCEPTED` 前缀和两行结构。
- 修改行为规范后生成第二版配置 `v2-707e080f810b45df`；新 Session `session-c924e8eb-fefb-423a-b4c1-05663d517d10` 在首轮前绑定同一 Preset，并由真实 DeepSeek 模型返回 `AGENT_V2_ACCEPTED`。
- 旧 Session 自动迁移到 `session-ddc1d13a-f3b6-4277-b83a-ffe6fb1ff381`；迁移记录包含旧/新版本、可见摘要和原会话引用，首轮 Verification 为 `passed`。
- 验证器按首个用户消息前的原生 `agent-preset/selected` 事件计算实际 Preset，避免把 Session 创建时的默认头字段误判为运行 Preset；同一首轮记录会去重。
- 窄屏检查中智能体区域 `scrollWidth` 与可见宽度均为 `564px`，没有模块内横向溢出。

## RQ-106 本轮验收记录

- 设置中只显示“智能体中心”和独立“技能市场”；Agent 构建器入口为 0，原生 Agent Presets 导航不可见，“高级配置”可正常激活原生内容页。
- 平台智能体真实显示标准、PTC、极简、创造四张卡片；创造模式来源为 Harness 原生 `cordis`。
- 创建并保留个人智能体“官方技能验证助手”，内部 Preset 为 `my-agent-80ef93`，配置版本为 `v1-d14a0c9b0ffd7234`；这些内部字段未出现在业务页面。
- 真实会话 `session-5eaedc3a-d049-4259-ae1f-6fe480c98f95` 绑定该 Preset，并分别产生 `Skill openai-docs`、`Skill skill-creator`、`Skill skill-installer` 原生调用事件和模型答复。
- 首轮验证器曾把仅含工具调用的 Assistant Step 误判为最终回复，留下一个修复前 `failed` 记录；修复后会等待运行稳定，并选择第二个用户消息前最后一个可见 Assistant Reply。
- 修复后新建真实会话 `session-b8404ca8-e959-4692-b6c9-d8d8900aa2d6`；绑定 Preset 与配置版本一致，最终首轮事件为 `event:294`，持久化 Verification 为 `passed`。
- 当前设置内容区实际宽度为 `556px`，`clientWidth = scrollWidth = 556px`，没有模块内横向溢出。
