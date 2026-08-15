# FP11 技能市场验收

## 当前状态

`Product E2E Verified`，验收日期为 2026-08-15。当前规范为 [`../product/RQ-105-skill-market-prd.md`](../product/RQ-105-skill-market-prd.md)。历史只读目录验收已被可安装技能市场替代。

## 验收入口

- URL：`http://127.0.0.1:3080/`
- 入口：`设置 → 技能市场`
- 真实调用：当前 Harness 对话中的 `/${name}`

## 必须通过

1. 页面分为“推荐技能”和“已安装”；推荐目录不依赖当前对话，当前对话可用性只作为状态标记。
2. 推荐技能和本地导入共用内容检查、风险确认、临时目录、原子安装、回滚与卸载链路。
3. 大文件通过原始字节流上传，不使用 `contentBase64`，不设置虚假固定大小或文件数上限。
4. 路径穿越、绝对路径、符号链接越界、加密包和异常压缩比被拒绝；脚本只提示不执行。
5. 同名更新原子替换，失败恢复旧版本；卸载保留可恢复备份。
6. 安装后无需重启即可由 Harness 原生文件系统发现，并在真实会话调用。
7. 页面不显示内部运行 ID、磁盘路径、摘要哈希和不可用版本占位。
8. 通过类型检查、构建、插件隔离以及桌面/受限宽度浏览器检查。

## 真实验收证据

- 通过设置页导入 `paimind-market-acceptance`，页面完成内容检查、风险确认和原子安装。
- 未重启 Harness 即在真实 Session 中调用 `/paimind-market-acceptance`；原生上下文记录包含 `skill-catalog` 和该 Skill，真实模型返回 `SKILL_MARKET_ACCEPTED`。
- 同名更新使用一个 `8,389,133` 字节、2 个文件的 ZIP，通过原始字节流上传；页面识别为“更新”并完成原子替换，没有 `contentBase64` 或固定产品上限。
- Host 集成测试真实执行流式安装、同名更新、摘要校验和可恢复卸载；安全测试拒绝 `..`、绝对路径和反斜线路径。
- 正式 Workspace 中遗留的三个 `e2e` Skill 已从活动目录移至可恢复证据目录，不再作为正式目录数据。
- 窄屏检查中技能市场区域 `scrollWidth` 与可见宽度均为 `564px`，没有模块内横向溢出。

## RQ-105 本轮验收记录

- 推荐目录真实包含 `openai-docs`、`skill-creator`、`skill-installer` 三个正式适配包；每个包均包含 `SKILL.md`、`LICENSE.txt` 和来源修改说明，并通过官方 Skill Validator。
- 三个包均标记为 `OpenAI Official · Adapted for Harness` 和 `Apache-2.0`；适配内容不包含 Codex 专属路径、工具名或绕过市场的安装逻辑。
- 从“推荐技能”逐个完成内容检查、用户确认和真实安装；切换到“已安装”可见三个安装结果，且无需重启即显示“当前对话可用”。
- Harness 活动目录存在三个真实安装结果；运行注册表仍是宿主文件系统，没有建立 PAIMind 第二套运行注册表。
- 真实会话分别产生 `Skill openai-docs`、`Skill skill-creator`、`Skill skill-installer` 调用事件；资料查询返回官方来源，技能创建返回最小包结构，技能安装返回平台安全导入流程。
- 当前设置内容区实际宽度为 `564px`，`clientWidth = scrollWidth = 564px`，没有模块内横向溢出。
