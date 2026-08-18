# Scheduler Adapter Guide

## Harness Adapter

A business plugin injects `paimindHarnessScheduleAdapter` and registers code-owned logic:

```ts
await ctx.paimindHarnessScheduleAdapter.registerAction({
  actionId: 'project.weekly-brief',
  source: { id: 'project', nameZh: '项目系统', nameEn: 'Project system' },
  nameZh: '生成每周项目简报',
  nameEn: 'Generate weekly project brief',
  category: 'ai',
  prompt: 'Read the current project workspace and generate the weekly brief.',
  cwd: process.cwd(),
  agentPreset: 'default',
  provider: process.env.PAIMIND_HARNESS_PROVIDER,
  model: process.env.PAIMIND_HARNESS_MODEL,
})
```

`cwd`, Agent Preset and provider/model are Developer Configuration（开发者配置）, not business-user form fields. `provider` and `model` must be registered together; deployments should resolve them from trusted runtime configuration rather than user input.

At runtime the Adapter creates a Session id derived from `runId`, mounts the registered Agent Preset during native Agent setup, starts a `paimind-schedule` Native Job and submits a user-owned scheduled turn whose first line identifies the registered Action. Harness therefore gives the new Session a recognizable scheduled-task title and includes it in the normal conversation list. Once the Session and Job are accepted, the Adapter returns `accepted` immediately. The Agent continues asynchronously; its final response includes `PAIMIND_STATUS: SUCCEEDED` or `PAIMIND_STATUS: NEEDS_ATTENTION`, and the Adapter reports the final status/message back to Scheduler. The Session remains available through “打开对话”. Background execution never replaces the user's current conversation automatically.

The active Bundle also loads `@paimind/scheduler-adapter-harness/agent-action`. It registers the business-visible **Agent · 新建会话并生成工作区简报** item with a fixed developer-owned Prompt and model route. It proves the standard user flow: select the Agent item, configure time, then inspect the created Session from Run records. Additional Agent workflows should register separate outcome-oriented actions rather than adding Prompt or model fields to the Scheduler form.

## Standard HTTP Adapter

Use the Platform SDK to register a provider implementing the v1 contract. Scheduler Core retries transport rejection, while the provider returns `202` and calls back asynchronously. The Adapter owns endpoint, Credential Reference and result Origin allowlist; none appears in the business form.

## Custom Adapter

Create a package that depends on the standalone research package
`@paimind/platform-scheduler` and registers a `PaimindScheduleExecutor`.
Translate the standard trigger into the target API and return a standard final
report or `accepted`. Keep provider authentication and fields inside the
Adapter. Do not depend on the retired Session-local scheduler facade; it was only the
native Harness Schedule management facade.

```ts
const executor: PaimindScheduleExecutor = async (request, signal) => {
  const task = await thirdParty.create({
    key: request.idempotencyKey,
    title: `Scheduled action ${request.actionId}`,
  }, signal)
  return {
    contractVersion: '1.0', runId: request.runId,
    status: 'succeeded', message: 'Third-party task created',
    action: { kind: 'external', label: 'Open task', url: task.url },
  }
}
```

Do not modify Scheduler Core for Feishu, invoice, project or future provider names. If a provider supports PAIMind v1 directly, use the HTTP Adapter; otherwise the owning integration team maintains its Custom Adapter（自定义适配器）.

## Feishu custom-bot Adapter

`@paimind/scheduler-adapter-feishu-bot` is a provider-specific Custom Adapter
for Feishu/Lark group-bot Webhooks. Business code registers an action with a
credential reference, keyword and message template. The Adapter resolves the
Webhook from trusted runtime configuration, guarantees the required keyword,
sends a text message and maps Feishu provider success to a final Scheduler Run
report.

The real Webhook is a Secret（密钥）. It must not appear in the business form,
task definition, Loader YAML, log or Run result. See the
[Feishu Bot Scheduler E2E Guide](feishu-bot-scheduler-e2e.md) for the isolated
Profile, safe configuration and verified real-provider flow.

Feishu custom bots do not implement the PAIMind callback/idempotency protocol.
An ambiguous network retry can therefore duplicate a notification. Use the
standard HTTP Adapter or a business-owned gateway for non-repeatable business
side effects.

## Isolation checklist

- Unregistering the Adapter removes executors but not task/run history.
- Every request uses `idempotencyKey` once.
- External URL is HTTPS and allowlisted.
- Secrets are resolved by reference at dispatch.
- Errors become bounded messages without secret/header/body leakage.
- No external page is embedded in PAIMind.
