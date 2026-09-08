# PAIMind Harness Plugin Framework

## Document responsibility

This document owns architecture boundaries, domain ownership and composition
decisions. The normative package checklist lives only in
[`../standards/plugin-authoring.md`](../standards/plugin-authoring.md), selected
versions live only in [`../compatibility/matrix.md`](../compatibility/matrix.md),
and package identities/roles live only in
[`../standards/package-roles.json`](../standards/package-roles.json). Historical
status and evidence remain in the migration ledger.

## Decision

DeepSeek Harness is the only runtime. PAIMind is an out-of-tree product plugin suite loaded through a Harness Profile and Bundle; no PAIMind package patches or vendors Harness source.

The frozen PAIMind frontend remains a specification and visual reference. Its reducers, synthetic repositories, local mock transport, browser storage, and demo identities are not migrated as a second backend.

Independent Plugin does not mean Independent Domain Model. Harness Workspace, Session, Agent Preset, Tool, Skill, Job and Deliverable identities and lifecycles remain canonical. `@hansen/platform-scheduler` owns platform task definitions and durable Runs for registered actions and is the only Scheduler selected by the formal Bundle. The old native Session-reminder packages are intentionally not loaded in the PAIMind product profile.

## Composition

1. A Harness `web` profile composes `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`.
2. `@hansen/harness-bundle` is installed as a later profile layer.
3. The bundle patch inserts an always-on Extension Center control plane, one
   always-on package-invariant governance group, and six product-facing
   `cordis:group` Feature Packs. Switchable groups contain Runtime packages only;
   one-shot invariant registrations stay outside them so repeated stop/restore
   cycles do not duplicate governance state.
4. Packages declaring `dsh.client` are discovered by Harness and served through its native client module graph.
5. Product plugins contribute through additive Cordis services and browser slots. They do not replace `root`, `sidebar`, or `conversation`.

The native `details` slot is already occupied by Harness Tool Details. The external `dsh-better-sidebar` Cordis plugin remains a replaceable preview/Side Card provider for capabilities it already supplies. PAIMind never patches either Harness or Better Sidebar source. Task Monitor is deliberately outside that rail and contributes its own Session-header action.

## Package boundaries

- `@hansen/harness-bundle`: ordered installation layer only.
- `@hansen/harness-compat`: the only package allowed to encode version-sensitive Harness snapshot, slot, event, and service interfaces.
- `@hansen/contracts`: stable PAIMind domain references and migration identifiers.
- `@hansen/testkit`: plugin registration/disposal fixtures and later real-composition helpers.
- `@hansen/extension-center`: always-on Product Feature Pack control plane and
  Settings contribution. It owns the six-pack product catalog, persists explicit
  enablement overrides in canonical Harness Settings, and calls the public Cordis
  Loader Entry update seam for real group lifecycle changes. It does not install,
  remove, upgrade, version, or execute features and never becomes a workflow launcher.
