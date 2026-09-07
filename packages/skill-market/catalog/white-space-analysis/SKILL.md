---
display-name: 沃尔玛市场空白分析
name: white-space-analysis
description: 基于脱敏的历史数据快照，寻找尚未覆盖的商品机会。
---

# White Space Analysis for Harness

## Selectable content offering

- `Assortment White-space Opportunities (Recommended)` — Assortment gaps, unmet demand, and evidence-backed buyer opportunities.

Offer this as a content choice when either an approved Walmart manifest is available or the user explicitly selected a synthetic demonstration. Never expose the Skill name as a user choice.

1. For a synthetic demonstration, require the exact current-Session Artifact ID returned by `prepare_walmart_demo_data`. For business-data work, require a Workspace-relative `paimind.analysis-source-manifest/v1` file for an approved redacted historical snapshot. Keep its SHA-256 values and period unchanged.
2. Call `analyze_white_space` with either that manifest Artifact ID or the approved manifest path and a Workspace-relative `.white-space.data-result.json` output path.
3. Treat the returned `data_result` Artifact as immutable and report its Artifact ID and source linkage.
4. Pass only the Artifact ID to downstream proposal-outline work. Do not connect to Scintilla, run arbitrary Python, or infer missing business values.
