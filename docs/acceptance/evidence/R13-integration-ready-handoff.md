# R13 Integration-ready Handoff

## Decision

PAIMind Product Feature Pack（产品功能包）重构的独立产品线已达到 Runtime Lifecycle `30 / 30 PASS`、Global Network Ledger `30 / 30 PASS`，完整 `pnpm run check:release` 通过。本文只表示 Product Worktree（产品工作树）可进入第三个独立 Integration Worktree（集成工作树）做联合冲突解析与联合 E2E，不授权在当前工作树执行 merge、rebase、cherry-pick、push、publish 或 deploy。

## Baseline and final state

- Product Worktree：`/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins`。
- Enterprise Worktree：`/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-enterprise-multiuser`；本任务仅做只读状态路径与 SHA-256 比较，没有读取其实现作为产品线解决方案，也没有写入。
- 双方 HEAD：`b8cf980f7eb0353c3daa20c032ae91bf6c1c9c79`，共同祖先一致。
- 本 Goal 第一次写入前保存的 Dirty Baseline 为 127 个 status entries，详见外部 `feature-pack-change-control.md` 的 `Source checkout status before first write`；当前未创建 Scoped Checkpoint Commit，因为无法证明它不会把既有 Dirty Baseline 的重叠 hunks 混入提交。
- 最终精确产品状态、字节数与 SHA-256 见 [`R13-product-changed-path-manifest.tsv`](R13-product-changed-path-manifest.tsv)。双方重叠、状态、字节数与 SHA-256 见 [`R13-enterprise-overlap-manifest.tsv`](R13-enterprise-overlap-manifest.tsv)。
- 最新最终交叉快照：Product `204`、Enterprise `333`、Overlap `140`；Identical `91`、Divergent `49`、Type / Missing Conflict `0`。Product Manifest 使用 `self-generated / SELF` 记录两个 Manifest 与本 Handoff，避免不可稳定的递归自哈希；其余 201 个路径均有真实字节数与 SHA-256。
- Product Manifest SHA-256：`11e55c4a9f9457c1fd3641a12b7ae2ea527e16df3712d9518af43e1dcf86976b`；Enterprise Overlap Manifest SHA-256：`a4bf6fd4dc1c5aae0da8e1360087059b59aec85f54d6cfea791bd01dc8e19bde`。

## Resume readback — 2026-08-29

- Resume Audit（恢复审计）确认当前 HEAD 仍为 `b8cf980f7eb0353c3daa20c032ae91bf6c1c9c79`，Runtime Lifecycle 为 `30 / 30 PASS`、Global Network Ledger 为 `30 / 30 PASS`、Final Gates 为 `9 / 9 PASS`，Open Evidence Gaps（开放证据缺口）为零。
- 写入前的 `204` 个 Product status paths（产品状态路径）与 Product Manifest 逐项一致：`0 missing / 0 extra / 0 hash mismatch`；本次仅修正 R13 页首过期状态并追加 Resume Readback，没有产品实现、运行契约或 Browser Evidence（浏览器证据）变更。更新后路径数仍为 `204`，Product Manifest 已同步刷新为上述 SHA-256。
- 按 Resume 指令没有重跑已有强证据的 Full Release Gate（全量发布门禁），也没有启动隔离 Runtime、Provider 或 Browser。共享 `192.168.103.226:3080` 只做只读 Listener 确认，未触碰仓库 `.dsh-home`。
- 本次没有读取企业实现作为产品解决方案，也没有重新计算企业线代码；最终交叉快照仍冻结为 Product `204`、Enterprise `333`、Overlap `140 = 91 identical + 49 divergent + 0 type conflict`。本次三项文档／Manifest 路径均不在 Enterprise Overlap Manifest 中，因此 49 行语义保留表与第三工作树 Integration Procedure（集成流程）不变。

## Product state to preserve

