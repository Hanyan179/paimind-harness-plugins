# R13 Browser Evidence Index

## Evidence boundary

- Runtime：主证据使用 `DSH_HOME=/private/tmp/paimind-r13-e2e.slTHZt`、`http://127.0.0.1:61888`；缺包、失败包、Skill / Agent Lifecycle（技能／智能体生命周期）及后续 Product Experience Recovery（产品体验恢复）使用 `DSH_HOME=/private/tmp/paimind-r13-e2e.missing.HEZwdL`，先后绑定 `62473` 与 `62617`。全部只绑定 Loopback（回环地址）并使用 `--no-open`。
- 本索引只记录本轮可回读证据；R12、Mock UI、Unit Test 或 API-only 结果不升级为 Browser E2E。
- Browser 截图不提交仓库；可重复回读的几何、可见文本、Host 对象、Console / Network 状态写入本索引。
- `PASS` 只表示该 Scenario（场景）完整；Runtime Entry 的九项 Lifecycle Evidence（生命周期证据）未齐时仍保持 `PENDING`。

## Scenario index

| Scenario | Product path | Viewport | Result | Receipt |
| --- | --- | --- | --- | --- |
| `R13-RUNTIME-BOOT-001` | Isolated install / boot | `1440x1000` | PASS | `REC-RUNTIME-BOOT-001` |
| `R13-SETTINGS-001` | Settings → Personalization | `1440x1000` | PASS | `REC-SETTINGS-001` |
| `R13-DEVRES-001` | Settings → Developer Resources | `1440x1000` | PASS | `REC-DEVRES-001` |
| `R13-AGENT-CRUD-001` | Agent Center → create / save / edit | `420x900` | PASS | `REC-AGENT-CRUD-001` |
| `R13-AGENT-NOKEY-001` | Agent Center → Test Chat → send | `420x900` | PASS | `REC-AGENT-NOKEY-001` |
| `R13-AGENT-SUCCESS-001` | Agent Builder → saved Agent → Test Chat → model reply | `1440x1000` | PASS | `REC-AGENT-SUCCESS-001` |
| `R13-AGENT-MARKET-SUCCESS-001` | Agent Center → saved Agent → start native Session → model reply | `1440x1000` | PASS | `REC-AGENT-MARKET-SUCCESS-001` |
| `R13-AGENT-PACK-ABSENT-001` | Agents Pack off → physical Agent Builder / Market absence → cold boot / refresh / restart | `1440x1000` | PASS | `REC-AGENT-PACK-ABSENT-001` |
| `R13-AGENT-PACK-RESTORE-ATTEMPT-001` | Physical restore → duplicate stale Browser tabs → plugin loading stall | `1440x1000` | FAIL | `REC-AGENT-PACK-RESTORE-ATTEMPT-001` |
| `R13-AGENT-PACK-RESTORE-001` | Clean-tab reload → Agents Pack restore → Loader / Settings / entry recovery | `1440x1000` | PASS | `REC-AGENT-PACK-RESTORE-001` |
| `R13-AGENT-BUILDER-RECOVERY-001` | Persisted Agent → Test Chat → deterministic Provider → process restart read-back | `1440/1100/760/420` | PASS | `REC-AGENT-BUILDER-RECOVERY-001` |
| `R13-AGENT-MARKET-SEARCH-001` | Agent Center → matching search / empty result / clear | `1440x1000` | PASS | `REC-AGENT-MARKET-SEARCH-001` |
| `R13-AGENT-MARKET-FAILURE-RECOVERY-001` | Agent Session → Provider transport failure → retry / explicit error → same-session recovery | `1440x1000` | PASS | `REC-AGENT-MARKET-FAILURE-RECOVERY-001` |
| `R13-ORBS-REPLY-001` | Native Session → slow provider reply → Runtime Orbs active / cleanup | `1440x1000` | PASS | `REC-ORBS-REPLY-001` |
| `R13-ORBS-CAPABILITY-001` | Extension Center → Runtime Orbs off / real slow Turn / restore / restart | `1440x1000` | PASS | `REC-ORBS-CAPABILITY-001` |
| `R13-EXPERIENCE-KEYBOARD-CHROME-RECOVERY-001` | Product Experience → system keyboard activation / stable-PID fresh Chrome recovery | `1440x1000` | PASS | `REC-EXPERIENCE-KEYBOARD-CHROME-RECOVERY-001` |
| `R13-EXPERIENCE-INVARIANT-LIFECYCLE-ATTEMPT-001` | Runtime Orbs off → on → duplicate invariant registration | `1440x1000` | FAIL | `REC-EXPERIENCE-INVARIANT-LIFECYCLE-ATTEMPT-001` |
| `R13-EXPERIENCE-INVARIANT-LIFECYCLE-RECOVERY-001` | Disposable invariant fix → same-process Runtime Orbs off / on recovery | `1440x1000` | PASS | `REC-EXPERIENCE-INVARIANT-LIFECYCLE-RECOVERY-001` |
| `R13-AGENT-RESP-420` | Agent Center → edit / scroll / Test Chat / return | `420x900` | PASS | `REC-AGENT-RESP-420` |
| `R13-AGENT-RESP-760` | Agent Center → edit / Test Chat / return | `760x900` | PASS | `REC-AGENT-RESP-760` |
| `R13-AGENT-RESP-1100` | Agent Center → edit / Test Chat / return | `1100x900` | PASS | `REC-AGENT-RESP-1100` |
| `R13-AGENT-RESP-1440` | Agent Center → edit / Test Chat / return | `1440x1000` | PASS | `REC-AGENT-RESP-1440` |
| `R13-SCHEDULER-001` | Scheduler → create / run now / open result | `1440x1000` | FAIL | `REC-SCHEDULER-001` |
| `R13-SCHEDULER-RECOVERY-001` | Scheduler → edit workspace binding / run now / open successful result | `1440x1000` | PASS | `REC-SCHEDULER-RECOVERY-001` |
| `R13-SCHEDULER-ARCHIVE-001` | Scheduler → archive / active-list removal / archived read-back | `1440x1000` | PASS | `REC-SCHEDULER-ARCHIVE-001` |
| `R13-NOTIFICATION-001` | Notifications → expand success / open target Session | `1440x1000` | PASS | `REC-NOTIFICATION-001` |
| `R13-AUTOMATION-LIVE-FAILURE-RECOVERY-001` | Scheduler / Notifications / Harness Adapter → Provider unavailable → explicit failure → real model recovery → notification / Session / archive / restart | `1440x868` | PASS | `REC-AUTOMATION-LIVE-FAILURE-RECOVERY-001` |
| `R13-AUTOMATION-RESPONSIVE-ATTEMPT-001` | Platform Scheduler in Harness Settings → fixed navigation squeezes task content | `420 CSS px` | FAIL | `REC-AUTOMATION-RESPONSIVE-ATTEMPT-001` |
| `R13-AUTOMATION-RESPONSIVE-RECOVERY-001` | Notifications + Scheduler → responsive Settings recovery / pointer / system keyboard / reload | `1440/1100/760/420 CSS px` | PASS | `REC-AUTOMATION-RESPONSIVE-RECOVERY-001` |
| `R13-AUTOMATION-ABSENCE-RECOVERY-001` | Three Automation entries → individual physical absence / exact failed projection / native Session isolation / reinstall / cold boot | `1440x868` | PASS | `REC-AUTOMATION-ABSENCE-RECOVERY-001` |
| `R13-NOTIFICATIONS-NETWORK-001` | Notifications → exact Client Bundle / success + failure producer / mark-all-read / restart / absence | `1440/1100/760/420 CSS px` | PASS | `REC-AUTOMATION-NETWORK-001` |
| `R13-SCHEDULER-NETWORK-001` | Platform Scheduler → exact Client Bundle / mutation / failure + recovery / restart / absence | `1440/1100/760/420 CSS px` | PASS | `REC-AUTOMATION-NETWORK-001` |
| `R13-SCHEDULER-HARNESS-NETWORK-001` | Host-only Harness Adapter → Provider HTTP/SSE / model JSONL / missing Client route / absence | `1440/1100/760/420 CSS px` | PASS | `REC-AUTOMATION-NETWORK-001` |
| `R13-AUTOMATION-FINAL-FOUR-FAILURE-RECOVERY-001` | HTTP / Platform API / Feishu → real signed requests / explicit failures / callback or delivery recovery / persisted task history | `1440x868` | PASS | `REC-AUTOMATION-FINAL-FOUR-FAILURE-RECOVERY-001` |
| `R13-AUTOMATION-FINAL-FOUR-RESPONSIVE-KEYBOARD-001` | HTTP / Feishu scheduler surfaces + Platform API notification + Developer Resources → four-size / system keyboard / focus / reload | `1440/1100/760/420 CSS px` | PASS | `REC-AUTOMATION-FINAL-FOUR-RESPONSIVE-KEYBOARD-001` |
| `R13-AUTOMATION-FINAL-FOUR-ABSENCE-RECOVERY-001` | HTTP / Platform API / Feishu / Developer Resources → individual physical absence / exact projection / native Session isolation / reinstall / cold boot | `1440x868` | PASS | `REC-AUTOMATION-FINAL-FOUR-ABSENCE-RECOVERY-001` |
| `R13-AUTOMATION-FINAL-FOUR-NETWORK-001` | HTTP / Platform API / Feishu / Developer Resources → exact host or client request/error ledger | `1440/1100/760/420 CSS px` | PASS | `REC-AUTOMATION-FINAL-FOUR-NETWORK-001` |
| `R13-GLOBAL-NETWORK-CLOSURE-001` | All 30 Runtime Entries → fresh-tab declared client or host-only route + existing business/error/recovery receipts | `1440x868` | PASS (30 / 30) | `REC-GLOBAL-NETWORK-CLOSURE-001` |
| `R13-FINAL-GATES-HANDOFF-001` | Full release gates → isolated process cleanup → exact manifests → integration-ready handoff | n/a | PASS | `REC-FINAL-GATES-HANDOFF-001` |
| `R13-TASKMONITOR-001` | Task Monitor → inspect completed native Job and logs | `1440x1000` | PASS | `REC-TASKMONITOR-001` |
| `R13-HTML-ARTIFACT-001` | Native Session → HTML Tool → Job / Artifact card → Viewer edit / save | `1440x1000` | PASS | `REC-HTML-ARTIFACT-001` |
| `R13-HTML-ARTIFACT-REGRESSION-001` | New Session → unique Tool Call → reload history / Viewer | `1440x1000` | PASS | `REC-HTML-ARTIFACT-REGRESSION-001` |
| `R13-HTML-ARTIFACT-INTERACTION-001` | Persisted model Artifact card → Preview / Edit / Save / Refresh | `1440x1000` | PASS (supporting) | `REC-HTML-ARTIFACT-INTERACTION-001` |
| `R13-HTML-RESPONSIVE-ATTEMPT-001` | HTML Viewer → 420px long-token clipping | `420x900` | FAIL | `REC-HTML-RESPONSIVE-ATTEMPT-001` |
| `R13-HTML-RESPONSIVE-RECOVERY-001` | Responsive generation contract → model Tool / Viewer / edit / navigation / restart | `1440/1100/760/420` | PASS | `REC-HTML-RESPONSIVE-RECOVERY-001` |
| `R13-WORKSPACE-PROJECT-001` | Native Workspace → new Session / selector / model reply / reload / restart | `1440/1100/760/420` | PASS | `REC-WORKSPACE-PROJECT-001` |
| `R13-CONTENT-NETWORK-LEDGER-001` | Workspace / HTML generator / Artifact projection / Turn card request ledger | `1440/1100/760/420` | PASS (4 / 30) | `REC-CONTENT-NETWORK-LEDGER-001` |
| `R13-PPTX-ARTIFACT-001` | Native Session → PPTX Tool → Viewer pagination | `1440x1000` | FAIL | `REC-PPTX-ARTIFACT-001` |
| `R13-PPTX-ARTIFACT-RECOVERY-001` | New Session → unique PPTX Tool Call → two-page Viewer | `1440x1000` | PASS | `REC-PPTX-ARTIFACT-RECOVERY-001` |
| `R13-PPTX-RELOAD-001` | Reload with an open persisted PPTX editor tab | `1440x1000` | FAIL | `REC-PPTX-RELOAD-001` |
| `R13-PPTX-RELOAD-RECOVERY-001` | Rebuilt adapter → process restart → persisted PPTX tab → repeated reload | `1440x1000` | PASS | `REC-PPTX-RELOAD-RECOVERY-001` |
| `R13-XLSX-CACHED-RESULT-ATTEMPT-001` | Native Session → XLSX Tool / Job / Artifact → formula cells blank in Viewer | `1440x1000` | FAIL | `REC-XLSX-CACHED-RESULT-ATTEMPT-001` |
| `R13-XLSX-CACHED-RESULT-RECOVERY-001` | Formula + cached result contract → real XLSX Viewer / reload / responsive recovery | `1440/1100/760/420` | PASS | `REC-XLSX-CACHED-RESULT-RECOVERY-001` |
| `R13-XLSX-UNMOUNT-ATTEMPT-001` | Persisted XLSX → Session switch / explicit close → duplicate DOM removal | `1440x1000` | FAIL | `REC-XLSX-UNMOUNT-ATTEMPT-001` |
| `R13-XLSX-UNMOUNT-ATTEMPT-002` | Stable scope + provider DOM boundary → explicit close | `1440x1000` | FAIL | `REC-XLSX-UNMOUNT-ATTEMPT-002` |
| `R13-XLSX-UNMOUNT-ATTEMPT-003` | Independent React root → explicit close | `1440x1000` | FAIL | `REC-XLSX-UNMOUNT-ATTEMPT-003` |
| `R13-XLSX-UNMOUNT-ATTEMPT-004` | Tracked Office subtree guard with synchronous restore → explicit close | `1440x1000` | FAIL | `REC-XLSX-UNMOUNT-ATTEMPT-004` |
| `R13-XLSX-UNMOUNT-RECOVERY-001` | Grace-scoped Office cleanup guard → close / Session switch / reload / process restart | `1440x1000` | PASS | `REC-XLSX-UNMOUNT-RECOVERY-001` |
| `R13-PDF-FONT-001` | Native Session → generated PDF → PDF.js text rendering | `1440x1000` | FAIL | `REC-PDF-FONT-001` |
| `R13-PDF-NAVIGATION-001` | Persisted PDF tab → fresh Browser tab navigation | `1440x1000` | FAIL | `REC-PDF-NAVIGATION-001` |
| `R13-PDF-BROWSER-RECOVERY-001` | Native Session → PDF Tool / Job / Artifact → six-page Viewer | `1440/420` | PASS (superseded file) | `REC-PDF-BROWSER-RECOVERY-001` |
| `R13-PDF-STRUCTURE-001` | Authoritative PDF page / graphics-state validation | file read-back | FAIL | `REC-PDF-STRUCTURE-001` |
| `R13-PDF-STRUCTURE-RECOVERY-001` | Final three-page PDF → Viewer pagination / zoom / reload / navigation / responsive | `1440/1100/760/420` | PASS | `REC-PDF-STRUCTURE-RECOVERY-001` |
| `R13-PDF-TOOLBAR-KEYBOARD-001` | Focused PDF toolbar buttons → system Return / Space activation | `1440x1000` | PASS | `REC-PDF-TOOLBAR-KEYBOARD-001` |
| `R13-SKILL-LIFECYCLE-001` | Skill Center → inspect / install / Composer invoke / model reply / backup uninstall / reinstall | `1440x1000` | PASS | `REC-SKILL-LIFECYCLE-001` |
| `R13-SKILL-RESTART-RECOVERY-001` | Installed Skill → process restart / clean-tab refresh / responsive read-back | `1440/1100/760/420` | PASS | `REC-SKILL-RESTART-RECOVERY-001` |
| `R13-SKILL-INVALID-PACKAGE-ATTEMPT-001` | Local import → invalid SKILL.md → staged upload leak | `1440x1000` | FAIL | `REC-SKILL-INVALID-PACKAGE-ATTEMPT-001` |
| `R13-SKILL-INVALID-PACKAGE-001` | Invalid SKILL.md / ZIP → visible rejection → zero residue → refresh / restart | `1440x1000` | PASS | `REC-SKILL-INVALID-PACKAGE-001` |
| `R13-SKILL-PACKAGE-ABSENT-ATTEMPT-001` | Agents pack off → physical Skill Market absence → cold boot | `1440x1000` | FAIL | `REC-SKILL-PACKAGE-ABSENT-ATTEMPT-001` |
| `R13-SKILL-PACKAGE-ABSENT-001` | Pack-owned invariant fix → physical absence → cold boot / refresh / restart / reinstall | `1440x1000` | PASS | `REC-SKILL-PACKAGE-ABSENT-001` |
| `R13-SKILL-VALID-RECOVERY-001` | Valid local Skill → inspect / install / invoke → failure preserved → provider recovery | `1440x1000` | PASS | `REC-SKILL-VALID-RECOVERY-001` |
| `R13-PROPOSAL-DUPLICATE-ID-001` | Multi-turn Proposal tool chain → reload old fixed-id Session | `1440x1000` | FAIL | `REC-PROPOSAL-DUPLICATE-ID-001` |
| `R13-PROPOSAL-CHAIN-RECOVERY-001` | Unique model Tool Call IDs → category / fact / outline / Bento chain | `1440x1000` | PASS | `REC-PROPOSAL-CHAIN-RECOVERY-001` |
| `R13-BENTO-WORKBENCH-001` | Bento Preview / Edit / Trace / locked facts / keyboard / responsive | `1440/1100/760/420` | PASS | `REC-BENTO-WORKBENCH-001` |
| `R13-BENTO-RELOAD-001` | Reload persisted Bento tab before request recovery | `1280x720` | FAIL | `REC-BENTO-RELOAD-001` |
| `R13-BENTO-RELOAD-RECOVERY-001` | Rebuilt artifact locator → process restart → reload / back / forward recovery | `1440/420` | PASS | `REC-BENTO-RELOAD-RECOVERY-001` |
| `R13-EXT-DESKTOP-001` | Settings → Extension Center | `1440x1000` | PASS (read-only) | `REC-EXT-DESKTOP-001` |
| `R13-PACKS-DIRECT-001` | Extension Center → six packs direct off / restore | `1440x1000` | PASS | `REC-PACKS-DIRECT-001` |
| `R13-PACK-CASCADE-001` | Content off cascade → Automation reverse-enable | `1440x1000` | PASS | `REC-PACK-CASCADE-001` |
| `R13-CONTENT-PACK-ABSENT-BOOT-001` | Content Pack off → nine Runtime packages physically absent → cold boot / unrelated Session | `1440x1000` | PASS | `REC-CONTENT-PACK-ABSENT-BOOT-001` |
| `R13-CONTENT-PACK-ENABLE-FAILURE-001` | Nine Content packages absent → rejected enable → Settings / Loader rollback | `1440x1000` | PASS | `REC-CONTENT-PACK-ENABLE-FAILURE-001` |
| `R13-CONTENT-PACK-RELOAD-RESTART-001` | Content packages absent → page reload / Harness restart | `1440x1000` | PASS | `REC-CONTENT-PACK-RELOAD-RESTART-001` |
| `R13-CONTENT-PACK-RESTORE-001` | Restore nine packages → enable Content → Office / HTML / Bento file actions | `1440x1000` | PASS | `REC-CONTENT-PACK-RESTORE-001` |
| `R13-PACKS-RESTART-001` | Persisted four-pack off → Harness process restart | `1440x1000` | FAIL | `REC-PACKS-RESTART-001` |
| `R13-PACKS-RESTART-RECOVERY-001` | Cold-boot reconciliation fix → off-state restart / restore / all-on restart | `1440x1000` | PASS | `REC-PACKS-RESTART-RECOVERY-001` |
| `R13-SETTINGS-REVISION-CONFLICT-001` | Two Extension Center pages → stale CAS mutation → Host-state recovery | `1440x1000` | PASS | `REC-SETTINGS-REVISION-CONFLICT-001` |
| `R13-SETTINGS-WRITE-FAILURE-001` | Read-only isolated Settings → rejected switch → rollback / permission recovery | `1440x1000` | PASS | `REC-SETTINGS-WRITE-FAILURE-001` |

## Scenario receipts

### REC-RUNTIME-BOOT-001

- Operation：从隔离 Home 安装并启动完整 Harness Bundle；浏览器打开 Developer Resources 后通过键盘触发刷新。
- Visible feedback：`62 / 62 active`，`0 loading / failed / disabled / unobserved`；Surface Catalog 显示 `20` 个产品 Surface。
- Host read-back：Loader Projection 与页面数字一致；30 个 Runtime Entry 及 Product Pack / Capability companion 均处于 active baseline。
- Console：本轮干净页面无 `warn` / `error`。
- Network：尚未固化逐请求 Network ledger；保持横切项 `PENDING`。
- Result：`PASS`（仅 install / boot / live diagnostic 场景）。

### REC-SETTINGS-001

- Operation：在 Personalization 选择 `Pragmatic`，写入 `R13 隔离验收用户，只使用合成数据。` 与 `回答末尾输出 R13_PERSONALIZATION_OK。`，保存后刷新页面。
- Visible feedback：保存完成，字段在刷新后恢复。
- Host read-back：原生 `settings.describe` 与 `paimindUserSettings/describe` 均回读 revision `3` 及完全相同的三个字段；`settings.yaml` 也保存在隔离 Home。
- Console：无 `warn` / `error`。
- Network：未发现页面错误反馈；逐请求 Network ledger 待补。
- Result：`PASS`（编辑、保存、刷新与双路径权威回读）。

### REC-DEVRES-001

- Operation：进入 Developer Resources，使用键盘聚焦 Refresh 并触发刷新，依次打开 Live Snapshot、Surface Catalog、Integration Reference。
- Visible feedback：刷新后焦点仍在 Refresh；Loader 汇总 `62 / 62 active`；20 个产品 Surface 与稳定 Contract 列表可见。
- Host read-back：页面 Loader 状态与隔离 Host Registry 一致。
- Console：无 `warn` / `error`。
- Network：逐请求 Network ledger 待补。
- Result：`PASS`（在线诊断主路径；缺包降级另测）。

### REC-AGENT-CRUD-001

- Operation：在 Agent Center 手工填写名称、用途、角色、目标、行为规范与补充要求，保存后返回“我的智能体”，再打开编辑。
- Visible feedback：出现 `R13 合成验收助手` 卡片、`个人智能体`、`标准模式`、`第 1 版` 与完整用途说明；编辑表单回填保存内容。
- Host read-back：Preset `r13-19f517` 写入隔离 `.agent-presets`；绑定状态记录 `configVersion=v1-af9a58fcde0b3cf6`。
- Console：无 `warn` / `error`。
- Network：逐请求 Network ledger 待补。
- Result：`PASS`。

### REC-AGENT-NOKEY-001

- Operation：从已保存 Agent 打开 Test Chat，输入 `只读取本轮合成工作区，回复 R13_AGENT_TEST。` 并发送。
- Visible feedback：先出现 `Harness 原生测试对话已连接` 与 `测试对话已就绪`；发送后真实原生会话显示 `MISSING_CREDENTIAL`，没有伪造模型回复或假成功。
- Host read-back：Session `session-4750af94-8d0e-47f9-8a0c-57a79f437792` 绑定 Preset `r13-19f517` 与同一 configVersion；原生日志为 1 Turn / 1 Step、0 assistant result，并以 `MISSING_CREDENTIAL` 结束。
- Console：页面无 `warn` / `error`；业务错误只在原生会话中可见。
- Network：模型请求未发出，因为 Credentials Service（凭证服务）在路由前失败关闭。
- Result：`PASS`（Failure Closure）；隔离 Provider 恢复后的模型成功路径见 `REC-AGENT-SUCCESS-001`。

### REC-AGENT-SUCCESS-001

- Operation：从已保存的 `R13 合成验收助手` 进入编辑，切换 `测试对话`，等待 `Harness 原生测试对话已连接` 与 `测试对话已就绪`，在右侧原生 Composer 输入 `只读取本轮合成工作区，回复 R13_AGENT_OK。` 并发送。
- Loading / visible feedback：发送后侧栏 Session 显示 `进行中 测试 · R13 合成验收助手`，原生消息区显示流式文本、`正在回复…` 与 `停止生成`；完成后出现 `R13_AGENT_OK`、`用时 2秒`、`5.7 tok/s`，Agent Center 同时显示 `真实首轮验证通过。`
- Host read-back：Test Session `session-fd88e1fa-f6bb-4e85-b71b-3fd1992f93b2` 绑定 Preset `r13-19f517`；系统 Prompt 回读角色、目标、行为规范和 `Additional requirements`。Session JSONL 保存真实 `assistant/chunk` 流、`assistant/message`（`source.kind=model`、provider `deepseek-official`、model `deepseek-v4-flash`）与 `turn/end completed`，无 `MISSING_CREDENTIAL`。
- Personalization injection：同一 Request Header 包含保存后的 `paimind-personalization`：Pragmatic 文案、合成用户说明与 `R13_PERSONALIZATION_OK` 自定义指令，证明 User Settings 已进入真实 LLM Context，而非只停留在表单存储。
- Console / Network：页面无 `warn` / `error`；Loopback Provider 记录 `slow_success` Request / Result `outcome=completed`、`chunksSent=8`。
- Result：`PASS`（Agent Builder 真实 Test Chat 成功恢复）；Agent 包关闭、刷新、重启与缺席组合已由 `REC-AGENT-PACK-ABSENT-001`、`REC-AGENT-PACK-RESTORE-001` 和 `REC-AGENT-BUILDER-RECOVERY-001` 补齐。

### REC-AGENT-MARKET-SUCCESS-001

- Operation：从 `我的智能体` 卡片点击 `开始对话`，在新建原生 Session 中确认当前 Preset 为 `R13 合成验收助手`，输入 `验证智能体中心新会话，回复 R13_AGENT_OK。` 并发送；完成后再次发送 Runtime Orb 验证消息。
- Loading / visible feedback：每次发送期间侧栏显示 `进行中`，消息区显示流式文本、`正在回复…` 与 `停止生成`；最终两轮都显示 `R13_AGENT_OK`、各自模型耗时和 Token 统计，首轮 Session 标题由真实 Provider 更新为 `R13_AGENT_OK`。
- Host read-back：Session `session-67d1ab6b-57ff-4e27-96fb-7bbac08bb965` 的初始 `agentPreset=standard` 后立即保存 `agent-preset/selected=r13-19f517`；两轮均保存 `assistant/message source.kind=model` 与 `turn/end completed`，没有 `MISSING_CREDENTIAL`。
- Console / Network：页面无 `warn` / `error`；业务回复、标题生成和第二轮回复都命中真实 `/v1/chat/completions`，Provider Request / Result 全部 `outcome=completed`。
- Result：`PASS`（选择、启动新 Session 与模型回复主路径）；Search、关闭包、刷新、重启和缺席组合已由 `REC-AGENT-MARKET-SEARCH-001`、`REC-AGENT-PACK-ABSENT-001`、`REC-AGENT-PACK-RESTORE-001` 与 `REC-AGENT-MARKET-FAILURE-RECOVERY-001` 补齐。

### REC-AGENT-PACK-ABSENT-001

- Runtime / operation：使用 `DSH_HOME=/private/tmp/paimind-r13-e2e.missing.HEZwdL`、`http://127.0.0.1:62473` 与 `--no-open`。先在真实 Extension Center（扩展中心）关闭 `智能体中心 · 已启用`，Settings（设置）落盘 SHA-256 `74a5a3c22625b875a11a39ff7ed0f1cd372fc6b219eb096c245e73ac51ed7613`、`paimind:pack:agents=false`；随后正常关闭 Runtime（运行时），将 Profile（配置档）内 `@paimind/agent-builder` 与 `@paimind/agent-market` 两个 Symlink（符号链接）移动到同一临时 Home（主目录）的可恢复备份位置并确认 Profile 内物理缺席。
- Cold boot / Host read-back：同一端口 Cold Boot（冷启动）为 HTTP 200；根页 Loader Manifest（加载器清单）准确保留 `18` 个 PAIMind Product Surface（产品界面），不含 Agent Builder、Agent Market 或同属 Agents Pack（智能体包）的 Skill Market。Extension Center 显示 `智能体中心 · 已关闭`、`18 产品能力 / 18 Harness 已加载 / 0 技术状态需关注`，没有把缺包显示成运行中或失败假象。
- Unrelated product isolation：真实页面中 Agent / Skill（智能体／技能）入口均缺席；原生历史 Session（会话）和 `R13_VALID_SKILL_OK` 记录仍可读，Task Monitor（任务监控）可打开并回读当前 Session、Workspace、Agent 与 Skill，Notifications（通知）可打开成功／失败历史并深链会话。
- Refresh / restart：页面 Reload（重载）后 Agent / Skill 入口仍准确缺席，Session 保持可读，Fresh Console（全新控制台）为 `warn/error=[]`。随后执行一次正常 Process Restart（进程重启），确认 Shutdown（关闭）后端口无 Listener（监听进程），再以同一 Home、端口和 `--no-open` 启动；Fresh Tab `id=47` 仍为 Agent / Skill 入口缺席、Notification / Settings（通知／设置）存在、Session 可读、`warn/error=[]`。
- Result：`PASS`（Agents Pack 关闭、物理双包缺席、Cold Boot、无关产品隔离、刷新与进程重启）；恢复见 `REC-AGENT-PACK-RESTORE-001`。

### REC-AGENT-PACK-RESTORE-ATTEMPT-001

