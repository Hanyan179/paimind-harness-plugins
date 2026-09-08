# Platform Scheduler Deployment Runbook

## Supported topology

One Harness Host process, one Harness Storage Domain and one TLS Reverse Proxy. The local profile uses the Harness JSON-backed Domain file; production may select SQLite. Multi-node active/active scheduling is unsupported because the selected storage API does not provide a distributed lease.

## Bundle composition and storage

The formal Bundle loads the platform Scheduler Core and standard Adapter
services in this dependency order:

1. `@hansen/platform-scheduler` and its invariant.
2. `@hansen/notifications`.
3. `@hansen/scheduler-adapter-harness`, `./agent-action`, `./agent-tool` and the Adapter invariant.
4. `@hansen/scheduler-adapter-http` and its invariant.
5. Optional provider-specific Adapters, such as `@hansen/scheduler-adapter-feishu-bot`, and their invariants.
6. `@hansen/platform-api` and its invariant as a server-only service; it does not register a browser-facing product entry.
7. Business-owned action plugins.

Unload action plugins and Adapters in reverse order before the Core. The active
PAIMind profile must not silently fall back to or re-enable the retired native
Session-reminder plugins when the platform Scheduler is removed.

Select a durable Harness storage backend. Never commit `.dsh-home`, database files, secrets or backups to the plugin repository.

## Environment

```text
PAIMIND_SCHEDULER_CALLBACK_URL=https://platform.example.com/paimind/platform/v1/schedules/runs
PAIMIND_PLATFORM_SERVICE_CREDENTIALS_JSON={...}
PAIMIND_SCHEDULER_OUTBOUND_SECRETS_JSON={...}
# Optional Feishu custom-bot Adapter. The value is a secret and the example must not contain a real token.
PAIMIND_FEISHU_BOT_WEBHOOKS_JSON={"credential:feishu-bot-rq103":"https://open.feishu.cn/open-apis/bot/v2/hook/<secret>"}
PAIMIND_FEISHU_BOT_KEYWORD=测试
```

`PAIMIND_PLATFORM_SERVICE_CREDENTIALS_JSON` maps service ids to a secret, source metadata and `credentialRef`. `PAIMIND_SCHEDULER_OUTBOUND_SECRETS_JSON` maps that reference to the outbound shared secret. In production inject both from a Secret Manager and restrict process-environment inspection.

For the Feishu custom-bot Adapter, `PAIMIND_FEISHU_BOT_WEBHOOKS_JSON` maps a
code-owned credential reference to the real Webhook. Keep the token outside
task definitions and Loader patches. `PAIMIND_FEISHU_BOT_KEYWORD` must match a
keyword configured by the bot administrator. The local-only
`PAIMIND_FEISHU_BOT_E2E=1` helper must remain disabled in normal deployments.

## Reverse proxy

- Expose only `/paimind/platform/v1/*` over TLS.
- Preserve exact path and body bytes used for HMAC verification.
- Disable request-body mutation and cross-origin browser access.
- Apply request size, rate, source-network and egress policies.
- Do not expose the raw Harness Host port to untrusted networks.

## Start and health check

1. Back up SQLite and credential configuration references.
2. Start Harness with the selected profile.
3. Confirm the platform Scheduler and selected Adapter rows are active and the Scheduler Storage Domain opens; confirm the retired Session-local facade plus `@deepseek-ai/dsh-schedule` and `@deepseek-ai/dsh-time-context` are absent.
4. Register a test action with a test credential.
5. Create a one-time task at least two minutes ahead and confirm one Run.
6. Confirm Platform API rejects an invalid signature and replay.

## Stop

Drain or deliberately fail active runs according to the change window. Stop ingress first, then Harness. Unload Platform API, business action plugins, Adapters, Scheduler and storage in reverse dependency order.

## Upgrade

1. Back up the database and record package versions.
2. Run Type Check（类型检查）, tests, Production Build（生产构建）, Framework Verification（框架验证） and document checks.
3. Stop Harness writes. Rehearse Schema v2 migration and rollback on a copied storage file. The JSON-backed command defaults to Dry Run:

   ```bash
   pnpm migrate:scheduler-v2 --path /absolute/path/to/paimind_scheduler.json
   pnpm migrate:scheduler-v2 --path /absolute/path/to/paimind_scheduler.json --apply --backup /external/backup/paimind_scheduler.v1.json
   ```

   `--apply` refuses an in-place/sibling backup, creates the backup exclusively, performs an atomic replacement and re-reads the row counts and Schema version. If validation fails, keep Harness stopped and use the printed rollback command.
4. Deploy one node, run the 12 E2E cases and browser matrix, then reopen ingress.

## Backup and restore

- Use a backend-consistent backup while writes are paused or through the configured storage backup mechanism.
- Restore the database and the same credential references, then start Harness.
- Verify definitions, archived history and running-timeout recovery before opening ingress.
- Never restore secret values from logs or task records; they are intentionally absent.

## Rollback

Stop ingress, stop Harness, restore the previous Bundle package set and compatible database backup, then restart. Rollback must preserve the platform Scheduler database and must not silently enable the retired native Session-reminder rows.
