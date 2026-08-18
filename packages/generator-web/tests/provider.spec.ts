import { describe, expect, it, vi } from 'vitest'
import { apply, htmlDocumentProvider } from '../src/index.js'

describe('R2 HTML generator provider', () => {
  it('publishes only through the runtime write capability and keeps semantics static', async () => {
    const writeText = vi.fn(async (path: string) => path)
    const output = await htmlDocumentProvider.generate({
      file_path: 'report.html', title: 'Report', html: '<!doctype html><title>Report</title>',
    }, { signal: new AbortController().signal, writeText })
    expect(htmlDocumentProvider).toMatchObject({ kind: 'html', previewKind: 'html-document' })
    expect(writeText).toHaveBeenCalledWith('report.html', '<!doctype html><title>Report</title>')
    expect(output).toEqual({ path: 'report.html', title: 'Report' })
  })

  it('rejects missing structured input instead of inferring from prose', () => {
    expect(() => htmlDocumentProvider.describe({ title: 'No path', html: '<p>x</p>' })).toThrow(/file_path/)
  })

  it('declares native edit intent and an exact location so successful calls join Harness Deliverables', () => {
    let definition: any
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute: vi.fn(), list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definition = value; return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) },
      effect(install) { install() },
    })
    expect(definition.presentCall({
      file_path: 'report.html', title: 'Report', html: '<!doctype html>',
    })).toMatchObject({ kind: 'edit', locations: [{ path: 'report.html' }] })
  })
})
