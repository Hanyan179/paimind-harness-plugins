import PptxGenJS from 'pptxgenjs'
import {
  definePresentationOutline,
  type PresentationChartSpec,
  type PresentationElement,
  type PresentationOutlineV1,
  type PresentationTableSpec,
} from '@paimind/presentation-contracts'

interface Palette {
  readonly background: string
  readonly surface: string
  readonly ink: string
  readonly muted: string
  readonly accent: string
  readonly accent2: string
  readonly line: string
  readonly coverBackground: string
  readonly coverInk: string
}

type DeckSlide = ReturnType<PptxGenJS['addSlide']>
const SHAPE = Object.freeze({ rect: 'rect', roundRect: 'roundRect', line: 'line' } as const)

const PALETTES: Readonly<Record<string, Readonly<Palette>>> = Object.freeze({
  'strategy-consulting': Object.freeze({ background: 'F7F9FC', surface: 'FFFFFF', ink: '152033', muted: '627083', accent: '2157C7', accent2: 'C93835', line: 'D8E0EA', coverBackground: '101B2B', coverInk: 'FFFFFF' }),
  'paramont-signature': Object.freeze({ background: 'F2F7FB', surface: 'FFFFFF', ink: '102A43', muted: '627D98', accent: '1B6CA8', accent2: '78B9E6', line: 'CFE0EC', coverBackground: '071E33', coverInk: 'F4FAFF' }),
  'playful-storybook': Object.freeze({ background: 'FFF8EA', surface: 'FFFDF7', ink: '3B2B28', muted: '7C665E', accent: 'EC6A3A', accent2: '1F9A8A', line: 'EBCFAF', coverBackground: '4B2F52', coverInk: 'FFF8EA' }),
  'wmt-retail': Object.freeze({ background: 'F3F8FE', surface: 'FFFFFF', ink: '0F3261', muted: '61758D', accent: '0065C3', accent2: 'FFC220', line: 'C9DBEE', coverBackground: '004F9A', coverInk: 'FFFFFF' }),
})

const DEFAULT_PALETTE: Readonly<Palette> = Object.freeze({ background: 'F5F7FA', surface: 'FFFFFF', ink: '172033', muted: '66758A', accent: '356FA8', accent2: '73B6E6', line: 'D5DEE8', coverBackground: '101925', coverInk: 'F5F8FC' })

function paletteFor(outline: Readonly<PresentationOutlineV1>): Readonly<Palette> {
  return PALETTES[outline.design.stylePreset] ?? DEFAULT_PALETTE
}

function addPageNumber(slide: DeckSlide, index: number, total: number, palette: Readonly<Palette>, cover = false): void {
  slide.addText(`${index + 1} / ${total}`, {
    x: 11.82, y: 7.05, w: 0.82, h: 0.18, margin: 0, align: 'right',
    fontFace: 'Aptos', fontSize: 9, color: cover ? palette.coverInk : palette.muted,
  })
}

function sourceNotes(outline: Readonly<PresentationOutlineV1>, factIds: readonly string[]): string {
  const usedSources = new Set(outline.facts.filter(fact => factIds.includes(fact.factId)).flatMap(fact => fact.sourceIds))
  const sources = outline.sources.filter(source => usedSources.size === 0 || usedSources.has(source.sourceId))
  return [
    '[Sources]',
    ...sources.map(source => `${source.name} | ${source.path} | ${source.period} | SHA-256 ${source.sha256}`),
    ...factIds.map(factId => `Fact: ${factId}`),
    '[/Sources]',
  ].join('\n')
}

