# 智能体与 Skill Harness 集成契约

## 所有权

| 对象 | PAIMind | DeepSeek Harness |
|---|---|---|
| Skill 上传、检查、安装记录 | 拥有 | 不拥有 |
| Skill 发现、调用策略、注入和执行 | 不拥有 | 拥有 |
| 智能体业务表单和版本映射 | 拥有 | 不拥有 |
| Preset 文件、组合、会话绑定和模型运行 | 不拥有 | 拥有 |

## Skill 控制接口

```ts
interface SkillInstaller {
  inspectUpload(input: { uploadId: string }): Promise<SkillUploadPreview>
  installUpload(input: { uploadId: string; digest: string }): Promise<SkillInstallResult>
  listInstalled(): Promise<SkillInstallerSnapshot>
  uninstall(input: { skillId: string; version?: string }): Promise<SkillRemovalRecord>
}
```

二进制通过 `POST /paimind/skills/uploads` 流式传输；控制接口只传 `uploadId` 与摘要。

## 智能体控制接口

后台服务提供 `listProfiles`、`saveProfile`、`setDefault`、`sealAuthoringSession`、`prepareAuthoringTurn`、`bindSession`、`migrationPlan`、`recordMigration`、`verifySession` 和 `listAudit`。业务 UI 创建 Preset 时必须先调用 Harness `agentPreset.copy`；开始对话必须调用 `agentPreset.select`，不得构造模拟会话。

创建和编辑共用同一个 Builder（构建器）与 Profile Contract（配置契约）。Harness 原生 `cordis` 可以作为个人智能体创建助手解析自然语言并生成待确认草稿，但不得被包装成第二个 Agent 实体、第二套 Preset 文档、聊天前端或独立权限系统。主对话 `@` 入口与智能体中心入口只负责发出同一种 Builder Request（构建器请求）。

### Conversation 所有权

- 每次创建或编辑过程只有一个 Harness 原生 Conversation（对话）和一个对应的原生 Session。PAIMind Builder 只维护说明书草稿、Proposal（提案）确认状态和 Session 引用，不保存 Transcript（消息历史），不实现第二套 Composer（输入框）。
- 创建 Session 就绪后必须调用 `sessions.open(sessionId)`，由 Harness 将它切换为当前原生 Conversation。后续配置轮次继续在该 Conversation 中发送；Builder 只监听其原生事件并把已完成提案投影回说明书。
- 切换到测试时必须先通过保存门禁。每次测试创建新的 Harness 原生 Session，选择已保存 Profile 的 `presetId + configVersion`，再调用 `sessions.open(testSessionId)`；测试不能复用 `cordis` 创建 Session。

### 原生创建会话契约

- 首轮配置必须调用 Harness 原生 Session API 创建 `agentPreset=cordis` 的 Session，并通过 `sessions.open(sessionId)` 切换到 Harness 唯一原生 Conversation；后续轮次继续使用同一个 `sessionId`。PAIMind 不保存第二套配置对话历史，也不把 `cordis` 复制为最终智能体。
- 每轮发送前必须调用 `sealAuthoringSession` 与 `prepareAuthoringTurn`。Host 只在 live `cordis` Agent 的内存中保存本轮 `CURRENT_DRAFT`、真实 `INSTALLED_SKILLS` 和 `locale`，并在每次 assemble 时通过隐藏的动态 Complete System Prompt（完整系统提示）注入。该上下文随 Agent 或服务释放而清理，不写入 Profile、Session Event 或影子存储。
- Authoring Agent Scope（创建智能体作用域）强制使用 Native Tool Presentation（原生工具呈现），屏蔽全部继承工具，只注册 `paimind_propose_agent_draft`。Monotonic Guard（单调守卫）再次拒绝该命名空间中的其他工具；Proposal Tool（提案工具）只校验白名单字段并返回简短确认，不保存 Profile、复制 Preset 或回传完整草稿。
- 原生 `user/message` 只能包含用户实际输入的自然语言。不得把 `CURRENT_DRAFT`、Skill 清单、语言、输出协议或它们的 JSON 序列化进用户消息；这些内部上下文也不得出现在原生 Conversation 的可见历史中。
- 每轮提交前读取原生 History（历史）基线序号；提交后只折叠本轮新增事件。只有 `turn/end` 的 `reason.kind` 为 `completed`，同轮恰好存在一组 `tool/call → tool/result` 且通过 `turn + callId + tool name` 唯一关联，Tool Result（工具结果）成功，之后又存在非空 `assistant/message` 时，才可以返回可见回复和 Proposal（提案）。失败、取消、超时、重复提案、未知工具与其他终态必须失败关闭。
- Waiting（等待）、Thinking（思考）和 Streaming（流式）由 Harness 原生 Conversation 展示。Builder 只读取原生 Session 事件以同步运行门禁和结构化提案，不重建消息列表。可见 Assistant Message（助手消息）只包含自然语言；专属 `tool.call.toolview` 只显示“正在生成／已生成待确认配置提案／失败”，不读取或展示 `argsRaw`、Tool Result Content（工具结果内容）或隐藏推理。
- Proposal（提案）采用字段白名单。PAIMind 只接纳业务分类、名称、用途、角色、目标、行为规范、补充要求和会话技能；技能再次过滤为真实已安装名称，基础 Preset、产品类型、身份、版本、存储与权限字段永远不能由模型写入。
- 提案可以在表单预览，但必须保留提案前快照。提案待确认时禁止原生 Conversation 的下一轮发送与保存；Undo（撤销）恢复快照，Keep（保留更新）只确认当前草稿。模型调用和提案确认都不得触发 Preset 复制或 Profile 保存。
- 缺少原生创建 Session 能力、`cordis` 不可用、模型失败或轮次非正常完成时，界面必须显示真实错误并保留草稿，不得调用本地规则生成替代提案。

## 一致性

- Preset 保存使用目录级 staging/backup/rename；写入失败恢复原目录。
- `expectedVersion` 作为编辑冲突保护。
- 会话绑定同时记录 `sessionId + presetId + configVersion`。
- 验证只有在真实 Session header、绑定版本、首轮用户消息和首轮助手消息同时存在时通过。
- 创建助手的 AI 验证与保存后智能体验证分开记录：前者必须通过创建参数、创建结果或原生 Session Header 证明创建 Session 使用 `agentPreset=cordis` 并完成真实模型轮次，后者必须证明测试 Session 选择保存后的 `presetId + configVersion`；两类证据不能相互替代。
- Builder 的测试入口只能运行已保存配置。每次测试必须创建新的 Harness 原生 Session，选择该 Profile 对应的同一个 `presetId + configVersion`，并通过 `sessions.open` 进入原生 Conversation；未保存草稿不得复制临时 Preset、复用创建 Session 或伪造测试 Agent。
