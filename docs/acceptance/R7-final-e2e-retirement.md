# R7 Final Product E2E and Prototype Retirement Acceptance

## Current status

`Product E2E Verified` on 2026-08-15.

## Selected environment

- Product URL: `http://127.0.0.1:3080/` after the supported provider candidate is promoted.
- Harness: exact latest published `@deepseek-ai/dsh@0.1.0-rc.6`.
- Better Sidebar selected provider: exact `0.12.1`, promoted after the isolated compatibility and browser gates passed.
- No newer Harness npm release currently exists; the evidence must say so explicitly.

## Acceptance sequence

1. Verify the clean runtime and Bundle install. Confirm native Plugins and PAIMind Extension Center remain separate technical/product surfaces.
2. Create a new empty Workspace and blank Session.
3. Select a native Agent Preset from Agent Center, attach a native Skill through Skill Market and complete a real Skill turn.
4. Generate new PPTX, PDF, formula XLSX, HTML and Bento files through real Agent Tool calls.
5. Observe real native Jobs through the independent Task Monitor and open every output from the conversation entry into the correct Viewer.
6. Open PPTX Trace and verify exact source/lineage correlation.
7. Verify trusted Artifact notifications and exact deep links.
8. Create a native one-shot Schedule; verify the same-Session follow-up and Notification. Confirm no independent Scheduled Session is claimed in Schedule v1.
9. Switch to Read Only, verify a failed generation produces no false Artifact, then restore Workspace Write.
10. Refresh and restart Harness; verify each object recovers according to its canonical native persistence boundary.
11. Exercise controlled failure isolation and restore the formal Bundle.
12. Verify the prototype retirement ledger, no runtime dependency, stopped `4187` listener and untouched frozen source. The user-owned stale browser tab may remain visible, but its URL is unreachable and is no longer a runtime entry.
13. Re-run full automated/build/composition/upstream-delta gates.

## Evidence required before completion

- Provider candidate metadata and contract comparison.
- Full clean-runtime composition output on the promoted provider.
- Five-format structural evidence and browser screenshots.
- Task/Deliverable/Viewer/Trace/Notification/Schedule/Permission/refresh/restart evidence from one clean Session.
- Controlled failure-isolation evidence.
- Complete prototype retirement ledger, exact base commit and truthful current
  worktree disclosure; retirement never requires resetting user edits.
- Port/process and browser-tab retirement checks.
- Final full test/build/framework output and zero Harness upstream delta.

## Non-substitutable boundaries

- Existing FP screenshots remain regression context but do not replace the new clean R7 journey.
- Fixture queries, pre-positioned target files and prototype mock data do not satisfy R7.
- Better Sidebar internal API imports, a second Job/Schedule/Agent/Skill store or an independent Schedule Session claim fail the gate.
- A nonexistent newer Harness release is recorded as unavailable; it is never represented as an executed upgrade.

## Executed product journey

The final run started in a new native Workspace at
`codex-output/qa/r7-final-e2e` and a blank Session
`session-5b110dc5-86d6-4734-8c7b-a5af506bd6e2`. It used native Agent Preset
`paimind` and native Workspace Skill `r7-native-product-e2e`; the Skill turn was
observed through native Context Injection before any target file existed.

