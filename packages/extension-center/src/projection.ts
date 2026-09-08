import type { PaimindExtensionDescriptor } from '@hansen/contracts'
import type {
  HarnessPluginInventoryEntry,
  HarnessPluginInventorySnapshot,
  HarnessPluginTechnicalState,
} from '@hansen/harness-compat'
import { projectHarnessPluginTechnicalState } from '@hansen/harness-compat'

/** Product state and Loader state are intentionally separate dimensions. */
export type ExtensionTechnicalState = HarnessPluginTechnicalState

/** One technical-detail row after joining product metadata with Harness facts. */
export interface PaimindExtensionProjection {
  readonly descriptor: Readonly<PaimindExtensionDescriptor>
  readonly technicalState: ExtensionTechnicalState
  readonly entries: readonly HarnessPluginInventoryEntry[]
}

/** Join by exact package module id; names, descriptions, and Loader entry ids are never guessed. */
export function projectExtensionTechnicalState(
  descriptor: Readonly<PaimindExtensionDescriptor>,
  snapshot: HarnessPluginInventorySnapshot,
): PaimindExtensionProjection {
  return Object.freeze({ descriptor, ...projectHarnessPluginTechnicalState(descriptor.packageName, snapshot) })
}

/** Stable product ordering: category order is owned by the UI, then descriptor order and id. */
export function compareExtensionDescriptors(
  left: Readonly<PaimindExtensionDescriptor>,
  right: Readonly<PaimindExtensionDescriptor>,
): number {
  return (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
}