- Attempt：正常关闭缺包 Runtime 后把两个 Symlink 原位恢复，再用同一 Home / Port（主目录／端口）启动。Host 根页持续 HTTP 200、Settings 仍为 Agents Pack Off（智能体包关闭）、Manifest 保持 `18` 项；但两个新建 Browser Tab（浏览器标签）分别停在 `Loading plugins…` 或在 Reload（重载）时超时，不能把本次恢复直接标为成功。
- Classification：浏览器会话同时保留多轮旧 Runtime 连接和多个失败数据页；关闭本轮过期标签 `25,44,45,46,47,48,49` 后，没有修改产品代码、Settings 或 Runtime，再对唯一存量 Harness Tab 执行 Reload 即约 1 秒恢复正常页面，Fresh Console（全新控制台）为 `warn/error=[]`。因此本 Attempt（尝试）分类为 Browser Infrastructure Connection Accumulation（浏览器基础设施连接积累），不是已确认的 PAIMind Loader Defect（加载器缺陷）。
- Result：`FAIL`（Attempt 1，保留）；Clean-tab Recovery（干净标签恢复）见下一条。

### REC-AGENT-PACK-RESTORE-001

- Physical recovery：两个 Profile Symlink 原位恢复后均精确指向当前仓库 `packages/agent-builder` 与 `packages/agent-market`，临时 Backup（备份）路径清空；恢复过程没有改写企业 Worktree（企业工作树）、共享 3080 或主 Checkout（检出目录）的 `.dsh-home`。
- Browser / Settings recovery：在已恢复的真实页面打开 Extension Center，确认 `智能体中心 · 已关闭`，再点击开关启用。页面立即恢复 Agent Center / Skill Center（智能体中心／技能中心）入口；Settings SHA-256 变为 `1ec5ebcbce1f5dc2517f2a8167db9d287ace6c6910efb7f50554c0e523675b9f`，`paimind:pack:agents=true`。Host 根页 Manifest 重新包含 `@paimind/agent-market`、`@paimind/skill-market` 及其 Product Entry（产品入口），无关产品保持运行。
- Process restart：恢复开关后主动正常关闭并重启 Harness。Fresh Tab `id=50` 回读 Agent / Skill / Notification / Task Monitor（智能体／技能／通知／任务监控）入口全部存在，`R13_AGENT_MARKET_RECOVERY_OK` Session 可见，Console `warn/error=[]`；再次打开 Agent Center 后 `R13 合成验收助手`、第 1 版与保存内容均恢复。
- Result：`PASS`（物理恢复、Settings-first 重新启用、页面恢复与进程重启持久化）。

### REC-AGENT-BUILDER-RECOVERY-001

- Operation：进程重启后打开 `R13 合成验收助手`，编辑页回读已保存名称、用途、角色、目标、行为规范与补充要求；切换 Test Chat（测试对话），等待 `Harness 原生测试对话已连接` 和 `测试对话已就绪`，在真实主 Composer（输入区）发送 `请只回复 R13_AGENT_BUILDER_RECOVERY_OK`。
- Visible feedback：侧栏创建 `测试 · R13 合成验收助手` 原生 Session，页面显示精确模型回复 `R13_AGENT_BUILDER_RECOVERY_OK` 与 `真实首轮验证通过。`，Loading / Disabled（加载／禁用）状态正确收敛，没有 Mock UI（模拟界面）或手写日志。
- Provider / Host read-back：Deterministic Provider（确定性提供方）`127.0.0.1:54339` 记录 `agentBuilderObserved=true`、Request SHA-256 `02492923982e6f0529b9a5a969ccb5652fe5c1b10d4d299a9f2074fa55b6dd32` 与 `outcome=completed`。Session `session-fc37a35b-0fb0-4b25-a936-1e936262fa0d` 最终文件 SHA-256 `4e22ebcc259cb8be04ebf3eaf7eadfed6b8faa76c3d4e678d2a4341ded7477c4`；JSONL 含真实 `assistant/chunk`、`assistant/message source.kind=model`、provider `deepseek-official`、model `deepseek-v4-flash` 与 `turn/end completed`。旧 `session-4750af94-8d0e-47f9-8a0c-57a79f437792` 的 `MISSING_CREDENTIAL` Failure Closure（失败关闭）完整保留，没有覆盖失败记录。
- Responsive interaction：重新在 `420/760/1100/1440 CSS px` 四档真实打开 Agent Center、进入编辑、切换 Test Chat、等待连接并返回中心。420 档根 `scrollWidth=420`，三项产品 Tab（标签）右边界最大 `403.98`，名称输入框为 `left=68,right=400,width=332`；760 / 1100 / 1440 档根宽度均等于 `innerWidth`，编辑输入框与 Test Chat 均可达。四档均返回 `我的智能体`，Console `warn/error=[]`。
- Refresh / restart：模型成功页 Reload 后回复和 Agent / Skill 入口恢复；随后 Process Restart 与 Fresh Tab 回读 Test Session 回复、Preset（预设）、第 1 版和 Agent Center 均持久，Console `warn/error=[]`。
- Targeted evidence：Bundled Node（捆绑 Node）执行 Agent Builder / Market 的 `builder.spec.ts`、两个 `invariant.spec.ts`、`catalog.spec.ts` 与 `client.spec.tsx` 为 `5 files / 65 tests PASS`；两个 Package Type Check（包类型检查）和 `git diff --check` 均通过。上游 `dsh-client-ui-primitives` 缺少 Source Map（源映射）的既知 Warning（警告）保留为非阻塞依赖噪音。
- Result：`PASS`（与 `REC-AGENT-CRUD-001`、`REC-AGENT-NOKEY-001`、四档 Responsive Receipt（响应式回执）和包缺席／恢复场景共同闭合 Agent Builder 九轴）。

### REC-AGENT-MARKET-SEARCH-001

- Operation：在进程重启后的 Agent Center 搜索框输入 `R13 合成`，页面只显示 `R13 合成验收助手` 与 `1 个结果`；再输入 `R13 不存在智能体`。
- Empty / recovery feedback：无匹配时页面显示 `0 个结果`、`没有匹配的个人智能体`、`试试更短的关键词，或清空搜索。` 与可点击 `清空搜索`；清空输入后完整目录恢复。过程 Console `warn/error=[]`。
- Result：`PASS`（Agent Market 搜索、Empty State（空状态）和恢复）。

### REC-AGENT-MARKET-FAILURE-RECOVERY-001

- Operation / success baseline：从 `R13 合成验收助手` 卡片点击 `开始对话`，在新原生 Session 发送 `请只回复 R13_AGENT_MARKET_RECOVERY_OK`。页面显示精确模型回复，Provider 记录 `agentMarketObserved=true`；Session 标题由真实 Provider 更新为 `R13_AGENT_MARKET_RECOVERY_OK`。
- Failure closure：停止隔离 Provider 后，在同一 Session 发送 `R13_AGENT_MARKET_FAILURE_CLOSURE_EXPECTED`。页面依次显示 `正在重试模型请求（2/5）`、`正在重试模型请求（5/5）`，最终为 `已重试模型请求（5/5） · 9s`、`本轮运行失败 DeepSeek API request to http://127.0.0.1:54339/v1 failed` 与 code `TRANSPORT`；没有伪回复或假成功，Composer 在结束后恢复可输入。
- Same-session recovery：重启同一个隔离 Provider 后，在同一 Session 再发送 `请只回复 R13_AGENT_MARKET_RECOVERY_OK`。页面保留失败 Turn，并追加真实成功回复；Provider Request SHA-256 为 `843c6bee30d56253c1cfacf427ba3e8e9639a9f1ae4e128d5c6a767e11cdc919`、`outcome=completed`。Session `session-168c9c38-6d15-4abb-a467-4171604f4fe0` 最终 SHA-256 `6606635680ca43c0652cc8740efd3197902d0d946bdfb317e5b11bbc8e0c0668`；JSONL 依次保存 5 条 `llm/retry`、`turn/end error code=TRANSPORT`、恢复后的 `assistant/message source.kind=model` 与 `turn/end completed`。
- Refresh / restart / independent read-back：成功基线 Reload 后回复恢复；Harness Process Restart 后 Fresh Tab `id=50` 仍打开该 Session、Composer 可用、Agent / Skill / Notification / Task Monitor 入口存在、Console `warn/error=[]`。Root Task（根任务）独立只读 Browser Readback（浏览器回读）得到相同失败、恢复与 Fresh Tab Console 结果。
- Network boundary：本场景当时只固化 Loopback Provider（回环提供方）成功／失败请求与 Harness Session 权威日志，不能从该局部回执外推；当前逐入口状态以文末 Global Network Ledger 为准，已推进至 `4 / 30`。
- Result：`PASS`（Agent Market 选择、启动、Error / Disabled / Retry（错误／禁用／重试）、Failure Closure、恢复、刷新与进程重启；与搜索、Responsive（响应式）和包缺席／恢复场景共同闭合九轴）。

### REC-ORBS-REPLY-001

- Operation：在 Agent Market 启动的原生 Session 发送第二轮消息，并在慢速流式 Provider 仍运行时回读 Runtime Orb DOM；回复完成后再次回读。
- Active state：侧栏 Treeitem 显示 `进行中 R13_AGENT_OK`；原生状态为 `正在回复…`，`停止生成`可见。页面真实存在 `2` 个 `[data-paimind-runtime-orb]`，首个为 `data-orb-state=composing`、`data-placement=sidebar`；同时存在 `1` 个 `[data-paimind-runtime-status]`，`data-runtime-phase=replying`。
- Completed state：模型回复完成后，侧栏 `进行中` 和原生动态状态消失；Orb Count 从 `2` 变为 `0`，Runtime Status Count 从 `1` 变为 `0`，原生 Composer 回到 Disabled 空输入状态，最终消息仍可见。
- Host / Provider read-back：该轮属于 Session `session-67d1ab6b-57ff-4e27-96fb-7bbac08bb965`，Provider Attempt `4` 为 `slow_success`、`outcome=completed`、`chunksSent=8`；Session 真实完成第二个模型 Turn。
- Console / Network：无 `warn` / `error`；Provider HTTP/SSE Request / Result 完整完成。
- Result：`PASS`（Reply / Sidebar Orb 的运行到完成主路径）；Think、Tool、并行批次、Capability Switch、刷新、重启、错误渲染与缺席组合仍待测。

### REC-AGENT-RESP-420

- Regression：修复前真实页面中“我的智能体”Tab 右边界 `477 > innerWidth 420`，编辑与原生对话并排导致消息逐字符竖排，Result=`FAIL`。
- Operation：修复后真实进入中心、编辑、滚动内部表单、打开 Test Chat、聚焦底部返回按钮并返回中心。
- Visible feedback：三项 Tab 边界分别为 `72–180.66 / 183.66–292.33 / 295.33–403.98`；编辑 Region 为 `left=56,right=420,width=364`。内部滚动容器从顶部滚到 `scrollTop=535`（`scrollHeight=1174`,`clientHeight=639`），角色、目标、行为规范、会话技能与底部按钮均可达。
- Test Chat geometry：产品区 `left=56,right=420,top=0,bottom=503`；原生对话 `left=56,right=420,top=504,bottom=900`；返回按钮分别为 `70–230` 与 `238–398`。
- Focus：`测试对话` 与 `返回中心` 均进入 `:focus-visible`；返回中心焦点框 `left=238,right=398,top=449,bottom=487`，点击后回到中心。
- Host read-back：重开 Test Chat 绑定新的空白 Session `session-fd88e1fa-f6bb-4e85-b71b-3fd1992f93b2` 至同一 Preset / configVersion，证明 Harness blank-session dedupe 修复生效。
- Console：无 `warn` / `error`；根 `scrollWidth=420`。
- Network：未触发模型调用；逐请求 Network ledger 待补。
- Result：`PASS`（布局、真实滚动、Focus、Test Chat 连接、返回）；完整 Agent Runtime Entry 生命周期由包缺席／恢复与 Provider Failure / Recovery（提供方失败／恢复）场景共同闭合。

### REC-AGENT-RESP-760

- Operation：进入编辑、切换 Test Chat、等待连接、返回中心。
- Visible feedback：产品区 `left=56,right=356,width=300`；原生对话 `left=356,right=760,width=404`；页面可读且操作可达。
- Host read-back：Test Chat 进入 `Harness 原生测试对话已连接` 与 `测试对话已就绪`。
- Console：无 `warn` / `error`；`scrollWidth=760`。
- Network：未触发模型调用；逐请求 Network ledger 待补。
- Result：`PASS`。

### REC-AGENT-RESP-1100

- Operation：进入编辑、切换 Test Chat、等待连接、返回中心。
- Visible feedback：两栏桌面布局可读；模式 Tab `left=294,right=565,width=271`；原生输入区完整可达。
- Host read-back：出现 `Harness 原生测试对话已连接` 与 `测试对话已就绪`。
- Console：无 `warn` / `error`；`scrollWidth=1100`。
- Network：未触发模型调用；逐请求 Network ledger 待补。
- Result：`PASS`。

### REC-AGENT-RESP-1440

- Operation：进入编辑、切换 Test Chat、等待连接、返回中心。
- Visible feedback：编辑／测试 Region `left=280,right=579,width=299,height=1000`；模式 Tab `left=294,right=565,width=271`；原生输入区完整可达。
- Host read-back：出现 `Harness 原生测试对话已连接` 与 `测试对话已就绪`。
- Console：无 `warn` / `error`；`scrollWidth=1440`。
- Network：未触发模型调用；逐请求 Network ledger 待补。
- Result：`PASS`。

### REC-SCHEDULER-001

- Operation：从空状态创建 `R13 隔离工作区简报`，验证空名称 Required、保存、Enabled、立即运行时 Disabled、失败详情及打开结果会话。
- Visible feedback：任务创建成功；手动执行显示 `failed` 与 `Harness Session finished without an assistant result`；原生结果会话显示精确任务 Prompt 和 `MISSING_CREDENTIAL`；通知角标变为 `1`。
- Host read-back：Schedule `schedule:64572e74-d102-4a19-a75b-236137f54f40`、Run `run:2960d8dd-cc2e-45e8-87bf-1b46bddd7d6a`、Session `paimind-scheduled-3f631c9fa10195457b1b8571`、Notification `notification:9af8d2fc927e52086ca596bd7dc692a5` 均落在隔离 Home。
- Isolation failure：Session header 的 `cwd` 为 `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins/.dsh-home/profiles`，而不是 `/private/tmp/paimind-r13-e2e.slTHZt/workspace`。本次因缺少 API Key 在第一 Step 失败，未执行文件写入，但 Workspace Binding 不符合产品与隔离契约。
- Console：页面无 `warn` / `error`；业务错误在 Schedule / Session 中明确反馈。
- Network：模型请求在 Credentials Service 前失败关闭。
- Result：`FAIL`；修复并重跑前，Scheduler / Harness Adapter 不得升级为 PASS。

### REC-SCHEDULER-RECOVERY-001

- Regression fix：Harness Adapter 不再以 `process.cwd()` 静默替代业务 Workspace；Scheduler 保存 Harness Agent Action 时持久化严格的 `workspace-context@1`，缺少 Workspace 时在创建 Session 前 Failure Closure。
- Operation：在真实 Scheduler 页面编辑原任务并保存；页面显示 `任务已更新`。随后点击 `立即运行`，按钮在执行期间 Disabled，结果从运行中转为 `成功`；打开任务详情中的成功 Run，再由 `打开对话` 深链进入原生 Session。
- Visible feedback：历史同时保留 `2026/8/27 21:35:02 · 成功 · R13_PROVIDER_OK` 与 `2026/8/27 21:08:58 · 失败 · Harness Session finished without an assistant result`。成功 Session 显示两轮 `R13_PROVIDER_OK`、首 Token 耗时、吞吐和 `输入 6 tok · 输出 30 tok`。
- Host read-back：Schedule `schedule:64572e74-d102-4a19-a75b-236137f54f40` 的 `actionInput` 为 `{kind:"workspace-context",version:1,cwd:"/private/tmp/paimind-r13-e2e.slTHZt/workspace",agentPreset:"r13-19f517"}`。成功 Run 为 `run:b0c79d5c-2d66-46c8-9f1c-f6907541328c`，`status=succeeded`、`message=R13_PROVIDER_OK`；Session 为 `paimind-scheduled-c90e6f76d4dfca1425bba4bc`。
- Provider / Session receipt：真实 `deepseek-official` Shipping Adapter 通过 Loopback OpenAI-compatible HTTP/SSE 调用 Deterministic Provider；Provider 记录两个 `slow_success` Request / Result，均 Completed、`chunksSent=6`。Session JSONL 有真实 `assistant/chunk`、两条 `assistant/message`（`source.kind=model`、provider `deepseek-official`、model `deepseek-v4-flash`）与两次 `turn/end completed`，没有 `MISSING_CREDENTIAL`。
- Console / Network：成功 Run、Session 和 Task Monitor 页面均无 `warn` / `error`；Provider Receipt 证明两次真实 HTTP/SSE 请求完成且无 Reset / Error。
- Independent receipt：根任务只读独立 Browser 回执为 `/Users/hansen/.codex/visualizations/2026/08/27/01a042cf-d6ae-7930-b2b7-f09b0a568687/product-r13-scheduler-browser-receipt.md`，SHA-256 `70b095dd6d4d79276eb9709c0eb879c015bddbd6c526ffec383a9b21699acf2a`；其范围明确不覆盖创建、编辑、删除、其他视口与重启。
- Result：`PASS`（失败修复后的成功执行与原生结果深链）；创建证据沿用前序 FAIL Receipt，归档、刷新、进程重启和其他视口仍单独验收。

### REC-SCHEDULER-ARCHIVE-001

- Contract boundary：本产品的 canonical delete intent 按 `docs/standards/platform-scheduler-backend-standard.md` 映射为 Archive；产品契约没有 Hard Delete，目的是保留 Run / Audit 历史。因此本回执不把归档描述成物理删除。
- Operation：在真实 Scheduler 活动列表点击测试任务的 `归档`。
- Visible feedback：页面立即显示 `任务已归档，运行历史仍保留`，`全部`活动视图变为 `没有符合当前条件的平台定时任务。`；切换 `已归档` 后只读回看到同一任务 `状态 已归档`、`下次执行 —`、`最近结果 成功` 与 `恢复任务`。
- Host read-back：Definition `schedule:64572e74-d102-4a19-a75b-236137f54f40` 变为 `status=archived`、`archivedAt=2026-08-27T13:38:47.153Z`、无 `nextRunAt`；Audit 新增 `operation=archived`。成功／失败 Run 均保留，符合产品 Contract。
- Console / Network：归档和筛选页无 `warn` / `error`；写入完成后浏览器立即回读 canonical store 的新版本 `b5aa7ca6-4c26-41ae-9539-91ad8602a0d6`。
- Result：`PASS`（产品定义的删除意图／归档）；Harness 重启后的归档持久化仍待单独验证。

### REC-NOTIFICATION-001

- Operation：打开通知中心，展开 `R13 隔离工作区简报 已完成`，确认正文 `R13_PROVIDER_OK`，再点击 `打开会话`。
- Visible feedback：成功通知标记为 `已完成`；打开后准确进入 Session `paimind-scheduled-c90e6f76d4dfca1425bba4bc`，页面显示两轮模型回复。通知未读计数从 `2` 降为 `1`，失败通知继续保留为未读，不发生批量误更新。
- Host read-back：Notification `notification:1fa33a40a17118fa41081eae4ae013a7` 为 `level=success`、`body=R13_PROVIDER_OK`，Target 精确指向成功 Session，并写入 `readAt=1787837875484`；失败通知对象保持独立。
- Console / Network：页面无 `warn` / `error`；目标 Session 的 Provider Receipt 与 `REC-SCHEDULER-RECOVERY-001` 一致。
- Result：`PASS`（可信 Producer、单条已读、精确导航）；全部已读、刷新、重启和关闭包行为仍待测。

### REC-TASKMONITOR-001

- Operation：在成功 Session 打开 Task Monitor，展开 `历史任务 1 项` 和 `详情与日志`。
- Visible feedback：当前原生状态为 `空闲`；历史 Job 显示 `Scheduled action · Agent · Create a session and generate a workspace brief`、`paimind-schedule · R13_PROVIDER_OK`、`已完成 · 0s`；详情提供下载日志按钮。
- Host read-back：页面回读 Session `paimind-scheduled-c90e6f76d4dfca1425bba4bc`、provider `deepseek-official`、model `deepseek-v4-flash` 与 `Jobs=1`，和 Scheduler / Session 存储一致。
- Console / Network：无 `warn` / `error`；Provider 侧两次 HTTP/SSE Request / Result 均完成。
- Result：`PASS`（成功 Job、日志与模型归属检查）；Artifact Job、失败 Job 导航、刷新、重启和关闭包行为仍待测。

### REC-HTML-ARTIFACT-001

- Operation：在 Agent Market 创建的原生 Session 输入 `生成一个 R13 HTML 验收产物并在完成后告诉我结果。`。Shipping LLM Adapter 返回真实 `generate_html_artifact` Tool Call；完成后点击 Conversation Artifact Card 的 `预览网页`，再在 Better Sidebar Viewer 切换 `编辑`，修改正文并 `保存`，最后返回 `预览`。
- Visible feedback：Conversation 依次显示 `Tool call generate_html_artifact · deliverables/r13-artifact.html`、`paimind-artifact ... [status: completed, html revision 1]`、模型回复 `R13_HTML_OK` 与 `已生成文件 1`。Artifact Card 为 `网页文档 · 可用`。Viewer 的 Sandboxed iframe 首次显示 `R13_HTML_ARTIFACT_OK` 与可交互按钮，编辑保存后显示 `R13_HTML_EDIT_OK` 与 `修订按钮`；Task Manager 同时显示 `R13 HTML 验收产物 已完成 · html revision 1`。
- Host read-back：Session `session-67d1ab6b-57ff-4e27-96fb-7bbac08bb965` 保存 model Tool Call、`tool/call`、`tool/result isError=false`、Plugin Job Notice 与最终 `assistant/message source.kind=model`。Projection Cache 权威对象为 Artifact `artifact:e1514681218848f807815958`、Workspace `e6fdae22-921e-4745-b1c5-fa8f6edaf548`、`kind=html`、`previewKind=html-document`、`producerId=paimind.generator.html-document`、`state=available`、`taskId=paimind-artifact-1`。
- File read-back：输出位于隔离 Workspace `/private/tmp/paimind-r13-e2e.slTHZt/workspace/deliverables/r13-artifact.html`；Viewer 保存后的 SHA-256 为 `1ee10feddbb2a7abd76b290fc7c6cb63d3e266c383d72f21538ad5dfa29c5562`，重新预览可见修订正文。
- Console / Network：页面无新增 `warn` / `error`；Provider 精确记录一次 `tool_call_success` 与随后一次 `success`，两次 `/v1/chat/completions` 均 `outcome=completed`，分别 `chunksSent=4/5`。
- Result：`PASS`（HTML 生成、Native Job、Artifact Projection、Conversation Card、Sidebar Viewer、Edit / Save 主路径）；Permission Failure、刷新、重启、包关闭和缺席组合仍待测。

### REC-PPTX-ARTIFACT-001

- Operation：在已有 HTML Tool Call 的同一 Session 请求两页 PPTX；模型调用 `generate_presentation_artifact`，页面生成 `R13 演示文稿验收`，打开 Office Viewer 并从第 `1 / 2` 页点击 `下一页` 到 `2 / 2`。
- Visible output：第 1 页显示 `R13 首页 / R13_PPTX_SLIDE_1 / 真实 Office 产物`；第 2 页显示 `R13 结论 / R13_PPTX_SLIDE_2 / 可回读`。Conversation Card、Native Job 与文件均可见。
- Failure：测试 Provider 在不同 Turn 重启后仍固定复用 Tool Call ID `mock-call-1`。Harness Client Console 抛出 `[web-runtime] connection sink threw: Error: conversation Context 9:tool-callmock-call-1 received more than one start Match`。这是真实 Console Error，不能因为文件与 Viewer 可用而判定通过。
- Root cause / closure plan：问题来自隔离 Deterministic Provider 的固定 ID，不是手写 JSONL 或 Mock UI。后续每个 Tool Call 使用独立新 Session，确保 Session 内 Tool Call ID 唯一；重新运行 HTML / PPTX 并验证新 Session Console / Network 干净后再升级。
- Result：`FAIL`；保留失败回执，等待隔离 Provider 场景修复后的 Browser Regression。

### REC-HTML-ARTIFACT-REGRESSION-001

- Fix strategy：不修改上游 Provider Fixture；每个 Tool Call 放入新的原生 Session，使固定 `mock-call-1` 在 Session Context 内保持唯一。新开一张 Browser Tab 清空旧 Console Ledger，并重新加载真实 Harness。
- Operation：在新 Session 请求 HTML 回归产物；模型调用 `generate_html_artifact`，完成 Job 与 Artifact Projection，点击 Conversation Card 打开 Viewer。根任务独立 Browser Check 另行确认 Preview / Edit / Save / Refresh 与 iframe `回归按钮`均可见。
- Visible feedback：Session 标题 `R13_HTML_REGRESSION_OK`；Conversation 显示准确 Tool 名／路径、Native Job `completed, html revision 1`、模型回复和 `网页文档 · 可用`卡片；Viewer iframe 显示 `R13_HTML_REGRESSION_OK` 与 `回归按钮`。
- Host read-back：Session `session-b703c999-8866-42fe-91ef-e1638759d784`；Artifact `artifact:f8a4bfda3f0e83e9dd2c3e23`、`producerId=paimind.generator.html-document`、`taskId=paimind-artifact-3`、`state=available`。文件 SHA-256 `dc292730804d0341881111051752c0136342e3c59811ead3477d7f77ee1ea265`。
- Console / Network：干净 Browser Tab 无 `warn` / `error`；Provider 的 `tool_call_success`、Title / Follow-up Success 三次 Request 均完成。
- Result：`PASS`（Duplicate Tool Call Failure 的新 Session Closure）；旧 Session 的不可改写失败历史继续保留。

### REC-HTML-ARTIFACT-INTERACTION-001

- Operation：在进程重启后的真实 `R13_HTML_REGRESSION_OK` Session 回读 `generate_html_artifact · deliverables/r13-html-regression.html` Tool Call、completed Native Job、模型回复和 `网页文档 · 可用` Artifact Card；点击卡片从会话进入 Better Sidebar HTML Viewer。
- Browser interaction：真实执行 Preview → Edit，在 Editor Textbox 键入 `R13_HTML_RESPONSIVE_OK` 与 viewport metadata，点击 Save 后返回 Preview，再点击 Refresh；iframe 同时显示标题、标记和 `回归按钮`，全程 `warn/error=[]`。
- Host read-back：文件 `/private/tmp/paimind-r13-e2e.slTHZt/workspace/deliverables/r13-html-regression.html` 为 `289` bytes，SHA-256 `6174f75a081295a0fe08fa4dd8c1d2990d1e63236c7e7f948e59dc23e5db2cfc`，磁盘内容与 Viewer 标记一致。
- Keyboard / responsive boundary：Artifact Card 的 Driver-level Enter 未激活，与本轮已知 Browser Driver 输入限制一致；当前 In-app Browser API 也未提供可用 Viewport Resize。没有系统键盘和 `420 / 760 / 1100 / 1440` 几何回读时不得写为 PASS。
- Result：`PASS (supporting)`（仅真实 Artifact Card Pointer Main Path、Edit / Save / Refresh 与 Host Read-back）；三项在本 Attempt 当时继续 `PENDING`，后续 System Keyboard Closure 见 `REC-ARTIFACT-CARD-SYSTEM-KEYBOARD-001`。

### REC-HTML-RESPONSIVE-ATTEMPT-001

- Operation：把已持久化的 `r13-html-regression.html` 保持在 Better Sidebar HTML Viewer 中，将真实 Browser Viewport 切换为 `420x900` 并执行视觉和几何回读。
- Failure：Viewer Shell 的 `documentElement.scrollWidth=420`，但 iframe 中无断点样式的长标题 `R13_HTML_REGRESSION_OK` 被右边界裁切；`scrollWidth` 没有暴露为外层横向滚动，因此不能以“页面无横向滚动”判定可用。旧 Artifact 源文件只有 viewport metadata，没有长词换行或 Mobile-safe CSS。
- Root cause：`@paimind/generator-web` 只原样发布模型 HTML，System Prompt 与 Tool Input Description 没有要求 UTF-8 / viewport metadata、Responsive Layout、长词换行和 `420 CSS px` 无横向溢出。该缺口会让模型生成的独立页面在移动端形成可见裁切。
- Result：`FAIL`。保留旧文件 `289` bytes、SHA-256 `6174f75a081295a0fe08fa4dd8c1d2990d1e63236c7e7f948e59dc23e5db2cfc` 与 420px 视觉 Attempt，不用后续 Recovery 覆盖。

### REC-HTML-RESPONSIVE-RECOVERY-001

