# 工作区蓝图与宿主集成契约

本文件维护 Workspace Blueprint（工作区蓝图）的组合、物化与会话边界。修改模板目录、个人仓库、编排、采用或工作区技能范围时读取。Agent（智能体）与 Skill（技能）的实体、生命周期和验收规则见 [智能体与技能集成契约](agent-skill-harness-contract.md)。

## 组合与物化规则

- Workspace Blueprint（工作区蓝图）是 Folder-first Composition Package（以文件夹为主体的组合包），不是 Agent（智能体）、Skill（技能）、Prompt（提示词）或新的 Runtime（运行时）。一个空绑定的纯文件夹模板是完整合法对象。
- 模板内容由文件夹快照、版本化 Metadata（元数据）以及可选的一个 Agent Reference（智能体引用）和多个 Business Skill Reference（业务技能引用）组成。Agent/Skill 引用是模板作者显式保存的确定编排，不是推荐、自动猜测或运行时检索结果。
- `@paimind/workspace-blueprints` 唯一拥有内置模板目录、Personal Template Repository（个人模板仓库）、文件编辑、摘要冲突检查和安全物化；Harness 继续唯一拥有 Workspace（工作区）与 Session（会话），Agent Center 与 Skill Center 继续唯一拥有各自实体和绑定。
- 模板只保存 Agent 的 `agentId`、`presetId`、`configVersion` 与 Business Skill 的 `name`、`digest` 精确引用，不复制实体、不修改 Agent Profile（智能体配置），也不修改用户默认 Skill Policy（技能策略）。保存模板和采用模板时均需通过来源中心公开 Contract（契约）重新验证。
- 模板编排页面只通过 `@paimind/workspace-blueprints` 的 On-demand Projection（按需投影）读取一次实时可选项；该投影动态调用 Agent Center 与 Skill Center 的公开 Service（服务），不缓存、不持久化、不复制 Persona（人设）或 Skill Folder（技能文件夹），也不得让 Browser Client（浏览器客户端）直接执行跨插件 N+1 Remote Call（多次远程调用）。`ready`、`unavailable` 与 `error` 必须区分，任一来源缺席不得阻止纯文件夹模板。
- 用户模板只能从 Harness 已注册的权威 Workspace Identity（工作区身份）复制文件，或通过经审计的上传入口进入受管仓库；Host Remote（宿主远程服务）不得接受未授权的任意本地路径。内置模板只读，个人模板使用 `expectedDigest` 乐观锁编辑。
- 采用模板时，物化器把精确组合写入工作区内由插件拥有的 Composition Receipt（组合回执）。Business Skill Reference（业务技能引用）由 Skill Scope Resolver（技能作用域解析器）按 Workspace Scope（工作区作用域）合并到该工作区全部 Session，仍须经过用户可用门禁与摘要校验；不得借用 Session 临时选择冒充工作区绑定。
- 可选 Agent Reference（智能体引用）当前只作为采用流程创建的原生入口 Session 的 Preset（预设）和 Agent Binding（智能体绑定）。当前 Harness 没有 Workspace-level Default Preset Hook（工作区级默认预设钩子），因此后续新建 Session 不得伪装成自动继承 Agent；未来只有宿主提供稳定创建 Hook 后才扩展。用户在单个 Session 的显式 Agent 选择始终优先。
- 模板内脚本始终作为 Inert Resource（惰性资源）复制，模板中心不得自动执行脚本、安装依赖、连接外部服务或静默更新已创建工作区。
