import { PAIMIND_UI_FOUNDATION_CSS, readPaimindMotion } from '@hansen/ui-foundation'
import {
  Component,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  markHarnessClientStyle,
  contributePaimindExtension,
  type HarnessObservableSnapshot,
  type HarnessSessionHistoryApi,
  type HarnessSessionService,
  type HarnessWorkspaceService,
  type PaimindClientContext,
  type PaimindLocaleSource,
  type PaimindSessionHeaderActionProps,
} from '@hansen/harness-compat'
import {
  ArrowUpRight as PaimindUploadIcon,
  Bot as PaimindAgentIcon,
  BrainCircuit as PaimindThinkIcon,
  Check as PaimindCheckIcon,
  ChevronRight as PaimindChevronRightIcon,
  CirclePause as PaimindPauseIcon,
  Code2 as PaimindCodeIcon,
  Database as PaimindDataIcon,
  Download as PaimindDownloadIcon,
  FileInput as PaimindInputIcon,
  GitBranch as PaimindBranchIcon,
  ListChecks as PaimindChecklistIcon,
  ListTodo as PaimindTaskMonitorIcon,
  Plug as PaimindMcpIcon,
  Search as PaimindBrowseIcon,
  Sparkles as PaimindToolIcon,
  Target as PaimindGoalIcon,
  TriangleAlert as PaimindWarningIcon,
  WandSparkles as PaimindSkillIcon,
  type LucideIcon,
} from 'lucide-react'
import type { PaimindArtifactService } from '@hansen/artifacts'
import type { PaimindWorkspaceProjectService } from '@hansen/workspace-project'
import {
  collectTaskMonitorResourceHistory,
  isLivePaimindJob,
  projectTaskMonitor,
  type TaskMonitorFileView,
  type TaskMonitorJobView,
  type TaskMonitorOverallStatus,
  type TaskMonitorResourceHistoryV1,
  type TaskMonitorSubagentView,
  type TaskMonitorViewModel,
  type TaskMonitorWorkflowStatus,
} from '../index.js'
import { taskResourceReader, taskCapabilities, type TaskResourceReader, type TaskResourceConfiguration, type CapabilityValue } from './resources.js'

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'paimindArtifacts', 'paimindWorkspaceProject']

export interface TaskMonitorClientContext extends PaimindClientContext {
  readonly sessions: HarnessSessionService
  readonly workspaces: HarnessWorkspaceService
  readonly paimindArtifacts: PaimindArtifactService
  readonly paimindWorkspaceProject: PaimindWorkspaceProjectService
}

export interface TaskMonitorSessionLogState {
  readonly bySession: Readonly<Record<string, {
    readonly open: boolean
    readonly status: 'downloading' | 'success' | 'error'
    readonly error: string | null
  } | undefined>>
}

export interface TaskMonitorSessionLogService {
  readonly store: HarnessObservableSnapshot<TaskMonitorSessionLogState>
  download(sessionId: string): Promise<void>
  dismiss(sessionId: string): void
}

