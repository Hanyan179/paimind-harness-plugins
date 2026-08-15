# F0 Framework Acceptance

## Scope

F0 proves that PAIMind can be developed and installed as an out-of-tree plugin suite without modifying DeepSeek Harness source. It has no standalone product page and requires no manual user acceptance.

## Automated gates

| Gate | Evidence command | Status |
|---|---|---|
| Workspace install | `pnpm install` and `pnpm peers check` | Passed; no peer dependency issues |
| Strict types | `pnpm run typecheck` | Passed |
| Current full suite | `pnpm run test` | Passed; 25 files and 87 tests through FP07 |
| Production artifacts | `pnpm run build` | Passed; eight client plugins through FP07 |
| Framework boundaries | `pnpm run verify:framework` | Passed; zero direct Harness value imports outside `harness-compat` and zero direct Better Sidebar imports outside `better-sidebar-adapter` |
| Current real Harness install/remove | Exact npm `@deepseek-ai/dsh@0.1.0-rc.6` plus `dsh-better-sidebar@0.11.0`, using the command below | Passed; eight PAIMind manifests served |
| Harness worktree delta | Captured before/after by the composition script | Passed; zero upstream worktree delta |

```bash
node scripts/verify-harness-composition.mjs \
  --runtime "/path/to/exact-npm-runtime" \
  --dsh-bin "/path/to/exact-npm-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --provider "/path/to/exact-npm-runtime/node_modules/dsh-better-sidebar" \
  --expected-dsh-version "0.1.0-rc.6" \
  --upstream-checkout "/path/to/deepseek-harness-checkout"
```

## Pass conditions

- The bundle and FP01 package appear in an isolated Web profile configuration.
- Removing them restores the native configuration.
- The Harness worktree status is byte-for-byte unchanged.
- Feature packages do not import version-sensitive `@deepseek-ai/*` values directly.
- Slot and DOM registrations dispose cleanly.
- A runtime animation render failure collapses only the PAIMind surface.

## Result

`Technical Accepted`. The original F0 isolated profile accepted the Bundle and FP01 package, restored the native configuration, and left the Harness checkout unchanged. The same framework gate has since expanded with the selected Better Sidebar provider and FP01-FP07; it still installs, boots, serves every current client manifest, removes, restores, and leaves the Harness checkout unchanged. F0 therefore remains valid as the plugin suite grows.
