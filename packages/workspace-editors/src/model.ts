import {
  Gadget as Docs,
  ExportHandler as DocsExport,
} from './vendor/docs/server.js'
import { Gadget as Slides } from './vendor/slides/server.js'
import {
  Gadget as Sheets,
  ExportHandler as SheetsExport,
} from './vendor/sheets/server.js'
import { z } from 'zod'
import type { WorkspaceDocument, WorkspaceFormat } from './contract.js'
// The imported JavaScript is pinned third-party model code. The public boundary is validated separately.
export interface EditorModel {
  [method: string]: unknown
  getDocument?: () => Promise<unknown>
  getDeck?: () => Promise<unknown>
  getUndoState?: () => Promise<{ canUndo: boolean; canRedo: boolean }>
}
export const editorMethods: Record<WorkspaceFormat, readonly string[]> = {
  docs: [
    'exportMarkdown',
    'getDocument',
    'initializeBlocks',
    'setDocument',
    'applyOperation',
  ],
  slides: [
    'getDeck',
    'getUndoState',
    'undo',
    'redo',
    'addSlide',
    'removeSlide',
    'duplicateSlide',
    'moveSlide',
    'updateSlide',
    'addBlock',
    'updateBlock',
    'removeBlock',
    'reorderBlock',
    'setDeck',
  ],
  sheets: ['exportCsv', 'getDocument', 'applyOperation'],
}
export const isEditorRead = (method: string): boolean =>
  [
    'exportMarkdown',
    'exportCsv',
    'getDocument',
    'getDeck',
    'getUndoState',
  ].includes(method)
export function createEditorModel(document: WorkspaceDocument): {
  model: EditorModel
  data: WorkspaceDocument['data']
} {
  validateEditorData(document)
  const data = structuredClone(document.data)
  const storage = {
    get: async (key: string) => structuredClone(data[key]),
    put: async (key: string, value: never) => {
      data[key] = structuredClone(value)
    },
    delete: async (key: string) => {
      delete data[key]
    },
  }
  const ctx = { storage }
  const Constructor = { docs: Docs, slides: Slides, sheets: Sheets }[
    document.format
  ]
  const model = new Constructor(ctx, {}) as unknown as EditorModel
  if (document.format === 'docs')
    model.exportMarkdown = async () =>
      new Response(await new DocsExport().export(model, 'markdown')).text()
  if (document.format === 'sheets')
    model.exportCsv = async (id: string) =>
      new Response(await new SheetsExport().export(model, 'csv:' + id)).text()
  return { model, data }
}

const version = z.number().int().nonnegative()
const block = z.object({ id: z.string().min(1), html: z.string(), version })
const documentData = z.object({
  revision: version,
  title: z.string(),
  blocks: z.array(block),
  lastModified: z.number().nullable(),
})
const sheetMeta = z.object({
  revision: version,
  title: z.string(),
  sheetOrder: z.array(z.string().min(1)),
  sheets: z.record(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      rows: z.number().positive(),
      cols: z.number().positive(),
    }),
  ),
})
const cell = z.object({
  value: z.string(),
  version,
  fmt: z.record(z.string(), z.json()).nullable().optional(),
})
/** An explicit envelope with invalid contents is an error, never a blank bootstrap. */
export function validateEditorData(document: WorkspaceDocument): void {
  if (document.format === 'docs') {
    const d = documentData.parse(document.data['document:v2'])
    if (new Set(d.blocks.map((b) => b.id)).size !== d.blocks.length)
      throw new Error('INVALID_DOCUMENT: 重复的文档块标识')
  } else if (document.format === 'sheets') {
    const m = sheetMeta.parse(document.data.meta)
    if (
      !m.sheetOrder.length ||
      new Set(m.sheetOrder).size !== m.sheetOrder.length
    )
      throw new Error('INVALID_DOCUMENT: 工作表顺序无效')
    for (const id of m.sheetOrder) {
      if (m.sheets[id]?.id !== id)
        throw new Error('INVALID_DOCUMENT: 缺少工作表')
      z.record(z.string().regex(/^[A-Z]+[1-9][0-9]*$/), cell).parse(
        document.data['cells:' + id],
      )
    }
  } else {
    const deck = z
      .object({
        slides: z.array(
          z.object({
            id: z.string().min(1),
            blocks: z.array(
              z.object({
                id: z.string().min(1),
                type: z.string(),
                props: z.record(z.string(), z.json()),
              }),
            ),
          }),
        ),
      })
      .parse(document.data.deck)
    if (
      new Set(deck.slides.map((s) => s.id)).size !== deck.slides.length ||
      deck.slides.some(
        (s) => new Set(s.blocks.map((b) => b.id)).size !== s.blocks.length,
      )
    )
      throw new Error('INVALID_DOCUMENT: 重复的幻灯片对象标识')
  }
}
/** Only edits to existing blocks or explicitly versioned cells may rebase onto a newer file. */
export function isLocalEditorEdit(
  document: WorkspaceDocument,
  method: string,
  args: readonly unknown[],
): boolean {
  if (method !== 'applyOperation') return false
  const op = args[0] as Record<string, unknown> | undefined
  if (!op || typeof op !== 'object') return false
  if (document.format === 'docs') {
    const d = documentData.parse(document.data['document:v2'])
    return (
      (!op.deletes || (Array.isArray(op.deletes) && op.deletes.length === 0)) &&
      (op.title === undefined || op.title === d.title) &&
      (op.order === undefined ||
        JSON.stringify(op.order) ===
          JSON.stringify(d.blocks.map((b) => b.id))) &&
      Array.isArray(op.upserts) &&
      op.upserts.length > 0 &&
      op.upserts.every(
        (b) =>
          b &&
          typeof b === 'object' &&
          typeof b.baseVersion === 'number' &&
          d.blocks.some(
            (current) =>
              current.id === b.id && current.version === b.baseVersion,
          ),
      )
    )
  }
  if (document.format === 'sheets')
    return (
      !op.structure &&
      (!op.sheetReplacements ||
        (Array.isArray(op.sheetReplacements) &&
          op.sheetReplacements.length === 0)) &&
      Array.isArray(op.cellOps) &&
      op.cellOps.length > 0 &&
      op.cellOps.every((c) => {
        if (!c || typeof c !== 'object' || typeof c.baseVersion !== 'number')
          return false
        const cells = document.data['cells:' + String(c.sheetId)] as
          | Record<string, { version: number }>
          | undefined
        return (
          cells !== undefined &&
          (cells[String(c.ref)]?.version ?? 0) === c.baseVersion
        )
      })
    )
  return false
}
