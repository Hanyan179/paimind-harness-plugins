// @vitest-environment node

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
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
    expect(() => spreadsheetProvider.describe({ file_path: 'book.xlsx', title: 'Book', sheet_name: 'Data', columns: ['A', 'Total'], rows: [[1, null]], formulas: [{ row: 2, column: 2, formula: 'A2' }] })).toThrow(/result/)
    expect(() => presentationProvider.describe({ file_path: '../deck.pptx', title: 'Deck', slides: [{ title: 'One', bullets: [] }] })).toThrow(/Workspace-relative/)
  })

  it('creates structurally real PPTX, PDF and formula-bearing XLSX files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-office-'))
    try {
      const pptx = await generateOfficeArtifact({ kind: 'pptx', file_path: 'deck.pptx', title: 'Deck', slides: [
        { title: 'One', bullets: ['Alpha'] }, { title: 'Two', bullets: ['Beta'] }, { title: 'Three', bullets: ['Gamma'] },
      ] }, root)
      const pdf = await generateOfficeArtifact({
        kind: 'pdf', file_path: 'report.pdf', title: 'R13 验收报告',
        sections: Array.from({ length: 12 }, (_, index) => ({
          heading: `第 ${index + 1} 节`,
          body: `真实中文 PDF 产物与 English evidence 可同时回读。R13_PAGE_SECTION_${index + 1} `.repeat(40),
        })),
      }, root)
      const xlsx = await generateOfficeArtifact({ kind: 'xlsx', file_path: 'book.xlsx', title: 'Book', sheet_name: 'Data', columns: ['Item', 'Q1', 'Q2', 'Total'], rows: [['A', 2, 3, null]], formulas: [{ row: 2, column: 4, formula: 'SUM(B2:C2)', result: 5 }] }, root)
      expect((await readFile(pptx)).subarray(0, 2).toString()).toBe('PK')
      const pdfDocument = await PDFDocument.load(new Uint8Array(await readFile(pdf)))
      expect(pdfDocument.getPageCount()).toBeGreaterThanOrEqual(3)
      for (const page of pdfDocument.getPages()) {
        const contents = page.node.Contents()
        const refs = contents instanceof PDFArray
          ? Array.from({ length: contents.size() }, (_, index) => contents.get(index))
          : [contents]
        const operators = refs.flatMap((ref) => {
          const stream = pdfDocument.context.lookup(ref)
          return stream instanceof PDFRawStream
            ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1').split(/\s+/)
            : []
        })
        let depth = 0
        let minimumDepth = 0
        for (const operator of operators) {
          if (operator === 'q') depth += 1
          if (operator === 'Q') depth -= 1
          minimumDepth = Math.min(minimumDepth, depth)
        }
        expect({ depth, minimumDepth }).toEqual({ depth: 0, minimumDepth: 0 })
      }
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(xlsx)
      expect(workbook.getWorksheet('Data')?.getCell('D2').value).toMatchObject({ formula: 'SUM(B2:C2)', result: 5 })

      await mkdir(join(root, 'inputs'), { recursive: true })
      await writeFile(join(root, 'inputs', 'snapshot.json'), '{"sales":120}\n')
      const sourceSha256 = createHash('sha256').update(await readFile(join(root, 'inputs', 'snapshot.json'))).digest('hex')
      const outline = {
        schema: 'paimind.presentation-outline/v1', title: 'Verified Proposal', subtitle: 'Editable final delivery',
        design: { schema: 'paimind.presentation-design/v1', templateId: 'strategy-grid', stylePreset: 'strategy-consulting', aspectRatio: '16:9', canvas: { width: 1280, height: 720 }, density: 'balanced' },
        sources: [{ sourceId: 'source', name: 'snapshot.json', path: 'inputs/snapshot.json', sha256: sourceSha256, format: 'json', role: 'verified snapshot', period: 'FY2025', summary: 'Frozen input' }],
        facts: [{ factId: 'sales', sourceIds: ['source'], rawValue: 120, displayValue: '$120M', valueType: 'source_value', fieldPath: '$.sales', method: 'Read frozen value', definition: 'Net sales', period: 'FY2025', filters: [], factValuesChanged: false }],
        slides: [{ slideId: 'cover', layout: 'cover', eyebrow: 'BUYER PROPOSAL', title: 'Growth with evidence', narrative: 'A verified commercial proposal.', elements: [{ objectId: 'sales-kpi', type: 'kpi', title: 'Net sales', displayValue: '$120M', factIds: ['sales'], bindings: [{ factId: 'sales', selector: { kind: 'object' } }] }] }],
      }
      await writeFile(join(root, 'proposal.outline.json'), JSON.stringify(outline))
      const verifiedPptx = await generateOfficeArtifact({ kind: 'outline-pptx', file_path: 'proposal.pptx', outline_path: 'proposal.outline.json', outline_artifact_id: 'artifact:outline' }, root)
      expect((await readFile(verifiedPptx)).subarray(0, 2).toString()).toBe('PK')
      expect(JSON.parse(await readFile(join(root, 'proposal.validation.json'), 'utf8'))).toMatchObject({ valid: true, resolutionRate: 1, sourceHashesVerified: true, outlineArtifactId: 'artifact:outline' })
      expect(JSON.parse(await readFile(join(root, 'proposal.trace.json'), 'utf8'))).toMatchObject({ schemaVersion: 'paimind.presentation-trace/v3' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('registers four native artifact tools with edit locations', () => {
    const definitions: any[] = []
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute: vi.fn(), list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definitions.push(value); return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) }, effect(install) { install() },
      sessionProjections: { register: vi.fn(), snapshot: vi.fn() },
    } as any)
    expect(definitions).toHaveLength(4)
    expect(definitions.find(definition => definition.name === 'generate_presentation_artifact').presentCall({ file_path: 'deck.pptx', title: 'Deck', slides: [{ title: 'One', bullets: [] }] })).toMatchObject({ kind: 'edit', locations: [{ path: 'deck.pptx' }] })
    const outlineTool = definitions.find(definition => definition.name === 'generate_pptx_from_outline')
    expect(outlineTool).toBeDefined()
    expect(outlineTool.output.schema.properties.trace.oneOf[1].properties.documentRef).toMatchObject({
      required: ['path', 'schema', 'sha256', 'bytes'],
      properties: { path: { type: 'string' }, schema: { type: 'string' }, sha256: { type: 'string' }, bytes: { type: 'number' } },
    })
  })

  it('resolves only the exact current-Session Outline for an explicitly requested PPTX export', async () => {
    const definitions: any[] = []
    const execute = vi.fn(async () => ({ artifact: { state: 'available' } }))
    const baseArtifact = {
      schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:outline', sessionId: 'session-1', workspaceId: 'workspace-1',
      path: '/workspace/proposal.outline.json', title: 'Outline', kind: 'json', previewKind: 'data-document', revision: 1,
      producerId: 'paimind.generator.presentation-outline', taskId: 'job-outline', state: 'available', producedAt: 1,
    }
    let artifact = baseArtifact
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute, list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definitions.push(value); return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) }, effect(install) { install() },
      sessionProjections: { register: vi.fn(), snapshot: vi.fn(() => ({ asOfSeq: 1, values: { 'paimind.artifacts': { schema: 'paimind.artifacts/v1', artifacts: [artifact], traces: [] } } })) },
    } as any)
    const tool = definitions.find(definition => definition.name === 'generate_pptx_from_outline')
    const exec = {
      callId: 'call-1', rootCallId: 'root-1', name: 'generate_pptx_from_outline', arguments: {}, token: Symbol('tool'),
      signal: new AbortController().signal, agent: { id: 'session-1', session: { id: 'session-1', header: { cwd: '/workspace' } } },
    }
    await expect(tool.execute({ file_path: 'proposal.pptx', outline_artifact_id: baseArtifact.artifactId }, exec)).resolves.toBeDefined()
    expect(execute).toHaveBeenCalledWith('paimind.generator.traceable-pptx', expect.objectContaining({
      file_path: 'proposal.pptx', outline_artifact_id: baseArtifact.artifactId, __outline_path: 'proposal.outline.json',
    }), exec)

    for (const invalid of [
      { ...baseArtifact, sessionId: 'session-2' },
      { ...baseArtifact, producerId: 'untrusted.generator' },
      { ...baseArtifact, path: '/workspace/proposal.json' },
      { ...baseArtifact, path: '/outside/proposal.outline.json' },
    ]) {
      artifact = invalid
      await expect(tool.execute({ file_path: 'proposal.pptx', outline_artifact_id: baseArtifact.artifactId }, exec)).rejects.toThrow()
    }
  })

  it('rejects a traceable PPTX when a frozen source hash no longer matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-office-hash-'))
    try {
      await mkdir(join(root, 'inputs'), { recursive: true })
      await writeFile(join(root, 'inputs', 'snapshot.json'), '{"sales":121}\n')
      await writeFile(join(root, 'proposal.outline.json'), JSON.stringify({
        schema: 'paimind.presentation-outline/v1', title: 'Verified Proposal',
        design: { schema: 'paimind.presentation-design/v1', templateId: 'strategy-grid', stylePreset: 'strategy-consulting', aspectRatio: '16:9', canvas: { width: 1280, height: 720 }, density: 'balanced' },
        sources: [{ sourceId: 'source', name: 'snapshot.json', path: 'inputs/snapshot.json', sha256: '0'.repeat(64), format: 'json', role: 'verified snapshot', period: 'FY2025', summary: 'Frozen input' }],
        facts: [{ factId: 'sales', sourceIds: ['source'], rawValue: 120, displayValue: '$120M', valueType: 'source_value', fieldPath: '$.sales', method: 'Read frozen value', definition: 'Net sales', period: 'FY2025', filters: [], factValuesChanged: false }],
        slides: [{ slideId: 'cover', layout: 'cover', title: 'Growth with evidence', narrative: 'A verified commercial proposal.', elements: [{ objectId: 'sales-kpi', type: 'kpi', title: 'Net sales', displayValue: '$120M', factIds: ['sales'], bindings: [{ factId: 'sales', selector: { kind: 'object' } }] }] }],
      }))
      await expect(generateOfficeArtifact({ kind: 'outline-pptx', file_path: 'proposal.pptx', outline_path: 'proposal.outline.json', outline_artifact_id: 'artifact:outline' }, root)).rejects.toThrow(/hash/i)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
