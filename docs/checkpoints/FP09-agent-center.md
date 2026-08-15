# FP09 Agent Center Checkpoint

> Historical Evidence（历史证据）: 只读目录版本的验收记录。当前可配置智能体中心需要按 [`../acceptance/FP-09-agent-center.md`](../acceptance/FP-09-agent-center.md) 重新执行产品验收。

**Date:** 2026-08-15  
**State:** `Product E2E Verified`

## Decision

FP09 is complete as a PAIMind catalog, market, classification and governance layer over the one Harness Agent Preset roster. Harness Preset remains the persisted Session binding and execution configuration. PAIMind owns only metadata keyed by Preset id and does not create a second Agent runtime, Preset document or configuration store.

Agent Center is an independent Harness Settings contribution. Extension Center describes it under `Agents` but is not a launcher. Removing Agent Center leaves native Agent Presets and conversation ownership unchanged.

## Real native-object evidence

| Gate | Result |
|---|---|
| Roster identity | Native Agent Presets and Agent Center both showed exactly `standard`, `code`, `minimal`, `cordis` and `paimind`. Trust and default presentation matched the Harness roster. |
| Search and product metadata | Search returned only native `minimal`. Favorite persisted only its id; browser refresh and Harness restart recovered it without caching the native roster. |
| Blank Session selection | A new Session selected `minimal` through the native API. After refresh, the native header rendered `极简模式`. |
| Real execution | The selected Preset completed a real Turn and returned `FP09 native preset selected.`. |
| Native lock | After the first Turn, `minimal` stayed `当前使用` and every other card rendered `会话开始后已锁定`. |
| Failure truth | The selected Profile contained no broken Preset. Automated tests cover broken-state visibility and fail-closed selection without inventing a QA Preset. |

## Browser evidence

- Chinese/Dark desktop: `codex-output/qa/FP09-agent-center-dark.png`.
- Native comparison: `codex-output/qa/FP09-native-agent-presets.png`.
- Started-Session lock: `codex-output/qa/FP09-agent-center-session-lock.png`.
- English/Light: `codex-output/qa/FP09-agent-center-light-en.png`.
- Real 560 × 800 Chromium: `codex-output/qa/FP09-agent-center-narrow.png`; the Settings dialog remained within the viewport and Agent Center had no horizontal overflow.

## Automated and composition gates

- Type Check: passed.
- Tests: 44 files / 130 tests passed.
- Production Build: passed.
- Framework: 13 client plugins; exact seven Extension Center categories; Harness Registry technical-only; Task Monitor independent; Bento adapter-only; no direct Harness import outside compat; no Better Sidebar import outside its adapter.
- Exact real composition: Harness `0.1.0-rc.6` with Better Sidebar `0.11.0` passed full install/boot/remove/restore plus profiles without Extension Center, without Task Monitor and without Agent Market.
- Agent Market isolated removal: the package id and client manifest were absent while every other current product client booted; cleanup passed.
- Harness upstream checkout: zero before/after PAIMind worktree delta.

R4 continues automatically with FP10 Personal Agent Builder. Goal A remains active.
