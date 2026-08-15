# R7 Final E2E and Retirement Checkpoint

## Decision

R7 is Product E2E Verified on 2026-08-15. Goal A has one runtime and one set of
domain objects: DeepSeek Harness. PAIMind remains an independently installable
product-plugin suite. The frozen prototype runtime is retired without source
mutation.

## Selected composition

| Layer | Exact selection | Result |
|---|---|---|
| Harness | `@deepseek-ai/dsh@0.1.0-rc.6` | Latest/next published npm artifact available during R7; selected and verified |
| Side Card provider | `dsh-better-sidebar@0.12.1` | Upgraded from `0.11.0`; adapter contract v3, browser and isolation gates passed |
| Office viewer | `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0` | Loaded through its own technical Bundle after Better Sidebar; real PPTX/XLSX viewing passed; stale `^0.6.0` provider peer metadata is a recorded risk |
| PAIMind | `@paimind/harness-bundle@0.1.0-alpha.0` workspace composition | Full install/boot/remove/restore and individual failure-isolation gates passed |

## Real product loop

From a blank native Workspace and Session, the final journey selected native
Preset `paimind`, invoked native Skill `r7-native-product-e2e`, generated five
new formats with real Tool calls and native Jobs, opened each from the
conversation into its actual Viewer, inspected PPTX Trace, consumed trusted
notifications, executed native Schedule `schedule-1`, verified Read Only denial,
updated the PPTX in place to revision 2, refreshed, restarted Harness and ran a
controlled plugin-absence profile.

The exact Session was `session-5b110dc5-86d6-4734-8c7b-a5af506bd6e2` in
`codex-output/qa/r7-final-e2e`. The durable outputs are:

- `artifacts/r7-product-reality.pptx` — three pages, revision 2;
- `artifacts/r7-runtime-report.pdf` — one real PDF page;
- `artifacts/r7-metrics.xlsx` — formula cells `D2` and `D3`;
- `artifacts/r7-extension-center.html` — safe self-contained HTML;
- `artifacts/r7-bento-product.html` — three-page structured Bento Artifact.

The denied `artifacts/r7-readonly-denied.html` path does not exist. The first PDF
attempt failed on unsupported CJK encoding and produced no false Artifact; the
safe retry passed. This validates failure semantics without concealing the
generator limitation.

## Recovery and isolation truth

- Refresh and restart restored Session, files, Artifact Projection, Deliverables,
  revision 2 Viewer, Trace, notifications and Schedule fold.
- Native Job history is process-local in Harness rc.6, so Task Monitor correctly
  restarted at zero rather than inventing durable history.
- Removing Developer Resources through a temporary out-of-tree profile removed
  only its Extension Center descriptor. The exact seven category navigation,
  other product surfaces and native conversation remained usable; the response
  `ISOLATION-OK` passed before the formal Bundle was restored.
- The final Bento path used the structured `previewKind=bento-deck` Artifact
  contract. Generic HTML paths remain generic and never trigger filename/body
  inference.

## Prototype retirement

The original R7 run saw the prototype clean at base commit
`baa8a0f3bdf5b0787491c4c4fac627f2a8a30321`. The resolved npm/Vite/esbuild
process chain serving `4187` exited after `SIGINT`; the port is unreachable while
the selected Harness remains on `3080`. No package, manifest, browser route or
runtime configuration depends on the prototype. A later audit observed seven
retained tracked modifications in that worktree; they remain untouched and do
not restore the retired runtime entry. The capability mapping is in
[`../migration/prototype-retirement-ledger.md`](../migration/prototype-retirement-ledger.md).

## Final gates

The final gate records:

- frozen-lockfile install;
- full Type Check, 59 test files / 186 tests, Production Build and 19-client framework boundary scan;
- exact selected-runtime install/boot/remove/restore composition;
- real Office Viewer activation, Provider-before-Office ordering and external-provider isolation;
- zero PAIMind delta in the Harness source checkout;
- original clean prototype checkpoint, current retained-worktree disclosure and
  stopped prototype listener;
- selected product URL available at `http://127.0.0.1:3080/`.

The executable acceptance record is
[`../acceptance/R7-final-e2e-retirement.md`](../acceptance/R7-final-e2e-retirement.md).

The Harness sentinel checkout remained at
`47f943859bef60e4160492346772ded9b24f765a`. Its pre-existing untracked
`ppt-output/` directory was present before R7 and remained byte-scope neutral to
this work; the composition gate compared the complete porcelain status before
and after and found no new PAIMind delta.

## Post-branding completion re-audit — 2026-08-15

The completion audit reopened the executable evidence rather than relying on
the earlier `Verified` label. It found and repaired a Scheduler browser-build
boundary: `remote.ts` had imported Host-owned schemas through the service entry,
which pulled `node:crypto`, `node:module` and `node:path` into the Web bundle.
The schemas now live in the browser-safe `src/schemas.ts` module and both Host
and Remote descriptors consume the same definitions without importing the
Scheduler core.

Post-repair evidence:

- full Type Check, `64` test files / `194` tests, Production Build and
  `20`-client framework boundary scan passed;
- exact Harness `0.1.0-rc.6`, Better Sidebar `0.12.1` and Office Viewer `0.1.0`
  install/boot/remove/restore plus eight independent-absence compositions passed;
- the composition script again reported zero upstream worktree delta at
  sentinel `47f943859bef60e4160492346772ded9b24f765a`;
- `3080` returned HTTP `200`; `4187` remained unreachable;
- the live persisted R7 Session replayed the real five-format chain, Schedule,
  permission failure, isolation receipt and revision-2 PPTX Viewer;

The later canonical-object audit reopened FP13 because the formal Bundle had
also selected a PAIMind-owned Scheduler Domain. That selection was removed.
Goal A now loads only Harness `@deepseek-ai/dsh-schedule` plus the independent
`@paimind/scheduler` management surface, which folds the same Session events and
uses native Session prompts for `schedule_create` / `schedule_delete`. The
future platform Scheduler code remains buildable outside the Bundle. The
final corrected full gate passed 71 test files / 208 tests; exact composition proved
the shadow Scheduler, adapters and Platform API absent; the browser created,
read and deleted canonical `schedule-2` with no new Scheduler console errors.
- The final persisted Web profile was audited separately from the formal Bundle.
  Its temporary RQ-103 overlay was cleared, config read-back retained only native
  Schedule plus `@paimind/scheduler`, and the restarted `3080` empty state showed
  Paramont branding and the native-Schedule dialog with zero fresh console errors.
- the independent Task Monitor button opened its native-Job Drawer and truthfully
  showed zero process-local tasks after restart;
- Paramont branding showed the official mountain, `共攀高山之巅`, native Preview
  badge and the same native Preset id with visible name `Paramont 助手`.
