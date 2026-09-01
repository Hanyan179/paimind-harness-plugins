import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import {
  canonicalJson,
  definePresentationOutline,
  traceFromPresentationOutline,
  validatePresentationTraceability,
} from '@paimind/presentation-contracts'
import { renderPresentationOutlinePptx } from './outline-pptx.js'

type JsonRecord = Record<string, unknown>

const require = createRequire(import.meta.url)
const PDFDocument: typeof import('pdfkit') = require('pdfkit')
const NOTO_SANS_HANS_ROOT = resolve(dirname(require.resolve('@embedpdf/fonts-sc')), '..')

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function textList(value: unknown, label: string, minimum = 0): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`${label} must contain at least ${minimum} item(s)`)
  return value.map((entry, index) => text(entry, `${label}[${index}]`))
}

function safeTarget(root: string, filePath: string, extension: string): string {
  if (isAbsolute(filePath) || extname(filePath).toLowerCase() !== extension) {
    throw new Error(`file_path must be a Workspace-relative ${extension} path`)
  }
  const target = resolve(root, filePath)
  const edge = relative(root, target)
  if (edge === '' || edge.startsWith('..') || isAbsolute(edge)) throw new Error('file_path escapes the Workspace')
  return target
}

function safeSource(root: string, filePath: string, extension: string): string {
  return safeTarget(root, filePath, extension)
}

function sidecarPath(pptxPath: string, suffix: '.trace.json' | '.validation.json'): string {
  return `${pptxPath.slice(0, -'.pptx'.length)}${suffix}`
}

export interface OfficeArtifactResult {
  readonly output: string
  readonly title?: string
  readonly tracePath?: string
  readonly traceSchema?: string
  readonly traceSha256?: string
  readonly traceBytes?: number
}

async function publish(target: string, writer: (temporary: string) => Promise<void>): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const extension = extname(target)
  const temporary = `${target.slice(0, -extension.length)}.${randomUUID()}.tmp${extension}`
  await writer(temporary)
  await rename(temporary, target)
}

async function generatePptx(spec: JsonRecord, root: string): Promise<string> {
  const target = safeTarget(root, text(spec.file_path, 'file_path'), '.pptx')
  const title = text(spec.title, 'title')
  if (!Array.isArray(spec.slides) || spec.slides.length < 1 || spec.slides.length > 40) throw new Error('slides must contain 1-40 slides')
  const slides = spec.slides.map((value, index) => {
    const slide = record(value, `slides[${index}]`)
    return { title: text(slide.title, `slides[${index}].title`), bullets: textList(slide.bullets ?? [], `slides[${index}].bullets`) }
  })
  await publish(target, async temporary => {
    const deck = new PptxGenJS()
    deck.layout = 'LAYOUT_WIDE'
    deck.author = 'PAIMind'
    deck.subject = title
    deck.title = title
    deck.company = 'PAIMind'
    deck.theme = {
      headFontFace: 'Aptos Display', bodyFontFace: 'Aptos',
    }
    for (const [index, item] of slides.entries()) {
      const slide = deck.addSlide()
      slide.background = { color: index === 0 ? '102A56' : 'F6F8FC' }
      slide.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 0.16, h: 7.5, fill: { color: index === 0 ? '5B8DEF' : '2F66E8' }, line: { color: index === 0 ? '5B8DEF' : '2F66E8' } })
      slide.addText(item.title, { x: 0.65, y: 0.62, w: 11.9, h: 0.7, fontFace: 'Aptos Display', fontSize: index === 0 ? 30 : 26, bold: true, color: index === 0 ? 'FFFFFF' : '14213D', margin: 0 })
      if (item.bullets.length > 0) {
        slide.addText(item.bullets.map(value => ({ text: value, options: { bullet: { indent: 18 }, breakLine: true } })), {
          x: 0.9, y: 1.75, w: 11.25, h: 4.85, fontFace: 'Aptos', fontSize: 19,
          color: index === 0 ? 'E8F0FF' : '27364F', breakLine: false, margin: 0.08,
          paraSpaceAfter: 15, valign: 'top',
        })
      }
      slide.addText(`${index + 1} / ${slides.length}`, { x: 11.6, y: 7.02, w: 1.0, h: 0.22, fontSize: 9, color: index === 0 ? 'AFC6F5' : '8190A8', align: 'right', margin: 0 })
    }
    await deck.writeFile({ fileName: temporary })
  })
  return target
}

