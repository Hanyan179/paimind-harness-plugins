# R8 Better Sidebar 0.12.2 Upgrade Acceptance

## Current status

`Local Product E2E Verified` on 2026-08-16. This is a local development gate,
not a shared-environment production acceptance.

## Selected matrix

- Harness: exact npm `@deepseek-ai/dsh@0.1.0-rc.6`.
- Better Sidebar: exact npm `dsh-better-sidebar@0.12.2`.
- PAIMind adapter contract: `3`.
- Office Viewer provider: exact
  `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0`.
- Formal bundle keeps all PAIMind product capabilities behind their own plugin
  contracts; only `@paimind/better-sidebar-adapter` calls the external provider.

## Executed gates

| Gate | Evidence | Result |
|---|---|---|
| Dependency and contract | Exact provider pin, regenerated frozen lockfile, adapter service contract and no direct feature imports | Passed |
| Full repository gate | 73 test files / 222 tests, Type Check, Production Build, framework boundary checks and 79-document link verification | Passed |
| Real composition | Clean Harness rc.6 profile installed, booted, probed, removed and restored the provider, Office plugin and all PAIMind packages; every independent package-absence variant passed | Passed |
| Manifest ownership | Host-only packages remain installed but do not appear as duplicate browser pages; Agent Builder, Platform API and scheduler adapters are explicitly headless | Passed |
| Desktop browser | Existing profile loaded at `http://127.0.0.1:3080/`; Explorer, tabs, collapse/expand and settings inventory rendered without clean-tab console errors | Passed |
| Responsive browser | `900x760` and `390x844` had no document-level horizontal overflow; mobile Side Card became a focused full-width work surface | Passed |
| Office Viewer | A real three-slide PPTX and a real formula XLSX opened through the external Office plugin | Passed |
| Terminal | The native terminal accepted and returned `sidebar-0122-ok` | Passed |

Browser captures are intentionally stored outside Git under
`codex-output/qa/sidebar-0122/`.

## Known retained risk

The Office provider still declares the stale peer range
`dsh-better-sidebar@^0.6.0`. The exact `0.12.2` composition, production build
and real PPTX/XLSX browser gates passed, so this is retained as an upstream
metadata risk rather than hidden or bypassed. Either provider upgrade must
repeat the same Office Viewer gates.

The terminal also surfaced an existing user-shell warning for a missing
`.openclaw/completions/openclaw` file. The command and terminal path still
worked; PAIMind did not modify the user's `.zshrc`.

## Rollback

- Repository baseline before the upgrade: commit `4a0f98c`.
- Pre-upgrade Web profile metadata is preserved outside Git under
  `codex-output/scratch/profile-web-pre-sidebar-0122/`.
- Rollback restores the exact `0.12.1` dependency and lockfile/profile metadata;
  it does not modify Harness upstream source or user data.