- Fix：`@paimind/generator-web` 的真实 System Prompt 与 HTML 参数说明新增 UTF-8、viewport、Responsive Layout、long-token wrapping、禁止 fixed viewport-wide dimensions 和 `420 CSS px` horizontal overflow 契约；不修改或包裹用户已提供的 HTML。首次 Targeted Test 错把封装后的 Harness Tool 当作原始 Definition 读取而失败，随后把断言移到稳定 System Prompt Contract 后重跑通过。
- Real model chain：隔离 Provider 收到 `R13_HTML_RESPONSIVE_GENERATE`，Request `r13-skill-provider-1` 同时回读 `htmlToolAvailable=true`、`responsivePromptObserved=true`，经真实 `/v1/chat/completions` SSE 发出 `generate_html_artifact` Tool Call；Request `r13-skill-provider-3` 回读 Tool Result 后返回 `R13_HTML_RESPONSIVE_RECOVERY_OK R13_HTML_PROMPT_CONTRACT_OK`。页面显示真实 Tool、completed Native Job、模型回复和 `网页文档 · 可用` Artifact Card。
- Browser interaction：点击 Artifact Card 打开真实 File Tab；iframe 显示 `R13_HTML_RESPONSIVE_RECOVERY_OK`、`R13_HTML_MOBILE_SAFE_420` 和 `回归按钮`。Pointer 点击按钮后 iframe `activeElement=BUTTON`；切换 Edit，在真实 Contenteditable Editor 写入 `R13_HTML_BROWSER_EDIT_SAVE_OK`，点击 Save → Preview → Refresh，标记可见。页面 Reload 与 about:blank Back → Forward 均恢复 Session、Tool、Artifact、File Tab 和编辑标记。
- Responsive geometry：`1440/1100/760/420` 四档外层 `scrollWidth === innerWidth`；iframe 分别为 `447/447`、`447/447`、`759/759`、`419/419`（`scrollWidth/clientWidth`）。420px 下标题在 `left=17,right=402` 内完整换行，按钮高度 `44px`；Preview / Edit / Save / Refresh / File Tree 均落在 `0..420` 内。四档 DOM 都回读完整标题、移动端标记和按钮。
- Restart：隔离 Runtime 从 PID `40667` 主动停止并在同一 Home / Workspace / `62617 --no-open` 重启为 PID `42288`。稳态 Fresh Tab 搜索原 Session 后，Tool、Artifact Card、File Tab、生成标记和 Browser Edit / Save 标记全部恢复，`warn/error=[]`。
- Host read-back：Session `session-f9330c51-ac54-4cac-ab47-17c6a8249dfe`，Workspace `e6fdae22-921e-4745-b1c5-fa8f6edaf548`，Artifact `artifact:637380b43fb8d9fda8623706`，`producerId=paimind.generator.html-document`，Task `paimind-artifact-1`，`state=available`。Session JSONL SHA-256 `f393968956e5a17fa5df71b400890d0d8fd96c1e2e792d48cd95340a6ca0a50a`；浏览器保存后的文件为 `664` bytes、SHA-256 `da841b583c867180fb13455b73293daf7e8a4cfd2030912696e857d906ddc522`。JSONL 含真实 `assistant/message source.kind=model` 与 `turn/end completed`，不是手写 Session。
- Keyboard boundary：Artifact Card 的 in-app Driver Enter 旧 Attempt 继续无效；本轮 in-app CUA / DOM-CUA 的 `Shift+Tab` 也退回 `BODY`。Chrome Extension 可以列出标签页，但新标签导航与现有标签 Claim 持续超时，因此该 Scenario 当时没有伪写 System Keyboard PASS。该 Scenario 的 Pointer、Focus、Responsive、Reload / Navigation、Restart、Console 与 Host 链为 PASS；后续独立系统键盘闭环见 `REC-ARTIFACT-CARD-SYSTEM-KEYBOARD-001`。
- Supporting gates：`packages/generator-web/tests/provider.spec.ts` 为 `1 file / 3 tests PASS`，Package Typecheck、Root Build 与 `git diff --check` PASS。
- Result：`PASS`（Responsive Output Contract、真实生成、Viewer、Browser Edit / Save、四档几何、Reload / Back / Forward 与 Process Restart Recovery）；System Keyboard 在本 Scenario 当时仍为 `PENDING`，现由 `REC-ARTIFACT-CARD-SYSTEM-KEYBOARD-001` 闭合。

### REC-ARTIFACT-CARD-SYSTEM-KEYBOARD-001

- Preserved failure：在原 `R13_HTML_RESPONSIVE_RECOVERY_OK` Session 再次请求同一路径时，真实 Generator 以 `generation_failed` 拒绝未先读取即覆盖 `/private/tmp/paimind-r13-e2e.slTHZt/workspace/deliverables/r13-html-responsive-recovery.html`；Conversation、Task Manager 与 Tool Result 均显示失败，没有产生假成功。该 Attempt 不用后续成功 Session 覆盖。
- Real model chain：隔离 Deterministic Provider 新增唯一 Marker `R13_HTML_KEYBOARD_GENERATE`，Request `r13-skill-provider-1` 回读 `htmlKeyboardObserved=true`、`htmlToolAvailable=true`、`contextObserved=true`，经真实 `/v1/chat/completions` SSE 发出 `generate_html_artifact`；Request `r13-skill-provider-3` 消费真实 Tool Result。原生 Session `session-155ce547-4a43-4c80-9396-7a178ad38066` 显示 Tool `deliverables/r13-html-keyboard-activation.html`、completed Job `html revision 1`、模型回复 `R13_HTML_KEYBOARD_ARTIFACT_OK` 与 `网页文档 · 可用` Artifact Card。
- System keyboard：Chrome System Keyboard 从 Composer 真实连续执行 `Shift+Tab`，Focus 依次回读 `在新对话中分支`、反馈按钮、`复制`，最终落到 `预览网页: R13 HTML Keyboard Activation` Artifact Card；系统 `Return` 后 Better Sidebar 直接打开 File Tab，iframe 显示 `R13_HTML_KEYBOARD_ARTIFACT_OK`、`R13_HTML_MOBILE_SAFE_420` 与 `回归按钮`。未使用 Locator `press`、脚本派发事件或模拟 UI。
- Reload / Host read-back：真实页面 Reload 后同一 Session、Tool、Artifact Card、File Tab 和 iframe Button 全部直接恢复，Chrome `warn/error=[]`。Session JSONL SHA-256 `62990c186bdddef53df1a8fcad953cae7df45a0a98fbd3d934a91621967cef05`，含真实 `assistant/chunk`、`assistant/message source.kind=model provider=deepseek-official model=deepseek-v4-flash` 与 `turn/end completed`；HTML 文件 SHA-256 `7e2070f66b41ca57224da821ddca3cb59634d3d1e9d1cff49bf3ebc090662f4a`。
- Boot isolation：首次把“六包全关”继续用于归因属于无效 Attempt；权威 `settings.yaml` 当时已经是 `content=true`、其余五包与 Runtime Orbs 关闭，因此只代表 Content-only 状态。该状态在同一 Home 重启后，旧 `62617` Origin 的一个 Chrome Fresh Tab 停在 `Loading plugins…` 超过 50 秒；13 个页面脚本均 `HTTP 200`、约 `0.001–0.002s`，Console 无 Import Error，故保留为 Browser Module Activation / Origin Recovery Attempt。随后同一 Home、同一 Content-only Settings 切换随机端口 `61353 --no-open`，全新 Chrome Tab 在 12 秒窗口内完整出现 Shell、Settings 与 Session，选择旧 Session 后 Tool、Job、Artifact Card、`网页文档 · 可用` 和模型回复全部恢复，`warn/error=[]`。因此不把旧 Origin Attempt 归因为 Content Pack 缺包或静态资源失败。
- Settings restoration：通过真实 Extension Center 依次恢复 Product Experience、Runtime Orbs、Agent Center 与 Proposal；最终 Host 覆写为 `runtime-orbs=true, content=true, proposal=true, automation=false, operations=false, agents=true, experience=true`，`settings.yaml` SHA-256 `83e877ed35078b837f41895ba4d1ce58b2935d0f99a2ca0a087f4f4ec3086e06`，与本轮诊断前隔离基线一致。
- Result：`PASS`（Artifact Card 独立 System Keyboard Activation、真实模型／Tool／Job／Artifact／Viewer、Reload、随机端口 Cold Boot 与 Host Recovery）；结合既有九轴证据，`@paimind/generator-web`、`@paimind/artifacts`、`@paimind/conversation-artifact-renderer` 成为第 `15–17 / 30` 个完整 Runtime Entry。Global Network Ledger 仍严格保持 `4 / 30`，不从本场景外推其他入口。

### REC-WORKSPACE-PROJECT-001

- Core action：在真实 `workspace` 树下点击 Native New Session，打开 `选择工作区`菜单并点击 `workspace`，随后从 Composer 发送 `R13_WORKSPACE_PROJECT_OK`。页面在该 Workspace 分组下生成 `R13_WORKSPACE_PROJECT_OK` Session，显示真实模型回复和可继续输入的 Composer。
- Browser QA：空 Session 显示 `今天想完成什么？`、Workspace Selector、Empty State 与 Disabled Send；Pointer 展开 Selector 后可见 `workspace` 与 `添加工作区…`。`1440/1100/760/420` 四档外层 `scrollWidth === innerWidth`；Workspace Selector 的边界分别为 `470..589`、`316..435`、`92..211`、`86..205`，420px 下 Composer 为 `83..385`，核心操作均可达。Reload 保留空状态和 Workspace；搜索恢复真实模型 Session 后用户消息、助手回复和 Composer 全部可见，`warn/error=[]`。
- Keyboard / Focus：独立 Chrome System Keyboard Receipt 已证明从 Composer 真实 `Shift+Tab` 可把焦点链送达 `选择工作区`；本场景 Pointer 完成菜单展开和选择。引用 `/Users/hansen/.codex/visualizations/2026/08/27/01a042c0-a240-7230-b639-7a9ee41c500a/R13-chrome-system-keyboard-root-verification.md`，SHA-256 `78b27e2c8fd859001970c8dfcdb9b80e3e52a45aa63ee0e5988355efc1ef9a95`；不把 Settings 按钮的 Enter 结果外推为 Workspace Selector 激活。
- Host read-back：Session `session-409fa98d-031d-4517-90a1-8b9855a0430b` 位于编码后的 Workspace 目录 `--private-tmp-paimind-r13-e2e.slTHZt-workspace--`；Request Header 回读 Provider `deepseek-official`、Model `deepseek-v4-flash` 且 System cwd 为 `/private/tmp/paimind-r13-e2e.slTHZt/workspace`。JSONL SHA-256 `8af1aa07175f35a515381fc9f91d3fad18b31ef970362d7136114d1cc17c71b7`，包含 `assistant/message source.kind=model` 与 `turn/end completed`。
- Restart：隔离 Runtime 主动重启后，全新 Browser Tab 直接恢复 `workspace → R13_WORKSPACE_PROJECT_OK`、助手回复和 Composer；Fresh Tab `warn/error=[]`。此前 Content 九包 Physical Absence、Rejected Enable、Reload / Restart 和 Reinstall 已覆盖 OD / FC / AB 与恢复边界。
- Supporting gates：`packages/workspace-project/tests` 为 `4 files / 9 tests PASS`，Package Typecheck 与 Root Build PASS。
- Result：`PASS`（九项 Lifecycle Evidence 与 Browser QA）；`@paimind/workspace-project` 成为第 `14 / 30` 个完整 Runtime Entry。

### REC-CONTENT-NETWORK-LEDGER-001

- Browser boundary：同一稳态 Fresh Tab 中分别完成 Workspace New Session / Selector / Model Reply、HTML Model Tool / Job / Artifact Card、Artifact Projection → Viewer 路由、Conversation Turn Card → File Tab；四条路径均有可见业务结果，Reload / Navigation / Process Restart 后仍可重放，页面 `dev.logs(warn,error)=[]`。主动重启窗口的旧 Tab 连接中断不计入稳态账本，也未隐藏。
- Boot / static requests：重启后根页 `HTTP 200`、`20,568` bytes、约 `1.98ms`、SHA-256 `60ebf4409725780612ebd0b78ece219f217ed91ad46862a535262a019d5a7578`。Boot Payload 精确登记四个入口；Client Bundle 回读分别为 `workspace-project HTTP 200 / 4,618 bytes / 1.53ms / c511b686…`、`generator-web HTTP 200 / 5,550 bytes / 1.65ms / 6a72d884…`、`artifacts HTTP 200 / 57,186 bytes / 1.10ms / b079c6f3…`、`conversation-artifact-renderer HTTP 200 / 23,099 bytes / 1.00ms / 7781827c…`。
- Runtime requests：Workspace Provider Request SHA-256 `37d26bdb2017cb21af7fb642dca120ede84f165fa4da02f7b0beecad92fd4e64` 完成并产生真实 model message；HTML Provider Request SHA-256 `1ae78bb7f533d9a7c644faf1ba43aa9c0d4689b7f9053a165191517848d9124d` 发出 Tool Call，后续 SHA-256 `8b68cd3f35b96d9df5eb17ebfd473f059ae1469fa4190c69a8b1329a4064bb1d` 消费 Tool Result 并完成。Artifact `state=available`、路径、Task 与 Browser Card / Viewer 一致。
- Error closure：Content 九包物理缺席时这些入口不会出现在 Boot Roster，不产生对缺失 Client Bundle 的假请求；错误启用会回滚 Settings / Loader，页面不显示假成功。恢复后精确资源为 200，真实业务路径与 Host JSONL 均完成。
- Result：`PASS (4 / 30)`，仅把 `@paimind/workspace-project`、`@paimind/generator-web`、`@paimind/artifacts`、`@paimind/conversation-artifact-renderer` 的 Network Request / Error Ledger 升级；其他 `26 / 30` 继续 `PENDING`，HTML 三项也不会仅因 Network PASS 跳过 System Keyboard 缺口。

### REC-PPTX-ARTIFACT-RECOVERY-001

- Operation：再创建一个独立新 Session 请求两页 PPTX；模型调用 `generate_presentation_artifact`，完成后打开 Office Viewer，从 `1 / 2` 点击 `下一页` 到 `2 / 2`。
- Visible feedback：Conversation 显示 Tool Call、Native Job `completed, pptx revision 1`、`R13_PPTX_REGRESSION_OK` 与 `PowerPoint 演示文稿 · 可用`。第 1 页回读 `R13 回归首页 / R13_PPTX_REGRESSION_1 / 真实模型 Tool Call`；第 2 页回读 `R13 回归结论 / R13_PPTX_REGRESSION_2 / Viewer 翻页通过`，Next 在末页 Disabled。
- Host read-back：Session `session-4ebe17e3-ff04-445b-af8d-5f7f736c939e`；Artifact `artifact:db165c008b92af661b42c7c9`、`producerId=paimind.generator.presentation`、`taskId=paimind-artifact-4`、`state=available`，Trace `trace:cb3c61e3d483cb028819a89a`。文件 SHA-256 `fa16d5f0be8ca214a755dc37e5fc458df85b53d83121cd593a23f1129e32aa18`。
- Console / Network：生成、打开和翻页的干净 Browser Tab 均无 `warn` / `error`；Provider 的 Tool / Title / Follow-up Request 均完成。
- Result：`PASS`（PPTX 主路径和 Duplicate Tool Call Closure）；Reload 行为见单独失败回执。

### REC-PPTX-RELOAD-001

- Operation：PPTX Viewer 停在第 `2 / 2` 页时执行真实页面 Reload；Session 历史、Tool Call、Job、模型回复和 Artifact Card 均恢复。
- Failure：持久 File Tab 同时恢复为 `此文件类型不支持预览`，没有自动重新匹配已经加载的 Office Viewer。直接再次点击 Artifact Card 仍复用错误 Tab；显式关闭该 File Tab 后再次点击 Card 才恢复 `1 / 2` Viewer，且 Console 仍干净。
- Scope：这与 Duplicate Tool Call 不同，是 Better Sidebar / Office Viewer 的 Reload Rehydration（重载再水合）缺口。主路径继续 PASS，但 `RF` 不能升级，直到修复后 Reload 直接恢复可用 Viewer。
- Result：`FAIL`（Refresh / Reload）；保留回执并进入修复队列。

### REC-PPTX-RELOAD-RECOVERY-001

- Root cause / fix：PPTX 文件和 Artifact Projection 均正确；失败来自持久 Editor Tab 先于 Office Viewer Registry 完成注册时，EditorHost 不会自动重新匹配 Viewer。`@paimind/better-sidebar-adapter` 现订阅 Provider 的公开 Registry / State 契约，在 Viewer 列表稳定后只对当前 Session 恢复出的 Editor Tab 执行一次去重的 close-then-deferred-reopen；没有修改、复制或补丁化 Harness / Better Sidebar 源码。
- Operation：构建全部 PAIMind Package，确认 `lib/index.js` / `lib/client.js` 已包含恢复逻辑；仅重启隔离 `61888 --no-open` Runtime。全新 Browser Tab 自动恢复持久 PPTX Viewer 为 `1 / 2`，点击 `下一页` 到 `2 / 2`，随后连续两次真实页面 Reload。
- Visible feedback：进程重启、第一次 Reload 和第二次 Reload 后均无需手工关闭或重新点击 Artifact Card，Viewer 直接显示 `1 / 2`；翻页可见 `R13 回归结论 / R13_PPTX_REGRESSION_2 / Viewer 翻页通过`，末页 Next Disabled。`此文件类型不支持预览` 未再复现。
- Host / file read-back：Session `session-4ebe17e3-ff04-445b-af8d-5f7f736c939e`、Artifact `artifact:db165c008b92af661b42c7c9` 与 Trace `trace:cb3c61e3d483cb028819a89a` 保持不变；PPTX SHA-256 仍为 `fa16d5f0be8ca214a755dc37e5fc458df85b53d83121cd593a23f1129e32aa18`。
- Console / Network：本任务全新 Browser Tab 的连续回归无 Console Error；上层独立 Browser 回执确认两轮直接恢复均未复现 Viewer 错误。逐请求全局 Network Ledger 仍保留为横切 `PENDING`。
- Code gates：本任务更新后的 Adapter Targeted Test 为 `1 file / 12 tests PASS`，Package Typecheck 与完整 Build PASS。上层独立回执在前一版定向范围记录 `1 file / 11 tests PASS` 与 Package Typecheck PASS。
- Independent receipt：`/Users/hansen/.codex/visualizations/2026/08/27/01a042cf-d6ae-7930-b2b7-f09b0a568687/product-r13-pptx-reload-recovery-receipt.md`，SHA-256 `ecd27d2006d97610494211f83360ff9ca06cfe75784cf394636b200ec432945f`。
- Result：`PASS`（仅 PPTX `RF` 的 Reload Rehydration）；原 `R13-PPTX-RELOAD-001` 继续作为 Attempt 1 FAIL 保留，其他 Office Format、Lifecycle、Responsive 与完整门禁不外推。

### REC-XLSX-CACHED-RESULT-ATTEMPT-001

- Operation：在真实原生 Session 请求“R13 销售分析 Excel”；隔离 Provider 经 Harness LLM Chain 调用 `generate_spreadsheet_artifact`，页面显示 completed Native Job、`电子表格 · 可用` Artifact Card 与模型回复 `R13_XLSX_OK`。打开 Better Sidebar Office Viewer 后，中文列名和原始数值可见。
- Failure：文件 `r13-sales-analysis.xlsx` 结构有效且包含 `SUM(B2:C2)` 等真实公式，但 Viewer 中 `D2:D4` 合计列为空。Generator 只写 Formula，没有 Cached Result；当前 Office Viewer 不负责重算工作簿，因此“Artifact 可用”形成用户可见假完整。
- File evidence：旧失败文件为 6.7 KB，SHA-256 `c4445536815714303f4291f2b9fdf551e831a5f187448e8378f8c0388c83e3b0`。
- Result：`FAIL`（真实 Viewer 可用性缺陷，保留）；恢复见下一条。

### REC-XLSX-CACHED-RESULT-RECOVERY-001

- Fix：`generate_spreadsheet_artifact` 的每个 Formula Contract 新增必填 scalar `result`；Generator 同时写入 ExcelJS `{formula,result}` 并设置 `fullCalcOnLoad`。缺失结果在 Tool Describe / CLI 两层明确拒绝，避免再次生成公式存在但浏览器空白的文件。
- Real model / Browser chain：Build 与隔离 Runtime Restart 后，新 Session 经真实 `generate_spreadsheet_artifact` Tool Call 生成 `r13-sales-analysis-recovery.xlsx`；页面显示 completed Job、`电子表格 · 可用` Artifact Card、模型回复 `R13_XLSX_RECOVERY_OK`。Viewer 直接显示华东／华南／华北和合计 `255 / 208 / 181`。
- Authoritative read-back：Session `session-df7fe93f-9c0e-4e87-8c28-04ca19e20a87`，JSONL SHA-256 `7fe83eee3e369428463ec96142e879ffab8dd3a6229b0784c860b8fd31db160d`；包含真实 `assistant/chunk`、`assistant/message source.kind=model`（provider `deepseek-official`、model `deepseek-v4-flash`）和 `turn/end completed`。XLSX 为 6.8 KB，SHA-256 `639001213783264f519f8e0129a2c5715f9eb777b45107b7fef47c1a3011e701`，`unzip -t` 无错误；ExcelJS 回读 `D2={formula:"SUM(B2:C2)",result:255}`、`D3=208`、`D4=181`。
- Reload / responsive：保持 File Tab 真实 Reload 后，同一 Session、Workbook Tab、Sheet Tab 与三个结果自动恢复，Console `warn/error=[]`。`420 / 760 / 1100 / 1440 CSS px` 四档 `documentElement.scrollWidth === innerWidth`，Sheet Tab 均可见；420 档使用 Viewer 内部横向滚动承载表格宽度，页面本身不产生横向溢出。
- Supporting gates：Generator Office `1 file / 6 tests PASS`、Package Typecheck、Root Build 与 `git diff --check` PASS。这里只证明本缺陷回归，不升级 Final Gates。
- Result：`PASS`（XLSX Tool / Job / Artifact / Viewer / Formula / Cached Result / Reload / Responsive 主路径）；Content Pack Off / Failure Closure / Process Restart / Package-absent Boot 与逐入口 Network Ledger 仍 `PENDING`。

### REC-XLSX-UNMOUNT-ATTEMPT-001

- Failure：保持真实 `r13-sales-analysis.xlsx` Office Viewer 打开并切换 Harness Session，或直接关闭该 File Tab，页面稳定产生两条 `NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.`。文件内容和 Viewer 初次加载正常，错误只发生在 Univer Imperative Tree（命令式树）卸载阶段。
- Attempt：先把持久 Editor 绑定到初次加载它的 Session Scope，避免 Session 改变直接触发 Provider Viewer Effect Cleanup；真实 Browser 仍复现。
- Result：`FAIL`（Attempt 1，保留）。

### REC-XLSX-UNMOUNT-ATTEMPT-002

- Attempt：在 Adapter 内加入 Provider-owned DOM Lifecycle Boundary（提供方 DOM 生命周期边界），让 Office Viewer 在外层 Harness Tab 删除前先完成清理。
- Browser read-back：XLSX 可打开，显式关闭后 Viewer 消失，但同一时间戳仍记录两条 `removeChild` Error。
- Result：`FAIL`（Attempt 2，保留）。

### REC-XLSX-UNMOUNT-ATTEMPT-003

- Attempt：把 Office Viewer 移入独立 `react-dom/client` Root，先在仍连接的 Boundary Host 内执行 `root.unmount()`，再允许 Harness Root 清理外层 Tab。
- Browser read-back：全新 Runtime 与全新 Browser Tab 仍在显式关闭后产生两条相同 Error；证明单纯隔离 React Root 不足以处理 Provider 已完成的重复 DOM 删除。
- Result：`FAIL`（Attempt 3，保留）。

### REC-XLSX-UNMOUNT-ATTEMPT-004

- Attempt：仅标记 Office Boundary Subtree，并把已经完成的 `removeChild` 变为幂等；普通未标记 DOM 仍保持原生抛错语义。
- Failure / root cause：Targeted Test 与 Package Typecheck 均通过，但 Browser 显式关闭仍出现两条 Error。保护在 Child `componentWillUnmount` 返回时被同步撤销，而外层 React 在随后同一个 Commit 才继续删除 Tab Subtree，因此真实重复删除发生时 Guard 已恢复为原生实现。
- Result：`FAIL`（Attempt 4，保留）。

### REC-XLSX-UNMOUNT-RECOVERY-001

- Fix：Office Cleanup Guard 仍只接受已标记 Office Tree 的 stale removal；最后一个 Viewer 卸载后延迟 `250ms` 恢复原生 `Node.prototype.removeChild`，覆盖父 React Commit 的剩余清理回合。Guard 激活期内普通未标记 DOM 的 stale removal 仍抛错，避免把全局 DOM Bug 静默吞掉。
- Real Browser regression：隔离 `62617 --no-open` Runtime Build / Restart 后，全新页面打开 `R13_XLSX_OK`，从真实 Files Tree 打开 `r13-sales-analysis.xlsx`，Sheet `销售分析` 与 Zoom `100%` 可见。显式关闭后 Viewer 消失且 `warn/error=[]`；重新打开后切到 `R13_BENTO_OK`、再返回 `R13_XLSX_OK`，Viewer 保持可用且无 Column Width / removeChild Error。
- Reload / restart：同一页面 Reload 后 Session 与 XLSX Viewer 自动恢复且日志干净；主动从 Listener PID `34807` 重启隔离 Harness 后，全新 Browser Tab 再次恢复 `R13_XLSX_OK`、`销售分析` 与 `100%`，`warn/error=[]`。重启后再次显式关闭，Viewer 正常消失且日志仍为空。
- Supporting gates：Adapter Targeted Test `1 file / 14 tests PASS`，Package Typecheck、Root Build 与 `git diff --check` PASS。前四次 Browser FAIL 全部保留，不用本次结果覆盖。
- Result：`PASS`（仅 Better Sidebar Office Viewer 的 close / Session switch / reload / process-restart cleanup recovery）；不外推 Generator Office Failure Closure、Content Entry 全九轴或 Global Network Ledger。

### REC-PDF-FONT-001

- Operation：在真实原生 Session 中调用 `generate_pdf_artifact`，用 WOFF2 / variable-font 路径生成中文 PDF，并从 Conversation Artifact Card 打开 PDF Viewer。
- Failure：文件结构可打开，但真实 PDF.js Viewer 中文正文为空白，Console 出现 `Invalid font data in ArrayBuffer`。文件存在或工具状态 `completed` 不足以判定可用。
- Root cause：旧实现把 Web Font 资源直接交给 PDF embedding 路径；该资源不满足当前 PDF.js / PDF embedding 组合的字体数据要求。
- Closure：Generator 改用 PDFKit 与 `@embedpdf/fonts-sc` 的 `NotoSansHans-Regular.otf`，以 embedded/subset Unicode CID Type0C 字体生成；最终回归见 `REC-PDF-STRUCTURE-RECOVERY-001`。
- Result：`FAIL`（Attempt 1，保留）。

### REC-PDF-NAVIGATION-001

- Failure attempt：持久 File Tab 正打开旧 `r13-report-recovery.pdf` 时，两张全新 in-app Browser Tab 在 30 秒内未完成导航，第三次 `Page.navigate` 约 22 秒超时；服务端同时 `curl` HTTP 200、约 `1.5ms`，因此不能以服务端存活替代 Browser 可用性。
- Comparison：关闭五个持久 PDF Tab 后，三次全新 Tab 导航分别约 `1313 / 1028 / 1029ms` 并可交互，说明旧 Viewer / Tab 恢复组合曾造成 Browser 级阻塞；未发现文件体积本身足以解释该阻塞。
- Recovery read-back：最终 PDF File Tab 保持打开时，再创建全新 Browser Tab，`1688ms` 完成导航，自动恢复同一 Session 与 `1 / 3`、`100%` Viewer，Console `warn/error=0`。
- Runtime boundary：期间出现过 `ERR_CONNECTION_REFUSED` / `curl HTTP 000`；其中一部分位于本任务主动 build/restart 窗口。无主动操作的 Runtime 生命周期稳定性仍单独保持 `PENDING`，不由本 Browser 导航恢复外推。
- Result：`FAIL`（原始导航 Attempt 保留）；Recovery 仅进入 `REC-PDF-STRUCTURE-RECOVERY-001`。

### REC-PDF-BROWSER-RECOVERY-001

- Independent receipt：`/Users/hansen/.codex/visualizations/2026/08/27/01a042cf-d6ae-7930-b2b7-f09b0a568687/product-r13-pdf-browser-recovery-receipt.md`，SHA-256 `ede75866d56ca1bb127b3d295c4872785fd4166584705e46cb9d8d1e10db0d55`。
- Browser scope：真实 Harness Session / Tool Call / Job / Artifact / File Tab；旧恢复文件在 Viewer 中显示中文，完成 `1 → 2 → 6`、末页 Next Disabled、`100 → 125%`、Reload 恢复 `1 / 6`、Back / Forward 与 `420x900` 无横向溢出，Fresh Tab Console `warn/error=0`。
- Limitation：该回执之后的权威文件检查发现六页中只有前三页含正文，后三页只有 Footer；`pdftotext` 同时输出三次 `Syntax Error: Restoring state when no valid states to pop`。因此本行只保留当时 Browser Interaction 的独立事实，不能继续作为最终文件结构 PASS。
- Result：`PASS (superseded file)`；文件结构失败和最终恢复分别见后续两条回执。

### REC-PDF-STRUCTURE-001

- Authoritative read-back：`r13-report-multipage-recovery.pdf` 为 `59,768` bytes、页面工具报告 `6` 页；低层 Content Stream 检查发现第 `4–6` 页均为 footer-only，且每页 `q=1 / Q=2 / depth=-1`。
- Failure：`pdftotext` 虽能回读中文，但输出三次 `Syntax Error: Restoring state when no valid states to pop`。文字中的 PAGE 标识和 Viewer 页码不能替代真实内容页与图形状态校验。
- Root cause：生成器在内容结束后把 Footer 写入 PDFKit 的 Bottom Margin，触发隐式追加页；Footer 的 graphics-state 恢复又落在无对应保存状态的流中。
- Fix：Footer 改到合法内容区 `page.height - 70`，生成后断言页数不扩张，并在测试中解析每页 Content Stream、断言 `q/Q` 平衡且深度不为负。
- Result：`FAIL`（Attempt 2，保留）。

### REC-PDF-STRUCTURE-RECOVERY-001

