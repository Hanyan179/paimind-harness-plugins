# Residual product branches — 2026-09-07

The user authorized consolidating and removing the remaining plugin-fix and
proposal-demo branches. Both branches' existing code commits were already
ancestors of `main` at `3607f98`; neither contained additional runtime changes.

## Incorporated documents

Commit `a654487` preserves the four outstanding documents from the plugin-fix
worktree. Root developer rules now point to the
[Agent/Skill contract](../integration/agent-skill-harness-contract.md) and
[Workspace Blueprint contract](../integration/workspace-blueprint-harness-contract.md).
The existing boundary bullets remain intact; the Skill union statement explicitly
accounts for the additional Blueprint workspace scope. Stale `cordis` authoring
text is aligned with the existing `standard` implementation and structured drafts.

The [enterprise architecture plan](../plans/enterprise-haas-hybrid-refactor-plan.md)
is archived with a dated notice: its status and next-day plan describe the original
2026-09-03 snapshot. Archiving this document does not merge or activate enterprise
code and does not establish current enterprise acceptance.

## Preserved proposal materials

The proposal-demo worktree has 47 untracked materials: a proposal brief, synthetic
frozen data, analysis/fact/output chains, presentation files, screenshots and
videos. They remain at their original paths under:

`/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins-proposal-demo`

The active intake brief remains marked incomplete; its synthetic data must not be
presented as customer or market facts. These local artifacts are not added to the
source repository or package exports. Removing the redundant branch reference
keeps the worktree at the same commit and does not delete its files.

## Verification scope

Document links and preservation of the original root rules were checked. The
integration changes documentation only; package sources, dependency manifests,
lockfile and runtime configuration are unchanged. A local receipt records original
documents, source commits and SHA-256 hashes for every proposal material:

`/Users/hansen/.codex/visualizations/2026/09/07/01a079c7-204f-7d50-8b82-a65499caeda5/residual-branches/receipt.json`

The 684-test runtime validation belongs to the preceding `3607f98` integration;
it was not rerun for this documentation consolidation. No remote push, enterprise
source change or worktree deletion is part of this operation.
