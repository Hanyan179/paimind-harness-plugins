import { isAbsolute, normalize, parse } from 'node:path'
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

/** Trusted deployment configuration, never a remote/member-selected path. */
export interface SkillMarketConfig {
  /** Single source-owned repository; policy, staging and backups stay private. */
  readonly skillRoot?: string
}

export function apply(ctx: SkillInstallerHostContext & {
  inject(
    names: readonly ['paimindAgentProfiles'],
    callback: (scope: SkillInstallerHostContext) => void | Promise<void>,
  ): void
}, config: SkillMarketConfig = {}): void {
  if (config === null || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => key !== 'skillRoot')) {
    throw new Error('Invalid Skill Market deployment configuration')
  }
  const { skillRoot } = config
  if (skillRoot !== undefined && (typeof skillRoot !== 'string' || skillRoot.includes('\0')
    || !isAbsolute(skillRoot) || normalize(skillRoot) !== skillRoot || parse(skillRoot).root === skillRoot)) {
    throw new Error('Skill Market skillRoot must be a canonical absolute repository directory')
  }
  // Skill Center owns direct-chat policy and Business Skill storage, so its
  // service must remain available without the optional Agent Center sibling.
  const service = new PaimindSkillInstallerService(ctx, skillRoot === undefined ? {} : { skillRoot })
  // Re-apply the persisted source-owned capability choice whenever the optional
  // Agent provider appears or is replaced. This child fiber does not own or gate
  // the Skill Center service itself.
  ctx.inject(['paimindAgentProfiles'], async () => {
    await service.reconcileAgentSourcePolicy()
  })
}