- Operation：在新原生 Session 请求最终结构修复 PDF；真实模型链调用 `generate_pdf_artifact`，生成 Job 与 Artifact Projection，模型最终回复 `R13_PDF_STRUCTURE_RECOVERY_OK`；点击 Conversation Artifact Card 打开 File Tab。
- Visible / model feedback：Session 标题 `R13_PDF_STRUCTURE_RECOVERY_OK`；可见 Tool Call `generate_pdf_artifact · deliverables/r13-report-multipage-final.pdf`、Native Job `R13 多页 PDF 最终验收报告 [status: completed, pdf revision 1]`、`PDF 文档 · 可用` 与模型消息。打开 Viewer 约 `1890ms`，中文标题、正文与页脚均可读。
- File / Host read-back：文件 `/private/tmp/paimind-r13-e2e.slTHZt/workspace/deliverables/r13-report-multipage-final.pdf`，`60,021` bytes，SHA-256 `8b540c31ee36ca3ea2ebd8203b640ff1959d9671a2b0a24646d30f6e0f790912`；真实 `3` 页 A4，embedded/subset Unicode CID Type0C `NotoSansHans-Regular`；`pdftotext` 输出 `10,566` bytes、中文可回读、`PDFTOTEXT_ERRORS=0`。Session `session-48924091-bb75-4621-b1a0-d627d09947e1`；Artifact `artifact:6686e732960a83bcd9acaf01`、`producerId=paimind.generator.pdf`、`taskId=paimind-artifact-1`、`state=available`。
- Pagination / Disabled：真实点击 `1 / 3 → 2 / 3 → 3 / 3`；每次换页 Viewer scrollTop 重置为 `0`，第一页 Prev Disabled、末页 Next Disabled。
- Zoom / stage focus：从 `100%` 降到 `75%` 时 Zoom Out Disabled，再升到 `200%` 时 Zoom In Disabled；`200%` 下 Stage 为 `clientWidth=495 / scrollWidth=958 / clientHeight=581 / scrollHeight=1342`。Stage 获得真实 Focus 后，Home 与 PageDown 把 `scrollTop` 从 `0` 移到 `465`。Toolbar Button 的系统级 Return / Space 激活由 `REC-PDF-TOOLBAR-KEYBOARD-001` 单独升级。
- Refresh / navigation：Reload `1572ms` 直接恢复持久 File Tab 为 `1 / 3`、`100%`；Back 到 `about:blank` 后 Forward `1725ms` 恢复同一 Session、Viewer `1 / 3` 与 `100%`，无需重新点击 Artifact Card。
- Responsive：`1440 / 1100 / 760 / 420 CSS px` 均真实打开同一 Viewer。Document / Body scrollWidth 分别等于 viewport；420 下 Viewer `left=1,right=420,width=419`，Toolbar 自动换行，所有按钮与 Download 均在 `x=13–315` 范围内，中文页面可读。
- Fresh tab / Console：最终 File Tab 保持打开时，全新 Tab `1688ms` 完成导航并恢复 `1 / 3`、`100%`；原 Tab 与 Fresh Tab 均无 Console `warn/error`，页面未显示 Network Error。逐请求全局 Network Ledger 仍为横切 `PENDING`。
- Runtime stability：`2026-08-27T22:32:41+0800` 回读 `61888` 为 HTTP 200、`1.3ms`，PID `43618` 持续 LISTEN；Provider `54338` PID `43509` LISTEN。历史非主动退出尚未形成完整进程根因与长期采样，本条不升级 `RS`。
- Independent final receipt：`/Users/hansen/.codex/visualizations/2026/08/27/01a042cf-d6ae-7930-b2b7-f09b0a568687/product-r13-pdf-final-browser-receipt.md`，SHA-256 `5e84f40ca592a24bddee20fc113d3867b3492028c12529fe8ae11f4f3b909e0e`。其 Artifact、Pointer Path、Pagination、Zoom、Reload、420 Responsive、Fresh Console 与当前 Runtime HTTP 200 事实已吸收；当时的 Toolbar Keyboard 受 Browser Driver 限制，后由本索引 `REC-PDF-TOOLBAR-KEYBOARD-001` 的系统级输入证据闭环。
- Gates：Generator / Renderer Targeted Test 合计 `2 files / 9 tests PASS`；两个 Package Typecheck 与当前完整 Build PASS。完整 R13 Gates 仍需全范围结束后重跑。
- Result：`PASS`（PDF 生成、Pointer Path、Viewer Click UX、Toolbar Keyboard、Host 回读、Recovery 与 Refresh / Navigation）；Failure Closure、进程重启持久化、缺包/卸载组合及全局 Network Ledger 仍 `PENDING` 或 FAIL。

### REC-PDF-TOOLBAR-KEYBOARD-001

- Independent failure：最终 PDF 回执确认 Next 已获得 Focus，但 Locator Enter / Space 不翻页；Zoom In 已获得 Focus，但 Browser-level Enter / Space 不缩放。Click 路径正常。
- Same-tab reproduction：本任务在 `1 / 3` 上对标准 `<button type="button">` Next 执行 Locator Enter 与 Space，页码均保持 `1 / 3`；按钮仍是当前 Focus，Click 可立即翻页。
- Native comparison：同一页面 Harness 原生 `轨迹` Tab 获得 Focus 后，Locator Enter 与 Browser-level Enter 同样不激活；原生 `打开通知中心` Button 获得 Focus 后，Space 不打开 Dialog，而 Click 立即打开一个 Dialog。由此将“不产生 Keyboard Activation Event”归类为当前 in-app Browser Input Harness 限制，而不是 PDF Renderer 特有事件拦截。
- Component boundary：PDF 控件是无自定义 Keyboard Handler 的原生 `<button type="button">`，Stage 的 PageDown / Home Keyboard Interaction 已真实通过。为避免为测试工具限制引入重复的 `onKeyDown → click` 非标准补丁，本轮不改写原生 Button 语义。
- System-keyboard recovery：Google Chrome 通过 macOS Computer Use 发送真实系统键。Pointer 把 Next 聚焦并到 `2 / 3` 后，`Return` 使 AX 权威回读变为 `3 / 3` 且 Next Disabled；Pointer 把 Zoom In 聚焦并到 `125%` 后，`Space` 使 AX 权威回读变为 `150%`。
- Independent receipt：`/Users/hansen/.codex/visualizations/2026/08/27/01a042cf-d6ae-7930-b2b7-f09b0a568687/product-r13-pdf-keyboard-receipt.md`，SHA-256 `422ed4e09e5ba77c52441f9a15f2644874e6d9ed65760dd3216801e8d8c6d3a4`；截图 `/Users/hansen/.codex/visualizations/2026/08/27/01a042cf-d6ae-7930-b2b7-f09b0a568687/product-r13-pdf-keyboard-final.jpeg`，SHA-256 `1750e9b9236d09f1df2d3dcfa1692c3e906b1ec44f96358fde63fc3126285f73`。
- Result：`PASS`，仅覆盖 PDF Pagination / Zoom 的系统键盘激活。旧 in-app Browser Driver 限制事实继续保留，不外推全局 Keyboard、Console / Network、Refresh 或 Restart。

### REC-SKILL-LIFECYCLE-001

- Operation：真实打开 Skill Center，Catalog 显示 `10` 个条目、已安装 `0`；检查 `category-performance-analysis` 安装确认页的 `3 files / 1,789 B / new install`，点击确认安装后已安装数变为 `1`。随后点击 `在当前对话使用`，原生 Composer 写入 `/category-performance-analysis` 并发送真实模型 Turn。
- Visible feedback：当前会话显示原生 `skill-catalog` 与 `category-performance-analysis` Context Injection，最终模型回复 `R13_SKILL_OK`。随后从页面执行 `带备份卸载`，已安装数回到 `0`、历史 Invocation 仍可见；再从 Catalog 重新安装后已安装数恢复为 `1`。
- Host / Session read-back：Session `session-48924091-bb75-4621-b1a0-d627d09947e1` 的 JSONL `seq 189–209` 保存 `skill-catalog`、完整 `skill-invocation` Content、真实 `assistant/chunk`、`assistant/message source.kind=model`（provider `deepseek-official`、model `deepseek-v4-flash`）与 `turn/end completed`。可恢复备份位于 `/private/tmp/paimind-r13-e2e.slTHZt/.paimind-skill-installer/backups/category-performance-analysis-1787842590372-5e910106-4f1f-4b7a-9969-8f66205eea2b`。
- Independent read-back：根任务在同一隔离 Session 只读确认 `/category-performance-analysis`、两条原生 Context Injection 与 `R13_SKILL_OK`。该独立证据只增加真实使用/运行注入可信度，不外推其他 Lifecycle Axis。
- Console / Network：安装、调用、卸载与重装交互无页面 `warn` / `error`；模型成功 Turn 命中隔离 Provider。逐请求全局 Network Ledger 仍待补。
- Result：`PASS`（浏览、安装、Composer Invocation、真实模型注入、可恢复卸载与重装）；Refresh 与 Process Restart 见 `REC-SKILL-RESTART-RECOVERY-001`，Invalid Package Failure Closure、Package-absent Boot 与有效本地包恢复见以下回执。

### REC-SKILL-RESTART-RECOVERY-001

- Operation：在 `category-performance-analysis` 重装完成后停止并重新启动同一个隔离 Harness Runtime；随后使用全新 Chrome Tab 打开 `http://127.0.0.1:61888/`，再从真实 Shell 打开 Skill Center。第二次页面 Reload 后重新绑定 Chrome Page 并再次读取同一 Catalog Projection。
- Visible / Host read-back：进程重启前、重启后与 Reload 后均显示 `目录 10 / 已安装 1 / 收藏 0`，且已安装卡片仍为 `category-performance-analysis`。同一隔离 Session 的历史 `/category-performance-analysis`、原生 `skill-catalog` / `category-performance-analysis` Context Injection 与最终模型回复 `R13_SKILL_OK` 均保持可见。
- Responsive：在真实 Chrome 中依次检查 `420x900`、`760x900`、`1100x900` 与 `1440x1000`。四档 `documentElement.scrollWidth === innerWidth`；导入入口、状态筛选与目标 Skill 卡片均落在横向视口内，窄屏目标卡片可通过纵向滚动到达。
- Console / Network：全新 Tab 的首次加载、打开 Skill Center 与四档 Responsive 回归均为 `warn/error = 0`。旧 Tab 在一次 Reload 后出现 Browser Driver CDP Selector Deadline，重新获取 Page Binding 后页面及 Runtime 均正常；`curl` 同时回读 HTTP `200`、约 `1.3ms`，该工具绑定限制不记为产品失败。
- Boundary：本证据只升级 `@paimind/skill-market` 的 Refresh / Process Restart 与 Responsive；Invalid Package、Capability Off 与 Package-absent Boot 由以下独立回执覆盖。
- Result：`PASS`。

### REC-SKILL-INVALID-PACKAGE-ATTEMPT-001

- Operation：在真实 Skill Center 点击 `导入本地 Skill`，通过原生 File Chooser 选择缺少 YAML Frontmatter 的 `SKILL.md`。
- Visible feedback：页面正确显示 `SKILL.md 缺少 YAML frontmatter`，目录仍为 `10`、已安装仍为 `1`，没有成功卡片；但 Host 回读发现 `.paimind-skill-installer/uploads` 从 `1` 增加到 `2`，检查失败后暂存文件未回收。
- Root cause / fix：`inspectUpload()` 在解析失败时只抛出错误，没有执行 `cancelUpload()`。`packages/skill-market/src/installer.ts` 现在在检查异常时先撤销内存记录并删除暂存文件，再向 UI 返回原错误；新增 Regression Test 验证失败清理。
- Preserved evidence：两份旧泄漏文件已按原 SHA-256 `28298a9b…`、`dd9fcf51…` 移入 `/private/tmp/paimind-r13-e2e.missing.HEZwdL/invalid-upload-failure-evidence/`，没有伪装成从未发生。
- Result：`FAIL`（Attempt 1，保留）；恢复见 `REC-SKILL-INVALID-PACKAGE-001`。

### REC-SKILL-INVALID-PACKAGE-001

- Runtime / operation：`DSH_HOME=/private/tmp/paimind-r13-e2e.missing.HEZwdL`、`http://127.0.0.1:62473`、`--no-open`。先上传 SHA-256 `28298a9b…` 的无效 `SKILL.md`，再上传 SHA-256 `7140cf03…`、只含一份无效 `SKILL.md` 的 ZIP；两次均由真实 File Chooser 完成。
- Visible feedback：两次均显示明确 Alert `SKILL.md 缺少 YAML frontmatter`；没有 `正在检查`、`正在安装`、成功 Status 或新增卡片，已安装数保持 `1`。
- Host read-back：每次失败后 `.paimind-skill-installer/uploads` 为 `0`，安装目录只有 `category-performance-analysis`，无 invalid-name 目录；浏览器 Reload 后 Alert 消失、已安装数仍为 `1`。进程重启后全新 Tab 再开 Skill Center，仍为 `目录 10 / 已安装 1 / 收藏 0`，上传与安装目录均无失败残留。
- Console / Network：无效 MD、ZIP、Reload 与进程重启后的 Fresh Tab 均无新页面 `warn/error`；Host 根页 HTTP `200`、约 `1.2ms`。逐请求 Global Network Ledger 仍不由本场景外推。
- Supporting gate：`packages/skill-market/tests/installer.spec.ts` 为 `1 file / 6 tests PASS`，包含检查失败删除 staged upload；Package Type Check 与 Build 通过。这里只作为 supporting evidence。
- Result：`PASS`（Failure Closure、无假成功、Refresh 与 Process Restart 无残留）。

### REC-SKILL-PACKAGE-ABSENT-ATTEMPT-001

- Setup：Browser 先在 Extension Center 把 Agents Pack 关闭，Settings SHA-256 `74a5a3c2…` 且 `paimind:pack:agents=false`；再停止 Runtime，把 Profile 的 `@paimind/skill-market` Symlink 可恢复移动到临时备份，确认 Bundle 内没有第二份嵌套 Package。
- Failure：物理缺包冷启动在页面可用前退出，`paimind-package-invariants` 仍无条件导入 `@paimind/skill-market/invariant`，返回 `ERR_MODULE_NOT_FOUND`。因此 HTTP、Extension Center 与原生 Session 均不可用，不能计作隔离通过。
- Root cause / fix：Package Invariant 原先位于 Always-on Group，越过了 Product Pack 的关闭边界。现将每个 Invariant 与所属 Product Feature Pack 共享生命周期；关闭包不导入已缺席 Package，恢复包时 Cordis Disposal 先释放 Invariant Ownership，避免重复注册。
- Result：`FAIL`（Attempt 1，保留）；恢复见 `REC-SKILL-PACKAGE-ABSENT-001`。

### REC-SKILL-PACKAGE-ABSENT-001

- Cold boot：保持 `paimind:pack:agents=false` 且物理缺少 `@paimind/skill-market`，同一 Home / Port 使用 Bundled Node 冷启动成功。真实 Browser 打开 Extension Center，Agents Pack 准确显示关闭，技术模块为 `18 产品能力 / 18 Harness 已加载 / 0 需关注`；Agent / Skill 入口均为 `0`。
- Isolation：同一页面仍可打开原生 Session `R13_BENTO_OK`，Task Monitor 与 Notifications 入口均存在；其余五个 Product Pack 保持运行。Host 生成的 `cordis.yml` 证明 `paimind-pack-agents disabled:true`，缺席包路径为物理 ABSENT，根页 HTTP `200`。
- Refresh / restart：页面 Reload 后 Session 与 Task Monitor 仍可用、Skill 入口仍缺席；Harness Process Restart 后全新 Browser Tab 再开 Extension Center，仍为 Agents Off 与 `18/18/0`，Fresh Tab `warn/error=[]`。旧 Tab 在主动停机窗口产生的 Connection-lost / Sidebar reconnect 日志单独归类为预期 Restart Window，不冒充 Fresh Tab 错误。
- Reinstall / recovery：停止 Runtime 后把原 Symlink 精确恢复，再冷启动并从 Browser 点击 `智能体中心 · 已关闭` 开关。Settings SHA-256 恢复为 `1ec5ebcb…` 且全部六包为 true；Agent / Skill 两个入口重现，后续本地 Skill 安装、调用与模型回复见 `REC-SKILL-VALID-RECOVERY-001`。
- Host resource supporting read-back：物理缺包页面 Boot Payload 的 `64 / 64` Client Entries 均返回 HTTP `200` 且非空；逐请求 Global Network Ledger 仍保持横切 `PENDING`。
- Result：`PASS`（Package-absent Boot、无关产品隔离、Refresh、Process Restart、Reinstall 与核心恢复）。

### REC-SKILL-VALID-RECOVERY-001

- Install：从真实 Skill Center 上传有效 `SKILL.md`（SHA-256 `6859ed2f…`），安装确认页显示 `r13-valid-installed-skill / 1 file / 239 B / 全新安装`；点击 `确认安装` 后可见成功 Status，已安装数从 `1` 变为 `2`。Host 文件与 `.paimind-install.json` SHA-256 分别为 `6859ed2f…`、`9d87fdc1…`，上传暂存仍为 `0`。
- Real use：点击 `在当前对话使用` 后原生 Composer 写入 `/r13-valid-installed-skill`。第一次 Turn 因 Runtime 尚未接入隔离 Provider Route 返回 `MISSING_CREDENTIAL`，失败记录保留；随后只重启该隔离 Runtime 并接入 `127.0.0.1:54339/v1` 的确定性测试 Provider，同一 Session 第二轮显示 `skill-invocation r13-valid-installed-skill` 与最终 `R13_VALID_SKILL_OK`。
- Provider / Session authority：Provider Receipt `r13-skill-provider-1` 为 `contextObserved=true`、`outcome=completed`、请求 SHA-256 `98e31f71…`。Session `session-5b3c231f-0d8a-49d9-8045-5d49166ab10d` 的 JSONL 保留 Turn 1 `MISSING_CREDENTIAL`，Turn 2 有真实 `assistant/chunk`、`assistant/message source.kind=model`（provider `deepseek-official`、model `deepseek-v4-flash`）和 `turn/end completed`；压缩日志 SHA-256 `db2195c5…`。
- Refresh / restart / clean page：有效包安装后经历 Harness Process Restart；模型成功后页面 Reload，再开 Skill Center 仍显示 `已安装 2` 和目标卡片。另一个全新 Browser Tab 打开同一 Session，同时可见失败 Attempt、Skill Context Injection 和成功回复，Console `warn/error=[]`。
- Result：`PASS`（有效包恢复安装、原生发现、真实模型执行、失败保留、Refresh 与 Process Restart 持久化）。

### REC-PROPOSAL-DUPLICATE-ID-001

- Failure：旧 Session `session-7bbf7b5b-40e0-4b30-b465-424d7a286c97` 的多个真实工具 Turn 重复使用 `mock-call-1`。重新打开历史时页面可见 `历史加载失败：conversation Context 9:tool-callmock-call-1 received more than one start Match（internal）`；同时旧 Artifact 仍可见，失败没有被覆盖。
- Root cause：Harness Test Support 的 Deterministic Provider Fixture 在 `toolCallChunks` 固定写入 `id: 'mock-call-1'`；Artifact Tool Event 与 Conversation Replay 没有合成第二个 Start。PAIMind 仓库不修改 Harness 源码，因此改为隔离的 OpenAI-compatible HTTP/SSE Provider，为每个真实模型工具调用发出唯一 ID。
- Result：`FAIL`（Attempt 1，保留）；恢复见 `REC-PROPOSAL-CHAIN-RECOVERY-001`。

### REC-PROPOSAL-CHAIN-RECOVERY-001

- Operation：在新 Session `session-6bd6a1c1-b07a-4153-91d5-45bdb9ee32a9` 经真实 Harness LLM Adapter 串行执行 `prepare_category_demo_data`、`analyze_category_performance`、`analyze_category_opportunity`、`build_presentation_fact_set`、`create_fact_bound_presentation_outline` 与 `generate_traceable_bento_from_outline`。
- Provider / Session read-back：六个模型工具调用 ID 依次为 `r13-category-prep-001`、`r13-category-performance-002`、`r13-category-opportunity-003`、`r13-fact-set-004`、`r13-outline-005`、`r13-bento-006`。每轮都有 `assistant/message source.kind=model`、真实 `tool/call` / `tool/result`、第二个模型回复与 `turn/end completed`；页面最终依次显示 `R13_CATEGORY_PREP_UNIQUE_OK`、`R13_CATEGORY_PERFORMANCE_UNIQUE_OK`、`R13_CATEGORY_OPPORTUNITY_OK`、`R13_FACT_SET_OK`、`R13_OUTLINE_OK` 与 `R13_BENTO_OK`。
- Artifact read-back：冻结 Manifest `artifact:a12d77a69428a279d0e915d6`；Performance `artifact:bb3d0d03a8c226459226c922`；Opportunity `artifact:526e997f093b5d083a0a9ab4`；Fact Set `artifact:ec02ba1d4787d3613a6d10e7`（`paimind.fact-set/v1`、`3` Sources、`84` Facts）；Outline `artifact:cd53f4fd7eb7d78c74787b49`（`paimind.presentation-outline/v1`、`2` Slides）；Bento `artifact:ddde15fb5e3a01789ba065c4`、Trace `trace:20b3de3d21fa250b6e467f6a`。
- Integrity：Bento HTML 为 `21,801` bytes、SHA-256 `e8f2fdcb464b9cdda5db811188a6bb058aaaabe91998e50b2026a37ba92a66bd`；Trace Sidecar 为 `9,363` bytes、SHA-256 `e57a02987c1648a94da3f5aba3c86f7ea8fa702e657b8f8b05bf8b7bb22913c5`，与 `tool/result.meta.trace.documentRef` 完全一致。
- Browser recovery：刷新、进程重启后回到同一新 Session，六轮历史、Artifact Cards 与模型回复均恢复，`历史加载失败` 计数为 `0`。
- Result：`PASS`（Category Analysis、Fact Set、Outline、Bento 生成与 Conversation Replay Recovery 主路径）；各包的独立 Failure Closure、关闭/缺席组合仍由 Matrix 保持 `PENDING`。

### REC-BENTO-WORKBENCH-001

- Preview：真实 Artifact Card 打开 Better Sidebar Bento Viewer，显示 `2` Slides、`独立 Origin · 无外部网络资源`。Preview 从 `1 / 2` 到 `2 / 2`，末页事实 `$11.10M` 与 `45.8%` 可见。
- Edit：进入 Edit Mode 后出现 `可编辑标题、说明与展示文案 · 事实值和派生指标已锁定`。真实键盘把 Narrative 改为 `R13 editable narrative persisted in viewer.`，而锁定事实保持 `88 / $11.10M / 45.8%`；刷新后源文件不可变文案恢复，文件 SHA-256 未变化。
- Trace：选择 `$11.10M` 后，业务溯源显示来源 `dg-department-performance.csv`、SHA-256 前缀 `f87d31fb4c8c…`、结论、方法与 `department_id=102` 范围；技术溯源显示 `packages/category-analysis-adapter/runtime/runner.mjs`、源字段 `department_id · current_sales_m`。事实选择、业务页与技术页全部真实可达。
- Keyboard / responsive：iframe 在 Focus 后以 `ArrowLeft / ArrowRight` 完成 `2 / 2 → 1 / 2 → 2 / 2`；Chrome `420x900` 再次完成 Focus 后 `ArrowRight` 翻页与 ContentEditable Keyboard 输入。四档均无文档横向溢出：1440 与 1100 时 Viewer 为右侧 `587px`；760 时全宽 `759px`；420 时 Edit Rail `64px`、主 Frame `355px`，Trace Inspector 下置 `419px` 宽，三个 Mode Button 均落在 `17–121px`，Preview Frame `403px` 宽。
- Console：正常 Preview / Edit / Trace / 420 Keyboard 与 Reload 操作的 Chrome `dev.logs(warn,error)` 为空。逐请求 Network Ledger 仍待补。
- Result：`PASS`（核心 Workbench 交互、Focus / Keyboard 与四档 Responsive）；独立缺 Sidecar / Hash 错误、Package Off 与 Absent Boot 仍 `PENDING`。

### REC-BENTO-RELOAD-001

- Failure：首次真实页面 Reload 后，会话六轮历史与 Better Sidebar Tab 标题 `R13 DG Category Opportunity` 均恢复，但 Viewer 内容退化为 `请打开一个 Bento 产物。`。Tab 持久状态与 `BentoPreviewStore.request` 分裂，需要人工再次点击 Artifact Card。
- Result：`FAIL`（Attempt 1，保留）；恢复见 `REC-BENTO-RELOAD-RECOVERY-001`。

### REC-BENTO-RELOAD-RECOVERY-001

- Fix：Artifact Router 在成功打开权威 Bento Artifact 后，把 `sourceId + artifactId` 的 versioned Locator 保存到当前 Browser History State；启动时仍由 `paimindArtifacts`、Session 与 Workspace Project 权威 Projection 解析并重新打开，Browser State 不直接制造 Path、Trace 或 Artifact 数据。
- Targeted / build evidence：Artifacts、Renderer Bento、Presentation Trace 定向测试 `3 files / 20 tests PASS`；三个 Package Typecheck `PASS`；完整 Root Build `PASS`。
- Reload / restart：只重启隔离 `61888 --no-open` Runtime。重新打开同一 Artifact 后，真实 Reload 自动恢复主 Viewer `1 / 2`，`请打开一个 Bento 产物。=0`、`历史加载失败=0`；此前本地 Edit 文案恢复为不可变 Source 文案，证明没有误写 Artifact。
- Back / Forward：导航到独立 Probe History Entry 时 Viewer 为空符合该 Entry 没有 Artifact Locator；Browser Back 回到 Artifact Entry 时 Viewer 自动恢复，Forward 回 Probe 后再次 Back 仍恢复，`历史加载失败=0`。Chrome 在全页 History Navigation 时记录 Harness 自身 `[web-runtime] connection lost, retry #1` 并自动重连；没有 Error，Fresh Reload 与核心 Workbench 操作日志为空。该瞬时 Warning 保留在横切 Console / Network 分类，不外推全局 PASS。
- Result：`PASS`（Bento Reload、Process Restart 后重开、Back / Forward Artifact Entry Recovery）；独立 Package Restart Persistence 与 Package-absent Boot 仍保持 `PENDING`。

### REC-EXT-DESKTOP-001

- Source：上层独立 Desktop Browser Spot-check（桌面浏览器抽检），为避免状态冲突只读执行。
- Operation：`1440x1000` 打开 Settings → Extension Center。
- Visible feedback：六个 Product Feature Pack 与 Runtime Orbs 均启用；`20 产品能力 / 20 Harness 已加载 / 0 技术状态需关注`；包内模块数 `4/3/9/6/6/2`；依赖标识可见。
- Host read-back：页面展示真实 Harness loaded 计数；未做开关写入。
- Console：无 `warn` / `error`。
- Network：未提供逐请求 ledger。
- Result：`PASS (read-only)`；Switch、Cascade、Recovery、Restart 与 Failure Closure 仍 `PENDING`。

### REC-ORBS-CAPABILITY-001

- Operation：在真实 Extension Center 关闭 `动态状态球`；Mutation 触发 Harness 页面重载后重新打开控制面。随后在同一原生 Session 发送慢速真实模型 Turn，等待 Loading、流式回复和完成；再通过页面恢复 Capability，并重复慢速 Turn。最后重启隔离 Harness Process，再重复一次真实模型 Turn。
- Disabled state：页面技术清单从 `20 / 20` 变为 `19 / 19`，`@paimind/runtime-orbs` 不再加载；Settings 精确保存 `"paimind:capability:runtime-orbs":false`。13 秒真实模型 Turn 期间原生 `停止生成`、Partial Reply 与最终 `R13_ORBS_DISABLED_LONG_RUNNING_OK` 可见，但 `[data-paimind-runtime-orb]=0`、`[data-paimind-runtime-status]=0`。
- Recovery / restart：恢复后技术清单回到 `20 / 20`，慢速 Turn 期间两个 Orb 分别呈现 `composing / working`，Runtime Status 为 `replying`，完成后都清理为 `0`；进程重启后再次出现同样 Running → Completed 行为，最终回复 `R13_ORBS_RESTART_PERSISTED_OK`。
- Host / Provider read-back：三个成功路径均保存真实 `assistant/chunk`、`assistant/message source.kind=model`、provider `deepseek-official`、model `deepseek-v4-flash` 与 `turn/end completed`。关闭与恢复均由 Loader / Settings 权威状态回读确认。
- Console / Network：正常操作与恢复页面无 `warn` / `error`；隔离 Loopback Provider 的 HTTP/SSE Attempt 均完成。主动 Process Restart 窗口产生的旧标签连接中断不作为页面业务错误，重启后的 Fresh Tab 干净。
- Result：`PASS`（Capability `OD / RC / RF / RS`）；Think、Tool、并行批次和 Capability 缺席组合仍单独保持 `PENDING`。

### REC-EXPERIENCE-PACK-LIFECYCLE-001

- Operation：在真实 Extension Center 中关闭 Product Experience；页面先显示 `Loading plugins…`，随后回到原生 `DSH Local Build` Shell，`PARAMONT · PAIMIND`、PAIMind Welcome、Runtime Orbs 和 Personalization 入口同时撤销。其他五个 Product Pack、原生 Session、Agent、Skill、Notification 与 Settings 保持可用。
- Core action while off：同一原生 Session 真实发送 `R13_EXPERIENCE_PACK_OFF_NATIVE_OK`；页面显示同值模型回复，Provider Receipt 记录 `experiencePackOffObserved=true`，Session JSONL 保存真实 `assistant/chunk`、`assistant/message source.kind=model`、provider `deepseek-official`、model `deepseek-v4-flash` 和 `turn/end completed`。
- Host read-back：Extension Center 从 `20 / 20 / 0` 降为 `16 / 16 / 0`；`settings.yaml` 精确保存 `"paimind:pack:experience":false`，关闭态 SHA-256 `20e845755e37717d7e17abc141c32588b8b75fc0e84d459c5d5e6a2169f6e928`。关闭态 Session JSONL SHA-256 `b54627d2dbdde863de8c6b15547df4349f954f7c613042f0bebfd227f4b01b2c`。
- Recovery：从页面重新启用 Product Experience 后，品牌欢迎页、视觉模式、Runtime Orbs 与 Personalization 入口全部恢复；Extension Center 回到六包和 Orbs 全开、`20 / 20 / 0`，最终 `settings.yaml` SHA-256 `484cb6254721a8e4d7b744f8a2470cedc5efc92f98832b1f9ceeb890a65455c0`。
- Console / Network：关闭、原生模型回复和恢复页面 `dev.logs()=[]`；Provider 回环 HTTP/SSE 成功。逐入口 Global Network Ledger 仍不由本场景外推。
- Result：`PASS`（Pack `OD / RC` 与无关产品隔离）；四个内部 Runtime Entry 的系统键盘横切仍单独保持 `PENDING`。

