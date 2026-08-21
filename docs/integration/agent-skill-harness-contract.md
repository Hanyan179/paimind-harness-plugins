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

后台服务提供 `listProfiles`、`saveProfile`、`setDefault`、`bindSession`、`migrationPlan`、`recordMigration`、`verifySession` 和 `listAudit`。业务 UI 创建 Preset 时必须先调用 Harness `agentPreset.copy`；开始对话必须调用 `agentPreset.select`，不得构造模拟会话。

创建和编辑共用同一个 Builder（构建器）与 Profile Contract（配置契约）。Harness 原生 `cordis` 可以作为个人智能体创建助手解析自然语言并生成待确认草稿，但不得被包装成第二个 Agent 实体、第二套 Preset 文档或独立权限系统。主对话 `@` 入口与智能体中心入口只负责发出同一种 Builder Request（构建器请求）。

### 原生创建会话契约

- 首轮配置必须调用 Harness 原生 Session API 创建 `agentPreset=cordis` 的 Session；后续轮次向同一个 `sessionId` 提交消息。PAIMind 不保存第二套配置对话历史，也不把 `cordis` 复制为最终智能体。
- 每轮提交前读取原生 History（历史）基线序号；提交后只折叠本轮新增事件。只有 `turn/end` 的 `reason.kind` 为 `completed`，且本轮存在非空 `assistant/message` 时，才可以返回可见回复和 Proposal（提案）。失败、取消、超时与其他终态必须失败关闭。
- Streaming（流式）只投影原生 Session Partial Blocks（部分输出块）中的可见文本，并在结构化提案标签前截断；不得把隐藏推理或提案 JSON 当作用户可见回答。
- Proposal（提案）采用字段白名单。PAIMind 只接纳业务分类、名称、用途、角色、目标、行为规范、补充要求和会话技能；技能再次过滤为真实已安装名称，基础 Preset、产品类型、身份、版本、存储与权限字段永远不能由模型写入。
- 提案可以在表单预览，但必须保留提案前快照。提案待确认时禁止下一轮配置与保存；“撤销”恢复快照，“保留更新”只确认当前草稿。模型调用和提案确认都不得触发 Preset 复制或 Profile 保存。
- 缺少原生创建 Session 能力、`cordis` 不可用、模型失败或轮次非正常完成时，界面必须显示真实错误并保留草稿，不得调用本地规则生成替代提案。

## 一致性

- Preset 保存使用目录级 staging/backup/rename；写入失败恢复原目录。
- `expectedVersion` 作为编辑冲突保护。
- 会话绑定同时记录 `sessionId + presetId + configVersion`。
- 验证只有在真实 Session header、绑定版本、首轮用户消息和首轮助手消息同时存在时通过。
- 创建助手的 AI 验证与保存后智能体验证分开记录：前者必须通过创建参数、创建结果或原生 Session Header 证明创建 Session 使用 `agentPreset=cordis` 并完成真实模型轮次，后者必须证明测试 Session 选择保存后的 `presetId + configVersion`；两类证据不能相互替代。
- Builder 的测试对话只能运行已保存配置，并必须选择该 Profile 对应的同一个 `presetId + configVersion`；未保存草稿不得复制临时 Preset 或伪造测试 Agent。