- Extension Center（扩展中心）始终在线，是六个 Product Feature Pack（产品功能包）和 Runtime Orbs Capability（运行状态球能力）的控制面；Registry（注册表）拥有安装／版本，Loader（加载器）拥有运行生命周期，Settings（设置）保存用户开关。
- 六包分别为 Product Experience、Agent Center、Content & Deliverables、Proposal & Presentation、Automation、Work Operations；包内技术模块仍独立测试、故障隔离、可卸载恢复。
- 真实开关必须支持依赖级联、并发 Revision Conflict（修订冲突）、写失败回滚、缺包诚实投影、健康包隔离、Refresh / Process Restart 持久化。
- 所有 Invariant（不变量）采用同步 disposer（释放器）契约；Extension Center 的 Module Import 诊断保持 Passive Observer（被动观察器），不得重新引入改变 Loader 调度语义的并发门控。
- 用户可见能力保持原生 Harness Workspace / Session / Agent / Skill / Job / Artifact 所有权；插件只做 Adapter / Projection / Renderer（适配／投影／渲染），不建立影子存储。

## Acceptance and gate evidence

- Requirement-to-E2E Matrix（需求到端到端矩阵）：[`R13-product-feature-packs-full-e2e.md`](../R13-product-feature-packs-full-e2e.md)。
- Browser Evidence Index（浏览器证据索引）：[`R13-browser-evidence-index.md`](R13-browser-evidence-index.md)。
- Runtime Entries：`30 / 30 PASS`，每项包含 IB / UX / HR / OD / FC / RC / RF / RS / AB 九轴和对应 Browser QA。
- Network Ledger：`30 / 30 PASS`；Fresh Browser 中 21 个声明 Client Entry 为 HTTP `200`、非空 Body 与 SHA-256，9 个 Host-only Entry 的不存在 Client Route 为 `404 / empty body`，并逐项绑定真实业务请求、失败与恢复证据。
- Targeted Tests：`13 files / 131 tests PASS`；Walmart Python Parity 定向 `1 file / 2 tests PASS`。
- Full Tests：`91 files / 437 tests PASS`。首次因收窄 PATH 导致 `spawn uv ENOENT` 的 2 个失败被保留为 Executor Attempt，补回 `/Users/hansen/.cargo/bin` 后定向与全量均通过。
- Type Check、Production Build、API Snapshot、Package Compliance、Pack Audit、Bundle Budget、Publint、NodeNext Consumer、Examples、Framework、Documentation、Real Harness Composition 与完整 `pnpm run check:release` 全部通过。
- 已知非阻塞输出只有上游 `@deepseek-ai/dsh-client-ui-primitives` 缺少 `index.js.map` 的 Vite warning；无 Product P0 / P1。

## Divergent same-path preservation table

下表覆盖当前 49 个同名且内容分叉文件。第三工作树必须按每行保留 Product Intent（产品意图）与 Contract / Test Source（契约／测试来源），再叠加企业多用户、权限与 Agent / Skill 分配语义；不得用一侧整文件覆盖另一侧。

