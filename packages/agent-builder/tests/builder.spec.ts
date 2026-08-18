import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_SKILL_SCOPE_DIRECTORY,
  PaimindAgentProfileService,
  effectivePresetForFirstTurn,
  replacePresetPersona,
  replacePresetSkillScope,
  summarizeConversationEvents,
  visibleAssistantReplyForFirstTurn,
  type AgentBusinessProfile,
} from '../src/index.js'
import { PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS } from '../src/remote.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const profile: AgentBusinessProfile = {
  agentId: 'my-agent', presetId: 'my-agent', name: 'Evidence Agent', description: 'Evidence first',
  basePresetId: 'standard', role: 'Act as a product analyst.', goal: 'Produce decision-ready findings.',
  behavior: 'Start every answer with [EVIDENCE].', preferredSkillNames: ['web-research'],
  instructions: 'Keep responses concise.', revision: 1, configVersion: 'v1-test', updatedAt: 1, health: 'healthy',
}

describe('headless Agent profile workflow', () => {
  it('keeps Business Agent placement across the strict Remote contract', () => {
    const descriptor = PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS.find(row => row.method === 'saveProfile')
    const inputSchema = (descriptor?.parameters[0] as { codec?: { schema?: { parse(value: unknown): unknown } } } | undefined)?.codec?.schema
    const resultSchema = (descriptor?.result as { schema?: { parse(value: unknown): unknown } } | undefined)?.schema
    const businessPlacement = { productKind: 'business', businessCategory: '产品与 PDM', businessCategoryId: 'product-pdm' }
    const input = { ...profile, ...businessPlacement }
    expect(inputSchema?.parse(input)).toMatchObject(businessPlacement)
    expect(resultSchema?.parse(input)).toMatchObject(businessPlacement)
  })

  it('replaces only the native persona row and embeds business behavior and preferred Skills', () => {
    const source = "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n"
    const result = replacePresetPersona(source, profile)
    expect(result).toContain('You are Evidence Agent')
    expect(result).toContain('Start every answer with [EVIDENCE].')
    expect(result).toContain('Session-injected Skills:')
    expect(result).toContain('- web-research')
    expect(result).toContain("- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'")
  })

  it('replaces native filesystem discovery with one idempotent per-Agent Skill projection', () => {
    const source = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n"
    const first = replacePresetSkillScope(source, '/tmp/agent-scope', 'v1-test')
    const second = replacePresetSkillScope(first, '/tmp/agent-scope', 'v1-test')
    expect(second).toBe(first)
    expect(first).toContain('includeDefaultRoots: false')
    expect(first).toContain('customSkillDirs:')
    expect(first).toContain('"/tmp/agent-scope"')
    expect(first.match(/# PAIMind skill scope:/g)).toHaveLength(1)
    expect(first).toContain("- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'")
  })

  it('projects only packaged installed Skills into the copied native Preset and repairs scope drift', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-scope-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const stateRoot = join(base, '.state')
    const skillRoot = join(base, 'skills')
    const source = join(presetRoot, 'my-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n")
    await writeFile(join(source, 'preset.yml'), 'name: Old\n')
    for (const name of ['selected-skill', 'unselected-skill']) {
      await mkdir(join(skillRoot, name), { recursive: true })
      await writeFile(join(skillRoot, name, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`)
    }
    const context = { reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot, now: () => 42 })
    await service.saveProfile({
      agentId: 'my-agent', presetId: 'my-agent', name: 'Scoped Agent', description: 'Scoped', basePresetId: 'standard',
      role: 'Researcher', goal: 'Use only packaged capabilities', behavior: 'Be precise',
      preferredSkillNames: ['selected-skill'], instructions: '',
    })
    const scopeRoot = join(source, AGENT_SKILL_SCOPE_DIRECTORY)
    await expect(realpath(join(scopeRoot, 'selected-skill'))).resolves.toBe(await realpath(join(skillRoot, 'selected-skill')))
    await expect(stat(join(scopeRoot, 'unselected-skill'))).rejects.toThrow()
    const composition = await readFile(join(source, 'agent.cordis.yml'), 'utf8')
    expect(composition).toContain('includeDefaultRoots: false')
    expect(composition).toContain(JSON.stringify(scopeRoot))

    await rm(scopeRoot, { recursive: true, force: true })
    await writeFile(join(source, 'agent.cordis.yml'), composition.replace('Session-injected Skills:', 'Preferred installed Skills:'))
    const listed = await service.listProfiles()
    expect(listed.profiles[0]?.health).toBe('healthy')
    await expect(realpath(join(scopeRoot, 'selected-skill'))).resolves.toBe(await realpath(join(skillRoot, 'selected-skill')))
    await expect(readFile(join(source, 'agent.cordis.yml'), 'utf8')).resolves.toContain('Session-injected Skills:')
  })

  it('rejects Skill injection for Minimal mode at the host boundary', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-agent-minimal-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'minimal-agent')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    const context = { reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state') })
    await expect(service.saveProfile({
      agentId: 'minimal-agent', presetId: 'minimal-agent', name: 'Minimal Agent', description: '', basePresetId: 'minimal',
      role: 'Minimal', goal: 'No skills', behavior: 'Stay minimal', preferredSkillNames: ['selected-skill'], instructions: '',
    })).rejects.toThrow('极简模式不可封装 Skill')
  })

  it('persists Business Agent placement beside the real native Preset', async () => {
    const base = await mkdtemp(join(tmpdir(), 'paimind-business-agent-'))
    roots.push(base)
    const presetRoot = join(base, '.agent-presets')
    const source = join(presetRoot, 'pdm-assistant')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n")
    await writeFile(join(source, 'preset.yml'), 'name: PDM Assistant\n')
    const context = { reflect: { provide: () => {} }, effect(install: () => void) { install() }, get: () => undefined }
    const service = new PaimindAgentProfileService(context as never, { presetRoot, stateRoot: join(base, '.state'), now: () => 77 })

    const saved = await service.saveProfile({
      agentId: 'pdm-assistant', presetId: 'pdm-assistant', name: 'PDM Assistant', description: 'Product work', basePresetId: 'minimal',
      role: 'PDM analyst', goal: 'Maintain product decisions', behavior: 'Use product evidence', preferredSkillNames: [], instructions: '',
      productKind: 'business', businessCategory: '产品与 PDM',
    })

    expect(saved.productKind).toBe('business')
    expect(saved.businessCategory).toBe('产品与 PDM')
    expect(saved.businessCategoryId).toMatch(/^category-[a-f0-9]{12}$/)
    await expect(service.listProfiles()).resolves.toEqual({ profiles: [expect.objectContaining({
      presetId: 'pdm-assistant', productKind: 'business', businessCategory: '产品与 PDM', businessCategoryId: saved.businessCategoryId,
    })] })
    await expect(readFile(join(source, '.paimind-agent.json'), 'utf8')).resolves.toContain('"productKind": "business"')
  })

  it('builds migration summaries from visible human and assistant messages only', () => {
    const summary = summarizeConversationEvents([
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Need a plan' }] } },
      { type: 'tool/call', data: { arguments: 'secret internal call' } },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hidden injection' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Here is the plan' }] } } },
    ], 'old-session')
    expect(summary).toContain('Need a plan')
    expect(summary).toContain('Here is the plan')
    expect(summary).toContain('old-session')
    expect(summary).toContain('已使用最新版智能体继续。')
    expect(summary).not.toContain('secret internal call')
    expect(summary).not.toContain('hidden injection')
  })

  it('folds native preset-selection events before the first human turn', () => {
    expect(effectivePresetForFirstTurn({
      header: { agentPreset: 'paimind' },
      events: [
        { type: 'agent-preset/selected', data: { agentPreset: 'my-agent' } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'agent-preset/selected', data: { agentPreset: 'too-late' } },
      ],
    })).toBe('my-agent')
  })

  it('uses the visible first-turn reply instead of a tool-only assistant step', () => {
    expect(visibleAssistantReplyForFirstTurn({
      events: [
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'assistant/message', seq: 11, data: { message: { content: [{ type: 'tool-call', name: 'skill' }] } } },
        { type: 'assistant/message', seq: 12, data: { message: { content: [{ type: 'text', text: '正在查询。' }] } } },
        { type: 'assistant/message', seq: 13, data: { message: { content: [{ type: 'text', text: '最终答复。' }] } } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'assistant/message', seq: 14, data: { message: { content: [{ type: 'text', text: '第二轮。' }] } } },
      ],
    })).toEqual({ seq: 13, text: '最终答复。' })
  })

  it('is a headless package with no independent client page', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'packages/agent-builder/package.json'), 'utf8')) as { dsh?: unknown; paimindBuild?: { client?: unknown } }
    expect(manifest.dsh).toBeUndefined()
    expect(manifest.paimindBuild?.client).toBeUndefined()
  })
})
