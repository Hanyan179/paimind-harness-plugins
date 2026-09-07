# PAIMind Harness Plugin Authoring Standard

## Authority and scope

This is the repository's only normative package-authoring standard. It applies
to every workspace package and is enforced by the package, pack, API-snapshot,
type, test, build, framework and documentation gates.

`docs/architecture/plugin-framework.md` owns architecture and domain ownership.
`docs/migration/ledger.md` owns migration history and evidence. Neither file
duplicates this checklist. `docs/compatibility/matrix.md` is the only selected
version source, and `docs/standards/package-roles.json` is the only package-role
registry.

The upstream reference is DeepSeek Harness commit
`47f943859bef60e4160492346772ded9b24f765a`, especially the official tutorials
for [plugin shape](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/01-first-plugin.zh.md),
[lifecycle and effects](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md),
[services and injection](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/03-services.zh.md), and
[Harness registration](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/07-into-the-harness.zh.md).

## Package roles

Every package has exactly one role in `package-roles.json`:

- `client-plugin`: a runtime Cordis plugin with a Harness-discovered Web client.
- `headless-plugin`: a runtime Cordis plugin or service without a browser entry.
- `shared-support`: a build, contract, compatibility, SDK, test or composition
  package that is not mounted as an independent product runtime.

Every client or headless plugin must be reachable from
`@paimind/harness-bundle` through production dependency edges. A shared-support
package must have a real production or development consumer; the bundle itself
is the composition root. A package with no registered role, no consumer, or no
reachable runtime path is an orphan and fails the gate. Counts are never a
permanent rule.

## Identity and manifest

- Directory names never determine identity. `package.json#name` is canonical.
- The registered path and `package.json#name` must match `package-roles.json`
  exactly and package names must be unique.
- Publishable packages use ESM, declare a description, an explicit license
  policy, the repository Node.js engine, and an allowlisted `files` array.
- Code packages declare `main`, `types`, and `exports`; bundle-only packages
  declare `dsh.bundle.patch` and publish only the patch plus documentation.
- Existing public subpaths are preserved unless a separately approved API
  migration changes them. Tests import internals relatively; they do not widen
  package exports.
- A client plugin declares `dsh.client.platform: "web"`, a buildable client
  entry, `./client`, and `./package.json`. A non-client package declares none of
  those client-discovery fields.

## Dependencies and compatibility

- All internal package dependencies use `workspace:^` and point to registered
  identities. Production code never depends on an orphan or test-only package.
- Loader row order does not establish activation order. Required services are
  declared through Cordis `inject`; optional services use `ctx.get(name)`.
- Harness-version-sensitive imports and adapters live only in
  `@paimind/harness-compat`. Better Sidebar imports live only in
  `@paimind/better-sidebar-adapter`.
- Selected external providers are exact versions from the compatibility matrix.
  Feature packages never depend on `latest`, a caret range, a Git branch, or an
  unverified provider version.

## Lifecycle and failure

- Function plugins export named `apply` and optional `name`, `inject`, and
  `Config`. A service class is used only when the package actually provides a
  service. The forms are not mixed.
- Cordis-managed listeners, child plugins, services and Harness registrations
  use their native effect ownership. Timers, watchers, sockets, DOM nodes and
  other external resources are acquired inside `ctx.effect()` and return a
  disposer.
- Unload must remove every package-owned registration, listener, portal, style,
  timer and connection. Shared Harness objects and provider-owned UI survive.
- Missing hard dependencies leave the fiber `PENDING`; an `apply` or validation
  exception leaves it `FAILED`. A feature must not report successful activation
  when required entries cannot resolve.
- Client rendering failures collapse only the package-owned surface. Native
  Harness conversation and unrelated plugins remain usable.

Shared client presentation uses the [UI foundation contract](ui-foundation.md);
per-plugin adoption and user review follow the [UI quality roadmap](../plans/ui-quality-foundation-roadmap.md).

## Published files

- The package tarball contains only declared runtime JavaScript, declarations,
  source maps that support those artifacts, required static/runtime resources,
  package metadata, README and license policy.
- `.tsbuildinfo`, tests, coverage, local runtime homes, screenshots, credentials,
  workspace sources, caches and unrelated examples are forbidden.
- Every exported runtime and type target must exist in the tarball. Every packed
  JavaScript or declaration file must be reachable from an export, a Harness
  client entry, a bundle patch, or a documented runtime resource.
- Harness Web client entries are the one format exception: `dsh.client` loads
  `./lib/client.js` through `window.__ModuleLoader__`, so the build deliberately
  emits CommonJS inside the package's ESM namespace. The `publint` gate may
  suppress only `FILE_INVALID_FORMAT` for the exact
  `exports["./client"].default` path on a registered `client-plugin`. Any other
  `publint` message remains blocking, and Node-facing exports remain ESM.

## Package README

Every package README links to this standard and contains only package-specific
facts under these exact sections:

1. `Responsibility`
2. `Public entry points`
3. `Dependencies`
4. `Lifecycle and failure`
5. `Published files`
6. `Verification`

The README states what the package owns, what it explicitly does not own, how it
loads, how it unloads, and how failure is contained. It does not repeat the
repository-wide rules above.

## Verification and API preservation

- Fast Gate runs role/consumer/reachability checks, tarball audit, `publint`, a
  NodeNext external consumer, API snapshot comparison, typecheck, tests, build,
  framework checks and documentation checks.
- Release Gate uses exact matrix versions and a disposable real Harness profile
  to prove install, boot, runtime behavior, remove and restore, followed by 3080
  browser acceptance and upstream sentinels.
- Runtime exports, generated declarations, client discovery metadata and bundle
  patches are compared to the protected baseline. An unexpected difference is
  a blocking public-contract change, not an automatic snapshot update.
- An approved retirement is identity-based: migrate durable examples and
  consumers first, remove the package and references second, regenerate the
  lockfile, then record the identity once in the retirement ledger.
