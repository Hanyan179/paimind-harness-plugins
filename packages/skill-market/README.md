# `@paimind/skill-market`

PAIMind center-column Skill Center, Business Skill authoring workspace, catalog adapter, and recoverable installer product layer over native Harness Skills.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Client + host product plugin**. It contributes a `sidebar.footer.action` entry and `shell.overlay` workspace, while the same package mounts one Authoring/Installer Remote. It also registers the source-owned `paimind-skill-authoring` and `paimind-skill-installation` System Skills with their Tools. Harness remains the canonical discovery, invocation, and execution owner; this package does not create a second Skill registry, run history, identity model, or permission system.

## User journey and state projection

- `Market`, `Built-in`, and `Installed` form one keyboard-navigable scope instead of duplicate navigation.
- Search, product categories, source and install-state filters operate only on real catalog or installed metadata. The browser incrementally renders bounded result batches; a future remote-scale catalog must add server-side cursor pagination. The product intentionally exposes no like or favorite control. Source, license, package contents, and runtime ownership use progressive disclosure.
- Catalog and local `SKILL.md` / ZIP packages enter the same inspect-first pipeline. Install and update are explicit confirmation actions; an update uses staging, backup, atomic replacement, and rollback on commit failure.
- `Create Skill` opens the same reviewable Package Editor used by conversational drafts. The Skill folder is the source of truth: `SKILL.md` is the entry file, while `scripts/`, `references/`, `assets/`, nested text files, and visible binary resources stay in the same managed package. The UI lazily pages the directory tree, reads one file on demand, and submits only file-level changes; untouched files remain byte-for-byte unchanged.
- An ordinary Standard conversation loads `paimind-skill-authoring` from the System Skill catalog. Its structured `paimind_skill_prepare_create` Tool result opens an unsaved draft in this existing Skill Center; no keyword router or automatic Save exists.
- Managed uninstall moves the Skill to a recoverable backup. Externally installed Skills remain visible but fall back to management by their original source.
- Enterprise-adopted fixed versions appear in the same Installed view with explicit read-only provenance. They cannot be edited, overwritten by market/upload updates or uninstalled as personal content. Revocation preserves historical bytes. Adoption alone is not eligibility: the original switches consume current enterprise assignment and local preferences; absent or withdrawn eligibility keeps use unavailable. Actual execution has its own current-login and immutable-version checks.
- The original Installed detail reads adopted content on demand through `readAdoptedSkillContent`, carrying only the exact adoption reference and a bounded directory/file selector. Each response verifies the actual installed package and current assignment before and after reading. Directory pages contain at most 100 entries; file chunks contain at most 32 KiB, including large/binary files, empty files and empty directories. Text is inert; binary or split UTF-8 chunks have an exact-byte view. Closing/unmounting discards late responses, focus/visibility rechecks the current selection, and errors clear earlier displayed bytes. This is not the control-plane sealed-archive preview or a generic native filesystem API.
- Runtime invocation does not appear as Skill Center product state. Agent Center owns Business Skill selection, and Harness owns the selected Session catalog and execution.
- Light, Dark, and System themes consume `--paimind-*` visual tokens with Harness fallbacks. Desktop uses list-plus-detail; narrow screens keep the list in the first viewport and open detail as a full-height sheet.
- Loading, empty, error, disabled, upload-cancel, install/update review, and recoverable-uninstall states are keyboard and screen-reader reachable.

## Public entry points

An optional `paimindSkillCenterContributions` UI service contributes one assigned catalog and an optional original-source action within the existing Installed detail. It is not a Skill or permission registry. The public client types expose narrow lifecycle-aware callbacks only: adopted navigation checks original provenance, current eligibility and the live directory version; the source reader rechecks managed personal ownership and returns only the current name/id/directory digest. It excludes enterprise-adopted and externally managed records and refuses retained callbacks after contribution removal. No raw native API, account or content copy is passed to the contributor. The archive digest is never substituted for the directory digest. These callbacks do not install, enable, write a user policy, select a session scope or send a model message. Provider loss removes its own contributions and cancels stale continuations; the native owner keeps all resources and history. Open source forms lock native source selection, search, edit, removal, attachment and policy controls until confirmation is settled or explicitly discarded.

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./catalog` | `./lib/types/catalog.d.ts`, `./lib/catalog.js` | Public package export. |
| `./recommended` | `./lib/types/recommended.d.ts`, `./lib/recommended.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./publication` | `./lib/types/publication.d.ts`, `./lib/publication.js` | Strict complete-package export/adoption protocol, provenance and staged transfer validation for the enterprise gateway. |
| `./remote` | `./lib/types/remote.d.ts`, `./lib/remote.js` | Public package export. |
| `./typert` | `./lib/types/typert.d.ts`, `./lib/typert.js` | Public package export. |
| `./client` | `./lib/types/client/index.d.ts`, `./lib/client.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