- `@hansen/branding`: independently installable Paramont Harness identity. It contributes an App-shell descriptor, replaces only the native brand artwork through a reversible `shell.overlay` portal, and owns the document product suffix, favicon and installable-app manifest. It does not own Theme, Sidebar layout, navigation or Session state.
- `@hansen/developer-resources`: read-only native Plugin Inventory diagnostics, current `paimind.extension` Surface Catalog and bundled integration-contract reference. Extension Center remains the sole child-slot owner; Developer Resources declares no Loader control, version/dependency truth or second technical registry.
- `@hansen/workspace-project`: headless read-only `Project = Workspace` projection; its prior native-header action is reopened for retirement and it owns no Project persistence or navigation tree.
- `@hansen/workspace-blueprints`: versioned Workspace composition-package catalog, user repository and safe materializer. Folder contents are primary; one Agent reference and multiple Business Skill references are optional, explicit author bindings rather than recommendations. Its Host-owned on-demand composition projection reads source services once for the authoring UI without caching or copying Agent/Skill state; source absence never blocks a folder-only package. It writes only into an already registered empty native Workspace and persists a source-owned composition receipt. Skill Market resolves Business Skill references as Workspace Scope; adoption delegates the receipt-validated entry-Session binding to Agent Builder. The package never owns Workspace, Session, Agent, Skill Registry or Tool execution.
- `@hansen/better-sidebar-adapter`: the only package allowed to encode or call the Better Sidebar service; it exposes stable Preview/Side Card and file-capability contracts to viewer/trace packages. It has no Task Monitor responsibility.
- `@hansen/task-monitor`: the higher-priority implementation of the native `job-list` Session-header slot. Its responsive Popover/Bottom Sheet derives Session, Project, Goal, Todo, Plan, Workflow/Subagent, Tool Call, all native Jobs, Artifact, Deliverable, invoked Skill and evidenced MCP facts. It has no lifecycle store, Preview Source or Better Sidebar dependency; removing it restores the native Job button.
- `@hansen/artifacts`: observable association over native Harness Turn deliverables and product artifact sources; it owns no fixed overview tab or file bytes and routes exact Workspace-contained PDF/PPTX/HTML/XLSX paths through explicit viewer/service allowlists.
- `@hansen/conversation-artifact-renderer`: removable turn-tail projection over native producer-declared Deliverables. It replaces the official compact file pills with format-aware cards for Markdown, JSON, HTML, Bento, PPTX, PDF, spreadsheet, Word, image and generic files. Exact Bento Artifacts open through the owner-provided Artifact service; all other files retain the native `openFile` route. Bento and provenance labels require an exact current-Session Artifact and are never inferred from a filename or model prose; removal restores the official row.
- `@hansen/renderer-pdf`: removable local PDF.js renderer registered only through the stable file-viewer adapter. It corrects the selected Chromium surface where the provider's browser-native Blob iframe was blank, and falls back to the provider viewer when absent.
- `@hansen/renderer-bento`: the narrow product-specific renderer exception. It owns a random loopback-only origin, token-bound Session path confinement, restrictive CSP and one hidden on-demand workbench tab with dynamic Artifact title; it neither patches the provider HTML viewer nor exposes Harness APIs to the Bento runtime.
- `@hansen/agent-market`: independent Agent Center catalog and governance surface over Harness `agentPreset.list` and blank-Session `agentPreset.select`. It stores only product metadata keyed by native Preset id and owns neither Preset documents nor Agent execution.
- `@hansen/notifications`: durable message/read-state sidecar for canonical Harness object references. The Host captures trusted producer identity, stores bounded notification rows in the Harness profile Storage Domain and exposes strict Typert Remote methods. It owns no Job, Schedule, Artifact or Session lifecycle state; its independent bell and Overlay remain usable without Extension Center and are removable without affecting native conversation.
- `@hansen/platform-scheduler`: active RQ-103 Core for time rules, action catalog, durable task definitions, Runs, idempotency, retry, timeout and audit.
- `@hansen/scheduler-adapter-harness`: active Adapter service that creates a new canonical Harness Session and Native Job per Run; all rc-sensitive construction and result parsing stays in `@hansen/harness-compat`.
- `@hansen/scheduler-adapter-http`: active Adapter service for signed HTTPS `202` dispatch and result-Origin allowlist.
- `@hansen/scheduler-adapter-feishu-bot`: active provider Adapter service; production action registration and credentials remain deployment/business-owned.
- `@hansen/platform-api` and `@hansen/platform-sdk`: separately deployable packages for authenticated action registration, callbacks, notifications, validation and signing. They do not expose secrets or business logic to the UI and are not browser-facing Bundle rows.
- Product Feature Packs: the user-facing installation and enablement grain. One
  pack may contain several independently built implementation packages but owns
  one product outcome, one top-level switch, declared dependencies, and one
  end-to-end acceptance boundary.
- Implementation packages: internal Host, Client, Adapter, Renderer, Contract,
  SDK, and Invariant modules. They remain separately testable and removable for
  engineering isolation, but are not presented as dozens of peer products.
- Package Invariants are composition-time governance and remain in one always-on
  group. A Product Feature Pack switch controls runtime behavior, not whether the
  already-validated package identity is registered for diagnostics.

### Extension Center boundary

- Harness Plugin Registry owns installation, removal, versions, technical Entry
  identity, Fiber phase, and failure facts. Cordis Loader remains the sole runtime
  lifecycle owner.
- Extension Center owns PAIMind product composition, classification, dependency
  policy, and requested enablement. It stores no second runtime registry.