async function generateOutlinePptx(spec: JsonRecord, root: string): Promise<OfficeArtifactResult> {
  const outputPath = text(spec.file_path, 'file_path')
  const outlinePath = text(spec.outline_path, 'outline_path')
  const target = safeTarget(root, outputPath, '.pptx')
  const outlineTarget = safeSource(root, outlinePath, '.json')
  if (!outlinePath.toLowerCase().endsWith('.outline.json')) throw new Error('outline_path must be a Workspace-relative .outline.json path')
  const outline = definePresentationOutline(JSON.parse(await readFile(outlineTarget, 'utf8')))
  for (const source of outline.sources) {
    const sourceTarget = safeSource(root, source.path, extname(source.path).toLowerCase())
    const actual = createHash('sha256').update(await readFile(sourceTarget)).digest('hex')
    if (actual !== source.sha256) throw new Error(`source hash mismatch for ${source.sourceId}`)
  }
  const trace = traceFromPresentationOutline(outline)
  const validation = validatePresentationTraceability(outline, true)
  if (!validation.valid || validation.resolutionRate !== 1 || validation.factValuesChanged) throw new Error('presentation trace validation failed')
  const traceJson = canonicalJson(trace)
  const validationJson = canonicalJson({
    ...validation,
    ...(spec.outline_artifact_id === undefined ? {} : { outlineArtifactId: text(spec.outline_artifact_id, 'outline_artifact_id') }),
    ...(outline.factSetArtifactId === undefined ? {} : { factSetArtifactId: outline.factSetArtifactId, factSetFactsSha256: outline.factSetFactsSha256 }),
  })
  const tracePath = sidecarPath(outputPath, '.trace.json')
  const validationPath = sidecarPath(outputPath, '.validation.json')
  await publish(target, async temporary => { await renderPresentationOutlinePptx(outline, temporary) })
  await publish(safeTarget(root, tracePath, '.json'), async temporary => { await writeFile(temporary, traceJson) })
  await publish(safeTarget(root, validationPath, '.json'), async temporary => { await writeFile(temporary, validationJson) })
  return {
    output: target,
    title: outline.title,
    tracePath,
    traceSchema: trace.schemaVersion,
    traceSha256: createHash('sha256').update(traceJson).digest('hex'),
    traceBytes: Buffer.byteLength(traceJson),
  }
}

async function generatePdf(spec: JsonRecord, root: string): Promise<string> {
  const target = safeTarget(root, text(spec.file_path, 'file_path'), '.pdf')
  const title = text(spec.title, 'title')
  if (!Array.isArray(spec.sections) || spec.sections.length < 1 || spec.sections.length > 30) throw new Error('sections must contain 1-30 sections')
  const sections = spec.sections.map((value, index) => {
    const section = record(value, `sections[${index}]`)
    return { heading: text(section.heading, `sections[${index}].heading`), body: text(section.body, `sections[${index}].body`) }
  })
  await publish(target, async temporary => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 112, right: 44, bottom: 44, left: 44 }, bufferPages: true,
      info: { Title: title, Author: 'PAIMind', Creator: 'PAIMind Generator', Producer: 'PAIMind Generator' },
    })
    const output = createWriteStream(temporary)
    doc.pipe(output)
    doc.registerFont('PAIMindCJK', resolve(NOTO_SANS_HANS_ROOT, 'fonts', 'NotoSansHans-Regular.otf'))
    doc.font('PAIMindCJK')
    for (const section of sections) {
      if (doc.y > doc.page.height - 140) doc.addPage()
      doc.fillColor('#1A4DA8').fontSize(15).text(section.heading, { width: doc.page.width - 88, lineGap: 2 })
      doc.moveDown(0.45)
      doc.fillColor('#263045').fontSize(10.5).text(section.body.replace(/\s+/g, ' ').trim(), {
        width: doc.page.width - 96, lineGap: 3, paragraphGap: 6,
      })
      doc.moveDown(0.9)
    }
    const pages = doc.bufferedPageRange()
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(pages.start + index)
      doc.save()
      doc.rect(0, 0, doc.page.width, 36).fill('#143D85')
      doc.fillColor('#102245').fontSize(22).text(title, 44, 58, { width: doc.page.width - 88, lineBreak: false })
      doc.fillColor('#667085').fontSize(9).text(`${index + 1} / ${pages.count}`, 44, doc.page.height - 70, {
        width: doc.page.width - 88, align: 'right', lineBreak: false,
      })
      doc.restore()
    }
    const finalizedPages = doc.bufferedPageRange()
    if (finalizedPages.count !== pages.count) throw new Error(`PDF finalization unexpectedly added pages (${pages.count} -> ${finalizedPages.count})`)
    doc.end()
    await new Promise<void>((resolvePromise, reject) => {
      output.once('finish', resolvePromise)
      output.once('error', reject)
      doc.once('error', reject)
    })
  })
  return target
}

