# Native enterprise administration

Follows the [plugin authoring standard](../../docs/standards/plugin-authoring.md).
Scope and acceptance are tracked in the [enterprise delivery plan](../../docs/plans/enterprise-haas-delivery.md).

## Responsibility

原HAAS-04的成员配额与运行管理贡献到同一原生企业设置，复用宿主主题与导航，不增加工作台。管理员显式选成员、填原因和确认后读取资源意图、操作者观察及历史恢复记录；成员停用时只读。资源意图表单和准确已撤回单元的恢复请求分开，均固定所读修订并记入审计。排队、执行中、已核验替代、执行前拒绝与效果未知分别展示；成功历史不冒充当前健康，数据库撤回不冒充物理停止，持久存储配额明确未实施。提交、丢失响应、停止等待和版本冲突使旧观察失效，重新显式读取前不能再写入，不自动轮询或重发。草稿锁定成员和内部导航，键盘取消恢复触发焦点；身份变更或卸载取消等待并丢弃旧响应。组件证据不代表最终镜像或四档真实浏览器验收。

Contributes enterprise account and administration sections to native Harness Settings. Owns no app root, sidebar, route, theme, session store, user database, plugin loader or runtime. Uses existing UI foundation aliases and native icons through the compatibility facade. Current slice covers account, member/group management, Agent/Skill publication review/assignment, model configuration, connector configuration/approval/activation and audit; other enterprise management workflows remain pending.

The same connector subsection also offers an explicit, separately audited
lifecycle read. It distinguishes saved enabled intent, native dependency-gate
presence and native provider phase, and labels external connection as not probed.
It does not assert current database approval or tool permission. Changing member
or reason, canceling and unmounting discard snapshots and late responses. Native
numeric phase translation belongs exclusively to harness-compat. The lifecycle
view remains an observation, not an editable configuration or permission grant.
The adjacent governance controls use existing versioned approval and durable
activation commands. Real browser acceptance remains pending.

## Public entry points

Connector governance stays in the same native Settings subsection. An explicit
reason/confirmation reads one selected approval; no per-row prefetch is added.
Approval and enable/disable use the observed exact native configuration and cell
revisions. Both configuration and activation command records must be read before
new approval/activation; unknown effects block those writes. Enablement requires
the exact approved version/revision, while disablement requires no continuing
approval. Disabled/offline members remain selectable for stored-record reads and
revocation; revocation does not claim that the worker has stopped. Drafts and
in-flight requests lock the parent selection/navigation and are disposed on
identity loss or unload. Editing invalidates confirmation; cancel restores focus.
Lost/malformed responses invalidate the projection and require record readback,
never automatic resend. Replacement recovery is only offered after a different
observed cell revision and still requires server-side fencing verification. Its
historical effect remains unknown. None of these client projections grant access,
store configuration, or own connections/tools/runtime. Component checks do not
replace final four-width browser acceptance.

The administrator connector subsection uses the original Settings contribution and scoped form styles. Explicit member/reason confirmation reads only disabled native configuration metadata. New, full replacement and removal commands carry the observed cell and opaque configuration revisions; replacement never reads back existing URLs, arguments, headers or environment values. Both native transports have structured fields, bounded timing/retry controls and masked optional header/environment values. Potentially sensitive fields stay in their DOM elements only and are cleared on removal, transport change, cancel, submission and unmount. No storage, URL, automatic resend or retained secret retry payload is added. Unknown/malformed results block further edits until readback; history retrieval cannot resend configuration. An observed new cell revision permits only a server-verified request to end unknown historical tracking, never a claim that the original write succeeded. Audit labels distinguish saved-disabled, unchanged, conflict and unknown effects. These are component-level checks, not approval, enablement, a tool grant, real tool use or browser acceptance.

The original Settings contribution offers an audited, explicit member model-state read and separate administrator configuration forms. Reads report the native default selection, provider registration, catalog, named-credential presence/writability and exact settings/cell revisions without returning secrets. Missing record/OAuth inspection is distinct from a missing credential; directory visibility and presence do not prove authorization, quota or successful model calls. Cancel, owner changes and stale receipts discard the temporary view.