- The two surfaces coexist: Harness Settings → Plugins is the technical inventory; Extension Center is PAIMind capability management.
- Product enable/disable calls the verified public Cordis Loader `EntryTree.update`
  seam through `@hansen/harness-compat`; the read-only Plugin Inventory remains
  the diagnostic source. A failed Loader or Settings write is reported and rolled
  back instead of being presented as success.
- Extension Center is outside every managed group, so disabling a Feature Pack
  cannot remove the control surface required to restore it.
- A successful switch persists first-class product intent in Harness Settings and
  reloads the browser application after Host Loader convergence. This is required
  because the Harness static Client module manifest is selected at page boot;
  the reload removes or restores browser contributions without restarting the
  Harness Host process.
- Extension Center never navigates into feature workflows. Task Monitor remains an independent button; Agent Center remains a Preset catalog; Bento remains a renderer channel.

### Product classification decision

- Harness Plugin Registry is the technical Loader and Registry only. It is not the PAIMind product catalog and PAIMind does not place every capability into that native product surface.
- PAIMind Extension Center presents six top-level Product Feature Packs:
  `Product Experience`, `Agent Center`, `Content & Deliverables`,
  `Proposal & Presentation`, `Automation`, and `Work Operations`.
- Immutable per-package descriptors remain available only as technical module
  detail and diagnostics; they are no longer the primary product navigation grain.
- The former PAIMind Launcher is retired. Extension Center is a capability-management page, not a navigation launcher or a second plugin runtime.
- Agent Center is the catalog, market, classification and governance layer over the same Harness Agent Preset ids. Personal Agent Builder creates or modifies those Presets and never creates a second Agent runtime or configuration store.
- Bento remains a PAIMind-owned independent Renderer Plugin and reaches the host only through stable Preview/Side Card adapter contracts.
- Task Monitor is manageable as an Automation capability in Extension Center, while its live entry remains an independent Session action and never becomes a Better Sidebar tab.

### Developer Resources truth boundary

- Live Diagnostics reads only the current native `pluginInventory.list()` fields: `entryId`, `moduleName`, `enabled` and `fiberPhase`.
- Surface Catalog reads current immutable `paimind.extension` contributions but never redeclares that child slot. If Extension Center is absent, it returns an honest empty catalog rather than a second registry.
- Integration Reference is compiled with the package and every row is labeled as bundled reference. It is not runtime discovery and carries no guessed version, dependency, health or error detail.
- The frozen prototype Component Library's synthetic previews and state simulator are retired. Real Feature Package browser/Product E2E evidence is the component-runtime proof.
- No technical lifecycle mutation is available through Developer Resources; native Settings → Plugins and profile tooling remain authoritative.

### Agent product-layer boundary

- Harness Agent Preset is the one execution configuration and persisted session binding.
- PAIMind Agent Center may add directory, market, category, favorite and governance metadata keyed by Preset id.
- Personal Agent Builder creates or modifies the Harness Preset through its public authoring seams; no PAIMind Agent runtime or duplicate configuration document is created.

### Bento renderer boundary

- `@hansen/renderer-bento` remains an independent PAIMind Renderer Plugin.
- It registers only through the stable PAIMind Preview/Side Card adapter contracts.
- Its core package must not import Better Sidebar or depend on provider DOM, Store, reducers or internal types; all provider-version knowledge stays in `@hansen/better-sidebar-adapter`.

### Product truth plane

- Generator Providers register Harness Tool/Skill capabilities and start native Harness Jobs.
- Current Harness has no public custom Session-event registration seam. A generator therefore publishes one versioned `ArtifactProducedEnvelopeV1` and, when applicable, one correlated `ArtifactTraceEnvelopeV1` through the same native `tool/result.meta`; one public Session Projection folds those durable facts and always references the native Job id.
- Successful results expose the same verified path through native Tool presentation `locations`, so Harness owns the Conversation Deliverable. Failed envelopes expose no location and cannot create a false clickable artifact.
- Conversation Deliverables, Task Monitor, Artifact Preview and Presentation Trace consume the same Job plus Session Projection chain. Notification Center is deliberately outside that automatic event chain.
- Notification Center is a passive message/read-state sidecar. A business application or platform module must explicitly call a Host-registered producer or the authenticated Platform API; Tool, Job, Session, Schedule and Artifact events do not publish automatically. Producer identity is assigned Host-side rather than accepted from Agent or Client input.
- Native Job records are process-local in the selected Harness runtime. A page refresh retains them, while a Harness process restart retains the Session Artifact projection and files but not terminal Job history. PAIMind does not build a duplicate durable Job store to hide this limitation.
- `kind` and `previewKind` are explicit producer capabilities. No consumer parses model prose, filenames, file extensions or HTML to invent artifact semantics.
- Technical Viewer verification and Product E2E verification are tracked separately. QA query parameters never satisfy a Product E2E gate.

