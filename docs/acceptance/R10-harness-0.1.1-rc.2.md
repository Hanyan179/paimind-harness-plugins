# R10 Harness 0.1.1-rc.2 Upgrade, Redundancy and E2E Acceptance

## Current status

`Local Development Verified; Browser Pre-Acceptance Passed with Upstream Warning`
on 2026-08-27. The selected runtime and providers are promoted for local
development and the shared `127.0.0.1:3080` profile is running. Final Product
Acceptance remains pending because provider/upstream browser code emits live
console errors and the destructive Skill lifecycle plus a new model-generated
editable PPTX were not repeated against the shared user profile.

## Selected matrix

- Harness runtime: exact `@deepseek-ai/dsh@0.1.1-rc.2`.
- Official upstream reference: commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, tag `dsh-v0.1.1-rc.2`.
- Better Sidebar: exact `dsh-better-sidebar@0.16.1`.
- Office Viewer: exact
  `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.2`.
- Command runtime: Homebrew Node.js `24.20.0`; the existing Node.js 25 install
  remains untouched.

## Passed

| Gate | Evidence | Result |
|---|---|---|
| Upstream update | Official checkout fast-forwarded from `141eb6f` to `b150a55`; tracked files match the official tag and the pre-existing untracked `ppt-output/` remains | Passed |
| Upstream runtime | Node.js 24 frozen install, Type Check, Production Build, version check and `--no-open` smoke boot with HTTP 200 | Passed |
| Repository scope | All 37 PAIMind packages checked: 30 runtime plugins and 7 support packages | Passed |
| Dependency promotion | Harness family pinned to rc.2; Better Sidebar 0.16.1; Office Viewer 0.1.2; planned test/tool dependencies promoted; React retained at 18 | Passed |
| Functional gate | Package compliance, Type Check, 85 test files / 393 tests, Production Build, Bundle Budget, API snapshot, 37 Tarballs, strict publint, 110 NodeNext exports, examples, framework and documentation | Passed |
| Release composition | Disposable rc.2 profile completed install, boot, remove and restore for the full bundle and providers; independent Visual Experience and all required missing-dependency probes passed | Passed |
| Proposal contract | Bento remains the default final deliverable; `generate_pptx_from_outline` is available only after an explicit editable-PPTX request | Passed |
| Artifact contract | Exact current Session, producer, suffix, hash and workspace-boundary validation is covered for the editable PPTX tool | Passed |
| Browser product surfaces | Agent Center edit/test state, Skill review, Notification Center, Task Monitor, Platform Scheduler, Extension Center and Developer Resources all rendered from the live rc.2 runtime | Passed |
| Artifact viewers | Current runtime opened HTML, PPTX, XLSX and PDF through registered viewers; Bento restored its structured Artifact route into the isolated Preview/Edit/Trace workbench instead of the provider's generic HTML viewer | Passed |
| Responsive/theme | Desktop, 390 × 844 narrow viewport, Light and Dark modes rendered without a new PAIMind-owned console error | Passed |
| Upstream sentinel | Verification left upstream tracked files unchanged; only `ppt-output/` remains untracked | Passed |

The test count increased from 387 to 393 after the live browser audit exposed
cross-Session Notification Artifact routing, in-app/Host fallback, stale target
disclosure, the rc.2 Session Projection wire-contract regression and Bento mode
cross-talk, plus Preview's hidden dependency on the Trace slide outline.

## Fixed defects and redundancy

- Updated the Better Sidebar adapter's reported provider version from stale
  `0.14.0` to `0.16.1`, and added a compliance gate that must match the active
  compatibility matrix.
- Fixed Notification Center cross-Session Artifact routing. It now waits for
  the exact target Session, opens through the registered in-app viewer, falls
  back to the Host only when no viewer is available, and reports a stale target
  instead of failing silently.
- Removed the eight identified unused members and enabled
  `noUnusedLocals`/`noUnusedParameters`.
- Consolidated Artifact/session/path validation, platform API schemas and
  extension technical-state projection into their owning shared packages.
- Split Agent Market authoring-session state from the large client entry while
  preserving package IDs, services and public entry points.
- Fixed the TypeScript 7 build launcher to resolve `typescript/package.json`
  rather than the removed private `typescript/bin/tsc` export.