| Product branch | Canonical execution evidence | User-visible evidence | Result |
|---|---|---|---|
| Runtime state | Native reasoning, Tool and stream events | Active Orb followed by the original static Harness icon after completion | Passed |
| PPTX | Native Job and structured Tool Result produced `artifacts/r7-product-reality.pptx`; revision 2 replaced the same path | Conversation Deliverable opened the Office viewer; revision 2 displayed `更新验证`; Trace showed three pages and Validate → Render → Publish lineage | Passed |
| PDF | The first CJK attempt failed because the selected PDF dependency could not encode one Chinese character; the failed Job emitted no Artifact. The Agent retried with supported text and produced `artifacts/r7-runtime-report.pdf` | Conversation entry opened the local PDF.js channel and rendered one real page | Passed with the documented CJK generator limitation |
| XLSX | Native Job produced `artifacts/r7-metrics.xlsx`; worksheet cells `D2` and `D3` contain `SUM(B2:C2)` and `SUM(B3:C3)` | Conversation entry opened the Office spreadsheet viewer | Passed |
| HTML | Native Job produced self-contained `artifacts/r7-extension-center.html` with no external resource | Safe sandbox viewer rendered all seven Extension Center product categories | Passed |
| Bento | Native Job produced `artifacts/r7-bento-product.html` with `previewKind=bento-deck` | The structured Artifact entry opened the independent PAIMind Bento renderer. A generic path intentionally continues to use the provider's safe HTML viewer because PAIMind never infers semantics from filename or body text | Passed |
| Task Monitor | Six real native Jobs were consumed through the independent header button, including running/completed/failed states | The button and Drawer remained outside Better Sidebar | Passed |
| Notification | Trusted Artifact success/failure and Schedule events | Exact safe Artifact deep link opened the correlated Side Card | Passed |
| Schedule | Native `schedule_create` created `schedule-1`; the due event returned through the same Session and emitted a Notification | Scheduled follow-up appeared in the conversation | Passed within native Schedule v1 boundaries |
| Permission | Native Read Only denied `artifacts/r7-readonly-denied.html` | Failed Job was visible; no file, Artifact or usable Deliverable existed | Passed |
| Recovery | Browser refresh and Harness restart restored native Session, files, Artifact Projection, revision 2 Viewer, Trace, notifications and schedule fold | Product reopened at the same URL; process-local Task history correctly returned to zero | Passed |
| Isolation | Developer Resources was disabled by a temporary out-of-tree profile overlay | Extension Center retained the remaining exact categories and native conversation returned `ISOLATION-OK`; the formal Bundle was then restored | Passed |

## Browser evidence

Evidence is stored outside the source repository under `codex-output/qa/`.
The persisted final Session keeps the complete real prompt/Tool/Job/Artifact/
Schedule/permission history available at the product URL. Durable final captures
are:

- `R7-final-office-plugin-registry.jpg` — native Registry shows the external
  Office viewer and PAIMind Office generator mounted and enabled;
- `R7-final-office-viewer-after-bundle-fix.jpg` — the conversation Artifact
  entry opens revision 2 as a real three-page PPTX Viewer;
- `R7-final-xlsx-viewer-after-bundle-fix.jpg` — the same conversation opens the
  real XLSX in the Univer spreadsheet Viewer;
- `R7-extension-center-seven-categories-0121.png`,
  `R7-sidebar-0121-plugin-registry.png` and
  `R7-sidebar-0121-adapter-surfaces.png` — provider upgrade classification and
  adapter surfaces.

Earlier package and R3 screenshots remain regression evidence only. They are
not substituted for the persisted R7 Session or the final browser DOM checks.

## Honest retained limitations

- Harness Schedule v1 is an online same-Session capability. It has no Cron,
  immediate run, independent Scheduled Session, cold wake or durable run-history
  surface. PAIMind does not fabricate them.
- Native Job history is process-local in the selected Harness release. Restart
  recovery is therefore verified for the durable Session/Artifact/File surfaces,
  while Task Monitor truthfully restarts at zero.
- The selected PDF generator dependency cannot encode all CJK text. The failure
  path is safe and visible; full CJK font embedding remains future generator work.
- `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0` declares an old
  Better Sidebar peer range (`^0.6.0`). The selected exact `0.12.1` combination
  passed build, composition and browser PPTX/XLSX gates, but the metadata mismatch
  remains recorded rather than hidden.

## Final gate result

The original post-browser frozen-lockfile install and the later completion
re-audit both passed. The current gate is `64` test files / `194` tests plus full
test/type/build/framework verification, exact install/boot/remove/restore composition,
provider-order and provider-isolation checks, prototype
dependency scan, port checks and Harness/prototype source-integrity checks all
passed. Detailed outputs and retirement facts are in
[`../checkpoints/R7-final-e2e-retirement.md`](../checkpoints/R7-final-e2e-retirement.md)
and [`../migration/prototype-retirement-ledger.md`](../migration/prototype-retirement-ledger.md).

The current prototype worktree contains seven retained tracked modifications.
They are preserved rather than reset and do not weaken the operational
retirement proof: port `4187` is unreachable and no selected Bundle, manifest,
route or runtime configuration depends on the prototype.
