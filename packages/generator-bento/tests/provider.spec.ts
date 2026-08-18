import { describe, expect, it, vi } from 'vitest'
import { apply, bentoProvider, bentoSlideFit, renderBentoDocument, renderTraceableBentoDocument, traceableBentoProvider } from '../src/index.js'
import { BENTO_STYLE_PRESETS, BENTO_TEMPLATE_REGISTRY, HTML_PRESENTATION_SCHEMA } from '../src/presentation-spec.js'

const sourceHash = 'a'.repeat(64)
const layouts = ['cover', 'section', 'kpi', 'comparison', 'insight', 'recommendation', 'table', 'horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line'] as const
const traceableOutline = {
  schema: 'paimind.presentation-outline/v1', title: 'Traceable Deck',
  design: { schema: 'paimind.presentation-design/v1', templateId: 'generic-dark', stylePreset: 'warm-editorial', aspectRatio: '16:9', canvas: { width: 1280, height: 720 }, density: 'balanced' },
  sources: [{ sourceId: 'source', name: 'snapshot.json', path: 'inputs/snapshot.json', sha256: sourceHash, format: 'json', role: 'historical actuals', period: 'FY2025', summary: 'Redacted frozen snapshot' }],
  facts: layouts.map((layout, index) => ({ factId: `fact-${index + 1}`, sourceIds: ['source'], rawValue: index + 1, displayValue: `${index + 1}`, valueType: 'source_value', fieldPath: `$.values[${index}]`, method: 'Read frozen value', definition: `${layout} value`, period: 'FY2025', filters: [], factValuesChanged: false })),
  slides: layouts.map((layout, index) => {
    const factId = `fact-${index + 1}`; const objectId = `object-${index + 1}`
    if (layout === 'table') return { slideId: `slide-${index + 1}`, layout, title: 'Table', narrative: 'Auditable table.', elements: [{ objectId, type: 'table', factIds: [factId], bindings: [{ factId, selector: { kind: 'table-cell', rowKey: 'row-1', columnKey: 'column-1' } }], table: { columns: [{ columnKey: 'column-1', label: 'Value' }], rows: [{ rowKey: 'row-1', label: 'Row', cells: [{ rowKey: 'row-1', columnKey: 'column-1', displayValue: `${index + 1}`, factId }] }] } }] }
    if (['horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line'].includes(layout)) return { slideId: `slide-${index + 1}`, layout, title: layout, narrative: 'Auditable chart.', elements: [{ objectId, type: 'chart', title: layout, factIds: [factId], bindings: [{ factId, selector: { kind: 'chart-point', seriesKey: 'series-1', categoryKey: `category-${index + 1}` } }], chart: { kind: layout, points: [{ seriesKey: 'series-1', categoryKey: `category-${index + 1}`, label: layout, value: index + 1, displayValue: `${index + 1}`, factId }] } }] }
    return { slideId: `slide-${index + 1}`, layout, title: layout, narrative: 'Evidence-backed page.', elements: [{ objectId, type: layout === 'kpi' ? 'kpi' : 'text', title: layout, text: 'Evidence', displayValue: `${index + 1}`, factIds: [factId], bindings: [{ factId, selector: { kind: 'object' } }] }] }
  }),
}

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
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) }, effect(install) { install() },
    })
    expect(definition.presentCall({ file_path: 'deck.html', title: 'Deck', slides: [{ title: 'One', body: 'Body' }] })).toMatchObject({ kind: 'edit', locations: [{ path: 'deck.html' }] })
  })

  it('renders every required layout, chart selector and table selector without external assets', async () => {
    const html = renderTraceableBentoDocument(traceableOutline)
    expect(Object.keys(BENTO_TEMPLATE_REGISTRY)).toEqual(['generic-dark', 'wmt-kids-mod'])
    expect(Object.keys(BENTO_STYLE_PRESETS)).toHaveLength(6)
    expect(html).toContain(`<meta name="paimind:presentation-schema" content="${HTML_PRESENTATION_SCHEMA}">`)
    expect(html).toContain('data-style-preset="warm-editorial"')
    expect(html).toContain('aspect-ratio:16/9')
    expect(html).toContain('data-edit-field="title"')
    expect(html).toContain('data-edit-lock="fact"')
    expect(html).toContain('事实值与派生指标已锁定')
    for (const layout of layouts) expect(html).toContain(`layout-${layout}`)
    for (const chart of ['horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line']) expect(html).toContain(`chart-${chart}`)
    expect(html).toContain('data-selector-kind="chart-point"')
    expect(html).toContain('data-selector-kind="table-cell"')
    expect(html).toContain('paimind:bento-select')
    expect(html).toContain('data-fit-profile=')
    expect(html).toContain('data-fit-scale="1"')
    expect(html).toContain('MutationObserver')
    expect(html).toContain('Math.max(.42')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+href=/)

    const writes = new Map<string, string>()
    const result = await traceableBentoProvider.generate({ file_path: 'result.bento.html', outline: traceableOutline, outline_artifact_id: 'artifact:outline' }, {
      signal: new AbortController().signal,
      writeText: vi.fn(async (path: string, content: string) => { writes.set(path, content); return path }),
      runWorkspaceCommand: vi.fn(async () => ({ stdout: `${sourceHash}  inputs/snapshot.json\n` })),
    })
    expect([...writes.keys()]).toEqual(['result.trace.json', 'result.validation.json', 'result.bento.html'])
    expect(JSON.parse(writes.get('result.validation.json') ?? '{}')).toMatchObject({ valid: true, resolutionRate: 1, factValuesChanged: false, sourceHashesVerified: true, outlineArtifactId: 'artifact:outline' })
    expect(result.traceDocumentRef).toMatchObject({ path: 'result.trace.json', schema: 'paimind.presentation-trace/v3' })
  })

  it('assigns a tighter fit profile to copy-heavy slides before runtime measurement', () => {
    const base = traceableOutline.slides[0]
    const crowded = {
      ...base,
      title: '一份信息密度很高但仍然必须保持 16:9 可读性的管理层演示页面',
      narrative: '这段说明包含较多上下文，因此确定性渲染器必须先选择紧凑版式，再在浏览器中测量真实内容高度并按需缩放元素区域，不能让页头文字与第一排卡片发生重叠。'.repeat(2),
      elements: Array.from({ length: 8 }, (_, index) => ({
        ...base.elements[0], objectId: `crowded-object-${index + 1}`,
      })),
    }
    expect(bentoSlideFit(crowded as never)).toBe('tight')
    const html = renderTraceableBentoDocument({ ...traceableOutline, slides: [crowded] })
    expect(html).toContain('fit-tight active')
  })

  it('accounts for chart-point density before browser measurement', () => {
    const base = traceableOutline.slides.find(slide => slide.layout === 'horizontal-bar')!
    const chart = base.elements[0]!.chart!
    const denseChart = {
      ...base,
      elements: [{
        ...base.elements[0],
        chart: {
          ...chart,
          points: Array.from({ length: 7 }, (_, index) => ({
            ...chart.points[0]!, categoryKey: `category-${index + 1}`, label: `验证声明 ${index + 1}`,
          })),
        },
      }],
    }
    expect(bentoSlideFit(denseChart as never)).toBe('compact')
  })

  it('renders a 41-page traceable deck without collapsing its story', () => {
    const slides = Array.from({ length: 41 }, (_, index) => ({ ...traceableOutline.slides[0], slideId: `long-slide-${index + 1}`, elements: traceableOutline.slides[0].elements.map(element => ({ ...element, objectId: `long-object-${index + 1}` })) }))
    const html = renderTraceableBentoDocument({ ...traceableOutline, slides })
    expect(html).toContain('41 / 41')
    expect(html.match(/data-slide-id=/g)).toHaveLength(41)
  })
})