function addHeader(slide: DeckSlide, item: Readonly<PresentationOutlineV1['slides'][number]>, palette: Readonly<Palette>): void {
  const titleY = item.eyebrow === undefined ? 0.45 : 0.65
  const longTitle = item.title.length > 52
  const titleH = longTitle ? 0.78 : 0.58
  const titleFontSize = longTitle ? 29 : 34
  const narrativeY = titleY + titleH + 0.09
  const ruleY = 2.0
  if (item.eyebrow !== undefined) slide.addText(item.eyebrow.toUpperCase(), {
    x: 0.68, y: 0.36, w: 5.9, h: 0.22, margin: 0, fontFace: 'Aptos', fontSize: 10,
    bold: true, charSpacing: 1.8, color: palette.accent,
  })
  slide.addText(item.title, {
    x: 0.68, y: titleY, w: 11.9, h: titleH, margin: 0,
    fontFace: 'Aptos Display', fontSize: titleFontSize, bold: true, breakLine: false, color: palette.ink,
  })
  slide.addText(item.narrative, {
    x: 0.7, y: narrativeY, w: 11.45, h: Math.max(0.34, ruleY - narrativeY - 0.08), margin: 0,
    fontFace: 'Aptos', fontSize: 15, color: palette.muted, valign: 'top', breakLine: false,
  })
  slide.addShape(SHAPE.line, { x: 0.68, y: ruleY, w: 12.0, h: 0, line: { color: palette.line, width: 1 } })
}

function addKpis(slide: DeckSlide, elements: readonly Readonly<PresentationElement>[], palette: Readonly<Palette>, box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
  if (elements.length === 0) return
  const columns = elements.length === 1 ? 1 : Math.min(2, elements.length)
  const rows = Math.ceil(elements.length / columns)
  const gap = 0.18
  const cardW = (box.w - gap * (columns - 1)) / columns
  const cardH = (box.h - gap * (rows - 1)) / rows
  elements.forEach((element, index) => {
    const x = box.x + (index % columns) * (cardW + gap)
    const y = box.y + Math.floor(index / columns) * (cardH + gap)
    slide.addShape(SHAPE.roundRect, { x, y, w: cardW, h: cardH, fill: { color: palette.surface }, line: { color: palette.line, width: 1 } })
    slide.addText(element.displayValue ?? element.text ?? '—', { x: x + 0.22, y: y + 0.2, w: cardW - 0.44, h: Math.min(0.72, cardH * 0.48), margin: 0, fontFace: 'Aptos Display', fontSize: cardW < 1.9 ? 21 : cardH > 1.25 ? 28 : 23, bold: true, color: palette.accent, valign: 'middle', fit: 'shrink' })
    slide.addText(element.title ?? 'Verified metric', { x: x + 0.22, y: y + cardH - 0.48, w: cardW - 0.44, h: 0.27, margin: 0, fontFace: 'Aptos', fontSize: 11, bold: true, color: palette.muted, valign: 'bottom' })
  })
}

function chartType(deck: PptxGenJS, chart: Readonly<PresentationChartSpec>): typeof deck.ChartType.line | typeof deck.ChartType.bar {
  return chart.kind === 'line' || chart.kind === 'slope' ? deck.ChartType.line : deck.ChartType.bar
}

function addChart(slide: DeckSlide, deck: PptxGenJS, element: Readonly<PresentationElement>, palette: Readonly<Palette>, box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
  const chart = element.chart
  if (chart === undefined) return
  const titleH = element.title === undefined ? 0 : 0.38
  if (element.title !== undefined) slide.addText(element.title, { x: box.x, y: box.y, w: box.w, h: 0.3, margin: 0, fontFace: 'Aptos', fontSize: 20, bold: true, color: palette.ink })
  const type = chartType(deck, chart)
  const seriesKeys = [...new Set(chart.points.map(point => point.seriesKey ?? 'verified'))]
  const series = seriesKeys.map(seriesKey => {
    const points = chart.points.filter(point => (point.seriesKey ?? 'verified') === seriesKey)
    return { name: seriesKey === 'verified' ? (element.title ?? 'Verified data') : seriesKey, labels: points.map(point => point.label), values: points.map(point => point.value) }
  })
  const isLine = type === deck.ChartType.line
  const hasDecimals = chart.points.some(point => !Number.isInteger(point.value))
  slide.addChart(type, series, {
    x: box.x, y: box.y + titleH, w: box.w, h: box.h - titleH,
    showTitle: false, showLegend: isLine && series.length > 1, legendPos: 'b', legendFontFace: 'Aptos', legendFontSize: 10,
    showValue: !isLine, dataLabelFormatCode: hasDecimals ? '0.0' : '0',
    chartColors: [palette.accent, palette.accent2],
    dataLabelColor: palette.ink, dataLabelFontFace: 'Aptos', dataLabelFontSize: 11,
    dataLabelPosition: type === deck.ChartType.bar ? 'outEnd' : 't',
    catAxisLabelColor: palette.muted, catAxisLabelFontFace: 'Aptos', catAxisLabelFontSize: 11,
    valAxisLabelColor: palette.muted, valAxisLabelFontFace: 'Aptos', valAxisLabelFontSize: 10,
    catAxisLineColor: palette.line, valAxisLineColor: palette.line,
    valGridLine: { color: palette.line },
    lineSize: 3, lineDataSymbol: 'circle', lineDataSymbolSize: 7,
    showSerName: false,
    border: { color: palette.line, pt: 1 },
    chartArea: { fill: { color: palette.surface }, border: { color: palette.line, pt: 1 }, roundedCorners: false },
  })
}

