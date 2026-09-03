import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/index.js'

describe('Skill Market runtime dependencies', () => {
  it('activates its Loader entry without hard-injecting sibling or owning Loader services', () => {
    expect(inject).toContain('sessions')
    expect(inject).toContain('agents')
    expect(inject).not.toContain('paimindAgentProfiles')
    expect(inject).not.toContain('paimindWorkspaceBlueprints')
    expect(inject).not.toContain('loader')
    const source = readFileSync(resolve(process.cwd(), 'packages/skill-market/src/index.ts'), 'utf8')
    expect(source.indexOf('new PaimindSkillInstallerService(ctx)')).toBeLessThan(
      source.indexOf("ctx.inject(['paimindAgentProfiles']"),
    )
    expect(source).toContain('service.reconcileAgentSourcePolicy()')
    const installer = readFileSync(resolve(process.cwd(), 'packages/skill-market/src/installer.ts'), 'utf8')
    expect(installer).toContain("get?.('paimindAgentProfiles')")
    expect(installer).toContain("get?.('paimindWorkspaceBlueprints')")
  })

  it('keeps installation separate from Session and Agent selection', () => {
    const instructions = readFileSync(resolve(process.cwd(), 'packages/skill-market/SKILL.md'), 'utf8')
    expect(instructions).toContain('does not add the Skill to the current Session')
    expect(instructions).toContain('Never tell the user that an installed Skill is now available in every conversation')
  })
})
