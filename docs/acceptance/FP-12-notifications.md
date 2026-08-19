# FP12 Notification Center Acceptance

## Current status

`Technically Verified; Product E2E Reverified for Passive-Receiver Correction` on 2026-08-17. Notification Center no longer subscribes to Tool or Artifact execution. Only an explicit trusted producer or authenticated Platform API call writes a message.

Executed 2026-08-17 correction evidence:

- Host dependency is now only `storageDomain`; the `tools/execute` listener and built-in `paimind.artifacts` producer were removed.
- Focused Notification, Platform API and Platform SDK suites passed: 5 files / 14 tests. Type Check, Production Build and framework verification passed.
- The real `3080` Harness process was restarted after the build. A real Agent generated `notification-passive-regression-20260817-1316.html`; Native Job and Artifact revision 1 completed normally.
- Notification Center contained 35 rows before generation and 35 afterward. The new Artifact title had zero matches inside the Notification list, the unread badge remained 15, and the browser logged zero warnings or errors.
- Existing durable messages were preserved; the correction changes future publication only.

Historical 2026-08-15 technical evidence:

- 53 Test Files / 156 Tests, Type Check, Production Build and 16-client framework scan passed.
- Exact Harness `0.1.0-rc.6` + Better Sidebar `0.11.0` full install/boot/remove/restore passed.
- Extension Center-absent and Notification Center-absent compositions booted successfully; removal cleanup and zero Harness upstream worktree delta passed.

Historical 2026-08-15 automatic-producer evidence, superseded by the passive rule above:

- A real Agent generated `fp12-notification-e2e.html` through `generate_html_artifact`; the same run produced the native Job, Tool Result metadata, Deliverable, Artifact projection and one unread message.
- `View artifact` reopened the exact Session and focused canonical artifact id `artifact:bd9e6be08be505753a9537af` in the Artifacts side card.
- One-message read and mark-all-read state persisted across browser refresh, a full Harness restart and removal/reinstallation of `@paimind/notifications`.
- A real Read Only generation failed with `generation_failed`; no target file, available Artifact or success notification was invented, and native conversation remained usable.
- Chinese/Dark, English/Light and 560×800 full-width Drawer behavior passed. The shell Overlay was moved to a `document.body` portal after a real stacking-context defect was found against Better Sidebar.
- A live composition without Notification Center retained Task Monitor, native conversation, Composer, Deliverables, Artifact Viewer and Extension Center; restoring the formal Bundle restored the two durable read messages.

## URL and entry

- URL: `http://127.0.0.1:3080/`.
- Product entry: the independent bell in the Harness sidebar footer.
- Capability management: `Settings` → `Extension Center` → `Automation` → `Notification Center`.
- Artifact target: the notification action opens the exact Harness Session and the `Artifacts` side card, focused on the linked artifact.

## Preparation

- Exact Harness `0.1.0-rc.6` and Better Sidebar `0.11.0` with the PAIMind Bundle installed out of tree.
- A real attached Workspace and Session whose Agent Preset exposes one PAIMind generator Tool.
- No `paimindArtifactPreview`, `paimindTaskPreview`, notification fixture, pre-created target file or browser-injected notification.

## Product E2E sequence

1. Record the Notification row and unread counts.
2. Ask the real Agent to generate a uniquely named Artifact through a real generator Tool.
3. Verify Native Job, Deliverable and Artifact projection complete normally while Notification row and unread counts remain unchanged.
4. Verify the generated Artifact title does not appear inside the Notification list.
5. Publish through one trusted registered producer or the authenticated Platform API and verify exactly one message appears with caller-bound source and explicit content.
6. Repeat the same `idempotencyKey` and verify no duplicate message appears.
7. Check All/Unread, one/all read, explicit target navigation, restart persistence and browser error isolation.

## Expected product behavior

- The bell is an independent product entry and remains outside Better Sidebar tabs.
- Extension Center manages the extension descriptor only; it does not become a Launcher.
- Tool, Job, Session, Schedule and Artifact events never create messages automatically.
- A message exists only because a trusted caller explicitly published it.
- All/Unread, one/all read and restart persistence operate on notification state only.
- The source is Host-trusted. Model/client content cannot choose a producer identity.
- External actions accept credential-free HTTPS only and open with `noopener,noreferrer`.
- Notification body is plain text. HTML-like content is displayed literally.
- At most one action is shown and it points to an explicit canonical target.

## 2026-08-17 correction completion evidence

- Passed: real Agent generator Tool execution and canonical Native Job/Artifact completion without a new Notification.
- Passed: existing Notification list/read state remained intact after build, restart and generation.
- Passed: focused automated suites, Type Check, Production Build and framework verification.
- Passed: browser row-count, list-content and console-error checks.
- Pending outside this correction scope: the full repository API snapshot still reports pre-existing declaration/runtime hash differences in `@paimind/harness-compat` and `@paimind/task-monitor`; `@paimind/notifications` matches its approved snapshot.

## Deferred to FP13

- Schedule-created messages and `ScheduleId → JobId → SessionId` linkage.
- Any independent Scheduled Session behavior not exposed safely by Harness Schedule v1.
- Notification is ready to consume a trusted Scheduler producer later, but FP12 does not create a second Schedule or Job model.