function addTable(slide: DeckSlide, table: Readonly<PresentationTableSpec>, title: string | undefined, palette: Readonly<Palette>, box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
  const titleH = title === undefined ? 0 : 0.38
  if (title !== undefined) slide.addText(title, { x: box.x, y: box.y, w: box.w, h: 0.3, margin: 0, fontFace: 'Aptos', fontSize: 20, bold: true, color: palette.ink })
  const rowLabelOwnsFirstColumn = table.columns.length > 0 && table.rows.every(row => row.cells.every(cell => cell.columnKey !== table.columns[0]!.columnKey))
  const rows: (string | { text: string; options?: Record<string, unknown> })[][] = rowLabelOwnsFirstColumn ? [
    table.columns.map(column => ({ text: column.label, options: { bold: true } })),
    ...table.rows.map(row => table.columns.map((column, columnIndex) => columnIndex === 0 ? row.label : row.cells.find(cell => cell.columnKey === column.columnKey)?.displayValue ?? '—')),
  ] : [
    [{ text: '', options: { bold: true } }, ...table.columns.map(column => ({ text: column.label, options: { bold: true } }))],
    ...table.rows.map(row => [row.label, ...table.columns.map(column => row.cells.find(cell => cell.columnKey === column.columnKey)?.displayValue ?? '—')]),
  ]
  const fontSize = rows.length > 10 ? 10 : rows.length > 7 ? 11 : 13
  slide.addTable(rows as never, {
    x: box.x, y: box.y + titleH, w: box.w, h: box.h - titleH,
    margin: 0.08, fontFace: 'Aptos', fontSize, color: palette.ink,
    border: { type: 'solid', color: palette.line, pt: 0.8 },
    fill: { color: palette.surface },
    rowH: Math.max(0.28, Math.min(0.52, (box.h - titleH) / rows.length)),
  })
  slide.addShape(SHAPE.rect, { x: box.x, y: box.y + titleH, w: box.w, h: Math.max(0.32, Math.min(0.5, (box.h - titleH) / rows.length)), fill: { color: palette.accent }, line: { color: palette.accent, transparency: 100 } })
  slide.addTable([rows[0]!] as never, { x: box.x, y: box.y + titleH, w: box.w, h: Math.max(0.32, Math.min(0.5, (box.h - titleH) / rows.length)), margin: 0.08, fontFace: 'Aptos', fontSize, bold: true, color: 'FFFFFF', border: { type: 'solid', color: palette.accent, pt: 0.8 }, fill: { color: palette.accent } })
}

function addCopy(slide: DeckSlide, elements: readonly Readonly<PresentationElement>[], palette: Readonly<Palette>, box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
  if (elements.length === 0) return
  const gap = 0.18
  const itemH = (box.h - gap * (elements.length - 1)) / elements.length
  elements.forEach((element, index) => {
    const y = box.y + index * (itemH + gap)
    slide.addShape(SHAPE.line, { x: box.x, y: y + 0.03, w: 0, h: Math.min(0.74, itemH - 0.06), line: { color: index === elements.length - 1 ? palette.accent2 : palette.accent, width: 3 } })
    slide.addText(element.title ?? '', { x: box.x + 0.18, y, w: box.w - 0.18, h: element.title === undefined ? 0 : 0.28, margin: 0, fontFace: 'Aptos', fontSize: 18, bold: true, color: palette.ink })
    const content = element.text ?? element.displayValue ?? ''
    if (content !== '') slide.addText(content, { x: box.x + 0.18, y: y + (element.title === undefined ? 0 : 0.4), w: box.w - 0.18, h: itemH - (element.title === undefined ? 0 : 0.4), margin: 0, fontFace: 'Aptos', fontSize: 16, color: palette.muted, breakLine: false, valign: 'top' })
  })
}