const STYLE_ID = '@hansen/task-monitor'
const HEADER_SHADOW_PRIORITY = -10
const STYLE = `
[data-paimind-task-action] { position:relative; display:inline-flex; align-items:center; color:inherit; font:inherit; }
[data-paimind-task-identity] { display:inline-flex; align-items:center; gap:7px; max-width:240px; margin-right:8px; padding:4px 8px 4px 4px; border:1px solid var(--dsw-alias-border-main,#dce2ea); border-radius:20px; background:transparent; color:inherit; font:inherit; font-size:12px; cursor:pointer; }
[data-paimind-task-identity] > span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-avatar] { flex:none; position:relative; display:grid; place-items:center; width:28px; height:28px; border-radius:50%; overflow:hidden; background:color-mix(in srgb,currentColor 7%,transparent); }
[data-paimind-task-avatar] > img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
[data-paimind-task-avatar][data-paimind-agent-avatar-ready='true'] > [data-paimind-agent-avatar-fallback] { visibility:hidden; }
@media (max-width:720px) { [data-paimind-task-identity] { max-width:150px; } }
@media (max-width:460px) { [data-paimind-task-identity] { max-width:110px; font-size:11px; gap:4px; margin-right:3px; } }
/* Better Sidebar pins its collapsed 28px rail controls at top:3px, while the
   Harness Session header starts at top:12px and gives this 28px utility its
   own center line. Lift only the collapsed-state utility by the exact 11px
   center-line delta so the three top-right controls read as one toolbar. */
body[data-dsh-sidebar-collapsed] [data-paimind-task-action] { transform:translateY(-11px); }
[data-paimind-task-trigger] { position:relative; width:28px; height:28px; display:grid; place-items:center; padding:0; border:0; border-radius:50%; color:var(--dsw-alias-label-secondary,#626872); background:transparent; cursor:pointer; }
[data-paimind-task-trigger]:hover,[data-paimind-task-trigger]:focus-visible,[data-paimind-task-trigger][aria-pressed='true'] { color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.11)); }
[data-paimind-task-trigger]:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8); outline-offset:2px; }
[data-paimind-task-tooltip] { position:absolute; z-index:2147482999; top:calc(100% + 7px); left:50%; min-width:max-content; padding:5px 8px; border-radius:6px; color:#fff; background:#1f2329; box-shadow:0 8px 24px #0004; font-size:12px; line-height:16px; opacity:0; pointer-events:none; transform:translate(-50%,-3px); transition:opacity var(--paimind-motion-fast) ease,transform var(--paimind-motion-fast) ease; }
[data-paimind-task-trigger]:hover + [data-paimind-task-tooltip],[data-paimind-task-trigger]:focus-visible + [data-paimind-task-tooltip] { opacity:1; transform:translate(-50%,0); }
[data-paimind-task-panel] { position:fixed; z-index:2147482998; width:420px; max-width:calc(100vw - 24px); box-sizing:border-box; overflow:auto; overscroll-behavior:contain; border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18)); border-radius:14px; color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-bg-layer-1,#fff); box-shadow:0 12px 36px rgba(0,0,0,.16); font:inherit; }
[data-paimind-task-panel-header] { position:sticky; z-index:2; top:0; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px 13px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.13)); background:var(--dsw-alias-bg-layer-1,#fff); }
[data-paimind-task-panel-header] h2 { margin:0; font-size:16px; line-height:22px; font-weight:650; letter-spacing:-.01em; }
[data-paimind-task-panel-header] p { margin:2px 0 0; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:16px; }
[data-paimind-task-status-pill] { flex:none; padding:3px 8px; border-radius:999px; color:var(--dsw-alias-label-secondary,#626872); background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.09)); font-size:12px; line-height:16px; font-weight:500; }
[data-paimind-task-status-pill][data-status='running'] { color:var(--dsw-alias-state-business-primary,#4f7ff8); }
[data-paimind-task-status-pill][data-status='complete'] { color:var(--dsw-alias-state-success-primary,#2b8a57); }
[data-paimind-task-status-pill][data-status='blocked'],[data-paimind-task-status-pill][data-status='waiting'] { color:var(--dsw-alias-state-warning-primary,#b7791f); }
[data-paimind-task-body] { padding:14px 16px 16px; }
[data-paimind-task-summary-card] { padding:13px; border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12)); border-radius:11px; background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.055)); }
[data-paimind-task-summary] { min-width:0; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
[data-paimind-task-summary-copy] { min-width:0; display:grid; gap:3px; }
[data-paimind-task-summary-copy] strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:19px; font-weight:600; }
[data-paimind-task-summary-copy] span { min-width:0; overflow:hidden; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:15px; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-summary-stats] { display:grid; grid-template-columns:repeat(auto-fit,minmax(58px,1fr)); gap:4px; margin-top:11px; }
[data-paimind-task-summary-stats] button { min-width:0; display:grid; grid-template-columns:20px minmax(0,1fr); grid-template-rows:auto auto; column-gap:6px; padding:7px; border:1px solid transparent; border-radius:8px; color:inherit; background:var(--dsw-alias-bg-layer-1,#fff); font:inherit; text-align:left; cursor:pointer; transition:border-color var(--paimind-motion-fast) ease,background var(--paimind-motion-fast) ease,transform var(--paimind-motion-fast) ease; }
[data-paimind-task-summary-stats] button:hover { border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 24%,transparent); background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 5%,var(--dsw-alias-bg-layer-1,#fff)); transform:translateY(-1px); }
[data-paimind-task-summary-stats] button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8); outline-offset:1px; }
[data-paimind-task-summary-stat-icon] { grid-row:1 / 3; width:20px; height:20px; display:grid; place-items:center; align-self:center; border-radius:6px; color:var(--dsw-alias-state-business-primary,#4f7ff8); background:color-mix(in srgb,currentColor 9%,transparent); }
[data-paimind-task-summary-stats] b { font-size:12px; line-height:16px; font-weight:650; }
[data-paimind-task-summary-stats] small { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:13px; }
[data-paimind-task-section] { padding:15px 0; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12)); }
[data-paimind-task-anchor] { scroll-margin-block:12px; border-radius:8px; }
[data-paimind-task-anchor]:focus { outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 44%,transparent); outline-offset:4px; }
[data-paimind-task-section]:last-child { border-bottom:0; padding-bottom:0; }
[data-paimind-task-section] h3 { margin:0 0 9px; color:var(--dsw-alias-label-secondary,#626872); font-size:12px; line-height:18px; font-weight:600; }
[data-paimind-task-session-log] { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px; padding-top:9px; border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1)); }
[data-paimind-task-session-log] button { min-width:0; display:inline-flex; align-items:center; gap:6px; padding:4px 7px; border:0; border-radius:7px; color:var(--dsw-alias-label-secondary,#626872); background:transparent; font:inherit; font-size:12px; line-height:16px; cursor:pointer; }
[data-paimind-task-session-log] button:hover,[data-paimind-task-session-log] button:focus-visible { color:var(--dsw-alias-state-business-primary,#4f7ff8); }
[data-paimind-task-session-log] button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8); outline-offset:2px; }
[data-paimind-task-session-log] button:disabled { opacity:.58; cursor:wait; }
[data-paimind-task-session-log] small { min-width:0; overflow:hidden; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:14px; text-align:right; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-progress-head] { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:15px; }
[data-paimind-task-progress-head] b { color:var(--dsw-alias-label-primary,#202124); font-weight:600; }
[data-paimind-task-progress] { height:4px; margin:0 0 8px; overflow:hidden; border-radius:999px; background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12)); }
[data-paimind-task-progress] i { display:block; height:100%; border-radius:inherit; background:var(--dsw-alias-state-business-primary,#4f7ff8); }
[data-paimind-task-todo-group] + [data-paimind-task-todo-group] { margin-top:7px; }
[data-paimind-task-todo-history] { margin-top:7px; }
[data-paimind-task-todo-history] > summary { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:7px 8px; border-radius:8px; color:var(--dsw-alias-label-secondary,#626872); background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.055)); cursor:pointer; font-size:12px; line-height:16px; list-style:none; }
[data-paimind-task-todo-history] > summary::-webkit-details-marker { display:none; }
[data-paimind-task-todo-history] > summary::after { content:'›'; color:var(--dsw-alias-label-tertiary,#7a808a); transform:rotate(90deg); }
[data-paimind-task-todo-history][open] > summary::after { transform:rotate(-90deg); }
[data-paimind-task-todo-history] > [data-paimind-task-list] { margin-top:4px; }
[data-paimind-task-list] { display:grid; gap:1px; margin:0; padding:0; list-style:none; }
[data-paimind-task-row] { min-width:0; display:grid; grid-template-columns:22px minmax(0,1fr) auto; align-items:center; gap:8px; min-height:34px; padding:3px 2px; border-radius:7px; }
[data-paimind-task-row]:hover { background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05)); }
[data-paimind-task-row-icon] { width:17px; min-height:17px; display:grid; place-items:center; color:var(--dsw-alias-label-tertiary,#7a808a); text-align:center; font-size:12px; }
[data-paimind-task-row-icon] svg { display:block; }
[data-paimind-task-row-main] { min-width:0; }
[data-paimind-task-row-main] strong,[data-paimind-task-link] { display:block; min-width:0; overflow:hidden; color:var(--dsw-alias-label-primary,#202124); font:inherit; font-size:12px; line-height:17px; font-weight:500; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-row-main] small { display:block; min-width:0; overflow:hidden; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:14px; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-row-meta] { max-width:92px; overflow:hidden; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:14px; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-link] { width:100%; padding:0; border:0; background:transparent; cursor:pointer; }
[data-paimind-task-link]:hover,[data-paimind-task-link]:focus-visible { color:var(--dsw-alias-state-business-primary,#4f7ff8); text-decoration:underline; }
[data-paimind-task-subagent] { width:100%; border:0; color:inherit; background:transparent; font:inherit; text-align:left; cursor:pointer; }
[data-paimind-task-subagent]:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09)); }
[data-paimind-task-subagent]:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8); outline-offset:1px; background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09)); }
[data-paimind-task-subagent] [data-paimind-task-row-meta] { display:inline-flex; align-items:center; gap:4px; }
[data-paimind-task-agent-avatar] { position:relative; width:22px; height:22px; display:grid; place-items:center; justify-self:center; border-radius:7px; color:var(--paimind-avatar-color,var(--dsw-alias-state-business-primary,#4f7ff8)); background:color-mix(in srgb,currentColor 10%,transparent); }
[data-paimind-task-agent-avatar][data-variant='browse'] { --paimind-avatar-color:#5a78d1; }
[data-paimind-task-agent-avatar][data-variant='think'] { --paimind-avatar-color:#8b63c7; }
[data-paimind-task-agent-avatar][data-variant='data'] { --paimind-avatar-color:#2d8a6e; }
[data-paimind-task-agent-avatar][data-variant='code'] { --paimind-avatar-color:#b36a2e; }
[data-paimind-task-agent-avatar][data-variant='branch'] { --paimind-avatar-color:#4f7ff8; }
[data-paimind-task-agent-avatar][data-variant='folder'] { --paimind-avatar-color:#a05f88; }
[data-paimind-task-agent-avatar][data-variant='spark'] { --paimind-avatar-color:#3c879d; }
[data-paimind-task-agent-avatar][data-variant='target'] { --paimind-avatar-color:#9a7335; }
[data-paimind-task-agent-tooltip] { position:absolute; z-index:4; top:50%; left:calc(100% + 7px); width:max-content; max-width:230px; overflow:hidden; padding:4px 7px; border-radius:6px; color:#fff; background:#1f2329; box-shadow:0 6px 18px #0003; font-size:12px; line-height:14px; text-overflow:ellipsis; white-space:nowrap; opacity:0; pointer-events:none; transform:translate(-3px,-50%); transition:opacity var(--paimind-motion-fast) ease,transform var(--paimind-motion-fast) ease; }
[data-paimind-task-agent-avatar]:hover [data-paimind-task-agent-tooltip],[data-paimind-task-subagent]:focus-visible [data-paimind-task-agent-tooltip] { opacity:1; transform:translate(0,-50%); }
[data-paimind-task-empty] { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:16px; }
[data-paimind-task-disclosure] { margin-top:4px; }
[data-paimind-task-disclosure] summary { padding:5px 2px; color:var(--dsw-alias-label-secondary,#626872); cursor:pointer; font-size:12px; line-height:16px; list-style-position:inside; }
[data-paimind-task-disclosure][open] summary { margin-bottom:3px; }
[data-paimind-task-resource-list] { display:grid; gap:5px; }
[data-paimind-task-agent-children] { grid-column:1 / -1; min-width:0; margin-top:2px; padding:6px 0 0 74px; border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1)); }
[data-paimind-task-agent-children] [data-paimind-task-row] { padding-inline:0; }
[data-paimind-task-resource-empty] { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:19px; }
[data-paimind-task-technical] summary { cursor:pointer; color:var(--dsw-alias-label-secondary,#626872); font-size:12px; font-weight:600; }
[data-paimind-task-technical] dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:5px 10px; margin:10px 0 0; font-size:12px; line-height:14px; }
[data-paimind-task-technical] dt { color:var(--dsw-alias-label-tertiary,#7a808a); }
[data-paimind-task-technical] dd { min-width:0; margin:0; overflow-wrap:anywhere; }
[data-paimind-task-error] { padding:7px 9px; border-radius:8px; color:var(--dsw-alias-state-error-primary,#d04444); background:color-mix(in srgb,currentColor 8%,transparent); font-size:12px; line-height:16px; }
[data-paimind-task-panel] { border-radius:16px; box-shadow:0 18px 48px rgba(0,0,0,.18); }
[data-paimind-task-panel-header] { padding:15px 17px 12px; }
[data-paimind-task-panel-header] > div { min-width:0; }
[data-paimind-task-status-pill] { display:inline-flex; align-items:center; gap:6px; padding:3px 7px; background:transparent; }
[data-paimind-task-status-pill]::before { content:''; width:6px; height:6px; flex:none; border-radius:50%; background:currentColor; opacity:.72; }
[data-paimind-task-body] { padding:12px 16px 15px; }
[data-paimind-task-summary-card] { padding:12px 13px; border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.14)); background:transparent; }
[data-paimind-task-summary-copy] strong { font-size:13px; line-height:18px; }
[data-paimind-task-summary-stats] { gap:6px; margin-top:10px; }
[data-paimind-task-summary-stats] button { min-height:48px; grid-template-columns:22px minmax(0,1fr); column-gap:7px; padding:7px 8px; border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.1)); background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04)); }
[data-paimind-task-summary-stats] button:hover { transform:none; }
[data-paimind-task-summary-stat-icon] { width:22px; height:22px; }
[data-paimind-task-summary-stats] b { font-size:13px; line-height:16px; }
[data-paimind-task-summary-stats] small { font-size:12px; line-height:13px; }
[data-paimind-task-section] { padding:14px 0; }
[data-paimind-task-section] h3 { margin-bottom:8px; color:var(--dsw-alias-label-primary,#202124); font-size:12px; }
[data-paimind-task-empty-state] { display:grid; justify-items:center; gap:5px; margin:14px 0 2px; padding:22px 18px; border:1px dashed var(--dsw-alias-border-l1,rgba(128,128,128,.18)); border-radius:11px; color:var(--dsw-alias-label-tertiary,#7a808a); text-align:center; }
[data-paimind-task-empty-state] > span:first-child { width:30px; height:30px; display:grid; place-items:center; border-radius:9px; color:var(--dsw-alias-label-secondary,#626872); background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07)); }
[data-paimind-task-empty-state] strong { color:var(--dsw-alias-label-secondary,#626872); font-size:12px; line-height:17px; }
[data-paimind-task-empty-state] small { max-width:260px; font-size:12px; line-height:15px; }
[data-paimind-task-file] { width:100%; border:0; color:inherit; background:transparent; font:inherit; text-align:left; cursor:pointer; }
[data-paimind-task-file][data-paimind-task-row] { grid-template-columns:minmax(0,1fr) auto; padding-inline:10px 7px; }
[data-paimind-task-file]:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08)); }
[data-paimind-task-file]:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8); outline-offset:1px; }
[data-paimind-task-file] [data-paimind-task-row-meta] { display:inline-flex; align-items:center; gap:4px; }
[data-paimind-task-resource-list] { gap:8px; }
[data-paimind-task-agent-group],[data-paimind-task-capability-group] { display:block; margin:0; padding:0; border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12)); border-radius:10px; overflow:hidden; background:transparent; list-style:none; }
[data-paimind-task-main-agent] { min-width:0; min-height:47px; display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:9px; align-items:center; padding:7px 9px; border-radius:0; }
[data-paimind-task-main-agent-copy] { min-width:0; display:grid; gap:1px; }
[data-paimind-task-main-agent-copy] small { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:13px; }
[data-paimind-task-main-agent-copy] strong { overflow:hidden; font-size:12px; line-height:17px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-main-agent-role] { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:14px; }
[data-paimind-task-agent-children] { position:relative; margin:0; padding:7px 7px 7px 28px; border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1)); background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025)); }
[data-paimind-task-agent-children]::before { content:''; position:absolute; top:11px; bottom:11px; left:20px; width:1px; background:var(--dsw-alias-border-l1,rgba(128,128,128,.14)); }
[data-paimind-task-agent-children] [data-paimind-task-row] { min-height:40px; padding:3px 5px; }
[data-paimind-task-capability-row] { min-width:0; min-height:47px; display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:9px; align-items:center; padding:7px 9px; }
[data-paimind-task-capability-row] + [data-paimind-task-capability-row] { border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1)); }
[data-paimind-task-capability-icon] { width:27px; height:27px; display:grid; place-items:center; border-radius:8px; color:var(--dsw-alias-state-business-primary,#4f7ff8); background:color-mix(in srgb,currentColor 9%,transparent); }
[data-paimind-task-capability-icon][data-kind='skill'] { color:#8b63c7; }
[data-paimind-task-capability-icon][data-kind='mcp'] { color:#2d8a6e; }
[data-paimind-task-capability-copy] { min-width:0; display:grid; gap:1px; }
[data-paimind-task-capability-copy] small { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:13px; }
[data-paimind-task-capability-copy] strong { overflow:hidden; font-size:12px; line-height:17px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-task-capability-meta] { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:12px; line-height:14px; }
[data-paimind-task-capability-overflow] { border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1)); }
[data-paimind-task-capability-overflow] > summary { padding:7px 10px; color:var(--dsw-alias-label-secondary,#626872); cursor:pointer; font-size:12px; line-height:16px; }
[data-paimind-task-details] { padding:11px 0 0; }
[data-paimind-task-details] > summary { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:7px 2px; color:var(--dsw-alias-label-secondary,#626872); cursor:pointer; font-size:12px; line-height:17px; font-weight:600; list-style:none; }
[data-paimind-task-details] > summary::-webkit-details-marker { display:none; }
[data-paimind-task-details] > summary::after { content:'›'; color:var(--dsw-alias-label-tertiary,#7a808a); transform:rotate(90deg); transition:transform var(--paimind-motion-fast) ease; }
[data-paimind-task-details][open] > summary::after { transform:rotate(-90deg); }
[data-paimind-task-details-body] { margin-top:5px; padding:8px 10px 10px; border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1)); border-radius:9px; background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.035)); }
[data-paimind-task-session-log] { margin:0; padding:0 0 8px; border-top:0; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1)); }
[data-paimind-task-technical] dl { margin-top:8px; }
@media(max-width:640px){[data-paimind-task-panel]{top:auto!important; right:8px!important; bottom:8px; left:8px!important; width:auto; max-width:none; max-height:min(82vh,680px)!important; border-radius:16px}[data-paimind-task-panel-header]{padding-top:14px}[data-paimind-task-body]{padding-inline:14px}[data-paimind-task-agent-children]{padding-left:0}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@hansen/task-monitor'; markHarnessClientStyle(style, '@hansen/task-monitor')
  style.textContent = `${PAIMIND_UI_FOUNDATION_CSS}\n${STYLE}`
  document.head.append(style)
  return () => { style.remove() }
}

function TaskIcon(): React.JSX.Element {
  return <PaimindTaskMonitorIcon size={18} />
}

function DownloadIcon(): React.JSX.Element {
  return <PaimindDownloadIcon size={14} />
}

const EMPTY_SESSION_LOG_STATE: TaskMonitorSessionLogState = Object.freeze({ bySession: Object.freeze({}) })
const EMPTY_SUBSCRIBE = (): (() => void) => () => {}
const GET_EMPTY_SESSION_LOG = (): TaskMonitorSessionLogState => EMPTY_SESSION_LOG_STATE
const GET_EMPTY_PROJECTION = (): undefined => undefined

function useOptionalProjection(face: HarnessObservableSnapshot<unknown> | undefined): unknown {
  const subscribe = useMemo(() => face?.subscribe.bind(face) ?? EMPTY_SUBSCRIBE, [face])
  const getSnapshot = useMemo(() => face?.getSnapshot.bind(face) ?? GET_EMPTY_PROJECTION, [face])
  return useSyncExternalStore(subscribe, getSnapshot, GET_EMPTY_PROJECTION)
}

function sessionLogServiceOf(ctx: TaskMonitorClientContext): TaskMonitorSessionLogService | undefined {
  try {
    const lookup = (ctx as unknown as { get?: (name: string) => unknown }).get
    const candidate: unknown = lookup?.call(ctx, 'sessionLogDownload')
    if (candidate === null || typeof candidate !== 'object') return undefined
    const value = candidate as Partial<TaskMonitorSessionLogService>
    if (typeof value.download !== 'function' || typeof value.dismiss !== 'function') return undefined
    if (value.store === undefined || typeof value.store.getSnapshot !== 'function' || typeof value.store.subscribe !== 'function') return undefined
    return value as TaskMonitorSessionLogService
  } catch { return undefined }
}

const STATUS_COPY: Readonly<Record<TaskMonitorOverallStatus, readonly [string, string]>> = {
  blocked: ['需处理', 'Needs attention'], waiting: ['等待你', 'Waiting for you'], running: ['进行中', 'Running'],
  paused: ['已暂停', 'Paused'], complete: ['已完成', 'Complete'], idle: ['空闲', 'Idle'],
}
const JOB_STATUS: Readonly<Record<TaskMonitorJobView['status'], readonly [string, string]>> = {
  running: ['进行中', 'Running'], stopping: ['正在停止', 'Stopping'], completed: ['已完成', 'Completed'],
  killed: ['已取消', 'Cancelled'], failed: ['失败', 'Failed'],
}
const WORKFLOW_STATUS: Readonly<Record<TaskMonitorWorkflowStatus, readonly [string, string]>> = {
  running: ['进行中', 'Running'], completed: ['已完成', 'Completed'], failed: ['失败', 'Failed'],
  cancelled: ['已取消', 'Cancelled'], interrupted: ['已中断', 'Interrupted'],
}
const PRIMARY_ROW_LIMIT = 4
const TODO_ROW_LIMIT = 5
const CHECKLIST_HISTORY_LIMIT = 3
const RESOURCE_ROW_LIMIT = 4

function duration(job: TaskMonitorJobView, now: number): string {
  const end = isLivePaimindJob(job) ? now : job.finishedAt ?? job.startedAt
  const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function StatusIcon(props: { readonly status: string }): React.JSX.Element {
  if (props.status === 'completed' || props.status === 'complete') return <PaimindCheckIcon size={13} />
  if (props.status === 'failed' || props.status === 'blocked') return <PaimindWarningIcon size={13} />
  if (props.status === 'running' || props.status === 'in_progress') return <PaimindToolIcon size={13} />
  return <PaimindPauseIcon size={13} />
}

function Section(props: { readonly id?: string; readonly title: string; readonly children: ReactNode }): React.JSX.Element {
  return <section id={props.id} data-paimind-task-section {...(props.id === undefined ? {} : { 'data-paimind-task-anchor': '', tabIndex: -1 })}><h3>{props.title}</h3>{props.children}</section>
}

function focusTaskAnchor(id: string): void {
  const target = document.getElementById(id)
  if (!(target instanceof HTMLElement)) return
  const panel = target.closest<HTMLElement>('[data-paimind-task-panel]')
  if (panel !== null) {
    const panelTop = panel.getBoundingClientRect().top
    const targetTop = target.getBoundingClientRect().top
    const headerHeight = panel.querySelector<HTMLElement>('[data-paimind-task-panel-header]')?.getBoundingClientRect().height ?? 0
    panel.scrollTo?.({ top: Math.max(0, panel.scrollTop + targetTop - panelTop - headerHeight - 12), behavior: readPaimindMotion(target.ownerDocument, target.ownerDocument.defaultView ?? window) ? 'smooth' : 'instant' })
  } else {
    target.scrollIntoView?.({ behavior: readPaimindMotion(target.ownerDocument, target.ownerDocument.defaultView ?? window) ? 'smooth' : 'instant', block: 'start' })
  }
  target.focus({ preventScroll: true })
}

function FileRows(props: { readonly files: readonly TaskMonitorFileView[]; readonly zh: boolean; readonly onOpen: (file: TaskMonitorFileView) => void }): React.JSX.Element {
  const stateLabel = (state: TaskMonitorFileView['state']): string | undefined => {
    if (state === 'updating') return props.zh ? '更新中' : 'Updating'
    if (state === 'missing') return props.zh ? '不可用' : 'Unavailable'
    if (state === 'failed') return props.zh ? '失败' : 'Failed'
    return undefined
  }
  return <ul data-paimind-task-list>{props.files.map(file => {
    const status = stateLabel(file.state)
    return <li key={`${file.source}:${file.artifactSourceId ?? ''}:${file.path}`}><button type="button" data-paimind-task-row data-paimind-task-file aria-label={file.title} onClick={() => { props.onOpen(file) }}>
      <span data-paimind-task-row-main><strong>{file.title}</strong></span>
      <span data-paimind-task-row-meta>{status !== undefined && <span data-paimind-task-file-status>{status}</span>}<PaimindChevronRightIcon size={12} /></span>
    </button></li>
  })}</ul>
}

function Files(props: { readonly files: readonly TaskMonitorFileView[]; readonly zh: boolean; readonly onOpen: (file: TaskMonitorFileView) => void }): React.JSX.Element {
  if (props.files.length === 0) return <></>
  const primary = props.files.slice(0, PRIMARY_ROW_LIMIT)
  const remaining = props.files.slice(PRIMARY_ROW_LIMIT)
  return <><FileRows files={primary} zh={props.zh} onOpen={props.onOpen} />{remaining.length > 0 && <details data-paimind-task-disclosure><summary>{props.zh ? `其余 ${remaining.length} 项` : `${remaining.length} more`}</summary><FileRows files={remaining} zh={props.zh} onOpen={props.onOpen} /></details>}</>
}

interface SubagentRowData {
  readonly id: string
  readonly label: string
  readonly agentPreset?: string
  readonly mode: 'one-shot' | 'continuable'
  readonly running: boolean
  readonly status: string
  readonly visualSlot: number
}

type SubagentVisual = Readonly<{
  key: 'browse' | 'think' | 'data' | 'code' | 'branch' | 'folder' | 'spark' | 'target'
  Icon: LucideIcon
}>

// Stable identity variants keep sibling Subagents visually distinct without
// claiming a capability that is absent from the native Session facts. Add a
// new semantic alias here when Harness exposes richer Agent metadata.
const SUBAGENT_VISUALS: readonly SubagentVisual[] = Object.freeze([
  { key: 'browse', Icon: PaimindBrowseIcon },
  { key: 'think', Icon: PaimindThinkIcon },
  { key: 'data', Icon: PaimindDataIcon },
  { key: 'code', Icon: PaimindCodeIcon },
  { key: 'branch', Icon: PaimindBranchIcon },
  { key: 'folder', Icon: PaimindInputIcon },
  { key: 'spark', Icon: PaimindSkillIcon },
  { key: 'target', Icon: PaimindGoalIcon },
])

function SubagentAvatar(props: { readonly label: string; readonly slot: number }): React.JSX.Element {
  const visual = SUBAGENT_VISUALS[props.slot % SUBAGENT_VISUALS.length] ?? SUBAGENT_VISUALS[0]!
  return <span data-paimind-task-agent-avatar data-variant={visual.key} aria-hidden="true">
    <visual.Icon size={14} />
    <span data-paimind-task-agent-tooltip>{props.label}</span>
  </span>
}

function SubagentRows(props: {
  readonly rows: readonly SubagentRowData[]
  readonly zh: boolean
  readonly onOpen: (id: string, mode: 'one-shot' | 'continuable') => void
}): React.JSX.Element {
  if (props.rows.length === 0) return <></>
  return <ul data-paimind-task-list>{props.rows.map(row => <li key={row.id}><button
    type="button"
    data-paimind-task-row
    data-paimind-task-subagent
    aria-label={props.zh ? `打开协作助手：${row.label}` : `Open Subagent: ${row.label}`}
    onClick={() => { props.onOpen(row.id, row.mode) }}
  ><SubagentAvatar label={row.label} slot={row.visualSlot} /><span data-paimind-task-row-main><strong title={row.label}>{row.label}</strong>{row.agentPreset !== undefined && <small>{row.agentPreset}</small>}</span><span data-paimind-task-row-meta>{row.status}<PaimindChevronRightIcon size={12} /></span></button></li>)}</ul>
}

function FoldedSubagents(props: {
  readonly rows: readonly SubagentRowData[]
  readonly zh: boolean
  readonly onOpen: (id: string, mode: 'one-shot' | 'continuable') => void
}): React.JSX.Element {
  if (props.rows.length === 0) return <></>
  const sorted = [...props.rows].sort((left, right) => Number(right.running) - Number(left.running))
  const primary = sorted.slice(0, PRIMARY_ROW_LIMIT)
  const remaining = sorted.slice(PRIMARY_ROW_LIMIT)
  return <><SubagentRows rows={primary} zh={props.zh} onOpen={props.onOpen}/>{remaining.length > 0 && <details data-paimind-task-disclosure data-paimind-task-subagent-overflow><summary>{props.zh ? `其余 ${remaining.length} 个协作助手` : `${remaining.length} more Subagents`}</summary><SubagentRows rows={remaining} zh={props.zh} onOpen={props.onOpen}/></details>}</>
}

function CapabilityRows(props: {
  readonly values: readonly CapabilityValue[]
  readonly zh: boolean
  readonly kind: 'skill' | 'mcp'
  readonly Icon: LucideIcon
}): React.JSX.Element {
  const rows = (values: typeof props.values): React.JSX.Element => <>{values.map(value => <li key={value.key} data-paimind-task-capability-row data-kind={props.kind}>
    <span data-paimind-task-capability-icon data-kind={props.kind} aria-hidden="true"><props.Icon size={15} /></span>
    <span data-paimind-task-capability-copy><small>{props.kind === 'skill' ? (props.zh ? '技能' : 'Skill') : (props.zh ? '工具连接' : 'Tool connection')}</small><strong title={value.text}>{value.text}</strong><small data-paimind-task-capability-state>{value.status}</small></span>
  </li>)}</>
  const primary = props.values.slice(0, RESOURCE_ROW_LIMIT)
  const remaining = props.values.slice(RESOURCE_ROW_LIMIT)
  return <ul data-paimind-task-capability-group data-kind={props.kind}>{rows(primary)}{remaining.length > 0 && <li><details data-paimind-task-capability-overflow><summary>{props.zh ? `其余 ${remaining.length} 项` : `${remaining.length} more`}</summary><ul data-paimind-task-capability-group>{rows(remaining)}</ul></details></li>}</ul>
}

function ProgressSection(props: {
  readonly view: TaskMonitorViewModel
  readonly zh: boolean
  readonly now: number
  readonly todoAnchorId: string
}): React.JSX.Element {
  const { view, zh } = props
  const currentTodoList = view.todoLists.find(list => list.current)
  const historicTodoLists = view.todoLists.filter(list => !list.current)
  const liveJobs = view.jobs.filter(isLivePaimindJob)
  const historicJobs = view.jobs.filter(job => !isLivePaimindJob(job))
  const activePlan = view.plan?.active === true || view.plan?.pending === true
  const todoRows = (todos: typeof view.todos): React.JSX.Element => {
    if (todos.length === 0) return <></>
    const primary = todos.slice(0, TODO_ROW_LIMIT)
    const remaining = todos.slice(TODO_ROW_LIMIT)
    const rows = (items: typeof view.todos): React.JSX.Element => <ul data-paimind-task-list>{items.map((todo, index) => <li key={`${todo.content}:${index}`} data-paimind-task-row><span data-paimind-task-row-icon><StatusIcon status={todo.status} /></span><div data-paimind-task-row-main><strong>{todo.content}</strong></div></li>)}</ul>
    return <>{rows(primary)}{remaining.length > 0 && <details data-paimind-task-disclosure><summary>{zh ? `其余 ${remaining.length} 项` : `${remaining.length} more`}</summary>{rows(remaining)}</details>}</>
  }
  const jobRows = (jobs: readonly TaskMonitorJobView[]): React.JSX.Element => <ul data-paimind-task-list>{jobs.map(job => <li key={job.id} data-paimind-task-row><span data-paimind-task-row-icon><StatusIcon status={job.status} /></span><div data-paimind-task-row-main><strong title={job.label}>{job.label}</strong><small>{job.kind} · {job.artifact?.title ?? job.detail ?? job.id}</small></div><span data-paimind-task-row-meta>{JOB_STATUS[job.status][zh ? 0 : 1]} · {duration(job, props.now)}</span></li>)}</ul>
  const boundedRows = <T,>(items: readonly T[], render: (rows: readonly T[]) => React.JSX.Element, label: (count: number) => string): React.JSX.Element => {
    const primary = items.slice(0, PRIMARY_ROW_LIMIT)
    const remaining = items.slice(PRIMARY_ROW_LIMIT)
    return <>{render(primary)}{remaining.length > 0 && <details data-paimind-task-disclosure><summary>{label(remaining.length)}</summary>{render(remaining)}</details>}</>
  }
  const workflowRows = (workflows: typeof view.workflows): React.JSX.Element => <>{workflows.map(workflow => <ul key={workflow.name} data-paimind-task-list><li data-paimind-task-row><span data-paimind-task-row-icon><StatusIcon status={workflow.status} /></span><div data-paimind-task-row-main><strong>{workflow.name}</strong><small>{workflow.phases.map(phase => phase.phase ?? (zh ? '未分阶段' : 'Unphased')).join(' · ')}</small></div><span data-paimind-task-row-meta>{WORKFLOW_STATUS[workflow.status][zh ? 0 : 1]}</span></li></ul>)}</>
  const toolRows = (tools: typeof view.runningTools): React.JSX.Element => <ul data-paimind-task-list>{tools.map((tool, index) => <li key={tool.callId ?? `${tool.name}:${index}`} data-paimind-task-row><span data-paimind-task-row-icon><PaimindToolIcon size={13} /></span><div data-paimind-task-row-main><strong>{tool.name}</strong><small>{tool.callId}</small></div><span data-paimind-task-row-meta>{zh ? '工具调用' : 'Tool Call'}</span></li>)}</ul>
  const visibleTodoHistory = historicTodoLists.slice(0, CHECKLIST_HISTORY_LIMIT)
  const olderTodoHistory = historicTodoLists.slice(CHECKLIST_HISTORY_LIMIT)
  const todoHistory = (lists: typeof historicTodoLists, offset = 0): React.JSX.Element => <>{lists.map((list, index) => <details key={list.id} data-paimind-task-todo-history><summary><span>{zh ? `${index + offset === 0 && currentTodoList === undefined ? '最近' : '历史'}清单 ${historicTodoLists.length - index - offset}` : `${index + offset === 0 && currentTodoList === undefined ? 'Latest' : 'Previous'} checklist ${historicTodoLists.length - index - offset}`} · {list.progress.completed}/{list.progress.total}</span></summary>{todoRows(list.items)}</details>)}</>
  return <>
    {view.todoLists.length > 0 && <div id={props.todoAnchorId} data-paimind-task-anchor tabIndex={-1}>
      {currentTodoList !== undefined && currentTodoList.progress.total > 0 && <div data-paimind-task-todo-group><div data-paimind-task-progress-head><span>{zh ? '当前清单' : 'Current checklist'}</span><b>{currentTodoList.progress.completed}/{currentTodoList.progress.total}</b></div><div data-paimind-task-progress aria-label={`${currentTodoList.progress.completed}/${currentTodoList.progress.total}`}><i style={{ width: `${currentTodoList.progress.completed / currentTodoList.progress.total * 100}%` }} /></div>{todoRows(currentTodoList.items.filter(todo => todo.status !== 'completed'))}{currentTodoList.progress.completed > 0 && <details data-paimind-task-disclosure><summary>{zh ? `已完成 ${currentTodoList.progress.completed} 项` : `${currentTodoList.progress.completed} completed`}</summary>{todoRows(currentTodoList.items.filter(todo => todo.status === 'completed'))}</details>}</div>}
      {visibleTodoHistory.length > 0 && <div data-paimind-task-todo-group>{todoHistory(visibleTodoHistory)}{olderTodoHistory.length > 0 && <details data-paimind-task-disclosure><summary>{zh ? `更早 ${olderTodoHistory.length} 个清单` : `${olderTodoHistory.length} older checklists`}</summary>{todoHistory(olderTodoHistory, CHECKLIST_HISTORY_LIMIT)}</details>}</div>}
    </div>}
    {view.goal !== null && <ul data-paimind-task-list><li data-paimind-task-row><span data-paimind-task-row-icon><PaimindGoalIcon size={14} /></span><div data-paimind-task-row-main><strong>{view.goal.objective}</strong><small>{view.goal.blockedReason ?? `${zh ? '目标轮次' : 'Goal rounds'} ${view.goal.roundsStarted}/${view.goal.maxGoalRounds}`}</small></div><span data-paimind-task-row-meta>{view.goal.phase}</span></li></ul>}
    {view.workflows.length > 0 && boundedRows(view.workflows, workflowRows, count => zh ? `其余 ${count} 个工作流` : `${count} more Workflows`)}
    {view.runningTools.length > 0 && boundedRows(view.runningTools, toolRows, count => zh ? `其余 ${count} 个工具调用` : `${count} more Tool Calls`)}
    {liveJobs.length > 0 && boundedRows(liveJobs, jobRows, count => zh ? `其余 ${count} 个进行中任务` : `${count} more live Jobs`)}
    {historicJobs.length > 0 && <details data-paimind-task-disclosure><summary>{zh ? `历史任务 ${historicJobs.length} 项` : `${historicJobs.length} historical Jobs`}</summary>{boundedRows(historicJobs, jobRows, count => zh ? `其余 ${count} 项` : `${count} more`)}</details>}
    {activePlan && view.plan !== null && <ul data-paimind-task-list><li data-paimind-task-row><span data-paimind-task-row-icon><PaimindChecklistIcon size={14} /></span><div data-paimind-task-row-main><strong>{zh ? '计划模式' : 'Plan mode'}</strong><small>{view.plan.pending ? (zh ? '状态切换待生效' : 'State change pending') : (zh ? '状态已同步' : 'State synchronized')}</small></div><span data-paimind-task-row-meta>{view.plan.active ? (zh ? '已启用' : 'Active') : (zh ? '待生效' : 'Pending')}</span></li></ul>}
  </>
}

function AgentPortrait({ presetId, avatarId }: { readonly presetId: string | undefined; readonly avatarId: string | undefined }): React.JSX.Element {
  return <span data-paimind-task-avatar data-paimind-agent-avatar-seat="" data-paimind-agent-id={presetId} data-paimind-agent-avatar-choice={avatarId} aria-hidden="true"><span data-paimind-agent-avatar-fallback=""><PaimindAgentIcon size={16} /></span></span>
}

function Resources(props: {
  readonly view: TaskMonitorViewModel
  readonly zh: boolean
  readonly loading: boolean
  readonly configuration?: TaskResourceConfiguration | undefined
  readonly subagentAnchorId: string
  readonly onSubagent: (id: string, mode: 'one-shot' | 'continuable') => void
}): React.JSX.Element {
  const { view, zh } = props
  const config = props.configuration
  const mainAgentLabel = (view.session.agentPreset === undefined ? undefined : config?.names[view.session.agentPreset]) ?? (zh ? '当前智能体' : 'Current Agent')
  const hasMainAgent = view.session.agentPreset !== undefined || view.model !== undefined
  const subagentSlots = new Map(view.subagents.map((subagent, index) => [subagent.id, index]))
  const subagentRows = view.subagents.map((subagent: TaskMonitorSubagentView): SubagentRowData => ({
    id: subagent.id,
    label: subagent.label,
    ...(subagent.agentPreset === undefined || config?.names[subagent.agentPreset] === undefined ? {} : { agentPreset: config.names[subagent.agentPreset] }),
    mode: subagent.mode,
    running: subagent.activity === 'running',
    status: subagent.activity === 'running' ? (zh ? '进行中' : 'Running') : (zh ? '空闲' : 'Inactive'),
    visualSlot: subagentSlots.get(subagent.id) ?? 0,
  }))
  const { skills: skillValues, mcps: mcpValues } = taskCapabilities(view, config, zh)
  return <div data-paimind-task-resource-list aria-busy={props.loading}>
    {(hasMainAgent || subagentRows.length > 0) && <div data-paimind-task-agent-group>
      {hasMainAgent && <div data-paimind-task-main-agent>
        <AgentPortrait presetId={view.session.agentPreset} avatarId={view.session.agentPreset === undefined ? undefined : config?.avatars?.[view.session.agentPreset]} />
        <span data-paimind-task-main-agent-copy><small>{zh ? '当前智能体' : 'Current Agent'}</small><strong>{mainAgentLabel}</strong></span>
      </div>}
      {subagentRows.length > 0 && <div id={props.subagentAnchorId} data-paimind-task-anchor data-paimind-task-agent-children tabIndex={-1}><FoldedSubagents rows={subagentRows} zh={zh} onOpen={props.onSubagent} /></div>}
    </div>}
    {(config?.skillNames.length ?? 0) + (config?.connectionIds.length ?? 0) > 0 && <p data-paimind-task-empty>{zh ? '挂载来自智能体当前配置；加载与使用情况来自本会话。' : 'Configured resources reflect the current Agent configuration; loading and usage reflect this session.'}</p>}
    {props.loading && <span data-paimind-task-empty role="status">{zh ? '正在读取会话能力…' : 'Loading session capabilities…'}</span>}
    {(config?.profiles === 'error' || config?.profiles === 'unavailable') && <span data-paimind-task-empty>{zh ? '智能体配置暂不可用，以下仅展示已知会话记录。' : 'Agent configuration is unavailable; only known session evidence is shown.'}</span>}
    {(config?.mcps === 'error' || config?.mcps === 'unavailable') && mcpValues.length > 0 && <span data-paimind-task-empty>{zh ? '连接详情暂不可用。' : 'Connection details are unavailable.'}</span>}
    {skillValues.length > 0 && <CapabilityRows values={skillValues} zh={zh} kind="skill" Icon={PaimindSkillIcon} />}
    {mcpValues.length > 0 && <CapabilityRows values={mcpValues} zh={zh} kind="mcp" Icon={PaimindMcpIcon} />}
  </div>
}

export interface TaskMonitorActionProps extends PaimindSessionHeaderActionProps {
  readonly locale: PaimindLocaleSource
  readonly sessions: HarnessSessionService
  readonly workspaces: HarnessWorkspaceService
  readonly artifacts: PaimindArtifactService
  readonly projects: PaimindWorkspaceProjectService
  readonly sessionLog?: TaskMonitorSessionLogService
  readonly sessionHistory?: HarnessSessionHistoryApi
  readonly readResources?: TaskResourceReader
}

function sessionHistoryApiOf(ctx: TaskMonitorClientContext): HarnessSessionHistoryApi | undefined {
  try {
    const lookup = (ctx as unknown as { get?: (name: string) => unknown }).get
    const candidate = lookup?.call(ctx, 'connection') as { readonly api?: { readonly sessions?: Partial<HarnessSessionHistoryApi> } } | undefined
    return typeof candidate?.api?.sessions?.history === 'function' ? candidate.api.sessions as HarnessSessionHistoryApi : undefined
  } catch { return undefined }
}

const RESOURCE_HISTORY_CACHE = new Map<string, TaskMonitorResourceHistoryV1>()
const RESOURCE_HISTORY_REQUESTS = new Map<string, Promise<TaskMonitorResourceHistoryV1 | undefined>>()
const RESOURCE_HISTORY_CACHE_LIMIT = 32

function mergeResourceHistory(
  baseline: TaskMonitorResourceHistoryV1 | undefined,
  update: TaskMonitorResourceHistoryV1,
): TaskMonitorResourceHistoryV1 {
  if (baseline === undefined) return update
  const todoSnapshots = new Map(baseline.todoSnapshots.map(snapshot => [snapshot.seq, snapshot]))
  for (const snapshot of update.todoSnapshots) todoSnapshots.set(snapshot.seq, snapshot)
  const capturedThroughSeq = baseline.capturedThroughSeq === null
    ? update.capturedThroughSeq
    : update.capturedThroughSeq === null
      ? baseline.capturedThroughSeq
      : Math.max(baseline.capturedThroughSeq, update.capturedThroughSeq)
  return Object.freeze({
    schema: update.schema,
    capturedThroughSeq,
    skills: Object.freeze([...new Set([...baseline.skills, ...update.skills])]),
    mcps: Object.freeze([...new Set([...baseline.mcps, ...update.mcps])]),
    todoSnapshots: Object.freeze([...todoSnapshots.values()].sort((left, right) => left.seq - right.seq).slice(-100)),
  })
}

async function loadResourceHistory(api: HarnessSessionHistoryApi, sessionId: string, baseline?: TaskMonitorResourceHistoryV1): Promise<TaskMonitorResourceHistoryV1 | undefined> {
  const events: Parameters<typeof collectTaskMonitorResourceHistory>[0][number][] = []
  let beforeSeq: number | undefined
  for (let page = 0; page < 100; page++) {
    const response = await api.history({ sessionId, maxMessages: 100, ...(beforeSeq === undefined ? {} : { beforeSeq }) })
    if (!response.result.ok) return undefined
    const value = response.result.value
    if (!Array.isArray(value.events) || typeof value.hasMore !== 'boolean') return undefined
    let firstSeq: number | undefined
    let reachedBaseline = false
    for (const entry of value.events) {
      const event = entry?.event
      if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return undefined
      if (baseline?.capturedThroughSeq !== null && baseline?.capturedThroughSeq !== undefined
        && Number.isSafeInteger(event.seq) && event.seq! <= baseline.capturedThroughSeq) reachedBaseline = true
      else events.push(event)
      if (Number.isSafeInteger(event.seq)) firstSeq = Math.min(firstSeq ?? event.seq!, event.seq!)
    }
    if (reachedBaseline || !value.hasMore) return mergeResourceHistory(baseline, collectTaskMonitorResourceHistory(events))
    if (firstSeq === undefined || firstSeq === beforeSeq) return undefined
    beforeSeq = firstSeq
  }
  return undefined
}

function refreshResourceHistory(api: HarnessSessionHistoryApi, sessionId: string): Promise<TaskMonitorResourceHistoryV1 | undefined> {
  const active = RESOURCE_HISTORY_REQUESTS.get(sessionId)
  if (active !== undefined) return active
  const request = loadResourceHistory(api, sessionId, RESOURCE_HISTORY_CACHE.get(sessionId)).then(value => {
    if (value !== undefined) {
      RESOURCE_HISTORY_CACHE.delete(sessionId)
      RESOURCE_HISTORY_CACHE.set(sessionId, value)
      while (RESOURCE_HISTORY_CACHE.size > RESOURCE_HISTORY_CACHE_LIMIT) {
        const oldest = RESOURCE_HISTORY_CACHE.keys().next().value as string | undefined
        if (oldest === undefined) break
        RESOURCE_HISTORY_CACHE.delete(oldest)
      }
    }
    return value
  })
  RESOURCE_HISTORY_REQUESTS.set(sessionId, request)
  void request.then(
    () => { if (RESOURCE_HISTORY_REQUESTS.get(sessionId) === request) RESOURCE_HISTORY_REQUESTS.delete(sessionId) },
    () => { if (RESOURCE_HISTORY_REQUESTS.get(sessionId) === request) RESOURCE_HISTORY_REQUESTS.delete(sessionId) },
  )
  return request
}

export function TaskMonitorAction(props: TaskMonitorActionProps): React.JSX.Element {
  const sessionsSnapshot = useSyncExternalStore(props.sessions.list.subscribe.bind(props.sessions.list), props.sessions.list.getSnapshot.bind(props.sessions.list), props.sessions.list.getSnapshot.bind(props.sessions.list))
  const conversation = props.useSession(snapshot => snapshot)
  const projections = props.sessions.binding?.(props.sessionId)?.session.projections
  const goal = useOptionalProjection(projections?.faceOf('goal'))
  const todos = useOptionalProjection(projections?.faceOf('todos'))
  const plan = useOptionalProjection(projections?.faceOf('plan'))
  const artifactSnapshot = useSyncExternalStore(props.artifacts.subscribe.bind(props.artifacts), props.artifacts.getSnapshot.bind(props.artifacts), props.artifacts.getSnapshot.bind(props.artifacts))
  const projectSnapshot = useSyncExternalStore(props.projects.subscribe.bind(props.projects), props.projects.getSnapshot.bind(props.projects), props.projects.getSnapshot.bind(props.projects))
  const sessionLogSubscribe = useMemo(() => props.sessionLog?.store.subscribe.bind(props.sessionLog.store) ?? EMPTY_SUBSCRIBE, [props.sessionLog])
  const getSessionLogSnapshot = useMemo(() => props.sessionLog?.store.getSnapshot.bind(props.sessionLog.store) ?? GET_EMPTY_SESSION_LOG, [props.sessionLog])
  const sessionLogSnapshot = useSyncExternalStore(sessionLogSubscribe, getSessionLogSnapshot, GET_EMPTY_SESSION_LOG)
  const activeLocale = useSyncExternalStore(props.locale.subscribe.bind(props.locale), () => props.locale.getLocale().active, () => props.locale.getLocale().active)
  const zh = activeLocale.startsWith('zh')
  const project = projectSnapshot.projects.find(candidate => candidate.sessionIds.includes(props.sessionId))
  const [resourceHistory, setResourceHistory] = useState<TaskMonitorResourceHistoryV1 | undefined>(() => RESOURCE_HISTORY_CACHE.get(props.sessionId))
  const [resourceHistoryLoading, setResourceHistoryLoading] = useState(false)
  const view = useMemo(() => projectTaskMonitor({
    sessionId: props.sessionId,
    sessions: sessionsSnapshot,
    conversation,
    goal,
    todos,
    plan,
    artifacts: artifactSnapshot.artifacts,
    ...(resourceHistory === undefined ? {} : { resourceHistory }),
    ...(project === undefined ? {} : { projectTitle: project.title, projectPath: project.path }),
  }), [props.sessionId, sessionsSnapshot, conversation, goal, todos, plan, artifactSnapshot, project, resourceHistory])
  const [open, setOpen] = useState(false)
  const [configuration, setConfiguration] = useState<TaskResourceConfiguration>()
  const [configurationLoading, setConfigurationLoading] = useState(false)
  const currentConfiguration = configuration?.sessionId === props.sessionId && configuration.presetId === view.session.agentPreset ? configuration : undefined
  useEffect(() => {
    if (props.readResources === undefined) return
    let active = true, pending = false
    setConfigurationLoading(true)
    const refresh = async (): Promise<void> => {
      if (pending) return
      pending = true
      try {
        const result = await props.readResources!(props.sessionId, view.session.agentPreset)
        if (active) setConfiguration(result)
      } catch {
        if (active) setConfiguration({ sessionId: props.sessionId, ...(view.session.agentPreset === undefined ? {} : { presetId: view.session.agentPreset }), names: {}, skillNames: [], connectionIds: [], connections: [], profiles: 'error', mcps: 'error' })
      } finally { pending = false; if (active) setConfigurationLoading(false) }
    }
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    const timer = open ? setInterval(onFocus, 5000) : undefined
    return () => { active = false; if (timer !== undefined) clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [open, props.readResources, props.sessionId, view.session.agentPreset])
  const [navigationError, setNavigationError] = useState<string | undefined>()
  const [now, setNow] = useState(() => Date.now())
  const [position, setPosition] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const panelId = useId()
  const tooltipId = useId()
  const todoAnchorId = useId()
  const subagentAnchorId = useId()
  const outputAnchorId = useId()

  useEffect(() => {
    let active = true
    setNavigationError(undefined)
    const cached = RESOURCE_HISTORY_CACHE.get(props.sessionId)
    setResourceHistory(cached)
    if (props.sessionHistory === undefined || conversation.running) {
      setResourceHistoryLoading(false)
      return () => { active = false }
    }
    setResourceHistoryLoading(cached === undefined)
    void refreshResourceHistory(props.sessionHistory, props.sessionId)
      .then(value => {
        if (!active) return
        if (value !== undefined) setResourceHistory(value)
        setResourceHistoryLoading(false)
      })
      .catch(() => { if (active) setResourceHistoryLoading(false) })
    return () => { active = false }
  }, [props.sessionId, props.sessionHistory, conversation.running])

  const liveCount = view.runningTools.length + view.jobs.filter(isLivePaimindJob).length
    + view.workflows.filter(workflow => workflow.status === 'running').length
  useEffect(() => {
    if (!open) return
    const refresh = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const width = Math.min(420, window.innerWidth - 24)
      const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12))
      const top = Math.max(12, rect.bottom + 8)
      setPosition({ left, top, maxHeight: Math.max(220, window.innerHeight - top - 12) })
    }
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (!rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false)
    }
    const key = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh)
    if (triggerRef.current !== null) observer?.observe(triggerRef.current)
    refresh()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)
    return () => {
      observer?.disconnect()
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || liveCount === 0) return
    setNow(Date.now())
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [open, liveCount])

  const openFile = (file: TaskMonitorFileView): void => {
    setOpen(false)
    void props.workspaces.openPath(file.path)
  }
  const openSubagent = (childSessionId: string, mode: 'one-shot' | 'continuable'): void => {
    setNavigationError(undefined)
    if (props.sessions.openSubagent !== undefined) {
      try {
        props.sessions.openSubagent({ parentSessionId: props.sessionId, childSessionId, mode })
        setOpen(false)
        return
      } catch { /* Fall through to exact native Session navigation. */ }
    }
    if (sessionsSnapshot.byId[childSessionId] !== undefined) {
      try {
        props.sessions.open(childSessionId)
        setOpen(false)
        return
      } catch { /* Keep the panel open and expose a deterministic error. */ }
    }
    setNavigationError(zh ? '无法打开协作助手，请刷新后重试。' : 'Unable to open the Subagent. Refresh and try again.')
  }
  const label = zh ? '任务监控' : 'Task Monitor'
  const sessionLog = sessionLogSnapshot.bySession[props.sessionId]
  const requestSessionLog = (): void => {
    if (props.sessionLog === undefined || sessionLog?.status === 'downloading') return
    void props.sessionLog.download(props.sessionId).finally(() => { props.sessionLog?.dismiss(props.sessionId) })
  }
  const sessionLogStatus = sessionLog?.status === 'downloading'
    ? (zh ? '正在准备 ZIP' : 'Preparing ZIP')
    : sessionLog?.status === 'success'
      ? (zh ? '已交给浏览器下载' : 'Sent to browser downloads')
      : sessionLog?.status === 'error'
        ? (sessionLog.error ?? (zh ? '下载失败' : 'Download failed'))
        : (zh ? '包含当前会话与子会话' : 'Includes this Session and descendants')
  const hasProgress = view.goal !== null || view.todoLists.length > 0 || view.runningTools.length > 0 || view.jobs.length > 0
    || view.workflows.length > 0 || view.plan?.active === true || view.plan?.pending === true
  const hasResources = view.session.agentPreset !== undefined || view.model !== undefined || view.subagents.length > 0 || view.skills.length > 0 || view.mcps.some(mcp => mcp.status === 'used')
  const artifactCount = view.outputs.filter(output => output.source === 'artifact').length
  const summaryStats = [
    ...(view.todoLists.length === 0 ? [] : [{ key: 'todos', value: view.todoLists.length, label: zh ? '清单' : 'Todos', targetId: todoAnchorId, icon: <PaimindChecklistIcon size={13} /> }]),
    ...(view.subagents.length === 0 ? [] : [{ key: 'subagents', value: view.subagents.length, label: zh ? '协作助手' : 'Subagents', targetId: subagentAnchorId, icon: <PaimindBranchIcon size={13} /> }]),
    ...(view.outputs.length === 0 ? [] : [{ key: 'outputs', value: view.outputs.length, label: zh ? '交付文件' : 'Outputs', targetId: outputAnchorId, icon: <PaimindUploadIcon size={13} /> }]),
  ]
  const sections: readonly { readonly key: string; readonly visible: boolean; readonly id?: string; readonly title: string; readonly content: ReactNode }[] = [
    { key: 'progress', visible: hasProgress, title: zh ? '任务进度' : 'Task Progress', content: <ProgressSection view={view} zh={zh} now={now} todoAnchorId={todoAnchorId} /> },
    { key: 'resources', visible: hasResources, title: zh ? '智能体、技能与连接' : 'Agent, skills & connections', content: <Resources view={view} zh={zh} configuration={currentConfiguration} loading={resourceHistoryLoading || configurationLoading} subagentAnchorId={subagentAnchorId} onSubagent={openSubagent} /> },
    { key: 'inputs', visible: view.inputs.length > 0, title: zh ? '输入文件' : 'Input Files', content: <Files files={view.inputs} zh={zh} onOpen={openFile} /> },
    { key: 'outputs', visible: view.outputs.length > 0, id: outputAnchorId, title: zh ? '交付结果' : 'Outputs & Artifacts', content: <Files files={view.outputs} zh={zh} onOpen={openFile} /> },
  ]
  const hasVisibleContent = sections.some(section => section.visible)
  const taskSummaryLabel = zh ? '任务摘要' : 'Task Summary'
  const panel = open ? <section ref={panelRef} id={panelId} role="region" aria-label={label} data-paimind-ui-scope="task-monitor" data-paimind-task-panel style={position}>
    <header data-paimind-task-panel-header><div><h2>{taskSummaryLabel}</h2><p>{zh ? '当前对话 · 实时状态' : 'Current conversation · live status'}</p></div><span data-paimind-task-status-pill data-status={view.status}>{STATUS_COPY[view.status][zh ? 0 : 1]}</span></header>
    <div data-paimind-task-body>
      <section data-paimind-task-summary-card aria-label={zh ? '当前摘要' : 'Current Summary'}><div data-paimind-task-summary><div data-paimind-task-summary-copy><strong title={view.session.title}>{view.session.title}</strong>{view.session.projectTitle !== undefined && <span>{view.session.projectTitle}</span>}</div></div>{summaryStats.length > 0 && <div data-paimind-task-summary-stats>{summaryStats.map(stat => <button type="button" key={stat.key} data-paimind-task-summary-stat={stat.key} aria-label={zh ? `查看${stat.label}：${stat.value}` : `View ${stat.value} ${stat.label}`} onClick={() => { focusTaskAnchor(stat.targetId) }}><span data-paimind-task-summary-stat-icon aria-hidden="true">{stat.icon}</span><b>{stat.value}</b><small>{stat.label}</small></button>)}</div>}{(navigationError ?? view.error) !== undefined && <p data-paimind-task-error>{navigationError ?? (zh ? '本次任务未完成，请展开下方详情查看原因。' : 'This task did not finish. Open the details below to see why.')}</p>}</section>
      {!hasVisibleContent && <div data-paimind-task-empty-state role="status"><span aria-hidden="true"><PaimindTaskMonitorIcon size={16} /></span><strong>{zh ? '暂无任务内容' : 'No task content yet'}</strong><small>{zh ? '任务开始后，这里会显示进度、协作助手和交付文件。' : 'Task progress, Agents, and outputs will appear after this Session starts work.'}</small></div>}
      {sections.filter(section => section.visible).map(section => <Section key={section.key} {...(section.id === undefined ? {} : { id: section.id })} title={section.title}>{section.content}</Section>)}
      <details data-paimind-task-details data-paimind-task-technical><summary>{props.sessionLog === undefined ? (zh ? '详情' : 'Details') : (zh ? '详情与日志' : 'Details & Log')}</summary><div data-paimind-task-details-body>{view.error !== undefined && <div><strong>{zh ? '失败原因' : 'Failure details'}</strong><p data-paimind-task-error>{view.error}</p></div>}{props.sessionLog !== undefined && <div data-paimind-task-session-log><button type="button" aria-label={zh ? '下载会话日志' : 'Download Session Log'} disabled={sessionLog?.status === 'downloading'} onClick={requestSessionLog}><DownloadIcon />{zh ? '下载会话日志' : 'Download Session Log'}</button><small title={sessionLogStatus}>{sessionLogStatus}</small></div>}<dl><dt>{zh ? '对话编号' : 'Conversation ID'}</dt><dd>{view.session.id}</dd>{project !== undefined && <><dt>{zh ? '工作区编号' : 'Workspace ID'}</dt><dd>{project.workspaceId}</dd></>}{view.model !== undefined && <><dt>{zh ? '供应商' : 'Provider'}</dt><dd>{view.model.provider}</dd><dt>{zh ? '模型' : 'Model'}</dt><dd>{view.model.model}</dd></>}{view.jobs.length > 0 && <><dt>{zh ? '后台任务' : 'Background tasks'}</dt><dd>{view.jobs.length}</dd></>}{artifactCount > 0 && <><dt>{zh ? '交付文件' : 'Deliverables'}</dt><dd>{artifactCount}</dd></>}{view.queueCount > 0 && <><dt>{zh ? '排队消息' : 'Queued messages'}</dt><dd>{view.queueCount}</dd></>}</dl></div></details>
    </div>
  </section> : null
  return <div ref={rootRef} data-paimind-task-action>
    {view.session.agentPreset !== undefined && <button type="button" data-paimind-task-identity aria-label={`${zh ? '当前智能体' : 'Current Agent'}：${currentConfiguration?.names[view.session.agentPreset] ?? (zh ? '名称暂不可用' : 'Name unavailable')}`} title={currentConfiguration?.names[view.session.agentPreset]} aria-controls={panelId} aria-expanded={open} onClick={() => { setNow(Date.now()); setOpen(value => !value) }}><AgentPortrait presetId={view.session.agentPreset} avatarId={currentConfiguration?.avatars?.[view.session.agentPreset]} /><span>{currentConfiguration?.names[view.session.agentPreset] ?? (zh ? '当前智能体' : 'Current Agent')}</span></button>}
    <button ref={triggerRef} type="button" data-paimind-task-trigger aria-label={label} aria-describedby={tooltipId} aria-controls={panelId} aria-expanded={open} aria-pressed={open} onClick={() => { setNow(Date.now()); setOpen(value => !value) }}><TaskIcon /></button>
    <span id={tooltipId} role="tooltip" data-paimind-task-tooltip>{label}</span>
    {panel !== null && typeof document !== 'undefined' ? createPortal(panel, document.body) : null}
  </div>
}

interface BoundaryState { readonly failed: boolean; readonly message?: string }
class TaskMonitorBoundary extends Component<TaskMonitorActionProps, BoundaryState> {
  state: BoundaryState = { failed: false }
  static getDerivedStateFromError(error: unknown): BoundaryState { return { failed: true, message: error instanceof Error ? error.message : String(error) } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.warn('[paimind-task-monitor] render failed', error, info.componentStack) }
  render(): ReactNode {
    if (!this.state.failed) return <TaskMonitorAction {...this.props} />
    const zh = this.props.locale.getLocale().active.startsWith('zh')
    return <button type="button" data-paimind-task-trigger data-paimind-task-boundary-error={this.state.message ?? 'unknown'} aria-label={zh ? '任务监控暂不可用' : 'Task Monitor unavailable'}><TaskIcon /></button>
  }
}

function HiddenHeaderSeat(): null { return null }

export function apply(ctx: TaskMonitorClientContext): void {
  const sessionLog = sessionLogServiceOf(ctx)
  const sessionHistory = sessionHistoryApiOf(ctx)
  const readResources = taskResourceReader(ctx as { get?(name: string): unknown })
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:task-monitor', packageName: '@hansen/task-monitor', category: 'automation',
    nameZh: '任务监控', nameEn: 'Task Monitor',
    descriptionZh: '以浮动摘要投影当前 Session、Project、Goal、Todo、Subagent、Tool、Job、Artifact、Skill 与 MCP 的原生事实。',
    descriptionEn: 'Floating read-only summary of native Session, Project, Goal, Todo, Subagent, Tool, Job, Artifact, Skill, and MCP facts.',
    surface: 'header-button', maturity: 'technical-preview', order: 10,
  })
  ctx.effect(installStyle, 'paimind-task-monitor: styles')
  ctx.slots.inject('conversation.session.header.actions', () => [
    ctx.slots.register({
      name: 'conversation.session.header.actions', id: 'agent-preset', order: -10, priority: HEADER_SHADOW_PRIORITY,
    }, HiddenHeaderSeat),
    ctx.slots.register({
      name: 'conversation.session.header.actions', id: 'subagent-catalog', order: 10, priority: HEADER_SHADOW_PRIORITY,
    }, HiddenHeaderSeat),
    ctx.slots.register({
      name: 'conversation.session.header.actions', id: 'job-list', order: 20, priority: HEADER_SHADOW_PRIORITY,
    }, HiddenHeaderSeat),
  ])
  ctx.slots.inject('conversation.session.header.utilities', () => [
    ctx.slots.register({
      name: 'conversation.session.header.utilities', id: 'session-log-download', order: 0, priority: HEADER_SHADOW_PRIORITY,
    }, (slotProps: PaimindSessionHeaderActionProps) => <TaskMonitorBoundary {...slotProps} locale={ctx.locale} sessions={ctx.sessions} workspaces={ctx.workspaces} artifacts={ctx.paimindArtifacts} projects={ctx.paimindWorkspaceProject} readResources={readResources} {...(sessionLog === undefined ? {} : { sessionLog })} {...(sessionHistory === undefined ? {} : { sessionHistory })} />),
  ])
}
