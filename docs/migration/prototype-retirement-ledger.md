# Frozen Prototype Retirement Ledger

## Retirement decision

The `paimind-agent-skill-prototype` remains a specification archive based on
commit `baa8a0f3bdf5b0787491c4c4fac627f2a8a30321`. Its Vite runtime on port
`4187` is retired. No PAIMind Harness package imports, reads, routes to or starts
the prototype. Synthetic fixtures, browser repositories and Memory Adapter
state are not production migration sources.

Retirement is operational and non-destructive. The original R7 checkpoint saw
a clean prototype worktree; the current post-branding audit observes retained
local edits in seven tracked files. They are not reset, deleted or represented
as migrated product state. The authoritative retirement proof is the stopped
runtime entry, absence of Bundle dependencies and complete capability
disposition below—not a destructive cleanup of user work.

Independent Plugin does not mean Independent Domain Model. Every retained
product capability below consumes canonical Harness Workspace, Session, Agent
Preset, Tool, Skill, Job, Schedule and Deliverable objects.

## Capability disposition

| Prototype evidence | Product intent | Goal A disposition | Canonical owner / package |
|---|---|---|---|
| `src/App.jsx`, `src/components/session/SessionThreadViewport.jsx`, `src/components/conversation/*` | Conversation, Think, Read, Grep, Tool Call, composer and message actions | Native Reuse; prototype shell retired | Harness conversation and Session |
| `src/components/conversation/AgentRuntimeOrb.jsx` | Nine active runtime-state animations | Product E2E Verified | `@paimind/runtime-orbs`, driven by real Harness events |
| `src/components/AgentUserView.jsx`, `src/components/PersonalAgentCenter.test.jsx` | Agent directory, categories and selection | Product E2E Verified as the product layer over the same Presets | `@paimind/agent-market` + Harness Agent Preset |
| `src/components/personal-agent/*`, `src/components/PersonalAgentBuilderView.jsx` | Personal Agent creation/editing | Product E2E Verified; writes native Preset configuration plus PAIMind metadata | `@paimind/agent-builder` + Harness Agent Preset |
| `src/components/SkillCenterView.jsx`, `src/components/SkillDetailView.jsx`, `src/components/skill-detail/*` | Skill catalog, details and conversation use | Product E2E Verified; no second Skill store | `@paimind/skill-market` + Harness Skill ids |
| `src/components/ProjectWorkspaceView.jsx`, `src/components/ProjectLaunchDialog.jsx`, `src/project-sessions.js` | Project, Session tree and shared context | Headless infrastructure; duplicate visible Project entry retired | `@paimind/workspace-project`; Project = Harness Workspace |
| `src/components/session/SessionPreviewWorkspace.jsx`, `src/components/project/*`, `src/project-files.js` | Files, Deliverables and preview workspace | Product E2E Verified through structured Artifact projection | `@paimind/artifact-runtime`, `@paimind/artifacts`, provider adapters |
| `src/components/ChatSessionView.jsx`, `src/components/session/StandaloneSessionTopbar.jsx`, `src/components/project/ProjectJobStrip.jsx`, `src/proposal-project-job-runtime.js` | Background task state | Product E2E Verified through independent button/Drawer; synthetic reducer retired | `@paimind/task-monitor` consuming native Jobs |
| `src/components/project/ProjectWorkArea.jsx`, `src/components/project/PptFilePreview.jsx`, `src/components/project/SpreadsheetFilePreview.jsx` | PDF/PPTX/XLSX preview | Product E2E Verified | `@paimind/renderer-pdf`; Better Sidebar + external Office viewer for PPTX/XLSX |
| `src/components/project/HtmlDocumentPreview.jsx`, `src/components/project/HtmlDeckPreview.jsx`, `src/bento-sample-runtime.test.js`, `src/html-deck-export.test.js` | HTML and Bento content | Product E2E Verified; Bento remains self-owned and provider-neutral | `@paimind/generator-web`, `@paimind/generator-bento`, `@paimind/renderer-bento` |
| `src/presentation-trace-view-model.js`, `src/fixtures/wmt-kids-craft-presentation-trace*.json` | Source, lineage, calculation and code trace | Product E2E Verified from live structured events; fixtures retired | `@paimind/presentation-trace` |
| `src/components/utility/NotificationCenterView.jsx`, `src/notification-schedule-repository.js` | Notification center and deep links | Product E2E Verified; browser repository retired | `@paimind/notifications` consuming trusted events |
| `src/components/utility/ScheduledTasksView.jsx`, `src/components/utility/ScheduleCreateDialog.jsx` | Time-based reminders and task management | Replaced by RQ-103 platform task definitions, registered actions and durable Run history; business fields, business pages and the old native reminder plugin remain retired | `@paimind/platform-scheduler` + registered Adapters |
| `src/components/account/SettingsViews.jsx`, `src/user-settings-context.jsx` | Theme, locale, preferences and AI settings | Theme/locale/model/permission are Native Reuse; Codex-inspired Personality, About You and Custom Instructions are the only product-owned extension; browser-local state, Notification/motion preferences and synthetic Memory are retired | Harness Settings + `@paimind/user-settings` |
| `src/prototype-auth-context.jsx`, `src/components/account/ConfigurationWorkspaceView.jsx`, `src/enterprise-configuration-*` | Role preview, permission and Configuration Studio | Native Reuse + Retired; browser-selected identity is not authorization | Harness Permission Preset; no PAIMind Governance claim without a real provider |
| `src/components/resource/ResourceCenterView.jsx`, `src/components/resource/ResourceComponentPreview.jsx` | Component catalog and developer integration reference | Product E2E Verified for live inventory/diagnostics; synthetic preview catalog retired | `@paimind/developer-resources` |
| Prototype top-level navigation and launcher affordances | Product navigation shell | Retired | Harness native navigation; Extension Center is a capability-management page, not a Launcher |
| Local model catalogs, fixtures, reducers, Memory Adapter and browser stores | Demonstration/runtime emulation | Retired; no formal data migration | None |
| Cloud folder/provider concept | Remote file ownership and cloud persistence | Outside Goal A | Future Goal B |

## Product classification retained after retirement

Harness Plugin Registry owns technical load, version, dependency and enable
state. PAIMind Extension Center remains a separate product-management page with
exact categories: Experience, Content & Rendering, Agents, Skills & Tools,
Automation, Governance and Developer. The Task Monitor live entry remains an
independent button. Bento registers only through the stable Preview/Side Card
adapter and never imports Better Sidebar internals.

## Runtime and source evidence

- Pre/post prototype commit: `baa8a0f3bdf5b0787491c4c4fac627f2a8a30321`.
- Original R7 pre/post prototype worktree: clean. Current audit: seven retained
  tracked modifications, preserved and explicitly excluded from the retirement
  claim.
- Resolved retired process chain: npm PID `3435` → Vite PID `3451` → esbuild
  PID `3452`; the parent received `SIGINT` and all three exited.
- `http://127.0.0.1:4187/`: connection refused after retirement.
- `http://127.0.0.1:3080/`: selected Harness runtime remains available.
- A stale user-owned `4187` browser tab can remain visible, but it is not a
  reachable runtime and is not referenced by the Bundle.
- Source/package/runtime scan finds no `paimind-agent-skill-prototype`,
  `localhost:4187`, `127.0.0.1:4187` or port `4187` dependency in the plugin
  suite outside this documentary ledger.
