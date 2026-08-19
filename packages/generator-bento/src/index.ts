import { createHash } from 'node:crypto'
import {
  artifactToolMeta, presentArtifactToolResult,
  type PaimindArtifactGeneratorService, type PaimindGeneratorProvider,
} from '@paimind/artifact-runtime'
import {
  defineArtifactProducedEnvelope, defineArtifactTraceEnvelope,
  type ArtifactProducedEnvelopeV1, type ArtifactTraceEnvelope,
} from '@paimind/contracts'
import {
  canonicalJson, definePresentationOutline, MAX_PRESENTATION_SLIDES, PRESENTATION_OUTLINE_TOOL_SCHEMA, traceFromPresentationOutline, validatePresentationTraceability,
  type PresentationChartPoint, type PresentationElement, type PresentationOutlineV1,
  type PresentationSelector,
} from '@paimind/presentation-contracts'
import { definePaimindHarnessTool, type PaimindHostSystemPrompt, type PaimindHostToolRegistry } from '@paimind/harness-compat/host'
import { htmlPresentationMetadata, presentationThemeCss } from './presentation-spec.js'

export const name = 'paimind-generator-bento'
export const inject = ['paimindArtifactGenerators', 'tools', 'systemPrompt']
export const BENTO_GENERATOR_PROVIDER_ID = 'paimind.generator.bento-deck'
export const OUTLINE_GENERATOR_PROVIDER_ID = 'paimind.generator.presentation-outline'
export const TRACEABLE_BENTO_GENERATOR_PROVIDER_ID = 'paimind.generator.traceable-bento-deck'
export const BENTO_GENERATOR_TOOL = 'generate_bento_artifact'
export const OUTLINE_GENERATOR_TOOL = 'create_presentation_outline_artifact'
export const TRACEABLE_BENTO_GENERATOR_TOOL = 'generate_traceable_bento_presentation'

type JsonRecord = Record<string, unknown>
interface BentoSlide { readonly title: string; readonly body: string; readonly eyebrow?: string }

