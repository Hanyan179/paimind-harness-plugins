# Agent Center Design QA（设计验收）｜2026-08-21

## Scope（范围）

- Surface（界面）：Agent Center（智能体中心）、Agent Builder（智能体创建与编辑）、Skill Center（技能中心）、主对话 `@` 选择器。
- Runtime（运行时）：本地 DeepSeek Harness `0.1.0-rc.8`，`http://127.0.0.1:3080/`。
- Reference（视觉参考）：用户选定的第二版 Agent Builder 桌面稿。
- Source of truth（事实来源）：Harness Agent Preset（智能体预设）继续作为唯一运行身份；PAIMind Profile（配置档案）只保存同目录业务投影。

## Visual comparison（视觉对照）

| 项目 | 结果 |
| --- | --- |
| Reference viewport（参考视口） | `1486 × 1059` |
| Implementation viewport（实现视口） | `1486 × 1059` |
| Reference image（参考图） | `/Users/hansen/.codex/generated_images/01a01fde-6e0a-7582-8201-1ee5a3a22c61/exec-8f59817f-51a2-4271-8573-221a48db0b77.png` |
| Final implementation（最终实现） | `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-21-agent-center-shell-refactor/18-builder-desktop-final.png` |
| Side-by-side comparison（并排对照） | `/Users/hansen/Documents/PAIMind-workspace/codex-output/design-audit/2026-08-21-agent-center-shell-refactor/19-target-vs-final.png` |
| Responsive evidence（响应式证据） | `16-builder-900x720-final.png`、`17-builder-390x844.png`，与上述最终实现位于同一外部证据目录 |

截图保存在仓库外，避免把本地浏览器证据提交进 Plugin Suite（插件套件）。

## Iterations（迭代记录）

1. 保留 Harness 原生左侧 Sidebar（侧边栏），移除插件自建全屏顶栏与返回入口；Agent/Skill Center 仅覆盖中央内容列。
2. 修正 PARAMONT HARNESS Wordmark（英文标识）收缩，避免 Logo（标志）折叠；统一中央列左右边界。
3. Builder（创建器）改成左侧说明书、右侧固定配置/测试对话；Skill（技能）默认折叠，按需展开完整名称与说明。
4. 创建与编辑复用同一 Builder；主对话 `@个人智能体创建助手` 进入同一用途优先弹窗；底层仍选择原生 `cordis` Preset（预设）。
5. 浏览器发现 Skill 展开后容器高度塌陷，修复 Grid（网格）高度与嵌套滚动后，8 个完整 Skill 名称可见。
6. 浏览器发现测试对话在视觉插件就绪后无法解析原生 Seat（选择器），改为 Capability Detection（能力识别）加 Late Binding（延迟绑定）；真实首轮通过。
7. `900 × 720` 验收发现 Builder 打开时焦点会滚动外层 Center（中心）并露出底层卡片；改为 `preventScroll` 并重置 Center scrollTop（滚动位置），复测完整覆盖通过。

## Final result（最终结果）

- Desktop（桌面端）：通过。原生 Sidebar 保留，主说明书与右侧对话主线清楚，Footer（底部操作栏）稳定。
- Responsive（响应式）：`900 × 720` 与 `390 × 844` 通过；窄屏先显示创建助手对话，再显示说明书。
- Progressive disclosure（渐进式披露）：通过。`@` 同时展示 Agent 与 Skill 完整名称/详情；Builder Skill 面板默认收起，展开后内容不截断。
- Import guidance（导入引导）：通过。先解释 `SKILL.md` / ZIP 结构、安全检查与个人范围，再允许选择文件，不直接打开无说明的文件选择器。
- Runtime conversation（真实运行对话）：通过。保存后的同一 `presetId=0821-074942`、`configVersion=v1-a07a37d8a3d77343` 创建 `session-62fc6434-c28f-401f-b18b-7e47d138fc73`，首轮可见回复完成。
- Formal acceptance（正式验收）：本文件记录本地 Browser E2E（浏览器端到端）预验收；共享测试环境验收仍按项目规范另行执行。
