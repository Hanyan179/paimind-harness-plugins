---
name: bento-ppt
description: Create an evidence-backed PAIMind Bento HTML presentation with a validated outline and object-level provenance. Use when the user asks for a Bento deck, traceable presentation, HTML PPT, buyer proposal deck, or wants sources and facts linked to slides, chart points, or table cells.
---

# Bento PPT for Harness

Create the story and visual structure; leave validation, rendering, trace generation, and Artifact publication to Harness Tools.

1. Read the requested Workspace sources. Preserve every declared SHA-256 and business period; never invent a hash or source path.
2. When a current-Session Fact Set Artifact exists, build one compact `paimind.presentation-outline-blueprint/v1`. The Agent owns the story, slide structure, labels, and exact `factId` selection; it must not copy Sources, Fact records, values, hashes, bindings, or trace groups into the Tool call.
3. Let `create_fact_bound_presentation_outline` hydrate every selected Fact and Source exactly from the Fact Set. It also owns `displayValue`, numeric chart values, table cell values, object selectors, complete slide trace groups, `factSetArtifactId`, and `factSetFactsSha256`.
4. For a blueprint, use `factId` on a KPI or factual text object; chart `points[]` need only `factId`, `seriesKey`, `categoryKey`, and `label`; table cells need only `columnKey` and `factId`. Mark editable framing copy as `presentationOnly`. Use a complete `paimind.presentation-outline/v1` only when no Fact Set exists or a trusted upstream module already supplied that exact object.
5. Use varied layouts from cover, section, KPI, comparison, insight, recommendation, table, horizontal bar, lollipop, dot plot, bullet, slope, and line. Do not produce a deck of repeated text cards. Treat the slide header as framing, not as another body card: never repeat `slide.title` or `slide.narrative` in a title/text element. A cover should normally contain only the header plus up to four decision KPIs or one meaningful hero chart; move detailed context into later slides and trace.
6. Choose the presentation scale from decision density: use 6–10 purposeful slides for a concise update, 10–18 for a standard presentation, and 18–30 for a comprehensive buyer proposal. Generate more than 30 slides only when the user explicitly requests a long-form deck or a stress test. Never pad a deck to a page quota, and never silently collapse an explicitly requested long-form outline.
7. Select a registered HTML presentation design instead of inventing arbitrary CSS: use `generic-dark` with the general presets; `wmt-kids-mod` with `wmt-retail`; `strategy-grid` with `strategy-consulting`; `paramont-mountain` with `paramont-signature`; or `storybook-cutpaper` with `playful-storybook`. Always declare `aspectRatio: "16:9"`, `canvas: {"width":1280,"height":720}`, and a truthful density of `airy`, `balanced`, or `dense`.
8. Keep a slide title decision-sized and its narrative to roughly two lines at 1280×720. Preserve longer definitions, dimensions, measures, formulas, filters, and technical lineage in the Fact Set; the hydrator carries them into Trace Mode without asking the Agent to reproduce them.
9. Call `create_fact_bound_presentation_outline` with the exact `fact_set_artifact_id`, a `<name>.outline.json` path, and the compact blueprint.
10. Call `generate_traceable_bento_from_outline` with `<name>.bento.html`, the exact returned Outline Artifact ID, and the same exact Fact Set Artifact ID. Do not read and resend the full generated Outline.

The Tool schema is authoritative. Use this compact blueprint field map when a Fact Set is available:

- Blueprint: `schema`, `title`, optional `subtitle`, required `design`, and `slides[]`.
- Slide: `slideId`, registered `layout`, optional `eyebrow`, `title`, `narrative`, and `elements[]`.
- KPI or factual text/title: `objectId`, `type`, optional copy fields, and exact `factId`.
- Chart: `objectId`, `type: "chart"`, registered `chartKind`, and `points[]` with `factId`, `seriesKey`, `categoryKey`, and `label`.
- Table: `objectId`, `type: "table"`, `columns[]`, and `rows[]`; each cell supplies only `columnKey` plus exact `factId`.
- Presentation copy: set `presentationOnly: true`; it must not reference a Fact.

For a trusted full Outline without Fact Set hydration, the complete field map remains:

- Outline: `schema`, `title`, optional `subtitle`, optional paired `factSetArtifactId` and `factSetFactsSha256`, required `design`, `sources[]`, `facts[]`, `slides[]`.
- Design: `schema: "paimind.presentation-design/v1"`, registered `templateId`, registered `stylePreset`, `aspectRatio: "16:9"`, fixed `canvas` 1280×720, and `density`.
- Source: `sourceId`, `name`, Workspace-relative `path`, exact `sha256`, `format`, `role`, `period`, `summary`, optional `redaction` or `artifactId`.
- Fact: `factId`, `sourceIds`, `rawValue`, `displayValue`, `valueType`, `fieldPath`, optional `formula`, `method`, `definition`, `period`, `filters`, `factValuesChanged: false`.
- Fact trace semantics: optional `businessExplanation`, `dimensions[]`, `measures[]`, and `technical` with registered lineage, calculation, aggregation, source fields, join keys, code file, or runtime duration.
- Slide: `slideId`, `layout`, optional `eyebrow`, `title`, `narrative`, `elements[]`, and optional `trace`.
- Slide trace: `businessBlocks[]` plus `metrics[]`; each Metric groups one or more bound `factIds` and may declare a multidimensional `visualization`.
- Element: `objectId`, `type`, optional copy fields, `factIds`, `bindings`, optional `chart` or `table`; only decorative copy may set `presentationOnly: true`.
- Chart: `kind` plus `points[]`; every point has `seriesKey`, `categoryKey`, `label`, numeric `value`, `displayValue`, and `factId`.
- Table: `columns[]` and `rows[]`; every data cell has stable `rowKey`, `columnKey`, `displayValue`, and `factId`.
- Binding: `factId` plus selector `{kind:"object"}`, `{kind:"chart-point",seriesKey,categoryKey}`, or `{kind:"table-cell",rowKey,columnKey}`.

Do not search the Harness checkout for this contract. If a Tool rejects an invalid value or reference, use its path-qualified validation error to repair the Outline and retry the same Tool. Never remove requested `trace`, `businessBlocks`, `metrics`, `dimensions`, `measures`, `visualization`, Fact bindings, pages, or source evidence merely to satisfy an older Tool schema. Treat that rejection as `runtime_contract_incompatible`, stop without publishing a Bento Artifact, and report the incompatible path.

Do not pre-create or transform the target Outline with Write, Edit, Bash, or another file mutation Tool. Submit the blueprint directly to `create_fact_bound_presentation_outline`; the deterministic Tool owns hydration, validation, and publication.

Do not write HTML directly, recalculate or hand-copy verified facts, use `generate_bento_artifact` for traced work, or claim completion unless both compact-chain Tools return available Artifacts.
