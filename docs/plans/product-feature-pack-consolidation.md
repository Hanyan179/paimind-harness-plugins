# PAIMind Product Feature Pack Consolidation Plan

## 1. Decision

PAIMind 对用户交付的最小单位从 Technical Package（技术包）调整为
Product Feature Pack（产品功能包）。

- 用户看到六个功能包，不再面对 30 个 PAIMind Runtime Package（运行包）。
- 一个功能包拥有一个总开关、一个产品结果、一组依赖规则和一套端到端验收。
- 内部 Package（包）继续独立构建、测试、故障隔离和版本审计，不物理合并为单个巨型代码包。
- Extension Center（扩展中心）是始终在线的 Control Plane（控制面），不属于任何可关闭功能包。
- 少量具有独立用户价值的 Capability（能力）可以保留子开关。第一项是产品体验中的动态状态球。

这意味着“主插件”是 Harness Loader（加载器）中的 Product Composition Group（产品组合组），
不是把全部源码、状态和依赖重新耦合进一个 NPM Package（包）。

## 2. Product Pack Map

| Product Feature Pack（产品功能包） | 用户结果 | 内部 Runtime Package（运行包） | Dependency（依赖） |
| --- | --- | ---: | --- |
| 产品体验 | Paramont 品牌、视觉、动态状态、个性化 | 4 | 无 |
| 智能体中心 | 业务智能体发现、创建与技能能力 | 3 | 无 |
| 内容与交付物 | 产物、网页/Office 生成、预览与对话交付 | 9 | 无 |
| 提案与演示 | 类目分析、事实约束、Bento、追踪与零售商提案 | 6 | 内容与交付物 |
| 自动化 | 通知、定时执行、Harness/HTTP/飞书交付 | 6 | 内容与交付物 |
| 工作运营 | 任务摘要与开发诊断 | 2 | 内容与交付物 |

Extension Center（扩展中心）作为第 31 个 Runtime Package（运行包）常驻，管理上述六组。
Contracts（契约）、SDK（软件开发工具包）、Testkit（测试工具）等 Support Package（支持包）
不进入用户开关清单。

## 3. Configuration Model

### 3.1 Pack Switch（功能包开关）

- 开启功能包时，系统先开启它依赖的功能包。
- 关闭基础功能包时，系统同步关闭依赖它的功能包，避免留下半运行组合。
- Loader（加载器）负责真实挂载、卸载与恢复；Extension Center（扩展中心）不维护第二套运行状态。
- 用户选择保存在 Harness Settings（设置）中，默认全部开启，以保持现有行为。

### 3.2 Capability Switch（能力开关）

- 子开关只用于用户能理解、且关闭后不会破坏同包主要结果的能力。
- 动态状态球使用独立 Loader Group（加载组），Runtime Entry（运行入口）独立启停；
  一次性 Invariant Registration（不变式注册）保留在始终在线的治理组，避免恢复时重复注册。
- Adapter（适配器）、Contract（契约）和内部 Renderer（渲染器）默认不暴露为用户开关。

### 3.3 Failure and Rollback（失败与回滚）

- Loader 更新失败时不写入 Settings（设置）。
- Settings 写入失败时恢复更新前的 Loader 状态。
- 旧组合中找不到功能包 Group（组）时显示“待应用新组合”，不伪造成功。
- Extension Center（扩展中心）不提供安装、卸载或版本升级，这些动作仍属于 Harness Plugin Registry（插件注册表）。

## 4. Delivery Phases

### Phase 1 — Composition Baseline（组合基线，当前实施）

- [x] 定义六个 Product Feature Pack（产品功能包）及稳定 Entry ID（入口标识）。
- [x] 将 Bundle（组合包）从平铺 Entry（入口）迁移到六个 `cordis:group`。
- [x] 将 Extension Center（扩展中心）保留在所有可关闭组之外。
- [x] 为动态状态球增加第一个 Capability Group（能力组）。
- [x] 建立 Loader Group（加载组）开关与 Harness Settings（设置）持久化契约。
- [x] 完成定向测试与隔离 Runtime（运行环境）验收。

### Phase 2 — Product-first UI（产品优先界面）

- [x] Extension Center（扩展中心）首屏展示六个功能包及真实开关。
- [x] 技术 Package（包）降级为诊断明细，不再作为首要产品层级。
- [x] 补充依赖联动说明、错误反馈与 Client Module Reload（客户端模块重载）。
- [x] 验证关闭、刷新、进程重启后状态一致。

### Phase 3 — Package Reduction Review（代码包缩减评审）

只有同时满足以下条件，才物理合并内部 Package（包）：

1. 相同 Product Owner（产品所有者）与 Release Cadence（发布节奏）。
2. 相同 Runtime Lifecycle（运行生命周期），不存在独立启停需求。
3. 相同 Failure Boundary（故障边界），合并不会扩大故障影响。
4. 没有独立 External Consumer（外部消费者）。
5. 合并后依赖边减少，且测试和构建边界仍清晰。

Scheduler Adapter（调度适配器）、Harness Compatibility（兼容层）、Contract（契约）、
Renderer（渲染器）等仍满足独立边界价值，当前只隐藏其产品层曝光，不立即物理合并。

### Phase 4 — Open-source Readiness（开源准备）

- 将六个功能包作为 Marketplace（插件市场）的安装和说明单位。
- 公布产品包到内部 Package（包）的 Machine-readable Map（机器可读映射）。
- 提供最小/完整 Profile Example（配置示例）和升级迁移说明。
- 将企业身份、权限、组织分配等能力留在独立 Enterprise Provider（企业提供方）边界，
  不混入本次通用开源功能包。
- 开源前完成 License（许可证）、Secret Scan（密钥扫描）、第三方依赖许可证与可复现构建检查。

## 5. Acceptance Criteria

1. Extension Center（扩展中心）始终可打开，并只显示六个一级产品功能包。
2. 关闭任一功能包后，其所有 Runtime Child Entry（运行子入口）都被 Cordis 卸载；
   Package Invariant（包不变式）留在始终在线的治理组并保持单次注册。
3. 重新开启后，同组 Host Runtime（宿主运行时）恢复，浏览器自动重新加载活动 Client Module（客户端模块），
   且不需要重新安装或重启 Harness 进程。
4. 单独关闭动态状态球后，品牌、视觉与个性化继续工作。
5. 关闭内容与交付物后，提案与演示、自动化、工作运营同步关闭；重新开启依赖包时顺序正确。
6. 刷新页面和重启隔离 Runtime（运行环境）后，Harness Settings（设置）中的选择仍生效。
7. 任一 Pack（功能包）加载失败不影响原生 Conversation（对话）和 Extension Center（扩展中心）。
8. Native Plugin Inventory（原生插件清单）仍显示真实技术 Entry（入口），产品界面不伪造安装、版本或健康状态。
9. Bundle（组合包）移除后恢复原生 Harness，DeepSeek Harness 上游 Worktree（工作区）保持零改动。

## 6. Verification Result

Source Contract（源码契约）、Type Check（类型检查）、Unit Test（单元测试）、Bundle Structure Check（组合结构检查）
与真实 Browser Acceptance（浏览器验收）均在隔离 Profile（配置）中执行。六个功能包、内容依赖级联、
动态状态球子开关、Client Module Reload（客户端模块重载）与 Harness 进程重启后的 Settings Persistence（设置持久化）
均已验证；证据记录在 [`../acceptance/R12-product-feature-packs.md`](../acceptance/R12-product-feature-packs.md)。
共享 `3080` 与仓库 `.dsh-home` Runtime（运行环境）未重启、未安装且未改写。