export interface GeneratorBentoHostContext {
  readonly paimindArtifactGenerators: PaimindArtifactGeneratorService
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  effect(install: () => void | (() => void), label?: string): void
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function workspacePath(value: unknown, extension: string, label = 'file_path'): string {
  const path = text(value, label)
  if (path.startsWith('/') || path.startsWith('\\') || path.split(/[\\/]+/).includes('..') || !path.toLowerCase().endsWith(extension)) {
    throw new Error(`${label} must be a Workspace-relative ${extension} path`)
  }
  return path
}

function args(input: Readonly<JsonRecord>): { readonly filePath: string; readonly title: string; readonly slides: readonly BentoSlide[] } {
  const filePath = workspacePath(input.file_path, '.html')
  if (!Array.isArray(input.slides) || input.slides.length < 1 || input.slides.length > MAX_PRESENTATION_SLIDES) throw new Error(`slides must contain 1-${MAX_PRESENTATION_SLIDES} slides`)
  return {
    filePath, title: text(input.title, 'title'),
    slides: input.slides.map((value, index) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`slides[${index}] must be an object`)
      const slide = value as JsonRecord
      return { title: text(slide.title, `slides[${index}].title`), body: text(slide.body, `slides[${index}].body`), ...(slide.eyebrow === undefined ? {} : { eyebrow: text(slide.eyebrow, `slides[${index}].eyebrow`) }) }
    }),
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** Legacy self-contained card format retained for untraced lightweight content. */
export function renderBentoDocument(title: string, slides: readonly BentoSlide[]): string {
  const pages = slides.map((slide, index) => `<section class="slide${index === 0 ? ' active' : ''}" data-slide="${index + 1}"><div class="card"><p class="eyebrow">${escapeHtml(slide.eyebrow ?? `SLIDE ${index + 1}`)}</p><h1>${escapeHtml(slide.title)}</h1><p class="body">${escapeHtml(slide.body)}</p><p class="page">${index + 1} / ${slides.length}</p></div></section>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:"><title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#071725;color:#f7fbff;font-family:Inter,"PingFang SC",system-ui,sans-serif}.deck{width:100%;height:100%;position:relative}.slide{display:none;width:100%;height:100%;padding:clamp(20px,5vw,64px);background:radial-gradient(circle at 80% 10%,#2459c455,transparent 32%),linear-gradient(135deg,#071725,#102f4b)}.slide.active{display:grid;place-items:center}.card{position:relative;width:min(900px,100%);min-height:70%;padding:clamp(28px,6vw,72px);border:1px solid #7fc8ff55;border-radius:28px;background:#0d2238cc;box-shadow:0 30px 80px #0007}.eyebrow{margin:0 0 22px;color:#7fc8ff;font-size:13px;letter-spacing:.18em}.card h1{margin:0;max-width:820px;font-size:clamp(34px,6vw,72px);line-height:1.05}.body{max-width:760px;margin:36px 0 0;color:#d7e8f8;font-size:clamp(18px,2.4vw,28px);line-height:1.55;white-space:pre-wrap}.page{position:absolute;right:36px;bottom:24px;color:#8eabc3;font-size:12px}.hint{position:fixed;left:20px;bottom:14px;color:#7290aa;font-size:11px}
</style></head><body><main class="deck" aria-label="${escapeHtml(title)}">${pages}</main><p class="hint">← / →</p><script>
(()=>{const slides=[...document.querySelectorAll('.slide')];let index=0;const emit=type=>parent.postMessage({type,mode:'preview',slide:index+1},'*');const show=next=>{index=(next+slides.length)%slides.length;slides.forEach((slide,i)=>slide.classList.toggle('active',i===index));emit('paimind:bento-slide')};addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();show(index+1)}if(event.key==='ArrowLeft'){event.preventDefault();show(index-1)}if(event.key==='Escape')emit('paimind:bento-exit')});emit('paimind:bento-ready')})();
</script></body></html>`
}

function selectorAttributes(selector: PresentationSelector): string {
  if (selector.kind === 'object') return 'data-selector-kind="object"'
  if (selector.kind === 'chart-point') return `data-selector-kind="chart-point" data-series-key="${escapeHtml(selector.seriesKey)}" data-category-key="${escapeHtml(selector.categoryKey)}"`
  return `data-selector-kind="table-cell" data-row-key="${escapeHtml(selector.rowKey)}" data-column-key="${escapeHtml(selector.columnKey)}"`
}

function pointSelector(point: PresentationChartPoint): PresentationSelector {
  return { kind: 'chart-point', seriesKey: point.seriesKey, categoryKey: point.categoryKey }
}

function renderChart(element: PresentationElement): string {
  const chart = element.chart
  if (chart === undefined) return ''
  const values = chart.points.map(point => point.value)
  const min = Math.min(0, ...values); const max = Math.max(0, ...values); const range = Math.max(1, max - min)
  const at = (value: number): number => Math.max(2, Math.min(98, ((value - min) / range) * 94 + 3))
  if (chart.kind === 'slope' || chart.kind === 'line') {
    const width = 720; const height = 280; const step = chart.points.length <= 1 ? 0 : width / (chart.points.length - 1)
    const positions = chart.points.map((point, index) => ({ point, x: index * step, y: height - ((point.value - min) / range) * (height - 28) - 14 }))
    const line = positions.map(position => `${position.x},${position.y}`).join(' ')
    return `<div class="chart chart-${chart.kind}" role="img" aria-label="${escapeHtml(element.title ?? chart.kind)}"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${line}"/></svg>${positions.map(position => `<button type="button" class="chart-point line-point" style="--x:${position.x / width * 100}%;--y:${position.y / height * 100}%" data-fact-id="${escapeHtml(position.point.factId)}" ${selectorAttributes(pointSelector(position.point))} aria-label="${escapeHtml(`${position.point.label}: ${position.point.displayValue}`)}"><span>${escapeHtml(position.point.displayValue)}</span></button>`).join('')}</div>`
  }
  return `<div class="chart chart-${chart.kind}" role="img" aria-label="${escapeHtml(element.title ?? chart.kind)}">${chart.points.map(point => `<button type="button" class="chart-row" data-fact-id="${escapeHtml(point.factId)}" ${selectorAttributes(pointSelector(point))}><span class="chart-label">${escapeHtml(point.label)}</span><span class="chart-track"><i style="--value:${at(point.value)}%"></i></span><strong>${escapeHtml(point.displayValue)}</strong></button>`).join('')}</div>`
}

function renderTable(element: PresentationElement): string {
  const table = element.table
  if (table === undefined) return ''
  return `<div class="table-wrap"><table><thead><tr><th>Dimension</th>${table.columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr><th>${escapeHtml(row.label)}</th>${table.columns.map(column => { const cell = row.cells.find(candidate => candidate.columnKey === column.columnKey); if (cell === undefined) return '<td>—</td>'; const binding = element.bindings.find(candidate => candidate.selector.kind === 'table-cell' && candidate.selector.rowKey === row.rowKey && candidate.selector.columnKey === column.columnKey); return `<td${binding === undefined ? '' : ` tabindex="0" data-fact-id="${escapeHtml(binding.factId)}" ${selectorAttributes(binding.selector)}`}>${escapeHtml(cell.displayValue)}</td>` }).join('')}</tr>`).join('')}</tbody></table></div>`
}

function renderElement(element: PresentationElement): string {
  const objectBinding = element.bindings.find(binding => binding.selector.kind === 'object')
  const selectable = objectBinding === undefined ? '' : ` tabindex="0" data-fact-id="${escapeHtml(objectBinding.factId)}" ${selectorAttributes(objectBinding.selector)}`
  const editable = element.presentationOnly === true || element.factIds.length === 0 ? ' data-editable="true" data-edit-field="presentation-copy"' : ''
  const locked = editable === '' ? ' data-edit-lock="fact" title="事实值已锁定；请通过来源或分析链更新"' : ''
  const content = element.type === 'chart' ? renderChart(element)
    : element.type === 'table' ? renderTable(element)
      : element.type === 'kpi' ? `<strong class="kpi-value">${escapeHtml(element.displayValue ?? element.text ?? '')}</strong>${element.title === undefined ? '' : `<span class="kpi-label">${escapeHtml(element.title)}</span>`}`
        : element.type === 'list' ? `<ul>${(element.text ?? '').split('\n').filter(Boolean).map(line => `<li>${escapeHtml(line.replace(/^[-•]\s*/, ''))}</li>`).join('')}</ul>`
          : `${element.title === undefined ? '' : `<h2>${escapeHtml(element.title)}</h2>`}${element.text === undefined ? '' : `<p>${escapeHtml(element.text)}</p>`}`
  return `<article class="element element-${escapeHtml(element.type)}" data-object-id="${escapeHtml(element.objectId)}"${selectable}${editable}${locked}>${content}</article>`
}

export type BentoSlideFit = 'standard' | 'compact' | 'tight'

function copyWeight(value: string | undefined): number {
  if (value === undefined) return 0
  return [...value].reduce((total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0)
}

/** Deterministic first-pass fit profile; runtime measurement performs the final fit. */
export function bentoSlideFit(slide: PresentationOutlineV1['slides'][number]): BentoSlideFit {
  const elementWeight = slide.elements.reduce((total, element) => total + (
    element.type === 'chart' ? 44 + (element.chart?.points.length ?? 0) * 12
      : element.type === 'table' ? 44 + (element.table?.rows.length ?? 0) * Math.max(1, element.table?.columns.length ?? 0) * 4
      : element.type === 'kpi' ? 28
        : element.type === 'decoration' ? 8
          : 20
  ), 0)
  const pressure = copyWeight(slide.title) * 1.15 + copyWeight(slide.narrative) * 0.55 + elementWeight
  const dataDense = slide.elements.some(element => (element.chart?.points.length ?? 0) >= 6
    || (element.table?.rows.length ?? 0) * (element.table?.columns.length ?? 0) >= 12)
  if (pressure >= 270 || slide.elements.length >= 8) return 'tight'
  if (pressure >= 185 || slide.elements.length >= 6 || dataDense) return 'compact'
  return 'standard'
}

/** Deterministic, offline and selector-addressable Bento document generated from a validated Outline. */
export function renderTraceableBentoDocument(input: unknown): string {
  const outline = definePresentationOutline(input)
  const metadata = htmlPresentationMetadata(outline.design)
  const metadataJson = JSON.stringify(metadata).replaceAll('<', '\\u003c')
  const pages = outline.slides.map((slide, index) => { const fit = bentoSlideFit(slide); return `<section class="slide layout-${escapeHtml(slide.layout)} fit-${fit}${index === 0 ? ' active' : ''}" data-slide="${index + 1}" data-slide-id="${escapeHtml(slide.slideId)}" data-fit-profile="${fit}" data-fit-scale="1"><header class="slide-head"><p class="eyebrow" data-editable="true" data-edit-field="eyebrow">${escapeHtml(slide.eyebrow ?? slide.layout.toUpperCase())}</p><h1 data-editable="true" data-edit-field="title">${escapeHtml(slide.title)}</h1><p class="narrative" data-editable="true" data-edit-field="narrative">${escapeHtml(slide.narrative)}</p></header><div class="elements">${slide.elements.map(renderElement).join('')}</div><p class="page">${index + 1} / ${outline.slides.length}</p></section>` }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:"><title>${escapeHtml(outline.title)}</title><style>
:root{--stage:#05080d;--bg:#0d1117;--panel:#161b22;--ink:#f9fafb;--muted:#9ca3af;--accent:#00c896;--accent2:#a7f3d0;--line:#ffffff24;--deck-shadow:#0007;--deck-font:Inter,"PingFang SC",system-ui,sans-serif;--slide-pad:clamp(22px,4.2vw,60px);--slide-gap:clamp(16px,2.7vh,30px);--element-pad:clamp(15px,1.9vw,25px)}${presentationThemeCss(outline.design)}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--stage);color:var(--ink);font-family:var(--deck-font)}body{display:grid;place-items:center}.deck{width:min(100vw,calc(100vh * 16 / 9));height:min(100vh,calc(100vw * 9 / 16));aspect-ratio:16/9;position:relative;overflow:hidden;background:var(--bg);box-shadow:0 24px 80px var(--deck-shadow)}.slide{display:none;position:absolute;inset:0;overflow:hidden;padding:var(--slide-pad);background:radial-gradient(circle at 88% 6%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 30%),linear-gradient(145deg,var(--bg),var(--panel))}.slide.active{display:grid;grid-template-rows:auto 1fr;gap:var(--slide-gap)}.slide-head{max-width:82%}.eyebrow{margin:0 0 10px;color:var(--accent);font-size:clamp(9px,1vw,13px);letter-spacing:.16em}.slide h1{margin:0;font-size:clamp(24px,4.2vw,58px);line-height:1.04;letter-spacing:-.035em}.narrative{max-width:820px;margin:14px 0 0;color:var(--muted);font-size:clamp(11px,1.45vw,19px);line-height:1.45}.elements{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));align-content:start;gap:clamp(8px,1.35vw,18px);min-height:0}.element{grid-column:span 4;min-width:0;padding:var(--element-pad);border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--panel) 88%,transparent);box-shadow:0 16px 44px var(--deck-shadow)}.element:focus,.element.selected,.chart-row:focus,.chart-row.selected,td:focus,td.selected{outline:3px solid var(--accent2);outline-offset:3px}.element-title,.element-text,.element-list{grid-column:span 6}.element-chart,.element-table{grid-column:1/-1}.element-decoration{border:0;background:transparent;box-shadow:none}.layout-cover .slide-head,.layout-section .slide-head{align-self:center}.layout-cover .elements,.layout-section .elements{align-self:center}.layout-cover h1{font-size:clamp(38px,6.5vw,86px);max-width:1000px}.layout-kpi .element-kpi{grid-column:span 4}.layout-comparison .element{grid-column:span 6}.layout-insight .element,.layout-recommendation .element{grid-column:span 6}.element h2{margin:0 0 9px;font-size:clamp(14px,1.7vw,23px)}.element p,.element li{margin:0;color:var(--muted);font-size:clamp(10px,1.22vw,16px);line-height:1.48}.element ul{display:grid;gap:8px;margin:0;padding-left:18px}.kpi-value{display:block;color:var(--accent2);font-size:clamp(28px,5vw,66px);line-height:1}.kpi-label{display:block;margin-top:10px;color:var(--muted)}.chart{display:grid;gap:8px;min-height:180px;position:relative}.chart-row{display:grid;grid-template-columns:minmax(80px,1fr) minmax(140px,4fr) minmax(58px,auto);align-items:center;gap:10px;padding:6px;border:0;border-radius:10px;color:inherit;background:transparent;text-align:left;cursor:pointer}.chart-track{height:10px;position:relative;border-radius:20px;background:color-mix(in srgb,var(--ink) 10%,transparent)}.chart-track i{display:block;width:var(--value);height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),var(--accent2))}.chart-lollipop .chart-track i,.chart-dot-plot .chart-track i{height:2px;margin-top:4px;position:relative}.chart-lollipop .chart-track i:after,.chart-dot-plot .chart-track i:after{content:"";width:12px;height:12px;position:absolute;right:-6px;top:-5px;border-radius:50%;background:var(--accent2)}.chart-bullet .chart-track{height:16px}.chart-bullet .chart-track i{height:6px;margin-top:5px}.chart-slope,.chart-line{min-height:220px}.chart svg{width:100%;height:100%;position:absolute;inset:0;overflow:visible}.chart polyline{fill:none;stroke:var(--accent);stroke-width:4;vector-effect:non-scaling-stroke}.line-point{width:16px;height:16px;position:absolute;left:var(--x);top:var(--y);transform:translate(-50%,-50%);border:3px solid var(--bg);border-radius:50%;background:var(--accent2);cursor:pointer}.line-point span{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);white-space:nowrap;color:var(--ink);font-size:10px}.table-wrap{width:100%;overflow:auto}table{width:100%;border-collapse:collapse;font-size:clamp(9px,1vw,13px)}th,td{padding:8px;border-bottom:1px solid var(--line);text-align:right}th:first-child{text-align:left}td[data-fact-id]{cursor:pointer}.page{position:absolute;right:20px;bottom:11px;margin:0;color:var(--muted);font-size:10px}.hint{position:fixed;left:16px;bottom:10px;margin:0;color:color-mix(in srgb,var(--ink) 62%,transparent);font-size:10px}.hint-edit{display:none;color:var(--accent2)}body[data-mode="edit"] .hint-preview{display:none}body[data-mode="edit"] .hint-edit{display:block}body[data-mode="edit"] [data-editable="true"]{outline:1px dashed var(--accent);outline-offset:4px;cursor:text}body[data-mode="edit"] [data-editable="true"]:focus{outline:2px solid var(--accent2)}body[data-mode="edit"] [data-edit-lock="fact"]{cursor:not-allowed;filter:saturate(.65);opacity:.82}@media(max-width:700px){.slide{--slide-pad:clamp(14px,3.2vw,22px)}.slide-head{max-width:95%}.elements{gap:7px}.element{--element-pad:clamp(9px,2vw,14px)}.slide h1{font-size:clamp(20px,5vw,32px)}.chart-row{grid-template-columns:70px 1fr}.chart-row strong{grid-column:2}.page{right:9px}}
.slide.active{display:flex;flex-direction:column;gap:var(--slide-gap)}
.slide-head{flex:0 0 auto;min-width:0}
.elements{flex:1 1 auto;transform-origin:top left}
.layout-cover .element-kpi{grid-column:span 3}
.layout-cover .element-decoration{grid-column:1/-1;padding-block:0}
.fit-compact{--slide-pad:clamp(18px,3.4vw,46px);--slide-gap:clamp(10px,1.8vh,20px);--element-pad:clamp(11px,1.45vw,19px)}
.fit-compact .slide-head{max-width:90%}
.fit-compact h1{font-size:clamp(22px,3.5vw,48px)}
.layout-cover.fit-compact h1{font-size:clamp(32px,5vw,66px)}
.fit-compact .narrative{margin-top:10px;font-size:clamp(10px,1.2vw,16px);line-height:1.35}
.fit-compact .kpi-value{font-size:clamp(24px,4vw,52px)}
.fit-tight{--slide-pad:clamp(14px,2.8vw,38px);--slide-gap:clamp(8px,1.3vh,14px);--element-pad:clamp(9px,1.15vw,15px)}
.fit-tight .slide-head{max-width:94%}
.fit-tight h1{font-size:clamp(20px,3vw,42px)}
.layout-cover.fit-tight h1{font-size:clamp(28px,4.25vw,56px)}
.fit-tight .eyebrow{margin-bottom:6px;font-size:clamp(8px,.82vw,11px)}
.fit-tight .narrative{margin-top:7px;font-size:clamp(9px,1.05vw,14px);line-height:1.3}
.fit-tight .elements{gap:clamp(6px,.9vw,12px)}
.fit-tight .element{border-radius:14px}
.fit-tight .element h2{margin-bottom:5px;font-size:clamp(12px,1.35vw,18px)}
.fit-tight .element p,.fit-tight .element li{font-size:clamp(9px,1vw,13px);line-height:1.35}
.fit-tight .kpi-value{font-size:clamp(21px,3.4vw,44px)}
.fit-tight .kpi-label{margin-top:6px}
.fit-compact .chart{gap:5px;min-height:150px}
.fit-compact .chart-row{padding:4px}
.fit-tight .chart{gap:3px;min-height:128px}
.fit-tight .chart-row{padding:2px}
@media(max-width:700px){.chart-row{grid-template-columns:minmax(56px,.9fr) minmax(80px,2fr) minmax(42px,auto)}.chart-row strong{grid-column:auto}}
</style><meta name="paimind:presentation-schema" content="${metadata.schema}"><meta name="paimind:presentation-template" content="${escapeHtml(outline.design.templateId)}"><script type="application/json" id="paimind-presentation-spec">${metadataJson}</script></head><body data-mode="preview" data-template-id="${escapeHtml(outline.design.templateId)}" data-style-preset="${escapeHtml(outline.design.stylePreset)}" data-density="${escapeHtml(outline.design.density)}"><main class="deck" aria-label="${escapeHtml(outline.title)}">${pages}</main><p class="hint hint-preview">← / → · 选择对象可查看溯源</p><p class="hint hint-edit">编辑展示文案 · 事实值与派生指标已锁定</p><script>
(()=>{const slides=[...document.querySelectorAll('.slide')];let index=0;let mode='preview';const selectorFor=el=>{const kind=el.dataset.selectorKind;if(kind==='chart-point')return{kind,seriesKey:el.dataset.seriesKey,categoryKey:el.dataset.categoryKey};if(kind==='table-cell')return{kind,rowKey:el.dataset.rowKey,columnKey:el.dataset.columnKey};return{kind:'object'}};const emit=(type,extra={})=>parent.postMessage({type,mode,slide:index+1,slideId:slides[index]?.dataset.slideId,...extra},'*');const show=next=>{index=(next+slides.length)%slides.length;slides.forEach((slide,i)=>slide.classList.toggle('active',i===index));emit('paimind:bento-slide')};const select=el=>{document.querySelectorAll('.selected').forEach(node=>node.classList.remove('selected'));el.classList.add('selected');const object=el.closest('[data-object-id]');emit('paimind:bento-select',{objectId:object?.dataset.objectId,factId:el.dataset.factId,selector:selectorFor(el)});};addEventListener('click',event=>{if(mode==='edit'&&event.target.closest('[data-editable="true"]'))return;const el=event.target.closest('[data-selector-kind]');if(el)select(el)});addEventListener('keydown',event=>{if(event.target.closest?.('[contenteditable="true"]'))return;if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();show(index+1)}if(event.key==='ArrowLeft'){event.preventDefault();show(index-1)}if(event.key==='Escape')emit('paimind:bento-exit')});addEventListener('message',event=>{if(event.source!==parent)return;const data=event.data;if(!data||typeof data!=='object')return;if(data.type==='paimind:bento-mode'&&['preview','edit','trace'].includes(data.mode)){mode=data.mode;document.body.dataset.mode=mode;document.querySelectorAll('[data-editable="true"]').forEach(el=>{el.contentEditable=mode==='edit'?'true':'false';el.spellcheck=mode==='edit'});emit('paimind:bento-ready')}if(data.type==='paimind:bento-focus'){const slideIndex=slides.findIndex(slide=>slide.dataset.slideId===data.slideId);if(slideIndex>=0)show(slideIndex);const root=document.querySelector('[data-object-id="'+data.objectId+'"]');if(root){const target=data.selector?.kind==='chart-point'?root.querySelector('[data-series-key="'+data.selector.seriesKey+'"][data-category-key="'+data.selector.categoryKey+'"]'):data.selector?.kind==='table-cell'?root.querySelector('[data-row-key="'+data.selector.rowKey+'"][data-column-key="'+data.selector.columnKey+'"]'):root;target?.focus();if(target)select(target)}}});emit('paimind:bento-ready')})();
(()=>{const slides=[...document.querySelectorAll('.slide')];const fit=slide=>{if(!slide?.classList.contains('active'))return;const elements=slide.querySelector('.elements');if(!elements)return;elements.style.width='100%';elements.style.transform='none';slide.dataset.fitScale='1';slide.dataset.fitOverflow='false';const available=elements.clientHeight;const needed=elements.scrollHeight;if(available<=0||needed<=available+1)return;let scale=Math.max(.42,Math.min(1,available/needed));elements.style.width=(100/scale)+'%';const adjustedNeeded=elements.scrollHeight;scale=Math.max(.42,Math.min(scale,available/adjustedNeeded));elements.style.width=(100/scale)+'%';elements.style.transform='scale('+scale+')';slide.dataset.fitScale=scale.toFixed(3);slide.dataset.fitOverflow=adjustedNeeded*scale>available+1?'true':'false'};const fitActive=()=>requestAnimationFrame(()=>fit(slides.find(slide=>slide.classList.contains('active'))));const observer=new MutationObserver(fitActive);slides.forEach(slide=>observer.observe(slide,{attributes:true,attributeFilter:['class']}));addEventListener('resize',fitActive);addEventListener('input',event=>{if(event.target.closest?.('[data-editable="true"]'))fitActive()});fitActive()})();
</script></body></html>`
}