## Compatibility policy

The active npm runtime and external-provider versions are the exact values in
[`../compatibility/matrix.md`](../compatibility/matrix.md). A local upstream
checkout is only a source-integrity sentinel; it is not treated as provenance
for the selected npm artifact unless its revision is independently established.

Feature code imports structural Harness interfaces from `@hansen/harness-compat`. Real composition runs against the selected npm runtime, while every gate also captures the local Harness checkout status before and after to prove PAIMind made no source change.

An upstream upgrade changes `@hansen/harness-compat` first. The remaining packages must pass the direct-import gate, typecheck, focused tests, client build, real profile composition, and browser acceptance without version-specific edits.

### External provider policy

`dsh-better-sidebar` is an independently released upstream and may change more frequently than PAIMind. It is therefore treated as a replaceable provider, not as copied source or a transitive implementation detail:

1. `@hansen/harness-bundle` pins one exact Better Sidebar version that has passed the compatibility matrix; it never follows `latest`, `^`, or an unverified Git branch.
2. Feature packages depend only on the PAIMind adapter contract. Direct imports from `dsh-better-sidebar` outside `@hansen/better-sidebar-adapter` fail the framework boundary check.
3. Every provider upgrade records the Harness checkout, Harness package version, Better Sidebar version and adapter contract version in the migration ledger.
4. An upgrade must pass package metadata compatibility, register/dispose/open-tab contract tests, production build, isolated real-profile install/remove, desktop/narrow/light/dark browser checks, cross-plugin regression, and Harness zero-upstream-delta verification before the bundle pin moves.
5. Missing, incompatible, or failed Better Sidebar activation hides PAIMind rail tabs and leaves native Harness conversation available. PAIMind does not maintain a second fallback rail.

Historical provider/runtime combinations and their executed evidence remain in
the acceptance reports and migration ledger. The currently selected combination
lives only in the compatibility matrix; any later release remains a Candidate
until it passes the same gate.

The selected Better Sidebar line externalizes PPTX/XLSX viewing. The selected
Office Viewer owns its own technical Harness Bundle row and activates after
`dsh-better-sidebar`; PAIMind does not copy that provider patch. Its stale
declared Better Sidebar peer range remains a recorded metadata risk and must be
retested on either provider upgrade.

### Preview/Side Card provider ownership

- Better Sidebar owns its responsive right/bottom layout, tab lifecycle, file explorer/editor, terminal, Git/browser surfaces, native background-job UI and built-in viewers.
- FP06-FP07 reuse verified Better Sidebar PPTX/XLSX/HTML viewers through `@hansen/better-sidebar-adapter`; PAIMind retains Artifact discovery, Session/Workspace association and safe open contracts.
- The selected Chromium surface rendered the provider's valid PDF as a blank Blob iframe. `@hansen/renderer-pdf` therefore registers a higher-priority local PDF.js channel through the stable adapter contract. Removing it restores the provider viewer without changing Artifact identity or upstream source.
- Bento remains an independent PAIMind Renderer Plugin and registers a new preview channel through the stable adapter. Its core never imports Better Sidebar types, stores, DOM contracts or internal interfaces.
- Task Monitor is not a Side Card tab. Extension Center may describe and manage the capability package, while the live product entry remains an independent Session-header button.

### Authorization boundary

- Harness Permission Presets remain the sole owner of Sandbox mode and one-shot Approval policy. Full Access is a file-effect mode, not a business-administrator role.
- The current Harness anonymous user id is correlation metadata, not an authenticated account. PAIMind therefore composes no default enterprise principal in Goal A.
- No PAIMind authorization runtime is selected. Harness Permission Presets remain canonical; a future product-capability layer requires a real authenticated provider and a separately approved contract.
- Missing provider, missing principal, explicit denial and provider failure all fail closed. PAIMind adds no browser role switcher, local RBAC store or simulated Configuration Studio publication.
- Extension Center keeps the Governance product category, but shows an explicit no-provider state until a real authenticated provider contributes a capability. Technical absence is not relabeled as an Available governance product.

