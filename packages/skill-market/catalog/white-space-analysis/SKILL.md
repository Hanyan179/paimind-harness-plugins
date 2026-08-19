---
name: white-space-analysis
description: Run the PAIMind Walmart white-space analysis from a frozen, redacted, hash-locked source manifest. Use for assortment gaps, unmet demand, buyer opportunities, Walmart proposal evidence, or when outline generation needs a verified white-space data_result Artifact.
---

# White Space Analysis for Harness

1. Require a Workspace-relative `paimind.analysis-source-manifest/v1` file for a redacted historical snapshot. Keep its SHA-256 values and period unchanged.
2. Call `analyze_white_space` with the manifest path and a Workspace-relative `.white-space.data-result.json` output path.
3. Treat the returned `data_result` Artifact as immutable and report its Artifact ID and source linkage.
4. Pass only the Artifact ID to downstream proposal-outline work. Do not connect to Scintilla, run arbitrary Python, or infer missing business values.
