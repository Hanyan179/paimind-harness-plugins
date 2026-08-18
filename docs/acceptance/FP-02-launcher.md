# FP02 PAIMind Launcher Verification and Optional Review

## Current status

`Retired` in R1. The historical Launcher technical gates below remain rollback evidence. Current FP02 acceptance is [`FP-02-extension-center.md`](FP-02-extension-center.md).

## URL and entry

- Runtime: `http://127.0.0.1:3080/`
- Entry: the `PAIMind` row immediately above native `Settings` in the sidebar footer. In collapsed rail mode it becomes a compact `P` mark button.

## Preparation

- No Workspace, Session, file, or model response is required.
- Keep one existing Session available to confirm that launcher operations never change conversation state.

## Browser and optional user-review scenarios

1. Click `PAIMind`. A modal overlay opens with focus inside it; the existing conversation remains mounted behind the mask.
2. Select Agent, Skill, Notification, Scheduled Task, Settings, Administration, and Developer Resources. Each shows an honest `Planned` state and the exact future FP number; no destination pretends to be usable.
3. Press Escape. The overlay closes and focus returns to the PAIMind trigger.
4. Open again and click the mask or close control. The same dismissal and focus restoration occurs.
5. Collapse the Harness sidebar. The trigger becomes a compact rail button and still opens the same overlay.
6. Switch Light/Dark themes. The overlay follows Harness tokens without reload.
7. At a 390px viewport, the surface becomes single-column, remains scrollable, and introduces no horizontal overflow.
8. Close the launcher and continue the original Session. Message history, composer content, native Settings, and URL are unchanged.

## Expected non-effects

- Harness Workspace remains the only Project system.
- Harness Settings remains the native settings entry; FP02 does not duplicate its controls.
- No prototype-local synthetic state is loaded.
- No planned feature writes data or performs navigation.
- Removing the PAIMind bundle restores the native sidebar and overlay layer.

## Verification evidence

- `pnpm run check`: passed.
- Type check: passed.
- Test suite: 7 files and 33 tests passed; FP02 contributes 8 controller, UI, registration, disposal, focus, and failure-isolation tests.
- Historical production build: the now-retired launcher host, invariant, declarations, and client bundle built successfully.
- Framework boundary: two PAIMind client plugins discovered; zero direct Harness imports outside `@paimind/harness-compat`.
- Real Harness composition: bundle + FP01 + FP02 installed, configuration dumped, both client manifests served, packages removed, native profile restored, and Harness Git worktree remained unchanged.
- Desktop Dark browser: 7 destinations, all explicitly `待迁移`; focus entered the close button; every background frame column became inert; document width remained 1280/1280.
- Desktop Dark evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp02-launcher-desktop-dark.jpg`.
- Destination and keyboard gate: selecting Skill showed `FP11`; Escape closed the dialog, removed every inert attribute, restored focus to `打开 PAIMind`, kept `http://127.0.0.1:3080/`, and preserved the conversation.
- Collapsed rail gate: trigger rendered `data-wide=false` in a 36px control with the accessible title `打开 PAIMind`.
- Narrow gate: 390×844 panel, single-column flex body, 7 destinations, and document `scrollWidth=clientWidth=390`.
- Narrow evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp02-launcher-narrow-dark.jpg`.
- Light theme gate: body left dark mode, panel resolved to `rgb(255, 255, 255)`, and content remained readable.
- Light evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp02-launcher-desktop-light.jpg`.
- Original Dark theme and English locale were restored after the matrix check; the launcher trigger reads `Open PAIMind`.

## Progression decision

FP02 is `Verified`; start FP03 automatically. User feedback remains asynchronous and may reopen the package.
