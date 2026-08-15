# FP15 Permissions and Administration Acceptance

## Final classification

`Technically Verified; Native Reuse + Retired` on 2026-08-15. FP15 is a truth-boundary package, not a new administration page. Harness native permissions are reused; synthetic RBAC and local Configuration Studio publication are retired; the headless PAIMind authorization contract is verified only as technical infrastructure.

## URL and native entry

- URL: `http://127.0.0.1:3080/`.
- Native default permission: sidebar `Settings` → `General` → `Permission`.
- Current Session permission: native Composer permission selector.
- Extension Center: `Settings` → `Extension Center` → `Governance`; no fake PAIMind Admin product should be listed.

## Acceptance sequence

1. Open General and confirm the permission control is Harness-native. PAIMind contributes no duplicate selector.
2. Close Settings and change the current Session permission through the native Composer. Confirm the native Session log/context reflects the change and the Agent remains usable.
3. Open Extension Center → Governance. Confirm no `Available` Administration or Configuration Studio capability exists without an authenticated provider.
4. Confirm there is no browser role switcher, member/developer/admin selector, enterprise publication action, SSO/MFA claim or client-only visibility claim.
5. Run the permissions-core contract suite and verify every missing/unavailable identity path fails closed.
6. Run production build, framework scan and exact Harness install/boot/remove/restore. Confirm native Permission Presets survive PAIMind absence.

## Completed verification

1. Harness General remained the sole default Permission selector, and the current Session Composer remained the sole runtime Permission selector.
2. A real Session was changed from `Workspace Write` to native `Read Only`. A real Agent called `generate_html_artifact`; Harness Sandbox returned `generation_failed`, the Native Job was `failed`, and no file or available Artifact was created. The Session was restored to `Workspace Write`.
3. Extension Center → Governance now shows an explicit no-provider status. It lists no fake Admin or Configuration Studio capability and explains that browser roles and Harness Full Access are not enterprise-administrator authority.
4. `permissions-core` accepts no caller-supplied role and has no default role matrix. Missing provider, missing principal, explicit denial and provider failure all fail closed with structured reasons.
5. The failure path exposed a pre-existing multiline Notification body rejection. Artifact failure bodies are now bounded and normalized to one line; a repeated real Read Only failure created one durable error Notification without breaking the Tool or Session.
6. Full gates passed: 57 test files / 178 tests, Type Check, Production Build, 18-client framework scan, exact Harness composition and zero upstream delta relative to the pre-run worktree.

## Required evidence

- Harness source/readme evidence that Permission Presets own Sandbox plus Approval only.
- Harness identity evidence that the current anonymous id is not an authenticated account.
- Frozen prototype evidence that role preview has no real RBAC and publication changes only a local draft.
- Automated denial matrix.
- Browser screenshots of native permission ownership and the empty/honest Governance category.
- Exact composition and upstream-delta output.

## Browser evidence

- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP15-native-permission-ownership.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP15-native-read-only-denial.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP15-governance-no-provider.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP15-failure-notification-safe.png`

## Explicit non-features

- No fake local admin account.
- No role passed from browser to a server operation as authority.
- No Configuration Studio write path without the authenticated UserAiApplication service.
- No assumption that Full Access means business-administrator rights.
- No attempt to add roles to Harness Permission Presets.