After a fresh read, configuration first checks the member's durable command metadata. Unknown/pending metadata blocks changes. Selection, credential set and credential removal each require a new explicit reason/confirmation and submit the observed settings/cell revision. Password input is write-only, cleared on submission, cancel and unmount, and never put in browser storage or retained for retry. Applied, revision conflict, uncertain and superseded outcomes remain distinct; a submission invalidates the editing snapshot. Stop Waiting is not cancellation/rollback. A lost response is resolved by a metadata read, never automatic resubmission. An observed replacement revision may request explicit server-side recovery verification; only the server's strict admitted-runtime check can supersede the old command, whose historical effect stays unknown. No new settings store, model catalog or runtime is introduced. Source/component checks do not replace final native-runtime, four-width browser or real model-use acceptance.

The optional `paimindFeatureManagementContributions` service belongs to the original Extension Center. This plugin registers one lifecycle-owned panel there, not a new Settings section or workbench. Current administrator identity gates an explicit target account, fresh native state readback, full-scope approval/revocation, preview, reason and impact confirmation. Native current-state projection, versioned approval and historical command receipt are separate, timestamped values; none is a browser permission cache. Unknown writes keep their exact request/key, and a fresh read finds the original durable command for explicit recovery. Stop Waiting never cancels accepted native work. Account/authority/provider changes discard old responses; after enterprise contribution loss the original owner does not reveal unguided native switches. The source UI still requires native management bypass closure, paired final runtime and real browser acceptance before online exposure.

The host `apply` entry registers the native instruction namespace and prompt section described below; `./client` is discovered by Harness. The browser consumes authenticated same-origin `/haas/v1` endpoints; no host RPC bypass or browser-provided principal is exposed.

Pending Feature commands display the server's current recovery condition separately from original history. A replacement runtime requires a fresh state read and an explicit member/runtime/original-command confirmation; the submitted current pin digest and original command path remain frozen on unknown-response retry. Missing, malformed or blocked recovery evidence does not enable the action. The control plane independently verifies unchanged member/data/image/policy, current approval and the full original native journal; the UI cannot choose a container, address or approval scope. Same-runtime recovery does not opt into replacement. This is source/component behavior, not accepted final-runtime or Browser E2E recovery.

Assigned Agent details use `/haas/v1/catalog/agents/{publicationId}` so the control plane checks current identity, publication state and explicit Agent/required-Skill assignments together before returning immutable content. The client rejects review-copy responses and never falls back to the author/admin review endpoint. A detail response is not an adoption or execution grant; later runtime use must reauthorize independently.

Dependency-bearing Agent approval reads `/haas/v1/admin/skill-publications` on demand and requires an explicit published id for every exact name/package digest. It never chooses the first same-name version automatically. The original review form retains reason/selection through lookup failures and aborts on disposal; successful approval reloads immutable edges. Agent assignment never implies Skill assignment or installation. Fixed ids are displayed separately from the native semantic snapshot and are verified by the original control-plane owners. Skill content review and assignment have their own native Settings subsection; source submission contributes to the original Installed detail. No component test is Browser E2E.

Member management includes opening an account, editing its display name and changing its active status. Name edits retain the login username, authority and native resource identity; the original name is sent for stale-edit detection. The server writes the change, before/after audit and replay receipt atomically. Opening or cancelling the inline form does not mutate the account; failed saves preserve the draft and logical command key, while successful saves restore focus to feedback and reload the authoritative list.

Group management adds a subsection within the same native administration contribution, not another navigation or application shell. It reads groups and candidate accounts on demand, creates empty groups, edits names/membership with expected revisions, and archives/restores with a reason while preserving identity and history. All same-tenant accounts may be grouped; membership never changes roles, re-enables an account, grants resources or grants access to another member's conversations. The control plane owns persistent membership and atomic audit/receipts. Failed saves preserve drafts and retry keys; Escape asks before discarding edits, restores action focus and does not close host Settings. In-flight writes are aborted on section disposal, identity change or unload. Source/schema changes still require isolated runtime composition and real browser acceptance before claiming delivery.

