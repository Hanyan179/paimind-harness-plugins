---
display-name: 沃尔玛采购提案大纲
name: build-walmart-buyer-proposal-outline
description: 整理业务分析和采购建议，形成可审阅的提案大纲。
---

# Walmart Buyer Proposal Outline for Harness

1. Confirm that `fineline-investment-analysis` and `white-space-analysis` produced available `data_result` Artifacts in the current Session and Workspace.
2. Call `build_walmart_buyer_proposal_outline` with exactly those two Artifact IDs and a Workspace-relative `.outline.json` output path.
3. Do not pass raw model prose, source filenames, or hand-copied analysis JSON in place of Artifact IDs.
4. Require the Tool-produced complete buyer proposal to contain 18–30 purposeful slides. It must cover the business context, opportunity diagnosis, proposal platforms, recommendations, decision asks, methodology, and closing without padding the deck to an artificial quota.
5. Preserve the Tool-produced `paimind.presentation-outline/v1` facts, source links, business blocks, multidimensional metrics, and technical lineage without recomputation.
6. Load `bento-ppt`, then call `generate_traceable_bento_from_outline` with this exact trusted complete Outline Artifact ID and no fabricated Fact Set ID. The interactive traceable Bento Artifact is the final deliverable. Never summarize, copy, or truncate the Outline before rendering.
