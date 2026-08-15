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

## 一致性

- Preset 保存使用目录级 staging/backup/rename；写入失败恢复原目录。
- `expectedVersion` 作为编辑冲突保护。
- 会话绑定同时记录 `sessionId + presetId + configVersion`。
- 验证只有在真实 Session header、绑定版本、首轮用户消息和首轮助手消息同时存在时通过。