function addProcess(slide: DeckSlide, elements: readonly Readonly<PresentationElement>[], palette: Readonly<Palette>, box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
  const gap = 0.28
  const cardW = (box.w - gap * (elements.length - 1)) / elements.length
  const cardH = Math.min(2.3, box.h)
  const y = box.y + Math.max(0, (box.h - cardH) / 2)
  elements.forEach((element, index) => {
    const x = box.x + index * (cardW + gap)
    slide.addShape(SHAPE.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.08, fill: { color: palette.surface }, line: { color: index === elements.length - 1 ? palette.accent2 : palette.line, width: index === elements.length - 1 ? 2 : 1 } })
    slide.addText(`${String(index + 1).padStart(2, '0')}`, { x: x + 0.22, y: y + 0.2, w: 0.52, h: 0.25, margin: 0, fontFace: 'Aptos', fontSize: 10, bold: true, color: palette.accent, charSpacing: 1.3 })
    slide.addText(element.title ?? 'Verified step', { x: x + 0.22, y: y + 0.72, w: cardW - 0.44, h: 0.45, margin: 0, fontFace: 'Aptos Display', fontSize: 19, bold: true, color: palette.ink })
    slide.addText(element.text ?? element.displayValue ?? '—', { x: x + 0.22, y: y + 1.34, w: cardW - 0.44, h: 0.48, margin: 0, fontFace: 'Aptos Display', fontSize: 24, bold: true, color: index === elements.length - 1 ? palette.accent2 : palette.accent })
    if (index < elements.length - 1) slide.addText('→', { x: x + cardW, y: y + 0.92, w: gap, h: 0.36, margin: 0, align: 'center', fontFace: 'Aptos', fontSize: 18, bold: true, color: palette.muted })
  })
}

function addCover(slide: DeckSlide, item: Readonly<PresentationOutlineV1['slides'][number]>, outline: Readonly<PresentationOutlineV1>, palette: Readonly<Palette>, index: number): void {
  const titleFontSize = item.title.length > 74 ? 37 : item.title.length > 50 ? 42 : 48
  slide.background = { color: palette.coverBackground }
  slide.addShape(SHAPE.rect, { x: 0.68, y: 0.72, w: 0.08, h: 5.92, fill: { color: palette.accent2 }, line: { color: palette.accent2, transparency: 100 } })
  slide.addText((item.eyebrow ?? 'PAIMIND PROPOSAL').toUpperCase(), { x: 1.05, y: 0.82, w: 5.8, h: 0.24, margin: 0, fontFace: 'Aptos', fontSize: 11, bold: true, charSpacing: 2, color: palette.accent2 })
  slide.addText(item.title, { x: 1.03, y: 1.3, w: 11.1, h: 1.9, margin: 0, fontFace: 'Aptos Display', fontSize: titleFontSize, bold: true, color: palette.coverInk, valign: 'middle', breakLine: false })
  slide.addText(item.narrative, { x: 1.06, y: 3.52, w: 10.2, h: 0.68, margin: 0, fontFace: 'Aptos', fontSize: 18, color: palette.coverInk, transparency: 16, breakLine: false })
  const kpis = item.elements.filter(element => element.type === 'kpi').slice(0, 4)
  if (kpis.length > 0) {
    const cardW = Math.min(2.75, 10.9 / kpis.length)
    kpis.forEach((element, kpiIndex) => {
      const x = 1.04 + kpiIndex * (cardW + 0.18)
      slide.addText(element.displayValue ?? '—', { x, y: 4.72, w: cardW, h: 0.55, margin: 0, fontFace: 'Aptos Display', fontSize: 28, bold: true, color: palette.accent2 })
      slide.addText(element.title ?? 'Verified metric', { x, y: 5.38, w: cardW, h: 0.34, margin: 0, fontFace: 'Aptos', fontSize: 11, bold: true, color: palette.coverInk, transparency: 28 })
    })
  }
  slide.addText(outline.subtitle ?? outline.title, { x: 1.05, y: 6.47, w: 9.8, h: 0.24, margin: 0, fontFace: 'Aptos', fontSize: 10, color: palette.coverInk, transparency: 35 })
  addPageNumber(slide, index, outline.slides.length, palette, true)
}