Publication governance is another subsection of the same native Settings contribution. It loads the review queue, members and groups on demand, then reads the selected immutable content and assignments at the same revision before offering a command. Explicit review and assignment forms include the selected version, reason and impact confirmation. Existing assignments retain their target identity while allow/deny or active state is changed. Native review copies have no run button. Failed or uncertain requests retain drafts and stable retry keys; successful writes discard stale projections and reload, and identity loss or unload aborts requests. Client parsing is a bounded display check, not a new authority or cryptographic verification service. Member submission and assigned/submitted catalogs now contribute through the original Agent Center owner. Native adoption is implemented through the original owner and private control path, but these source-level additions still require final immutable runtime and real browser acceptance.

`./auth-boundary` supplies the gateway's minimal administrator bootstrap/login and connection-recovery documents, shared stylesheet and external controller. It does not supply an application workbench: successful authentication replaces the document with the unmodified native Harness root. Passwords are not persisted by the client. The native contribution clears the entire old document on logout, account/tenant/role change or a cross-tab reauthentication signal; a signal never grants authority. Temporary identity unavailability goes to `/haas/recover`, without revoking the login or broadcasting a logout. Recovery renders independently of the identity database, retries bounded same-origin identity reads, and returns to login only after actual authorization rejection.

## Dependencies

Member session inspection is a reason-gated, administrator-only subsection of the same native Settings. Each explicit list, history page or refresh uses the exact `/haas/v1/admin/member-content` POST with a new correlation key, selected member and confirmation. Unlike mutation commands, a repeated key never replays cached content or skips current authorization. The identity owner commits an authorization audit before reading; the original administrator login and exact operator-pinned member runtime are rechecked before returning, followed by a completed-read audit. No member login, impersonation, runtime grant or session mutation is created. The original private transport only carries fixed native session list/history reads.

Inspection shows bounded native session metadata and inert user/assistant text events, not a complete attachment or rendered-conversation review. Hidden reasoning, tool data and non-text blocks are not disclosed; omissions remain visible. Native reads are bounded to 2 MiB, 20 messages per history request, 15-second cancellation, two in-flight requests per administrator login and eight globally. Close, Escape, member/reason changes, identity/provider replacement and disposal clear content and cancel pending requests; late responses cannot enter the new owner. Authorization and completed-read records are distinct and neither proves that a human understood all content. These source/component and isolated database/native-owner checks are not Browser E2E; online composition is not updated by this change.

Skill review is a separate native Settings subsection with the original Skill control-plane commands. It reads pinned sealed directory/file pages and presents inert text or exact hexadecimal bytes, including empty directories/files and all large-file ranges. Member content uses only the assigned catalog route, never the administrator review route. Source changes cannot change the selected review archive. Identity/version mismatches, errors, close and unload clear old content; a fully fetched SKILL.md plus explicit human confirmation is required by the approval UI, not an automatic whole-package approval. Attached files remain individually inspectable. Decline and withdrawal remain available for unreadable candidates. Review/assignment forms keep stable retry keys and exact ids/revisions; they never install, enable or execute anything. These are implementation and component-level claims, not browser acceptance.

The existing `@paimind/skill-market` client owner supplies an independently optional `paimindSkillCenterContributions` service. Its assigned catalog is read on demand with the current account, never through an administrator review copy. An explicit version confirmation invokes the existing complete-archive adoption command; current metadata and the native owner readback must match before opening Installed. The user may stop waiting without deleting possible native writes or losing the retry key. Adoption does not enable a Skill or change any usage scope. Real browser acceptance of the full Skill lifecycle remains pending.

The same contribution supplies an optional administrator-only source action in the original Installed detail. Its native owner callback reads a managed personal source and current full directory digest; no raw native API, principal, content copy or installer is passed to this plugin. Explicit reason and confirmation call only the existing `/haas/v1/admin/skill-publications` submission command, not review, assignment, enablement or execution. Current server identity and source verification remain authoritative. Unknown responses retain the exact version and stable command key; a five-minute request bound and Stop Waiting do not pretend to delete an already committed copy. Source/identity/provider unload aborts pending work, old results are ignored, and original native navigation is locked only while the form is open. Members and enterprise-adopted or externally managed packages get no source action.

