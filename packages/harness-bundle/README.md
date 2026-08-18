# `@paimind/harness-bundle`

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

The ordered PAIMind configuration layer installed after the Harness Web bundle. Feature plugins remain separate packages; the profile installs them beside this bundle so the patch can resolve each row from the profile root.

The bundle pins `dsh-better-sidebar@0.12.2` exactly. Only `@paimind/better-sidebar-adapter` crosses its client service boundary; feature packages consume the PAIMind adapter contract. Better Sidebar 0.12.x moved Office viewers out of core, so the bundle also pins the technical provider `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0`. The external Office package owns its own Harness Bundle row and must activate after `dsh-better-sidebar`; PAIMind does not copy its loader patch. It supplies PPTX/XLSX viewing only and does not become a PAIMind product category or domain owner.

The PAIMind product shell loads `@paimind/platform-scheduler` as its only
Scheduled Tasks product and runtime, together with the Harness, HTTP and
Feishu-bot Adapter services. The old opt-in Harness Session-reminder packages
`@deepseek-ai/dsh-schedule` and `@deepseek-ai/dsh-time-context` are not selected
by this Bundle. Business action plugins register executable actions through the
platform services; the Bundle does not add business fields or business pages.

The Session-local management facade is retired, so users do not see two
competing scheduling products. Platform API/SDK packages remain separately
deployable developer contracts and are not mounted as browser-facing Bundle
rows.

## Responsibility

Role: **Shared support package**. It owns dependency selection and ordered
composition only. Product behavior, state and public APIs remain in the
referenced plugins and Harness remains the canonical runtime owner.

## Public entry points

| Entry | Target | Contract |
|---|---|---|
| Bundle patch | `./cordis.patch.yml` | Ordered Cordis rows applied after the Harness Web bundle. |

## Dependencies

All PAIMind runtime packages use `workspace:^`. External providers are pinned
to the exact versions selected by the compatibility matrix. `package.json` is
the authoritative dependency graph; `cordis.patch.yml` is the authoritative
activation order.

## Lifecycle and failure

Harness applies the patch after its Web bundle. Uninstall removes the PAIMind
rows, and reinstalling the same exact dependency set and patch restores them.
A missing package, incompatible provider or invalid row must fail installation
or startup visibly instead of falling back to a shadow implementation.

## Published files

Only `cordis.patch.yml` and `README.md` are published. Source, tests, local
Harness homes, generated build metadata, coverage and credentials are excluded.

## Verification

- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
- `node scripts/verify-framework.mjs`
