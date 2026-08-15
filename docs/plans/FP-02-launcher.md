# FP02 PAIMind Launcher Implementation Plan

> Historical evidence only. R1 retired this surface from Bundle and client discovery. The active FP02 plan is [`FP-02-extension-center.md`](FP-02-extension-center.md).

## Outcome

Add one native-aligned PAIMind entry to the Harness sidebar footer and open an additive frame overlay that becomes the stable registration surface for later PAIMind feature plugins. FP02 delivers the shell and contract only; it never presents a planned package as already available.

## Native reuse and migration boundary

- Reuse Harness `sidebar.footer.action` for the responsive wide/rail trigger and `shell.overlay` for the frame-wide panel.
- Keep Harness Workspace/Session navigation, native Settings, model controls, and conversation routing unchanged.
- Migrate the prototype's common PAIMind navigation intent into one launcher shell instead of copying its complete sidebar.
- List Agent, Skill, Notification, Scheduled Task, Personal Settings, Administration, and Developer Resources as explicit planned destinations until FP09-FP16 register real panels.
- Do not add Project to the launcher: `Project = Harness Workspace`, which remains in native sidebar scope for FP04.

## Plugin contract

- The client provides a structural `paimindLauncher` service through Cordis reflection.
- Later plugins register a destination by stable id, order, bilingual title/description, feature-package id, availability, and optional React panel.
- Registrations stack by destination id. A later feature replaces the FP02 placeholder while mounted; disposal restores the prior entry.
- The observable snapshot contains `open`, `activeId`, and the sorted destination list. `open`, `select`, `close`, `register`, and `subscribe` are the only state-changing operations.
- Slot registration, service provision, destination registration, styles, and focus behavior all have disposal paths.

## State, failure, and permission behavior

- Closed is the default and does not affect the page, Session, URL, or history.
- Opening stores the trigger as the focus-return target, sets the first requested destination active, and moves focus into the dialog.
- Escape, backdrop click, and the close button dismiss the overlay and restore trigger focus.
- While open, background frame columns are inert and the dialog traps Tab focus. Teardown restores previous attributes.
- Planned destinations are inspectable but expose no fake action. Their detail panel names the future feature package.
- A launcher render failure is contained locally and closes the launcher; Harness conversation and Settings remain usable.
- FP02 adds no server data access and no privileged action. Later destination packages own their own service-side permission checks.

## Responsive and visual behavior

- Wide sidebar: 34px footer row matching native Settings rhythm.
- Collapsed rail: 36px circular button with an accessible label and tooltip via `title`.
- Desktop overlay: centered, token-based panel with destination rail and detail content.
- Narrow viewport: full-frame single-column surface with scroll-safe navigation.
- Colors, borders, surfaces, shadows, and typography use Harness theme tokens; reduced motion removes transitions.

## Verification

- Controller tests for open/select/close, deterministic ordering, override/disposal restoration, and subscriptions.
- Component tests for wide/rail triggers, honest planned state, focus entry/restore, Escape/backdrop close, Tab containment, and failure isolation.
- Registration tests for both official slots, Cordis service provision, and complete disposal.
- Production build, framework-boundary verifier, isolated real Harness install/boot/remove, and zero-upstream-delta check.
- Browser acceptance in wide, rail, light/dark, narrow, keyboard, and native-conversation-continuity scenarios.
