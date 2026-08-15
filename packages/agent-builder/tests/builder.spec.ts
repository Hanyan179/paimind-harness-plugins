import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  effectivePresetForFirstTurn,
  replacePresetPersona,
  summarizeConversationEvents,
  visibleAssistantReplyForFirstTurn,
  type AgentBusinessProfile,
} from '../src/index.js'

const profile: AgentBusinessProfile = {
  agentId: 'my-agent', presetId: 'my-agent', name: 'Evidence Agent', description: 'Evidence first',
  basePresetId: 'standard', role: 'Act as a product analyst.', goal: 'Produce decision-ready findings.',
  behavior: 'Start every answer with [EVIDENCE].', preferredSkillNames: ['web-research'],
  instructions: 'Keep responses concise.', revision: 1, configVersion: 'v1-test', updatedAt: 1, health: 'healthy',
}

describe('headless Agent profile workflow', () => {
  it('replaces only the native persona row and embeds business behavior and preferred Skills', () => {
    const source = "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: old\n\n- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n"
    const result = replacePresetPersona(source, profile)
    expect(result).toContain('You are Evidence Agent')
    expect(result).toContain('Start every answer with [EVIDENCE].')
    expect(result).toContain('- web-research')
    expect(result).toContain("- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'")
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
