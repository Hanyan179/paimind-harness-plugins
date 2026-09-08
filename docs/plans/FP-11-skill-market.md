# FP11 Skill Market Plan

> Superseded（已替代）: 当前可安装技能市场规范为 [`../product/RQ-105-skill-market-prd.md`](../product/RQ-105-skill-market-prd.md)。本文件仅保留历史设计依据。

## Outcome

FP11 adds a PAIMind Skill Market over the one Harness Session-scoped Skill catalog. Harness Skill name is the only runtime identity. PAIMind adds search, invocation-policy filters, favorites and a detail surface keyed by that name; it does not create a Skill registry, copy Skill bodies, or persist a second attachment state.

## Native mapping

| Product capability | Decision | Canonical owner |
|---|---|---|
| Session/project-aware catalog | Reuse exactly | Harness `skill.list({ sessionId })` backed by `ctx.skills` |
| Skill invocation/mount | Reuse exactly | Plain Session prompt beginning with `/name`; Harness injects the resolved body at the pre-step boundary |
| Name, description, `whenToUse`, user/model invocation policy | Reuse exactly | Harness `SkillEntry` |
| Search, category/filter, favorite and detail presentation | PAIMind product metadata/view | `@hansen/skill-market`, keyed only by Skill name |
| Skill version, provider source, filesystem path and raw body | Not exposed by Harness `rc.6` browser API | No guessed value and no Host path crawl |
| Install/update/delete Skill | Out of FP11 `rc.6` scope | Harness providers and deployment/Profile |

The runtime source remains Harness `ctx.skills`. The public `skill.list` Remote is intentionally read-only and Session-addressed; it resolves the canonical Workspace cwd and active Agent Preset host-side. Invocation has no dedicated attach RPC and no durable selected-Skill state.

## Package and compatibility seams

### `@hansen/harness-compat`

- Adds the structural `HarnessSkillEntry` and `HarnessSkillsApi.list` client contract.
- Exposes the current Session binding and native conversation draft setter already used by Creator handoff.
- No feature package imports Harness modules or provider filesystem types.

### `@hansen/skill-market`

- Registers one independent Harness Settings section and one `Skills & Tools` Extension Center descriptor.
- Lists only the catalog returned for the current native Session.
- Provides search plus All / Model invocable / User-only / Favorites filters.
- Shows description, routing guidance and invocation policy in a detail panel.
- `Use in current Session` prefills `/${name} ` through the native conversation input and closes Settings. It never auto-sends.
- Favorites store only validated Skill names in browser-local product metadata.
- Version/files display an explicit `Not exposed by Harness rc.6` capability state; the product does not infer them from package names, model text or filesystem paths.

## State and failure paths

```mermaid
flowchart LR
    S["Current Harness Session"] --> L["skill.list sessionId"]
    L --> C["PAIMind catalog projection"]
    C --> D["Search / filter / detail"]
    D --> P["Prefill /skill-name"]
    P --> U["User reviews and sends"]
    U --> I["Harness native skill injection"]
```

- No current or attached Session: show a bounded empty state; never list a global guessed catalog.
- `skill.list` failure: show the native error and keep conversation/Settings usable.
- Session switch or Agent Preset selection: re-read the catalog; do not cache it as runtime truth.
- Missing binding: invocation remains disabled even if the catalog was previously visible.
- User-only Skill: visible and user-invocable but explicitly excluded from model discovery.
- Component failure/removal: native `/` trigger, native `skill` Tool row and conversation remain available.

## Verification

1. Pure tests: exact Skill objects retained, validated favorite metadata, deterministic search/filter and no ghost Skill.
2. Client tests: Session-scoped list, detail, favorite, user-only policy, prefill-without-send, missing binding, API error and plugin registration.
3. Framework scan: exact `Skills & Tools` category, no second registry/attachment store, no direct Harness import.
4. Full tests, Type Check, Production Build and exact Harness composition including isolated Skill Market removal.
5. Product E2E: in a real started Session, compare Market rows with the native `/` catalog, choose a real Skill, prefill and manually send it, observe the native Skill/context-injection row and a real response, then verify refresh, Harness restart, Chinese/English, Light/Dark and 560px narrow behavior.

FP11 will not claim version or file-view completion until Harness exposes a stable, permission-aware public detail contract. This honest capability boundary does not create a second Skill runtime; the Skill Market's v1 Product E2E is catalog-to-native-invocation.
