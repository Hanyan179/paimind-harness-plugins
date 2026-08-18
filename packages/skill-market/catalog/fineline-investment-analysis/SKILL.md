---
name: fineline-investment-analysis
description: Run the PAIMind Walmart fineline investment analysis from a frozen, redacted, hash-locked source manifest. Use for Walmart buyer proposals, fine-line investment prioritization, category allocation, or when downstream outline generation needs a verified fineline data_result Artifact.
---

# Fineline Investment Analysis for Harness

1. Require a Workspace-relative `paimind.analysis-source-manifest/v1` file for a redacted historical snapshot. Do not accept live database credentials or synthetic data for business acceptance.
2. Call `analyze_fineline_investment` with the manifest path, category profile, and a Workspace-relative `.fineline.data-result.json` output path.
3. Treat the returned `data_result` Artifact as immutable. Report its Artifact ID, source digest, business period, and failure state exactly.
4. Pass only the Artifact ID to downstream proposal-outline work. Never copy Python into the Skill, execute arbitrary scripts, or recompute the Tool result in model text.
