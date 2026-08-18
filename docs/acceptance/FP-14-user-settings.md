# FP14 Personalization Acceptance

## Current status

`Technically Verified; Local Browser Pre-acceptance Passed; Product Model E2E Pending`.

The accepted product is a Codex-inspired Personalization section in native Harness Settings. It does not own Notifications, reduced motion, Memory, Language, Appearance, Model, Permission, Agent Preset or Composer behavior.

## URL and entry

- URL: `http://127.0.0.1:3080/`.
- Entry: native sidebar `Settings` → `个性化` / `Personalization`.
- Capability management: `Settings` → `Extension Center` → `Experience` → `个性化` / `Personalization`.
- There is no PAIMind Launcher or standalone Personal Center route.

## Must-pass acceptance cards

### AC1 — Canonical profile

1. Select Friendly or Pragmatic.
2. Save one About You value and one unique Custom Instruction.
3. Confirm the values are committed to the Harness `paimind-user-settings` namespace with native revision/CAS.
4. Refresh and restart Harness; confirm the same values recover.

### AC2 — Real context injection

1. Start a real Agent turn after saving.
2. Confirm the conversation records a `paimind:personalization` user-role context snapshot.
3. Confirm the exact preview content matches the effective snapshot.
4. Confirm the Agent follows the unique instruction when the current request does not conflict.
5. Send an explicit conflicting request and confirm the current request wins.

### AC3 — Disable and clear

1. Disable Personalization without deleting the saved profile.
2. Start another turn and confirm the runtime records cleared context and does not apply the profile.
3. Re-enable and confirm the saved profile becomes effective again.
4. Reset Personality to None and clear both text fields; confirm no context is injected.

### AC4 — Ownership boundaries

1. Confirm no Notification or reduced-motion control exists on the Personalization surface.
2. Confirm Notifications no longer inject or query `paimindUserSettings`.
3. Confirm Runtime Orbs follow `prefers-reduced-motion` only.
4. Confirm native Language, Appearance, Model, Permission and Agent Preset remain unchanged.

### AC5 — UI and isolation

1. Verify Chinese/Dark, English/Light and narrow layout.
2. Verify keyboard focus, switch state, personality selection, character limits and unavailable state.
3. Remove only `@paimind/user-settings`; native Settings, conversation, Runtime Orbs and Notification Center must remain usable.

## Compatibility note

Harness `0.1.0-rc.6` has a static `WEB_SETTINGS_NAMESPACES` allowlist and does not expose plugin-owned settings namespaces through native client `settings.describe`. FP14 therefore keeps the narrow PAIMind Typert Remote for `describe`/`mutate`, while the Host still uses the official Settings lifecycle, canonical Settings document, schema validation and native revision/CAS. This is a version-isolated transport adapter, not a second settings store.

## Completed local verification

- 73 test files / 224 tests, Type Check, Production Build, framework verification and documentation checks passed.
- The real `3080` Settings dialog showed `个性化`, all three Personality options, About You, Custom Instructions, exact injection preview and no Notification or reduced-motion control.
- Save, disable/re-enable, full Harness restart recovery, legacy raw-key cleanup and `560×800` responsive behavior passed.
- The final local profile was reset to enabled + None + empty text, which renders no context.
- A real model response and its visible `paimind:personalization` conversation snapshot remain required before restoring Product E2E Verified.

## Explicit non-features

- No automatic Memory or conversation-history inference.
- No Notification receive switch in Personalization.
- No PAIMind reduced-motion override.
- No duplicate Theme, Language, Model, Permission or Agent Preset controls.
- No browser/session storage fallback.
- No promise that personalization overrides the current request, Workspace instructions, Agent role, permissions or safety rules.
