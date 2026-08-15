import type { PaimindExtensionDescriptor } from '@paimind/contracts'
import type {
  HarnessPluginFiberPhase,
  HarnessPluginInventoryEntry,
  HarnessPluginInventorySnapshot,
} from '@paimind/harness-compat'

/** Host half is empty: Extension Center is a read-only browser projection. */
export const name = 'paimind-extension-center'
export function apply(): void {}

/** Product state and Loader state are intentionally separate dimensions. */
export type ExtensionTechnicalState =
  | 'active'
  | 'loading'
  | 'failed'
  | 'disabled'
  | 'unobserved'
  | 'unavailable'

/** One Extension Center row after joining PAIMind metadata with Harness facts. */
export interface PaimindExtensionProjection {
  readonly descriptor: Readonly<PaimindExtensionDescriptor>
  readonly technicalState: ExtensionTechnicalState
  readonly entries: readonly HarnessPluginInventoryEntry[]
}

const LOADING_PHASES = new Set<HarnessPluginFiberPhase>(['pending', 'loading', 'unloading'])

/** Join by exact package module id; names, descriptions, and Loader entry ids are never guessed. */
export function projectExtensionTechnicalState(
  descriptor: Readonly<PaimindExtensionDescriptor>,
  snapshot: HarnessPluginInventorySnapshot,
): PaimindExtensionProjection {
  const entries = Object.freeze(snapshot.entries.filter(entry => entry.moduleName === descriptor.packageName))
  let technicalState: ExtensionTechnicalState
  if (entries.length === 0) technicalState = 'unavailable'
  else if (entries.some(entry => entry.enabled && entry.fiberPhase === 'failed')) technicalState = 'failed'
  else if (entries.some(entry => entry.enabled && LOADING_PHASES.has(entry.fiberPhase))) technicalState = 'loading'
  else if (entries.some(entry => entry.enabled && entry.fiberPhase === 'active')) technicalState = 'active'
  else if (entries.every(entry => !entry.enabled)) technicalState = 'disabled'
  else technicalState = 'unobserved'
  return Object.freeze({ descriptor, technicalState, entries })
}

/** Stable product ordering: category order is owned by the UI, then descriptor order and id. */
export function compareExtensionDescriptors(
  left: Readonly<PaimindExtensionDescriptor>,
  right: Readonly<PaimindExtensionDescriptor>,
): number {
  return (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
}