| Divergent path | Product intent to preserve | Contract / test source | Integration requirement |
| --- | --- | --- | --- |
| `docs/acceptance/baseline-remediation/api-snapshot.json` | 38 包最终公开导出、声明与 bundle patch 哈希 | `check:api`, `check:release` | 冲突解析及联合 Build 后重新生成；不得直接选任一侧旧哈希。 |
| `docs/architecture/plugin-framework.md` | 六包、Registry / Loader / Settings 所有权和无影子存储边界 | `verify:framework`, R13 Matrix | 合并企业权限边界，但保留产品包控制面和所有权定义。 |
| `docs/standards/package-roles.json` | 38 包 Identity / Role / Consumer / Runtime reachability | `check:packages`, `verify:framework` | 逐项合并角色与企业新增包，随后重跑机器门禁。 |
| `package.json` | 完整 build / test / API / pack / composition / release gate 链 | `check:release` | 合并 scripts / deps 后重新安装锁文件；不得删除任一强制门禁。 |
| `packages/agent-builder/package.json` | Agent Builder host contract、Invariant 和远程入口声明 | package compliance, NodeNext | 合并企业依赖时保留现有 exports 与 Harness compatibility pins。 |
| `packages/agent-builder/src/index.ts` | 保存同一 Agent / Preset version，并创建真实 native Session Test Chat | `builder.spec.ts`, Agent Browser receipts | 权限校验应包裹现有业务流，不能改成第二套 Session / Agent store。 |
| `packages/agent-builder/src/remote.ts` | Agent Builder Remote / Typert 契约与 native ownership | `builder.spec.ts`, NodeNext | 合并企业身份参数但保持现有 request / response 和失败关闭。 |
| `packages/agent-builder/tests/builder.spec.ts` | Agent save / edit / Test Chat / version binding 回归 | targeted + full tests | 保留产品断言并追加企业权限案例，不能删除以消除冲突。 |
| `packages/agent-market/package.json` | Agent Center client/runtime exports 与精确依赖 | compliance, publint, NodeNext | 合并依赖并重建 lock；保留客户端入口。 |
| `packages/agent-market/src/client/index.tsx` | Agent 搜索、空态、创建／编辑、native Session、失败恢复 | `client.spec.tsx`, R13 Agent receipts | 企业角色过滤应叠加到同一页面与 Session 入口，不创建平行 Agent Center。 |
| `packages/agent-market/src/client/styles.ts` | 420px 单列编辑、三 Tab 可达、桌面布局不回退 | `client.spec.tsx`, 420/760/1100/1440 Browser | 保留移动断点与 Tab 几何，合并企业控件后四档重测。 |
| `packages/agent-market/tests/client.spec.tsx` | 40 项 Agent Center 客户端契约和响应式断言 | targeted + full tests | 合并两侧测试集合，禁止以删除产品断言解决冲突。 |
| `packages/artifacts/src/client/index.tsx` | Artifact Card keyboard activation、状态与安全 Viewer route | artifact Browser receipts, client tests | 企业可见性过滤需保留同一 Card / File Tab 路径与键盘语义。 |
| `packages/better-sidebar-adapter/package.json` | Better Sidebar / Office Viewer 精确 compatibility pin | package compliance, compatibility matrix | 以 compatibility matrix 为版本来源，合并后重跑 Office E2E。 |
| `packages/better-sidebar-adapter/src/index.ts` | 持久 File Tab reload reopen、unmount cleanup、Viewer selection | `adapter.spec.ts`, PPTX/XLSX recovery receipts | 保留 refresh reopen delay 与同步清理，企业状态不能制造僵尸 Tab。 |
| `packages/better-sidebar-adapter/tests/adapter.spec.ts` | PPTX reload、unsupported type、unmount cleanup 回归 | targeted + full tests | 保留全部产品回归并增加企业隔离断言。 |
| `packages/category-analysis-adapter/src/index.ts` | 三条 Category Runtime Command 全部绑定 `process.execPath` | `provider.spec.ts`, live Category chain | 禁止回退为 PATH 中 `node`；企业 Sandbox 必须允许当前 Runtime executable。 |
| `packages/conversation-artifact-renderer/src/invariant.ts` | 同步 disposer 与 Turn Artifact Card 生命周期 | invariant tests, artifact Browser receipts | 保留同步释放器，权限过滤不得引入异步或重复注册。 |
| `packages/extension-center/package.json` | Always-on control plane exports、remote / typert / feature pack modules | compliance, NodeNext, Extension tests | 合并企业设置／权限依赖但保持 Extension Center 在所有可关闭组之外。 |
| `packages/extension-center/src/client/index.tsx` | 六包一级 IA、真实开关、状态持久化、失败与依赖级联 UI | `client.spec.tsx`, R13 control-plane Browser receipts | 企业权限决定可操作性时仍须诚实显示 Loader 状态与失败原因。 |
| `packages/extension-center/src/feature-packs.ts` | 六 Product Pack + nested Runtime Orbs 的唯一组合定义 | `feature-packs.spec.ts`, `verify:framework` | 企业功能分配不得重定义或复制 Product Pack graph。 |
| `packages/extension-center/src/index.ts` | Loader group orchestration、Passive import observer、failed-pack isolation | `boot-readiness.spec.ts`, `invariant.spec.ts`, Browser absence receipts | 禁止恢复并发门控；权限逻辑需在 Loader 契约之外组合。 |
| `packages/extension-center/src/projection.ts` | expected / loaded / failed 的诚实 Status Projection | projection-related tests, failed-pack receipts | 缺包不得显示运行中；企业隐藏规则不能篡改 Host truth。 |
| `packages/extension-center/src/remote.ts` | Settings revision / write / rollback Remote contract | `remote.spec.ts`, conflict/write-failure receipts | 合并用户/租户维度时保留 revision compare-and-swap 和 rollback。 |
| `packages/extension-center/tests/client.spec.tsx` | 六包 UX、开关、失败、恢复与可访问性断言 | targeted + full tests | 合并企业测试而不移除产品开关与错误态断言。 |
| `packages/fact-layer/src/index.ts` | Fact Set / source / method / scope 的 Host Tool 与 Artifact 权威链 | `provider.spec.ts`, Proposal live receipts | 企业数据权限应过滤输入／输出，不创建第二套 Fact store。 |
| `packages/generator-office/package.json` | PDFKit / PPTX / XLSX 生成契约与 client entry | compliance, bundle, NodeNext | 合并依赖后保留 Unicode font 与 Office trace 能力。 |
| `packages/generator-office/src/cli.ts` | 真多页 CJK PDF、balanced graphics state、XLSX formula cached result | `provider.spec.ts`, PDF/XLSX Browser receipts | 禁止回退单页文本标记或无 cached result；重跑真文件回读。 |
| `packages/generator-office/src/index.ts` | Office Tool / Job / Artifact projection 与 trace sidecar | provider tests, live model Tool receipts | 企业权限需沿 native Tool / Job 授权，不绕开 Artifact Runtime。 |
| `packages/generator-office/tests/provider.spec.ts` | PDF/PPTX/XLSX 真结构、CJK、分页、formula / trace 断言 | targeted + full tests | 保留全部 6 项产品断言并追加企业场景。 |
| `packages/harness-bundle/cordis.patch.yml` | 六包 Runtime Entry 组合、Invariant 同组启停、缺包 Cold Boot 语义 | composition gate, R13 absence receipts | 逐节点三方合并；不可丢 Skill invalid/absent、Automation、Operations 或 Invariant 生命周期条目。 |
| `packages/harness-bundle/package.json` | Bundle identity、patch export 与 compatibility pin | package audit, composition | 合并企业 bundle deps 后重跑完整 install/boot/remove/restore。 |
| `packages/harness-compat/src/host.ts` | Harness Loader / Settings / Registry 唯一兼容层和 loader-entry read-back | `loader-entry.spec.ts`, composition | 企业 Host 扩展必须复用兼容层，禁止把 Harness version logic 分散回业务包。 |
| `packages/platform-api/src/index.ts` | 签名、重放、allowlist、duplicate action 与 stable 4xx error codes | `api.spec.ts`, final-four API Browser receipt | 保留 `invalid_run_action=400`、replay 409、signature 401；企业身份应叠加而非替换。 |
| `packages/renderer-bento/src/client/index.tsx` | Iframe source/origin handshake、reload/restart origin recovery | `client.spec.ts`, Bento Browser receipts | 保留精确 source + origin 校验及 ready-source reset。 |
| `packages/renderer-bento/tests/client.spec.ts` | 不在 iframe load 前发送、只接受匹配 source/origin | targeted + full tests | 合并企业内容策略时保留 10 项安全与生命周期断言。 |
| `packages/skill-market/package.json` | Skill Center client/runtime exports 与 installer contract | compliance, NodeNext | 合并企业 Skill 分配依赖但保持个人安装／验证路径。 |
| `packages/skill-market/src/installer.ts` | Invalid SKILL.md/ZIP inspect 失败后原子清理 uploads / staging | `installer.spec.ts`, Skill Browser receipts | 不可丢 staged cleanup；企业审核应在同一事务失败关闭。 |
| `packages/skill-market/tests/installer.spec.ts` | invalid cleanup、valid reinstall 与真实使用前置契约 | targeted + full tests | 保留全部 6 项产品断言并添加租户权限案例。 |
| `packages/visual-experience/src/client/index.tsx` | 可逆 PAIMind 视觉体验、native shell 与响应式布局 | `client.spec.tsx`, Product Experience receipts | 企业品牌／角色 UI 需保持同一可逆开关和 native interaction。 |
| `packages/visual-experience/tests/client.spec.tsx` | theme / density / welcome / responsive / cleanup 回归 | targeted + full tests | 合并测试集合，不削弱关闭恢复与四档断言。 |
| `pnpm-lock.yaml` | 本产品线最终 exact dependency graph | install, all gates | 不能手工选边；第三工作树完成 package manifest 合并后统一 `pnpm install` 重生。 |
| `pnpm-workspace.yaml` | 新 `conversation-artifact-renderer` 等工作区发现 | compliance, build, NodeNext | 保留所有产品包路径并加入企业新增 workspace。 |
| `scripts/build.mjs` | 38 包、22 client plugins、额外 entry 的统一 build graph | Production Build, check:release | 合并企业 build entry，不漏 Product client / invariant / auxiliary exports。 |
| `scripts/check-package-compliance.mjs` | Package role、identity、consumer、reachable runtime graph、age gate | `check:packages` | 合并企业规则但保留产品可达性和 exact pin 检查。 |
| `scripts/verify-agent-skill-centers.mjs` | Agent / Skill Center native Session / install contract verification | targeted gate, Browser receipts | 企业分配校验应追加，不替换产品核心中心验证。 |
| `scripts/verify-framework.mjs` | 六包 + Runtime Orb、Registry / Loader truth、descriptor taxonomy | `verify:framework` | 合并企业框架约束并保持现有产品架构不变量。 |
| `scripts/verify-harness-composition.mjs` | settled manifest polling、完整／独立／缺包组合、清理与上游零变更 | Real Harness Composition, check:release | 保留 Loader Barrier 后 settled poll；加入企业组合后在第三工作树重跑。 |
| `tsconfig.json` | 新包与测试的 TypeScript project references | `typecheck`, build | 合并双方 references，禁止遗漏新包或重复 project path。 |

