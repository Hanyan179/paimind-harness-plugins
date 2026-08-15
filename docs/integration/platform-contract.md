# PAIMind Platform Integration Contract v1.0

## Transport and identity

- Base path: `/paimind/platform/v1`.
- TLS is mandatory outside loopback; the Harness Host route must sit behind a TLS Reverse Proxy（安全反向代理）.
- `Authorization: Bearer <serviceId>` selects a server-side credential. Source identity comes from that credential, not JSON.
- Required headers: `x-paimind-contract-version: 1.0`, `x-paimind-timestamp`, `x-paimind-request-id`, `x-paimind-signature`.
- Signature input is `METHOD\nPATH_WITH_QUERY\nTIMESTAMP\nREQUEST_ID\nEXACT_BODY`, HMAC-SHA256 base64url.
- Default replay window is five minutes. Request IDs are single-use inside the window.

## Register an HTTP action

`PUT /schedules/actions/{actionId}`

```json
{
  "actionId": "billing.generate-invoice",
  "nameZh": "生成发票",
  "nameEn": "Generate invoice",
  "category": "integration",
  "invokeUrl": "https://billing.example.com/scheduled-actions",
  "allowedResultOrigins": ["https://billing.example.com/"]
}
```

The action catalog stores business-visible metadata. The HTTP Adapter owns the URL, allowlist and credential reference. Scheduler definitions store only `actionId`.

`DELETE /schedules/actions/{actionId}` deactivates the action. Existing task and run history remain.

## Trigger request

The Adapter sends:

```json
{
  "contractVersion": "1.0",
  "runId": "run:...",
  "scheduleId": "schedule:...",
  "actionId": "billing.generate-invoice",
  "trigger": "schedule",
  "scheduledFor": "2026-08-15T01:00:00.000Z",
  "idempotencyKey": "schedule:...",
  "callbackUrl": "https://platform.example.com/paimind/platform/v1/schedules/runs/run:..."
}
```

`trigger` is `schedule` for a calendar occurrence and `manual` for a user-requested **Run now** action. Both use the same Adapter and result contract. A manual run is a real execution and does not change the definition state or `nextRunAt`.

The provider verifies the signature, de-duplicates by `idempotencyKey`, starts work once and returns `202 Accepted` immediately. Any other status is a dispatch failure.

## Report a run

`POST /schedules/runs/{runId}`

```json
{
  "contractVersion": "1.0",
  "runId": "run:...",
  "status": "running",
  "message": "Invoice generation started",
  "progress": 20
}
```

Final report:

```json
{
  "contractVersion": "1.0",
  "runId": "run:...",
  "status": "needs_attention",
  "message": "Tax code requires confirmation",
  "action": {
    "kind": "external",
    "label": "Open tax review",
    "url": "https://billing.example.com/reviews/123"
  }
}
```

Rules:

- Status is `running | succeeded | failed | needs_attention`.
- Final status requires `message`; `progress` is allowed only with `running`.
- External action Origin（来源）must match the registered allowlist.
- Repeating the same final report is idempotent; a conflicting final state returns an error.

## Send a notification

`POST /notifications`

```json
{
  "recipientIds": ["user:123"],
  "title": "Invoice is ready",
  "body": "Open the invoice to review it.",
  "level": "success",
  "link": { "label": "Open invoice", "url": "https://billing.example.com/invoices/123" },
  "idempotencyKey": "invoice:123:ready"
}
```

Rules:

- `recipientIds`, `title` and `idempotencyKey` are required. `body`, `level` and `link` are optional.
- `level` is `info | success | warning | error`; the Notification Center renders business-facing labels rather than these code values.
- `link` requires a 1–80 character label and a credential-free HTTPS URL. It opens in an isolated new tab with `noopener,noreferrer`.
- The caller does not choose a delivery channel. PAIMind applies recipient preferences.
- The public source name is credential-bound; request JSON cannot forge it.
- The caller owns its destination page, data permissions and follow-up actions. PAIMind does not embed or reproduce that page.

## Error envelope

```json
{
  "error": { "code": "invalid_signature", "message": "Request signature is invalid" },
  "requestId": "request:..."
}
```

Codes include `invalid_authentication`, `invalid_signature`, `replay_rejected`, `invalid_request`, `action_id_mismatch`, `action_not_found`, `run_id_mismatch`, `run_not_found`, `body_too_large`, `not_found` and `internal_error`.
