# PAIMind HTML Presentation Specification

## Contract ownership

`paimind.presentation-outline/v1` remains the content, fact, object, and
binding authority in `@paimind/presentation-contracts`.

`paimind.html-presentation/v1` is owned by `@paimind/generator-bento` and
defines how that Outline becomes a deterministic offline HTML presentation.
The Agent chooses only registered design intent; it never writes arbitrary
HTML or CSS.

## Required design declaration

New Outline Tool calls include `design`:

```json
{
  "schema": "paimind.presentation-design/v1",
  "templateId": "generic-dark",
  "stylePreset": "data-intelligence",
  "aspectRatio": "16:9",
  "canvas": { "width": 1280, "height": 720 },
  "density": "balanced"
}
```

Legacy Outline values without `design` remain readable and resolve to
`generic-dark` + `startup-pitch` + `balanced`. The Tool schema requires the
field for newly generated work.

## Registered design system

| Layer | Registered values |
|---|---|
| HTML template | `generic-dark`, `wmt-kids-mod` |
| Style preset | `startup-pitch`, `data-intelligence`, `storytelling-with-data`, `warm-editorial`, `financial-elite`, `wmt-retail` |
| Density | `airy`, `balanced`, `dense` |
| Canvas | 1280×720 logical pixels, fixed 16:9 |

The template identities adapt the two HTML shells registered by the frozen
PAIMind Python baseline `1f9fd80ea073a4ab4b5665b2300f7930f3f0520f`.
The larger `paimind-presentation` / `ppt-master` visual libraries are reference
sources for style roles; their Python and PPTX runtimes are not copied into
Harness.

## Edit and evidence boundary

- Editable in Edit mode: slide eyebrow, title, narrative, and elements marked
  `presentationOnly`.
- Read-only: any element bound to `source_value` or `derived_metric` facts,
  including chart points and table data cells.
- Switching between Preview, Edit, and Trace keeps the same iframe document;
  inline copy changes are working-draft changes for the active viewer session.
  Publishing a durable revision remains an Artifact/Tool operation and must
  produce a new validated Artifact rather than mutating evidence in place.
- The preview request carries exact Artifact, source, and trace identities. On
  the first Trace-mode activation the Inspector selects that exact Sidecar and
  fails closed if the tuple cannot be resolved; it never infers traceability
  from the HTML path, title, or body.

## Output guarantees

Every generated `.bento.html` carries:

- `paimind.html-presentation/v1` metadata;
- explicit template, style, density, canvas, and aspect ratio;
- offline CSP with no external script, stylesheet, image, or font request;
- stable slide/object/data-point/cell selectors;
- edit annotations and fact locks;
- the Preview/Edit/Trace runtime message contract.
