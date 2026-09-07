# Mainline MCP and UI integration — 2026-09-07

Integration of feature commit `70043f1` with the existing mainline `8c76d76`.
The reusable MCP Center, isolated Feishu adapter, complete writing Skill resources,
Agent connection references, Skill catalog union, named task resources and compact
navigation remain in place. Existing mainline UI foundations, readable catalog
names, nested-dialog keyboard handling and Agent test transcripts are preserved.

## Conflict review

- Skill Center uses the installed/catalog union with independent source failures,
  while retaining mainline display names, shared keyboard handling and responsive
  dialog focus management.
- Agent selection panels retain parallel Skill/connection styling and mainline
  authoring/test-history behavior. Task summary retains resolved names and distinct
  configured/loaded/used resource states.
- Compact navigation keeps the Settings width rule restricted to the native
  trigger. Newly introduced dynamic styles receive the mainline HMR ownership tag.
- The API baseline updates only 20 reviewed fields: implementation hashes, additive
  MCP/navigation/reference declarations, the new native-MCP export, and CSS literal
  declarations. No existing export path is removed. The PDF implementation hash
  reflects portable raw-resource module labels from the reviewed build change.
- Original imported Skill resource whitespace is retained for source fidelity.

## Verification

126 test files / 684 tests, type checking, declaration/production build, package
compliance, bundle budgets, reviewed API snapshot, tarball audit, strict publint,
external NodeNext consumers, examples, framework and documentation gates passed.
The upstream primitives package emits a missing source-map warning during tests.

Selected real Harness composition passed install/boot/remove/restore, optional
source isolation, cleanup and zero upstream worktree delta. The original full
3080 profile was restarted with the integrated packages and existing data home.
Browser checks verified history, the 15/12/4 Skill counts, library navigation,
4 Feishu tools discovered by a non-writing connection test, retained writer
bindings, and normal Settings layout. At 720 × 800, Escape closes Skill details
without closing Skill Center. The viewport override was reset.

Screenshots and logs remain outside Git. See the
[merge evidence](evidence/mainline-mcp-merge-2026-09-07.json) for paths and scope.
This is local merge validation; no new business document write, remote push,
enterprise consolidation or worktree deletion was performed.
