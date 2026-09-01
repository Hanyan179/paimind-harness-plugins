# R11 Conversation Artifact Renderer Acceptance

## Current status

`Local Development Verified; Browser Pre-Acceptance Passed` on 2026-08-27.

The repository now contains 38 packages: 31 runtime plugins and seven support
packages. `@paimind/conversation-artifact-renderer` is an independently
removable client plugin. It replaces the official turn-tail file pills only
when the Turn contains producer-declared Deliverables; removing it restores the
official row.

## Product contract

- Markdown, JSON, HTML, Bento, PPTX, PDF, spreadsheet, Word, image and generic
  files render as dedicated cards with a format label and format-specific
  action copy.
- The cards are a projection only. Harness remains the owner of Session, Turn,
  Deliverable and file bytes; `@paimind/artifacts` remains the owner of Artifact
  identity and viewer routing.
- Bento identity requires an exact registered Artifact in the current Session
  with `kind=html` and `previewKind=bento-deck`. A `.bento.html` suffix or model
  prose cannot manufacture provenance or enter the Bento workbench.
- Exact Bento cards call the canonical Artifact opener with both Artifact id
  and source id. Other formats retain the native `openFile` behavior and its
  registered provider viewers.
- More than four files collapse behind a reversible “show more” control. The
  responsive layout becomes a single column below 560 px.

## Passed

| Gate | Evidence | Result |
|---|---|---|
| Dedicated client package | Manifest, client entry, invariant, package role, bundle dependency and TypeScript project reference are registered | Passed |
| Semantic safety | Unit coverage rejects traversal, cross-Session matches and suffix-only Bento inference; the opener resolves the canonical id/source tuple | Passed |
| Conversation projection | Browser read-back showed three cards for Markdown, Outline JSON and Bento, with the former official `Produced` row absent | Passed |
| Bento route | Artifact `artifact:f4ceb13288058d52347b8f70` in Session `session-6530937f-89d9-4a0d-8670-553ce5afd98d` opened the named PAIMind workbench and loaded slide 1 of 6 | Passed |
| Bento modes | Preview rendered slideshow controls; Edit exposed copy editing with facts locked and no trace-loading status; Trace exposed the Presentation Trace fact list | Passed |
| Native fallback | The Outline JSON card opened `proposal-demo/deck/dg-category-growth-opportunity-bento.outline.json` in the existing safe data viewer | Passed |
| Duplicate Session boundary | The copied `(1)` Session has no matching product Artifact envelope, so its `.bento.html` stays an ordinary HTML card instead of borrowing provenance from another Session | Passed |
| Package gates | 38 package contracts, 38 tarball dry runs, strict publint, 113 NodeNext exports and 22 client bundle budgets passed | Passed |
| Functional gates | Type Check, 87 test files / 401 tests, Production Build, examples, framework and documentation checks passed | Passed |
| Release composition | Harness 0.1.1-rc.2 completed full isolated install, boot, remove and restore plus the existing missing-feature isolation matrix | Passed |
| Upstream sentinel | The Harness checkout retained zero tracked-file delta; the pre-existing untracked `ppt-output/` remains | Passed |

## Failed

No PAIMind-owned package, test, build, API, package-consumer, composition or
browser route in this increment is failing.

## Accepted fallback

A copied or branched Session may retain a native Deliverable path without the
producer's structured Artifact envelope. In that case the card displays the
file's actual format and uses the native viewer. Cross-Session Artifact lookup
is intentionally rejected because it would present another Session's trace and
producer facts as the current Session's provenance.

## Product Acceptance boundary

This increment has passed local shared-runtime browser pre-acceptance. Final
Product Acceptance for the complete PAIMind suite still retains the upstream
console and shared-profile mutation boundaries recorded in
[`R10-harness-0.1.1-rc.2.md`](./R10-harness-0.1.1-rc.2.md).
