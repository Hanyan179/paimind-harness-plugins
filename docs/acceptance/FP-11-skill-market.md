# FP11 技能市场验收

## 当前状态

历史版本为 `Product E2E Verified`，验收日期为 2026-08-15。2026-08-20 Skill Center 升级已完成 `Local Pre-Acceptance`；共享测试环境重新验收仍单列为待办。当前规范为 [`../product/RQ-105-skill-market-prd.md`](../product/RQ-105-skill-market-prd.md)。历史只读目录验收已被可安装技能市场替代。

## 验收入口

- URL：`http://127.0.0.1:3080/`
- 入口：Shell 侧栏底部 `Skill Center`
- 真实调用：当前 Harness 对话中的 `/${name}`

## 必须通过

1. 页面使用唯一的 `Catalog / Installed / Favorites` Scope，不保留重复 Tab；目录不依赖当前对话，当前对话可用性只作为 Harness Runtime 状态投影。
2. 推荐技能和本地导入共用内容检查、风险确认、临时目录、原子安装、回滚与卸载链路。
3. 大文件通过原始字节流上传，不使用 `contentBase64`，不设置虚假固定大小或文件数上限。
4. 路径穿越、绝对路径、符号链接越界、加密包和异常压缩比被拒绝；脚本只提示不执行。
5. 同名更新原子替换，失败恢复旧版本；卸载保留可恢复备份。
6. 安装后无需重启即可由 Harness 原生文件系统发现，并在真实会话调用。
7. 页面不显示内部运行 ID、磁盘路径、摘要哈希和不可用版本占位。
8. 通过类型检查、构建、插件隔离以及桌面/受限宽度浏览器检查。
9. 点击“导入本地 Skill”必须先展示导入说明，不直接打开文件选择器；说明覆盖可选 `SKILL.md` / ZIP、必需 YAML Frontmatter、ZIP 根目录结构、可选资源目录、凭证风险、个人范围和 Harness 原生发现与执行边界。用户再次点击“选择 Skill 包”后才打开文件选择器。

## 2026-08-21 导入说明 Local Pre-Acceptance

- 真实 `http://127.0.0.1:3080/` 已验证“导入本地 Skill”先打开结构说明弹窗，文件选择器没有在第一次点击时触发。
- 弹窗完整说明 `SKILL.md` 与 ZIP 两类输入、`name` / `description` Frontmatter、根目录 `SKILL.md`、可选 `scripts/`、`references/`、`assets/`、禁止凭证和个人安装范围。
- 本轮未选择文件、未导入或更新任何 Skill；正式 Product Acceptance 仍以共享测试环境为准。

## 2026-08-20 Local Pre-Acceptance

- 真实 `.dsh-home` 完成 `paimind-skill-center-e2e` 的 V1 `SKILL.md` 流式导入与安装；不重启 Harness，Skill Center 已显示 `Available now`。
- 点击“Use in conversation”后，当前 Composer 真实写入 `/paimind-skill-center-e2e `；未建立 PAIMind 执行入口。
- 同名 V2 更新被识别为 `update`，使用新的 Digest 完成原子替换；V1 内容保存在 `.dsh-home/.paimind-skill-installer/backups/paimind-skill-center-e2e-*`。
- 定向 Installer 测试覆盖真实流式安装、同名原子更新、摘要校验和可恢复卸载；本轮真实可恢复卸载后活动安装投影从 9 项回到 8 项，V1/V2 证据均保留在备份区。
- Installer UI 明确展示文件数、解压大小、运行环境风险、原子更新回退说明；卸载 UI 明确说明 Harness 发现目录、备份位置语义和对话历史不删除。
- Keyboard QA 覆盖单一 Scope 的 Roving Tab、Modal 初始焦点、Tab Focus Trap、Escape 关闭、可见 `focus-visible`；移动端触控目标不小于 44px。
- 浏览器完成 Light、Dark、System、1512×982、1280×720、900×720、390×844、安装/更新确认、已安装详情、Slash Draft、卸载确认和 Console 检查；四种宽度均无页面级横向溢出。截图保存在 `/Users/hansen/.codex/visualizations/2026/08/20/01a01f0b-1734-7710-806a-259295d9a495/skill-center-audit/`。
- `@paimind/skill-market` 定向类型检查与 22 项测试通过；最终串行 Shared Gates 完成全仓 `78` 个测试文件 / `309` 项测试、Build、Package、33 项 Pack、Strict Publint、`101` 项 NodeNext Export、Examples、Framework、`91` 个 Markdown 文档、Agent/Skill Center 隔离和真实 Harness Composition，全部通过。聚合 `check:api` 已验证 `33` 个 Package Contract；API Snapshot SHA-256 为 `b0afe007e09700ad2bdb7d582aa1d7b9d6c7dba44d53b34a7be76150027b168a`，Shared Build Hash 为 `81dfea4f527e21e30feda5f8b74982325e31f30e8378e031aca9ba37a666179d`。本节仍保持 `Local Pre-Acceptance`，不替代共享测试环境的 Product Acceptance。
- 共享测试环境仍需按本节流程重新执行，只有共享环境结果可升级为新的 Product Acceptance。

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
