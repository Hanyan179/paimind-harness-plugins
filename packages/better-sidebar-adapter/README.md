# `@paimind/better-sidebar-adapter`

Version-pinned PAIMind boundary for the external Better Sidebar provider.

Contract v4 adds provider-neutral hidden tab registration and a per-open dynamic
title for on-demand workbenches.

The server-side consumer also uses the pure classifier for the two version-pinned
session push routes. This does not mount routes, authenticate users, own sessions
or open an interactive terminal; the enterprise gateway must verify its own
member cell and the canonical native session before accepting a connection.

The managed file-tree carrier also recognizes the provider's exact plain-JSON
request and projects native directory metadata into its existing display shape.
Browser `cwd` / `repoRoot` hints do not select a directory. The enterprise
gateway requires the original session's cwd and the managed filesystem reader,
with current identity/binding checks before returning metadata; there is no
fallback to the provider's unrestricted host route. Symlink entries are shown
as unavailable and cannot be traversed. This adds no directory registry,
terminal, file write, settings permission or second file-tree UI.

The exact `fs.read` preview uses the same session-owned filesystem through
private 64 KiB chunks, reauthorizing each read and checking one file version
before returning any content. It retains the provider's 512 KiB text preview,
4 KiB binary header and explicit truncation. Browser roots are discarded;
changed files, aliases, nonregular entries and failed authorization return no
partial content. The separate original `/sidebar/file` carrier streams complete
authorized bytes up to the provider's default 20 MiB ceiling, preserving its
media types and optional attachment filename. Each chunk is reauthorized and
version-checked; later failure terminates the response with an unfulfilled exact
Content-Length, not a truncated successful download. Backpressure, disconnect,
revocation and a 120-second overall bound cancel the read. Resource responses
never inherit application document privileges. This is not a file write or
artifact discovery contract; it adds no public route or persistence owner.

The pure presentation reader accepts only empty `shell.get` / `settings.get`
JSON requests. Members receive actual shell labels and bounded native display
preferences, including feature switches and external-panel exclusion. It omits
terminal arguments, open third-party settings and unknown fields. Unsupported
unsafe viewer/browser preferences fail rather than being replaced by fabricated
safe values. The original optional-settings absence remains absent. The gateway
must reauthorize before returning any projection; configuration writes, terminal
execution and third-party settings require their own reviewed contracts. No
routes or preferences are stored or mounted by this reader.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client plugin**. It owns the product projection described above; Harness remains the canonical runtime and domain owner.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/harness-compat` (`workspace:^`), `@paimind/workspace-project` (`workspace:^`).
- External runtime or peer dependencies: `dsh-better-sidebar` (`0.17.1`), `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-locale`, `@paimind/workspace-project`, `dsh-better-sidebar`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. UI, listeners and registrations must be installed through scoped effects so unload removes them. Missing host services delay activation; package-local rendering failures must not corrupt the native shell.

## Published files

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/better-sidebar-adapter/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/better-sidebar-adapter/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
- `node scripts/enterprise/probe-member-sidebar.mjs <live-member-evidence> <private-normal-name-credentials>`
  uses an isolated temporary gateway, actual existing member cells and the real
  identity database. It creates and revokes only its own test login sessions,
  verifies previous logins are unchanged, and writes no native business records.
  It is a backend transport diagnostic, not Browser E2E or final image acceptance.
