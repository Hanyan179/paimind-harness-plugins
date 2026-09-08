# Goal A: PAIMind Harness Plugin Migration

## Revised main goal

DeepSeek Harness is the sole runtime and canonical domain authority. PAIMind is an out-of-tree plugin suite and Extension Center that adds product experience, generators, projections, adapters, capability classification and governance while reusing Harness Workspace, Session, Agent Preset, Tool, Skill, Job, Schedule and Deliverable objects. Goal A must prove real AI product loops; fixture-only component verification is insufficient.

The full rebaseline and staged execution are defined in [`../reviews/AI-NATIVE-PRODUCT-REALITY-REVIEW.md`](../reviews/AI-NATIVE-PRODUCT-REALITY-REVIEW.md). `PRR-01` and R1-R7 are closed; Goal A's complete final evidence is recorded in [`../checkpoints/R7-final-e2e-retirement.md`](../checkpoints/R7-final-e2e-retirement.md).

## Goal boundary

Goal A is the complete PAIMind migration program, not one product feature and not one Feature Package. It covers:

1. F0 plugin framework.
2. FP01 through FP16 in the ordered migration ledger.
3. Cross-plugin end-to-end verification.
4. Proof that DeepSeek Harness upstream source remains unchanged.
5. Retirement of the frozen prototype runtime after every valid capability is mapped to native reuse, a verified PAIMind plugin, or an explicit deprecation.

The current Feature Package is only the active execution unit inside Goal A. Completing FP01 does not complete Goal A. Cloud Folder Provider remains outside this goal and belongs to a later Goal B.

Harness's native Goal feature is reused where a product workflow needs it; it is not the mechanism or scope definition of this migration program.

## Execution policy after PRR-01

The revised product baseline was resumed after `PRR-01`; stages R1–R7 execute in order. A package cannot advance on Fixture/Preview evidence where Product E2E is required.

The program tracks two independent axes:

- Technical State: `Not Started | Grounded | Implemented | Technically Verified`.
- Product State: `Not Applicable | Native Reuse | Product E2E Pending | Product E2E Verified | Retired`.

The unqualified state `Verified` is no longer used for a user-facing package unless both its required technical gates and real Product E2E gates have passed.

## Previous autonomous execution policy

Goal A runs continuously without waiting for per-package human acceptance.

For each Feature Package, the agent must:

1. Ground the package in the frozen prototype and current Harness capabilities.
2. Create or update its implementation plan and acceptance/evidence document.
3. Implement the package without modifying Harness upstream source.
4. Pass focused automated tests, type checks, production build, framework boundaries, and real Harness composition appropriate to the package.
5. Pass browser pre-acceptance for every observable requirement, including required error, permission, theme, and responsive states.
6. Save evidence and update the migration ledger to `Verified`.
7. Immediately start the next numbered package only when no active Safe Checkpoint or Product Decision Gate pauses progression.

User review is asynchronous and non-blocking. New user feedback may reopen a verified package, change later scope, or add a regression requirement, but lack of a user reply never pauses progression.

The agent pauses only when:

- an automated or browser gate fails and cannot be repaired safely within the current scope;
- a credential, permission, external service, or unavailable upstream capability prevents meaningful verification;
- a product decision has materially different outcomes and cannot be resolved from the prototype, Harness source, or existing plan;
- the next action is destructive, externally publishing, or otherwise requires new authority.

## Verification states

- `Not started`: no package work has begun.
- `Grounded`: native reuse, migration scope, data, event, permission, and compatibility boundaries are confirmed.
- `Implemented`: code and package-local tests exist, but a required gate remains.
- `Technically Verified`: automated, real-composition, production-build, security and component browser gates passed.
- `Product E2E Pending`: the component is technically usable but the real Agent/Job/Session/Deliverable flow is not yet proven.
- `Product E2E Verified`: real Agent input, native execution objects, durable events, conversation entry and actual output interaction all passed without fixtures.
- `Native Reuse`: Harness already owns the feature and no PAIMind feature plugin is counted.
- `Retired`: the former PAIMind surface was intentionally removed because it duplicated or lacked product value.
- `Reopened`: later evidence or user feedback invalidated a previously verified result.

Acceptance documents remain required. They are executable evidence and optional review instructions, not human approval gates.

## Revised program stages

