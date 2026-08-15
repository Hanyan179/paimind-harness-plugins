# RQ-103 Final Acceptance Report

Status: Activated in Local Main Profile / Local Pre-acceptance Passed（本地主 Profile 已启用／本地预验收通过）. This report records executed local gates only. No shared test-environment or production release is claimed.

## Deliverables

- Code packages: `@paimind/platform-scheduler`, Harness/HTTP/Feishu-bot Adapters, Platform API/SDK, contracts and executable integration examples.
- Documents: PRD, architecture, integration contract, backend standard, SDK/Adapter/E2E guides, deployment runbook and acceptance specification.
- Active local Bundle: PAIMind selects `@paimind/platform-scheduler` with Harness, HTTP and Feishu-bot Adapter services. `@deepseek-ai/dsh-schedule`, `@deepseek-ai/dsh-time-context` and the legacy facade `@paimind/scheduler` are not loaded, so the technical plugin list and product shell expose only one scheduler.
- Feishu PRD: live target `QhrXdKOxwojkpEx2zb0c8ZRxnlc` was re-read at Revision 15, updated, then key sections were read back at Revision 30.

## Automated verification

After the single-entry, action-lifecycle, ordering and time-input corrections, `pnpm run check` passed:

- Type Check.
- 72 test files / 218 tests.
- Production Build.
- Framework Verification for 21 client plugins.
- Documentation Check for 70 Markdown files with zero missing local links.

The focused Scheduler and Adapter suite additionally passed 7 files / 23 tests. It covers the named Settings entry, time-input state, unavailable-action recovery, task ordering and the expired one-time-task rule.

## Local main-profile verification

The merged main Profile is running at `http://127.0.0.1:3080/`; the isolated `3082` research Profile has been stopped.

`dump-config` confirmed the active composition:

- `@paimind/platform-scheduler` is present;
- Harness, HTTP and Feishu-bot Adapter services are present;
- the optional Feishu acceptance action is registered;
- `@deepseek-ai/dsh-schedule`, `@deepseek-ai/dsh-time-context` and `@paimind/scheduler` are absent.
- the technical Plugin List contains one `platform-scheduler` row and zero `schedule` or `time-context` rows.

Browser read-back on `3080` confirmed:

- exactly two primary views: task list and run records;
- the only product entry is **设置 → 平台定时任务 → 打开任务列表**; the sidebar footer has no duplicate Scheduler trigger;
- zero **Reschedule** and zero **Test run** buttons;
- the registered Feishu bot keyword-test action is the only selectable action;
- `time` changes remain stable after blur and save instead of reverting to the previous value;
- expired one-time tasks expose **Run now**, **Edit** and **Archive**, without an invalid scheduled-loop start action;
- the technical Plugin List contains one `platform-scheduler` row, one Feishu Adapter row and zero legacy `schedule`, `time-context` or `scheduler` rows.
- the execution-item selector contains **Agent · 新建会话并生成工作区简报** under AI/Agent and **飞书机器人关键词测试** under Messaging;
- Task-list rows no longer expose schedule ids, time-zone/source notes, trigger notes, result bodies or persistent success notices;

The six historical RQ-103 fixture definitions and six runs were removed from the active product store and preserved as a recoverable local evidence backup outside the repository. The current active store contains one Feishu task and one Feishu scheduled Run:

- Schedule: `schedule:b0cd3717-3580-4eb9-a0b4-8c7299c314e2`
- Run: `run:9369c132c1fa0e8e65e776e176f3f271`
- Trigger: `schedule`
- Final status: `succeeded`
- Result: `Feishu bot accepted the scheduled message; keyword "测试" included`

The daily test task was paused immediately after the successful scheduled dispatch so it cannot send an unintended message on the following day. The task and its Run history remain visible for user review.

The built-in Agent item was then verified on the same `3080` profile. The first diagnostic Run correctly exposed a missing model route; after the registration was fixed to use the selected DeepSeek provider/model pair, a second real Run created an independent Session and completed successfully:

- Run: `run:05965db3-a2b4-4830-ad87-282d0f2c9ad8`
- Session: `paimind-scheduled-0f4750b7f6a23511fb465307`
- Trigger: `manual`
- Final status: `succeeded`
- Result: a non-empty workspace brief containing progress, risks and next actions
- Action: `打开对话`

## Historical provider evidence

Before main-profile activation, an isolated Profile ran `RQ-103 Automated Harness Run v5` through a real Harness Agent, Agent Preset and Native Job:

- Schedule: `schedule:829e9788-0f94-41d4-b378-1f28d58b7b19`
- Run: `run:8566e503ddc3ba746650c8482066becd`
- Session: `paimind-scheduled-d097d76ea8e08c7e90daa809`
- Result: `succeeded` with a non-empty final message, a recognizable conversation-list title and “打开对话” action.

A second isolated Profile exercised the real Feishu custom-bot provider. A direct preflight and due Scheduler Run were both accepted by Feishu. Durable Run `run:f67a84c4db7ebba7307af7cc55b56f14` completed on attempt 1 with status `succeeded` and confirmed that keyword `测试` was included. The actual Webhook was process-only and was not persisted in source, task data, evidence or documentation.

These runs remain provider-integration evidence. They do not replace the current `3080` composition and browser read-back above.

## Deployment acceptance

Local main-profile activation and pre-acceptance have passed. No shared test environment has been verified, so shared release and production acceptance are not claimed.

## Known limitations

- Version 1 is single-node only.
- **Run now** invokes the same real Adapter and result contract as scheduled execution; it cannot change schedule timing or accept temporary business parameters.
- Business users cannot event-trigger, Cron or bulk backfill.
- Enterprise actor authorization requires a trusted deployment Authorization Provider.
- The Feishu custom-bot provider has no callback/idempotency protocol; ambiguous transport retries can duplicate a notification message.
- Standard HTTP-provider shared-environment browser acceptance remains a future release gate; automated signed `202`, callback, replay and allowlist tests are local evidence only.