export const bentoProvider: PaimindGeneratorProvider = {
  id: BENTO_GENERATOR_PROVIDER_ID, kind: 'bento', previewKind: 'bento-deck',
  describe(input) { const value = args(input); return { path: value.filePath, title: value.title } },
  async generate(input, context) {
    const value = args(input)
    if (context.signal.aborted) throw new Error('Bento generation cancelled')
    await context.writeText(value.filePath, renderBentoDocument(value.title, value.slides))
    return { path: value.filePath, title: value.title }
  },
}

function outlineArgs(input: Readonly<JsonRecord>): { readonly filePath: string; readonly outline: Readonly<PresentationOutlineV1> } {
  return { filePath: workspacePath(input.file_path, '.outline.json'), outline: definePresentationOutline(input.outline) }
}

export const outlineProvider: PaimindGeneratorProvider = {
  id: OUTLINE_GENERATOR_PROVIDER_ID, kind: 'json', previewKind: 'data-document',
  describe(input) { const value = outlineArgs(input); return { path: value.filePath, title: `${value.outline.title} · Outline` } },
  async generate(input, context) {
    const value = outlineArgs(input)
    await context.writeText(value.filePath, canonicalJson(value.outline))
    return { path: value.filePath, title: `${value.outline.title} · Outline` }
  },
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'` }
async function verifySourceHashes(outline: Readonly<PresentationOutlineV1>, context: Parameters<PaimindGeneratorProvider['generate']>[1]): Promise<void> {
  for (const source of outline.sources) {
    const result = await context.runWorkspaceCommand({ command: `shasum -a 256 -- ${shellQuote(source.path)}`, description: `Verify frozen source ${source.sourceId}`, timeoutMs: 30_000 })
    const actual = result.stdout.trim().split(/\s+/, 1)[0]?.toLowerCase()
    if (actual !== source.sha256) throw Object.assign(new Error(`source hash mismatch for ${source.sourceId}`), { code: 'source_hash_mismatch' })
  }
}

function sidecarPath(htmlPath: string, suffix: '.trace.json' | '.validation.json'): string {
  return htmlPath.toLowerCase().endsWith('.bento.html') ? `${htmlPath.slice(0, -'.bento.html'.length)}${suffix}` : `${htmlPath.slice(0, -'.html'.length)}${suffix}`
}

function traceableArgs(input: Readonly<JsonRecord>): { readonly filePath: string; readonly outline: Readonly<PresentationOutlineV1>; readonly outlineArtifactId?: string } {
  const filePath = workspacePath(input.file_path, '.bento.html')
  const outline = definePresentationOutline(input.outline)
  const outlineArtifactId = input.outline_artifact_id === undefined ? undefined : text(input.outline_artifact_id, 'outline_artifact_id')
  return { filePath, outline, ...(outlineArtifactId === undefined ? {} : { outlineArtifactId }) }
}

export const traceableBentoProvider: PaimindGeneratorProvider = {
  id: TRACEABLE_BENTO_GENERATOR_PROVIDER_ID, kind: 'bento', previewKind: 'bento-deck',
  describe(input) { const value = traceableArgs(input); return { path: value.filePath, title: value.outline.title } },
  async generate(input, context) {
    const value = traceableArgs(input)
    await verifySourceHashes(value.outline, context)
    const trace = traceFromPresentationOutline(value.outline)
    const validation = validatePresentationTraceability(value.outline, true)
    if (!validation.valid || validation.resolutionRate !== 1 || validation.factValuesChanged) throw Object.assign(new Error('presentation trace validation failed'), { code: 'trace_validation_failed' })
    const html = renderTraceableBentoDocument(value.outline)
    const traceJson = canonicalJson(trace)
    const validationJson = canonicalJson({ ...validation, ...(value.outlineArtifactId === undefined ? {} : { outlineArtifactId: value.outlineArtifactId }) })
    const tracePath = sidecarPath(value.filePath, '.trace.json')
    const validationPath = sidecarPath(value.filePath, '.validation.json')
    await context.writeText(tracePath, traceJson)
    await context.writeText(validationPath, validationJson)
    await context.writeText(value.filePath, html)
    return { path: value.filePath, title: value.outline.title, traceDocumentRef: { path: tracePath, schema: trace.schemaVersion, sha256: createHash('sha256').update(traceJson).digest('hex'), bytes: Buffer.byteLength(traceJson) } }
  },
}

function artifactFromValue(value: JsonRecord): Readonly<ArtifactProducedEnvelopeV1> { return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1) }
function traceFromValue(value: JsonRecord): Readonly<ArtifactTraceEnvelope> | undefined { return value.trace === undefined ? undefined : defineArtifactTraceEnvelope(value.trace as ArtifactTraceEnvelope) }

