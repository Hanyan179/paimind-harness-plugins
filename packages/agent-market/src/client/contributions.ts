import type { ComponentType } from 'react'

/** UI-only owner seam. No principal, native API or persistent resource is
 * transferred to a contributor; each contributor authorizes its own requests. */
export interface AgentCenterPanelProps {
  readonly query: string
  /** Narrow native-owner actions, not the underlying Session/Preset API.
   * Preparation never writes the composer or sends a message. */
  readonly prepareConversation?: (presetId: string, signal: AbortSignal) => Promise<string>
  readonly returnToConversation?: () => boolean | void
  readonly onEditing?: (editing: boolean) => void
  readonly registerCloseGuard?: (guard: () => boolean) => () => void
}
export interface AgentCenterPersonalActionProps {
  readonly selection: Readonly<{ presetId: string; configVersion: string; name: string }>
  readonly disabled: boolean
  readonly onEditing: (editing: boolean) => void
  readonly registerCloseGuard?: (guard: () => boolean) => () => void
}
export interface AgentCenterContribution {
  readonly id: string
  readonly personalLabel: Readonly<{ zh: string; en: string }>
  readonly tabs: readonly Readonly<{ id: string; zh: string; en: string; Panel: ComponentType<AgentCenterPanelProps> }>[]
  readonly PersonalAction: ComponentType<AgentCenterPersonalActionProps>
}
export interface AgentCenterContributionSnapshot { readonly revision: number; readonly contribution: AgentCenterContribution | null }
export interface AgentCenterContributions {
  readonly getSnapshot: () => AgentCenterContributionSnapshot
  readonly subscribe: (listener: () => void) => () => void
  register(contribution: AgentCenterContribution): () => void
}

/** Single governance UI provider; this is not an Agent or permission registry. */
export class AgentCenterContributionRegistry implements AgentCenterContributions {
  private snapshot: AgentCenterContributionSnapshot = Object.freeze({ revision: 0, contribution: null })
  private readonly listeners = new Set<() => void>()
  private disposed = false
  readonly getSnapshot = (): AgentCenterContributionSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    if (!this.disposed) this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(contribution: AgentCenterContribution | null): void {
    this.snapshot = Object.freeze({ revision: this.snapshot.revision + 1, contribution })
    for (const listener of [...this.listeners]) listener()
  }
  register(input: AgentCenterContribution): () => void {
    if (this.disposed || this.snapshot.contribution !== null) throw new Error('Agent Center governance provider already present or disposed')
    const id = (value: string) => /^[a-z][a-z0-9-]{0,79}$/u.test(value)
    const label = (value: string) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80
    if (!id(input.id) || !label(input.personalLabel.zh) || !label(input.personalLabel.en)
      || !input.tabs.length || input.tabs.length > 4 || typeof input.PersonalAction !== 'function'
      || input.tabs.some(tab => !id(tab.id) || ['mine', 'platform'].includes(tab.id) || !label(tab.zh) || !label(tab.en) || typeof tab.Panel !== 'function')
      || new Set(input.tabs.map(tab => tab.id)).size !== input.tabs.length) throw new Error('Invalid Agent Center governance contribution')
    const contribution = Object.freeze({ ...input, personalLabel: Object.freeze({ ...input.personalLabel }),
      tabs: Object.freeze(input.tabs.map(tab => Object.freeze({ ...tab }))) })
    this.publish(contribution)
    let removed = false
    return () => {
      if (removed) return
      removed = true
      if (this.snapshot.contribution === contribution) this.publish(null)
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.publish(null); this.listeners.clear()
  }
}

export const EMPTY_AGENT_CENTER_CONTRIBUTION: AgentCenterContributionSnapshot = Object.freeze({ revision: 0, contribution: null })
