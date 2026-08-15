import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { normalizePresentationTrace } from '@paimind/presentation-trace'
import { generateOfficeArtifact } from '../src/cli.js'
import { apply, presentationProvider, spreadsheetProvider } from '../src/index.js'

describe('R3 Office generator providers', () => {
  it('publishes only through native text + command capabilities with static semantics', async () => {
    const writeText = vi.fn(async (path: string) => path)
    const runWorkspaceCommand = vi.fn(async () => ({ stdout: '' }))
    const output = await presentationProvider.generate({
      file_path: 'deck.pptx', title: 'Deck', slides: [{ title: 'One', bullets: ['Fact'] }],
    }, { signal: new AbortController().signal, writeText, runWorkspaceCommand })
    expect(presentationProvider).toMatchObject({ kind: 'pptx', previewKind: 'presentation' })
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^\.paimind-generation\/.+\.json$/), expect.stringContaining('"kind":"pptx"'))
    expect(runWorkspaceCommand).toHaveBeenCalledWith(expect.objectContaining({ description: 'Generate presentation artifact' }))
    expect(output).toMatchObject({
      path: 'deck.pptx', title: 'Deck',
      traceDocument: { schemaVersion: 'paimind.presentation-trace/v2', reviewStatus: 'generated' },
    })
    expect((output.traceDocument as { slides: readonly unknown[] }).slides).toHaveLength(1)
    expect(normalizePresentationTrace(output.traceDocument).slides).toHaveLength(1)
  })

  it('requires a real formula contract and rejects escaping paths', () => {
    expect(() => spreadsheetProvider.describe({ file_path: 'book.xlsx', title: 'Book', sheet_name: 'Data', columns: ['A'], rows: [[1]], formulas: [] })).toThrow(/formulas/)
    expect(() => presentationProvider.describe({ file_path: '../deck.pptx', title: 'Deck', slides: [{ title: 'One', bullets: [] }] })).toThrow(/Workspace-relative/)
  })

  it('creates structurally real PPTX, PDF and formula-bearing XLSX files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-office-'))
    try {
      const pptx = await generateOfficeArtifact({ kind: 'pptx', file_path: 'deck.pptx', title: 'Deck', slides: [
        { title: 'One', bullets: ['Alpha'] }, { title: 'Two', bullets: ['Beta'] }, { title: 'Three', bullets: ['Gamma'] },
      ] }, root)
      const pdf = await generateOfficeArtifact({ kind: 'pdf', file_path: 'report.pdf', title: 'Report', sections: [{ heading: 'Summary', body: 'A real paginated report generated through the provider.' }] }, root)
      const xlsx = await generateOfficeArtifact({ kind: 'xlsx', file_path: 'book.xlsx', title: 'Book', sheet_name: 'Data', columns: ['Item', 'Q1', 'Q2', 'Total'], rows: [['A', 2, 3, null]], formulas: [{ row: 2, column: 4, formula: 'SUM(B2:C2)' }] }, root)
      expect((await readFile(pptx)).subarray(0, 2).toString()).toBe('PK')
      expect((await PDFDocument.load(new Uint8Array(await readFile(pdf)))).getPageCount()).toBeGreaterThanOrEqual(1)
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(xlsx)
      expect(workbook.getWorksheet('Data')?.getCell('D2').value).toMatchObject({ formula: 'SUM(B2:C2)' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('registers three native artifact tools with edit locations', () => {
    const definitions: any[] = []
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute: vi.fn(), list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definitions.push(value); return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}) }, effect(install) { install() },
    })
    expect(definitions).toHaveLength(3)
    expect(definitions[0].presentCall({ file_path: 'deck.pptx', title: 'Deck', slides: [{ title: 'One', bullets: [] }] })).toMatchObject({ kind: 'edit', locations: [{ path: 'deck.pptx' }] })
  })
})
