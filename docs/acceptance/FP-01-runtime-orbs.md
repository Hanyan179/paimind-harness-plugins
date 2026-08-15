# FP01 Runtime Orbs Verification and Optional Review

## Current status

`Verified`. Implementation, production build, real Harness composition, browser pre-acceptance, bilingual locale switching, and live sequential/parallel state testing are complete.

## URL and entry

- Normal runtime: `http://127.0.0.1:3080/`
- Deterministic visual acceptance: `http://127.0.0.1:3080/?paimindOrbPreview=1`

Open a normal Harness Session. Sequential completed rows keep native Harness icons. Every member of an active contiguous parallel tool-call batch shows its mapped animation until the final sibling settles, then the batch returns to native icons together. A running parent yields to precise children. The selected running Session indicator remains compact. The native `Deep diving...` position shows a Chinese/English dynamic label without duplicating row orbs, and becomes the orb fallback only when no supported activity row exists.

## Preparation

- One writable local Workspace.
- A configured model capable of native reasoning.
- Tools that can perform one ordinary call, one file-generation call, and one pending user question.

## Browser and optional user-review scenarios

1. Send a reasoning question. Active Think rows and the selected Session indicator show `solving`; the current-turn status shows “正在思考…” or “Thinking…” without a duplicate orb. Completed Think rows restore native icons.
2. Let the assistant stream ordinary answer text. The current-turn status changes to `composing` and “正在回复…”.
3. Trigger a sequential Bash or another Tool Call. Its active row shows `connecting`; after it settles the row immediately restores its native icon and the live status remains label-only.
4. Trigger three parallel searches. All three rows show `searching` for the duration of the batch, including faster siblings that return first. When the final call settles, all three restore native globe/search icons together; no fourth orb appears in the status row.
5. Trigger Grep/search, Read/context, and file generation. The live status changes to `searching`, `working`, and `shaping` respectively.
6. Trigger a user question or approval. The live status shows `breathing` and “等待你的选择” or “Waiting for your choice”.
7. Switch Harness Light/Dark theme. The canvas theme follows without reloading.
8. Enable operating-system reduced motion and reload. State remains visible but the orb animation is paused.
9. When the Session becomes idle, the PAIMind status row disappears and the native conversation layout remains unchanged.

## Expected non-effects

- Think/Read/Grep/Bash/Tool disclosure behavior and hover/expanded chevrons are unchanged; only collapsed running leaf icons are temporarily replaced.
- No PAIMind absolute file path or prototype-local data enters the browser.
- Removing the plugin restores the native Web profile.

## Evidence

- `pnpm run check`: passed after the latest scope change.
- Type check: passed.
- Focused runtime regression: 2 files and 22 tests passed. The added browser-shaped fixture reproduces the reported `ok / ok / running` three-search batch: all three rows retain `searching` orbs, the localized status remains label-only, and the native elapsed timer remains visible.
- Full repository gate after the reopened FP01 feedback: 7 files and 34 tests passed, followed by type check, production build, and framework-boundary verification.
- Production build: passed.
- Framework boundary verifier: passed.
- Real Harness composition: install, configuration dump, remove, native restoration, and zero upstream worktree delta all passed.
- Live browser transition: `thinking → tool-use → replying → idle` passed with sidebar, activity-row, and current-turn state synchronization.
- User-feedback regression: a live 15-second Bash call produced exactly one content activity orb (`connecting`), zero status orbs, and the label “正在调用工具…”. After completion the page reported zero history orbs and zero playing orbs, with native Bash/Think icons restored.
- Single-active-orb evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-single-active-orb.jpg`.
- Parallel-batch browser gate: three direct concurrent Bash calls (4s/10s/20s) showed three animated row orbs while the first two rows were already `ok` and the third remained `running`; status showed `Using tool…` with zero status orbs. After the final call, all three rows reported `ok`, zero row orbs, and native Bash icons.
- Parallel-batch evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-parallel-batch-three-orbs.jpg`.
- Reopened Web Search gate: with Harness Language set to Chinese, one search had already reached `ok` while two remained `running`; all three rows still showed `searching` orbs, the native status position showed “正在搜索…” with zero duplicate status orbs, and the original English preference was restored afterward.
- Chinese parallel-search evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-parallel-search-zh-batch.jpg`.
- Locale browser gate: with Harness Language set to English, the live fallback label was `Thinking…`; switching Harness to 中文 changed the live label to “正在思考…”. The original English preference was restored after verification.
- Live Bash evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-live-bash-status.jpg`.
- Unified history evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-unified-history-orbs-20px.jpg`.
- Narrow dark evidence: 390×844, document `scrollWidth=390`, no horizontal overflow.
- Fresh stable-server tab: 0 history orbs and 0 playing orbs while idle; five sampled settled disclosure rows retained native icons; no horizontal overflow at 1280px.
- Final normal-page evidence: `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/fp01-final-normal-dark.jpg`.

## Progression decision

FP01 is `Verified`; start FP02 automatically. User feedback can reopen FP01 asynchronously without invalidating the framework baseline.
