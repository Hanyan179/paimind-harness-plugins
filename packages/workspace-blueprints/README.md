# `@paimind/workspace-blueprints`

PAIMind Workspace Blueprint Center for creating native Harness Workspaces from curated, versioned starting structures.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client + host product plugin**. It owns versioned folder snapshots, optional exact Agent and Business Skill composition references, safe materialization into an already registered empty Harness Workspace, and a center-column discovery surface. A folder-only Blueprint is a complete valid package. Harness remains the sole owner of Workspace identity, registration, Session lifecycle, and navigation. Adopted Business Skill references enter the Workspace scope through the shared Skill resolver; an optional Agent reference applies only to the native entry Session created during adoption because Harness has no Workspace-level default Preset hook. This package does not copy Agent or Skill entities, change their owning-center state, or create a second runtime.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Host catalog and materialization service. |
| `./catalog` | `./lib/types/catalog.d.ts`, `./lib/catalog.js` | Immutable built-in Blueprint descriptors. |
| `./contract` | `./lib/types/contract.d.ts`, `./lib/contract.js` | Browser-safe catalog and materialization contract. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Package lifecycle invariant. |
| `./remote` | `./lib/types/remote.d.ts`, `./lib/remote.js` | Strict Remote descriptors. |
| `./typert` | `./lib/types/typert.d.ts`, `./lib/typert.js` | Remote descriptor compatibility export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Sidebar entry and center-column Blueprint UI. |
| `./package.json` | `./package.json` | Package metadata. |

## Dependencies

- Internal runtime dependency: `@paimind/harness-compat` (`workspace:^`).
- External runtime dependency: `zod` (`^4.4.3`).
- Client peers: `react` and `react-dom` (`>=18.0.0 <20.0.0`).

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

The host service mounts with `workspaceRegistry`, exposes a strict Remote surface, and resolves every write target from a canonical Harness `workspaceId`. The client uses the native directory picker and Workspace registration service before materialization. Unknown Workspaces, non-empty targets, unsafe paths, symbolic links, unsupported files, stale Blueprint versions, and size-limit violations fail closed. While creation is in flight, the shared product-surface close guard blocks Escape, outside navigation, and another Center opening; real registry failures and cleanup warnings remain visible. Unloading removes UI and Remote registrations without deleting a Workspace or its files.

## Published files

The manifest publishes built Node and client entries plus the read-only `templates/**/*` catalog. Source tests, local Harness homes, generated acceptance screenshots, caches, and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/workspace-blueprints/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/workspace-blueprints/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
- Real Harness composition and browser acceptance at `127.0.0.1:3080`.
