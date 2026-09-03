import {
  PaimindSkillInstallerService,
  type SkillInstallerHostContext,
} from './installer.js'

export * from './installer.js'
export * from './catalog.js'
export * from './recommended.js'
export * from './scope.js'

/** Product-layer installer; Harness still owns discovery and execution. */
export const name = 'paimind-skill-market'
export const inject = ['webServer', 'tools', 'skills', 'sessions', 'agents']

export function apply(ctx: SkillInstallerHostContext & {
  inject(
    names: readonly ['paimindAgentProfiles'],
    callback: (scope: SkillInstallerHostContext) => void | Promise<void>,
  ): void
}): void {
  // Skill Center owns direct-chat policy and Business Skill storage, so its
  // service must remain available without the optional Agent Center sibling.
  const service = new PaimindSkillInstallerService(ctx)
  // Re-apply the persisted source-owned capability choice whenever the optional
  // Agent provider appears or is replaced. This child fiber does not own or gate
  // the Skill Center service itself.
  ctx.inject(['paimindAgentProfiles'], async () => {
    await service.reconcileAgentSourcePolicy()
  })
}
