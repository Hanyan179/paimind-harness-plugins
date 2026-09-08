# FP-17｜PAIMind 视觉体验插件

## 目标

在不修改 DeepSeek Harness、Better Sidebar 或业务插件源码的前提下，以可安装、可卸载、可升级和可回退的 `@hansen/visual-experience`，把 PAIMind 原型的干净留白、Paramont 海军蓝、低饱和蓝灰和轻玻璃质感带入真实 Harness，同时保留完整开发工作台能力。

完成标准分两层：本地真实组合与浏览器矩阵通过代表 Development Complete（开发完成）；共享测试环境完成安装、回退和领导视觉评审后，才代表 Product Accepted（产品验收完成）。

## 视觉原则

1. **密度先于装饰**：欢迎页保持 Calm Density（平静密度），活跃对话使用 Focus Density（专注密度），Better Sidebar 展开时使用 Workbench Density（工作台密度）。
2. **克制的高级感**：以海军蓝、暖白、蓝灰、清晰排版、透明材质和大面积留白建立层次；阴影只用于悬浮选择器和主输入区。
3. **图片不承载信息**：明暗山脊环境图只用于欢迎页与空状态；对话、Tool、审批、错误和安全提示页不展示装饰图片。
4. **动效服务状态**：短过渡采用共享 160–240ms 时长，持续状态动效保留语义；用户选择跟随系统、开启或关闭。跟随系统时响应 `prefers-reduced-motion`，显式选择优先。
5. **原生能力不缩水**：Agent、Session、Preset、Settings、侧栏开关和运行历史继续由 Harness 管理；插件只改变投影与交互呈现。

## 架构与所有权

| 能力 | Owner（所有者） | FP-17 做法 |
|---|---|---|
| Paramont 名称、标志、文档标题 | `@hansen/branding` | 继续独立负责；FP-17 只消费品牌语义座位。 |
| Light / Dark / System | Harness `theme` | 通过 `PaimindThemeService.overrideTokens` 叠加并可撤销。 |
| Agent Preset roster 与选择 | Harness | `HarnessAgentChoiceBridge` 读取并调用原生选择器，不创建影子 Agent。 |
| 页面根、侧栏、对话、输入区 | Harness | `HarnessExperienceMarkers` 只增加语义标记，不替换根节点。 |
| 视觉模式偏好 | Harness Settings | 命名空间 `paimind.visual-experience`，默认 `paimind`。 |
| 界面动效偏好 | FP-17 + Harness Settings | 同一命名空间中的 `motion`，默认 `system`；共享解析由 `@paimind/ui-foundation` 提供。 |
| 欢迎环境资产 | FP-17 | 两张优化 WebP；来源与用途见包内根级 `ASSETS.md`。 |
| Agent 头像投影 | FP-17 | 96×96 WebP；exact mapping 与纯函数 deterministic projection 共用一个 canonical-Preset resolver，来源见 `assets/ASSETS.md`。 |
| Composer `@` / `+` / `/` | Harness + `@hansen/harness-compat` | 原生 controller、codec、CAS、pick 与 execution 仍由 Harness 拥有；兼容层只做 rc.8 可逆语义桥接。 |

`paimind.visual-experience` 是产品与插件对外的 Logical Namespace（逻辑命名空间）。Harness `0.1.0-rc.8` 的原生 Settings 仅接受 lowercase kebab-case（小写短横线格式），因此 `@hansen/harness-compat` 在存储边界稳定映射为 `paimind-visual-experience`；插件代码、类型和验收仍以逻辑命名空间为准。

插件在 Bundle 中位于 `@hansen/branding` 之后、其他 PAIMind 产品页面之前。Harness 版本适配集中在 `@hansen/harness-compat`。

## 状态清单

### Experience Mode（体验模式）

- `paimind`：启用主题覆盖、`--paimind-*` 变量、语义标记、欢迎资产、Quick Agents 和紧凑 Preset 选择器。
- `native`：保留设置入口和插件说明；撤销主题层、语义呈现和单槽位占用，原生选择器自动恢复。
- Uninstall（卸载）：移除样式、主题覆盖、观察器、监听器、Portal、DOM 标记和所有槽位贡献。偏好可保留用于重装，但不影响卸载后的 Harness。

### Density（密度）

界面动效按[基座契约](../standards/ui-foundation.md)独立于视觉模式保存和生效。设置通过个性化页面的可选子插槽贡献；该页面缺席时回退到通用设置。来源卸载后清理临时投影，消费者跟随系统。2026-09-07 首版接线与边界见[本轮预验收](../acceptance/ui-foundation-v1-2026-09-07.md)。

- `calm`：新会话；展示欢迎环境、任务标题、主 Composer 与最多四个官方 Quick Agents。
- `focus`：活跃对话；隐藏欢迎装饰，压缩折叠 Tool 行，展开内容、错误、审批和安全提示保持完整。
- `workbench`：Better Sidebar 展开；隐藏环境图与说明，压缩标题和宽度，Quick Agents 最多两个，不改变面板偏好。

### Agent Choice（智能体选择）

- 数据成功：替换 `conversation.hero.agentPreset` 单槽位，分为“推荐 Agent / 平台模式”。
- 数据失败、空 roster 或原生控制不可解析：不注册替换项，保留 Harness 原生选择器。
- 桌面：双栏浮层，左侧名称、右侧焦点说明，最大高度 360px。
- 移动：Bottom Sheet（底部面板）。
- 键盘：Enter / Space 打开，方向键、Home、End 移动焦点，Enter 选择，Escape 关闭并恢复触发器焦点。
- Quick Agents：最多四个来自 Harness 原生 roster 的非故障推荐 Preset；900px 下两个、640px 下一个；“全部”打开 Agent Center。插件不复制、创建或持久化 Agent 身份。
- Avatar：内建、插件自有与冻结原型定义的稳定 id 使用 exact mapping；其他合法 canonical id 通过纯函数 hash 投影到发布 portrait pool。`paimind` 使用官方 Paramont 品牌头像；空/非法 id 才使用 fallback。Harness 将来若提供 native avatar metadata，则原生头像优先。

