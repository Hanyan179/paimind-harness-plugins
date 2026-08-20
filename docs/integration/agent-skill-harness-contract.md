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

## 一致性

- Preset 保存使用目录级 staging/backup/rename；写入失败恢复原目录。
- `expectedVersion` 作为编辑冲突保护。
- 会话绑定同时记录 `sessionId + presetId + configVersion`。
- 验证只有在真实 Session header、绑定版本、首轮用户消息和首轮助手消息同时存在时通过。
- Builder 的测试对话只能运行已保存配置，并必须选择该 Profile 对应的同一个 `presetId + configVersion`；未保存草稿不得复制临时 Preset 或伪造测试 Agent。