### Feature isolation invariant

- Every Product Feature Pack is an independently switchable Cordis group with a
  stable Loader Entry id. Pack dependencies are explicit: Proposal, Automation,
  and Work Operations require Content & Deliverables.
- Every implementation package keeps its own client/host entry, invariant where
  applicable, focused tests, and disposer. This is an engineering isolation unit,
  not a promise that every package is a separate user-facing product.
- A pack may expose a small number of meaningful nested capability switches. The
  first is `Runtime Orbs` inside Product Experience; internal adapters and
  contracts are not exposed as configuration noise.
- Feature packages consume stable PAIMind services or Harness public projections. They never edit upstream source, reducers, profile source or provider stores. A reversible presentation adapter may locate a native DOM seat only through `@hansen/harness-compat`; failure leaves the native surface visible, and disposal removes every marker and portal.
- Host services flow one way into read-only projections; a PAIMind rendering or source failure collapses only its own tab/surface and cannot block the native conversation.
- Removing a package removes only its registrations. Shared objects such as Workspace, Session, Turn deliverables and Better Sidebar viewers remain owned by their original provider.

## Error containment

- Missing or malformed profile dependencies remain a fail-loud installation error, matching Harness policy.
- A runtime feature component contains its own rendering failures and yields no PAIMind surface, leaving the native Harness conversation available.
- Removing the PAIMind bundle and feature dependencies restores the native Harness composition.
- Every slot registration returns a disposer and every DOM effect removes only its own resources.

## Local verification

```bash
pnpm install
pnpm run check
node scripts/verify-harness-composition.mjs \
  --runtime "/path/to/exact-npm-runtime" \
  --dsh-bin "/path/to/exact-npm-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --provider "/path/to/exact-npm-runtime/node_modules/dsh-better-sidebar" \
  --upstream-checkout "/path/to/deepseek-harness-checkout"
```

When this repository's `.dsh-home/profiles` is present, the runtime, provider
and nearby upstream sentinel are discovered automatically. Expected versions
always default to the machine-readable compatibility matrix; explicit command
options are overrides for isolated candidate verification.

The real-composition script validates the exact provider package and public service markers, creates an isolated temporary `DSH_HOME`, initializes the native Web profile, installs Better Sidebar plus the local PAIMind bundle and every currently migrated feature package, verifies one provider row and every served client manifest, removes them, verifies native restoration, and checks that the Harness Git worktree did not change.


## Personal MCP connection ownership

`@paimind/mcp-center` owns personal connection configuration and owner identity. Agent Builder stores only `connectionIds` beside its existing profile fields; it preserves omitted references for existing callers and updates live scopes after explicit save. The center reads the public Agent-profile service, never the profile repository directly.

`@paimind/harness-compat/native-mcp` mounts the selected native MCP client in each actual Agent context. Native MCP reserves server names application-wide, so each connection/Agent pair receives a stable hashed namespace. Native tools, reconnection and transport disposal remain with Harness; the center keeps only transient handles and a synchronous eligibility guard. There is no generic tool-call management RPC.

`McpConnectionRepository`, `McpOwnerResolver` and `McpRuntimeProjection` separate storage, ownership and execution location for future enterprise implementations. The local owner represents the operating-system account, not tenant authentication. Agent references are capability selection, not a multi-user security boundary.

The Center does not depend on any vendor adapter. Its local `registerTemplate` contract accepts validated stdio/HTTP defaults and returns a source-owned disposer; only listable UI presets are held in memory. Registration is not exposed over Remote, does not save connections, and does not register tools. The bundle may separately load `@paimind/feishu-cli-mcp` as an optional template contributor.

The separate `@paimind/feishu-cli-mcp` adapter fixes an explicit local CLI profile, runs document operations as the user, and returns CLI outcomes through the official MCP SDK. Protocol probes do not invoke business tools. Test evidence is process-local and must not be confused with persisted configuration or durable business acceptance.

See [scope and acceptance](../plans/mcp-center-feishu.md).
