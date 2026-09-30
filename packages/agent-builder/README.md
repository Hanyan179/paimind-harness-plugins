# `@paimind/agent-builder`

Headless PAIMind business-profile service over native Harness Agent Presets.

Package rules: [Plugin Authoring Standard](../../docs/standards/plugin-authoring.md).

## Responsibility

Role: **Headless plugin**. It owns its service or adapter boundary and exposes no independent browser surface.

## Public entry points

| Export | Target | Contract |
|---|---|---|
| `.` | `./lib/types/index.d.ts`, `./lib/index.js` | Public package export. |
| `./invariant` | `./lib/types/invariant.d.ts`, `./lib/invariant.js` | Public package export. |
| `./remote` | `./lib/types/remote.d.ts`, `./lib/remote.js` | Public package export. |
| `./publication` | `./lib/types/publication.d.ts`, `./lib/publication.js` | Strict immutable semantic publication schema and digest validation. No runtime grant or native Preset execution. |
| `./adoption` | `./lib/types/adoption.d.ts`, `./lib/adoption.js` | Strict native adoption input/receipt validation and deterministic reserved identity for trusted enterprise consumers; no Remote/Typert method or runtime grant. |
| `./typert` | `./lib/types/typert.d.ts`, `./lib/typert.js` | Public package export. |
| `./package.json` | `./package.json` | Public package export. |

## Dependencies

- Internal runtime dependencies: `@paimind/contracts` (`workspace:^`), `@paimind/harness-compat` (`workspace:^`).
- External runtime or peer dependencies: `@deepseek-ai/dsh-home-paths` (`0.1.0-rc.8`), `zod` (`^4.4.3`).
- Client service injection: None.

The manifest is authoritative for dependency direction and version selection.

The exported function entry and directly mounted service class share the same
required service list, including the native Skill registry. Direct Cordis class
composition must not reach an undeclared property or silently omit authoring
capabilities. This does not change the package dependency graph or grant member
publication/runtime authority.

## Lifecycle and failure

The bundle mounts the Node entry in Cordis. Declared services must be available before activation, and all actions, listeners and resources must be scoped to unload cleanup. Invalid configuration fails at the package boundary without mutating upstream Harness state.

Enterprise adopted presets require the compatibility layer's scoped origin-guard
installation witness before entering a native model step. This ephemeral witness
does not contain an execution grant; the original root guard independently checks
current authority for every native step and tool call. Missing, incomplete or
disposed guards fail closed. The deployment additionally requires a ready private
authority channel. A local full-preset/loop diagnostic with a deterministic model
does not certify current database authorization, final images or browser use.

Session bindings are product references, not proof that a native Session exists. Binding and migration writes validate the native identity and first-turn Preset through the compatibility facade, then validate the exact Profile revision within the existing product write queue. Missing/corrupt/foreign native Sessions and forged migration plans do not create bindings. Used historical bindings retain their original revision; migration uses a distinct native target. Exact retries retain the original receipt. Cold history is inspected by the native persistence owner without creating a live Session or copying its log into PAIMind state.

Profile deletion uses that same queue through the native owner's completion and refuses any persisted binding reference. Only an absent first-use state file is empty: unreadable or corrupt content, unsupported versions and invalid history rows fail closed without replacing the original file. Legacy bindings without a purpose remain readable. This protects product-managed references; it does not certify unregistered native references or replace native lifecycle ownership.

Verification receipts are server-derived in that same queue. A pass requires a normally completed native first human turn, a matching completed step with a visible uninterrupted model reply, and matching native Preset/Profile/binding versions. Error/cancelled/running turns, tool-only output and later-turn replies cannot pass. The legacy `recordVerification` shape remains, but caller fields are assertions checked against native evidence; caller explanations are ignored. Exact retries retain the original receipt and timestamp. These checks do not certify browser interaction or the business quality of a model response.

`adoptPublication` and `getAdoptedPublication` are same-process integration methods, deliberately not Remote/Typert browser methods. The former asks the native owner to copy Standard and then writes the exact semantic profile and provenance receipt in the existing write queue. Publication identity maps to a reserved native preset id; exact retries preserve it, while changed source/content, occupied unproven targets and unproven local Skill dependencies fail. Personal edit/delete/default/re-submit paths cannot write adopted versions. Readback validates source digest, complete profile, native composition and display metadata without repairing them. Interrupted copies remain sealed for explicit recovery rather than being deleted over potential history. Adopted versions are absent from the editable personal/business catalog; the enterprise catalog owns their presentation. These methods do not grant runtime permission. The managed image must keep model-step/tool execution closed until the live enterprise authorization lifecycle is connected and accepted.

Dependency publication snapshots, local adoption, adopted readback and the
business-skill selection projection share the Skill owner's public
`getSkillPackage` content-revision contract. Adoption checks before native copy
and again before staging promotion; every read/retry checks the currently
installed exact name and complete folder digest, including binary assets and
empty directories. Missing/unmanaged/changed packages, absent owners and system
name collisions fail without changing Skill bytes, enabling a user policy,
repairing the adopted Preset or deleting its history. The execution-proof bridge
therefore rejects local dependency drift before requesting enterprise authority.
Local content identity is NOT Skill publication approval, assignment, eligibility
or artifact delivery: the enterprise control plane still refuses publication
and execution of dependency-bearing Agents until that independent governance
and immutable version-transfer chain is implemented. A same-process trusted
caller must supply its authorization; a receipt alone never grants execution.

## Published files

`getPublicationSnapshot` reads only the caller-selected saved Profile revision under the existing write queue. It verifies the source's version and native composition, resolves exact managed Business Skill digests through the Skill owner's public service, and omits authoring Sessions and personal history. Stale, altered, linked or unavailable sources fail without repair. The publication subpath validates these semantic bytes; it does not create, install, bind or authorize a native Agent. Enterprise governance, dependency approval and runtime adoption remain separate consumers and acceptance gates.

The manifest allowlist is `lib/**/*.js`, `lib/**/*.js.map`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`. Generated build metadata, source tests, local Harness homes, coverage and credentials are excluded.

## Verification

- `pnpm exec tsc -b packages/agent-builder/tsconfig.json --pretty false`
- `pnpm run build` before the full repository test suite; managed native helper tests load built package exports in real subprocesses. Do not run the build concurrently with those tests.
- `pnpm exec vitest run packages/agent-builder/tests`
- `pnpm run check:packages`
- `pnpm run check:packs`
- `pnpm run check:api`
