# 官方适配 Skill 目录

## 目的

PAIMind 将可移植的 OpenAI 官方 Skill 适配为 DeepSeek Harness 可发现的个人技能包。适配只修改操作路径和工具边界，不复制 Codex 运行时，也不改变 Harness 的 Skill 注册与执行机制。

## 第一批内容

| Skill | 原能力 | Harness 适配 |
| --- | --- | --- |
| `openai-docs` | 查询 OpenAI 官方产品与 API 文档 | 使用当前会话可用的联网检索能力，限制官方域名并要求直接引用 |
| `skill-creator` | 创建和改进 Codex Skill | 输出符合 PAIMind/Harness `SKILL.md` 契约的包结构，不生成 Codex 专属元数据 |
| `skill-installer` | 从目录或 GitHub 安装 Codex Skill | 不直接写宿主目录，改为引导用户经过技能市场检查与确认 |

三者来源均标记为 `OpenAI Official · Adapted for Harness`，采用 Apache License 2.0；安装包包含完整许可证和逐项修改说明。

## 验证原则

1. 从技能市场选择推荐项并查看检查结果。
2. 用户确认后通过统一安装器写入宿主 Skill 目录。
3. 在标准模式真实会话中重新读取 Harness 技能目录。
4. 使用不泄露预期答案的中性问题触发技能。
5. 同时核对回复和 Harness 上下文注入记录，不能仅凭文本相似判定成功。