### REC-EXPERIENCE-PACK-ABSENT-001

- Physical absence：在 Product Experience 持久关闭后正常停止隔离 Runtime，把 `@paimind/branding`、`@paimind/visual-experience`、`@paimind/runtime-orbs`、`@paimind/user-settings` 四个 Profile Symlink 可恢复地移入 `/private/tmp/paimind-r13-e2e.missing.HEZwdL/r13-experience-pack-backup/`；Cold Boot 时四包均物理缺席，未触碰共享 Runtime 或主 `.dsh-home`。
- Browser / isolation：相同 Home 与 `62473 --no-open` 冷启动返回 HTTP 200；Fresh Tab 回读 Product Experience Off、`16 / 16 / 0`、原生 Session / Agent / Skill / Notification / Settings 可用，无 Branding、Orbs 或 Personalization，页面 Console 为空。
- Failure Closure：在四包物理缺席时从 Extension Center 尝试启用 Product Experience；页面明确显示 `未保存；已恢复主机中的实际状态。`，Pack 保持 Off、`16 / 16 / 0`，没有 Loading 假成功；`settings.yaml` SHA-256 继续为 `20e845755e37717d7e17abc141c32588b8b75fc0e84d459c5d5e6a2169f6e928`。
- Refresh / restart：Reload 与主动 Process Restart 后缺席状态、原生历史和无关入口继续恢复。随后恢复四个 Symlink，备份目录为空；先以 Pack Off 冷启动验证恢复文件未造成假加载，再从页面启用并回到 `20 / 20 / 0`。
- Result：`PASS`（四个内部 Runtime Entry 的 `FC / AB` 与缺席恢复）；系统键盘和逐入口 Network Ledger 不从本场景外推。

### REC-EXPERIENCE-SETTINGS-RECOVERY-001

- Operation：在 Settings → Personalization 启用个性化，选择 `务实`，保存 `aboutMe=R13 隔离验收用户，只使用合成数据。` 与 `customInstructions=回答末尾输出 R13_PERSONALIZATION_OK。`；随后完成 Pack Off、物理缺席、恢复和同 Home 重启。
- Core model action：在恢复后的原生 Session 发送 `请只回复 R13_EXPERIENCE_RECOVERY_OK`；Browser 最终回复为 `R13_EXPERIENCE_RECOVERY_OK R13_PERSONALIZATION_OK`。Provider Receipt 记录主回复 `experienceRecoveryObserved=true`、`personalizationObserved=true`，SHA-256 `1c89a5ae17317dc6e0ef99ad75579ebf0fccaf8b2ed5f74f986554aa1bf125e9`。
- Authoritative read-back：Session JSONL SHA-256 `ee5be0063f3901d562c484f4293c3b1a51d77cebfaaf8b8c4edb5f01c4afb256`；记录 `<paimind-personalization>` 的精确 About Me 与 Custom Instructions、真实模型消息和 `turn/end completed`。独立 Title Generation Request 没有 Personalization，仅影响会话标题，不被误算为主回复失败。
- Browser persistence：Fresh Tab 与 Process Restart 后 Personalization Switch 仍 Checked、`务实`仍 Pressed，两段文本完整回读，保存按钮因无改动处于 Disabled；旧模型回复继续可见，Console 为空。
- Result：`PASS`（User Settings 核心保存、模型注入、Host 回读与恢复）；系统键盘横切仍 `PENDING`。

### REC-EXPERIENCE-RESPONSIVE-A11Y-001

- Attempt 1：`420x900` 真实页面布局本身无横向溢出，但 Settings Rail Trigger 是无 Accessible Name 的原生 Button；视觉可点不等于键盘／读屏可达，记为 `FAIL`。
- Fix：`@paimind/visual-experience` 只在缺少 Name 时为 `[data-slot="settings.trigger"]` 安装可逆 `aria-label`（中文 `设置`，其他语言 `Settings`），并在插件卸载时只清理自身标记。Targeted Client Tests `1 file / 10 tests PASS`、Package Typecheck `PASS`、Root Build `PASS`。
- Browser recovery：重启加载真实 Build 后，`420x900` Accessibility Tree 出现 `button "设置"`；Settings Dialog 为 `x=24,right=396,width=372`，Welcome、Composer、PAIMind / Native Mode 与 Personalization 均可读。`760` 为 `x=24,right=736,width=712`，`1100` 为 `x=150,right=950,width=800`，`1440` 为 `x=320,right=1120,width=800`；四档 `scrollWidth===innerWidth`，页面 Console 均为空。
- Result：`PASS`（Accessible Name、Pointer、Focus Target 与四档 Responsive）；Keyboard Activation 仍由下一条独立 Attempt 保持 `PENDING`。

### REC-EXPERIENCE-NAVIGATION-001

- Back / Forward：从 Product Experience 恢复会话执行 Browser Back，页面真实离开到 `about:blank`；Browser Forward 后同一 `R13_EXPERIENCE_RECOVERY_OK R13_PERSONALIZATION_OK` 会话、Composer 和 PAIMind Settings Trigger 自动恢复。
- Reload：随后真实 Reload，同一模型回复、Session 状态、Branding 与可访问 Settings Trigger 继续恢复；页面 Console 为空。
- Boundary：Harness 当前 Session Navigation 不改变 URL；因此 Back 离开应用、Forward 返回应用是该页面的真实 Browser History 行为，不伪造内部 Route。
- Result：`PASS`（`RF`）；系统键盘和全局 Network Ledger 仍独立待补。

### REC-EXPERIENCE-RESTART-RECOVERY-001

- Operation：先正常 `Ctrl-C` 停止 `62473`，权威回读 `PORT_CLOSED`；同一临时 Home、Workspace、Deterministic Provider 与 `--no-open` 重新冷启动，新的 Listener PID 为 `5308`。
- Fresh Browser：全新 Tab `id=55` 直接恢复 Product Experience Session 及模型回复；Settings Trigger 有可访问名称，General Settings 中 PAIMind Radio Checked，Personalization 中 Switch Checked、`务实` Pressed、两段保存文本完整，Console 为空。
- Control-plane read-back：Extension Center 显示六包与 Runtime Orbs 全部 Enabled，技术模块 `20 产品能力 / 20 Harness 已加载 / 0 技术状态需关注`；四个 Experience Entry 均为 Loaded。`settings.yaml` SHA-256 保持 `484cb6254721a8e4d7b744f8a2470cedc5efc92f98832b1f9ceeb890a65455c0`。
- Result：`PASS`（`IB / RS` 与重启持久化）；最终系统键盘和逐入口 Network Ledger 不外推。

### REC-EXPERIENCE-KEYBOARD-ATTEMPT-001

- In-app attempt：`420x900` 中 Locator Enter 可把 Focus 移到语义 `设置` Button，但不打开 Dialog；在已打开 Dialog 中对 `个性化` Button 再执行 Locator Enter 也只移动 Focus。与此前 Harness 原生 Tab / Button 的 Driver-limited 对照一致，未确认组件缺陷。
- System-level attempt：切换到 macOS Computer Use + Google Chrome 后，系统 `Return` 同样无法激活 Chrome 原生 Address Bar、New Tab Shortcut Link 或当前页面链接；该工具会移动 Focus / 更新 Value，但不提交导航。旧 Chrome Tab 同时显示过 `@huanlin/dsh-plugin-better-sidebar-plugin-office` Client Import Failure；同一时刻该脚本 URL 和根页均为 HTTP 200、In-app Browser 同 Runtime 正常且 Console 为空，因此仍需在可工作的系统输入通道做 Chrome Recovery，不能把它归类为 Product PASS。
- Result：`PENDING`（Tool-limited + Chrome Recovery Gap）；本条阻止四个 Product Experience Runtime Entry 升级为完整九轴 `PASS`。

### REC-EXPERIENCE-KEYBOARD-CHROME-RECOVERY-001

- Preserved failures：保留前一条 In-app / Computer Use 输入限制，以及 Chrome Fresh Tab 曾出现 `@deepseek-ai/dsh-session-log-export`、`@huanlin/dsh-plugin-better-sidebar-plugin-office` Import Failure、`dynamicCordisRunner/syncInspectManifest failed: Failed to fetch`、连接丢失和稳定 PID 11846 下超过 33 秒停在 `Loading plugins…` 的失败 Attempts；根页 HTTP 200 或 Console 为空本身不算 Ready。
- System keyboard recovery：Root 使用 macOS Chrome 系统输入，从 Composer 真实 `Shift+Tab` 依次经过 Agent、Mode、Workspace 到语义 `设置` Button；系统 `Enter` 后 `aria-expanded=true`、Dialog 从 `0 → 1`，Focus 进入 `关闭`。这闭合真实 Keyboard Activation，不再沿用 Driver-limited 假设。
- Fresh Chrome recovery：Listener PID 14365 稳定超过 3 分钟后，全新 Chrome Tab 打开 `http://127.0.0.1:62617/?root-chrome-recovery=pid-14365`；`document.readyState=complete`，Workspace / Session / Agent / Composer / Settings / PAIMind Shell 全部出现。关闭既有 Dialog 后点击精确可访问 `设置`，Dialog `0 → 1`、`aria-expanded=true`、Focus 进入 `关闭`，Chrome `error=[]`、`warn=[]`；Host 根页 HTTP 200、21,501 bytes、约 1.3 ms。
- Authoritative external receipt：`/Users/hansen/.codex/visualizations/2026/08/27/01a042c0-a240-7230-b639-7a9ee41c500a/R13-chrome-system-keyboard-root-verification.md`，SHA-256 `78b27e2c8fd859001970c8dfcdb9b80e3e52a45aa63ee0e5988355efc1ef9a95`。
- Result：`PASS`（仅 Product Experience 四个 Runtime Entry 的 System Keyboard Activation 与 Fresh Chrome Restart Recovery）；不得外推到其余 Runtime Entry、Global Network Ledger 或 Final Gates。

### REC-EXPERIENCE-INVARIANT-LIFECYCLE-ATTEMPT-001

- Operation：Runtime Orbs 在 Cold Boot 后先真实关闭，再从 Extension Center 重新启用；页面 Mutation 进入 Loader，但 Host 报 `invariants: package "@paimind/runtime-orbs" is already registered`，Settings / Loader 回滚，不能恢复该 Capability。
- Root cause：多个 Package Invariant Companion 使用普通 `export function apply`，Cordis 把带 `prototype` 的函数按 Constructor 路径执行，返回的 Registry Disposer 未被 Fiber 收集；Group 关闭时注册所有权没有释放，下一次启用产生重复注册。
- Result：`FAIL`（Attempt 1，保留）；不能用先前仅检查开关数字的证据覆盖。

### REC-EXPERIENCE-INVARIANT-LIFECYCLE-RECOVERY-001

- Fix：29 个 PAIMind Invariant Companion 统一改为无 `prototype` 的 arrow `apply` 并直接返回 `ctx.invariants.register(...)` Disposer；Agent Builder / Agent Market / Skill Market 补齐 `inject=['invariants']`。Runtime Orbs 测试新增真实 Harness `InvariantRegistry` + Cordis `activate → dispose → activate` 生命周期回归。
- Regression gates：旧实现下真实 Cordis 生命周期测试先复现 Duplicate Registration；修复后 `17 test files / 18 tests PASS`，`pnpm run typecheck`、`pnpm run build` 与 `git diff --check` 均 PASS。这里只作为对应修复的 Supporting Gate，不升级 Final Gates。
- Browser / Host cycle：稳定 Listener PID 14365 下，Extension Center 先真实回读 Runtime Orbs `已关闭`、`19 产品能力 / 19 Harness 已加载 / 0 技术状态需关注`；同一进程点击恢复后回读 `已启用`、`20 / 20 / 0`，页面 Console `warn/error=[]`。隔离 `settings.yaml` 精确保存 `"paimind:capability:runtime-orbs":true`，Host 根页 HTTP 200，Listener PID 未变化。
- Result：`PASS`（真实 Loader Dispose / Re-register、Settings 持久状态和无假成功恢复）。

### REC-PACKS-DIRECT-001

- Operation：在 Extension Center 依次真实关闭并恢复产品体验、智能体中心、内容与交付物、提案与演示、自动化、工作运营六个一级包；每次 Mutation 都经历页面重载、重新打开控制面并回读 Switch、技术清单与无关产品入口。
- Visible / isolation feedback：关闭智能体中心时 Agent / Skill Trigger 消失而 Session、内容、通知与 Task Monitor 保持；关闭自动化时通知与 Scheduler 入口消失而 Agent、内容、运营保持；关闭运营时 Task Monitor 与 Developer Resources 消失；其余包也按各自边界撤销并可恢复，没有关闭 Extension Center。
- Host read-back：每次状态都同时反映到 Cordis Loader Group 与隔离 `settings.yaml`；恢复后六包均启用、`20 产品能力 / 20 Harness 已加载 / 0 技术状态需关注`。
- Console / Network：串行 Switch 页面无 `warn` / `error`；逐请求全局 Network Ledger 仍是横切 `PENDING`。
- Result：`PASS`（六包 Direct Switch 与无关产品隔离）；每个内部 Runtime Entry 的核心业务恢复动作仍由各自 Matrix Scenario 证明。

### REC-PACK-CASCADE-001

- Operation：真实关闭 Content Pack，页面自动级联关闭 Proposal、Automation、Operations；随后从级联关闭状态反向启用 Automation。
- Visible feedback：Content 关闭后 Agent、Skill 和原生 Session 保持可用，通知、Task Monitor、PDF Viewer 与依赖包入口撤销。反向启用 Automation 时 Content 自动补齐，Proposal 与 Operations 保持关闭；最后分别恢复 Proposal 与 Operations。
- Host read-back：Settings 精确记录四个包 `false`；反向启用后 Content / Automation 为 `true`、Proposal / Operations 仍为 `false`，最终全部回到 `true`。Loader Group 与技术清单在每一步一致。
- Console / Network：串行交互无 `warn` / `error`；逐请求全局 Network Ledger 仍待补。
- Result：`PASS`（Dependency Cascade、Reverse Enable 与无关产品隔离）。

### REC-CONTENT-PACK-ABSENT-BOOT-001

- Setup：仅在隔离 Home `/private/tmp/paimind-r13-e2e.missing.HEZwdL` 移除 Content Pack 所属九个 Runtime Package Symlink：`workspace-project`、`better-sidebar-adapter`、`artifact-runtime`、`generator-web`、`generator-office`、`renderer-bento`、`renderer-pdf`、`artifacts`、`conversation-artifact-renderer`；先把 Content / Proposal / Automation / Operations 持久开关置为关闭，再 Cold Boot。未触碰共享 `3080`、主 Checkout `.dsh-home` 或企业 Worktree。
- Browser / Host read-back：Extension Center 始终可进入，Content 及三个依赖包准确显示关闭，Experience / Agents 保持运行中，技术清单为 `7 产品能力 / 7 Harness 已加载 / 0 技术状态需关注`；Agent Center、Skill Center、原生 Session 与 Composer 可用，没有把物理缺席显示成成功加载。
- Core unrelated action：同一页面创建真实 `R13_EXPERIENCE_PACK_OFF_NATIVE_OK` Turn；Session JSONL SHA-256 `3b9af0f2ea0c879d263bc42b43e8b37c1b2ad478dcdcfad67b575c234c45b558`，包含 `assistant/chunk`、`assistant/message source.kind=model` 与 `turn/end completed`，证明无关产品和 Native Session 在九包缺席时仍可执行。
- Result：`PASS`（Content Pack Physical Absence、Control Plane Honesty 与 Unrelated Product Isolation）。

### REC-CONTENT-PACK-ENABLE-FAILURE-001

- Operation：保持九个 Content Runtime Package 物理缺席，在真实 Extension Center 点击启用 Content Pack。
- Visible failure closure：页面明确显示 `未保存；已恢复主机中的实际状态。`，Content Switch 保持关闭；技术清单继续为 `7 / 7 / 0`，Extension Center、Agent / Skill 与原生 Session 仍可用，没有 Loading 卡死或假成功。
- Authoritative rollback：隔离 `settings.yaml` 在失败前后 SHA-256 均为 `8b7eaa8a421f011128a5ab87e9e259abcf5bb680abe59c5fcaed4bc7a57fb85b`；Runtime 记录准确 `ERR_MODULE_NOT_FOUND` 并完成 Settings / Loader Rollback，Listener 未退出。
- Result：`PASS`（真实 Missing-package Enable Failure、No False Success 与回滚）。

### REC-CONTENT-PACK-RELOAD-RESTART-001

- Reload / restart：九包继续缺席时真实 Reload，随后主动重启同一隔离 Harness；全新 Browser Tab 均恢复完整 Product Shell，Extension Center 回读 `7 / 7 / 0`，四个依赖包保持关闭，Experience / Agents、原生 Session 历史与 Composer 保持可用。
- Console boundary：主动重启窗口的旧页面连接中断不隐藏；稳态 Fresh Tab 无未恢复 `warn` / `error`。逐入口 Network Ledger 仍保持 `PENDING`。
- Result：`PASS`（Physical-absence Refresh / Process Restart Persistence）。

### REC-CONTENT-PACK-RESTORE-001

- Restore：恢复九个原包 Symlink 后，从真实 Extension Center 启用 Content；canonical Settings 保存 Content `true`，SHA-256 `b58c6995b16956ab1fbd608a113871d74f3bf0c8bb31cc3dd550665cd299a6e5`。Proposal / Automation / Operations 仍保持用户此前的关闭状态，Experience / Agents 保持启用；技术清单精确恢复为 `13 / 13 / 0`。
- Core actions：从 Files Tree 真实打开 XLSX Ribbon / Sheet / Zoom、PDF `1/3 → 3/3` 与 `125%`、PPTX `1/2 → 2/2`、HTML Preview / Edit / Refresh，以及既有 Bento HTML；各 Viewer 重新可用。XLSX 卸载清理的独立失败与最终恢复见 `REC-XLSX-UNMOUNT-ATTEMPT-001..004` 和 `REC-XLSX-UNMOUNT-RECOVERY-001`。
- Result：`PASS`（九包 Reinstall、Content Enable 与 Viewer Core-action Recovery）；各 Generator / Renderer Runtime Entry 是否九轴完成仍按 Matrix 单独判断。

### REC-PACKS-RESTART-001

- Operation：在 Content 及三个依赖包为关闭状态时重启隔离 Harness，并从全新 Browser Tab 打开 Extension Center。
- Failure：页面 Switch 正确回读四包关闭，但 Runtime Technical Inventory 仍为 `20 / 20`，通知、Task Monitor、PDF、Scheduler 和 Developer Resources 继续可见。持久 Control State 与 Loader Runtime State 分裂。
- Root cause：原实现只在 Loader 启动完成后调用 Group Update；Cordis Group 自身始终可创建，子 Entry 已在 Reconciliation 前启动。之后再只切 Group Disabled 无法保证冷启动子树从未加载。
- Result：`FAIL`（Attempt 1，保留）；恢复见 `REC-PACKS-RESTART-RECOVERY-001`。

### REC-PACKS-RESTART-RECOVERY-001

- Fix：Extension Center 在公开 `loader/entry-init` 事件的 Microtask 阶段读取 canonical Settings，并在 Group 启动子 Entry 前只修改产品 Group / Capability 的原始 `options.disabled`；启动完成后仍保留公开 Loader Update 作为运行期 Reconciliation。没有递归 Update 子包，也没有修改 Harness 源码。
- Targeted / build evidence：Extension Center 与 Harness Compat 定向测试 `4 files / 15 tests PASS`；两个 Package Typecheck `PASS`；完整 `pnpm run build` `PASS`。
- Adversarial boot：先故意让 `profiles/web/cordis.yml` 中四个包 Group 全部处于 Enabled，而 `settings.yaml` 保持 Content / Proposal / Automation / Operations 为 `false`，再启动同一隔离 Runtime。Cold Boot 自动把四个 Group 回写为 `disabled: true`，HTTP 200，Loader 无重复 Domain 或启动失败。
- Browser / Host read-back：Fresh Tab 中 Extension Center 常驻；四包关闭，产品技术清单从 `20 / 20` 真实降为 `7 / 7`，关闭类别计数为 `0`，Agent / Skill 入口保留，页面 `dev.logs()` 为空。Profile 与 Settings 都精确回读关闭状态。
- Recovery：页面反向启用 Automation，Content 自动恢复，技术清单为 `15 / 15`；随后恢复 Proposal 与 Operations，回到六包及 Orbs 全开、`20 / 20 / 0`。再次主动重启 Harness 后，全新 Tab 仍显示全部 Enabled、`20 / 20 / 0`，Console / Network Log 为空，HTTP 200。
- Result：`PASS`（Cold Boot Off-state Reconciliation、依赖恢复、全开重启与 Extension Center Always-on）；Revision Conflict 与 Settings Write Failure 见以下独立回执，缺包启动仍单独保持 `PENDING`。

### REC-SETTINGS-REVISION-CONFLICT-001

- Operation：同时打开两个真实 Chrome Extension Center 页面 A / B；两页均在同一初始 Host Projection 下显示 `动态状态球 · 已启用`。页面 A 先关闭 Runtime Orbs 并完成 Reload，页面 B 不刷新，仍保留旧 Revision 与旧 Enabled UI；随后在 B 点击同一关闭开关，触发真实 CAS Revision Conflict。
- Visible feedback：页面 B 没有覆盖新值，明确显示 `未保存；已恢复主机中的实际状态。`，并重新 Describe 为 `动态状态球 · 已关闭`。Switch 恢复为可操作状态，未停留在 Pending / Disabled。
- Recovery / Host read-back：使用 B 在新 Revision 上重新启用 Runtime Orbs，页面 Reload 后显示 `动态状态球 · 已启用`；技术清单恢复 `20 产品能力 / 20 Harness 已加载 / 0 技术状态需关注`。隔离 `settings.yaml` 最终精确保存 `"paimind:capability:runtime-orbs":true`，SHA-256 `1ec5ebcbce1f5dc2517f2a8167db9d287ace6c6910efb7f50554c0e523675b9f`。
- Console / Network：两页冲突、回读和恢复期间均无页面 `warn` / `error`；Remote Error 被产品 Feedback 消费，未破坏原生 Session 或 Extension Center。
- Result：`PASS`。

### REC-SETTINGS-WRITE-FAILURE-001

- Operation：仅在隔离 `DSH_HOME=/private/tmp/paimind-r13-e2e.slTHZt` 内，把 Home Directory 临时设为 `0500`、`settings.yaml` 设为 `0400`；随后从真实 Extension Center 点击 `动态状态球 · 已启用`。预置自动 Permission Restore，页面回读完成后立即人工恢复为 `0700 / 0600`。
- Visible feedback：写入失败后页面显示 `未保存；已恢复主机中的实际状态。`；Runtime Orbs Switch 保持 `动态状态球 · 已启用`，技术清单保持 `20 / 20 / 0`，没有留下半应用 Loader State。
- Authoritative rollback：失败前后 `settings.yaml` SHA-256 均为 `1ec5ebcbce1f5dc2517f2a8167db9d287ace6c6910efb7f50554c0e523675b9f`。恢复写权限后，再从页面真实关闭并重新启用 Runtime Orbs 均成功；最终权限为 `0700 / 0600`、HTTP `200`（约 `1.2ms`）且 Extension Center 回读全开。
- Console / isolation：失败、回滚与恢复路径的页面 Console `warn/error = 0`。未修改共享 `3080`、主 Checkout `.dsh-home` 或企业 Worktree。
- Result：`PASS`。

### REC-PACKAGE-ABSENT-BOOT-ATTEMPT-001

- Setup：在隔离 Home `/private/tmp/paimind-r13-e2e.missing.HEZwdL` 中构造不含 `@paimind/task-monitor` 的 Composition（组合）；未触碰共享 `3080`、主 Checkout `.dsh-home` 或企业 Worktree。
- Failure：第一版 Composition 同时保留了指向缺失 Task Monitor 的 Invariant / Runtime Entry，完整 Harness Cold Boot 直接退出，不能打开 Extension Center，也不能证明隔离。
- Result：`FAIL`（Attempt 1，保留）；这是无效验收夹具，不计产品通过。修正后的冷启动见 `REC-PACKAGE-ABSENT-BOOT-001`。

### REC-PACKAGE-ABSENT-BOOT-ATTEMPT-002

- Setup：把 `paimind:pack:operations` 预设为 `false`，但仍让 Composition 在 Extension Center 完成启动 Reconciliation 前导入缺失 Runtime Entry。
- Failure：Harness 以 `ERR_MODULE_NOT_FOUND` 退出；持久开关为关闭不等于 Loader 在冷启动时不会先导入子包。
- Root cause：六个 Product Group 的 Bootstrap Default 仍是 Enabled；Control Plane 尚未进入 Loader Barrier 时，子 Entry 已开始解析。
- Result：`FAIL`（Attempt 2，保留）；修复见下一条。

### REC-PACKAGE-ABSENT-BOOT-001

- Fix：`packages/harness-bundle/cordis.patch.yml` 将六个 `paimind-pack-*` Group 的 Bootstrap Default 设为 `disabled: true`；Extension Center 在 Loader Barrier 前通过 `stagePaimindFeatureLoaderEntryOptionsForBoot` 仅暂存 Managed Group / Capability 为 Disabled，Barrier 后再按 canonical Harness Settings 恢复。
- Physical absence：测试期间 `/private/tmp/paimind-r13-e2e.missing.HEZwdL/profiles/web/node_modules/@paimind/task-monitor` 与 `without-task-monitor-bundle/node_modules/@paimind/task-monitor` 均物理缺席；不存在用 Orphan Symlink 伪装卸载的情况。
- Browser：`http://127.0.0.1:62473/` 返回真实 Harness 页面；Extension Center 始终可进入，五个无关 Product Pack 均为 `运行中`，Work Operations 为关闭，技术清单为 `18 产品能力 / 18 Harness 已加载 / 0 技术状态需关注`。Agent Center 与既有原生 Session 保持可用。
- Core business action：在同一原生 `session-79b1ecac-55ee-42da-9191-82ea0a2bff88` 发送第二轮消息，Browser 显示新的 `R13_BENTO_OK`；JSONL 有真实 `assistant/chunk`、`assistant/message source.kind=model`、provider `deepseek-official`、model `deepseek-v4-flash` 与 `turn/end completed`，无手写状态或 Mock UI。
- Refresh / restart：页面 Reload 后仍为 `18 / 18 / 0`，五个无关包和原生历史可用；主动重启同一隔离 Harness 后状态、历史和 Control Plane 继续恢复。
- Console / Network：稳态 Browser 页面无 `warn` / `error`；64 个页面静态资源 Host Ledger 均为 HTTP 200。主动 Process Restart 窗口的旧标签按预期出现连接丢失日志，恢复后 Fresh Tab 干净；该窗口日志不被隐藏，也不外推为全局 Network PASS。
- Result：`PASS`（Package-absent Cold Boot、无关包隔离、原生 Session、Refresh、Process Restart 与 Host Read-back）。

### REC-PACK-START-FAILURE-001

- Operation：保持 Task Monitor 物理缺席，在真实 Extension Center 点击 `工作运营 · 已关闭` 开关尝试启用。
- Visible failure closure：页面明确显示 `未保存；已恢复主机中的实际状态。`；Operations 继续为 Off，没有显示 `运行中` 或留下 Loading 假成功，Extension Center、原生 Session 与无关五包继续可用，HTTP 仍为 200。
- Authoritative rollback：隔离 `settings.yaml` 的 `paimind:pack:operations` 保持 `false`，失败前后 SHA-256 均为 `3d75f06523610bbbc80462704a9b0ef68dcb9fb6c21bfa7baac7077d5f682428`；Loader 没有留下半启用 Group。
- Refresh / restart：刷新和同一隔离 Harness 重启后仍为 `18 / 18 / 0`、Operations Off、五个无关包运行中、原生历史可读。
- Result：`PASS`（真实错误启用、Settings / Loader Rollback 与 No False Success）。

### REC-PACKAGE-REINSTALL-RECOVERY-ATTEMPT-001

- Failure：首次重新安装完整 Bundle 后，旧 Loader-first Mutation 先改变 Client Roster，再写 Settings；页面停留 `Loading plugins…`，Host Settings 仍为 `false`，无法证明 Recovery。
- Root cause：动态 Client Plugin Roster 改变可在后续 Settings RPC 前触发页面 Reload / Disconnect，造成 Control State 与 Loader State 事务边界不完整。
- Result：`FAIL`（Attempt 1，保留）；修复和回归见下一条。

### REC-PACKAGE-REINSTALL-RECOVERY-001

