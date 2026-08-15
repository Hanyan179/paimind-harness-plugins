# R2 Product Truth Plane Checkpoint

## Decision

R2 is verified as a Product Truth Plane, not as completion of the multi-format artifact product. It proves that a real Harness Agent can invoke a PAIMind Generator Tool and that Task Monitor, native Deliverables, Artifact Preview and restart replay consume one canonical Session/Job chain. It does not promote FP06-FP08 to Product E2E Verified.

## Locked ownership

| Object or surface | Canonical owner | PAIMind boundary |
|---|---|---|
| Plugin load, version, dependency, enable/disable and Fiber state | Harness Plugin Registry | Extension Center joins by package id and never becomes a runtime or navigation launcher |
| Capability classification | PAIMind Extension Center | Exactly Experience, Content & Rendering, Agents, Skills & Tools, Automation, Governance and Developer |
| Workspace, Session, Agent Preset, Tool, Job and Deliverable | Harness | PAIMind contributes tools, projections, adapters and product metadata; it creates no shadow domain store |
| Task entry | PAIMind Task Monitor | Independent Header button; reads exact PAIMind Native Jobs; never lives in Better Sidebar |
| Bento | PAIMind Renderer Plugin | Registers only through stable Preview/Side Card Adapter; no Better Sidebar internal import |

## Real AI product loop

- Started from a new empty Workspace at `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/r2-ai-native-e2e` and a new native Session. The target file did not exist before the request.
- The live Agent Preset invoked `generate_html_artifact`; the provider started a native `paimind-artifact` Job and delegated the write through Harness's native `write` Tool with the original execution token as parent.
- The successful Tool Result carried `ArtifactProducedEnvelopeV1` in `meta`, including exact Workspace, Session, task, producer, path, preview kind, state and revision identities.
- The native Deliverable action opened the real HTML Viewer. Updating the same path produced the same artifact identity at revision 2 and refreshed the viewed content.
- An overwrite attempted before the native observation requirement failed; the Agent then read and retried successfully. A separate `../r2-forbidden.html` request failed native Workspace/Sandbox policy and was not retried.
- The independent Task Monitor displayed one failed overwrite attempt, one completed revision-2 Job and one denied-path Job. It correlated the successful row to the same artifact revision.
- No clickable Deliverable was created for either failed attempt. The native conversation remained usable.
- Same-process browser refresh preserved the three process-local Jobs and the projected artifact.
- Harness restart truthfully reset Job history to zero while replaying the Session Projection, successful Deliverable, file and revision-2 Viewer. PAIMind did not persist a duplicate Job history.

## Verification evidence

| Gate | Result |
|---|---|
| Full automated gate | `37` test files, `108` tests passed |
| Type Check and production build | Passed |
| Framework boundaries | Passed: nine client plugins; exact seven-category Extension Center; Registry technical-only; independent Native Job Task button; adapter-only Bento; zero direct Harness imports outside `harness-compat`; zero direct Better Sidebar imports outside `better-sidebar-adapter` |
| Exact composition | Harness `0.1.0-rc.6` + Better Sidebar `0.11.0`; install, boot, nine clients, remove, restore, eight independent clients without Extension Center, cleanup and zero upstream worktree delta passed |
| Browser refresh | Task count remained `3`; successful report entry remained available; denied-path entry count remained `0` |
| Harness restart | Task count became `0`; successful report entry remained available; denied-path entry count remained `0`; revision-2 Viewer reopened |

Browser evidence:

- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/R2-native-task-monitor-success-failure.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/R2-native-task-monitor-failure-isolation.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/R2-real-html-revision-2.png`
- `/Users/hansen/Documents/PAIMind-workspace/codex-output/qa/R2-restart-recovery-revision-2.png`

## Honest remaining gates

- FP05 remains Product E2E Pending only for its remaining product-UI completion evidence: independent Dark/narrow browser state and isolated removal of Task Monitor while the native generation chain stays usable.
- FP06 remains Product E2E Pending until real Agent-generated PPTX and PDF pass the complete gate.
- FP07 remains Product E2E Pending until real Agent-generated formula-bearing XLSX and Bento pass; the HTML path alone cannot complete the multi-capability package.
- FP08 remains Product E2E Pending until a real producer emits `traceId` plus structured lineage and Trace opens from the same artifact identity.
- R3 is now active. It must add the remaining real Generator Providers without changing the ownership table above.
