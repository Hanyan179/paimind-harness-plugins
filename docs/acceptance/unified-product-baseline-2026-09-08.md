# Unified local product baseline

Date: 2026-09-08.

## Baseline

- Canonical branch: `codex/unified-product-baseline`.
- Canonical checkout: `/Users/hansen/Documents/PAIMind-workspace/paimind-harness-plugins`.
- Parents preserved: `f1773c9` (configurable branding and product updates) and `ceefd35` (current runtime UI, MCP and proposal changes).
- Both starting directories were detached and dirty. Each received a recovery branch/commit before merging.
- Historical worktrees remain for recovery. Enterprise-only branches are outside this merge.
- The pre-existing untracked `docs/demos/` assets remain local and untouched.

## Integration decisions

Package identities and newly added packages use `@hansen/*` and `hansenBuild`; persisted entity identifiers remain stable. Retained configurable brand settings, current UI/connection features, model-services naming, proposal theme fixes, full-screen/thumbnails and runtime error handling. The API snapshot was regenerated after the integrated build.

## Verification

- Package compliance: 42 packages.
- Typecheck and build passed; all 703 tests in 127 files passed.
- Client bundle budgets, API snapshot, pack audits, publint, 138 NodeNext exports, examples, framework and documentation gates passed.
- Real isolated Harness composition passed full install/boot/remove/restore and feature-isolation probes; zero upstream worktree delta.
- First test attempt identified missing newly introduced build output and two empty, untracked legacy template directories. Built the output and moved the empty directories to `.tmp/unified-baseline-empty-template-dirs`; rerun passed.
- Chrome on the restarted port 3080: existing workspace/session history loaded; Model services contains auto-naming and the configured model; Branding shows editable name and logo upload fields; Connection Center retains its existing three connections and assistant references.
- Browser verification was read-only: no model generation, brand-data changes or external connection test was issued.
- In-app browser verification stalled and its automation connection timed out; Chrome completed the checks. The existing upstream missing source-map warning remains non-fatal.

## Runtime

Port 3080 now runs from the canonical checkout and loads package links from it. Existing `.dsh-home` is retained. Local profile package names/links and the existing MCP server executable path were updated; configuration backups are under `.tmp/unified-runtime-config-backup-20260908`. No remote push or production publication.

Detailed local logs: `/tmp/hansen-unified-check.log`, `/tmp/hansen-unified-build.log`, `/tmp/hansen-unified-remaining.log`, `/tmp/hansen-unified-final-gates.log`, `/tmp/hansen-unified-composition.log`, `/tmp/hansen-unified-runtime.log`.
