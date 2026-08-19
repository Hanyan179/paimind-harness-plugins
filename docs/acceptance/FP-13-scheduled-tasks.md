# FP13 Scheduled Tasks Acceptance

> Historical Goal A acceptance record. Superseded for current product behavior by RQ-103 activation: `@paimind/platform-scheduler` is now the only Scheduler selected by the PAIMind `3080` Bundle; the native Harness Schedule rows described below are historical evidence and are no longer loaded.

## Current status

`Technically Verified; Product E2E Verified` on 2026-08-15. The exact Harness `0.1.0-rc.6` package, official composition overlay, public Tool/Event contract, product layer and native limitations passed automated, real-composition and real-model browser gates.

## URL and entry

- URL: `http://127.0.0.1:3080/`.
- Product entry: independent Scheduled Tasks clock in the Harness sidebar footer.
- Capability management: `Settings` → `Extension Center` → `Automation` → `Scheduled Tasks`.
- Result surface: the original native Harness conversation; there is no independent Schedule receipt or Scheduled Session in Harness v1.

## Preparation

- Exact Harness `0.1.0-rc.6` with `@deepseek-ai/dsh-time-context`, `@deepseek-ai/dsh-schedule` and the PAIMind Bundle installed out of tree.
- One attached Workspace and live root Session using a real model.
- No client-owned schedule, pre-appended `schedule/change`, QA preview source or simulated timer.

## Product E2E sequence

1. Open Scheduled Tasks and confirm the current Session id plus the visible v1 boundary: Session-local only, no Run Now, no Cron, no independent Session.
2. Create a one-shot reminder due in several seconds. Confirm the panel sends an ordinary Session prompt rather than mutating state directly.
3. Verify the native conversation shows `schedule_create`, its exact Tool result and stable schedule id. Refresh the panel and confirm the same active record.
4. Keep the Session live. Confirm the due reminder starts a normal later turn in the same conversation and the one-shot is no longer active.
5. Create an `every` reminder at 300 seconds. Refresh the browser and restart Harness; reopen the owning Session and confirm the active record recovers.
6. Delete the exact id from Scheduled Tasks. Confirm the Agent uses `schedule_delete` and the catalog becomes empty after refresh.
7. Submit an invalid rule such as `every_seconds: 60`. Confirm the native `frequency_too_high` result and no active record.
8. Check Chinese/Dark, English/Light and a 560×800 full-width Drawer. Escape must dismiss it.
9. Remove only the historical Session-local facade. Confirm native Schedule Tool schemas, native conversation, Task Monitor, Notification Center and Deliverables remain usable; restore the formal Bundle afterward.

## Expected product behavior

- Schedule identity and state come only from the official fold of the current Session log.
- Create/delete actions are AI-native requests to the Agent and always remain visible in the native conversation.
- The management page never claims independent execution, completion, exactly-once delivery or cold-session wake.
- A removed PAIMind UI does not remove or corrupt native Schedule records.

## Completion evidence required

- Real model-driven `schedule_create`, canonical `schedule/change`, due follow-up and `schedule_delete` evidence.
- Refresh and Harness restart recovery of one native recurring record.
- Real native invalid-rule failure without a false record.
- Full automated/build/composition gates and isolated PAIMind Scheduler removal.
- Chinese/Dark, English/Light and 560×800 screenshots outside the source repository.

## Explicitly unavailable in Harness Schedule v1

- Immediate run.
- Cron or calendar recurrence.
- Independent Scheduled Session or cold-session wake.
- Independent run result/history surface.
- Exactly-once delivery guarantee.

## Verified evidence

- Final correction gate: 71 test files / 208 tests, Type Check, Production Build, 69-file documentation link scan and framework scan passed; 21 client packages are buildable while the formal Goal A Bundle selects 20 and excludes the future platform Scheduler.
- Exact Harness `0.1.0-rc.6` plus Better Sidebar `0.12.1` and Office Viewer `0.1.0` passed install/boot/remove/restore and PAIMind-Scheduler-absent composition with the official native Schedule retained and zero upstream Git delta.
- A real Agent called `schedule_create`; `schedule-1` became visible from the canonical Session fold, fired after 30 seconds as an ordinary later turn in the same Session, disappeared from the active catalog and produced one trusted Session notification.
- A real 300-second recurring reminder survived browser refresh and Harness restart, then `schedule_delete` removed its exact canonical id.
- The recurring request initially demonstrates an honest AI-native limitation: the model mistakenly used `after_seconds`, then deleted that native record and recreated an `every_seconds` record. PAIMind did not conceal, rewrite or own either mutation.
- A real `every_seconds: 60` call returned `frequency_too_high` and created no false record.
- Chinese/Dark, English/Light and 560×800 full-width Drawer passed.
- With only PAIMind Scheduler disabled, its independent clock disappeared while native `schedule_list` remained callable and returned the canonical empty list.
- Post-correction browser proof created native `schedule-2` through the product form, read the same `after / scheduled / session-local` record from the Session log, then deleted it through native `schedule_delete`; latest Scheduler console errors were zero.
- Final native-profile restart removed the RQ-103 research overlay from the profile patch. Config read-back contained only `@deepseek-ai/dsh-schedule`, the then-selected PAIMind facade and its invariant; the live dialog stated that it manages the current Session's native Schedule without a second task store, and a fresh reload produced zero console errors.

Evidence files are stored outside the repository:

- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP13-native-schedule-active.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP13-native-schedule-delivered.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP13-native-schedule-failure.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP13-scheduler-light-en.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP13-scheduler-narrow.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP13-scheduler-disabled-native-list.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp13-native-schedule-2026-08-15.png`
