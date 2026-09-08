# Package Retirement Ledger

This is the only repository file that retains exact retired package identities.
The five rows were approved after the protected P0 snapshot and package-consumer
audit found zero `package.json` consumers.

| Package identity | Former directory | Durable disposition | Consumer result |
|---|---|---|---|
| `@hansen/launcher` | `packages/launcher` | Product navigation remains with the native shell and Extension Center | None |
| `@hansen/conversation-extensions` | `packages/conversation-extensions` | Conversation capability remains native Harness behavior | None |
| `@hansen/scheduler` | `packages/scheduler-native` | The retained platform Scheduler is the sole PAIMind scheduler | None |
| `@hansen/permissions-core` | `packages/permissions-core` | Harness permission presets remain canonical; no synthetic product RBAC is retained | None |
| `@hansen/platform-integration-examples` | `packages/platform-integration-examples` | Effective code and tests moved to `examples/platform-integration/` | None |

Retirement removes workspace manifests, sources, tests, project references,
aliases, lockfile importers, build/framework assumptions and active-document
references. Historical evidence describes the capability disposition without
repeating retired identities.

## Verification

- Each identity above had zero exact `package.json` consumers at P0.
- All former directories, project references, aliases and lockfile importers
  are absent after cleanup.
- Effective integration examples are preserved outside the workspace package
  graph at [`../../examples/platform-integration/`](../../examples/platform-integration/).
- `check-package-compliance.mjs` parses this table and fails if an identity or
  former directory reappears, or if an exact identity occurs in any other
  repository file.
- The one-time result is 30 workspace packages: 19 client plugins, six headless
  plugins and five shared-support packages. Future gates validate roles,
  consumers, reachability, contracts, published content and lifecycle instead
  of hard-coding those counts.
