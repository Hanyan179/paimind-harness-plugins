---
name: lark-shared
version: 1.0.0-paimind.1
description: 本地飞书连接的身份与权限规则。检查已绑定账号，解释权限错误，不切换账号或复制凭证。
---

# 本地飞书共享规则

Business Skill（业务技能）；原始说明见 `upstream/ORIGINAL.md`，来源及完整资源摘要见 `PROVENANCE.json`。在此宿主中优先遵循本入口。

只使用当前助手已绑定、名称以 `feishu_identity` 结尾的原生工具检查账号。文档读、新建和局部修改分别使用 `feishu_read_document`、`feishu_create_document`、`feishu_update_document`；具体参数见 `lark-doc`。禁止用 shell、全局默认账号或备用连接绕过绑定范围。

连接固定关联明确的 CLI profile，文档操作固定 user 身份。账号授权和文档访问权仍由飞书及本地 CLI 管理。不要输出 appSecret、accessToken、refreshToken，也不要写进技能、人设或连接说明。

`identity: user` 不是文档访问证明。根据文档工具的真实结果解释权限不足，保留结构化错误、权限提示与结果；不能把权限不足当成成功。

写入必须符合用户当前明确意图。未知结果先核对目标，不自动重试。此连接不提供账号初始化、授权扩容、消息发送、权限变更或删除工具。原始说明中的相应 CLI 流程只供用户理解故障，不自动执行。