const ARTIFACT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  schema: { type: 'string', required: true }, artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, path: { type: 'string', required: true }, title: { type: 'string', required: true }, kind: { type: 'string', required: true }, previewKind: { type: 'string', required: true }, revision: { type: 'number', required: true }, producerId: { type: 'string', required: true }, taskId: { type: 'string', required: true }, traceId: { type: 'string' }, state: { type: 'string', required: true }, producedAt: { type: 'number', required: true }, error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
} } as const
const TRACE_SCHEMA = { type: 'object', additionalProperties: true, properties: { schema: { type: 'string', required: true }, traceId: { type: 'string', required: true }, artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, producerId: { type: 'string', required: true }, taskId: { type: 'string', required: true }, artifactRevision: { type: 'number', required: true }, producedAt: { type: 'number', required: true } } } as const
const TOOL_OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, properties: { artifact: { ...ARTIFACT_SCHEMA, required: true }, trace: TRACE_SCHEMA } } as const
function renderToolOutput(value: JsonRecord, label: string): { type: 'text'; text: string }[] {
  const artifact = artifactFromValue(value)
  return [{ type: 'text', text: artifact.state === 'available' ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">${label}</artifact>` : `<artifact-error code="${artifact.error?.code ?? 'generation_failed'}">${artifact.error?.message ?? 'Generation failed'}</artifact-error>` }]
}
function metaForValue(value: JsonRecord): ReturnType<typeof artifactToolMeta> { return artifactToolMeta(artifactFromValue(value), traceFromValue(value)) }

export function apply(ctx: GeneratorBentoHostContext): void {
  ctx.effect(() => {
    const disposers = [ctx.paimindArtifactGenerators.register(bentoProvider), ctx.paimindArtifactGenerators.register(outlineProvider), ctx.paimindArtifactGenerators.register(traceableBentoProvider)]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'paimind-generator-bento: providers')
  ctx.systemPrompt.section({
    name: 'tool:generate-bento-artifact', order: 114,
    text: 'Use create_presentation_outline_artifact followed by generate_traceable_bento_presentation for evidence-backed decks. First produce paimind.presentation-outline/v1 with a paimind.presentation-design/v1 declaration for a registered 16:9 HTML template and style preset; never write HTML, alter verified facts, invent source hashes, or invent CSS. Use generate_bento_artifact only for lightweight untraced cards.',
  })
  ctx.tools.register(definePaimindHarnessTool({
    name: OUTLINE_GENERATOR_TOOL, description: 'Validate and publish one paimind.presentation-outline/v1 JSON Artifact.',
    parameters: { file_path: { type: 'string', required: true }, outline: PRESENTATION_OUTLINE_TOOL_SCHEMA }, output: { schema: TOOL_OUTPUT_SCHEMA, render(_args, value) { return renderToolOutput(value, 'Validated presentation outline') }, presentationMeta(_args, value) { return metaForValue(value) } },
    async execute(toolArgs, exec) { return await ctx.paimindArtifactGenerators.execute(OUTLINE_GENERATOR_PROVIDER_ID, toolArgs, exec) },
    presentCall(toolArgs) { const path = typeof toolArgs.file_path === 'string' ? toolArgs.file_path : undefined; return { card: 'generic', title: 'Validate presentation outline', kind: 'edit', rawInput: path, ...(path === undefined ? {} : { locations: [{ path }] }) } }, presentResult(_args, result) { return presentArtifactToolResult(result) },
  }))
  ctx.tools.register(definePaimindHarnessTool({
    name: TRACEABLE_BENTO_GENERATOR_TOOL, description: 'Verify source hashes, render a rich offline Bento deck, and publish trace and validation sidecars.',
    parameters: { file_path: { type: 'string', required: true }, outline_artifact_id: { type: 'string' }, outline: PRESENTATION_OUTLINE_TOOL_SCHEMA }, output: { schema: TOOL_OUTPUT_SCHEMA, render(_args, value) { return renderToolOutput(value, 'Generated traceable Bento presentation') }, presentationMeta(_args, value) { return metaForValue(value) } },
    async execute(toolArgs, exec) { return await ctx.paimindArtifactGenerators.execute(TRACEABLE_BENTO_GENERATOR_PROVIDER_ID, toolArgs, exec) },
    presentCall(toolArgs) { const path = typeof toolArgs.file_path === 'string' ? toolArgs.file_path : undefined; return { card: 'generic', title: 'Generate traceable Bento', kind: 'edit', rawInput: path, ...(path === undefined ? {} : { locations: [{ path }] }) } }, presentResult(_args, result) { return presentArtifactToolResult(result) },
  }))
  ctx.tools.register(definePaimindHarnessTool({
    name: BENTO_GENERATOR_TOOL, description: 'Generate and publish one lightweight untraced PAIMind Bento presentation artifact.',
    parameters: { file_path: { type: 'string', required: true }, title: { type: 'string', required: true }, slides: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { eyebrow: { type: 'string' }, title: { type: 'string', required: true }, body: { type: 'string', required: true } } } } },
    output: { schema: TOOL_OUTPUT_SCHEMA, render(_args, value) { return renderToolOutput(value, 'Generated Bento artifact') }, presentationMeta(_args, value) { return metaForValue(value) } },
    async execute(toolArgs, exec) { return await ctx.paimindArtifactGenerators.execute(BENTO_GENERATOR_PROVIDER_ID, toolArgs, exec) },
    presentCall(toolArgs) { const path = typeof toolArgs.file_path === 'string' ? toolArgs.file_path : undefined; return { card: 'generic', title: typeof toolArgs.title === 'string' ? toolArgs.title : 'Generate Bento', kind: 'edit', rawInput: path, ...(path === undefined ? {} : { locations: [{ path }] }) } }, presentResult(_args, result) { return presentArtifactToolResult(result) },
  }))
}