| Stage | Scope | Exit condition | Current state |
|---|---|---|---|
| R0 | Product reality rebaseline | Review, checkpoint, two-axis ledger and revised acceptance gates exist | Complete |
| R1 | Native surface rationalization | Launcher/empty marker retired; Extension Center foundation uses seven product categories; Workspace adapter is headless; Harness Registry remains technical truth | Verified 2026-08-14 |
| R2 | Product truth plane | Native Job-based Task button, durable `tool/result.meta` Artifact envelope, Session Projection, Generator registry and shared consumer chain pass | Verified 2026-08-15 |
| R3 | Real AI generation | PPTX/PDF/XLSX/HTML/Bento all pass the no-fixture Product E2E gate; FP06-FP08 may be restored | Verified 2026-08-15 |
| R4 | Native catalogs | FP09-FP11 use Agent Preset and Skill ids end to end | Verified 2026-08-15 |
| R5 | Event consumers and scheduling | FP12-FP13 reuse Job/Artifact/Schedule/Session; independent Session limitation is resolved honestly | Verified 2026-08-15 |
| R6 | Governance and developer surfaces | FP14-FP16 reuse Settings, Permissions and Plugin Inventory | Verified 2026-08-15; FP14 and FP16 Product E2E Verified, FP15 Native Reuse + Retired |
| R7 | Final E2E and retirement | Cross-plugin product loop, upgrade gate and prototype retirement pass | Verified 2026-08-15 |

## Previous program milestones

| Milestone | Scope | Exit condition |
|---|---|---|
| M0 | F0 | Install/remove, boot, isolation, build, contracts, and zero-upstream-delta gates pass |
| M1 | FP01-FP05 | Conversation shell, launcher, project bridge, Better Sidebar adapter, and PAIMind task tab are verified together |
| M2 | FP06-FP08 | Artifact discovery/viewer reuse, missing product renderers, and presentation trace are verified together |
| M3 | FP09-FP13 | Agent, Skill, notification, and scheduling workflows are verified together |
| M4 | FP14-FP16 | Settings, permissions, administration, and developer resources are verified together |
| M5 | Final E2E | Full installation-to-scheduled-artifact journey, restart, failure isolation, supported Harness upgrade, and prototype retirement all pass |

Milestones are reporting and regression checkpoints. They do not wait for human approval.

## Completion condition

Goal A is complete only when every unit is classified as `Native Reuse`, `Retired`, or `Product E2E Verified` as appropriate; the five-format real AI generation loop and final cross-plugin E2E pass; Agent/Skill/Scheduler use Harness canonical objects; the Harness upstream checkout has zero PAIMind delta; and every valid prototype capability is accounted for. Empty marker packages and fixture-only evidence do not satisfy completion.

R3 evidence: [`../checkpoints/R3-real-ai-generation.md`](../checkpoints/R3-real-ai-generation.md).

R7 final evidence: [`../checkpoints/R7-final-e2e-retirement.md`](../checkpoints/R7-final-e2e-retirement.md).

The 2026-08-15 post-branding completion audit re-opened all executable gates,
repaired a Scheduler browser-build boundary, and re-proved the current R7
composition. The audit also narrowed prototype retirement to the truthful
non-destructive condition: the old runtime entry and dependencies are retired,
while retained local source edits are preserved rather than reset.

Post-Goal-A product decision RQ-103 activates `@hansen/platform-scheduler` as
the single PAIMind Scheduled Tasks surface in the formal Bundle, together with
its Harness, HTTP and Feishu-bot Adapter services. The former
The former Session-local scheduler facade remained buildable but unselected at that checkpoint;
and the opt-in `@deepseek-ai/dsh-schedule` / `@deepseek-ai/dsh-time-context`
rows are no longer selected by the PAIMind profile. Platform API/SDK packages
remain separately deployable developer contracts; see
[`../product/RQ-103-platform-scheduler-prd.md`](../product/RQ-103-platform-scheduler-prd.md).

FP05 product-UI completion evidence: [`../checkpoints/FP05-product-ui-completion.md`](../checkpoints/FP05-product-ui-completion.md).

FP09 Agent Center evidence: [`../checkpoints/FP09-agent-center.md`](../checkpoints/FP09-agent-center.md).

FP10 Personal Agent Builder evidence: [`../checkpoints/FP10-agent-builder.md`](../checkpoints/FP10-agent-builder.md).

FP11 Skill Market evidence: [`../checkpoints/FP11-skill-market.md`](../checkpoints/FP11-skill-market.md).

FP12 Notification Center evidence: [`../checkpoints/FP12-notifications.md`](../checkpoints/FP12-notifications.md).

FP13 Scheduled Tasks evidence: [`../checkpoints/FP13-scheduled-tasks.md`](../checkpoints/FP13-scheduled-tasks.md).

FP14 User Settings evidence: [`../checkpoints/FP14-user-settings.md`](../checkpoints/FP14-user-settings.md).

FP15 Permissions and Administration evidence: [`../checkpoints/FP15-permissions-administration.md`](../checkpoints/FP15-permissions-administration.md).

FP16 Developer Resources evidence: [`../checkpoints/FP16-developer-resources.md`](../checkpoints/FP16-developer-resources.md).
