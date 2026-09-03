# PAIMind Product Line plugin roadmap

## Current baseline

- Product Line is the global delivery baseline in `codex/product-latest-20260901`.
- Enterprise Line is paused and does not block Product Line design, implementation, or acceptance.
- Desktop packaging is deferred. The current target remains the real DeepSeek Harness web composition.
- This repository is the single development home for PAIMind features, feature improvements, adapters, shared contracts, compatibility logic, tests, and acceptance evidence.

This is a delivery decision, not a second package-authoring standard. Package shape and lifecycle remain governed by `docs/standards/plugin-authoring.md`; domain ownership remains governed by `docs/architecture/plugin-framework.md`.

## Capability placement

Every new requirement must be placed in exactly one of these forms before implementation:

1. **New product plugin** — a new user-recognizable capability with its own lifecycle, tests, and independently removable contribution.
2. **Existing plugin enhancement** — an improvement that keeps the same domain owner, product surface, state owner, and lifecycle.
3. **Shared support or adapter change** — a contract, SDK, compatibility bridge, design token, or provider adapter with real consumers and no duplicate product state.

A visual change alone does not justify a new plugin. A new plugin is justified by independent ownership, lifecycle, failure isolation, or deliverability.

## Conflict review gate

Before coding, the feature owner records the following six decisions in its Feature Package plan or pull request:

| Dimension | Required decision | Conflict rule |
| --- | --- | --- |
| Product surface | Which Settings section, conversation seat, overlay, preview, or side card owns the entry | One primary owner per entry; extensions contribute through the owner’s public Slot or Service |
| Domain entity | Which business object the feature reads or writes | One canonical owner; projections and adapters do not create shadow records |
| Writable state | Which Settings namespace or persistence service stores changes | One writer per field; other plugins call the owner’s contract |
| Runtime service | Which plugin provides the service and lifecycle | Service identity is unique; hard dependencies use injection, optional integrations use discovery |
| Harness compatibility | Which upstream behavior is version-sensitive | All version-sensitive logic lives in `@paimind/harness-compat` |
| Failure and unload | What remains available if the plugin fails or is removed | A failing feature must not break native Harness or unrelated PAIMind plugins |

The review fails if two packages claim the same primary surface, write the same state independently, duplicate one Harness adapter, or keep separate copies of the same canonical entity.

## Product ownership map

- **Extension Center** owns product-facing Feature Pack enablement and capability discovery. Harness Plugin Registry continues to own installation, removal, version, Loader state, and technical inventory.
- **Platform Scheduler** owns user-facing schedule configuration and run history projection. Harness Runtime and registered action adapters own execution.
- **Notification Center** owns notification presentation, read state, filtering, and target routing. It does not become a second task system or raw execution log.
- **Visual Experience** owns shared PAIMind presentation behavior and reversible shell decoration. It must not own business data.
- **Harness Compat** owns all selected-version imports, DOM adapters, and upstream shape translation. Feature plugins consume semantic facades instead of reaching into Harness internals.
- **Workspace Blueprint Center** owns versioned Folder-first Workspace composition packages, the personal template repository, authoring surface, safe materialization and the materialized Workspace composition receipt. Harness remains the sole owner of Workspace registration, identity, Session lifecycle and navigation. Skill Market consumes exact Business Skill references as Workspace Scope; Agent Builder owns the entry-Session Agent binding. Neither binding is recommendation metadata, copied entity state or a second runtime.

## Delivery sequence

### Phase 1 — product experience foundation

- Differentiate PAIMind Settings navigation entries with native Harness icons.
- Make Feature Packs the Extension Center’s primary interaction; keep module diagnostics under Advanced details.
- Present scheduled work as readable task cards with state overview and progressive detail.
- Present notifications as a message center with unread, attention, time grouping, and progressive detail.

### Phase 2 — ecosystem intake

- Add a read-only candidate catalog for external DSH plugins.
- Run package identity, manifest, dependency, surface, state, permission, and selected-version compatibility checks in an isolated composition.
- Do not expose install actions until the candidate passes the Conflict Review gate and runtime/browser acceptance.

### Phase 3 — promoted integrations

- Wrap accepted third-party plugins through PAIMind-owned adapters when they touch PAIMind product surfaces or state.
- Preserve provider ownership for provider-specific runtime and data.
- Add install, unload, upgrade, failure-isolation, and rollback acceptance before inclusion in the Product Line bundle.

### Phase 4 — desktop distribution

- Revisit desktop packaging only after the web composition and plugin lifecycle are stable.
- Treat desktop as a distribution/runtime adapter, not a second PAIMind product codebase.

## Definition of done

A capability is not complete until all applicable checks pass:

- package-role, dependency-reachability, API, type, test, build, and documentation gates;
- installation, unload, reload, and failure-isolation checks;
- real Harness composition on the selected compatibility matrix;
- browser acceptance of the primary user journey, empty/loading/error states, and responsive behavior;
- recorded evidence that the capability does not duplicate another plugin’s surface, state, runtime service, or compatibility adapter.
