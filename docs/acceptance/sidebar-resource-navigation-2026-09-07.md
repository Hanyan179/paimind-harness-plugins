# Compact sidebar navigation acceptance — 2026-09-07

Implemented the approved [navigation design](../plans/sidebar-resource-navigation.md)
in the existing full product composition at `http://127.0.0.1:3080/`.

## Result

- Default: Agent, Library, and one Notifications/Settings utility row. One optional
  pinned resource adds a fourth row. The final preview pins Skills.
- Library groups live source contributions, searches labels/descriptions, opens
  their existing pages, and supports replacing/removing the optional shortcut.
- Connection and template icons are distinct native Harness icons. Source
  contributions retain ownership of metadata, actions and page state.
- The original data home and complete linked plugin profile were reused. The
  stopped host was restored; no empty data home, domain migration or upstream
  source edit was introduced.

## Verified

- 10 targeted test files / 154 tests passed, including seven new navigation tests.
  The full targeted set was rerun after the final interaction fix.
- TypeScript project checking and declaration/production build passed.
- Package compliance, bundle budgets, reviewed API baseline, pack audit, strict
  publint, external NodeNext consumers, examples, framework and documentation
  checks passed. API review covers six changed client/runtime packages and two
  additive internal declaration references; manifest/export paths are unchanged.
- Selected Harness composition passed full install/boot/remove/restore, isolated
  Visual Experience and independent feature probes, cleanup and zero upstream
  worktree delta.
- Library open/search/pinning/Escape preserve the current Skill/Agent Center.
  Selecting a resource activates the original source control and switches pages.
- Live browser: Agent, Skill, connection and template navigation; notification
  history; native Settings; search; pin replacement; persistence after reload;
  Escape dismissal/focus return. Original session history remained visible.
- At 900 × 640 the collapsed-sidebar popover fits inside the viewport. At
  900 × 480 it is clamped to y=12, height=380, scrolls its 517px content and keeps
  template navigation reachable. The original 1629 × 1225 viewport was restored.
- Final expanded footer with Skills pinned measures 156px high. Before the change
  the six visible entries occupied approximately 260px.
- Automated negative/lifecycle coverage: unknown future source discovery;
  source removal; duplicate-id rejection; actual source availability independent
  of shortcuts; original controls/settings restoration on unmount; visible focus
  restoration after a proxied product surface closes.

## Evidence and limits

Machine-readable evidence: [navigation receipt](evidence/sidebar-resource-navigation-2026-09-07.json).
Screenshots and command logs remain outside Git in the local artifact directory
recorded there. Before, compact, library, narrow and final screenshots were
visually inspected. No live unread notification was available (0 unread, 46
historical); the original notification badge/control implementation is retained.

The full repository suite was not rerun; this is navigation acceptance rather
than a new claim that unrelated business workflows or production release passed.
The upstream UI package reports a missing source-map warning during tests.
No commit, push or release was made.

## Settings layout regression and correction

The user subsequently exposed a missed visual regression: native Settings mounts
its dialog inside the footer Settings container. The compact rule selected every
descendant button, forcing navigation tabs and form actions to 36px wide. The
earlier Settings check proved opening only; it did not establish correct dialog
layout.

The rule now selects only the button directly containing the native
`settings.trigger` slot. The accepted resource navigation remains in place.
A regression test models the nested dialog: it failed before the fix (36px
instead of 180px) and passes afterward, including exact source-control restoration
on unmount. Four targeted files / 45 tests and production declaration/build pass.
The selected real Harness composition and package gates were rerun for this fix.

Live browser verification covered General Settings and Extension Center inside
the native dialog, plus a 900 × 640 viewport. General Settings tabs are 164px,
Open configuration is 94px, and the language control is 82px; the footer Settings
trigger alone remains 36px. Screenshots were inspected after resize settled. The
original 1629 × 1225 viewport was restored, leaving General Settings open. No
setting value, model, permission, account or domain data was changed.

Evidence is under the original artifact directory's `settings-layout-fix/`
subdirectory, with before/after images, failing/passing test logs, build,
composition, package gates and the reviewed two-package implementation hashes.
