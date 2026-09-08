# Startup branding and bounded recovery

Date: 2026-09-08. Canonical local branch: `codex/unified-product-baseline`.

Native Settings now supplies title/favicon through a head injection before client plugin initialization. The main logo is the favicon fallback. User text is script-escaped. Startup and client feature consistency no longer force a navigation. At timeout, a visible manual reload button appears while native loading/readiness polling continues, allowing a late shell to recover.

Validation: branding tests and extension-center tests passed; typecheck/build passed. Chrome on 3080 loaded existing conversation history and its DOM confirmed the configured title and icon with no loading screen. The in-app browser showed the configured title and the manual retry error without automatic navigation, but remained stalled. Its CDP connection then timed out repeatedly, including a manual button action. The same pending script returned HTTP 200 in 4ms from the local server. This does not prove the root cause of the in-app browser stall; that remains unresolved. Do not claim complete browser acceptance from the successful Chrome path.

Local logs: `/tmp/hansen-boot-tests.log`, `/tmp/hansen-extension-regression.log`, `/tmp/hansen-boot-typecheck.log`, `/tmp/hansen-boot-build.log`, `/tmp/hansen-boot-runtime.log`. No user brand values or external permissions changed.
