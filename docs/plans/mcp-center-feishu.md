# MCP Center and local Feishu integration

Status: implementation authorized by the user's confirmed plan on 2026-09-07. No release or business acceptance is claimed by this plan.

Source: WORK-I-002 and `/Users/hansen/Documents/AI-Secretary/work/projects/feishu-human-writing/PLAN.md`; the confirmed conversation expands the initial writing-agent draft into a reusable connection center.

## Outcome

Single-user self-service connection management, with native stdio and Streamable HTTP transports, classification, search, tests, disable/restore and explicit bindings for any Agent. The local Feishu CLI remains the account and resource-permission owner. One writing Agent proves real document read/create/partial-update/readback through Harness. Enterprise delivery keeps priority; enterprise identity and remote employee-device access are outside this implementation.

## Ownership and conflict review

| Dimension | Decision |
| --- | --- |
| Product surface | MCP Center owns its independent sidebar surface and Settings section; Agent Center owns the connection selector in its existing draft. Extension Center owns feature enablement. |
| Domain entity | MCP Center owns connection definitions; Agent Builder owns connection references in Agent profiles. Skills remain Business Skills in Skill Market. |
| Writable state | Connection repository is user-scoped; config changes use optimistic concurrency. Native Agent Profile saves preserve other fields. No secrets in profiles or catalogs. |
| Runtime service | MCP Center reconciles configuration into native Agent-scoped MCP plugins. Harness owns the transports, tools, execution and lifecycle. No invocation RPC. |
| Harness compatibility | All native MCP/plugin/Agent lifecycle adaptation lives in harness-compat, pinned to the compatibility matrix. |
| Failure and unload | Disable gates new calls before disposal; unload removes native MCP contributions without affecting unrelated conversation. Connection test never performs document writes. |

## Implementation

- Independent MCP Center plugin and separate local Feishu CLI MCP adapter, using the existing official SDK version. The center has no vendor adapter dependency; the bundle optionally composes the Feishu template plugin. Other plugins use the same lifecycle-bound template contribution contract for stdio or HTTP defaults. Template contributions are transient UI configuration, never a persisted tool registry.
- Agent editor presents Business Skills and tool connections as peer selectors using one shared panel component and the same count, search, category, selected-only and option styling, while each domain retains its own references.
- Browser-safe management API for list/save/probe/enable/remove; details expose tool summaries and separate connection and business evidence.
- Profile updates never authorize execution of historical requests. Any native Session continuation prepares reviewable, unsent context in the native composer; it must not submit a migration summary automatically.
- Agent profiles persist connection references only. A saved connection is not automatically exposed to all Agents. Multiple Agent bindings may share one personal connection.
- Each Feishu connection fixes its CLI executable and profile. The adapter offers identity status, fetch, create and bounded partial-update operations through argv, never arbitrary shell text; credentials stay with lark-cli.
- Full human-writing resources plus managed Feishu instruction/tool mappings are installed as Business Skills for acceptance; no global catalog injection or duplicated Persona workflow.
- Owner resolution, repository and native execution projection are separate interfaces. The first deployment is one trusted local OS user; this is not proof of multi-user security isolation.

## Acceptance

- Lifecycle: add/edit/filter/test/disable/restore/remove, missing executable, auth failure and transport failure.
- Two bound Agents, an unbound Agent, live disable and unlink; preserve other Agent fields.
- True Harness/browser document workflow using a dedicated new personal test document; prove read/create/partial update/readback and unchanged neighboring content.
- Uncertain writes are not automatically replayed; verify the target before deciding what happened.
- Focused tests, typecheck, production build, repository gates, real composition and browser acceptance, unload/restore evidence. Evidence must distinguish tested and untested behavior.
# 2026-09-07 任务摘要与技能上传补充

- 类型：扩展既有 Task Monitor；入口、展示和临时读取状态仍由 Task Monitor 唯一拥有。
- Agent 名称、技能与连接引用读取 Agent Center 公开配置契约；不复制 Persona，不保存第二份绑定。
- MCP Center 公开只读会话连接摘要，提供名称、来源标识与当前挂载状态；不暴露命令、凭证或增加工具调用入口。所有 MCP 使用同一契约。
- Harness 继续拥有原生会话、工具注册与执行；最近调用记录只来自原生会话历史。配置引用与已使用证据分别显示。
- 来源插件可选；缺失或失败只影响对应摘要，不能影响原生对话；异步刷新有会话身份检查与卸载清理。
- 验收增加名称解析、未调用但已绑定、禁用、未绑定历史、切换会话及来源缺席；完整导出本机 human-writing，经技能中心上传，再通过智能体中心验证独立绑定。
