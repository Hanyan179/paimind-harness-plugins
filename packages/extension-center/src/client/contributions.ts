import type { ComponentType } from 'react'

/** One optional UI owner, not a runtime, permission or feature registry. */
export interface FeatureManagementContribution { readonly id: string; readonly Panel: ComponentType }
export interface FeatureManagementSnapshot { readonly required: boolean; readonly contribution: FeatureManagementContribution | null }
export interface FeatureManagementContributions {
  readonly getSnapshot: () => FeatureManagementSnapshot
  readonly subscribe: (listener: () => void) => () => void
  register(contribution: FeatureManagementContribution): () => void
}
export class FeatureManagementContributionRegistry implements FeatureManagementContributions {
  private value: FeatureManagementSnapshot = Object.freeze({ required: false, contribution: null })
  private readonly listeners = new Set<() => void>()
  private disposed = false
  readonly getSnapshot = () => this.value
  readonly subscribe = (listener: () => void) => { if (!this.disposed) this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(contribution: FeatureManagementContribution | null) {
    // Losing a governance provider must not expose the ordinary direct switch.
    this.value = Object.freeze({ required: true, contribution })
    for (const listener of [...this.listeners]) listener()
  }
  register(input: FeatureManagementContribution): () => void {
    if (this.disposed || this.value.contribution || !/^[a-z][a-z0-9-]{0,79}$/u.test(input.id) || typeof input.Panel !== 'function') throw Error('Feature management provider already present, disposed or invalid')
    const contribution = Object.freeze({ ...input }); this.publish(contribution)
    return () => { if (this.value.contribution === contribution) this.publish(null) }
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.publish(null); this.listeners.clear() }
}
