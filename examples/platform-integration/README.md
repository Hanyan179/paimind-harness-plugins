# Platform integration examples

These non-published examples show four supported integration seams:

- register a business-owned Harness action through the scheduler adapter;
- verify a signed HTTP request, return `202`, and report asynchronous results;
- translate a third-party task API behind a custom executor;
- send a notification through the platform client.

The Harness example uses `ctx.effect()` so unloading the example disposes its
registered action. It is never selected by `@hansen/harness-bundle`.

Run `pnpm exec vitest run examples/platform-integration/examples.spec.ts` and
`pnpm run typecheck` to verify the examples. Production credentials, business
fields and deployment configuration are deliberately absent.