- Fix：Extension Center 改为 Settings-first Transaction；先用 CAS 写 canonical Settings，再更新 Loader Overrides。Loader 失败时按最新 Revision 回滚 Settings 和 Loader；自身 Settings Watcher 在 Mutation Depth 内不重复 Reconciliation。
- Reinstall：在同一隔离 Home 重新安装完整 Staged Bundle 与 `@paimind/task-monitor` 后，从真实页面启用 Operations。`settings.yaml` 保存 `paimind:pack:operations=true`，最终 SHA-256 为 `1ec5ebcbce1f5dc2517f2a8167db9d287ace6c6910efb7f50554c0e523675b9f`。
- Browser / core action：页面恢复 `20 产品能力 / 20 Harness 已加载 / 0 技术状态需关注`；Task Monitor 入口出现并可打开真实 `任务监控` Region、`任务摘要`、当前 `R13_BENTO_OK` Session、Workspace、标准 Agent 与 Idle 状态。
- Refresh / restart：页面 Reload 后重新点击 Task Monitor，核心面板回读 `R13_BENTO_OK`、`workspace`、`standard` Agent 与 `空闲`。主动 Process Restart 后，Fresh Tab `id=39` 再次恢复全部六包、原生 Session 历史和 Task Monitor 入口；重新打开核心面板得到相同权威摘要，`dev.logs(warn,error)=[]`。
- Restart attempt：第一次重启误用系统 Homebrew Node，因缺失 `libsimdjson.29.dylib` 在 Harness 启动前退出；随后改用 Codex Bundled Node 在同一隔离 Home 和端口成功启动。该 Attempt 保留为环境漂移证据，不伪装成产品执行成功。
- Fresh Tab / Console：重复失败标签曾捕获一次 Extension Center Client Import Failure 和两次 `Page.navigate` Timeout；清理本轮十个重复 Agent-created Tabs 后，新 Fresh Tab `id=38` 在约 5 秒内完成并显示原生 Session、Task Monitor 入口及 `20 / 20 / 0`，`dev.logs(warn,error)=[]`。该恢复被记录，但不作为全局浏览器性能外推。
- Network：Host 对根页、Extension Center Client Bundle 与 Harness Client Connection Bundle 均为 HTTP 200，单请求约 `1–2ms`；此前完整 64 项静态资源 Ledger 为 `64 / 64 HTTP 200`。全部 Runtime Entry 的逐请求 Global Network Ledger 仍保持 `PENDING`。
- Targeted evidence：`pnpm exec vitest run packages/extension-center/tests/client.spec.tsx packages/extension-center/tests/feature-packs.spec.ts` 为 `2 files / 13 tests PASS`；`pnpm --filter @paimind/extension-center run typecheck`、`pnpm run build` 与 `git diff --check` 均通过。这里只计定向回归，不升级 Final Gates。
- Result：`PASS`（Reinstall、Settings-first Recovery、Task Monitor Core Action、Refresh、Process Restart、Fresh Tab 与九项 Lifecycle Evidence）。

### REC-LOADER-STATUS-PROJECTION-FALSE-SUCCESS-ATTEMPT-001

- Failure：在 Product Pack（产品功能包）开关保持 `true` 时物理移除组内 Runtime Package，旧实现只投影 canonical Settings（规范设置）中的期望值；Extension Center 仍把未完整加载的 Pack 显示为 `运行中`。这是一条真实 Package-absent Boot False Success（缺包启动假成功），此前“先关闭 Pack 再移除包”的证据不能覆盖该路径。
- Root cause：Cordis Group 的一次子 Entry 启动失败会回滚同一 Loader Transaction（加载器事务）中此前已经成功启动的兄弟 Entry；旧 Reconciliation（协调）既没有记录 Group Failure（组失败），也没有在回滚后重放健康组，造成 Settings、Host Inventory（宿主清单）与 Client Contributions（客户端贡献）可能短暂分裂。
- Additional attempt：Content 缺 `@paimind/generator-web` 的首个 Fresh Chrome Tab 只出现 Extension Center，健康 Experience / Agents Client 贡献没有及时出现；13 个 Boot Client Script 均为 HTTP `200`，所以不是静态资源缺失或慢请求。一次 CDP `Runtime.evaluate` 超时和自动 Reload 造成的 Detached Tab 只记 Driver Attempt，不计产品通过。
- Result：`FAIL`（保留）；通用修复与四组回归见以下 Receipts。

### REC-LOADER-STATUS-PROJECTION-RECOVERY-001

- Generic fix：Extension Center 把 `desiredEnabled` 与实际 `enabled` 分开投影，并为 Pack / Capability 增加 `failure`；协调时先把六个 Managed Group（受管组）收敛到已知关闭基线，再按依赖顺序启用。某一组失败后只隔离失败组，重放被同一 Cordis Transaction 回滚的健康兄弟组，并把依赖失败作为明确 Failure Projection（失败投影），不对 Proposal、Content 或任一包写特判。
- Browser feedback：期望启用但启动失败的 Pack 保持 Switch Checked（开关已选），可访问名称为 `启用失败`，状态为 `启动失败`，并显示精确 Loader Error；依赖 Pack 显示 `Required Product Pack failed: <pack-id>`，不再伪装 `运行中`。父 Pack 失败时 Capability Switch 禁用。
- Boot consistency：Client 增加六包 Sentinel Contribution（哨兵贡献）与有界 Readiness Signal（就绪信号）`data-paimind-boot-consistency=checking|ready|reloading|failed`；Host 宣称健康但首轮 Client Roster 缺失时只自动 Reload 一次，5 秒内未收敛才进入显式失败，不允许无限刷新或只以 HTTP `200` 判定就绪。
- Supporting gates：Extension Center 定向测试 `2 files / 16 tests PASS`，Package Typecheck、完整 Build 与 `git diff --check` 均 PASS；已增加共享事务回滚后健康组重放、失败视觉状态和 Client Gap Detection（客户端缺口检测）覆盖。这里只作为缺陷回归证据，Final Gates 仍为 `PENDING`。
- Result：`PASS`（Shared Loader Group / Status Projection Root Fix）；以下真实 Physical Absence（物理缺席）与 Recovery（恢复）证明产品行为。

### REC-PROPOSAL-PACK-ABSENT-HONESTY-001

- Physical absence：在隔离 Home `/private/tmp/paimind-r13-e2e.proposal-absent.Dn1FKI` 同时移除 Proposal Pack 六个 Runtime Package：`category-analysis-adapter`、`fact-layer`、`generator-bento`、`presentation-trace`、`proposal-experience`、`walmart-proposal-adapter`，开关保持期望启用。
- Browser / Host read-back：`64291` 的真实 Extension Center 显示 `提案与演示 · 启用失败`、`0 / 6`、精确首个缺包错误；Experience / Agents / Content 继续为运行中，技术清单为 `13 产品能力 / 13 Harness 已加载 / 6 技术状态需关注`。Fresh Chrome 有完整 Shell、Agent / Skill 入口，`dev.logs()=[]`；Reload 与主动 Process Restart 后状态不变。
- Unrelated core action：原生 Session `session-69f61a2e-eca3-46ca-bd72-58d26869987a` 的 JSONL SHA-256 `da98b8a0f42581ae92d9d90e3f9a9b7a20e0a5d3a49d76fa11d1e8db781b0e6b` 含真实 `assistant/chunk`、`assistant/message source.kind=model`、Provider / Model 与 `turn/end completed`；Fixture 返回内容与提示 marker 不同，因此只证明真实无关 Session 链仍可执行，不把 marker 语义计作 Proposal 业务成功。
- Recovery：恢复六个物理包并重启同一 Home / Port 后，Proposal 回到 `6 个内部模块 / 运行中`、技术状态需关注 `0`；真实 Proposal Assistant Intake（提案助手输入）重新出现并完成 Customer Selection / Cancel / Final Model Reply，Fresh Chrome Console 为空。
- Result：`PASS`（Proposal 六包缺席诚实投影、无关包隔离、Reload、Restart 与 Reinstall Recovery）；六个内部 Runtime Entry 的独立九轴仍按 Matrix 保持 `PENDING`。

### REC-EXPERIENCE-AGENTS-PACK-ABSENT-SAMPLES-001

- Experience sample：隔离 Home `/private/tmp/paimind-r13-e2e.experience-absent.lVcN2U` 物理移除 `@paimind/branding`。Extension Center 显示 `产品体验 · 启用失败`、`0 / 4` 与精确 Loader Error，Runtime Orbs 因父包失败禁用；Agents / Content / Proposal、原生 Shell 与 Settings 可用，Chrome `dev.logs()=[]`。测试后已恢复物理包并停止该 Runtime。
- Agents sample：隔离 Home `/private/tmp/paimind-r13-e2e.agents-absent.0UqXcL` 物理移除 `@paimind/agent-market`。Extension Center 显示 `智能体中心 · 启用失败`、`0 / 3`；Agent / Skill 入口按完整组回滚撤销，Experience / Content / Proposal、Paramont Shell 与 Settings 保持可用，Chrome `dev.logs()=[]`。测试后已恢复物理包并停止该 Runtime。
- Result：`PASS`（通用修复对 Experience 与 Agents 的防倒退抽样）；不外推这两组已完成 Runtime Entry 之外的逐入口 Global Network Ledger。

### REC-CONTENT-DEPENDENCY-ABSENT-RECOVERY-001

- Physical distinction：隔离 Home `/private/tmp/paimind-r13-e2e.content-absent.sQdthE` 仅物理移除 `@paimind/generator-web`；同一 Home 内 Proposal 六包均为 `PRESENT`。Host 把 Content 失败记录为 `Cannot find package '@paimind/generator-web'`，把 Proposal 分别记录为 `Required Product Pack failed: paimind:pack:content`，证明 Proposal 是预期 Dependency Cascade（依赖级联），不是物理包未恢复。
- Missing-state Browser：修复后 Fresh Chrome 完整加载 Paramont Shell、Agent / Skill 与原生 Composer；Extension Center 显示 Content `启用失败` 与精确物理错误，Proposal `启用失败` 与依赖错误，Experience / Agents 健康。Client bounded signal 为 `ready`，Chrome `dev.logs()=[]`。缺包状态下原生 Session `session-314f886f-86d6-4b98-baa5-61ada8adb19c` 产生真实 Model Reply、`assistant/message source.kind=model` 与 `turn/end completed`。
- Failure closure：恢复 Content 后第一次生成使用已存在固定路径，Tool 正确失败为 `cannot overwrite existing ... without reading it first`；该 FAIL 保留，没有覆盖旧文件或伪造成功。隔离 Deterministic Provider 随后改用唯一 marker / path，并经真实 Harness LLM / Tool / Job 链重新执行。
- Artifact recovery：同一 Session 真实调用 `generate_html_artifact · deliverables/r13-content-restore-artifact.html`，原生 Job 为 `completed, html revision 1`，模型回复 `R13_CONTENT_RESTORE_ARTIFACT_OK`，Artifact Card 为 `网页文档 · 可用`。Session JSONL SHA-256 `fd4facf13899d37cbe8a73688d9e21b2e0a2ff832daeb28afcd3e1ba98c13d43`；产物 628 bytes，SHA-256 `2932f27e760aa0dd60c90f6b09ed36e11af5097b9652cf4d417fe76560ab3407`。
- Process restart：恢复 `@paimind/generator-web` 后主动重启同一 Home / Port，新 Listener PID `62585`。Fresh Chrome URL `?r13-content-artifact-restart=1787862518660` 为 `readyState=complete`、Boot Signal `ready`、无 Loading / Failed Plugins；原 Session、失败 Attempt、成功 Tool / Job / Artifact Card 和持久 File Tab 全部恢复。可见 HTML Viewer 再次显示 `R13_CONTENT_RESTORE_ARTIFACT_OK`、`R13_HTML_MOBILE_SAFE_420` 与 `回归按钮`。
- Extension Center / Host：重启后 Content `9 个内部模块 / 运行中`，Proposal `6 个内部模块 / 运行中`，技术清单 `16 产品能力 / 16 Harness 已加载 / 0 技术状态需关注`；Automation / Operations 保持用户预期关闭。`settings.yaml` SHA-256 `83e877ed35078b837f41895ba4d1ce58b2935d0f99a2ca0a087f4f4ec3086e06`，根页 HTTP `200`、20567 bytes、约 `2.4ms`，Chrome `dev.logs()=[]`。
- Driver boundary：一次 Locator Click 与一次 CDP Evaluate 超时保留为 Driver Attempt；后续通过重新连接、macOS AX（系统可访问树）、真实 System Click（系统点击）和 Screenshot（截图）完成权威回读，不把超时计 PASS。
- Result：`PASS`（Content 物理缺席诚实投影、Proposal Dependency Cascade、健康包可用、失败关闭、恢复安装、同一 Session / Artifact、Reload 与 Process Restart）；当前总进度仍为 `17 / 30`，不从 Pack 级证据外推剩余 13 个 Runtime Entry。

### REC-PROPOSAL-EXPERIENCE-RESPONSIVE-ATTEMPT-001

- Invalid emulation：第一轮循环虽然请求 `1440 / 1100 / 760 / 420`，每档 `innerWidth/clientWidth` 与控件几何都仍为 `1680`；这不是四档真实响应式，Result=`FAIL`。
- Crowded-window attempt：旧 Chrome 窗口累积多个 Experience / Content / Proposal 验收标签；新建的一个 `420` 标签停在 `Loading plugins…`，同时 Browser Driver 连续超时。该现象没有在单标签窗口复现，因此归类为 Driver / Tab Accumulation Attempt，不计产品 `PASS` 或产品缺陷。
- Same-session attempt：首次 `1440` 提示复用已有 `ask_user_question` Tool Result 的 Session，确定性 Provider 直接返回模型文本而没有新卡片。该运行只证明 Fixture 的 Session 语义，不能作为 Intake 正向验收。

### REC-PROPOSAL-EXPERIENCE-OFF-RECOVERY-001

- Off：在六个 Proposal Package 全部物理存在的恢复 Home 中，从真实 Extension Center 关闭 Proposal Pack。权威 Settings 回读 `paimind:pack:proposal=false`；六项 Proposal UI / Tool Contribution 撤销，Style Frame 数为 `0`，无关 Experience / Agents / Content 与原生 Session 保持可用，技术清单为 `13 / 13 / 0`，Console `warn/error=[]`。
- Recovery：再从同一页面启用 Proposal，Settings 回读 `paimind:pack:proposal=true`；页面恢复 `6 / 6` Proposal 模块、总计 `16 / 16 / 0`、Proposal Style / Intake 与真实 Agent / Skill / Session 入口。随后主动 Process Restart，使用同一 Home、Workspace、`64291` 与 `--no-open`；Fresh Browser 仍为 `6 / 6`、`16 / 16 / 0` 并可生成真实 Intake Card。
- Result：`PASS`（OD / RC / RS）；物理缺席与重新安装见 `REC-PROPOSAL-PACK-ABSENT-HONESTY-001`。

### REC-PROPOSAL-EXPERIENCE-INTERACTION-001

- Pointer / system keyboard：420 档系统点击 `140 · Stationery` 后系统 Space 保持选中，活动控件为 `BUTTON role=radio aria-label=140 · Stationery`；760 档系统点击改选 `410 · Holiday Events`；1440 独立新 Session 中点击 Walmart 后，真实焦点链为 `Walmart radio → custom INPUT → Back → Continue`，系统 Return 提交 Continue。
- Back：1100 档系统点击 Back；Session `session-ce6133a9-14a6-4b22-ae57-f3724dae3495` 的 Tool Result 为 `selected=[]` 与 `custom=PAIMIND_PROPOSAL_NAVIGATION:BACK`，JSONL SHA-256 `c3698a036328c94671ea97901ded9dc0b2d047f52f6c368ba1b8a13b63c530da`。
- Submit：1440 独立 Session `session-47add3e3-fc21-4d1c-b681-9d3258410cd0` 的 Tool Result 为 `selected=[Walmart (recommended)]`；页面显示 `1/1 已回答` 与 `R13_PROPOSAL_CUSTOMER_OK`，JSONL SHA-256 `acb00e64d97f4d58ae58e1c37cb6b20ad5f6a282b97ed3d2e551674ad78332eb`。
- Cancel：760 独立 Session `session-d349827c-4d25-42f2-8ce3-ef5fcd40b674` 点击 `Cancel proposal question`；Tool Result 为 `selected=[]` 与 `custom=PAIMIND_PROPOSAL_NAVIGATION:CANCEL`，页面显示 `1/1 已回答` 与 `R13_PROPOSAL_CANCEL_OK`，JSONL SHA-256 `aa6bd3d4d30ef3cf369c9ab33cdc50d93d2ffec78bc01a00c678ffe64ac4e0e3`。
- Provider authority：三个接受场景均有真实 `assistant/message source.kind=model`、provider `deepseek-official`、model `deepseek-v4-flash`、权威 Tool Result 与 `turn/end completed`；没有 Mock UI、手写 JSONL 或提示词伪造成功。
- Feedback：已覆盖 `运行中`、`提问 等待回答`、`等待你的选择`、选择前 Continue Disabled、选择后 Enabled、Focus、`1/1 已回答` 和最终模型确认。Package Absence 提供显式 Error / Failure Closure；New Session 的空 Composer 与 Disabled Send 提供 Empty / Disabled 基线。
- Result：`PASS`（真实点击、系统键盘、Focus、Loading / Empty / Error / Disabled、Back / Cancel / Submit 与确认反馈）。

### REC-PROPOSAL-EXPERIENCE-RESPONSIVE-RECOVERY-001

- Isolation / fresh boot：系统 `Cmd+N` 新建普通 Chrome 窗口，只打开 `http://127.0.0.1:64291/?r13-proposal-responsive-window=1787863630`。12 秒内完整 Shell、Composer、Agent / Skill / Settings 与 `data-paimind-boot-consistency=ready` 出现；单标签 Fresh Boot `warn/error=[]`。
- Real bounds：通过真实 macOS Chrome Window Bounds 调整外窗，得到四档精确且不同的页面回读：`420/420/420`、`760/760/760`、`1100/1100/1100`、`1440/1440/1440`（依次为 `innerWidth/clientWidth/documentElement.scrollWidth`），没有使用 Viewport Override（视口覆盖），Body Scroll Width 也等于目标宽度。
- 420 geometry：Department Region `66–394,width=328,height=564`；三个 Radio `79–381,width=302`；Back `79–126.08`、Continue `290.47–381`、Cancel `315.66–375`。
- 760 geometry：Region `152–700,width=548,height=475`；Radio 列 `177–420.5` / `431.5–675`；Back `177–224.08`、Continue `584.47–675`。
- 1100 geometry：Region `376–1040,width=664,height=463`；Radio 列 `401–702.5` / `713.5–1015`；Back `401–448.08`、Continue `924.47–1015`。
- 1440 geometry：Customer Region `418–1338,width=920,height=390`；Radio `443–872` / `884–1313`；Back `443–490.08`、Continue `1222.47–1313`。全部可见卡片、Radio、Back / Continue / Cancel 与焦点几何均落在真实 `innerWidth` 内。
- Pixel / zoom boundary：四档 `outerWidth/innerWidth` 分别为 `660/420`、`1000/760`、`1340/1100`、`1680/1440`，固定 `240` 差值来自 Chrome 垂直标签／浏览器栏；每档 `devicePixelRatio=1`、`visualViewport.width=innerWidth`、`visualViewport.scale=1`。系统 `Cmd+0` 后数值不变，证明页面已是 100% Actual Size。较大 JPEG 被 Computer Use Evidence Renderer 按约 `768/952` 等比降采样，属于证据图像交付尺寸，不是 Browser Zoom 或 CSS Viewport 错配。
- Reload / navigation：Real Reload 恢复当前 Session、模型回复、Composer、`ready` 与精确 `760` 宽度。Browser Back 到 `chrome://newtab/` 时扩展控制按页面边界释放，该 Driver Attempt 保留；系统 Chrome Forward 恢复同一 URL、Session 和 `ready`。离开页面产生一条预期 `[web-runtime] connection lost, retry #1`，没有 Error 且 Forward 后完整恢复；不将该预期导航 Warning 冒充 Fresh Page 零日志。
- Durable evidence：外部回执 `/Users/hansen/.codex/visualizations/2026/08/27/01a042c0-a240-7230-b639-7a9ee41c500a/R13-proposal-experience-responsive-browser-receipt.md`，SHA-256 `af31f64c93b077173dcf17e7425dc13fadf115bd9a61144c70428aa07aa3e613`；四张截图 SHA-256 为 `c26f79f0…`、`b682b746…`、`17198000…`、`16c4be93…`。
- Result：`PASS`（四档真实 Window Bounds、Screenshot / AX、无横向 Overflow、交互、Reload 与 Back / Forward Recovery）。

### REC-PROPOSAL-EXPERIENCE-NETWORK-001

- Boot / client：根页精确 Boot Entry 为 `/plugins/@paimind/proposal-experience/client.js?rev=e20140b99d34`；请求为 HTTP `200`、`750737` bytes、`0.001888s`，SHA-256 `a38c17958dc2b272d23f706ed171e940567fb28424da81e2fc25f5a8312cc402`。
- Error boundary：不存在的 `/plugins/@paimind/proposal-experience/missing-r13.js` 返回 HTTP `404` 与空 Body；运行中页面没有被污染或显示假成功。Package Physical Absence 时 Extension Center 明确失败，恢复后才加载真实 Client Contribution。
- Business chain：Customer / Department 的 Provider HTTP/SSE、`ask_user_question` Tool Call / Result、模型回复与 `turn/end completed` 全部在上述三份 JSONL 权威回读；正常 Fresh Boot、四档操作、Submit、Cancel 与 Reload 均无 Browser Error。Back 离页的单条已恢复 Warning 单独分类，不是未恢复网络错误。
- Result：`PASS`（`@paimind/proposal-experience` 逐入口 request / error ledger）。

### REC-BOOT-PASSIVE-OBSERVER-ATTEMPT-001

- Original failure：拥挤的既有 Chrome / DevTools Profile 中，多次 Fresh Tab 停在 `Loading plugins…`；其中一次旧诊断只记录 `43 complete + 19 import-start`，20 秒 Timer 与 Host Receipt 也没有继续触发。该 Failure Attempt 保留，不能用根页 HTTP `200`、静态资源快速返回或 Console 为空替代 Ready。
- Invalid diagnostic：Extension Center 第一版早期诊断对 `system.import` 增加并发门控；该实现会改变原 Module Loader 的执行语义，并可能让递归／共享依赖占满外层 Slot。该诊断已撤销，其 `43 / 19` 结果视为 Self-introduced Attempt（自引入尝试），不作为 `Unbounded Concurrent Script Arrival` 假设的证据。
- Passive comparison：完全 Passive Observer 只同步调用原 `system.import`、保留原返回值与 Promise Identity，不排队、不限流；同一 `62-entry` Graph 下，旧 Chrome 151 页面已经把 `62 / 62` Import 全部 Launch，但当时没有 Shell-ready Receipt。说明旧“19 项未进入网络”没有复现，同时旧页面仍受 Profile / DevTools / Chrome Version 环境影响，原始 Loading Attempt 继续保留为未完全解释的环境敏感问题。
- Result：`FAIL ATTEMPT PRESERVED`；不修改 Loader 并发语义，不提升任何 Runtime Entry 或 Network Ledger。

### REC-BOOT-PASSIVE-OBSERVER-RECOVERY-001

- Passive milestones：Host `GET/POST /paimind/boot-readiness` 在同步阶段立即接收 `bootstrap → facade-instrumented → module-create-start → module-create-complete → import-launch 1/16/32/48/62 → shell-ready`；Receipt 同时记录 URL、Visibility、Focus、User Agent、Graph Revision、Host Inventory、Registration Gap、Pending Import / Prefetch 与 Resource Timing。
- Contract regression：`packages/extension-center/tests/boot-readiness.spec.ts` 覆盖递归 Import 与共享依赖，验证调用顺序 `parent, shared, sibling, shared, shared`、共享 Promise Identity 与无 Deadlock；Extension Center 两个定向文件共 `9 tests PASS`，Package Type Check、完整 Build 与 `git diff --check` 通过。
- Independent process：使用全新临时 Profile `/private/tmp/paimind-r13-chrome-resize-recovery.7SFVVV` 启动独立 Chrome 152 Process PID `79676`，只打开 `http://127.0.0.1:64291/?r13-resize-recovery=fresh`；与拥挤的 Chrome 151 / ChatGPT Debug Window 不共享标签、Profile 或 DevTools Session。
- Fresh / reload / restart：Fresh 为 `664ms`、Reload 为 `409ms`、主动 Runtime Restart 后为 `402ms`；三次 Graph Revision 都是 `dfc2a161bb4d`，Host Inventory `62`、Registration Gap `0`、Pending Import `0`、Pending Prefetch `0`、Resource Timing `66`。重启窗口保留五次预期 `[web-runtime] connection lost, retry #1..#5`，稳定并 Reload 后没有继续出现。
- System interaction / AX：macOS System Keyboard 在 API Key 首次启动 Dialog 中通过 `Tab → Return` 激活 `Configure later`，完整产品壳随即可见。按 PID `79676` 的系统 AX 回读包含 `New Session`、`workspace`、`Open Agent Center`、`Open Skill Center`、`Settings`、`PARAMONT · PAIMIND`、`What would you like to accomplish?`、`标准模式`、`R13 合成验收助手`、Composer 与 Send Button；窗口 Bounds 为 `22,30,1440,953`。
- Screenshot：完整壳截图 `/private/tmp/paimind-r13-chrome-resize-recovery.7SFVVV/r13-resize-recovery-shell-interaction.png`，`1440 × 953`，SHA-256 `be8fd695b8da233232ea0cbd0cc1675e792ef8c68711d7d5493a1523934b0ab9`。启动 Dialog 截图 SHA-256 `cb126c308d8e5b6d55d2f321f1cdbc245f025c244e8b2660572151417cc4ccdd`。
- Boundary：独立 Chrome 正常只能证明产品壳在隔离 Process / Profile 下可有界启动；旧 Chrome 151 Attempt 不能只归因 DevTools，也不能据此证明任一 Runtime Entry 的九轴或逐入口 Network Ledger。
- Result：`PASS`（Passive Observer、Independent Fresh / Reload / Runtime Restart、Host Receipt、System Keyboard、Screenshot / AX）。

### REC-VISUAL-RESIZE-OBSERVER-ATTEMPT-001

- Failure：独立 Chrome 首次成功进入 Shell 后，stderr 持续高频输出 `ResizeObserver loop completed with undelivered notifications.`；启动 Ready 并不等于 Console Quality 通过，因此该 Attempt 明确记为 `FAIL`。
- Root cause：`PaimindComposerOverlayPresenter` 在每次 Resize Callback 中重新 `disconnect/observe` 同一个 Composer，并重复写相同 `--paimind-composer-overlay-room`；Resize Delivery 与 Queue Microtask 形成每帧 Feedback Loop。
- Result：`FAIL`（保留），修复与三段真实回归见下一条。

### REC-VISUAL-RESIZE-OBSERVER-RECOVERY-001

- Fix：Resize Callback 改为 `requestAnimationFrame` 合并；仅在 Composer Target 真正变化时重新绑定 Observer，Room 值变化时才写 CSS Property，Dispose 会取消待处理 Frame 并释放观察目标。
- Targeted evidence：`packages/visual-experience/tests/client.spec.tsx` 为 `1 file / 11 tests PASS`；新增回归连续触发两次 Resize Delivery，只调度一帧，并断言同一 Target 不会重新 Observe / Disconnect 或重复写 Room。Package Type Check、完整 Build 与 `git diff --check` 通过；仅保留上游 `dsh-client-ui-primitives` 缺失 Source Map 的既知非阻塞 Warning。
- Real Chrome regression：同一独立 Chrome 的 Fresh、Reload、Runtime Restart 三段增量日志均不再出现 `ResizeObserver` Warning；重启连接重试在恢复后停止，没有新增 PAIMind Product Error 或高频 Warning。Chrome 自身 GCM `DEPRECATED_ENDPOINT` 与 Harness 上游“password field is not contained in a form” DOM Advisory 单独分类，不属于本修复造成的产品回归。
- Result：`PASS`（ResizeObserver Warning Storm 修复与真实 Browser 三段回归）；该横切回归在当时不独立增加 Runtime / Network 计数，后续 Proposal 入口的升级由各自九轴与逐入口 Network Receipt 决定，当前权威计数见文末，不沿用本场景执行时的历史快照。

### REC-PROPOSAL-CATEGORY-FACT-LIVE-ATTEMPT-001

- Runtime boundary：隔离 Home `/private/tmp/paimind-r13-e2e.proposal-absent.Dn1FKI`、Workspace `/private/tmp/paimind-r13-e2e.slTHZt/workspace`、Harness `127.0.0.1:64291 --no-open`、Deterministic Provider `127.0.0.1:54417`；没有读取或复制主 `.dsh-home` Credential。
- Command failure：真实 Category Provider 首次从 Sandbox 启动时继承失效 Homebrew Node，触发动态链接失败；根因是 `prepare_category_demo_data`、`analyze_category_performance`、`analyze_category_opportunity` 与 Fact Layer 仍使用字符串 `node`。通用命令构造改为 `process.execPath`，测试明确断言三条 Category 命令与 Fact 命令都绑定当前 Runtime executable。
- Same-session failures：`session-ab2863dd-29c0-4eeb-a93a-9a15b8691379` 保留 Turn 1 `MISSING_CREDENTIAL`；隔离 Provider 接通后，Turn 2 因 `.performance.data-result.json` / `.opportunity.data-result.json` 文件名契约失败，Turn 3 因 `.fact-set.json` 文件名契约失败，页面显示明确 Error、对应 `turn/end error` 且没有最终成功标记。
- Targeted support：`packages/category-analysis-adapter/tests/provider.spec.ts` 与 `packages/fact-layer/tests/provider.spec.ts` 合计 `2 files / 5 tests PASS`，两个 Package Type Check、完整 Build 与 `git diff --check` 通过。首次直接 Shell 运行因失效 Homebrew Node `libsimdjson.29.dylib` 失败，随后用 Codex Bundled Node `v24.19.0` 完成验证；该环境 Attempt 不伪装为产品测试失败。
- Result：`FAIL ATTEMPTS PRESERVED`；对应真实恢复见 `REC-PROPOSAL-CATEGORY-FACT-LIVE-RECOVERY-001`。

