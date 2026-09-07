---
display-name: 类目经营分析
name: category-performance-analysis
description: 分析商品类目的销售与经营表现，形成有数据依据的结论。
---

# Category Performance Analysis for Harness

## Selectable content offering

- `Sales Performance & Momentum (Recommended)` — Sales, units, average price, and weekly trend from the verified synthetic snapshot.
- `Department Mix & Roles` — Department-level performance and contribution for the selected Dollar General departments.

These are user-facing content and data choices. The orchestrating Agent may offer them after matching this Skill, but must not expose the Skill name or ask the user to select a Skill.

1. Require the exact current-Session Artifact ID returned by `prepare_category_demo_data`.
2. Call `analyze_category_performance` with that `manifest_artifact_id` and a Workspace-relative `.performance.data-result.json` output path.
3. Treat the result as synthetic demonstration data, not external market truth.
4. Preserve the returned Artifact ID, source hashes, periods, Facts, formulas, filters, and lineage without recomputation.
5. Pass the Artifact ID to `build_presentation_fact_set`; never hand-copy or calculate substitute metrics in model prose.
