# FP12 Notification Center Acceptance

## Current status

`Technically Verified; Product E2E Verified` on 2026-08-15. The automated/component gates and the real browser Tool → Native Job → Artifact → Notification → exact deep-link → refresh/restart/failure/isolation loop all passed without a notification fixture or preview query.

Executed technical evidence:

- 53 Test Files / 156 Tests, Type Check, Production Build and 16-client framework scan passed.
- Exact Harness `0.1.0-rc.6` + Better Sidebar `0.11.0` full install/boot/remove/restore passed.
- Extension Center-absent and Notification Center-absent compositions booted successfully; removal cleanup and zero Harness upstream worktree delta passed.

Executed product evidence:

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

1. Record that the bell has no message for the not-yet-created target.
2. Ask the real Agent to generate a uniquely named HTML artifact through the real generator Tool.
3. While it runs, verify Task Monitor shows the actual native Job states and the conversation records the native Tool call/result.
4. After completion, verify the conversation has the real Deliverable entry, Artifact projection has the same canonical ids and the bell shows one new unread message.
5. Open Notification Center. Confirm trusted source, title, optional plain-text body, level, time and one action; confirm no task lifecycle buttons are present.
6. Select `Unread`, mark one message read, then create another real artifact and use `Mark all read`.
7. Click `View artifact`. Confirm the exact Session is selected, the Artifacts side card opens and the exact artifact id is visibly focused. No file-name or model-text inference is allowed.
8. Refresh the page, then restart Harness. Confirm messages and read state recover; Task/Artifact lifecycle continues to come from its own native source.
9. Run a real failing generation. Confirm no available artifact is invented and notification failure cannot interrupt native conversation.
10. Check Chinese/Dark, English/Light and a 560×800 viewport. The narrow surface must be a full-width Drawer and remain keyboard dismissible.
11. Remove only `@paimind/notifications`. Confirm native conversation, Task Monitor, Deliverable and Artifact Viewer continue. Restore the formal Bundle afterward.

## Expected product behavior

- The bell is an independent product entry and remains outside Better Sidebar tabs.
- Extension Center manages the extension descriptor only; it does not become a Launcher.
- All/Unread, one/all read and restart persistence operate on notification state only.
- The source is Host-trusted. Model/client content cannot choose a producer identity.
- External actions accept credential-free HTTPS only and open with `noopener,noreferrer`.
- Notification body is plain text. HTML-like content is displayed literally.
- At most one action is shown and it points to an explicit canonical target.

## Completion evidence

- Passed: real Agent generator Tool execution and canonical Native Job, Tool Result metadata, Deliverable, Artifact and Notification chain.
- Passed: exact Artifact deep-link focus in a real browser.
- Passed: browser refresh, Harness restart and plugin reinstall recovery of message/read state.
- Passed: real failure without a false available Artifact or success message.
- Passed: focused/full automated gates, Production Build and exact Harness composition including isolated notification removal.
- Passed: Chinese/Dark, English/Light and 560×800 evidence stored outside the source repository under `codex-output/qa/`.

## Deferred to FP13

- Schedule-created messages and `ScheduleId → JobId → SessionId` linkage.
- Any independent Scheduled Session behavior not exposed safely by Harness Schedule v1.
- Notification is ready to consume a trusted Scheduler producer later, but FP12 does not create a second Schedule or Job model.
