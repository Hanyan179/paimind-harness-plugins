---
name: category-opportunity-analysis
description: Run deterministic category opportunity analysis from the PAIMind synthetic frozen-data manifest. Use for Cosmetics, Party Favors, Stickers and Craft Kits opportunity prioritization or when a traceable deck needs verified recommendation inputs.
---

# Category Opportunity Analysis for Harness

1. Require the exact current-Session Artifact ID returned by `prepare_category_demo_data`.
2. Call `analyze_category_opportunity` with that `manifest_artifact_id` and a Workspace-relative `.opportunity.data-result.json` output path.
3. Treat the result as synthetic demonstration data, not external market truth.
4. Preserve every returned Fact, source hash, field path, recommendation input, and lineage entry without recomputation.
5. Pass the Artifact ID to `build_presentation_fact_set`; never replace Tool output with model judgment.
