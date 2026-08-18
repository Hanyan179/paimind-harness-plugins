---
name: bento-ppt
description: Create an evidence-backed PAIMind Bento HTML presentation with a validated outline and object-level provenance. Use when the user asks for a Bento deck, traceable presentation, HTML PPT, buyer proposal deck, or wants sources and facts linked to slides, chart points, or table cells.
---

# Bento PPT for Harness

Create the story and visual structure; leave validation, rendering, trace generation, and Artifact publication to Harness Tools.

1. Read the requested Workspace sources. Preserve every declared SHA-256 and business period; never invent a hash or source path.
2. Build one `paimind.presentation-outline/v1` object with a required `paimind.presentation-design/v1` design declaration and stable `sourceId`, `factId`, `slideId`, and `objectId` values.
3. For each fact, preserve `rawValue`, choose a truthful `displayValue`, declare `fieldPath`, `method`, `definition`, `period`, `filters`, and optional `formula`, and set `factValuesChanged` to `false`.
4. Bind every non-decorative element to a Fact. Bind each chart point with `chart-point` plus `seriesKey` and `categoryKey`; bind each data table cell with `table-cell` plus `rowKey` and `columnKey`. Mark only decorations as `presentationOnly`.
5. Use varied layouts from cover, section, KPI, comparison, insight, recommendation, table, horizontal bar, lollipop, dot plot, bullet, slope, and line. Do not produce a deck of repeated text cards. Treat the slide header as framing, not as another body card: never repeat `slide.title` or `slide.narrative` in a title/text element. A cover should normally contain only the header plus up to four decision KPIs or one meaningful hero chart; move detailed context into later slides and trace.
6. Choose the presentation scale from decision density: use 6–10 purposeful slides for a concise update, 10–18 for a standard presentation, and 18–30 for a comprehensive buyer proposal. Generate more than 30 slides only when the user explicitly requests a long-form deck or a stress test. Never pad a deck to a page quota, and never silently collapse an explicitly requested long-form outline.
7. Select a registered HTML presentation design instead of inventing arbitrary CSS: use `generic-dark` with `startup-pitch`, `data-intelligence`, `storytelling-with-data`, `warm-editorial`, or `financial-elite`; use `wmt-kids-mod` with `wmt-retail` for Walmart buyer work. Always declare `aspectRatio: "16:9"`, `canvas: {"width":1280,"height":720}`, and a truthful density of `airy`, `balanced`, or `dense`.
8. For multidimensional evidence, declare `dimensions[]` and `measures[]` on Facts and group them through the slide's optional `trace.businessBlocks[]` and `trace.metrics[]`. Use `visualization` encodings when X, Y, series, row, column, label, or value semantics are known; never infer those semantics from rendered HTML. Keep a slide title decision-sized and its narrative to roughly two lines at 1280×720; preserve longer definitions in Fact and trace fields instead of shrinking the visible page into unreadable copy.
9. Call `create_presentation_outline_artifact` with a `<name>.outline.json` path and the full Outline.
10. Call `generate_traceable_bento_presentation` with `<name>.bento.html`, the same validated Outline, and the returned Outline Artifact ID.

The Tool schema is authoritative and exposes the complete object. Use this field map when planning before the call:

- Outline: `schema`, `title`, optional `subtitle`, required `design`, `sources[]`, `facts[]`, `slides[]`.
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

Do not pre-create or transform the target Outline with Write, Edit, Bash, or another file mutation Tool. Construct the full Outline as the direct input to `create_presentation_outline_artifact`; the deterministic Tool owns validation and publication.

Do not write HTML directly, recalculate verified facts, use `generate_bento_artifact` for traced work, or claim completion unless both Tools return available Artifacts.
