# Platform SDK Guide

Install the server-side package with the same release version as the Platform API:

```bash
pnpm add @hansen/platform-sdk
```

Create a client. Load the secret from a Secret Manager（密钥管理服务）; never place it in browser code.

```ts
import { createPaimindPlatformClient } from '@hansen/platform-sdk'

const client = createPaimindPlatformClient({
  baseUrl: 'https://platform.example.com',
  serviceId: 'service:billing',
  secret: process.env.PAIMIND_SERVICE_SECRET!,
})
```

Register an HTTP action:

```ts
await client.schedules.registerAction({
  actionId: 'billing.generate-invoice',
  nameZh: '生成发票',
  nameEn: 'Generate invoice',
  category: 'integration',
  invokeUrl: 'https://billing.example.com/scheduled-actions',
  allowedResultOrigins: ['https://billing.example.com/'],
})
```

Receive a trigger by verifying `x-paimind-signature`, timestamp and request id with `verifyPaimindRequestSignature` and `PaimindReplayGuard`. Return `202` before long-running work. The executable implementation is in [`../../examples/platform-integration/`](../../examples/platform-integration/).

Report progress and final result:

```ts
await client.schedules.reportRun({
  contractVersion: '1.0', runId,
  status: 'running', message: 'Started', progress: 10,
})

await client.schedules.reportRun({
  contractVersion: '1.0', runId,
  status: 'succeeded', message: 'Invoice generated',
  action: { kind: 'external', label: 'Open invoice', url: invoiceUrl },
})
```

Send a notification:

```ts
await client.notifications.send({
  recipientIds: ['user:123'],
  title: 'Invoice is ready',
  body: 'Open the invoice to review it.',
  level: 'success',
  link: { label: 'Open invoice', url: invoiceUrl },
  idempotencyKey: `invoice:${invoiceId}:ready`,
})
```

`link` is optional. When present, it must contain a short business label and a credential-free HTTPS URL. PAIMind opens it in an isolated new tab and never embeds the business page.

The caller cannot set source identity or delivery channel. Source is credential-bound and PAIMind applies recipient preferences. `idempotencyKey` identifies the business event and prevents duplicate messages when a caller retries.
