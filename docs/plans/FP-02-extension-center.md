# FP02 Extension Center Rebaseline Plan

## Outcome

Retire the former PAIMind Launcher and replace FP02's product scope with an Extension Center contribution inside Harness Settings. The page manages PAIMind capability understanding and configuration; it does not launch features, own plugin loading, or duplicate Harness Registry state.

Status: `Implemented and Verified` in R1 on 2026-08-14.

## Capability mapping

| Capability | Owner | FP02 decision |
|---|---|---|
| Package loading, version, dependency, enablement, Fiber phase | Harness Plugin Registry | Native reuse through a version-isolated read adapter |
| Installed Loader inventory | Harness Settings → Plugins | Keep unchanged as technical inventory |
| PAIMind capability name, description, category, owner, permission and entry-surface metadata | PAIMind feature package | Self-register immutable descriptor |
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
- Harness rc.6 currently exposes exact module id, effective enablement and Fiber phase through the public Inventory Remote. Version and dependency ownership remains with Harness, but those fields are not invented or displayed until its public API exposes them.

## Data, state and failure paths

- Product metadata is code-owned and immutable per installed package revision.
- Runtime technical state is read-through from Harness; Extension Center stores no mirror.
- An installed PAIMind package without a descriptor appears only in Harness technical inventory and fails a bundle completeness test.
- A descriptor whose package is absent renders `Unavailable` only in development diagnostics; production Bundle composition rejects the mismatch.
- A single descriptor render or settings contribution failure is contained to its card and cannot block native Settings or conversation.

## Permission boundary

- Viewing installed product descriptors follows the same local Settings access as Harness.
- Configuration actions deep-link or invoke only the owning extension's registered Settings contribution.
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

## R1 implementation read-back

- Bundle client count: `8`; Launcher and FP03 marker are absent.
- Product descriptors: Runtime Orb, Artifacts & Preview, Bento Renderer, Presentation Trace, Task Monitor and Extension Center.
- Headless exemptions: Workspace Project adapter and Better Sidebar adapter.
- Task Monitor is explicitly `Reopened` and reports its current Side Card surface; R2 changes it to an independent button and Native Job source.
- Bento core imports no Better Sidebar package; only `@paimind/better-sidebar-adapter` owns that external dependency.
