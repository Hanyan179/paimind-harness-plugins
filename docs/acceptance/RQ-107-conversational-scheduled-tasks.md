# RQ-107｜平台定时任务验收记录

## Current verdict

本轮 Work Type（工作类型）修正的 Implementation（实现）、Scheduler Targeted Verification（调度器定向验证）和本地真实 Harness Browser Pre-acceptance（浏览器预验收）已于 2026-08-17 完成。Full Repository Gate（全仓门禁）被 `packages/agent-market` 的并行未完成改动阻塞，Shared Environment Acceptance（共享环境验收）也尚未执行，因此当前结论是 RQ-107 Local Pre-acceptance Passed（RQ-107 本地预验收通过），不是全仓通过或最终 Acceptance（验收）。

## Acceptance matrix

| Gate | Expected evidence | Current state |
|---|---|---|
| Product model | “平台定时任务”是产品；“用 AI 帮我创建”是页面操作，工作类型仅为智能任务、工作流、消息任务 | Passed：真实 Harness 回读页头 AI 操作与三个工作类型；集成、监测未出现在新建入口 |
| Work routing | 工作类型与具体工作分开；无能力时不伪造 | Passed：消息任务筛出飞书能力；工作流显示真实空状态且不出现保存表单 |
| List operations | 行内运行、编辑、暂停/恢复、归档；独立归档列表与恢复 | Passed：真实浏览器完成暂停、恢复、归档、恢复为暂停并再次归档 |
| AI creation | 默认指引进入可编辑草稿且不自动发送 | Passed：真实浏览器改写并还原草稿；无发送消息或模型回复 |
| Editing | 独立编辑工作区，类型与具体工作分开只读，修改、保存和列表回读 | Passed：执行时间 23:57→23:56 保存回读，再恢复 23:57 并回读 |
| Contract | capability discovery、workflow category、input validation、weekdays、v1 compatibility、v2 migration、version conflict、restore | RQ-107 Passed：Scheduler Client 8/8、Scheduler Type Check 通过；当前全仓 268/275，7 个失败均位于并行修改中的 Agent Market |
| Runtime | independent result Session、Workspace/Preset snapshot、Run、retry、idempotent notification | Passed：自动化与既有真实运行证据保持通过 |
| Shared environment | 同一端到端链路在共享测试环境执行 | Not available；不得形成最终 Acceptance 结论 |

## Verified correction evidence

- 设置侧边栏与页面标题均显示“平台定时任务”；标题下不再放重复产品说明。
- 新建页右上角显示“用 AI 帮我创建”，工作类型只显示“智能任务 / 工作流 / 消息任务”。AI 创建不再伪装成工作类型，“集成任务 / 监测任务”不再占用业务入口。
- 工作类型与具体工作分开。消息任务在真实环境只显示“飞书机器人关键词测试”；当前没有已注册工作流时显示“暂无已接入的工作流”，且不渲染可保存表单。
- 列表按“类型与能力”展示业务类型，不暴露 `actionId`、Adapter、Cron 或 RRULE。
- 每行直接显示“立即运行 / 编辑 / 暂停或恢复 / 归档”。测试任务 `RQ-107 直接配置复验` 在列表完成暂停与恢复，未进入详情页。
- “已归档”筛选可见，并展示“恢复任务”。测试任务归档后从普通列表消失，恢复后状态为“已暂停”，再次归档后仍可在归档列表回读。
- “用 AI 帮我创建”进入普通对话后，默认指引只出现在 Composer Draft（输入框草稿）。浏览器实际追加“可编辑复验”后再还原；发送按钮未被点击，也没有生成 Agent 回复。
- 智能任务可在“具体工作”中选择已注册能力。通用智能任务显示可编辑“任务说明”，保存后在主列表回读名称、类型、周期、状态及行内操作。
- 编辑页把“工作类型”和“具体工作”分开只读展示。真实浏览器把测试任务执行时间从 23:57 修改为 23:56、保存并从列表回读，再恢复 23:57，最终业务状态未漂移。
- 已删除顶部说明、创建方式说明、蓝色说明框、能力说明和时区说明；创建及编辑页只保留操作需要的信息。
- Archive（归档）是可审计的逻辑删除；Restore（恢复）进入 Paused（暂停）状态，Definition、Run 和 Audit 保留。
- 本地浏览器截图保存在 Codex Visualizations（可视化证据）目录，不写入仓库，也不作为共享环境最终验收替代品。

## Required real chain

1. 进入“平台定时任务”，确认列表可搜索、筛选并直接执行确定性操作。
2. 点击“用 AI 帮我创建”，确认默认指引只填入输入框，可编辑且不会自动发送；该操作不得出现在工作类型中。
3. 选择一个可直接配置的工作类型，再选择“具体工作”，填写任务、计划、时区及必要参数并保存；没有已接入能力的类型只能显示空状态。
4. 从 Storage Domain 回读 Schema v2 Definition 与经过验证的 `actionInput`。
5. 从列表完成编辑、暂停、恢复和归档；从归档列表恢复时必须保持暂停。
6. 立即运行后出现独立结果 Session，不切换当前 Session；运行记录可打开该结果对话并显示时钟标识。
7. Harness 重启后 Definition、Run、Audit 与下一次调度仍可回读。

## Known repository gate

当前 `pnpm test` 为 71/73 Test Files、268/275 Tests：7 个失败均位于 `packages/agent-market`，包括 `installedSkills` 未定义和 Metadata（元数据）旧断言；`pnpm typecheck` / `pnpm build` 同样被该包中缺失的 `AGENT_PLATFORM_CATEGORIES` 等符号阻塞。Scheduler Client（调度器客户端）8/8 与 `@paimind/platform-scheduler` Type Check（类型检查）单独通过，Runtime Bundle（运行时包）按现有 Build Spec（构建规范）重建并完成真实 Harness 复验。`check:api` 仍有受保护基线差异，`verify:framework` 仍会拦截 `@paimind/agent-market` 的既有 `AgentRuntime` 标记；当前 Dirty Worktree（脏工作区）不修复或吸收无关 Agent Market 改动，也不更新全量 Snapshot（快照）。

## Rollback

Schema v1→v2 使用 [`../../scripts/migrate-scheduler-schema-v2.mjs`](../../scripts/migrate-scheduler-schema-v2.mjs)。Apply（应用）前必须停止 Harness 写入并创建源目录之外的独占备份；失败或回滚时恢复该备份，再启动兼容的旧 Bundle。
