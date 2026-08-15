# RQ-103 Platform Scheduler Acceptance

> Status: Activated in Local Main Profile / Pre-acceptance Passed（已进入本地主配置／预验收通过）. The platform Scheduler is selected by the formal Harness Bundle and must pass the same gates on `3080`; no shared-environment formal acceptance is claimed.

## Acceptance object

The acceptance object is `@paimind/platform-scheduler` plus its Harness/HTTP/Feishu-bot Adapters, Platform API/SDK, executable examples and documentation. It is the only Scheduler selected by the PAIMind Bundle; the legacy PAIMind facade and native Session-reminder rows are absent. The frozen Vite prototype is excluded.

## Automated gate

- Scheduler calendar, DST, latest-only catch-up, deterministic idempotency, overlap and archive tests.
- Run-now isolation, trigger-source recording and expired one-time edit tests.
- Durable table restart and running-timeout recovery test.
- Harness Adapter new Session/Native Job/result mapping test.
- HTTP Adapter HTTPS/SSRF, HMAC, `202` and result-origin tests.
- Feishu custom-bot Adapter endpoint validation, keyword enforcement and provider-result mapping tests.
- Platform API identity, notification and replay tests.
- SDK signing, input security and executable integration examples.
- Full repository Type Check, tests, Production Build, Framework Verification and document-link check. Results are recorded in the final report and remain local pre-acceptance evidence.

## Real Product E2E cases

1. Register a Harness action through business code.
2. Create a business task from name/action/time/time zone/enabled fields only.
3. Due time creates one independent Run, Session and Native Job.
4. Agent completes and Run reaches a final state with message.
5. “打开对话” selects the exact created Session.
6. Register an external HTTP provider through signed Platform API.
7. Provider receives signed trigger and returns `202`.
8. Provider reports running progress and a final result link.
9. Harness restart restores definitions/runs and latest-only scheduling.
10. Duplicate occurrence and callback do not create duplicate business execution.
11. Removing one Adapter leaves other actions available.
12. Technical Plugin List contains `platform-scheduler` but not the old `schedule` row; Settings contains one named Platform Scheduler entry.
13. A due Feishu custom-bot action sends the required keyword and stores a final Run result without exposing its Webhook.
14. Run now executes immediately, appears as `manual`, and leaves task state and `nextRunAt` unchanged.
15. Settings contains the only Platform Scheduler product entry; the sidebar footer contains no duplicate Scheduler trigger.
16. Active definitions sort by nearest `nextRunAt`; paused/executed definitions follow by latest update, and Runs sort newest first.
17. An unloaded action is unavailable for create/edit/run-now, and an already-due definition remains pending without a false failed Run until the executor returns.
18. The action selector groups AI/Agent, business-system, messaging and health-check items without changing the scheduling fields.
19. The built-in Agent item creates an independent, recognizably titled Session, starts a Native Job, stores the final brief and exposes “打开对话”.
20. Task-list rows contain summaries only: no schedule id, time-zone/source note, trigger note or result body; Run records retain the complete result and action.

## Browser matrix

- Task list and Run records only.
- Create, edit, enable/pause scheduled runs, run now and archive; expired one-time tasks reuse Edit and never show a duplicate Reschedule action.
- Time zone, weekday and day-of-month are select controls rather than free-form business inputs.
- Queued, running, succeeded, failed and needs-attention.
- Progress text only while running; no progress bar.
- Internal Session and external isolated link.
- Chinese/English, Light/Dark, desktop/narrow/mobile.
- No overflow, occlusion, console error or cross-plugin unload regression.
- The only product route is **Settings → Platform Scheduler → Open task list**.
- Task rows remain one-line summaries; detailed messages and actions stay in Run records.

## Evidence location

Automated command output and browser captures belong in `codex-output/evidence/` and `codex-output/qa/` outside the Git repository. The final result and limitations are summarized in `RQ-103-final-acceptance.md` after execution.

## Acceptance semantics

The current state is Local Main Pre-acceptance Passed（本地主配置预验收通过） after verification on `3080`. Formal Acceptance Passed（正式验收通过） still requires a reachable shared test environment and the same E2E/browser cases there.
