# FP03 Conversation Extensions Acceptance

## Current status

`Harness Native Reuse` in R1. The scenarios below remain native regression coverage. The empty PAIMind composition marker is removed from the active Bundle and does not count as a user feature plugin.

## URL and preparation

- URL: `http://127.0.0.1:3080/`
- Entry: the native Harness conversation; FP03 intentionally adds no duplicate menu.
- Prepare one writable Workspace, one ordinary Session, one small supported image, and prompts that invoke a user question, Todo update, and file creation.

## Browser sequence

1. Ask the agent to request one structured choice and one custom answer. The native composer is replaced by one bilingual question card; resolving it returns to the same conversation.
2. Ask for a three-step task using the Todo tool. The native plan strip shows only the Harness projection and updates `pending → in_progress → completed` without a PAIMind copy.
3. Use the native attach control with a supported image. A draft preview appears, removal works, and the submitted image is visible after refresh.
4. Reference an existing Workspace file. The reference remains a Workspace path/reference; no fake browser-only PDF/PPT attachment object is created.
5. Ask the agent to create a small file. The native deliverables row appears only after a successful mutation and opens the actual file path.
6. Observe an automatic model retry or a terminal error fixture. The native retry/error receipt remains visible and the composer is still usable; PAIMind sends no duplicate request.
7. Trigger Think, Read, Grep, and another Tool Call. Their native row layout is unchanged; only the already-verified FP01 active orb behavior may appear.
8. Repeat the observable surfaces in Chinese and English, Light and Dark themes, and a viewport below 768px. Native localization, contrast, and responsive behavior remain intact.

## Expected error and permission states

- Unsupported image types or oversized input use Harness native validation and do not enter history.
- Missing/deleted Workspace files fail through the native file/tool path and never render as a ready artifact.
- Failed tool mutations do not create deliverable chips.
- Terminal provider errors render sanitized failure copy; credentials and raw provider secrets are not echoed by PAIMind.
- FP03 introduces no new permission decision. Workspace/Sandbox/Approval continue to be enforced by Harness.

## Automated evidence

- PAIMind focused tests: 2 files / 4 tests passed.
- Full PAIMind gate: 9 files / 38 tests, TypeScript build, production client bundles, and framework boundary verifier passed.
- Native Harness provider regression: 9 files / 96 tests passed across user questions, plan review, Todo panel, conversation retry/error nodes, attachment rail/drop/message image, and produced files.
- Isolated real Harness profile: install, boot, three PAIMind client manifests, remove, native restoration, and zero-upstream-delta passed.
- Live profile at `http://127.0.0.1:3080/`: `@paimind/conversation-extensions` is present in the served client manifest; restart and persisted-session recovery passed.

## Browser evidence

- Native question card: recommended choice, two alternatives, custom-answer field, wait state, answer receipt, and composer restoration passed.
- Native Todo: `0/3` creation and `3/3 completed` recovery after the question passed.
- Native deliverable: a successful `write` call produced one actual `Produced` chip for `fp03-deliverable.md`.
- Failure path: writing to the Workspace directory failed as `not a regular file`, produced no artifact chip, and left the composer usable.
- Restart recovery: question receipt, Todo history, produced-file chip, and failed-write receipt survived Harness restart and browser reload.
- Native image intake remains unchanged. The browser automation surface cannot inject an OS file into Harness's document-level drop listener, so attachment behavior is covered by the 96-test native-provider gate rather than claimed as a synthetic browser upload.

Evidence files:

- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp03-native-question-todo.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp03-native-todo-deliverable.jpg`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp03-native-failure-recovery.jpg`

FP03 adds no visual component of its own, so Light/Dark and narrow-layout behavior remains wholly native. The browser gate verified that the loaded FP03 manifest did not alter the current Dark desktop conversation; native component suites cover the reused responsive and localized renderers.

## Explicit later ownership

- Durable local document upload and Workspace association: FP04/FP06.
- PDF/PPT/DOC/XLS/HTML/Bento preview: FP06-FP07, preferentially through the verified Better Sidebar provider.
- Presentation data trace: FP08.
