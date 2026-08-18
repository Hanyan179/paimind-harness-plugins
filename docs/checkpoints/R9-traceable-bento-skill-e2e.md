# R9 Traceable Bento and Skill E2E

## Status

Phase 1 is `Local Product Pre-acceptance Passed`. The same real AI and browser
sequence must still pass in the shared test environment before Formal
Acceptance. Phase 2 Walmart packages, Tools and Skills are technically verified;
the four-Skill real business E2E remains pending an approved redacted Walmart
snapshot and its SHA-256 manifest outside this repository.

## Runtime and source boundary

- Harness: exact `@deepseek-ai/dsh@0.1.0-rc.6`.
- Better Sidebar: exact `0.12.2`; Office Viewer: exact `0.1.0`.
- PAIMind Python migration baseline: `1f9fd80ea073a4ab4b5665b2300f7930f3f0520f`.
- Local E2E source: redacted frozen AdventureWorks traceability JSON outside the
  source repository, SHA-256
  `eab5124302899005ff2997cab304dd78a358b4e05f862d360dfd68be865668b0`.
- Source manifest SHA-256:
  `462b5ec13f92b431f280e01da74ae36731735bf0a13bb9b2e0a7fa0a1967aaf2`.

No generated target existed before the run. The Agent did not receive a fixed
answer, fixture query parameter, target file or prebuilt Bento document.

## Real AI chain

The Skill Market explicitly installed and updated `bento-ppt@1.0.1`. Harness
reported it as available to the current conversation without restart. A real
`DeepSeek-V4-Flash` High session then recorded the system prompt, Skill catalog
and `bento-ppt` Context Injection before calling:

1. `create_presentation_outline_artifact` → native Job
   `paimind-artifact-1` → Artifact
   `artifact:63eda01ab8ef9800ffadc943`.
2. `generate_traceable_bento_presentation` → native Job
   `paimind-artifact-2` → Artifact
   `artifact:dc05c57998a3f3a2347493fb` → Trace
   `trace:9c53d0fdd6732eedd95aa881`.

The resulting outline contains 34 immutable Facts and eight slides. It produced
22 chart points and 88 data cells. Validation reported:

- `requiredBindings: 147`;
- `resolvedBindings: 147`;
- `resolutionRate: 1`;
- `factValuesChanged: false`;
- `sourceHashesVerified: true`;
- zero validation errors.

The four standard outputs are:

| File | Bytes | SHA-256 |
|---|---:|---|
| `adventureworks-executive.outline.json` | 95,484 | `b4c4be1f0beaeb5518412f7925d58c1f44b01fc34d6ad2e129eb7b6da28163ef` |
| `adventureworks-executive.bento.html` | 39,588 | `4d9bf3729612bba19e3f99523bef61c0656d81bb081ea2fefd5b01b0d2d92963` |
| `adventureworks-executive.trace.json` | 172,438 | `47783a72f29f324770641a805d0cbff26e6edaa610f70892311cf61b1fe00225` |
| `adventureworks-executive.validation.json` | 415 | `f46b1d3e9f2be7a81b6694d08867eea08519b26f5048bd3ea98718db622e65ab` |

## Browser acceptance

The real `127.0.0.1:3080` workbench passed:

- one `Preview / Edit / Trace` workbench rather than a separate Trace tab;
- source file, SHA-256, conclusion, formula, method and scope disclosure;
- object/KPI, chart-point and table-cell selection into the exact Fact;
- reverse Trace selection into the exact slide and visual selector;
- source-backed values remain non-editable while presentation-only copy remains
  editable;
- Light, Dark and `560×800` responsive rendering;
- refresh and three full Harness restarts restored Skill, Artifact, Trace and
  Viewer state;
- a clean browser tab reported zero Console errors;
- the Bento document contained no `src`, `href` or CSS `url()` resource;
- a wrong Sidecar hash returned HTTP `409 Trace hash mismatch`; a missing
  Sidecar returned HTTP `403 Trace unavailable`.

The initial browser run exposed two real defects and acceptance remained open
until both were repaired: source field paths containing spaces were rejected as
record IDs, and desktop Trace page buttons collapsed into unreadable columns.

Browser screenshots and generated files are retained outside the source
repository under
`/Users/hansen/Documents/PAIMind-workspace/codex-output/acceptance/traceable-bento-20260816`.

## 2026-08-17 long-deck stress supplement

This supplement verifies capacity and trace density; it does not change the
normal product page policy. A real `DeepSeek-V4-Flash` High Session loaded
`bento-ppt@1.1.1`, read five real Workspace deliverables, constructed the
Outline directly as Tool input, repaired three path-qualified validation
errors without deleting trace fields, and published:

1. Outline Artifact `artifact:3e0610492ae444b84f7555bf` through native Job
   `paimind-artifact-1`.
