import {
  PaimindSkillInstallerService,
  type SkillInstallerHostContext,
} from './installer.js'

export * from './installer.js'
export * from './catalog.js'
export * from './recommended.js'

/** Product-layer installer; Harness still owns discovery and execution. */
export const name = 'paimind-skill-market'
export const inject = ['webServer', 'tools', 'skills']

export function apply(ctx: SkillInstallerHostContext): void {
  new PaimindSkillInstallerService(ctx)
}