Consumes the existing `@paimind/agent-market` public client contribution types and its `paimindAgentCenterContributions` service. A lifecycle-owned child injection waits for that service independently of Settings; enabling order is not assumed. The Agent Center owns navigation, native data and close protection. This plugin contributes current enterprise assignment/submission catalogs and exact-version personal submission, with no second app root or copied Agent records. The original business catalog is unchanged. Catalog availability is not native adoption; running published Agents and revocation enforcement remain incomplete until their real owner integration and browser acceptance.

Requires native Slots and Locale, shared UI foundation and the compatibility facade. The suite makes this package reachable but does not enable it in non-enterprise compositions. Enterprise gateway authentication and per-user runtime binding must be established before exposure; installing a plugin alone does not secure a bare Worker.

## Lifecycle and failure

The server entry now requires the native Settings and SystemPrompt providers.
For ISO-03 it registers `paimind-enterprise-instructions` (`enabled`, bounded
`instructions`) in the original per-cell Settings file and contributes one
native prompt section. Native variable substitution carries the text literally;
administrator text is not reinterpreted as template references. Assembly reads
the current owner snapshot without a second store, watcher or prompt cache.
The plugin never replaces the native identity, persona, tool catalogue, Agent
ownership or authorization guards. Unload removes its section, variable and
settings registration while preserving stored values. The member gateway still
denies all direct settings writes.

The same native Settings contribution now includes an administrator-only member
instruction form. An explicit member, reason and confirmation reads that exact
native namespace, its process-local revision and operator-pinned cell revision,
then the redacted durable command metadata. Writes require a fresh confirmation
and both revisions. The gateway revalidates current authority, commits the
single-sender reservation and audit before dispatch, and confirms only after an
exact native acknowledgement, state readback and completed audit. The journal
holds a keyed input digest and text length, not the instruction body. Unknown
results block new writes to that member; reading receipts never resends them.
Only a verified replacement of the old writer can end unknown tracking, whose
historical effect remains unknown. The form clears text after submission,
cancellation, identity loss or unload; dirty edits lock member/navigation, and
Escape restores focus after the controls are re-enabled. There is no polling,
automatic retry, second settings owner or arbitrary settings proxy. Native,
component and isolated database checks do not replace final-image, dual-worker
and four-width real-browser acceptance; ISO-03 remains pending.

Cordis owns settings registrations and scoped styles. One bounded identity refresh loop and all pending requests are disposed on unload. Both the administration section and its discovery descriptor are absent without a verified current administrator. Their native slot-provider lifecycle removes subscriptions and registrations on provider loss, authority change or unload; the server separately reauthorizes every operation. Rendering errors are contained to this plugin. Unload does not delete accounts or interrupt native conversation.

For a member or an unverified identity, the compatibility adapter projects the native Settings navigation to the account section and invokes its existing native action if a management section was selected. A verified administrator retains every native section. This does not change the native slot ledger, role permissions, API responses, or plugin startup. Unsupported/ambiguous native markup remains unchanged and server authorization still fails closed. Startup prefetch errors are a separate acceptance failure, not hidden by this projection.

## Published files

Runtime module, Harness client bundle, reachable declarations/maps and package documentation only. No standalone HTML, React runtime, credentials or screenshots.

The internal `client/auth-lifecycle.d.ts`, `client/style.d.ts`, `client/groups.d.ts`, `client/publications.d.ts`, `client/publication-view.d.ts`, `client/member-publications.d.ts`, `client/member-skills.d.ts`, `client/skill-content.d.ts`, `client/skill-review.d.ts`, `client/skill-submit.d.ts`, `client/member-content.d.ts`, `client/feature-management.d.ts`, `client/model-state.d.ts`, `client/connector-state.d.ts`, `client/connector-view.d.ts` and `client/connector-governance.d.ts` declarations and maps are excluded from the tarball. Their runtime code remains bundled; `client/api.d.ts` stays packed because the public client declaration actually imports it.

## Verification

Targeted component, transport, role and unload tests are not Browser E2E. Framework verification executes `tests/governance.spec.tsx`, rejecting failed, empty or pending runs; it is only a client-visibility gate, not server authorization or enterprise acceptance. The checkpoint records real browser administrator bootstrap/login, native member creation/status/audit, two-tab connection recovery during a bounded private database lock, and cross-tab logout evidence. Native member authorization, dual isolated Workers, full browser interaction, restore and merged acceptance remain required before completion.