function addContentSlide(slide: DeckSlide, deck: PptxGenJS, item: Readonly<PresentationOutlineV1['slides'][number]>, outline: Readonly<PresentationOutlineV1>, palette: Readonly<Palette>, index: number): void {
  slide.background = { color: palette.background }
  addHeader(slide, item, palette)
  const kpis = item.elements.filter(element => element.type === 'kpi')
  const charts = item.elements.filter(element => element.type === 'chart' && element.chart !== undefined)
  const tables = item.elements.filter(element => element.type === 'table' && element.table !== undefined)
  const copy = item.elements.filter(element => ['title', 'text', 'list'].includes(element.type))
  const visuals = [...charts, ...tables]
  if (visuals.length === 0) {
    if (kpis.length > 0) addKpis(slide, kpis, palette, { x: 0.7, y: 2.15, w: 12.0, h: copy.length > 0 ? 2.25 : 4.45 })
    if (copy.length >= 3 && copy.length <= 6 && kpis.length === 0) addProcess(slide, copy, palette, { x: 0.78, y: 2.35, w: 11.75, h: 3.95 })
    else if (copy.length > 0) addCopy(slide, copy, palette, { x: 0.78, y: kpis.length > 0 ? 4.72 : 2.25, w: 11.75, h: kpis.length > 0 ? 1.75 : 4.15 })
  } else if (visuals.length === 1) {
    const visual = visuals[0]!
    const hasSide = kpis.length > 0 || copy.length > 0
    const visualBox = hasSide ? { x: 4.55, y: 2.18, w: 8.05, h: 4.58 } : { x: 0.72, y: 2.18, w: 11.88, h: 4.58 }
    if (visual.type === 'chart') addChart(slide, deck, visual, palette, visualBox)
    else addTable(slide, visual.table as PresentationTableSpec, visual.title, palette, visualBox)
    if (hasSide) {
      if (kpis.length > 0) addKpis(slide, kpis, palette, { x: 0.72, y: 2.18, w: 3.55, h: copy.length > 0 ? 2.28 : 4.58 })
      if (copy.length > 0) addCopy(slide, copy, palette, { x: 0.78, y: kpis.length > 0 ? 4.7 : 2.28, w: 3.38, h: kpis.length > 0 ? 1.82 : 4.32 })
    }
  } else {
    const boxes = [{ x: 0.72, y: 2.18, w: 5.83, h: 4.58 }, { x: 6.78, y: 2.18, w: 5.82, h: 4.58 }]
    visuals.slice(0, 2).forEach((visual, visualIndex) => {
      const box = boxes[visualIndex]!
      if (visual.type === 'chart') addChart(slide, deck, visual, palette, box)
      else addTable(slide, visual.table as PresentationTableSpec, visual.title, palette, box)
    })
  }
  addPageNumber(slide, index, outline.slides.length, palette)
}

export async function renderPresentationOutlinePptx(outlineValue: unknown, fileName: string): Promise<Readonly<PresentationOutlineV1>> {
  const outline = definePresentationOutline(outlineValue)
  const palette = paletteFor(outline)
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_WIDE'
  deck.author = 'PAIMind'
  deck.company = 'PAIMind'
  deck.subject = outline.subtitle ?? outline.title
  deck.title = outline.title
  deck.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' }
  outline.slides.forEach((item, index) => {
    const slide = deck.addSlide()
    const factIds = [...new Set(item.elements.flatMap(element => element.factIds))]
    slide.addNotes(sourceNotes(outline, factIds))
    if (item.layout === 'cover' || item.layout === 'section') addCover(slide, item, outline, palette, index)
    else addContentSlide(slide, deck, item, outline, palette, index)
  })
  await deck.writeFile({ fileName })
  return outline
}
