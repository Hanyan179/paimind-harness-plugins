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
    expect(html).toContain("paimind:bento-manifest")
    expect(html).toContain("paimind:bento-navigate")
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
    expect(Object.keys(BENTO_TEMPLATE_REGISTRY)).toEqual(['generic-dark', 'wmt-kids-mod', 'strategy-grid', 'paramont-mountain', 'storybook-cutpaper'])
    expect(Object.keys(BENTO_STYLE_PRESETS)).toHaveLength(9)
    expect(html).toContain(`<meta name="paimind:presentation-schema" content="${HTML_PRESENTATION_SCHEMA}">`)
    expect(html).toContain('data-style-preset="warm-editorial"')
    expect(html).toContain('aspect-ratio:16/9')
    expect(html).toContain('data-edit-field="title"')
    expect(html).toContain('data-edit-lock="fact"')
    expect(html).toContain('数据与计算结果已锁定')
    for (const layout of layouts) expect(html).toContain(`layout-${layout}`)
    for (const chart of ['horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line']) expect(html).toContain(`chart-${chart}`)
    expect(html).toContain('data-selector-kind="chart-point"')
    expect(html).toContain('data-selector-kind="table-cell"')
    expect(html).toContain('paimind:bento-select')
    expect(html).toContain('paimind:bento-navigate')
    expect(html).toContain('正在查找来源…')
    expect(html).toContain('trace-text-shimmer')
    expect(html).toContain('data-paimind-mode-contract="exclusive-selection-v1"')
    expect(html).toContain('body[data-mode="trace"][data-trace-status="active"]')
    expect(html).toContain("if(mode!=='trace')")
    expect(html).toContain("if(data.mode==='preview')")
    expect(html).toContain('← / → · 切换幻灯片')
    expect(html).toContain("mode==='preview'")
    expect(html).toContain('prefers-reduced-motion:reduce')
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

  it('renders a trusted complete Outline Artifact without copying large JSON through command stdout', async () => {
    const runWorkspaceCommand = vi.fn(async () => ({ stdout: JSON.stringify({
      status: 'success', title: 'Walmart Kids Crafts Growth Proposal', tracePath: 'result.trace.json',
      validationPath: 'result.validation.json', traceSchema: 'paimind.presentation-trace/v3',
      traceSha256: 'b'.repeat(64), traceBytes: 1234,
    }) }))
    const result = await traceableBentoProvider.generate({
      file_path: 'result.bento.html', outline_artifact_id: 'artifact:outline', __outline_path: 'result.outline.json',
    }, { signal: new AbortController().signal, writeText: vi.fn(), runWorkspaceCommand })
    expect(runWorkspaceCommand).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringContaining('render-exact-outline.mjs') }))
    expect(runWorkspaceCommand.mock.calls[0]?.[0].command).toContain(process.execPath)
    expect(runWorkspaceCommand.mock.calls[0]?.[0].command).not.toContain('--fact-set')
    expect(result.traceDocumentRef).toEqual({ path: 'result.trace.json', schema: 'paimind.presentation-trace/v3', sha256: 'b'.repeat(64), bytes: 1234 })
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

  it('resolves exact current-Session Fact Set and Outline Artifacts before generation', async () => {
    const definitions: any[] = []
    const execute = vi.fn(async () => ({ artifact: {} }))
    const boundOutline = { ...traceableOutline, factSetArtifactId: 'artifact:fact-set', factSetFactsSha256: 'b'.repeat(64) }
    apply({
      paimindArtifactGenerators: { register: vi.fn(() => () => {}), execute, list: vi.fn(() => []) },
      tools: { register: vi.fn(value => { definitions.push(value); return () => {} }), execute: vi.fn() },
      systemPrompt: { section: vi.fn(() => () => {}), context: vi.fn(() => () => {}) },
      sessionProjections: { register: vi.fn(), snapshot: () => ({ asOfSeq: 2, values: { 'paimind.artifacts': { schema: 'paimind.artifacts/v1', traces: [], artifacts: [
        { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:fact-set', sessionId: 'session-1', workspaceId: 'workspace-1', path: '/workspace/results/proposal.fact-set.json', title: 'Fact Set', kind: 'json', previewKind: 'data-document', revision: 1, producerId: 'paimind.fact-layer', taskId: 'task-1', state: 'available', producedAt: 1 },
        { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:outline', sessionId: 'session-1', workspaceId: 'workspace-1', path: '/workspace/results/proposal.outline.json', title: 'Outline', kind: 'json', previewKind: 'data-document', revision: 1, producerId: 'paimind.generator.presentation-outline', taskId: 'task-2', state: 'available', producedAt: 2 },
        { schema: 'paimind.artifact-produced/v1', artifactId: 'artifact:walmart-outline', sessionId: 'session-1', workspaceId: 'workspace-1', path: '/workspace/results/walmart.outline.json', title: 'Walmart Outline', kind: 'json', previewKind: 'data-document', revision: 1, producerId: 'paimind.walmart.buyer-proposal-outline', taskId: 'task-3', state: 'available', producedAt: 3 },
      ] } } }) },
      effect(install) { install() },
    } as any)
    const exec = { agent: { id: 'session-1', session: { id: 'session-1', header: { cwd: '/workspace' } } }, signal: new AbortController().signal }
    const blueprint = { schema: 'paimind.presentation-outline-blueprint/v1', title: 'Blueprint', design: boundOutline.design, slides: [{ slideId: 'cover', layout: 'cover', title: 'Cover', narrative: 'Verified narrative.', elements: [{ objectId: 'kpi', type: 'kpi', factId: 'fact-1' }] }] }
    await definitions.find(definition => definition.name === 'create_fact_bound_presentation_outline').execute({ file_path: 'results/proposal.outline.json', fact_set_artifact_id: 'artifact:fact-set', blueprint }, exec)
    expect(execute).toHaveBeenLastCalledWith('paimind.generator.presentation-outline', expect.objectContaining({ __fact_set_path: 'results/proposal.fact-set.json', blueprint }), exec)
    await definitions.find(definition => definition.name === 'create_presentation_outline_artifact').execute({ file_path: 'results/proposal.outline.json', fact_set_artifact_id: 'artifact:fact-set', outline: boundOutline }, exec)
    expect(execute).toHaveBeenLastCalledWith('paimind.generator.presentation-outline', expect.objectContaining({ __fact_set_path: 'results/proposal.fact-set.json' }), exec)
    await definitions.find(definition => definition.name === 'generate_traceable_bento_from_outline').execute({ file_path: 'results/proposal.bento.html', outline_artifact_id: 'artifact:outline', fact_set_artifact_id: 'artifact:fact-set' }, exec)
    expect(execute).toHaveBeenLastCalledWith('paimind.generator.traceable-bento-deck', expect.objectContaining({ __outline_path: 'results/proposal.outline.json', __fact_set_path: 'results/proposal.fact-set.json', __fact_set_artifact_id: 'artifact:fact-set' }), exec)
    await definitions.find(definition => definition.name === 'generate_traceable_bento_from_outline').execute({ file_path: 'results/walmart.bento.html', outline_artifact_id: 'artifact:walmart-outline' }, exec)
    expect(execute).toHaveBeenLastCalledWith('paimind.generator.traceable-bento-deck', expect.objectContaining({ __outline_path: 'results/walmart.outline.json' }), exec)
    expect(execute.mock.calls.at(-1)?.[1]).not.toHaveProperty('__fact_set_path')
    await definitions.find(definition => definition.name === 'generate_traceable_bento_from_outline').execute({ file_path: 'results/walmart.bento.html', outline_artifact_id: 'artifact:walmart-outline', fact_set_artifact_id: '' }, exec)
    expect(execute).toHaveBeenLastCalledWith('paimind.generator.traceable-bento-deck', expect.objectContaining({ __outline_path: 'results/walmart.outline.json' }), exec)
    expect(execute.mock.calls.at(-1)?.[1]).not.toHaveProperty('__fact_set_path')
    await definitions.find(definition => definition.name === 'generate_traceable_bento_presentation').execute({ file_path: 'results/proposal.bento.html', outline_artifact_id: 'artifact:outline', outline: boundOutline }, exec)
    expect(execute).toHaveBeenLastCalledWith('paimind.generator.traceable-bento-deck', expect.objectContaining({ __outline_path: 'results/proposal.outline.json', __fact_set_path: 'results/proposal.fact-set.json' }), exec)
  })
})
