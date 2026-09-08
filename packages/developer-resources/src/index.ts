import type { PaimindExtensionDescriptor } from '@hansen/contracts'
import type {
  HarnessPluginFiberPhase,
  HarnessPluginInventoryEntry,
  HarnessPluginInventorySnapshot,
  HarnessPluginTechnicalState,
} from '@hansen/harness-compat'
import { projectHarnessPluginTechnicalState } from '@hansen/harness-compat'

/** Host half is intentionally empty: every source on this page is read-only. */
export const name = 'paimind-developer-resources'
export function apply(): void {}

export type DeveloperTechnicalState = HarnessPluginTechnicalState

export interface PaimindInventorySummary {
  readonly total: number
  readonly active: number
  readonly loading: number
  readonly failed: number
  readonly disabled: number
  readonly unobserved: number
}

export interface DeveloperSurfaceProjection {
  readonly descriptor: Readonly<PaimindExtensionDescriptor>
  readonly technicalState: DeveloperTechnicalState
  readonly entries: readonly HarnessPluginInventoryEntry[]
}

const LOADING_PHASES = new Set<HarnessPluginFiberPhase>(['pending', 'loading', 'unloading'])

/** Select only exact PAIMind package rows; invariants remain separate native Loader entries. */
export function paimindInventoryEntries(
  snapshot: HarnessPluginInventorySnapshot,
): readonly HarnessPluginInventoryEntry[] {
  return Object.freeze(snapshot.entries.filter(entry => entry.moduleName.startsWith('@hansen/')))
}

/** Summarize one native snapshot without inventing health or collapsing Loader phases. */
export function summarizePaimindInventory(
  snapshot: HarnessPluginInventorySnapshot,
): Readonly<PaimindInventorySummary> {
  const entries = paimindInventoryEntries(snapshot)
  const summary: PaimindInventorySummary = {
    total: entries.length,
    active: entries.filter(entry => entry.enabled && entry.fiberPhase === 'active').length,
    loading: entries.filter(entry => entry.enabled && LOADING_PHASES.has(entry.fiberPhase)).length,
    failed: entries.filter(entry => entry.enabled && entry.fiberPhase === 'failed').length,
    disabled: entries.filter(entry => !entry.enabled).length,
    unobserved: entries.filter(entry => entry.enabled && entry.fiberPhase === null).length,
  }
  return Object.freeze(summary)
}

/** Join one product descriptor to Loader facts only by its exact package module id. */
export function projectDeveloperSurface(
  descriptor: Readonly<PaimindExtensionDescriptor>,
  snapshot: HarnessPluginInventorySnapshot,
): Readonly<DeveloperSurfaceProjection> {
  return Object.freeze({ descriptor, ...projectHarnessPluginTechnicalState(descriptor.packageName, snapshot) })
}

export type PaimindIntegrationReferenceKind = 'slot' | 'service' | 'adapter' | 'event' | 'projection'

export interface PaimindIntegrationReference {
  readonly id: string
  readonly kind: PaimindIntegrationReferenceKind
  readonly contract: string
  readonly owner: 'Harness' | 'PAIMind'
  readonly descriptionZh: string
  readonly descriptionEn: string
}

/**
 * Build-version reference, not runtime observation. Every identifier below is an
 * implemented public boundary and is intentionally independent of Better Sidebar internals.
 */
export const PAIMIND_INTEGRATION_REFERENCES: readonly Readonly<PaimindIntegrationReference>[] = Object.freeze([
  Object.freeze({
    id: 'extension-contribution', kind: 'slot', contract: 'paimind.extension', owner: 'PAIMind',
    descriptionZh: '独立功能包发布不可变产品元数据；Extension Center 只是只读消费方。',
    descriptionEn: 'Independent packages contribute immutable product metadata; Extension Center is a read-only consumer.',
  }),
  Object.freeze({
    id: 'workspace-context', kind: 'service', contract: 'paimindWorkspaceProject', owner: 'PAIMind',
    descriptionZh: '把 Project 语义映射到 Harness Workspace 与 Session，不创建第二套 Project。',
    descriptionEn: 'Maps Project semantics to Harness Workspace and Session without a second Project domain.',
  }),
  Object.freeze({
    id: 'task-action', kind: 'slot', contract: 'conversation.session.header.actions', owner: 'Harness',
    descriptionZh: 'Task Monitor 的独立按钮注册点；任务事实继续来自原生 Job。',
    descriptionEn: 'Independent Task Monitor action point; task facts continue to come from native Jobs.',
  }),
  Object.freeze({
    id: 'artifact-generators', kind: 'service', contract: 'paimindArtifactGenerators', owner: 'PAIMind',
    descriptionZh: '生成器 Provider 注册表；调用仍通过 Harness Tool、Workspace、Session 与 Job。',
    descriptionEn: 'Generator-provider registry whose calls still use Harness Tool, Workspace, Session, and Job objects.',
  }),
  Object.freeze({
    id: 'artifact-envelope', kind: 'event', contract: 'paimind.tool-result/v1', owner: 'PAIMind',
    descriptionZh: '写入原生 tool/result.meta 的结构化 Artifact 与 Trace 事实。',
    descriptionEn: 'Structured Artifact and Trace facts carried by native tool/result.meta.',
  }),
  Object.freeze({
    id: 'artifact-projection', kind: 'projection', contract: 'paimind.artifacts', owner: 'PAIMind',
    descriptionZh: '从原生 Session 事件折叠的浏览器安全 Artifact 与 Trace 投影。',
    descriptionEn: 'Browser-safe Artifact and Trace projection folded from native Session events.',
  }),
  Object.freeze({
    id: 'preview-adapter', kind: 'adapter', contract: 'paimindSidebar', owner: 'PAIMind',
    descriptionZh: '稳定 Preview/Side Card 通道；Bento 等 Renderer 不直接依赖 Better Sidebar 内部接口。',
    descriptionEn: 'Stable Preview/Side Card channel that keeps renderers such as Bento off Better Sidebar internals.',
  }),
  Object.freeze({
    id: 'settings-section', kind: 'slot', contract: 'settings.section', owner: 'Harness',
    descriptionZh: 'PAIMind 产品设置页进入 Harness 原生 Settings Shell 的注册点。',
    descriptionEn: 'Registration point for PAIMind product sections in the native Harness Settings shell.',
  }),
])
