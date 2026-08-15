import { describe, expect, it, vi } from 'vitest'
import { apply, bentoProvider, renderBentoDocument } from '../src/index.js'

describe('R3 Bento generator provider', () => {
  it('writes one explicit Bento artifact with no external network dependency', async () => {
    const writeText = vi.fn(async (path: string) => path)
    const output = await bentoProvider.generate({ file_path: 'deck.html', title: 'Deck', slides: [
      { eyebrow: 'ONE', title: 'First', body: 'Evidence' }, { title: 'Second', body: 'Decision' },
    ] }, { signal: new AbortController().signal, writeText, runWorkspaceCommand: vi.fn() })
    expect(bentoProvider).toMatchObject({ kind: 'bento', previewKind: 'bento-deck' })
    const html = writeText.mock.calls[0]?.[1] as string
    expect(output).toEqual({ path: 'deck.html', title: 'Deck' })
    expect(html).toContain("paimind:bento-ready")
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  it('escapes content and rejects escaping paths', () => {
    expect(renderBentoDocument('<Title>', [{ title: '<Slide>', body: 'A & B' }])).toContain('&lt;Slide&gt;')
    expect(() => bentoProvider.describe({ file_path: '../deck.html', title: 'Deck', slides: [{ title: 'One', body: 'Body' }] })).toThrow(/Workspace-relative/)
  })

  it('registers one native edit-intent Tool', () => {
    let definition: any
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute: vi.fn(), list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definition = value; return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}) }, effect(install) { install() },
    })
    expect(definition.presentCall({ file_path: 'deck.html', title: 'Deck', slides: [{ title: 'One', body: 'Body' }] })).toMatchObject({ kind: 'edit', locations: [{ path: 'deck.html' }] })
  })
})
