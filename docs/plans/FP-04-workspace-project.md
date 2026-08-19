# FP04 Project/Workspace Bridge

> `PRR-01`: retain the headless `Project = Workspace` adapter; reopen and normally retire the visible Workspace-context action.

## Outcome

FP04 defines `Project = Harness Workspace` as an executable contract. DeepSeek Harness remains the only owner of Workspace identity, directory registration, Session accounting, ordering, navigation, persistence, and deletion. `@paimind/workspace-project` adds a read-only PAIMind bridge for later packages and one additive Workspace-context action in the native Session header; it creates no Project list, tree, route, or storage table.

## Capability mapping

| Prototype capability | Harness owner | FP04 decision |
|---|---|---|
| Project identity and list | Native `WorkspaceView.workspaceId` and `ctx.workspaces.list` | Reuse. PAIMind stores only opaque references to the native id. |
| Project directory | Native canonical `WorkspaceView.path` | Reuse. The bridge may display or ask the Host to open it, but never copies directory contents. |
| Project title | Native `WorkspaceView.title` | Reuse. Rename remains in the native Workspace menu. |
| Session ownership | Native ordered `WorkspaceView.sessionIds` | Reuse. Membership is resolved by Session id, never inferred from title or model prose. |
| Project entry, creation, search, ordering and deletion | `@deepseek-ai/dsh-client-ui-workspace` in the native sidebar | Reuse unchanged. PAIMind Launcher does not add a second Project destination. |
| Project overview | PAIMind additive header action over native Workspace and Session snapshots | Migrate only the useful read-only facts: title, path, active/total Session count, archived count, and updated time. Synthetic goal/context-revision counters are deleted. |
| Project task state and artifacts | FP05–FP08 | Not in FP04. Their records must carry the native `workspaceId` and, where applicable, `sessionId`. |
| Durable local document intake | No public byte-write/upload contract in selected Harness rc.5 | Remains FP06 scope. FP04 supplies ownership identity only and does not stage browser-only fake files. |
| Future cloud folder | Goal B provider work | Out of scope. Cloud support must replace/extend the Harness Workspace filesystem provider without changing PAIMind Project identity. |

## Contract and package boundary

`@paimind/workspace-project` contains:

- a pure native-to-PAIMind projector;
- `WorkspaceProjectBridge`, published as `ctx.paimindWorkspaceProject` through Cordis reflection;
- a cached observable snapshot for downstream FP05–FP15 consumers;
- `startSession(workspaceId)` and `openWorkspace(workspaceId)` delegates to native actions;
- one `conversation.session.header.actions` contribution named `paimind-workspace-context`;
- an invariant companion and no Host persistence.

Only `@paimind/harness-compat` describes the selected Harness structures. The feature package imports no `@deepseek-ai/*` module. Its public Project identity remains the existing `ProjectRef { workspaceId }` contract.

## State and failure paths

1. While the independent Workspace and Session baselines are not ready, the bridge exposes `loading` and no guessed current Project.
2. When both baselines are ready, each native Workspace becomes one read-only Project projection.
3. The current Project is the Workspace whose `sessionIds` contains the selected Session. A cwd match alone never claims ownership.
4. A deleted Workspace disappears from the projection; its retained Session becomes ungrouped, matching Harness semantics.
5. Native Workspace errors surface as `error` with sanitized message. Native conversation navigation stays available.
6. The header action renders only for a Session accounted by a Workspace. Opening the directory delegates to `ctx.workspaces.openPath`; a rejection is shown inside the popover and does not alter state.
7. Unloading the plugin removes the header action, subscriptions, and reflected service. Native Workspace/Session state remains untouched.

## Permission boundary

FP04 performs no authorization decision and no direct filesystem read. The native Host owns directory-picker, open-path, Sandbox, Approval, and Workspace mutation enforcement. No synthetic PAIMind business-permission layer is introduced without an authenticated provider.

## Verification plan

1. Pure tests cover loading, ready, error, archived Sessions, membership-by-id, ungrouped Sessions, and immutable native inputs.
2. Service tests cover cached snapshots, both upstream subscriptions, native action delegation, unknown Workspace rejection, and disposal.
3. Client tests cover slot/service registration, bilingual copy, open/close/Escape/outside behavior, narrow presentation, open-path failure, and no rendering for ungrouped Sessions.
4. Invariant, TypeScript, production build, framework boundary, real Harness install/boot/remove, native restoration, and zero-upstream-delta gates pass.
5. Native Workspace provider tests cover create, idempotent adoption, rename, reorder, Session accounting, archive, deletion, reconnect, and error contracts.
6. Browser pre-acceptance verifies the native sidebar remains the sole Project/Session navigation and the header overview follows real Workspace/Session changes across refresh and Harness restart.

## Upgrade impact

Version-sensitive Workspace/Session snapshot shapes and Cordis slot registration remain isolated in `@paimind/harness-compat`. A Harness upgrade must rerun projector contract tests, native Workspace provider tests, header browser scenarios, isolated composition, and zero-upstream-delta checks. Better Sidebar is not a dependency of FP04; its independent update cadence cannot change Project identity.