async function generateXlsx(spec: JsonRecord, root: string): Promise<string> {
  const target = safeTarget(root, text(spec.file_path, 'file_path'), '.xlsx')
  const title = text(spec.title, 'title')
  const sheetName = text(spec.sheet_name ?? 'Report', 'sheet_name').slice(0, 31)
  const columns = textList(spec.columns, 'columns', 1)
  if (!Array.isArray(spec.rows) || spec.rows.length < 1 || spec.rows.length > 10_000) throw new Error('rows must contain 1-10000 rows')
  const rows = spec.rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`rows[${index}] must contain ${columns.length} cells`)
    return row.map((cell, column) => {
      if (typeof cell !== 'string' && typeof cell !== 'number' && typeof cell !== 'boolean' && cell !== null) throw new Error(`rows[${index}][${column}] is not a scalar`)
      return cell
    })
  })
  const formulas = (spec.formulas ?? []) as unknown
  if (!Array.isArray(formulas)) throw new Error('formulas must be an array')
  const normalizedFormulas = formulas.map((value, index) => {
    const formula = record(value, `formulas[${index}]`)
    if (!Number.isSafeInteger(formula.row) || (formula.row as number) < 2 || (formula.row as number) > rows.length + 1) throw new Error(`formulas[${index}].row is invalid`)
    if (!Number.isSafeInteger(formula.column) || (formula.column as number) < 1 || (formula.column as number) > columns.length) throw new Error(`formulas[${index}].column is invalid`)
    if (typeof formula.result !== 'string' && typeof formula.result !== 'number' && typeof formula.result !== 'boolean') {
      throw new Error(`formulas[${index}].result must be a string, number, or boolean`)
    }
    return {
      row: formula.row as number,
      column: formula.column as number,
      formula: text(formula.formula, `formulas[${index}].formula`).replace(/^=/, ''),
      result: formula.result,
    }
  })
  if (normalizedFormulas.length < 1) throw new Error('at least one real formula is required')
  await publish(target, async temporary => {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'PAIMind'; workbook.title = title; workbook.created = new Date()
    workbook.calcProperties.fullCalcOnLoad = true
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = columns.map((header, index) => ({ header, key: `column-${index + 1}`, width: Math.max(12, Math.min(32, header.length + 6)) }))
    for (const row of rows) sheet.addRow(row)
    for (const formula of normalizedFormulas) {
      sheet.getCell(formula.row, formula.column).value = { formula: formula.formula, result: formula.result }
    }
    const header = sheet.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2459C4' } }
    header.alignment = { vertical: 'middle' }
    header.height = 22
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } }
    await workbook.xlsx.writeFile(temporary)
  })
  return target
}

export async function generateOfficeArtifact(specValue: unknown, workspaceRoot = process.cwd()): Promise<string> {
  return (await generateOfficeArtifactResult(specValue, workspaceRoot)).output
}

export async function generateOfficeArtifactResult(specValue: unknown, workspaceRoot = process.cwd()): Promise<OfficeArtifactResult> {
  const spec = record(specValue, 'spec')
  const kind = text(spec.kind, 'kind')
  if (kind === 'outline-pptx') return await generateOutlinePptx(spec, workspaceRoot)
  if (kind === 'pptx') return { output: await generatePptx(spec, workspaceRoot) }
  if (kind === 'pdf') return { output: await generatePdf(spec, workspaceRoot) }
  if (kind === 'xlsx') return { output: await generateXlsx(spec, workspaceRoot) }
  throw new Error(`unsupported office artifact kind ${JSON.stringify(kind)}`)
}

async function main(): Promise<void> {
  const specPath = process.argv[2]
  if (specPath === undefined) throw new Error('usage: node cli.js <workspace-relative-spec.json>')
  const spec = JSON.parse(await readFile(resolve(process.cwd(), specPath), 'utf8')) as unknown
  const output = await generateOfficeArtifactResult(spec)
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
