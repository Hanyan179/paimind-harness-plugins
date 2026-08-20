# R9 Harness 0.1.0-rc.8 Upgrade Acceptance

## Current status

`Local Product E2E Verified` on 2026-08-20. The runtime and repository are
promoted to Harness `0.1.0-rc.8`; this is local development evidence, not
shared-environment production acceptance.

The repository keeps its 24-hour package release-age policy. Because the rc.8
package set was less than 24 hours old during this verification, a fresh
policy-enforced install remains temporarily time-gated. Functional gates were
run with a one-shot release-age override and the persistent policy was restored.

## Selected matrix

- Harness runtime: exact npm `@deepseek-ai/dsh@0.1.0-rc.8`.
- Official upstream reference: commit
  `141eb6fef83422698aef7a981029e843e8161534`, tag `dsh-v0.1.0-rc.8`.
- Better Sidebar: exact npm `dsh-better-sidebar@0.12.2`.
- Office Viewer provider: exact
  `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0`.
- PAIMind Harness-facing dependencies and the compatibility matrix now select
  rc.8; runtime-version logic remains owned by `@paimind/harness-compat`.

## Executed gates

| Gate | Evidence | Result |
|---|---|---|
| Upstream reference | Harness `master` advanced by `git pull --ff-only` from `47f9438` to `141eb6f`; the pre-existing untracked `ppt-output/` remained unchanged | Passed |
| Repository functional gate | 32 package compliance checks, Type Check, 73 test files / 280 tests, Production Build, API snapshot, package audit, publint, 96 NodeNext exports, examples, framework boundaries and 90-document verification | Passed |
| Real composition | Disposable exact rc.8 runtime installed and exercised with full install, boot, provider removal/restoration, independent feature-removal probes and upstream sentinels | Passed |
| Data migration rehearsal | A full copy of the rc.6 Harness Home booted under rc.8; all 100 pre-existing session files remained present and readable | Passed |
| Live runtime | `com.paimind.harness.3080` runs rc.8 at `127.0.0.1:3080`, returned HTTP 200, retained all 100 session files and produced no startup stderr | Passed |
| Browser | Existing conversation history rendered; Skill Center and Agent Center opened and returned real catalogs; browser console contained no errors | Passed |
| Upstream delta | Composition probes left the Harness upstream worktree unchanged; only the user's pre-existing untracked `ppt-output/` remains | Passed |

## Time-gated supply-chain check

After removing the one-shot override, `pnpm check` correctly stops before the
functional scripts with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` for 65 rc.8
lockfile entries. This is a release-age timing gate, not a compatibility failure.
No wildcard or package-name-wide exception remains in `pnpm-workspace.yaml`.

Rerun plain `pnpm check` after the rc.8 packages cross the configured 24-hour
age window to close this final temporal gate without weakening policy.

## Retained upstream risks

- The rc.8 release notes state that its storage format is incompatible with
  the previous format. The full-copy rehearsal and live 100-session read-back
  passed, but the external recovery pack remains the rollback source.
- The Office provider still declares the stale peer range
  `dsh-better-sidebar@^0.6.0`. The exact selected composition passed; this
  remains an upstream metadata risk.
- The published rc.8 `dsh-client-ui-primitives` package references a missing
  source map during Vite processing. It is a non-fatal packaging warning; tests,
  build, composition and browser rendering passed.

## Rollback

- Full pre-upgrade Harness Home recovery pack:
  `/Users/hansen/Documents/PAIMind-workspace/recovery/paimind-harness-rc6-to-rc8-20260820-1700/dsh-home`.
- Source and recovery copies matched by checksum before migration and each held
  56,211 files, including 100 session files.
- Rollback restores that directory and the rc.6 runtime/profile links; it does
  not modify the Harness upstream reference repository or user `ppt-output/`.