## Integration procedure

1. 在第三个临时 Integration Worktree 从双方共同 HEAD 创建，不移动当前两个工作树。
2. 先按上表逐文件做三方语义合并；Extension Center / Harness Bundle / Agent / Skill / root gates 为最高风险顺序。
3. 企业多用户、权限与 Agent / Skill 分配逻辑作为 AuthZ / Tenant Dimension（授权／租户维度）叠加，不改变 Product Pack graph、native ownership、Loader truth 或失败投影。
4. 最后统一生成 `pnpm-lock.yaml` 和 API Snapshot，不从任一侧直接选择生成文件。
5. 运行 `git diff --check`、Targeted Tests、Full Tests、Type Check、Build、API Snapshot、Package / Pack / Bundle / Publint / NodeNext / Examples、Framework / Docs、Real Harness Composition 和 `pnpm run check:release`。
6. 使用新的隔离 DSH_HOME、随机 Loopback Port 与 `--no-open` 做联合 Browser E2E；至少抽样六包开关／依赖、失败包隔离、企业权限矩阵、Agent / Skill 分配、Artifact / Proposal / Automation 主链与 Process Restart。

## Remaining boundary

- 当前产品线无未解决 Product P0 / P1。
- 49 个同名内容分叉是预期 Integration Risk，不是当前 Live Interference；联合整合未执行，因此不能把本独立 PASS 外推为企业联合版本 PASS。
- 本任务没有创建 commit、merge、push、publish 或 deploy。
