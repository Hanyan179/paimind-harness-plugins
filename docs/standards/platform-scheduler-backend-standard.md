# Platform Scheduler Backend Standard

## Package boundary

- Core code may depend on `@hansen/contracts` and a standard time library only.
- Harness API imports and rc-specific parsing stay in `@hansen/harness-compat`.
- Adapter packages may register an executor but may not mutate Core tables directly.
- Business packages register actions through Harness Adapter code or the Platform API; they do not add fields or branches to Scheduler.

## Data and Schema Version

Storage Domain: `paimind_scheduler`; Schema Version: `2`.

- `actions`: catalog metadata, Adapter id, `conversationEnabled` and `usageHint`; no credential secret. Conversation discovery is deny-by-default.
- `definitions`: name, `actionId`, validated versioned `actionInput`, setup `sourceSessionId`, rule, time zone, state and next occurrence.
- `runs`: trigger source, identity, occurrence, state, attempt, result and safe action.
- `audits`: actor, operation and time.

Any schema change increments the version and provides a forward migration plus rollback plan. Migration requires an explicit storage path, defaults to Dry Run, validates the full transaction, creates an external exclusive backup and supports file-level rollback. Archived definitions and historical runs are never hard-deleted by business UI.

## Time

- Persist UTC ISO-8601 with milliseconds and `Z`.
- Persist IANA time-zone ids; never persist only a numeric UTC offset.
- Use `@js-temporal/polyfill`; do not implement calendar or DST math manually.
- Calendar rules are exactly once, daily, weekdays, weekly and monthly day 1–28. Unsupported cadence is rejected and never approximated.

## State machine and idempotency

- Definition: `enabled | paused | archived`.
- Run: `queued -> running -> succeeded | failed | needs_attention`.
- No transition leaves a final state. Exact duplicate final callbacks are read-only success.
- Scheduled `runId` and `idempotencyKey` are deterministic per calendar occurrence. Each explicit manual run receives a unique identity and `trigger=manual`.
- A provider must persist or otherwise enforce the idempotency key before beginning a business side effect.
- Core advances the next occurrence durably before Adapter dispatch and prevents overlap.
- A manual run never mutates definition status, rule or `nextRunAt`, and is rejected while another Run for the task is active.

## Retry and timeout

- Default dispatch timeout: 10 seconds.
- Default maximum dispatch attempts: 3 with linear backoff.
- Default final callback timeout: 24 hours.
- Retry only connection, timeout, non-`202` or equivalent pre-acceptance failures.
- Do not retry an accepted business execution automatically.
- A long-running Adapter must return `accepted` immediately after it has durably created or handed off the target execution. It reports the final result asynchronously; Agent/business execution time is not the dispatch timeout.

Values are deployment configuration, never business form fields.

## Conversation orchestration and Harness execution

- The business user provides only work, necessary target and schedule; the Agent confirms work, cadence and time zone before calling `schedule_manage`.
- `schedule_manage` supports `capabilities`, `create`, `update`, `list`, `run_now`, `pause`, `resume` and `archive`. Delete intent maps to archive.
- Business actions explicitly opt into conversation discovery and validate their own versioned `actionInput` before persistence.
- The generic Agent action captures Prompt, working directory and Agent Preset from the setup Session.
- Provider and model are an atomic pair. A trusted Action Registration may pin both; otherwise the Harness Adapter must resolve both through `agentDefaultModel.currentSelection()` when it creates the autonomous Session. Omitting the route and producing a zero-token Session is forbidden.
- The Adapter mounts the preset during the unpublished Agent setup window so scoped tools and the native Job controller exist before execution starts.
- Every Run owns one new Harness Session and Native Job; it never switches the user's current Session. Final notification publication is idempotent by `runId`.

## Security

- Resolve caller source and tenant from a server-side credential.
- Store only Credential Reference（凭证引用）; secret values remain in an environment/secret service.
- Sign the exact method, path, timestamp, request id and body with HMAC-SHA256.
- Verify signatures before consuming the replay id; use timing-safe equality.
- Reject expired and reused request ids.
- Require credential-free HTTPS. Reject localhost, loopback, link-local and RFC1918 IPv4 at registration; production must also use DNS-aware egress policy to prevent rebinding.
- Validate external result Origin against the registered allowlist.
- Open browser links with `noopener,noreferrer`; do not iframe external business pages.
- Limit API bodies to 256 KiB and log no Authorization, signature, secret, raw credential config or business body.

## Logs and audit

Structured logs may contain `requestId`, `runId`, `scheduleId`, `actionId`, Adapter id, attempt, status, latency and bounded error code. They must not contain secrets, Authorization headers, signed body, embedded URL credentials or unrestricted model output.

Create, update, pause, resume, archive, scheduled dispatch and manual dispatch append an Audit Record. Production enterprise authorization must supply the trusted actor; the local Harness profile uses a documented local actor only for pre-acceptance.

## Error handling

- Public errors use stable machine `code`, bounded human `message` and `requestId`.
- Internal exceptions map to `internal_error`; stack traces remain server-side.
- Adapter unload de-registers only its executors and must not delete definitions or runs.
- Storage open/migration failure is fail-loud; the plugin must not simulate success in memory.
