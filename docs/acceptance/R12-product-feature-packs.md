# R12 — Product Feature Packs

## Decision

PAIMind 的用户交付与启停单位已经从 30 个 Runtime Package（运行包）重组为六个
Product Feature Pack（产品功能包）。代码包仍保持独立构建、测试、故障隔离和卸载恢复；
没有把实现物理合并成一个巨型 Package（包）。

Extension Center（扩展中心）与 Package Invariant Governance（包不变式治理）始终在线。
功能包开关只控制产品 Runtime Entry（运行入口），Harness Plugin Registry（插件注册表）
继续拥有安装、卸载、版本与技术状态事实。

## Composition under test

| Product Feature Pack（产品功能包） | Runtime Package（运行包） | Required Pack（前置功能包） |
| --- | ---: | --- |
| 产品体验 | 4 | 无 |
| 智能体中心 | 3 | 无 |
| 内容与交付物 | 9 | 无 |
| 提案与演示 | 6 | 内容与交付物 |
| 自动化 | 6 | 内容与交付物 |
| 工作运营 | 2 | 内容与交付物 |

产品体验包含首个独立 Capability Switch（能力开关）`paimind:capability:runtime-orbs`。
Extension Center（扩展中心）作为第 31 个 Runtime Package（运行包）位于全部可关闭组之外。

## Isolated runtime

- Date（日期）：2026-08-27
- Harness Version（Harness 版本）：`0.1.1-rc.2`
- Node.js Version（Node.js 版本）：`24.19.0`
- Profile（配置）：临时 `DSH_HOME`，端口 `56190`，以 `--no-open` 启动
- Browser（浏览器）：Codex In-app Browser（Codex 内置浏览器）
- Shared Runtime Boundary（共享运行环境边界）：未重启共享 `3080`，未安装、改写或清理仓库 `.dsh-home`

临时 Profile（配置）只链接当前工作区构建产物和现有 Harness 依赖，用于真实 Host、Settings、
Loader、Client Module Graph（客户端模块图）与页面交互验收；不含凭证，也不作为提交内容。

## Product acceptance evidence

| Scenario（场景） | Observed Result（观察结果） | Result（结论） |
| --- | --- | --- |
| 初始完整组合 | 六个功能包与动态状态球均为启用；技术明细 `20 / 20` 已加载、`0` 项需关注 | PASS |
| 包内能力关闭 | 动态状态球关闭，产品体验仍启用；页面重载后能力清单 `20 → 19` | PASS |
| 包内能力恢复 | 动态状态球恢复；页面重载后能力清单 `19 → 20` | PASS |
| 基础包级联关闭 | 关闭内容与交付物后，提案与演示、自动化、工作运营同时关闭 | PASS |
| 依赖自动补齐 | 从关闭状态启用自动化或提案包时，内容与交付物先自动启用 | PASS |
| 全包关闭/恢复循环 | 产品体验、智能体中心、内容、提案、自动化、运营均完成真实 Loader stop/restore 循环 | PASS |
| 控制面常驻 | 产品体验或智能体中心关闭期间，Extension Center 仍可打开并可执行恢复 | PASS |
| Client Module 同步 | 智能体中心关闭后页面自动重载，智能体与技能入口消失，能力清单 `20 → 18`；恢复后入口与 `20 / 20` 一并恢复 | PASS |
| Settings Persistence（设置持久化） | 关闭动态球及内容依赖链后重启 Harness 进程，所有关闭状态保持；最终恢复全开后再次重启，七个开关全部保持启用 | PASS |
| 最终浏览器状态 | 智能体、技能、通知入口可见；六包与动态球全开；技术明细 `20 / 20`，`0` 项需关注 | PASS |
| Browser Error（浏览器错误） | 最终重启后的验收时间窗没有新增 Error 或 Feature Pack mutation/reconciliation failure | PASS |

## Runtime defects found and closed

1. Nested Include ID（嵌套 Include 标识）：Loader 的运行时 Entry ID（入口标识）带父路径。
   Compatibility Adapter（兼容适配器）现在通过稳定逻辑 ID 定位唯一 Entry，并使用完整运行时 ID 更新。
2. Loader Boot Race（加载器启动竞态）：Root Include 并发创建分组时，早期 Settings reconciliation（设置协调）
   会与子 Entry 启动交错。Extension Center 现在等待 Entry construction quiet period（入口构建静默期）
   与 `loader.await()` 生命周期屏障。
3. Invariant Reload（不变式重载）：一次性包注册放在可切换组中会在恢复时重复注册。
   全部 Package Invariant（包不变式）已移入始终在线的治理组。
4. Host Remote Contract（宿主远程契约）：Feature Pack Remote（功能包远程接口）补齐 Typert Host face（Typert 宿主接口）
   与 Client dependency injection（客户端依赖注入），消除 `404` 和未声明 Remote（远程服务）访问。
5. Presentation Trace Recovery（演示追溯恢复）：Sidecar Route（侧车路由）注册改为显式 Cordis effect（Cordis 生命周期效果），
   关闭/恢复后不再产生重复路由。
6. Static Client Manifest（静态客户端清单）：Harness 的静态 Client Module（客户端模块）在页面启动时选定。
   成功开关后 Extension Center 自动重载浏览器应用，使 Host 状态与用户可见入口同步，不重启 Harness 进程。

## Verification gates

| Gate（门禁） | Evidence（证据） | Result（结论） |
| --- | --- | --- |
| Targeted Tests（定向测试） | 7 个测试文件、23 个测试；覆盖 Extension Center、Harness compatibility、Presentation Trace lifecycle | PASS |
| Targeted Type Check（定向类型检查） | 三个受影响 TypeScript project（TypeScript 项目） | PASS |
| API Snapshot（接口快照） | 38 个受保护包契约；只批准本次四个包的 10 项预期差异 | PASS |
| Package Compliance（包合规） | 38 个包，唯一身份、真实消费者、可达运行图和兼容版本 | PASS |
| Bundle Budget（组合预算） | 22 个 Client Package（客户端包）全部在预算内 | PASS |
| Framework Verification（框架验证） | 六个产品包、动态球子能力与 Registry/Loader ownership（注册表/加载器所有权） | PASS |
| Full Release Gate（完整发布门禁） | `pnpm run check:release`：90 个测试文件、410 个测试全部通过；38 包发布检查、构建、文档与真实 Harness 组合通过 | PASS |

## Integration boundary

本验收没有执行 Merge（合并）、Rebase（变基）、Cherry-pick（拣选提交）、Push（推送）或 Publish（发布）。
与企业 Worktree（企业工作树）的同名分叉文件只记录为后续 Integration Risk（集成风险）；
两个 Goal（目标）分别完成后，必须在第三个临时 Worktree（工作树）做 Conflict Simulation（冲突模拟）
和完整门禁，不能直接把任一分支覆盖到另一分支。
