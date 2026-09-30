// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { registerPaimindHostLiteralPrompt } from '../../harness-compat/src/host.js'
import { authorizeNativeOperation } from '../../../apps/enterprise-server/src/native-operation-policy.js'
import * as enterprise from '../src/index.js'

const local = createRequire(import.meta.url)
const base = createRequire(createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-base/package.json'))
const { Context } = base('@deepseek-ai/cordis')
const { FileSettingsProvider } = base('@deepseek-ai/dsh-settings-file')
const { settingsNamespace } = base('@deepseek-ai/dsh-settings')
const ns = settingsNamespace('paimind-enterprise-instructions')
const roots: Array<InstanceType<typeof Context>> = []
afterEach(async () => { for (const root of roots.splice(0).reverse()) await root.fiber.dispose() })
const directory = () => mkdtemp(join(process.env.PAIMIND_HAAS_PROTOCOL_EVIDENCE ?? tmpdir(), 'instruction-owner-'))
async function boot(home: string) {
  const root = new Context(); roots.push(root)
  await root.plugin(FileSettingsProvider, { path: join(home, 'settings.json'), dshHome: home, watch: false })
  await root.plugin(SystemPrompt, { persona: 'Original native deployment persona.' })
  const plugin = await root.plugin(enterprise)
  return { root, plugin, prompt: async () => renderPrompt(await root.systemPrompt.assemble()) }
}

// Native settings files and native prompt assembly, not a gateway/browser or
// model test. No existing member home, live database or credential is used.
describe('ISO-03 native per-cell enterprise instructions', () => {
  it('keeps independent member files and original prompt owners across cold restart', async () => {
    const hansenHome = await directory(), alexHome = await directory()
    const hansen = await boot(hansenHome), alex = await boot(alexHome)
    await hansen.root.settings.update(ns, { instructions: 'Hansen: write concise trade summaries.' }, 0)
    await alex.root.settings.update(ns, { instructions: 'Alex: state the order assumptions.' }, 0)
    expect(await hansen.prompt()).toContain('Hansen: write concise trade summaries.')
    expect(await hansen.prompt()).not.toContain('Alex:')
    expect(await alex.prompt()).toContain('Alex: state the order assumptions.')
    expect(await alex.prompt()).not.toContain('Hansen:')
    for (const member of [hansen, alex]) {
      expect(await member.prompt()).toContain('You are an AI agent powered by DeepSeek Harness.')
      expect(await member.prompt()).toContain('Original native deployment persona.')
    }
    const beforeHansen = await readFile(join(hansenHome, 'settings.json'))
    const beforeAlex = await readFile(join(alexHome, 'settings.json'))
    await hansen.root.fiber.dispose(); await alex.root.fiber.dispose()
    const recoveredHansen = await boot(hansenHome), recoveredAlex = await boot(alexHome)
    expect(await recoveredHansen.prompt()).toContain('Hansen: write concise trade summaries.')
    expect(await recoveredAlex.prompt()).toContain('Alex: state the order assumptions.')
    expect(await readFile(join(hansenHome, 'settings.json'))).toEqual(beforeHansen)
    expect(await readFile(join(alexHome, 'settings.json'))).toEqual(beforeAlex)
  })
  it('treats administrator text as literal, never as native variable lookup or a complete replacement', async () => {
    const f = await boot(await directory())
    f.root.systemPrompt.variable('private_value', () => 'DO_NOT_INTERPOLATE')
    const text = 'Keep {{private_value}}, {{unknown_variable}}, <tag> and Chinese 中文 literally.'
    await f.root.settings.update(ns, { instructions: text }, 0)
    expect(await f.prompt()).toContain(text)
    expect(await f.prompt()).not.toContain('DO_NOT_INTERPOLATE')
    const assembly = await f.root.systemPrompt.assemble()
    expect(assembly.sections.filter(row => row.name === 'paimind:enterprise-instructions')).toHaveLength(1)
  })
  it('reads the latest native value, rejects stale and oversized writes and preserves disabled text', async () => {
    const home = await directory(), f = await boot(home)
    await f.root.settings.update(ns, { instructions: 'First approved instructions.' }, 0)
    await expect(f.root.settings.update(ns, { instructions: 'Stale overwrite.' }, 0)).rejects.toThrow()
    const saved = await readFile(join(home, 'settings.json'))
    await expect(f.root.settings.update(ns, { instructions: 'x'.repeat(8_001) }, 1)).rejects.toThrow()
    expect(await readFile(join(home, 'settings.json'))).toEqual(saved)
    await f.root.settings.update(ns, { enabled: false }, 1)
    expect(await f.prompt()).not.toContain('First approved instructions.')
    expect(f.root.settings.get(ns)?.instructions).toBe('First approved instructions.')
    await f.root.settings.update(ns, { enabled: true, instructions: 'Second approved instructions.' }, 2)
    expect(await f.prompt()).toContain('Second approved instructions.')
    expect(await f.prompt()).not.toContain('First approved instructions.')
  })
  it('unloads only its registrations, retains native bytes, and reloads exactly once', async () => {
    const home = await directory(), f = await boot(home)
    await f.root.settings.update(ns, { instructions: 'Persistent enterprise text.' }, 0)
    const saved = await readFile(join(home, 'settings.json'))
    await f.plugin.dispose()
    expect(f.root.settings.get(ns)).toBeUndefined()
    expect(await f.prompt()).not.toContain('Persistent enterprise text.')
    expect(await f.prompt()).toContain('Original native deployment persona.')
    expect(await readFile(join(home, 'settings.json'))).toEqual(saved)
    await f.root.plugin(enterprise)
    expect(await f.prompt()).toContain('Persistent enterprise text.')
    expect((await f.root.systemPrompt.assemble()).sections.filter(row => row.name === 'paimind:enterprise-instructions')).toHaveLength(1)
  })
  it('does not grant a member any direct settings mutation path', () => {
    for (const method of ['settings.update', 'settings.replace', 'settings.mutate']) {
      expect(() => authorizeNativeOperation('member', { method: 'POST', target: '/api/' + method, contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'member-denial', method,
          payload: { ns, patch: { instructions: 'unauthorized' }, section: {}, ops: [] } })) })).toThrow()
    }
  })
  it('releases a variable if the native section registration refuses the name', async () => {
    const f = await boot(await directory())
    expect(() => registerPaimindHostLiteralPrompt(f.root.systemPrompt, { name: 'paimind:enterprise-instructions', order: 20,
      variable: 'paimind_failed_registration', text: () => 'must not survive' })).toThrow()
    expect((await f.root.systemPrompt.assemble()).variables).not.toHaveProperty('paimind_failed_registration')
  })
  it('waits for its native settings provider and detaches when that provider is removed', async () => {
    const root = new Context(); roots.push(root)
    await root.plugin(SystemPrompt, {})
    const plugin = root.plugin(enterprise)
    expect((await root.systemPrompt.assemble()).sections.some((row: { name: string }) => row.name === 'paimind:enterprise-instructions')).toBe(false)
    const home = await directory()
    const provider = await root.plugin(FileSettingsProvider, { path: join(home, 'settings.json'), dshHome: home, watch: false })
    await plugin
    await root.settings.update(ns, { instructions: 'Provider-bound instructions.' }, 0)
    expect(renderPrompt(await root.systemPrompt.assemble())).toContain('Provider-bound instructions.')
    await provider.dispose()
    expect(renderPrompt(await root.systemPrompt.assemble())).not.toContain('Provider-bound instructions.')
    expect(renderPrompt(await root.systemPrompt.assemble())).toContain('DeepSeek Harness')
  })
})