### REC-PROPOSAL-CATEGORY-FACT-LIVE-RECOVERY-001

- Real Browser action：独立 Chrome 152 Process PID `79676`、临时 Profile `/private/tmp/paimind-r13-chrome-resize-recovery.7SFVVV` 通过系统 AX 设置原生 Composer 并以 AX Geometry 真实点击 Send；同一 Session 的 Turn 4 依次执行 `prepare_category_demo_data`、`analyze_category_performance`、`analyze_category_opportunity`、`build_presentation_fact_set`、`create_fact_bound_presentation_outline`、`generate_traceable_bento_from_outline`。
- Provider / Session authority：Provider receipt 七次 HTTP/SSE Decision 全部 `status=200/outcome=completed`；JSONL 含真实 `assistant/chunk`、`assistant/message source.kind=model`、Provider `deepseek-official`、Model `deepseek-v4-flash` 与 `turn/end completed`，最终模型回复 `R13_PROPOSAL_CHAIN_LIVE_003_OK`。Session JSONL SHA-256 `aeb477f224a517b11a56c429ac818078e69d1d1740d5c62a20d8b6f35b737636`，Provider receipt SHA-256 `20b1e88df5051ae360e1078ee70b5c9181061f4ee72087b7c48f195d72afc7b8`。
- Artifacts：Manifest `artifact:c66f2969709e07f9b9565f68`、Performance `artifact:5cfd5ed20fa651fd6ac965f9`、Opportunity `artifact:2324de312e4682120cd3908a`、Fact Set `artifact:507a349642752d849349e309`、Outline `artifact:923676d6aa207d518dc215f3`、Bento `artifact:988c5445854486324892c199`；Bento Trace `trace:0a9564a24f6b598e22de3654` 指向 `category.trace.json`，SHA-256 `f140d7381600f2ac6ca398c04b9881ed785cdb7b30289e1945ecb425aa43131b`。
- Viewer / Trace：真实 Artifact Card 打开 `R13 Live Proposal Chain`；Preview 为 `1 / 2`，系统 Pointer 切换至 `2 / 2`。Trace 模式选择 Opportunity Score `88` 后，AX 与可见页面同时回读 Verified Fact、Source Files、Formula & Method Definition 与 `department_id=410` Scope。成功主页面截图 SHA-256 `8dd98f2912895f7771ced72b8409acf2dc682a5d0451a148ae9762ca7b682620`；首次 Trace 截图 `932f9619837274c807d70bff920a55419f1dd972ece006e272b789fa72d5284f`；Slide 2 截图 `578465ccb8922842267241d0376ac1b2badf883a98431bd6b2531035bc2c562e`。
- Reload / restart：系统 `Cmd+R` 后同一 Session、最终回复、Artifact Card 与持久 Viewer 恢复；Harness 主动重启到新 Bento Sandbox Origin 后再次 Reload，Host 根页 HTTP `200`、约 `2ms`，Viewer 回到 `1 / 2` 并可重新进入 Trace。Viewer 恢复截图 SHA-256 `602dea56c4972cfd937b5ecc44d4cfee825846a81f500ade29904a83fade57a9`，Trace Detail 恢复截图 SHA-256 `da2659ecb14f5433a36d6f084ed58cf776e9ba0b34d3e92d8f4e5d40c43537eb`。
- Console boundary：旧 Runtime Restart 的有限 `[web-runtime] connection lost, retry #1..#4` 与 Better Sidebar socket stop 记录保留；稳定 Reload 后这些 Warning 停止。Bento Origin Error 的独立 Attempt / fix 见 `REC-BENTO-ORIGIN-ATTEMPT-001` 与 `REC-BENTO-ORIGIN-RECOVERY-001`。最终增量 Chrome stderr 无新增 PAIMind Error / Warning。
- Result：`PASS`（仅 Category / Fact / Outline / Bento / Trace 的真实成功链、失败后恢复、Reload 与 Process Restart 主路径）；独立 OD / AB、完整 Responsive / Network Ledger 尚缺，所以四个对应 Runtime Entry 仍保持 `PENDING`。

### REC-BENTO-ORIGIN-ATTEMPT-001

- Failure：持久 Bento File Tab 在 Harness 重启后 Reload 时仍立即向旧 Sandbox Origin `http://127.0.0.1:54750` 发送 `postMessage`，而 Iframe 尚处于 Harness Origin `http://127.0.0.1:64291`；Chrome Console 两次记录 `Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ... does not match the recipient window's origin ...`。
- Root cause：主 Iframe 与缩略图在精确 Origin 的新跨源 Document 完成握手前，通过 Effect / `onLoad` 发送 Mode 与 Navigation；初始 `about:blank` / Harness-Origin Window 也会触发该路径。
- Result：`FAIL`（真实 Reload Console 缺陷保留）。

### REC-BENTO-ORIGIN-RECOVERY-001

- Fix：主 Iframe 和缩略图只在收到 Source Window 与精确 Origin 均匹配、且通过 `normalizeBentoRuntimeMessage` 的 Runtime Message 后才发送 Mode / Focus / Navigation；请求变化或 Runtime 重启时清空 Ready Source，避免复用旧 Origin。
- Targeted evidence：`packages/renderer-bento/tests/client.spec.ts` 为 `1 file / 10 tests PASS`，新增断言 Iframe `load` 前后均不预发 Message，只有经过精确 Source / Origin 的 Manifest Handshake 才向隔离 Origin 发送；Package Type Check、完整 Build 与 `git diff --check` 通过。
- Real regression：Build 后主动重启同一隔离 Harness，Bento Sandbox Origin 由 `54750` 变为 `62684`；持久 File Tab Reload 直接恢复 Preview `1 / 2`，Trace 与 Fact Detail 可重新操作。稳定后的 Chrome 增量日志为空，未再出现 target-origin mismatch；真实 Client Bundle `/plugins/@paimind/renderer-bento/client.js` 为 HTTP `200`、`41107` bytes、约 `1.8ms`、SHA-256 `5d29a2f1910bf6c60228db6e2685e78a99163856fec4b5b618c3756ec7e4ca99`，Missing Route 为 HTTP `404` / 空 Body。
- Result：`PASS`（Bento Sandbox Origin Restart / Reload Recovery）；不外推 Proposal 四个剩余 Runtime Entry 的独立 OD / AB、四档 Responsive 或 Global Network Ledger。

### REC-PROPOSAL-FOUR-INDIVIDUAL-ABSENCE-ATTEMPT-001

- Physical absence：只在隔离 Home `/private/tmp/paimind-r13-e2e.proposal-absent.Dn1FKI` 内依次把 `@paimind/category-analysis-adapter`、`@paimind/fact-layer`、`@paimind/generator-bento`、`@paimind/presentation-trace` 的单个 Profile symlink 移出 `node_modules`，每次 Cold Boot 后再恢复，未改共享 `3080`、主 `.dsh-home` 或企业 Worktree。四次真实 Extension Center 都把 Proposal & Presentation 显示为 Failed to enable，并精确指出当前缺失包；Product Experience、Agent Center 与 Extension Center 仍可用，未出现整站假失败或缺包假成功。四次缺包启动的 Runtime stdout 同时记录 `isolated failed Feature Pack groups` 与对应 Package ID。
- Isolation proof：缺 `category-analysis-adapter` 时，同一原生 Session 真实发送 `R13_CATEGORY_ABSENT_UNRELATED_SESSION_OK`，Provider 返回 `assistant/message source.kind=model` 且 `turn/end completed`，证明健康的 Native Session 与无关产品未被 Proposal 失败拖垮。Fact Layer、Generator Bento、Presentation Trace 三次页面均保持可进入且健康包状态正确。
- Preserved chain failure：全部四包恢复后第一次同 Session 重跑使用旧目录，Outline 写保护明确返回 `cannot overwrite existing ... without reading it first`，随后 Provider 因 `missing Artifact ID for r13-outline-325` 在有限重试后 `turn/end error`；页面保留 Failed Job、红色 Tool Error 和失败反馈，没有伪造成功或覆盖原文件。
- Browser evidence：Category 缺席后的无关 Session 截图 SHA-256 `0c1da2c73b3d265a73efa3155452daf962b0b96cb842757d2537d9d68a6b35c2`；`r13-fact-layer-absent-extension-center.png` SHA-256 `a8ec77b9928088610f3f30cd12e3be37c674f382a45c7391bd3bd44535678d2c`；Generator Bento 缺席截图 SHA-256 `8c092d69fe99da4576c7306c020ba5a2a97f9f8ec9f45fb4639d55cf12228a45`；Presentation Trace 缺席截图 SHA-256 `6eb96baf0336dcf849ccdd008a84b8092bc57e651457b5aa90129b278d3b9a68`；四包恢复后的 Extension Center 截图 SHA-256 `0b9f51f0ffa95e3e0db35285f90b482877541e4a322deda3b443611627ba69f1`。
- Result：`FAIL ATTEMPTS PRESERVED`（四次预期缺包失败与一次 Outline 覆盖保护失败）；恢复见下一条。

### REC-PROPOSAL-FOUR-INDIVIDUAL-ABSENCE-RECOVERY-001

- Restore / Host read-back：四个 symlink 全部恢复后 Cold Boot，Extension Center 回读 Proposal & Presentation `6 internal modules / Running`、Content `9 / Running`、Product Experience `4 / Running`、Agents `3 / Running`，零 Technical State Attention；Automation / Operations 仍按原隔离 Settings 保持用户关闭态，不伪装为加载失败。
- Real model + tool chain：同一 Native Session `session-f487bb14-3517-43be-ba5d-3434880c6d32` 通过系统 AX 填写 Composer、按 Send Button 的 AX Geometry 真实 Pointer 点击，Turn 2 使用新目录 `deliverables/r13-proposal-live-003-individual-recovery`，依次完成 call IDs `331..336` 的 Prepare、Performance、Opportunity、Fact Set、Outline 与 Bento。Session JSONL 含每一步真实 `assistant/chunk`、`assistant/message source.kind=model`、Tool Call / Result、最终 `R13_PROPOSAL_CHAIN_LIVE_003_OK` 与 `turn/end completed`；JSONL SHA-256 `2a5c75e3b9d4076678ddde5feecfd1afb2a73daf1a539f228d4b308318b734e4`，累计 Provider receipt SHA-256 `552ec50bea280c499fca41ea0b286c884e58fce56ab19cb0b731fdac94a6d92b`。
- Artifact authority：Performance SHA-256 `d32e7d32ffb4af0c9c014d1cfcb6561c3f479fb5e8fe340b5e49f70d7b2ad2a0`，Opportunity `7893696bab8258fb561f1109cbb6507269b031b7a8fa83c8e7f5313dd440bd40`，Fact Set `887325d84ea1f864829a330f6b110fd89471db19575b8c572f99a0a0749c038f`，Outline `60c2b090f1fc64a527d3ae2626157ee1e45c170caf91867daf08588fa353d43d`，Bento `f1598e5a70638ff1489f7fadf1116c28557acd17ddb1e734799200f7f4b52e4d`，Trace `c49cf18c8a2740467d7babdb61f6098b4c903bd3434856897dc40d8044105d89`。Artifact IDs 分别为 Manifest `artifact:5b2164f5dcef6202fe5a5767`、Performance `artifact:deac0075705aa11099610bc6`、Opportunity `artifact:552dd178e14aab6f6e70d155`、Fact Set `artifact:8cfe82e3d6dbe3c7f51991e3`、Outline `artifact:6cccc6026f919e11a5abf009`、Bento `artifact:8f26eaaa45d58e2ce7a049c4`，Trace ID `trace:e1e45535eca197b1ef89087b`。
- Browser interaction：Chrome 页面同时显示失败 Outline Job、恢复后的 Completed Jobs、最终模型回复、Outline / Bento 两张 Artifact Card。Pointer 打开 Bento Viewer，Preview `1 / 2`；真实切换 Trace 后选择 Slide 2 与 `$11.10M` Fact，页面回读 Verified Fact 与 Source Files。Artifact Card、Viewer、Trace Slide 2、Fact Detail 截图 SHA-256 依次为 `04904bf907d536b1e20f98b391100687aacf9aa8d5c3b46201745bf50b784c34`、`a6eaa2a234a39c19227cf40603961208d213ccc0be0027cd79024e23323db565`、`2ce081c209b59348d23c77024e0bfdc6fc4359b0d7930bf2ceda802746e30e4b`、`0a51f4d2197e01cf7aec15c7defac830d8764088f69212898aa8feb6d43cfadc`。
- Reload / restart：真实 Reload 后同一 Session、最终回复、Artifact Cards 与持久 File Tab 自动恢复到 Viewer `1 / 2`；主动停止并重启同一隔离 Harness 后，HTTP Root `200`、Marker / Card / Viewer / Settings 的系统 AX 均恢复。Reload 与 Restart 截图 SHA-256 分别为 `9fd8e2916becea03cd9f69a5fea7bed1eae85e75927a3de286b76a48a1585ba8`、`07cd1a9dec4c0dcc68f1f3a3e56ceeb9dbca6f63b222f3d6c998d38264cff2e7`；重启阶段仅保留有限 `[web-runtime] connection lost, retry #1..#5` 和两个上游 Sidebar socket stop 记录，稳态后增量 Chrome stderr 为空。
- Browser QA boundary：四档 Proposal / Bento Responsive、Pointer / System Keyboard、Focus、Back / Cancel / Submit、Loading / Empty / Error / Disabled 与确认反馈已经由 `R13-BENTO-WORKBENCH-001`、`REC-PROPOSAL-EXPERIENCE-RESPONSIVE-RECOVERY-001` 和 `REC-PROPOSAL-EXPERIENCE-INTERACTION-001` 覆盖；本回执新增的是四个入口独立缺席、恢复后核心动作、Reload / Restart 与同一 Artifact / Session 恢复，不把共享页面证据外推到 Walmart 或 Automation。
- Result：`PASS`（Category Analysis、Fact Layer、Generator Bento、Presentation Trace 独立九轴闭环）。

### REC-PROPOSAL-FOUR-NETWORK-001

- Boundary：`@paimind/category-analysis-adapter` 与 `@paimind/fact-layer` 的 Package Manifest 没有 Browser Client Entry，逐入口网络边界是 Host Tool / Provider HTTP-SSE，而不是虚构不存在的 Client Bundle；真实 Provider receipt 对六步模型决策均为 HTTP `200 / outcome=completed`，Session JSONL 把 Provider Request、Tool Call / Result、Artifact Projection 与模型最终回复连成同一条权威链。
- Client entries：根页精确声明 `/plugins/@paimind/generator-bento/client.js?rev=316a6b4bcd6f` 与 `/plugins/@paimind/presentation-trace/client.js?rev=5b47355ef8a2`；真实请求分别 HTTP `200 / 5534 bytes / 2.378ms / SHA-256 5aa767b01110e2239c454b8ccdb8cb573492cceda7b90b3a50c5a8f7ca4080e3`、HTTP `200 / 84245 bytes / 1.374ms / SHA-256 ec988655fb38f014059a81c747f8260309b33f04d97bc5ba2402c433cba1ae7e`，两个 Missing Route 都为 HTTP `404 / empty body`。
- Error / recovery ledger：四次物理缺包由 Host Loader 与 Extension Center 返回精确 Failed Package，Outline 覆盖保护由 Tool Result / Job / Turn 明确失败；恢复后 Provider HTTP-SSE、六个 Tool Result、Bento Sandbox 与 Browser Client 全部成功。真实 Reload / Runtime Restart 之后没有 unresolved request error，稳定增量 Chrome stderr 为空；预期连接重试已经单独分类且停止。
- Result：`PASS`（四个 Proposal Runtime Entry 的逐入口 request / error ledger）。

### REC-WALMART-LIVE-CHAIN-ATTEMPT-001

- Real Browser failure：独立 Chrome 152 PID `79676` 在原生 Session `session-08cb340b-c32c-475c-8b8f-e8a553f55c99` 通过系统 AX 填写 Composer 并按 Send Button 几何真实 Pointer 点击。`prepare_walmart_demo_data` 先生成 Manifest，但 Fineline 与 White-space 两个 Tool Call 分别显示 `output_path must be a Workspace-relative .fineline.data-result.json path` 与 `.white-space.data-result.json path`；Provider 随后有限重试并以 `missing Artifact ID for r13-walmart-fineline-202` / `turn/end error` 结束，没有最终成功 Marker 或伪成功 Artifact。失败页面截图 SHA-256 `74e965332e52b4a52d2174d368321c6af13237eeeeaac44543fcbc324d942826`。
- Classification：Package 的路径校验与 Failure Closure 正常；失败来自隔离 Deterministic Provider Fixture 使用了 `fineline.data-result.json` / `white-space.data-result.json`，没有满足工具要求的 `*.fineline.data-result.json` / `*.white-space.data-result.json` 后缀。Fixture 改用新 Tool Call IDs、新输出目录和合法后缀，未修改 Product Code 绕过校验。
- Result：`FAIL ATTEMPT PRESERVED`；真实恢复见 `REC-WALMART-LIVE-CHAIN-RECOVERY-001`。

### REC-WALMART-LIVE-CHAIN-RECOVERY-001

- Real model + tool chain：同一失败 Session 的 Turn 2 以新 IDs `211..214` 和目录 `deliverables/r13-walmart-live-002-recovery` 完成 Prepare → Fineline Investment → White-space → Buyer Proposal Outline，最终真实模型回复 `R13_WALMART_CHAIN_LIVE_002_OK`、`assistant/message source.kind=model`、Provider `deepseek-official`、Model `deepseek-v4-flash` 与 `turn/end completed`。Session JSONL SHA-256 `2d5d176765b3b464deca498c75338222f7cc35812447119ae057546bfbda9d31`。
- Artifact authority：Manifest `artifact:b120d26d92b6e58c6ed9e75e`、Fineline `artifact:3087d647806cf3795727866f`、White-space `artifact:33a2a45c0db21f7d6fc9caab`、Outline `artifact:e82528044b02400233ac5a30`；对应文件 SHA-256 分别为 `a93ced646e0cdefe87bec7f44af3261ff8c58e7239bc733096e22963054a9c7e`、`ea816a6fad6c4cfda3e5adf7a0c96224eb2cc2845ba1f2e20e3c52fc957defe0`、`03f811cb85dec3dd48d5b6a5d6100089a9540c52ff29473c9b7b712dcdfedc9f`、`74365a66b12c6c40b6cf146c118896fe4e6d129f14326a05845c883756f31272`。
- Browser interaction：页面同时保留前一轮红色 Tool Error、恢复轮四个真实 Tool / Context Injection、Completed Background Jobs 与最终 Marker；Pointer 展开 Outline Job / Context detail。主恢复截图 SHA-256 `ef26ac85589e9c6761edc98d2e3a76e75801a71028cf30395ee84e8fcb2882ae`，Outline Job 展开 `9efcde506793e3c3c0a77071ede9d4e45ee03c6aa26e4f170021e0f5fed20c27`，Context 明细 `a3296a6915741e5a40a4d77c39657cf409026861459fdc019377e04261ed4430`。
- Reload / navigation / Fresh Tab：真实 Reload 后 Marker 恢复，截图 SHA-256 `f3c628ba54374723a958fd92c09be6f91a11e50fab3d08230d1c591db8e71469`；物理包恢复后的全新 Session 再以新 IDs `221..224` 完整重跑，JSONL SHA-256 `01d7c8e24fead1bb549c29a6fa03a01cc1c37da9e9397b21ee2adc652dd2fc02`，恢复页面截图 `047a79c837953c1dd852bdc6fbb541427dcbe6e2f0cb4fa2597fc16777ca7d18`。独立 Chrome Fresh Tab 以真实 Address Bar 导航恢复同一 Session / Marker，截图 `6251ae794b6f93b69a7035a49e1eb545dafa0a6712197c90813c45ddea3fdd91`；Browser Back 后 Forward 恢复截图 `2a09168593cd76fef8358719d3e380c32c7fcbdc19397d6e8a4c40c92ded5ad9`。
- Browser QA boundary：该 Package 没有 Browser Client Entry，用户入口是 Harness 原生 Session / Tool / Job / Artifact Surface；本场景实际覆盖 Pointer、Composer Focus、Loading、可读 Error、Completed 反馈、Reload、Fresh Tab 与 Back / Forward。四档 Proposal Shared Surface、System Keyboard、Focus、Disabled、Cancel / Submit 的可见几何与交互使用同一真实 Surface，证据见 `REC-PROPOSAL-EXPERIENCE-RESPONSIVE-RECOVERY-001` 与 `REC-PROPOSAL-EXPERIENCE-INTERACTION-001`，不把 Walmart 的 Tool / Artifact 结果外推到其他 Package。
- Supporting gate：`packages/walmart-proposal-adapter/tests/provider.spec.ts` 与 `python-parity.spec.ts` 为 `2 files / 7 tests PASS`，Package Type Check 通过。
- Result：`PASS`（Walmart 主业务链、失败后恢复、真实 Artifact 与 Browser 恢复）。

### REC-WALMART-ABSENCE-RECOVERY-001

- Physical absence / exact failure：只在隔离 Home `/private/tmp/paimind-r13-e2e.proposal-absent.Dn1FKI` 把 `@paimind/walmart-proposal-adapter` Profile symlink 移出 `node_modules`。Cold Boot 后真实 Extension Center 将 Proposal & Presentation 显示为 `0 / 6 internal modules / Failed to start / 1 required pack(s)`，并完整显示 `Cannot find package '@paimind/walmart-proposal-adapter'`；Product Experience、Agent Center、Content 与 Extension Center 保持运行。首次与第二次 Process Restart 后截图 SHA-256 分别为 `7966ec20faa328440284662d2d7c50d4e485330f315477dc70bb6f0e59469c97`、`753df015bee044962f30c1240a2da87dd56a1afb093062b3590e85a6b7e9360e`，Runtime stdout 两次记录同一 `isolated failed Feature Pack groups`，没有缺包假成功。
- Unrelated native Session：缺包期间通过真实 New Session、系统 AX Composer 与 Pointer Send 执行 `R13_UNRELATED_NATIVE_SESSION_OK`；Session `session-17c4996a-fcb6-48e0-98a0-a3745908f93d` 含真实模型 `assistant/message` 与 `turn/end completed`，JSONL SHA-256 `4ea82cea5b24a70fd11a77681dc002cb63edec6dbf3c2a8c2c63362502edd2f4`，Browser 截图 `ed0931e9ae7abe3a32ab2096d9b8c61413b8f74127d2e7a1849e01c626c77e16`。
- Reload / restart：缺包页面 Reload 后 Session Marker 恢复，截图 `59452014dddb3962b8487a4ffe8e7f74b88c49e4017c8253e008a0d988140d5c`；再次停止并 Cold Boot 同一隔离 Home 后，Root HTTP `200 / 2.621ms`，同一 Session 仍可见，截图 `56476d2a6ba5f2e6828e217a8200e422e2f23cb6c76f30e95b3f246dd11db847`，Extension Center 仍精确失败而非遗忘缺包。
- Restore / re-execute：恢复原 symlink 后 Cold Boot，Extension Center 显示 Proposal & Presentation `6 internal modules / Running`、无 Failed State，截图 SHA-256 `6af7673de66e4f582a76d4da237af99eb2683e46f2eb94e06fa32a1edee39246`；随后新建独立 Session，以新目录 `deliverables/r13-walmart-live-003-restored` 重新执行四步 Tool Chain 并产生全新 Artifact IDs，最终 `R13_WALMART_CHAIN_LIVE_002_OK`。恢复 Manifest / Fineline / White-space / Outline SHA-256 分别为 `d4b4f6407849ee49e84d3abfe9300a879a3e8663664a481289cf5c32b3dc04d8`、`c62b164a5356d8dff70c2f9ed8646277f190cbee394f0e8338e7b65c0e5e37a2`、`654e6c59e13b7ada8e07ab439616487a789fa7c1b0427dac688b2092be76ce7c`、`88437a86f3e5d04e89c73d1c84249fead97c8c26a0e56414795697f0218b452e`。
- Console boundary：两轮主动 Runtime Restart 仅产生有限 `[web-runtime] connection lost` 与上游 Better Sidebar socket stop；每次恢复后重试停止，稳定增量 Chrome stderr 为空。全新标签、恢复 Tool Chain 和 Back / Forward 均无新增 Product Error / Warning。
- Result：`PASS`（IB / OD / FC / RC / RF / RS / AB 与健康产品隔离）。

### REC-WALMART-NETWORK-001

- Host-only boundary：Package Manifest 只声明 Node Entry / Invariant，没有 Browser Client Entry；不存在的 `/plugins/@paimind/walmart-proposal-adapter/client.js` 按契约返回 HTTP `404 / empty body / 0.724ms`，不虚构 Client Bundle。恢复后的 Root 为 HTTP `200 / 33149 bytes / 3.660ms`、SHA-256 `11888803d8410d28b0d95023c08a38e928d8caa8587f8566b97ada2680d416a9`。
- Provider / Tool request chain：真实 Provider receipt 记录恢复链 HTTP/SSE 决策 `status=200 / outcome=completed`；Session JSONL 逐步绑定四个 Model Tool Calls、Tool Results、Host Artifact Projection 与最终模型回复。累计 Provider receipt SHA-256 `9713e25b1e3e2773293deebf8dddacc01306d40dbe164a71f5e6f56232d43222`。
- Error / recovery：非法输出后缀由 Tool Error / `turn/end error` 明确关闭；物理缺包由 Loader / Extension Center 精确 Failed；恢复后四步链、Fresh Tab、Reload、Process Restart 与 Back / Forward 成功，稳定 Chrome stderr 为空。
- Result：`PASS`（Walmart Host-only request / error ledger）。

### REC-AUTOMATION-LIVE-FAILURE-RECOVERY-001

- Real failure：在隔离 Home `/private/tmp/paimind-r13-e2e.proposal-absent.Dn1FKI`、Runtime `127.0.0.1:64291` 中，通过真实 Harness Settings 打开 Platform Scheduler，以系统键盘 Restore 已归档任务并执行 `Run now`。停止隔离 Provider 后，Run `run:0886487e-ca01-42f1-a767-8b535fc2deea` 明确进入 `failed`，Message 为 `Harness Session finished without an assistant result`，对应 Session 为 `paimind-scheduled-e844c7a9577542e8a4d6c689`；页面、任务历史和通知中心均显示失败，没有把用户 Prompt 中的文字伪装成 Assistant Success。失败截图 `/private/tmp/r13-scheduler-live-failure.png` SHA-256 `e22b20a4ac18fc3860d5af7c5561d9a98043778a766b8625d8b8cf1a3fc67ea1`。
- Provider recovery：恢复 Loopback Deterministic Provider 后，用同一任务再次真实执行。Run `run:d15d3ed4-7845-473c-9a4c-e177a580727a` 为 `succeeded`，Message=`R13_SCHEDULER_LIVE_002_OK`，Session `paimind-scheduled-5fe2fec41cef2bc2edbee082` 的 JSONL SHA-256 `6c1cd6630d8d937c6c47f2427b3f6a1632c20af5ba04a187b8d7bed64dd81ff3`；其中有真实 `assistant/chunk`、两条 `assistant/message source.kind=model`、Provider=`deepseek-official`、Model=`deepseek-v4-flash` 和两次 `turn/end completed`。恢复与 Session 页面截图 SHA-256 分别为 `9391890d115a051a96837ca3c5f281540678fab4688d67c1ffaa6e44e86765a7`、`71dde515b29c5a02aeae4390158b01e30fbb4044e9d3d35289d0ba64687ad666`。
- Notification / canonical delete：Notification Center 同时显示上述成功和失败 Producer；系统键盘执行 Mark all read 后，Host Storage 中全部 `readAt` 得到更新，Unread 过滤器显示空态 `No notifications here yet`。截图 SHA-256 分别为 `039dc2e247930a098a30a347529bea81aef8c6e804bc1bb87b7eaa920d141534`、`cdce83af1bc77cd40aa79986708e3b2747ea1dbf0e70a2cd599f14e0cfc76c94`、`0b394fbc5e371e9bdca3d6b24f432921f8c4cedab930d1fe64909f76c4acf066`。随后用系统键盘 Archive，Definition 状态为 `archived`、`archivedAt=2026-08-27T23:12:07.318Z`、Version=`f8bded47-490c-47db-a8a4-15bff764a407`，截图 SHA-256 `c569e5b80157f64a2b70f11062ec9ff9d8c3af05aab87e4e229a67953985283d`。
- Reload / process restart：主动停止并重启同一隔离 Runtime 后，Root 仍为 HTTP `200`，Fresh Chrome 恢复完整 Product Shell；Notification Read State 与 Scheduler Archived State 均持久化，截图 SHA-256 分别为 `d6c8a907529398c74be5946815fc096aa4c49b917340d3e4f78e43b9bb7809fa`、`f002701d8f416ed13790c00d3573b22b30b4960201092b39a0021f4fdd53e745`、`0aa00704ec0c22fb86142fca63729401916aeccd3f00eb6f735b71b8e10979ec`。重启窗口内有限 `connection lost` 被分类为预期 Transport Transition，稳态后增量日志为空。
- Result：`PASS`（Notifications、Platform Scheduler、Harness Adapter 的真实失败关闭、模型恢复、通知、Session、归档、刷新与进程重启持久化）。

### REC-AUTOMATION-RESPONSIVE-ATTEMPT-001