- Fixed the release-composition script so an explicit upstream Harness checkout
  cannot silently fall back to the older persistent local runtime.
- Migrated the PAIMind Artifact Session Projection registration from the old
  `schema`/`view` shape to Harness rc.2's `stateSchema` plus
  `wire.viewSchema`/`wire.view` contract. Existing cached projection state is
  preserved, while the client again receives `paimind.artifacts/v1` and routes
  `previewKind=bento-deck` into the isolated Bento workbench. Browser read-back
  verified six slide thumbnails, Preview/Edit/Trace, Business Trace and
  Technical Trace against the existing Dollar General Artifact without
  regenerating it.
- Made Bento Edit and Trace mutually exclusive while retaining the selected
  object as their only shared state. Edit now selects immediately without
  `trace-pending` or `Tracing evidence…`; Trace keeps its evidence-resolution
  feedback, and switching to Edit cancels that pending feedback. A read-only
  renderer compatibility guard applies the contract to already-generated Bento
  files without rewriting those Artifacts.
- Made Preview a clean slideshow player with Previous, position and Next
  controls. It hides the thumbnail rail and selection/trace state, while Edit
  and Trace retain the workbench rail. The Bento document now publishes its own
  `paimind:bento-manifest`, so Preview no longer depends on activating the Trace
  inspector; the read-only legacy guard publishes the same manifest for existing
  traceable Bento files.

## Failed

No PAIMind-owned test, Type Check, Build, package, composition or browser surface
is currently failing.

## Blocked

- Final Product Acceptance is blocked on a clean provider/upstream browser console.
  Better Sidebar 0.16.1 repeatedly connects and then receives a status-less
  close from `/sidebar/ws/agent-terminals`; it eventually logs
  `agent-terminals connection failed; stopping reconnect loop`. One run also
  logged the equivalent `agent-opens` warning. The endpoints accept a WebSocket
  connection, so this is retained as an upstream lifecycle/close-handling issue;
  PAIMind does not patch provider source.
- Office Viewer 0.1.2 logged a negative-column-width layout error when the XLSX
  sample opened, and the official Harness client logged a React `removeChild`
  cleanup error when leaving the workbook tab. The workbook rendered and the
  application remained usable, but these errors prevent a clean-console claim.
- The shared browser profile was not mutated to repeat Skill install/update/
  uninstall, and no new model-backed editable PPTX was generated. Disposable
  profile lifecycle and deterministic PPTX validation passed, but these two
  shared-profile actions remain for the user's Product Acceptance session.
- Legacy R7 PDF/XLSX notification records refer to Artifacts that are no longer
  present in the current rc.2 Artifact projection. Their files still open in
  the live registered viewers; stale notification targets now surface an error
  instead of silently retaining the prior tab.

## Accepted redundancy

- `@paimind/renderer-pdf` keeps its PDF.js runtime/worker payload and a 2.3 MB
  package-specific budget; the measured client bundle remains within budget.
- Proposal Experience keeps the three curated Storyboard assets because they
  are standalone install-time product assets.
- Five independently installable client bundles keep their own Zod copy. No
  single bundle contains multiple Zod versions, so extracting a shared runtime
  would create deployment coupling without reducing duplicate code inside one
  package.
- Small style installers and simple local command parsers remain local where a
  shared dependency would cost more lifecycle coupling than it removes.

## Retained upstream warnings

- Office Viewer 0.1.2 declares stale optional peer ranges for
  `@deepseek-ai/dsh-client-runtime` and `dsh-better-sidebar`; the exact selected
  combination passed real composition and browser rendering.
- Published `@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2` references a
  missing `lib/index.js.map`. It is a non-fatal packaging warning.
- Better Sidebar's agent-terminal and agent-open WebSocket close handling is the
  browser-console blocker described above.
- Office Viewer workbook sizing and official Harness tab-unmount cleanup emitted
  the additional browser errors described above.

## Shared local runtime

The user-test environment runs with the official rc.2 CLI, persistent
`DSH_HOME=.dsh-home`, profile `web`, Node.js 24 and `--no-open` at
`http://127.0.0.1:3080/`. This is local evidence only; it is not a production or
shared-environment release claim.
