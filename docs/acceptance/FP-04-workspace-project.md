# FP04 Project/Workspace Bridge Acceptance

## Current status

`Headless Adapter Technically Verified; Visible Surface Reopened` at `PRR-01`. `Project = Workspace` remains canonical. The visible Workspace-context chip is scheduled for removal unless a later product flow proves independent value; downstream plugins must consume the headless adapter.

## URL and preparation

- URL: `http://127.0.0.1:3080/`
- Entry: use the native left sidebar to open a Workspace Session, then use the Workspace-context chip beside the native Session title.
- Prepare: one native Workspace with at least two Sessions and one ungrouped Session if the deletion/error path is being checked.

## Browser sequence

1. Open a Workspace from the native sidebar. The sidebar remains the only Project/Session tree; PAIMind adds no duplicate Project page or launcher destination.
2. Open one Session in that Workspace. A compact Workspace-context chip appears beside the native title and uses the native Workspace title.
3. Open the chip. The popover shows the same native Workspace title and canonical path, the current Session, total visible Sessions, archived Sessions, and last-updated time.
4. Close with Escape, click outside, then reopen. Focus returns to the trigger and the native conversation remains usable.
5. Create or open another Session from the native Workspace controls. The same chip follows the new native membership without reloading a PAIMind Project store.
6. Rename the Workspace from the native menu. The chip and overview update from the native snapshot.
7. Refresh the browser and restart Harness. Workspace identity, Session ownership, title, and ordering restore from Harness; the PAIMind projection follows them.
8. Remove the PAIMind bundle. The chip disappears while the native Workspace/Session tree and conversation keep working.

## Error, permission, theme and responsive checks

- A Session not accounted by any Workspace shows no PAIMind Workspace chip; PAIMind does not claim ownership from cwd alone.
- If opening a directory is denied or fails, the popover shows a localized error and remains operable.
- Deleting a Workspace uses the native warning and retains directory/session logs according to Harness semantics; PAIMind does not add another confirmation.
- Light and Dark themes use Harness semantic tokens.
- Below 720 px, the chip collapses to its icon while the popover stays within the viewport and remains keyboard reachable.
- Reduced Motion introduces no special branch because FP04 uses no continuous animation.

## Automated and browser evidence

- FP04 focused suite: 4 files / 14 tests passed across pure projection, observable bridge, client contribution, bilingual interaction, open-path failure, 390×640 viewport clamping, and invariant disposal.
- Full PAIMind gate: 13 files / 52 tests, TypeScript declarations, production client bundles, and framework boundary verifier passed; four client plugins are composed and no package outside `@paimind/harness-compat` imports version-sensitive Harness modules.
- Native Harness Workspace regression: 5 files / 143 tests passed across registry persistence, API proxy, client runtime, native browser/tree, and picker flows.
- Isolated real Harness profile: Bundle plus FP01–FP04 installed, booted, served all four client manifests, removed, restored native composition, and left the Harness Git worktree unchanged.
- Live browser: the native left sidebar remained the sole Workspace/Session tree; the Workspace chip showed canonical title/path and counts, followed an actual Session switch, localized between Chinese and English, rendered correctly in Light and Dark, closed by outside/Escape with focus return, and recovered after browser refresh and Harness restart.
- Live open-in-system was not clicked because it launches an external macOS application. Success/failure delegation is covered by focused tests, including the localized rejected-open state.
- The current in-app browser controller exposes a fixed 1280×720 viewport and no device-metrics override. FP04 does not claim a narrow browser screenshot; the production `max-width: 720px` rule and 390×640 fixed-position clamping are covered deterministically by the client suite. This limitation does not create a second data or navigation path.

Evidence files:

- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp04-workspace-context-dark.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp04-workspace-context-light-zh.jpg`

## Explicit later ownership

- Product task monitoring and external Better Sidebar adapter: FP05.
- Durable document intake, artifact association, preview and download: FP06-FP07.
- Presentation trace: FP08.
- Cloud folder provider: Goal B.