2. Bento Artifact `artifact:870e8ecca7ce299707bf6c49` and Trace
   `trace:fde4bc1243b1196cf5bb19b4` through native Job
   `paimind-artifact-2`.

The explicit stress request produced 41 slides, 104 Facts, five Sources, 41
slide trace records, 63 Metrics, 45 Business Blocks, 16 chart points and 96
table cells. Validation resolved all 275 required bindings, reported
`factValuesChanged: false`, verified all source hashes and returned zero
errors. The V2 Sidecar reference retained only its path, schema, SHA-256 and
byte count in the Session projection; the 378,576-byte trace document remained
outside the projection.

| File | Bytes | SHA-256 |
|---|---:|---|
| `long-traceable-acceptance-v2.outline.json` | 262,316 | `aeeffbb9c62f54d2ab00afdf4ef1cd561da0c56e3a69064772b584b63a4c6f0f` |
| `long-traceable-acceptance-v2.bento.html` | 70,050 | `bc12e6658595cac7087ddc52847eb4636556a6d985dd8a36eb532e3d5528f55a` |
| `long-traceable-acceptance-v2.trace.json` | 378,576 | `7960a201dcd60bac826511692b8c9bd9ff1bab178f6b3ed140af29face180531` |
| `long-traceable-acceptance-v2.validation.json` | 483 | `b5d50592c14a73d082e81e2c9476c52922b602eeee7a222b4425b38f73c83baf` |

The first real browser attempt exposed a Viewer contract mismatch: the
canonical generator accepted an explicitly empty `technical.joinKeys`, while
the Trace Viewer rejected it. After aligning both contracts, the Sidecar
passed Session/path/bytes/SHA-256/schema checks and the same recovered Artifact
opened in the shared `Preview / Edit / Trace` workbench. Browser interaction
then verified:

- reverse Trace selection to slide 11 and the exact horizontal-bar point;
- chart-point selection of `Beta · Q2 = 13` into its exact Fact and XLSX Source;
- reverse Trace selection to slide 10 and exact table-cell selection of the
  same `Beta · Q2 = 13` Fact;
- business evidence disclosure for source file, hash, definition, method and
  scope.

The restart used for this repair restored the Artifact and Trace. The current
browser log also contains one pre-existing `dsh-better-sidebar` completed-Agent
terminal reconnect error; it is not a Presentation Trace error and is not
counted as zero-Console evidence for this supplement. The earlier clean-tab
eight-slide card remains the current zero-Console evidence.

The catalog is now hot-updated to `bento-ppt@1.3.0`. Page policy is adaptive:
6–10 slides for a concise update, 10–18 for a standard presentation and 18–30
for a comprehensive buyer proposal. More than 30 slides requires an explicit
long-form or stress-test request. The Walmart deterministic outline now selects
five decision-worthy Finelines and targets 18–30 slides instead of padding the
proposal to 40–60.

## 2026-08-17 six-slide HTML presentation specification card

A second real `DeepSeek-V4-Flash` High run loaded `bento-ppt@1.3.0`, reread
`r3-verification-page.html`, and generated a normal-size deck rather than
reusing the long-deck stress artifact. The Agent called both native Tools and
published Outline Artifact `artifact:148c5c3da3ce524a4b5a2e9d` followed by
Bento Artifact `artifact:551ef250e720e56cf9d251af`.

The result is exactly six slides and explicitly declares
`paimind.presentation-design/v1`, `generic-dark`,
`storytelling-with-data`, 16:9, 1280×720 and `balanced` density. It contains 34
Facts, one hash-verified Source, five chart points and 21 table cells. Validation
resolved all 53 required bindings, reported `factValuesChanged: false`, verified
the source hash and returned zero errors.

| File | Bytes | SHA-256 |
|---|---:|---|
| `r3-html-presentation-spec.outline.json` | 60,289 | `8f68a3842b2040b7d1aa649e6e59f87d38912e4e5bd3a22b6cd4ec70071d3e7b` |
| `r3-html-presentation-spec.bento.html` | 27,112 | `f62c54978ae1c867b6f14efe10318cfa70be17312b673f37b13f9416bdbad25e` |
| `r3-html-presentation-spec.trace.json` | 63,598 | `2108d5a0dcc84d2fac5ab6d1a7675be3ed2e4eda8c6e08e616e9e7a1cb5710aa` |
| `r3-html-presentation-spec.validation.json` | 401 | `70bf04bbf8244070056232179744ade61d7b6c3393273e8288e1e7ad9bd151e9` |

The real browser verified icon-only Preview/Edit/Trace controls with hover and
focus tooltips, editable title/narrative fields, locked source and derived Fact
objects, direct Trace-icon Sidecar activation, KPI/point/cell forward
selection, and reverse slide/object selection. The browser Console contained
zero errors after the final runtime reload.

## 2026-08-17 direct Artifact routing and adaptive-fit card

