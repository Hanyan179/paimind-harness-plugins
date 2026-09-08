# 官方适配 Skill 目录

## 目的

PAIMind 将可移植的 OpenAI 官方 Skill 原则适配到 DeepSeek Harness。适配不复制 Codex 运行时，也不改变 Harness 的 Skill 注册与执行机制；需要平台副作用的创作与安装能力由源码 Plugin（插件）作为 System Skill（系统级技能）提供。

## 第一批内容

| Skill | 原能力 | Harness 适配 |
| --- | --- | --- |
| `openai-docs` | 查询 OpenAI 官方产品与 API 文档 | 使用当前会话可用的联网检索能力，限制官方域名并要求直接引用 |
| `paimind-skill-authoring` | 创建和改进 Codex Skill | System Skill（系统级技能）；通过结构化 Tool（工具）生成未保存草稿，交给 Skill Center（技能中心）编辑和保存 |
| `paimind-skill-installation` | 从目录或 GitHub 安装 Codex Skill | System Skill（系统级技能）；不直接写宿主目录，必须经过技能市场检查、确认和受管安装 |

`openai-docs` 仍可作为 Business Skill（业务技能）目录包安装。Creator 与 Installer 已从市场目录移出，由 `@hansen/skill-market` 与对应 Tool（工具）共同管理 Lifecycle（生命周期），避免系统能力被业务包重复安装。

## 验证原则

1. 从技能市场选择推荐项并查看检查结果。
2. 用户确认后通过统一安装器写入隔离的 Business Skill Repository（业务技能仓库），不得写入 Harness 全局 Skill Root（宿主技能根目录）。
3. 先由用户把该 Business Skill 加入普通对话默认范围、当前 Session 或目标 Agent，再由 Scoped Native Provider（原生作用域提供方）投影到真实 Harness 技能目录；安装本身不等于注入会话。
4. 使用不泄露预期答案的中性问题触发技能。
5. 同时核对回复和 Harness 上下文注入记录，不能仅凭文本相似判定成功。
