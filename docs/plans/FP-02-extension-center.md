# FP02 Extension Center Rebaseline Plan

## Outcome

Retire the former PAIMind Launcher and replace FP02's product scope with an Extension Center contribution inside Harness Settings. The page manages PAIMind capability understanding and configuration; it does not launch features, own plugin loading, or duplicate Harness Registry state.

Status: R1 was verified on 2026-08-14. The 2026-08-20 capability-management upgrade is implemented and verified through package-local gates, the shared full-repository gate, real Harness composition and browser acceptance.

## Capability mapping

| Capability | Owner | FP02 decision |
|---|---|---|
| Package loading, version, dependency, enablement, Fiber phase | Harness Plugin Registry | Native reuse through a version-isolated read adapter |
| Installed Loader inventory | Harness Settings → Plugins | Keep unchanged as technical inventory |
| PAIMind capability name, description, category, maturity and entry-surface metadata | PAIMind feature package | Self-register immutable descriptor |
| Product grouping and search | Extension Center | Implement |
| Feature navigation | Each Harness native surface | Explicitly out of scope |
| Install/remove/enable mutation | Future Harness public API | Read-only in v1; never simulate success |

## Product categories

`Experience`, `Content & Rendering`, `Agents`, `Skills & Tools`, `Automation`, `Governance`, `Developer`.

## Package and service boundaries

- `@paimind/extension-center` is an independent host/client package.
- Harness owns technical loading through its Loader and Plugin Inventory. PAIMind does not add a second runtime Registry service.
- Extension Center declares the `paimind.extension` child Slot; each user-visible PAIMind client contributes an immutable descriptor through the native Slot ledger. If Extension Center is absent, the pending contribution stays inert and the feature remains operational.
- `PaimindExtensionDescriptor` contains stable product metadata plus the owning npm package name; it contains no live enablement or version field.
- `@paimind/harness-compat` isolates the current Harness Plugin Inventory shape and descriptor contribution helper.
- The client joins descriptor and technical snapshot at render time. Technical source failure yields `Status unavailable`, not stale cached success.
- Each feature package registers its descriptor from its own client lifecycle and unregisters only itself.
- Harness rc.8 currently exposes exact module id, effective enablement and Fiber phase through the public Inventory Remote. Version and dependency ownership remains with Harness, but those fields are not invented or displayed until its public API exposes them.

## Data, state and failure paths

- Product metadata is code-owned and immutable per installed package revision.
- Runtime technical state is read-through from Harness; Extension Center stores no mirror.
- An installed PAIMind package without a descriptor appears only in Harness technical inventory and fails a bundle completeness test.
- A descriptor whose package is absent renders `Unavailable` only in development diagnostics; production Bundle composition rejects the mismatch.
- A malformed descriptor is omitted; a page render or technical read failure is contained to Extension Center and cannot block native Settings or conversation.

## Permission boundary

- Viewing installed product descriptors follows the same local Settings access as Harness.
- Extension Center explains the real use/configuration surface but does not navigate to or invoke that surface; each capability keeps ownership of its entry.
- No install/remove/enable action is exposed until Harness publishes an authorized, revision-guarded management API.

## Upgrade boundary

- Harness-specific inventory transport stays in `@paimind/harness-compat`.
- Extension Center and feature packages never import Host inventory implementation or Loader internals.
- A Harness upgrade must pass inventory-shape contract, missing-provider containment, category join and uninstall disposal tests.

## Verification plan

1. Unit-test descriptor validation, seven-category exhaustiveness, Slot-ledger registration/disposal and join semantics.
2. Contract-test Harness inventory adapter and read-only failure states.
3. Bundle completeness-test every installed PAIMind user-facing package has exactly one descriptor or an explicit headless/native-reuse exemption.
4. Real Harness composition install/boot/remove/restore and upstream-zero-delta gate.
5. Browser-test Settings entry, category/search/detail/configure states, Chinese/English, Light/Dark and narrow viewport.
6. Remove one feature package in an isolated profile: only its descriptor/card disappears; Extension Center and native conversation remain.
7. Remove Extension Center: Harness Settings → Plugins and all independent feature entry surfaces remain operational.

## 2026-08-20 market research and frozen design decisions

Official product patterns reviewed before implementation:

- [VS Code Extension Marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace): strong search, category/filter grammar and progressive extension details; its install, disable, update, rating, download, recommendation and publisher-trust surfaces depend on Marketplace data Harness does not expose.
- [JetBrains plugin management](https://www.jetbrains.com/help/idea/managing-plugins.html) and [Marketplace listing guidance](https://plugins.jetbrains.com/docs/marketplace/best-practices-for-listing.html): concise value copy, Marketplace/Installed separation, compatibility and dependency detail. Only the concise product-summary/detail pattern transfers safely.
- [Obsidian Community Plugins](https://obsidian.md/help/community-plugins) and [Plugin security](https://obsidian.md/help/Extending%2BObsidian/Plugin%2Bsecurity): fast browse/search and a clear route to each installed plugin's settings; its security model also demonstrates why Extension Center must not invent fine-grained permissions or trust claims.
- [Raycast Extensions](https://manual.raycast.com/extensions) and [install flow](https://developers.raycast.com/basics/install-an-extension): command/category search, installed filtering, progressive details and preferences-based configuration. Harness currently supports only the search/category/detail/configuration-location subset.

Adopted for an expanding plugin catalog:

1. Stable seven-category taxonomy with query-aware counts and wrapped filters rather than a horizontally clipped tab rail.
2. Search across bilingual names, descriptions and exact package identity.
3. Compact one-column capability rows with progressive disclosure for technical detail.
4. Separate Product maturity from live Harness technical state and state the real use/configuration location.
5. Explicit loading, registry-error, no-result and honest Governance-empty states.
6. Native iconography, PAIMind tokens, keyboard buttons/focus treatment, reduced motion and a narrow focused Settings surface.

Rejected until a real Harness contract exists:

- Marketplace, Installed, Available or Updates tabs; install/remove/enable/disable/update actions.
- Ratings, downloads, recommendations, publisher verification, trust badges or source reputation.
- Version, compatibility, dependency graph, health, fine-grained permissions or update availability.
- Feature launching, duplicate Registry state, Resource Center, Component Library or prototype `ResourceComponentPreview` reuse.

Reason: Harness Plugin Registry remains the only lifecycle owner. Extension Center is a read-only join of capability-package product facts and the current Plugin Inventory snapshot; unavailable facts are neither cached nor inferred.

## R1 implementation read-back

- Bundle client count: `8`; Launcher and FP03 marker are absent.
- Product descriptors: Runtime Orb, Artifacts & Preview, Bento Renderer, Presentation Trace, Task Monitor and Extension Center.
- Headless exemptions: Workspace Project adapter and Better Sidebar adapter.
- Task Monitor is explicitly `Reopened` and reports its current Side Card surface; R2 changes it to an independent button and Native Job source.
- Bento core imports no Better Sidebar package; only `@paimind/better-sidebar-adapter` owns that external dependency.
