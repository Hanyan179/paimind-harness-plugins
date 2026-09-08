# Agent avatar asset provenance

These files are visual projections for canonical Harness Agent Presets. They
never define an Agent identity, runtime, history or selection route.

## Source and conversion

The original six portrait sources come from the frozen product prototype at
`../../../../paimind-agent-skill-prototype/public/assets/agents/avatars/`.
The unified fallback comes from the same prototype at
`../../../../paimind-agent-skill-prototype/public/brand/paramont-group.svg`.
The twelve additions below are generated illustrations. No avatar is sourced
from the Harness runtime home.

The frozen prototype's `ASSET-LICENSES.md` marks the personal-role portraits as
private, user-authorized project assets. This package remains `UNLICENSED`;
these files must not be redistributed outside the authorized PAIMind project
without the depicted person's permission and the required Paramont trademark
review.

Portrait PNGs were resized from 1254×1254 to 96×96 and encoded with `cwebp`
quality 82, method 6. The Paramont source SVG was rendered on white at 96×96
and encoded with `cwebp` quality 88, method 6. The 96px master supplies 3× DPR
for the 28–32px circular UI slots without embedding the multi-megabyte PNGs.

## Published files

| Published WebP | Frozen prototype source | Bytes | Stable use |
| --- | --- | ---: | --- |
| `ai-workflow-architect-agent.webp` | `ai-workflow-architect-agent.png` | 2,014 | `ptc`, `cordis`, `personal-workflow-architect` |
| `content-expression-agent.webp` | `content-expression-agent.png` | 1,932 | `content-expression-agent` |
| `personal-coffee-agent.webp` | `personal-coffee-agent.png` | 1,788 | `minimal`, `personal-sales-review-coach` |
| `project-progress-agent.webp` | `project-progress-agent.png` | 1,660 | `project-progress-agent` |
| `senior-ai-product-manager-agent.webp` | `senior-ai-product-manager-agent.png` | 2,226 | `creator`, `personal-ai-product-partner` |
| `technical-expert-agent.webp` | `technical-expert-agent.png` | 2,028 | `standard`, `code` |
| `paramont-brand-fallback.webp` | `brand/paramont-group.svg` | 1,260 | Official `paimind` brand avatar; also invalid-id fallback |

Original avatar payload: 12,908 bytes. Exact mappings use only built-in
platform ids, plugin-owned ids and ids defined by the frozen prototype. Local
Harness profile ids are deliberately excluded. An unknown but valid canonical
id is passed through a pure FNV-1a hash with a final avalanche and projected onto the six published
portrait files. This deterministic visual projection is not identity metadata:
it creates no new id, persistence, Agent record or selection route. Empty or
invalid ids use the Paramont brand fallback. If a future stable Harness contract
exposes an avatar in Preset metadata, that native avatar has higher priority
than this projection and fallback.

## Presentation contract

The same resolver is used by the Composer `@` Agent source, Quick Agents and
the visible Preset picker. Images render as circular 28–32px slots with
`object-fit: cover`; valid unmatched ids receive a deterministic portrait while
invalid ids use the Paramont brand fallback. The native
candidate order, keyboard model and canonical Preset selection remain owned by
Harness. Native mode and plugin disposal remove injected images and restore the
original native icon-token text.

## Generated additions, 2026-09-07

Twelve new fictional character illustrations were generated using the built-in
image generation tool, one image per request, using `content-expression-agent.webp`
as a style reference only. [The prompt set](generated-avatars-2026-09-07.json)
records each exact prompt, retained source PNG path, and published WebP filename.
The original PNGs stay outside the repository. Runtime assets are 128×128 WebP,
encoded directly from the generated originals with cwebp quality 82, method 6.
The twelve additions total 29,898 bytes before inline bundling.

The expanded picker has eighteen portraits. New ids use explicit mappings; the
original six-file hash pool is unchanged, preserving existing automatic portraits.
An explicit `data-paimind-agent-avatar-choice` from the source-owned Agent Profile
wins over the automatic projection. The preset id still identifies the Agent.
Task Monitor's header and summary reuse these same reversible portrait seats.
