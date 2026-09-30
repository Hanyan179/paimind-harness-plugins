# `@paimind/extension-center`

PAIMind product capability catalog projected over the native Harness Plugin Registry.

`./governance` is a side-effect-free contract entry for the existing enterprise server: exact catalog/plan validation and command types, including JSONB-order-independent plan readback. It does not install a service, grant authorization, expose native Remote operations or own enterprise approval state. The original Feature Pack service retains its Settings and Loader lifecycle ownership. Approval, durable command identity and current target checks belong to the enterprise server; original-UI browser acceptance and paired final-image acceptance remain pending.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns the product projection described above; Harness remains the canonical runtime and domain owner.

## Public entry points

The root export includes `isPaimindBootReadinessSubmission`, the exact bounded plain-JSON carrier validator reused by the enterprise gateway. It grants no identity, runtime or management authority. The original process-local owner retains at most 24 untrusted diagnostic receipts; their contents are not a successful-boot attestation or audit record.

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/contracts` (`workspace:^`), `@paimind/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-host-plugin-inventory`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

The original default Extension Center surface supplies one optional `paimindFeatureManagementContributions` UI provider. It does not register feature state, approval or runtime objects. Enterprise administration contributes its panel inside the same native entry and styles; once a contribution has attached, losing it leaves the management surface locked instead of falling back to direct switches. The ordinary never-governed product surface and the restricted member branch retain their owners. This UI latch is not a server authorization gate: native management bypass restrictions and complete enterprise composition must be validated before exposure.

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. UI, listeners and registrations must be installed through scoped effects so unload removes them. Missing host services delay activation; package-local rendering failures must not corrupt the native shell.

Feature Pack commands, startup reconciliation and root-include repair share one service-owned queue. The original Settings revision is checked when each command executes, after any preceding Loader transition and rollback; failed work is returned to its caller without poisoning subsequent work. Queued commands copy their primitive input and cannot start after this controller is disposed. An already in-flight public Loader update has no cancellation contract and must settle; this is not a claim of transactional cancellation. Native Settings and Loader state remain the sole owners, with no second persistence or execution service.

The trusted internal governed-command seam adds a bounded `governance` string to the same original Feature Pack Settings namespace. One native CAS mutation stores both overrides and the command journal: command/request/plan identity, before/after intent and applying/applied/rolling-back/rolled-back state. Preview discloses all product groups replayed by the original reconciliation algorithm. Execution and recovery require approval covering that full impact; caller-supplied internal checks are not an enterprise authorization service. New methods are absent from public Remote descriptors. A retained journal disables the old direct product switch method; raw native management bypass restrictions still belong to the enterprise gateway.

Cold boot of an unconfirmed command retains durable intent but restores the prior configuration. The same command confirms or recovers its recorded outcome; it does not retry a rolled-back enable. Completion requires original Loader reconciliation, with raw disabled flags checked separately from the desired-state-masked product view. Once native intent is accepted, request cancellation cannot undo Loader work. The journal is an execution receipt, not a second settings store, installation registry, effective-policy database, permission or audit trail.

The existing private native control transport carries the three exact internal operations to this owner. Real private HTTP/Unix transport and native file Settings/Loader processes cover a timed-out accepted change and readback/replay without another transition; diagnostic group bodies are not full product acceptance. Current administrator/target binding, durable control-plane authorization/audit and original-UI contribution are connected in source. Native management bypass closure and paired final runtime remain required before the governed path can be used online. Real browser dependency/failure/reload acceptance remains separate.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/extension-center/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/extension-center/tests`
- `pnpm run test:enterprise:native-carrier apps/enterprise-server/tests/feature-command-owner.native-test.ts` (build first; original file Settings and Loader in separate processes, diagnostic group bodies, not Browser E2E)
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
