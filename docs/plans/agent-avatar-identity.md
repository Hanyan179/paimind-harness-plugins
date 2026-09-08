# Conversation Agent identity and avatar library

Existing plugin enhancement requested on 2026-09-07: show the selected Agent's
name and chosen portrait without opening the task summary, use the same portrait
inside the summary, and extend the six-choice library with twelve illustrations.

## Ownership and conflict review

| Dimension | Decision |
| --- | --- |
| Product surface | Task Monitor extends its existing session-header contribution with an identity button that opens its summary. Agent Market keeps the avatar picker. Visual Experience renders shared portrait seats. |
| Domain entity | Read the current native Session's preset and the source-owned Agent Profile. Never infer identity from response text or the global default. |
| Writable state | Agent Builder remains the only writer of profile `avatarId`; no new storage. |
| Runtime service | Reuse Task Monitor's optional resource reader and Visual Experience's reversible avatar presenter. No new service or execution path. |
| Harness compatibility | Use existing typed header slots and native Session selectors through Harness Compat; no upstream DOM adapter or runtime edits. |
| Failure and unload | Unknown names have a readable fallback. Native icons remain if portraits fail or Visual Experience is disabled. Removing Task Monitor restores its native header seats. |

Browser acceptance also found that Compat is embedded separately in each client
bundle, so a module-local avatar map was not shared between Agent Market and
Visual Experience. Compat now shares that same transient presentation object
within the current browser document. Agent Market publishes saved choices for
its installed surface lifetime, including while the Center is closed, and
removes its contribution on unload. This does not add profile storage or change
native preset selection. Independent module-copy and lifecycle tests cover it.

## Acceptance

Verify configured portraits without first opening Agent Center, historical
Session switching and stale read isolation, image failure/unload fallback,
eighteen selectable portraits, and saved selection after reload. Preserve the
original six-portrait deterministic fallback pool so existing avatars do not
change merely because the library grows. Use the original full local Harness
profile on port 3080 for browser acceptance.