### Composer Trigger（输入触发器）

- PAIMind 模式 `@`：只展示 canonical Agent Preset 与 Harness native Skill；Agent 选择走原生 Preset seat，Skill 选择插入可执行 `/<skill> ` token。
- `@ Skill` 候选严格服从当前 canonical Preset 的原生 Session Skill capability：没有 packaged Session Skills 的 Agent 可以只显示 Agent；切换到具备 Skills 的 Agent 后，同一个菜单必须同时呈现 Agent 与该 Session 的真实 Skill，禁止填充固定数量或跨 Agent 伪造候选。
- PAIMind 模式 `+ Add context`：通过原 controller 打开原生 `reference` source，保留 File、Folder、Session、codec、CAS、undo 与 selection route。
- `/`：只保留 Harness 原生 command / mode / plan provider、顺序与执行；原生 Skill discovery 在 PAIMind 模式下从 `/` 隐藏并统一由 `@` 承载。
- 桌面候选菜单保持左侧紧凑列表、右侧只读详情；鼠标悬停或键盘焦点变化时，详情区展示完整类型、名称和说明，列表省略号不再承担信息披露。移动端按同一信息层级纵向堆叠。
- `+ Add context` 是独立点击入口；点击时先关闭正在显示的 `@` 或 `/` 候选，再打开原生上下文来源，不参与 Slash 键盘菜单。
- Native / Dispose：原 `reference` source identity、codec、候选函数、provider roster 与原生加号行为完整恢复；Presenter 释放后把 `candidate.icon` 文本 token 原样放回。

## 稳定契约

- `PaimindThemeService`
- `HarnessExperienceMarkers`
- `HarnessAgentChoiceBridge`
- `NativeHarnessInputTriggerBridge`（rc.8 compatibility boundary）
- `data-paimind-experience="paimind|native"`
- `data-paimind-density="calm|focus|workbench"`

不新增后端 API、业务持久化模型、运行时身份、Session 历史或权限体系。

## 业务验收

### 自动化门禁

- 默认启用、原生切换、刷新恢复、卸载复位、重新安装。
- 动效三态、系统偏好变化、失败回读、协作开关独立、来源缺席回退及样式／画布消费者共同生效。
- 主题覆盖注册、叠加、撤销。
- Agent 分类、选择、失败回退、原生 Session 绑定。
- `@` 在无 Session Skill 与有 Session Skill 的 canonical Preset 下分别验收；有 Skill 时选择结果必须通过原生 pick route 写入可执行 `/<skill> ` draft。
- 所有样式、监听器、观察器、Portal、槽位与标记的 Dispose（释放）。
- `harness-compat` API 快照、类型、构建、发布内容、依赖和 Bundle 可达性。

### 浏览器矩阵

- 视口：1512×982、1280×720、900×720、390×844。
- 主题：Light、Dark、System。
- 状态：新会话、选择器打开与键盘、活跃对话、长 Tool 流、审批/错误、Agent Center、Skill Center、Extension Center、Notifications、Task Monitor、User Settings、左右面板开关。
- 每个可逆状态保留 Before / After / Restored 证据；检查溢出、焦点、对比度、控制台与减少动态效果。

### 真实组合

- DeepSeek Harness `0.1.0-rc.8`。
- Better Sidebar `0.12.2`。
- 单插件与完整 Bundle 的安装、卸载、进程重启。
- 上游仓库零源码变更。

### 最终共享开发门禁（2026-08-20）

- 统一入口 `pnpm run check:fast` 通过，覆盖 forced Type Check、唯一最终 Root Build 与完整 Vitest `78 files / 309 tests`。
- package compliance、`33` 个 dry packs、strict publint、`101` 个 NodeNext exports、examples、`91` 个 Markdown 文档、framework verification 与 `git diff --check` 全部通过。
- API Snapshot `33` 个 package contracts 通过，SHA-256 为 `b0afe007e09700ad2bdb7d582aa1d7b9d6c7dba44d53b34a7be76150027b168a`；Shared Build Hash 为 `81dfea4f527e21e30feda5f8b74982325e31f30e8378e031aca9ba37a666179d`。
- Harness `0.1.0-rc.8` 双中心独立缺席 / Native restore 验证，以及 Harness + Better Sidebar `0.12.2` + Office Viewer `0.1.0` 完整安装、启动、移除、恢复和 Visual Experience 独立安装、移除与 cleanup 均通过；上游保持零源码变化。
- 最终真实 `1280×720` PAIMind 新会话未再使用 viewport override，保留 Calm density、Hero、四个 Quick Agents、四张 natural `96×96` 头像且 `overflowX=0`。这代表 Development Complete；Product Accepted 仍以共享测试环境验收为准。

## 边界与风险

- 单槽位替换只在原生 roster 与控制器成功解析后启用；失败时 fail-open（失败时保留原生）。
- `System` 主题继续由 Harness 解析操作系统偏好；FP-17 同时提供 Light 与 Dark token，不创建第四种主题。
- 生成资产是低透明度环境层，不得覆盖可点击控制、降低文字对比度或进入活跃工作流。
- 本地截图、测试与演示仅是开发证据；共享测试环境是唯一产品验收环境。
