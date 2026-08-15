# FP14 Personal Center and Settings Acceptance

## Current status

`Technically Verified; Product E2E Verified` on 2026-08-15. Native Settings remains the only owner of Language, Appearance, Model, Permission, Agent Preset and Composer. PAIMind owns only a canonical settings namespace for real personal-prompt, reduced-motion and future-notification consumers.

## URL and entry

- URL: `http://127.0.0.1:3080/`.
- Entry: native sidebar `Settings` → `PAIMind Preferences`.
- Capability management: `Settings` → `Extension Center` → `Experience` → `PAIMind Preferences`.
- There is no PAIMind Launcher or standalone Personal Center route.

## Preparation

- Exact Harness `0.1.0-rc.6`, formal PAIMind Bundle and a writable local Settings provider.
- One attached Workspace and live real-model Session.
- Existing Notification and Artifact plugins for the cross-preference product checks.

## Acceptance sequence

1. Confirm Harness General still owns Language, Appearance, default permission and composer behavior; Harness Models and Agent Preset retain their native pages.
2. Open PAIMind Preferences. Save a unique personal instruction, response style/length/structure/citation preferences and confirm committed state.
3. Ask the real Agent a neutral question. Confirm its response follows the unique instruction and the conversation shows the PAIMind preference Context Injection.
4. Refresh and restart Harness; verify both the form and a later Agent turn retain the preference.
5. Clear the instruction; verify a new turn no longer contains the unique token.
6. Switch motion from System to Reduce. Trigger a real thinking/tool state; confirm the PAIMind Runtime Orb is paused but its state and native text remain visible. Restore System.
7. Switch notifications Off. Generate a real HTML artifact and confirm native Tool, Job, Deliverable and Viewer succeed but the PAIMind unread count does not increase. Restore All, generate a second artifact and confirm one new message appears.
8. Check Chinese/Dark, English/Light and 560×800 settings layout.
9. Disable only PAIMind User Settings. Confirm native Settings, conversation and existing Notification records remain usable. Restore the formal Bundle.

## Completed verification

1. A unique personal instruction was committed to `.dsh-home/settings.yaml`, entered the real Harness System Prompt, and a real DeepSeek turn returned exactly `FP14-PREFERENCE-VERIFIED`. Clearing the field removed that behavior from the next Bash turn.
2. Browser refresh and a full Harness stop/start restored the canonical preference snapshot. The final profile was reset to empty instructions, `motion: system` and `notifications: all`.
3. With `motion: reduce`, a real active Think/Bash turn exposed only active Runtime Orbs with `data-paused="true"`; native row text and completion remained visible. Restoring `system` removed the PAIMind reduction attribute.
4. With notifications `off`, a real Agent generated `fp14-notification-off-e2e.html`; Native Job, structured Artifact context, conversation link, Side Card Viewer and sandboxed HTML all completed, while the unread badge stayed at `1` and the Notification dialog contained zero matching rows.
5. After restoring `all`, a second real generation completed and produced exactly one `FP14 Notification All E2E` row; the unread badge advanced from `1` to `2`.
6. Chinese/Dark, English/Light and a real `560×800` viewport passed. Harness General remained the native owner of Language, Appearance, permission and Agent Preset.
7. Full gates passed: 57 test files / 174 tests, Type Check, Production Build, 18-client framework scan and exact Harness composition on `@deepseek-ai/dsh@0.1.0-rc.6` plus `dsh-better-sidebar@0.11.0`.
8. The isolated PAIMind-User-Settings-absent profile booted with native owners and all other product packages present; cleanup and zero upstream delta relative to the pre-run Harness worktree passed.

## Browser evidence

- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP14-native-settings-ownership.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP14-personal-prompt-live.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP14-reduced-motion-live.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP14-notification-off-artifact-live.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP14-notification-all-live.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/FP14-settings-en-light-560.png`

## Compatibility note

Harness `0.1.0-rc.6` has a static `WEB_SETTINGS_NAMESPACES` allowlist and does not expose plugin-owned settings namespaces through native client `settings.describe`. FP14 therefore mounts a narrow PAIMind Typert Remote for `describe`/`mutate`, but its Host still uses official `installSettingsSection`, canonical `settings.yaml`, schema validation and native revision/CAS. This is a version-isolated transport adapter, not a second settings domain or an upstream patch.

## Explicit non-features

- No synthetic Memory or history-reference store.
- No browser notification delivery without a provider.
- No duplicate Theme, Language, Model, Permission or Agent Preset controls.
- No browser/session localStorage fallback.
- No promise that personal preferences override Workspace instructions or Agent Presets; higher-priority native configuration may win.
