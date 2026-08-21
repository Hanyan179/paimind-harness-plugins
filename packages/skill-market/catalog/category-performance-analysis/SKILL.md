---
name: category-performance-analysis
description: Run deterministic category performance analysis from the PAIMind synthetic frozen-data manifest. Use for the Proposal Assistant demo, category momentum, department performance, POS trends, or when a traceable deck needs verified performance Facts.
---

# Category Performance Analysis for Harness

1. Require the exact current-Session Artifact ID returned by `prepare_category_demo_data`.
2. Call `analyze_category_performance` with that `manifest_artifact_id` and a Workspace-relative `.performance.data-result.json` output path.
3. Treat the result as synthetic demonstration data, not external market truth.
4. Preserve the returned Artifact ID, source hashes, periods, Facts, formulas, filters, and lineage without recomputation.
5. Pass the Artifact ID to `build_presentation_fact_set`; never hand-copy or calculate substitute metrics in model prose.