- Real 420px failure：独立 Chrome Profile 使用物理窗口宽度与 Chrome `125%` Zoom 得到 `innerWidth=clientWidth=scrollWidth=420`、`devicePixelRatio=1.25`、`visualViewport.width=420`、`scale=1`。Notification Center 可用，但 Harness Settings 的固定侧栏把 Scheduler 内容压缩为约 `128px`，Restore 控件右边界达到 `x=446 > 420`，不可完整阅读和操作；截图 `/private/tmp/r13-automation-420-scheduler.png` SHA-256 `5aaaf8cf100062283fd55973347ff328a8a56f33ca0f4a9d297a6aef49477366`。
- Classification：这是 Product Responsive Layout 缺陷，不以 `scrollWidth=420` 或 Console 无错误冒充通过。修复只作用于包含 `[data-paimind-scheduler-settings]` 的窄屏 Harness Settings Dialog，将导航改为可见的顶部横向列表并让内容区域占满可用宽度。
- Result：`FAIL ATTEMPT PRESERVED`；修复回归见下一条。

### REC-AUTOMATION-RESPONSIVE-RECOVERY-001

- 420 recovery：修复后同一真实窗口回读 `innerWidth=clientWidth=scrollWidth=420`，Scheduler Panel `372px`、内容 `324px`，Restore 右边界 `258`、Task 右边界 `333`，均在视口内；Archived 与 Succeeded 历史仍可见，Console / Network 无未恢复错误。截图 `/private/tmp/r13-automation-420-scheduler-recovery.png` SHA-256 `3e0bec8afdc3e6a12be4c3dbff5bff31bbe1dea01dc2a1108b61bd0442ab88fe`。同档 Notification Center 的 Mark all read / Close 右边界均为 `400`，成功／失败通知可读，截图 SHA-256 `52e7747046adc5e19a30e77e39d6da83789519dd66a18ad7d6159607294a161c`。
- Four real sizes：760、1100、1440 三档分别回读 `innerWidth=clientWidth=scrollWidth=760/1100/1440`、`devicePixelRatio=1`、`visualViewport.scale=1`；卡片、任务、Restore、通知操作和 Focus Geometry 均落在各自视口内，Browser Logs 为空。截图 SHA-256 依次为 `cd86f4db8c765491f5ef3c27fbfeddcd532724bec6a2ec45d6bd68167d987954`、`73b7fddb76d1f673f66584eae29be7ccefd0248e340de74264962e4abd3021ff`、`20c5ff24bfb85887566bfd856a0aef38f55950632416cd78a828a78d0225bda5`。
- System keyboard / focus：Restore、Run now、Archive、Mark all read、Unread Filter 与 Notification Open 均用 macOS System Keyboard 激活，焦点与可见状态回读一致；Pointer 仍作为独立对照。Reload 与 Runtime Restart 后同一页面、Archived Definition、Read State 和 Empty State 可恢复。
- Supporting gates：`packages/scheduler/tests/client.spec.tsx` 为 `1 file / 9 tests PASS`；Bundled Node 直接执行 Package `tsc -b` 与完整 `scripts/build.mjs` 均通过。一次 Package Script 因系统 Homebrew Node 缺少 `libsimdjson.29.dylib` 失败，被保留为 Executor-path Attempt，不归类为 Product Type Error。
- Result：`PASS`（真实 420 FAIL→Recovery、420/760/1100/1440、Pointer / System Keyboard、Focus、Reload / Restart 与稳态 Console / Network）。

### REC-AUTOMATION-ABSENCE-RECOVERY-001

- Individual physical absence：只在隔离 Profile `node_modules` 内依次移出 `@paimind/notifications`、`@paimind/platform-scheduler`、`@paimind/scheduler-adapter-harness` symlink，每次 Cold Boot 后恢复；未修改共享 `3080`、主 `.dsh-home` 或企业 Worktree。Extension Center 对每次缺席都把 Automation 显示为 `Failed to start`，并精确显示当前 `Cannot find package '<package-id>'`，没有缺包假成功；截图 SHA-256 分别为 `9f33189729c273b76c3c3cbec9e15c671bcee74ed419d970a72ed9ec68263362`、`d926f9164a1c0ae63ed12b0fded7d32531425a783bb4205873fb0501a345d423`、`f63fc063c43dc69f24367c75bb0f82b86c6e52cbb91a88379c7f4a734f696398`。
- Isolation：Notifications 缺席时，原生 Session 与无关 Product Shell 仍可读、Composer 可用，截图 SHA-256 `a62a38cf83d1fc75fd5b1189134b8c3039eecfc640045e26f02740720f0f2a74`；Host stdout 每次记录精确 `isolated failed Feature Pack groups`，未拖垮 Extension Center。
- Restore：三项 symlink 全部恢复后 Cold Boot，Extension Center 回读 Automation `6 internal modules / Running`，截图 SHA-256 `63e1f37da6f4328a08643bf570870dbce7f03c4321e098256d8e9f7bc775a459`；Archived Schedule、Notification Read State 与成功 Session 仍在。
- Result：`PASS`（三项独立物理缺席、精确失败投影、健康产品隔离、重新安装与 Cold Boot 恢复）。

### REC-AUTOMATION-NETWORK-001

- Notifications Client：`/plugins/@paimind/notifications/client.js?rev=cb3259b39630` 为 HTTP `200 / 583015 bytes / 3.184ms / SHA-256 8c2b3026632cc4c92e663a060ced4aeaeb00ce0c60db329cdd8abe3cf255f7fe`；真实 Producer Success / Failure、Mark-all-read、Empty、Reload / Restart 与 Physical Absence 均通过，四档 Browser 稳态无未恢复 Error。
- Platform Scheduler Client：修复后的 Bundle `/plugins/@paimind/platform-scheduler/client.js?rev=f5d2bc57ae29` 在 420/760/1100/1440 四档 Browser 均为 HTTP `200`；真实 Restore / Run / Archive Mutations、Provider Failure / Recovery、Reload / Restart 与 Physical Absence 形成同一条 request / state ledger。
- Harness Adapter host-only boundary：Package 没有 Browser Client Entry；不存在的 `/plugins/@paimind/scheduler-adapter-harness/client.js` 按契约返回 HTTP `404 / empty body`。真实边界是 Scheduler Run → Harness Native Session → Provider HTTP/SSE → Model JSONL；Success / Failure、物理缺席、恢复和稳态 Browser Logs 均有权威回读。
- Result：`PASS`（Automation 三个 Runtime Entry 的逐入口 request / error ledger）。

### REC-AUTOMATION-FINAL-FOUR-FAILURE-RECOVERY-001

- HTTP Adapter：真实 Harness Settings → Platform Scheduler 创建并打开 `R13 HTTP Adapter E2E`，Schedule `schedule:2f35864b-1cf2-4c5f-ae9e-3431d5fa0702`。系统 Pointer 聚焦 `Run now` 后用 macOS Return 激活；`run:560347a7-cb97-41ea-8b36-1a4a13f786a6` 向隔离 HTTPS Fixture 连续发送三次带 Contract Version、Timestamp、Request ID、HMAC Signature、Idempotency Key 与 Callback URL 的 POST，Fixture 返回 `500`，Browser 任务历史明确显示 Failed：`Dispatch failed after 3 attempt(s): HTTP action provider returned 500; expected 202`，截图 SHA-256 `00bfe59a6c1db44efc4116290926b97632f33a17c5267983bc509310fa59e4f8`。切回 Accept 后，`run:ac59273f-b152-471f-8b92-47db2470e28c` 被真实 HTTPS 端点接受，再由 Platform API 签名 Callback 变为 `Succeeded / R13_HTTP_CALLBACK_OK`；重启后同一任务仍同时显示失败与成功历史，截图 SHA-256 `07ff38e7b417868cce11132ada6a920f657c30680513e47224842eade2963135`。
- Platform API：真实 Browser Origin 发出签名请求。通知成功为 `202`，同 Request ID 重放为 `409 replay_rejected`，无效签名为 `401 invalid_signature`；Action 首次注册为 `201`，重复注册为 `409 action_already_exists`。首次非法 Run Action Origin 被错误归为 `500`，保留为 Failure Attempt；修复后同一 Browser 路径稳定返回 `400 invalid_run_action / run action URL origin is not allowlisted`，合法 Callback 返回 `200` 并保持 HTTP Run 为 Succeeded。新通知在真实 Notification Center 可见为 `R13 Platform API notification 002 / R13PLATFORMAPINOTIFICATION002OK`，系统 Pointer 聚焦 `Open Notification Center` 后用 macOS Return 激活，截图 SHA-256 `8f684811cbd29f938fbe87534b2d511b30c4be8807e57f375db4082d325343a1`。
- Feishu Bot：未配置 Credential 的既有 Scheduled Run 明确失败；配置仅限隔离 Home 后，系统键盘激活 `Run now`，`run:c43e6070-38b6-4aa3-b55d-17c92b610792` 向 `https://open.feishu.cn:54527/open-apis/bot/v2/hook/r13-test-token` 发送真实 JSON，包含 `R13_FEISHU`、`R13_FEISHU_DELIVERY_OK`、Run ID 与 Scheduled Time，Browser 显示 Succeeded。Fixture 切换 Reject 后，`run:b1f052b8-2282-4080-8a3d-d367ed2df09d` 三次真实 POST 均被拒绝并明确 Failed；恢复 Accept 后 `run:3e785d8c-f203-4239-8667-37937fb3dd45` 再次 Succeeded。成功／拒绝截图 SHA-256 分别为 `658c006d549988f70e653a0f5bfc89dccef7f5aac9bf585a78455ff413daedf0`、`4c176f1c7a6c75931f6d50f0521f2ef660b20d0e056e13032dde05541d7ddf4f`，重启后完整四段历史截图为 `7de309f295786549dd6646869a70c0ded13049ae81b888f474ec47721467ad2f`。
- Developer Resources：真实 Settings 页面回读 `62 Total / 62 Active / 0 Loading / 0 Failed / 0 Disabled / 0 Unobserved`，依次点击 Live Diagnostics、Surface Catalog、Integration Reference 与 Refresh，三标签均得到 `aria-selected=true`；不存在伪造的网络操作或独立数据存储，权威状态来自 Host Plugin Inventory。
- Result：`PASS`（四项真实主动作、明确失败关闭、恢复、确认反馈与重启持久化）。

### REC-AUTOMATION-FINAL-FOUR-RESPONSIVE-KEYBOARD-001

- Scheduler shared surface：HTTP / Feishu 两项真实任务在 1440、1100、760 与精确 420 CSS px 下回读 `innerWidth=clientWidth=scrollWidth` 分别为对应宽度。420 使用物理 Outer Width `525` 加 Chrome `125%` Zoom 得到 `innerWidth=420`、`devicePixelRatio=1.25`、`visualViewport.width=420`、`scale=1`；任务、失败／成功历史、Run now、Back、Close 均在视口内，四档 Client Bundle 均为 HTTP `200`、Browser Logs 为空。截图 SHA-256 分别为 `69b5d30ddeecd3a26e4701f7a7d9e4138045185731a00a1360e09a41fdbb5f8f`、`43294c6a86aa4584df9ef55c0489b822259425d47a8b4dec0a4706c2eb3d34b7`、`45f62a9f4e6629e075af6cc2e8aded03922b3ed2a792afaf4400a7e411f12a49`、`0105910fdf83ff1292cc88fb9a23744cc782b606e27a53274bb36a7a6d472d39`。Run now 用真实系统 Pointer + Return 激活；Platform API 的用户可见通知也使用系统键盘打开，未用 DOM click 替代 Keyboard Activation。
- Developer Resources 420 failure / recovery：初始 420 页被固定 Settings Navigation 压成约 `128px`，文本逐字符换行，三个内部 Tab 被裁剪，截图 SHA-256 `c820ed17461f4d6e57aae8af890b49103b464f74867e4074d1ac3b46e6401aa2`。第一轮把 Settings Shell 改为纵向后第三个 Tab 仍部分裁剪，截图 `c4f7cc8fdf56dc97adbcb1b9691d0f7be6a5b563fbfd67589d1710e81e2ffccd`；最终让内部 Tablist Wrap，三个 Tab 的 X 范围为 `60–176 / 182–297 / 60–206`，均位于 420 视口且无横向 Overflow，截图 `0e301591c0405a3ade0023b83216d618549372f0d650440788a09d5050141e8c`。真实系统 Pointer 聚焦 Refresh，Shift+Tab 移到 Integration Reference，macOS Return 激活后 `aria-selected=true`、焦点仍在 Tab，截图 `06be0416ea5cf4cab02138634fcd5cfcabf9ec0302621ecfae55a11525f90a64`。
- Developer four sizes：1440 / 1100 / 760 / 420 的真实 `innerWidth/clientWidth/scrollWidth` 分别一致，三标签、Refresh、Summary 与焦点几何均在视口内；前三档截图 SHA-256 为 `a1a8f6b18ceac28709b26a92a39d375a13d6790cafce21fd30450c807373cdb0`、`5247d4c9af3cf5003fe8a3c158c657d96e9c38ccb391173806a2ef59f6abdc16`、`02c786a767194af1a55a0662d09560e81ddc5b8f7986bc0d7d511b9fd0779a4d`。Reload 与 Runtime Restart 后 62 / 62 Active、三标签和 Refresh 恢复；四档稳态 Console / Network 无未恢复 Error。
- Result：`PASS`（保留 420 两次 FAIL Attempt，完成四档 Responsive、Pointer / System Keyboard、Focus、Reload / Back / Forward shared surface 与 Process Restart Recovery）。

### REC-AUTOMATION-FINAL-FOUR-ABSENCE-RECOVERY-001

- Individual physical absence：只在隔离 Profile `node_modules` 内依次移出 `@paimind/scheduler-adapter-http`、`@paimind/platform-api`、`@paimind/scheduler-adapter-feishu-bot`、`@paimind/developer-resources` symlink，每次正常停止、Cold Boot、真实 Browser 回读后恢复；没有修改共享 `3080`、主 `.dsh-home` 或企业 Worktree。前三项缺席时 Extension Center 将 Automation 精确显示为 Failed to start 并指出当前 Package ID；Developer Resources 缺席时 Work Operations 为 `0 / 2 / Failed to start`，Automation 因依赖级联为 Partially running，而 Product Experience、Agents、Content、Proposal 与 Extension Center 继续可用。四张缺席截图 SHA-256 为 `8d590e460eb1d7390c562be1dafa8da790a45fb02df62c8322670691444f702d`、`0c3cc4dd899da3576c198332ed627c2215522027a7006efa91dfe497c7d2d2ea`、`244a0588e8f51c12b290c4af19dd19499663883c67cdcac3b1be1aaa0b24f69a`、`2326dd24b3c3526336690d950e3e5aa1be86e2a2e18c51cef9724cbc709b8f20`。
- Healthy-product isolation：缺包期间原生 Session 真实发送 `R13_UNRELATED_NATIVE_SESSION_OK`；Browser 显示真实模型最终回复，Loopback Provider receipt 为 HTTP `200 / outcome=completed`，并有 `assistant/message source.kind=model` 与 `turn/end completed`。HTTP 缺席时 Session 截图 SHA-256 `255e01759265f3d14caac729372009fcfe2cd0351807fe37aafcd8c2690e40d8`；Feishu / Developer 缺席时同一隔离 Provider 分别记录新的 completed Attempts，页面继续可用。Platform API 缺席时 Browser 发往其 HTTP Route 的请求为 `405`，没有假成功。
- Restore / restart：四个 symlink 全部恢复后 Cold Boot，`settings.yaml` 仍为六包和 Runtime Orbs 全部 `true`；Extension Center 回读六包全为 Running、`20 Product capabilities / 20 Active / 0 Need technical attention`，截图 SHA-256 `c64632218ca61d5d03c979b2fc44af19d07edc96e32b04d06236a6e481542275`。重启后 HTTP / Feishu 任务历史、Platform API 注册与通知、Developer Resources `62 / 62 Active` 均恢复。
- Result：`PASS`（四项独立物理缺席、精确 Failed Projection、依赖级联、无关产品隔离、重新安装与 Cold Boot 恢复）。

### REC-AUTOMATION-FINAL-FOUR-NETWORK-001

- HTTP Adapter host-only boundary：不存在的 Client Route 按契约为 `404 / empty body`；真实边界是 Scheduler → 签名 HTTPS POST → `500×3` Failure → `202` Accept → Platform API signed Callback → Succeeded。Fixture Receipt JSONL SHA-256 `3cb0b1997b976535d42e592b39b08838ec15b5e72eb9b6d446a102fb749056b3`，每次请求包含 Contract / Timestamp / Request ID / Signature / Idempotency / Callback 字段。
- Platform API host-only boundary：不存在的 Client Route 为 `404 / empty body`；Browser Origin 真实请求序列为 Notification `202 / replay 409 / invalid signature 401`、Action Registration `201 / duplicate 409`、Invalid Run Action `400` 与 Valid Callback `200`。物理缺席时同 Routes 返回 `405`，恢复重启后再次注册得到相同边界。
- Feishu Adapter host-only boundary：不存在的 Client Route 为 `404 / empty body`；真实 HTTPS Webhook Ledger 为 Success `1×POST`、Reject `3×POST`、Recovery `1×POST`，Host Scheduler Storage 与 Browser Task History 分别回读 Succeeded / Failed / Succeeded；无 Credential 失败在发网前明确关闭。
- Developer Resources client boundary：Fresh Browser 声明并请求 `/plugins/@paimind/developer-resources/client.js?rev=e6c16f596902`，HTTP `200 / 34729 bytes / SHA-256 08931c9095d1b9c494cfa8199aedfcd73fc9fe7f8221fd28097b5eb3c57a0d92`；四档页面动作、Refresh、物理缺席、恢复与 Process Restart 后无未恢复 Console / Network Error。
- Result：`PASS`（四项逐入口 request / error ledger）。

### REC-GLOBAL-NETWORK-CLOSURE-001

- Fresh Browser probe：恢复全部物理包并稳定 Cold Boot 后，在同一隔离 Chrome Profile 新建 Fresh Tab，打开随机 Query URL；`readyState=complete`、`innerWidth=clientWidth=scrollWidth=1440`、Root HTTP `200 / 34392 bytes / SHA-256 e625f2370c5217fb32818f2c617c72c8c8949789d9e8b0989b3bbfed1023e3b3`。30-entry Ledger JSON SHA-256 `1aee6f0418703d0b2167d13a3d49c95e0553f759d325a1960f7b054bd4a7effb`。
- Declared Client Entries：21 / 21 均从 Root Boot Payload 提取精确 Revision URL，再由同一 Browser Profile 请求并得到 HTTP `200`、非空 Body 与 SHA-256；Reload Network 事件也逐项记录相同 Client URL。Host-only Entries：9 / 9 均无 Manifest Client Entry，精确不存在的 `/plugins/<package>/client.js` 返回 `404 / empty body`，没有把缺失 Client 当失败，也没有虚构 Bundle。
- Error boundary：首次复用经历 Physical Absence 的旧 Tab 时保留一条 `[paimind-extension-center] Client Feature Pack recovery remained incomplete [paimind:pack:operations]`，记为旧页恢复过渡 Attempt；同一稳定 Runtime 的 Fresh Tab 重跑后 `consoleEvents=[]`，Extension Center 为六包 Running / 20 Active / 0 Attention。每个 Runtime Entry 的 Business Request、Failure Closure、Physical Absence、Restore、Reload / Restart 与 Browser Interaction 仍分别由本索引既有九轴 Receipt 约束；本条只补齐精确 Boot / Resource / Host-only Network 分类，不替代那些业务证据。
- Result：`PASS (30 / 30)`（21 Client Entry + 9 Host-only Entry 的逐入口 Network Ledger 全部闭环）。

### REC-FINAL-GATES-HANDOFF-001

- Targeted / full tests：关键修复面 `13 files / 131 tests PASS`；Walmart Python Parity 首轮因收窄 PATH 导致 `spawn uv ENOENT`，补回 `/Users/hansen/.cargo/bin` 后定向 `1 file / 2 tests PASS`，Full Tests 为 `91 files / 437 tests PASS`。仅保留上游 `dsh-client-ui-primitives/index.js.map` 缺失的非阻塞 Vite warning。
- Build / contract gates：Full Type Check、Production Build、API Snapshot（38 package contracts）、Package Compliance（38 packages）、Pack Audit（38 tarball dry runs）、Bundle Budget（22 client packages）、Publint、NodeNext Consumer（116 public JS / type exports）、Examples、Framework（六 Product Packs + nested Runtime Orb）与 Documentation（99 Markdown / zero missing links）全部 PASS。
- Real Harness Composition：Harness `0.1.1-rc.2`、Better Sidebar `0.16.1`、Office Viewer `0.1.2`；完整 install / boot / remove / restore、Visual Experience 独立安装、Extension Center 缺席，以及 Task Monitor、Agent Market、Agent Builder、Skill Market、Notification Center、Scheduler、User Settings、Developer Resources 各自物理缺席组合全部通过，结束时 upstream worktree delta 为 0。最终 `pnpm run check:release` exit `0`。
- Cleanup：正常停止本任务专用 Runtime `64291`、Deterministic Providers `54338 / 54339 / 54417`、HTTPS Fixture `54527`、Chrome Profiles 对应 `64013` 和 passive process；复核没有 `/private/tmp/paimind-r13*` 孤儿进程或上述 Loopback listener。四个最终缺席包 symlink 均已恢复，Quarantine 为空；共享 `3080` listener 仍为原进程，未被本任务触碰。
- Handoff：最终 Product `204` paths、Enterprise `333` paths、Overlap `140 = 91 identical + 49 divergent + 0 type conflict`；两个 Manifest 与 49 行逐路径语义表见 `R13-integration-ready-handoff.md`。没有 commit、merge、rebase、cherry-pick、push、publish 或 deploy。
- Result：`PASS`（完整 Final Gates、资源清理与 Integration-ready Handoff）。

## Global Network Ledger

每个 Runtime Entry 必须同时具备精确 Boot / Client Resource、真实 Browser 业务动作、Host / Provider 权威回读、错误关闭与稳态 Console / Network 结论；包级 `64 / 64` 静态资源结果不能代替逐入口账本。

| Runtime Entry | Per-entry request / error evidence | Result |
| --- | --- | --- |
| `@paimind/branding` | Client `200 / 18827 bytes / 7b8883…` + Product Shell / physical absence / restore / keyboard / four-size / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/visual-experience` | Client `200 / 138714 bytes / 9f904c…` + native experience switch / failure recovery / restart / responsive / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/runtime-orbs` | Client `200 / 51493 bytes / 36e3a6…` + Provider slow Turn / capability off-on / invariant failure recovery / restart / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/user-settings` | Client `200 / 574423 bytes / 73b6fb…` + Settings save / model context injection / rollback / reload / restart / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/skill-market` | Client `200 / 650361 bytes / 01d29d…` + invalid upload cleanup / valid install / model Skill injection / absence / restart / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/agent-builder` | Host-only Client Route `404 / empty` + Agent save / Test Chat / Provider JSONL / physical absence / restore / four-size / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/agent-market` | Client `200 / 834082 bytes / d11fb5…` + Provider success / transport failure / same-session recovery / absence / restart / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/workspace-project` | 精确 Boot Entry + Client Bundle `200` + New Session / Selector / Model Reply + JSONL / Provider + absence / rollback + Fresh Tab zero error；`REC-CONTENT-NETWORK-LEDGER-001` | PASS |
| `@paimind/better-sidebar-adapter` | Client `200 / 19868 bytes / d7603f…` + Office Viewer / unsupported failure / unmount cleanup / reload / restart / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/artifact-runtime` | Host-only Client Route `404 / empty` + real Tool / Job / Artifact Projection / failure / absence / restore / restart；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/generator-web` | 精确 Boot Entry + Client Bundle `200` + Provider Tool Call / Tool Result + JSONL + Viewer / restart + absence / rollback + Fresh Tab zero error；`REC-CONTENT-NETWORK-LEDGER-001` | PASS |
| `@paimind/generator-office` | Client `200 / 5585 bytes / 18b183…` + real PPTX / PDF / XLSX Tool requests / structure errors / recovery / absence / restart；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/renderer-bento` | Client `200 / 41107 bytes / 5d29a2…` + sandbox origin failure / handshake recovery / Viewer / absence / restart；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/renderer-pdf` | Client `200 / 2134120 bytes / 57e7cb…` + HTTP 503 readable error / real PDF / keyboard / absence / reload / restart；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/artifacts` | 精确 Boot Entry + Client Bundle `200` + available Projection / Viewer Route + Host Artifact + absence / rollback + Fresh Tab zero error；`REC-CONTENT-NETWORK-LEDGER-001` | PASS |
| `@paimind/conversation-artifact-renderer` | 精确 Boot Entry + Client Bundle `200` + Native Turn Card / File Tab + Host Artifact + absence / rollback + Fresh Tab zero error；`REC-CONTENT-NETWORK-LEDGER-001` | PASS |
| `@paimind/category-analysis-adapter` | Host-only Package；Provider HTTP/SSE `200` + real Model Tool Calls + process.execPath Runtime Commands + individual absence / exact Loader failure + restored chain + Reload / Restart；`REC-PROPOSAL-FOUR-NETWORK-001` | PASS |
| `@paimind/fact-layer` | Host-only Package；Provider HTTP/SSE `200` + Fact Artifact / Trace + individual absence / exact Loader failure + restored chain + Reload / Restart；`REC-PROPOSAL-FOUR-NETWORK-001` | PASS |
| `@paimind/generator-bento` | exact Client Bundle `200` / Missing `404` + Outline → Bento Tool / Artifact + individual absence + restored Viewer + Reload / Restart zero unresolved error；`REC-PROPOSAL-FOUR-NETWORK-001` | PASS |
| `@paimind/presentation-trace` | exact Client Bundle `200` / Missing `404` + Trace Sidecar / Viewer interaction + individual absence + restored Fact Detail + Reload / Restart zero unresolved error；`REC-PROPOSAL-FOUR-NETWORK-001` | PASS |
| `@paimind/proposal-experience` | 精确 Boot Entry + Client Bundle `200` / Missing Route `404` + Customer / Department Card + Pointer / System Keyboard + Back / Cancel / Submit + JSONL / Provider + Off / Absence / Recovery + four real window sizes + Reload / navigation recovery；`REC-PROPOSAL-EXPERIENCE-NETWORK-001` | PASS |
| `@paimind/walmart-proposal-adapter` | Host-only Package；Provider HTTP/SSE `200` + 四步 Model Tool / Artifact 链 + 非法后缀 Failure Closure + individual absence / exact Loader failure + restored re-execution + Fresh / Reload / Restart / navigation zero unresolved error；`REC-WALMART-NETWORK-001` | PASS |
| `@paimind/notifications` | 精确 Client Bundle `200` + Success / Failure Producer + mark-all-read / empty + physical absence / restore + Reload / Restart + four-size zero unresolved error；`REC-AUTOMATION-NETWORK-001` | PASS |
| `@paimind/platform-scheduler` | 精确 Client Bundle `200` + Restore / Run / Archive mutation + Provider failure / recovery + physical absence / restore + four-size zero unresolved error；`REC-AUTOMATION-NETWORK-001` | PASS |
| `@paimind/scheduler-adapter-harness` | Host-only boundary + missing Client route `404` + Scheduler → Native Session → Provider HTTP/SSE → model JSONL + failure / recovery / absence / restart；`REC-AUTOMATION-NETWORK-001` | PASS |
| `@paimind/scheduler-adapter-http` | Host-only Route `404 / empty` + signed HTTPS `500×3 → 202 → signed callback 200` + Browser history / absence / restart；`REC-AUTOMATION-FINAL-FOUR-NETWORK-001` | PASS |
| `@paimind/platform-api` | Host-only Route `404 / empty` + Browser signed `202/409/401/201/409/400/200` chain + user-visible notification / absence / restart；`REC-AUTOMATION-FINAL-FOUR-NETWORK-001` | PASS |
| `@paimind/scheduler-adapter-feishu-bot` | Host-only Route `404 / empty` + HTTPS Webhook success / reject×3 / recovery + missing credential / absence / restart；`REC-AUTOMATION-FINAL-FOUR-NETWORK-001` | PASS |
| `@paimind/task-monitor` | Client `200 / 113828 bytes / 8c872c…` + native Session / Job / Artifact inspection / failed-pack isolation / reinstall / restart / fresh-tab zero error；`REC-GLOBAL-NETWORK-CLOSURE-001` | PASS |
| `@paimind/developer-resources` | Client `200 / 34729 bytes / 08931c…` + 62 / 62 Host inventory / tabs / refresh / absence / restart / four-size / fresh-tab zero error；`REC-AUTOMATION-FINAL-FOUR-NETWORK-001` | PASS |

Current coverage：`30 / 30 PASS`，`0 / 30 PENDING`。

## Open evidence gaps

- 六个 Feature Pack 与 Runtime Orbs 的真实 Switch、依赖级联、恢复、刷新、进程重启、Settings Revision Conflict、写入失败回滚和 Failed Pack Isolation 已完成。
- 完整九项 Lifecycle Evidence 及对应 Browser QA 的 Runtime Entry 为 `30 / 30`；最后四项 HTTP Adapter、Platform API、Feishu Bot Adapter 与 Developer Resources 已补齐真实 Success / Failure / Recovery、用户可见回读、420 FAIL→Recovery、四档 Responsive、System Keyboard、独立物理缺席、重新安装和 Process Restart。
- Global Network request/error ledger 为 `30 / 30`：Fresh Tab 精确回读 `21 / 21` Client Entries HTTP `200` 与 `9 / 9` Host-only missing Client Routes HTTP `404 / empty body`，并逐入口绑定既有业务 Request / Error / Restore 证据；稳定 Fresh Tab 为 `consoleEvents=[]`。
- Runtime Matrix 与 Network Ledger 已无 Evidence Gap（证据缺口）。全部真实模型路径使用隔离 Deterministic Provider，且未读取或复制主 Profile 凭证。
- Final Gates（最终门禁）、临时 Runtime / Provider 清理和 Integration-ready Handoff（可集成交接）均已完成；本独立产品线无未解决 Evidence Gap 或 Product P0 / P1。企业联合 Integration E2E 属于上层第三工作树目标，不在本独立结论中伪装为已完成。
