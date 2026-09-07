---
display-name: 沃尔玛细分类目投资分析
name: fineline-investment-analysis
description: 基于脱敏的历史数据快照，分析细分类目的投资机会。
---

# Fineline Investment Analysis for Harness

## Selectable content offering

- `Fineline Investment Priorities (Recommended)` — Evidence-backed fineline ranking, investment focus, and buyer-facing category allocation.

Offer this as a content choice when either an approved Walmart manifest is available or the user explicitly selected a synthetic demonstration. Never expose the Skill name as a user choice.

1. For a synthetic demonstration, require the exact current-Session Artifact ID returned by `prepare_walmart_demo_data`. For business-data work, require a Workspace-relative `paimind.analysis-source-manifest/v1` file for an approved redacted historical snapshot. Never use synthetic data for business acceptance.
2. Call `analyze_fineline_investment` with either that manifest Artifact ID or the approved manifest path, the category profile, and a Workspace-relative `.fineline.data-result.json` output path.
3. Treat the returned `data_result` Artifact as immutable. Report its Artifact ID, source digest, business period, and failure state exactly.
4. Pass only the Artifact ID to downstream proposal-outline work. Never copy Python into the Skill, execute arbitrary scripts, or recompute the Tool result in model text.
