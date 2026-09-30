import type { ComponentType } from 'react'

export interface AdoptedSkillSelection {
  readonly publicationId: string; readonly name: string; readonly packageDigest: string; readonly archiveDigest: string
}
/** UI projection only. No account, installer API or user policy is exposed. */
export interface SkillCenterPanelProps {
  readonly showAdoptedSkill?: (selection: AdoptedSkillSelection, signal: AbortSignal) => Promise<void>
  readonly onEditing?: (editing: boolean) => void
  readonly registerCloseGuard?: (guard: () => boolean) => () => void
}
export interface SkillPublicationSourceSelection {
  readonly skillId: string; readonly name: string; readonly digest: string
}
export interface SkillCenterSourceActionProps {
  readonly selection: Readonly<{ skillId: string; name: string }>
  readonly readSource: (skillId: string, signal: AbortSignal) => Promise<SkillPublicationSourceSelection>
  readonly disabled: boolean
  readonly onEditing: (editing: boolean) => void
  readonly registerCloseGuard?: (guard: () => boolean) => () => void
}
export interface SkillCenterContribution {
  readonly id: string; readonly zh: string; readonly en: string; readonly Panel: ComponentType<SkillCenterPanelProps>
  readonly SourceAction?: ComponentType<SkillCenterSourceActionProps>
}
export interface SkillCenterContributionSnapshot { readonly revision: number; readonly contribution: SkillCenterContribution | null }
export interface SkillCenterContributions {
  readonly getSnapshot: () => SkillCenterContributionSnapshot
  readonly subscribe: (listener: () => void) => () => void
  register(contribution: SkillCenterContribution): () => void
}
/** Single optional catalog contribution, not a Skill or permission registry. */
export class SkillCenterContributionRegistry implements SkillCenterContributions {
  private snapshot: SkillCenterContributionSnapshot = Object.freeze({ revision: 0, contribution: null })
  private readonly listeners = new Set<() => void>()
  private disposed = false
  readonly getSnapshot = () => this.snapshot
  readonly subscribe = (listener: () => void) => {
    if (!this.disposed) this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(contribution: SkillCenterContribution | null): void {
    this.snapshot = Object.freeze({ revision: this.snapshot.revision + 1, contribution })
    for (const listener of this.listeners) listener()
  }
  register(input: SkillCenterContribution): () => void {
    if (this.disposed || this.snapshot.contribution) throw new Error('Skill Center governance provider already present or disposed')
    if (!/^[a-z][a-z0-9-]{0,79}$/u.test(input.id) || typeof input.Panel !== 'function'
      || input.SourceAction !== undefined && typeof input.SourceAction !== 'function'
      || [input.zh, input.en].some(label => typeof label !== 'string' || !label.trim() || label.trim() !== label || label.length > 80)) {
      throw new Error('Invalid Skill Center contribution')
    }
    const contribution = Object.freeze({ ...input }); this.publish(contribution)
    return () => { if (this.snapshot.contribution === contribution) this.publish(null) }
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.publish(null); this.listeners.clear() }
}
export const EMPTY_SKILL_CENTER_CONTRIBUTION: SkillCenterContributionSnapshot = Object.freeze({ revision: 0, contribution: null })
