---
display-name: 类目机会分析
name: category-opportunity-analysis
description: 结合经营表现寻找商品机会，并说明判断依据。
---

# Category Opportunity Analysis for Harness

## Selectable content offering

- `Category Opportunity Priorities (Recommended)` — Build, Expand, and Develop opportunity tiers with evidence-backed recommendations.
- `White-space & Growth Actions` — Opportunity gaps and an action path from momentum through market signal to growth action.

These are user-facing content and data choices. The orchestrating Agent may offer them after matching this Skill, but must not expose the Skill name or ask the user to select a Skill.

1. Require the exact current-Session Artifact ID returned by `prepare_category_demo_data`.
2. Call `analyze_category_opportunity` with that `manifest_artifact_id` and a Workspace-relative `.opportunity.data-result.json` output path.
3. Treat the result as synthetic demonstration data, not external market truth.
4. Preserve every returned Fact, source hash, field path, recommendation input, and lineage entry without recomputation.
5. Pass the Artifact ID to `build_presentation_fact_set`; never replace Tool output with model judgment.