The host plugin accepts optional trusted `SkillMarketConfig.skillRoot`: one
canonical absolute Business Skill repository directory. Default installation
remains under `$DSH_HOME/.paimind-skill-market/skills`. An explicit deployment
root does not migrate or copy existing repositories; policy, uploads, staging
and recoverable backups remain in private Harness Home. An isolated deployment
must provision the repository and private staging on the same filesystem for
the existing atomic-rename contract, expose only that member's eligible resource
bytes read-only to execution, and keep source-owned mutations outside that
boundary. This option is not a member/remote path selector or a new registry.

Trusted same-process `beginPublicationExport`, `readPublicationExport` and
`releasePublicationExport` are deliberately absent from Remote/Typert browser
descriptors. The existing private cell channel consumes them for administrator
source capture. The original directory revision covers all file bytes and empty
directories; local installation receipts are excluded. Capture uses an immutable
ZIP and fixed 96 KiB chunks within the unchanged 256 KiB control frame, with
200 MiB expanded content, 216 MiB archive and 10,000-entry safety ceilings.
The original local installer has separate upload limits; this protocol does not
silently change those limits or assert that export also installs the package.

Target adoption uses the same original installer and private cell channel through
`beginPublicationAdoption`, `writePublicationAdoption`, `commitPublicationAdoption`,
`releasePublicationAdoption` and `getAdoptedSkillPublication`. None are browser
Remote/Typert methods. The existing installation receipt holds the full immutable
enterprise provenance; no second registry, repository or Skill invocation exists.
Whole archive and extracted directory digests, entry count and expanded size must
match. Original package names remain unchanged. Existing personal content, a
different publication or drifted target fails closed; only an identical receipt
and complete unchanged bytes can be reused without transfer. Normal mutations
and adoption promotion share the original package mutation queue. Adoption never
changes local eligibility/default policy, and local preferences cannot authorize
these enterprise versions. Final-image execution and Browser E2E remain Pending.

In managed cells the trusted root provides `paimindEnterpriseSkillEligibility`.
Its same-process `read` receives only exact immutable publication references and
returns their currently eligible ids through the existing pinned private cell
channel. The gateway identity and binding owners validate the active account,
tenant, fixed cell and lease in the original revocation transaction; the Skill
publication owner retains assignment precedence and exact-version ownership.
This metadata projection deliberately selects no login and grants no execution.
`listInstalled` exposes a non-persisted `publicationEligible` flag for the existing
UI; absent providers give false, malformed/disconnected/replaced providers fail
closed. Full installed bytes are checked before and after the read. The original
user-policy and runtime scope paths recompute eligibility without caching it or
writing grants to preferences. Selection withdrawal remains possible and does
not delete historical bytes. Real execution still uses its exact signed source,
current assignment and complete-byte verification, including after logout.

`readAdoptedSkillContent` is the single additive browser Remote for this adopted
read-only view. It uses the original owner and package mutation queue, allows at
most two outstanding reads per owner, and carries a 30-second cancellation signal
plus owner-lifetime cancellation. The gateway independently authenticates the
actual browser login; the eligibility provider checks current account/cell/lease
and assignment, not an invented session identity. No general package read/edit,
Skill authoring, user-policy write or execution permission is granted to members.
Adoption navigation uses the same restricted read, not member-denied
`getSkillPackage`. Each chunk rechecks the complete package;
large-package performance and real-browser acceptance remain Pending.

`setAdoptedSkillPreference` is the original owner's restricted member write for
the existing use/default switches. It accepts one complete immutable adoption
reference, an expected policy revision, one `enabled`/`direct` field and a boolean;
it never accepts system capabilities, another account or a replacement policy.
It serializes with the original policy writer, rechecks actual bytes and current
assignment before enabling, and allows withdrawing stored intent after assignment
revocation. A returned receipt has `runtimeGrant: false`: intent is not permission.
`listInstalled.publicationPreference` projects stored intent separately from
current eligibility, so revocation cannot conceal a checked switch or authorize use.

The same policy file now uses storage schema v4 with exact
`enabledAdoptedSkillIds`. Adoption alone never enables an enterprise Skill. Reads
of v1/v2/v3 preserve bytes and yield no explicit enterprise enables; the first
explicit write upgrades the file. Legacy enterprise use must be reconfirmed,
while personal Skill defaults, unrelated stored choices and system preferences
are retained. Direct defaults require explicit enablement. Runtime resolution
still checks current assignment and retains dependencies already captured by an
active native lifetime. No online migration is performed by this source change.
The original detail view cancels pending results when its native owner changes,
never falls back to general policy writes and never retries writes automatically.
Component and owner/integration checks do not replace real Browser E2E.