The catalog was explicitly updated to `bento-ppt@1.4.0` and immediately became
available to the current conversation. A real `DeepSeek-V4-Flash` High run
reread the frozen `r3-verification-page.html` source (SHA-256
`ce680999a1614fad484815bc95d8a02d1c70f682b157c7cd638dcad63ed8ff84`),
called `create_presentation_outline_artifact`, repaired one path-qualified
binding error, then called `generate_traceable_bento_presentation`. It
published Outline Artifact `artifact:9b958cf60b717e83e72cb060` and Bento
Artifact `artifact:d8fcb5ec10b106f8d14f268f` without precreating either
target.

The result is exactly six slides with cover, KPI, comparison, horizontal-bar,
table and recommendation layouts. It contains 31 immutable Facts, one Source,
seven chart points and 18 table cells. Header titles and narratives are absent
from body title/text elements, and the cover contains exactly four decision
KPIs plus one presentation-only decoration. Validation resolved all 46 required
bindings, reported `factValuesChanged: false`, verified the source hash and
returned zero errors.

After the first browser pass exposed a seven-point horizontal-bar overflow at
the old minimum scale, the renderer was corrected to account for chart/table
density, preserve one-row chart labels at constrained widths and use measured
fit as the final guard. The same real Agent reused the unchanged Outline
Artifact and called only the Bento Tool to publish the repaired Bento Artifact
`artifact:06520db520eae861104bf1ac`.

| File | Bytes | SHA-256 |
|---|---:|---|
| `r4-direct-fit-e2e.outline.json` | 51,826 | `439f04c41481e3c06db19d92c6c5978766df918927cf8683807891a806343ee9` |
| `r4-direct-fit-e2e-v2.bento.html` | 26,952 | `a65a7247f8d03620c42f93cf4167688153d6cfeee36a0f0e64ba795b25a2d684` |
| `r4-direct-fit-e2e-v2.trace.json` | 55,063 | `2910fb459c787ff470b440652c042d984d082cbbeb5ca07d2120038f97a553e6` |
| `r4-direct-fit-e2e-v2.validation.json` | 408 | `0bc8144b2000faaeb574a2cf8ca92eb9eeafa8bb143ca7c2b909a8a67940642c` |

The real browser then verified:

- the Agent-returned Bento file button opens the Bento workbench directly,
  without first opening the PAIMind Artifact registry;
- `?paimindArtifactId=artifact:06520db520eae861104bf1ac` resolves the exact
  Session/Workspace/Artifact tuple, opens the same workbench and removes the
  consumed query parameter;
- all six pages report `fitOverflow=false`, no header/element overlap and no
  element crossing the 16:9 stage; the corrected chart page renders at scale
  `0.970` instead of the clipped `0.580` floor;
- Edit mode exposes three presentation-copy fields on the active page while
  keeping all source and derived Facts non-editable;
- a chart point resolves its business evidence, source, definition, method and
  scope, and reverse selection of the `Job` Fact focuses the exact
  `seriesKey=declared`, `categoryKey=job` point;
- a fresh browser tab opens the Artifact deep link with zero Console errors.

## Prototype mapping

The product interaction is grounded in the frozen prototype commit
`baa8a0f3bdf5b0787491c4c4fac627f2a8a30321`:

- `HtmlDeckPreview.jsx` keeps Trace inside the same Preview/Edit workbench,
  synchronizes active slide state, and maps `factId` back through
  `visualBindings` to `objectId + selector`.
- `presentation-trace-contract.test.js` defines Business Blocks, grouped
  Metrics, multidimensional Facts, Visualization encodings, technical lineage
  and chart/table selectors.
- The Harness implementation preserves those interaction and information
  semantics but replaces prototype `FileRecord`, Mock Data and browser-local
  state with native Session projection, Artifact/Trace envelopes, Jobs and a
  hash-verified Sidecar loader. No synthetic prototype fixture is imported.

## Automated and release gates

- `70` test files / `233` tests passed.
- Type Check, Build, API snapshot, packed-file audit, strict publint, NodeNext
  consumer, examples, framework boundaries and documentation checks passed.
- Exact Harness composition passed full install, boot, remove and restore;
  independent absence probes passed for Extension Center, Task Monitor, Agent
  Market, Agent Builder, Skill Market, Notification Center, Scheduler, User
  Settings and Developer Resources.
- The upstream Harness worktree delta remained zero; its pre-existing untracked
  `ppt-output/` directory was preserved.

## Remaining formal gates

- Repeat Phase 1 with the same real AI and browser cards in the shared test
  environment.
- Run the Phase 2 four-Skill Walmart chain against an approved redacted real
  snapshot and verify both analysis `data_result` Artifacts before the outline
  and Bento Artifacts.
- Repeat the traceable Bento generation under native Read Only permission and
  confirm failure without a success Artifact. Existing generic permission E2E
  is not substituted for this new Tool-specific card.