The native Loader remains optional. Startup, optional-policy application and
System Skill listing resolve it through the host's structural lookup; an absent
uninjected Loader property must not fail the entire Skill service. Lookup errors
remain observable. This does not manufacture a missing GenUI source or grant any
enterprise or authoring permission.

`getSelectedPublicationReferences` is a trusted same-process read used by the
existing private runtime execution bridge, not a browser Remote. It reuses the
original scope resolver for direct, Agent, workspace and temporary Session
selection and verifies each selected adopted directory's complete immutable
provenance. Unselected/disabled versions are excluded unless explicitly retained
by an already-using native lifetime or signed inherited source. Trusted
`requiredPublicationIds` must each match exactly one original adoption receipt;
missing, replaced or changed bytes fail instead of dropping the requirement.
This read does not re-enable user eligibility. It returns
bounded dependency intent (at most 128 enterprise references), never eligibility
or a grant. Native private execution, delegation and job checks carry this
explicit list and re-read local intent/bytes after the authority response. The
control plane checks the current exact login, cell and each publication's current
assignment. Missing legacy lists, duplicate names/identities and overflow fail
closed. No previous permission is cached. Active turns and captured native jobs
now retain dependency ids; the identity owner binds inherited ids to existing
signed sources. Terminal-delivery/cold-process lifecycle validation, current
eligibility UI Browser E2E and exact Agent-to-publication dependency edges remain
separate gates before final enterprise acceptance.

## Dependencies

- Internal runtime dependencies: `@paimind/contracts` (`workspace:^`), `@paimind/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `@deepseek-ai/dsh-home-paths` (`0.1.0-rc.8`), `fflate` (`^0.8.3`), `yaml` (`^2.9.0`), `yauzl` (`^3.2.0`), `zod` (`^4.4.3`), `react` (`>=18.0.0 <20.0.0`).
- Client service injection: `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-ui-conversation`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-slots`.

The manifest is authoritative for dependency direction and version selection.

## Lifecycle and failure

Target import is independently bounded to two handles per owner and five minutes,
with fixed 96 KiB chunks, whole-file read-back, cancellation and private staging.
Disposal/release waits for owned writes; cleanup removes only verified owned
staging, never an installed version or unknown replacement. Failed cleanup blocks
new imports. If native promotion succeeds but confirmation, current assignment or
database receipt/audit fails, the immutable target is retained but remains
ineligible. Retrying the original command verifies current authority and bytes;
it does not silently repair, overwrite or grant use.

At most two capture/export handles exist per source owner. Captures are cancelled
on plugin disposal, issued handles expire after five minutes, and release waits
for owned reads before closing/removing only that capture. Unknown previous-run
directories are never scanned or removed. Failed cleanup is observable and blocks
new exports. Cancellation, source-version drift, unsafe links, oversized packages
and malformed transfer replies fail closed without changing source or user policy.
When the gateway/transport is already closed, immediate release cannot be
confirmed; the source-owner expiry/disposal removes the unreachable handle.
The gateway never reconnects or borrows another transport to force cleanup.
The gateway stages bytes under current admin admission and revalidation; this is
not governance approval, assignment, native installation or execution permission.

An absent optional GenUI source is not advertised merely because Loader exists.
Stored choices survive source absence without blocking independent Skill Center
reads and are reapplied at an installed-source restart. Explicitly enabling an
unavailable source is still rejected; no source is installed automatically.

Harness discovers `./client` through `dsh.client`. Cordis waits for declared injected services before activation. The non-modal Center keeps the native sidebar visible and uses `@paimind/harness-compat` to portal only into the native conversation column; while open, only that column's native conversation occupant is inert and accessibility-hidden. A missing or ambiguous native anchor fails closed with no `document.body` fallback. The overlay Slot owns no route or domain state, and UI, listeners and registrations are scoped so hot reload or uninstall restores the native shell exactly.

## Published files

The manifest includes built JavaScript, reachable declarations/maps, `SKILL.md`, and `SKILL_AUTHORING.md`. The internal `lib/types/client/styles.d.ts`, `lib/types/publication-export.d.ts`, `lib/types/publication-import.d.ts` and their maps are excluded; their runtime implementations remain in the respective bundles. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/skill-market/tsconfig.json --pretty false`
- `pnpm exec vitest run packages/skill-market/tests`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs install-v1`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs update-v2`
- `DSH_HOME="$PWD/.dsh-home" node packages/skill-market/tests/live-flow.mjs uninstall`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
