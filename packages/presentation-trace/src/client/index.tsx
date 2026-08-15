import {
  Component,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { contributePaimindExtension, type HarnessSessionService, type PaimindClientContext } from '@paimind/harness-compat'
import type { PaimindArtifactService } from '@paimind/artifacts'
import type { PaimindSidebarService, PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'
import type { PaimindBentoPreviewService } from '@paimind/renderer-bento'
import {
  PresentationTraceRegistry,
  HarnessProjectedPresentationTraceSource,
  selectedPresentationTrace,
  type PaimindPresentationTraceDocument,
  type PaimindPresentationTraceService,
  type PaimindPresentationTraceSource,
  type PaimindTraceFact,
  type PaimindTraceMetric,
  type PaimindTraceSlide,
} from '../index.js'

export const inject = ['slots', 'sessions', 'paimindArtifacts', 'paimindSidebar', 'paimindBentoPreview', 'locale']

export interface PresentationTraceClientContext extends PaimindClientContext {
  readonly sessions: HarnessSessionService
  readonly paimindArtifacts: PaimindArtifactService
  readonly paimindSidebar: PaimindSidebarService
  readonly paimindBentoPreview: PaimindBentoPreviewService
}

const QA_TRACE: PaimindPresentationTraceDocument = {
  schemaVersion: 'paimind.presentation-trace/v2',
  reviewStatus: 'verified',
  sources: [
    { id: 'aw-sales-detail', name: 'AdventureWorks_Sales_Detail.csv', format: 'CSV', version: 'v1', size: '18.4 MB', role: '订单与销售事实输入' },
    { id: 'aw-analysis-model', name: 'AdventureWorks_Analysis_Model.json', format: 'JSON', version: 'v1', size: '96 KB', role: '确定性口径与分析结果' },
  ],
  slides: [
    {
      slideId: 'bento-slide-01', explanation: '管理层封面结论由已登记销售与毛利事实支持。',
      businessBlocks: [{ blockId: 'executive-summary', label: 'Executive summary', description: '管理层核心规模与利润判断。' }],
      metrics: [
        {
          metricId: 'headline-sales', label: 'FY2020 销售额', businessBlockId: 'executive-summary',
          facts: [{
            factId: 'aw-sales-1098', displayValue: '$109.8M',
            dimensions: [{ key: 'period', label: 'Period', value: 'FY2018–FY2020' }],
            measures: [{ key: 'sales', label: 'Sales', value: 109800000, displayValue: '$109.8M' }],
            business: { definition: '已完成订单的累计销售额。', explanation: '三年销售规模达到 $109.8M，但需要与贡献毛利共同评估增长质量。', scope: { period: 'FY2018–FY2020', filters: ['AdventureWorks', 'order_status = completed', 'USD'] } },
            sourceIds: ['aw-sales-detail', 'aw-analysis-model'], visualScale: 'display value equals source-scale value', factValuesChanged: false,
            technical: {
              definition: 'SUM(sales_amount)', calculation: '按订单明细聚合 sales_amount，并对账分析模型输出。', aggregation: 'Deck period total',
              sourceFields: ['sales_amount', 'order_status', 'order_date'], filters: ['order_status = completed'], joinKeys: ['sales_order_detail_id'],
              lineage: [
                { stepId: 'read-sales', label: 'Read registered sales detail', operation: '读取登记的订单明细字段。' },
                { stepId: 'filter-completed', label: 'Apply completion filter', operation: '只保留已完成订单。' },
                { stepId: 'bind-fact', label: 'Bind immutable fact', operation: '以 factValuesChanged=false 绑定最终事实。' },
              ],
              codeFile: 'scripts/build-adventureworks-management-deck.mjs', executionDurationMs: 1840,
            },
          }],
        },
        {
          metricId: 'headline-profit', label: '贡献毛利', businessBlockId: 'executive-summary',
          facts: [{
            factId: 'aw-profit-126', displayValue: '$12.6M', dimensions: [], measures: [{ key: 'gross-profit', label: 'Gross profit', value: 12600000, displayValue: '$12.6M' }],
            business: { explanation: '销售额减去产品成本后的贡献毛利为 $12.6M。', scope: { period: 'FY2018–FY2020', filters: ['AdventureWorks', 'USD'] } },
            sourceIds: ['aw-analysis-model'], factValuesChanged: false,
          }],
        },
      ],
      visualBindings: [{ objectId: 'cover-stat', factBindings: [{ factId: 'aw-sales-1098', selector: { kind: 'object' } }] }],
    },
    {
      slideId: 'bento-slide-02', explanation: '管理层需要从收入规模切换到贡献毛利。',
      businessBlocks: [{ blockId: 'channel-economics', label: 'Channel economics', description: '渠道规模与利润质量。' }],
      metrics: [{
        metricId: 'channel-margin', label: '渠道毛利率', businessBlockId: 'channel-economics',
        visualization: { kind: 'cartesian', mark: 'bar', encodings: [{ channel: 'x', source: 'dimension', fieldKey: 'channel', label: 'Channel' }, { channel: 'y', source: 'measure', fieldKey: 'margin', label: 'Margin' }] },
        facts: [
          { factId: 'reseller-margin', displayValue: '0.6%', dimensions: [{ key: 'channel', label: 'Channel', value: 'Reseller' }], measures: [{ key: 'margin', label: 'Margin', value: 0.006, displayValue: '0.6%' }], business: { explanation: '经销商贡献主要收入，但利润率接近零。', scope: { period: 'FY2018–FY2020', filters: ['channel = reseller'] } }, sourceIds: ['aw-sales-detail'], factValuesChanged: false, technical: { calculation: '(sales_amount - product_cost) / sales_amount', aggregation: 'Channel weighted margin', sourceFields: ['sales_amount', 'product_cost', 'channel'] } },
          { factId: 'internet-margin', displayValue: '41.1%', dimensions: [{ key: 'channel', label: 'Channel', value: 'Internet' }], measures: [{ key: 'margin', label: 'Margin', value: 0.411, displayValue: '41.1%' }], business: { explanation: '互联网渠道贡献绝大多数毛利。', scope: { period: 'FY2018–FY2020', filters: ['channel = internet'] } }, sourceIds: ['aw-sales-detail'], factValuesChanged: false },
        ],
      }],
      visualBindings: [],
    },
    {
      slideId: 'bento-slide-03', explanation: '三项决策用于改善增长质量。',
      businessBlocks: [{ blockId: 'decision-map', label: 'Decision map', description: '价格、SKU 与资源重配。' }],
      metrics: [{
        metricId: 'scenario-value', label: '情景价值', businessBlockId: 'decision-map',
        facts: [{ factId: 'scenario-value-31', displayValue: '$3.1M', dimensions: [], measures: [{ key: 'value', label: 'Scenario value', value: 3100000, displayValue: '$3.1M' }], business: { explanation: '三项动作的情景价值合计约 $3.1M；这是情景值，不是预测承诺。', scope: { period: '90-day action scenario', filters: ['pricing', 'SKU governance', 'retention'] } }, sourceIds: ['aw-analysis-model'], factValuesChanged: false, technical: { calculation: 'pricing upside + SKU loss removal + internet retention scenario', aggregation: 'Scenario sum', codeFile: 'scripts/build-adventureworks-management-deck.mjs' } }],
      }],
      visualBindings: [],
    },
  ],
}

function qaSource(): PaimindPresentationTraceSource {
  return {
    id: 'paimind:fp08-browser-qa',
    getSnapshot: () => ({ traces: [{ id: 'qa-adventureworks-trace', traceId: 'qa-trace-adventureworks', document: QA_TRACE }] }),
    subscribe: () => () => {},
  }
}

const STYLE_ID = '@paimind/presentation-trace'
const STYLE = `
[data-paimind-trace] { min-height:100%; min-width:0; padding:14px; color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-bg-layer-1,transparent); font:inherit; }
[data-paimind-trace] h2,[data-paimind-trace] h3,[data-paimind-trace] p { margin:0; }
[data-paimind-trace-header] { display:grid; gap:4px; padding-bottom:12px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16)); }
[data-paimind-trace-header] h2 { font-size:15px; line-height:22px; }
[data-paimind-trace-meta] { display:flex; flex-wrap:wrap; gap:5px; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:10px; line-height:16px; }
[data-paimind-trace-badge] { padding:1px 6px; border-radius:99px; color:var(--dsw-alias-state-business-primary,#4f7ff8); background:color-mix(in srgb,currentColor 10%,transparent); }
[data-paimind-trace-section] { display:grid; gap:8px; padding:12px 0; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14)); }
[data-paimind-trace-section] h3 { font-size:11px; line-height:18px; color:var(--dsw-alias-label-secondary,#626872); text-transform:uppercase; letter-spacing:.04em; }
[data-paimind-trace-scroll] { display:flex; gap:6px; overflow:auto; scrollbar-width:thin; }
[data-paimind-trace-button] { min-width:0; padding:6px 9px; border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22)); border-radius:8px; color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05)); font:inherit; font-size:10px; line-height:15px; cursor:pointer; text-align:left; }
[data-paimind-trace-button][aria-pressed='true'] { border-color:var(--dsw-alias-state-business-primary,#4f7ff8); color:var(--dsw-alias-state-business-primary,#4f7ff8); background:color-mix(in srgb,currentColor 8%,transparent); }
[data-paimind-trace-list] { display:grid; gap:6px; margin:0; padding:0; list-style:none; }
[data-paimind-trace-row] { display:grid; gap:3px; padding:9px; border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16)); border-radius:10px; background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04)); }
button[data-paimind-trace-row] { width:100%; color:inherit; font:inherit; cursor:pointer; text-align:left; }
[data-paimind-trace-row] strong { font-size:11px; line-height:17px; }
[data-paimind-trace-row] span,[data-paimind-trace-row] p { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:10px; line-height:16px; overflow-wrap:anywhere; }
[data-paimind-trace-sheet] { display:grid; gap:9px; }
[data-paimind-trace-field] { display:grid; gap:3px; }
[data-paimind-trace-field] dt { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:9px; line-height:14px; text-transform:uppercase; }
[data-paimind-trace-field] dd { margin:0; color:var(--dsw-alias-label-primary,#202124); font-size:11px; line-height:18px; overflow-wrap:anywhere; }
[data-paimind-trace-value] { font-size:20px; line-height:28px; font-weight:650; }
[data-paimind-trace-cta] { width:100%; min-height:32px; border:0; border-radius:9px; color:#fff; background:var(--dsw-alias-state-business-primary,#4f7ff8); font:inherit; font-size:11px; cursor:pointer; }
[data-paimind-trace-empty],[data-paimind-trace-error] { padding:18px 12px; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:11px; line-height:18px; text-align:center; }
[data-paimind-trace-error] { color:var(--dsw-alias-state-error-primary,#d04444); }
@media(max-width:720px){[data-paimind-trace]{padding:11px}[data-paimind-trace-scroll]{display:grid;grid-template-columns:1fr 1fr;overflow:visible}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style'); style.id = STYLE_ID; style.dataset.paimindPlugin = '@paimind/presentation-trace'; style.textContent = STYLE; document.head.append(style)
  return () => { style.remove() }
}

function TraceIcon(): React.JSX.Element {
  return <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true"><circle cx="4" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.25"/><circle cx="14" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.25"/><circle cx="9" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.25"/><path d="m5.5 5 7-1M4.8 6.3l3.4 6.4m4.8-7.2-3.2 7" stroke="currentColor" strokeWidth="1.15"/></svg>
}

const statusCopy = (status: string, zh: boolean): string => ({ generated: zh ? '已生成' : 'Generated', reviewed: zh ? '已审核' : 'Reviewed', verified: zh ? '已验证' : 'Verified' }[status] ?? status)
const missing = (zh: boolean): string => zh ? '未登记' : 'Not registered'

function MetricFacts(props: { readonly metric: PaimindTraceMetric; readonly selectedId: string; readonly zh: boolean; readonly onSelect: (fact: PaimindTraceFact) => void }): React.JSX.Element {
  return <ul data-paimind-trace-list>{props.metric.facts.map(fact => <li key={fact.factId}><button type="button" data-paimind-trace-row aria-pressed={fact.factId === props.selectedId} onClick={() => { props.onSelect(fact) }}><strong>{fact.dimensions.map(row => row.value).join(' · ') || props.metric.label}</strong><span>{fact.measures.map(row => `${row.label}: ${row.displayValue}`).join(' · ') || fact.displayValue}</span></button></li>)}</ul>
}

function BusinessSheet(props: { readonly fact: PaimindTraceFact; readonly document: PaimindPresentationTraceDocument; readonly zh: boolean; readonly onTechnical: () => void }): React.JSX.Element {
  const sources = props.document.sources.filter(source => props.fact.sourceIds.includes(source.id))
  return <div data-paimind-trace-sheet>
    <div data-paimind-trace-value>{props.fact.displayValue}</div>
    <dl data-paimind-trace-sheet>
      <div data-paimind-trace-field><dt>{props.zh ? '来源文件' : 'Source files'}</dt><dd>{sources.map(source => `${source.name} · ${source.role}`).join('\n') || missing(props.zh)}</dd></div>
      <div data-paimind-trace-field><dt>{props.zh ? '结论定义' : 'Conclusion definition'}</dt><dd>{props.fact.business.definition ?? props.fact.business.explanation}</dd></div>
      <div data-paimind-trace-field><dt>{props.zh ? '公式与方法定义' : 'Formula & method definition'}</dt><dd>{props.fact.technical?.definition ?? props.fact.technical?.calculation ?? missing(props.zh)}</dd></div>
      <div data-paimind-trace-field><dt>{props.zh ? '范围' : 'Scope'}</dt><dd>{props.fact.business.scope.period} · {props.fact.business.scope.filters.join(' · ')}</dd></div>
    </dl>
    <button type="button" data-paimind-trace-cta onClick={props.onTechnical}>{props.zh ? '查看技术追溯' : 'View technical trace'}</button>
  </div>
}

function TechnicalSheet(props: { readonly fact: PaimindTraceFact; readonly zh: boolean; readonly onBusiness: () => void }): React.JSX.Element {
  const technical = props.fact.technical
  return <div data-paimind-trace-sheet>
    <button type="button" data-paimind-trace-button onClick={props.onBusiness}>← {props.zh ? '返回业务证据' : 'Back to business evidence'}</button>
    <section data-paimind-trace-section><h3>{props.zh ? '数据链路' : 'Data Lineage'}</h3>{technical?.lineage?.length ? <ol data-paimind-trace-list>{technical.lineage.map(step => <li key={step.stepId} data-paimind-trace-row><strong>{step.label}</strong><p>{step.operation}</p></li>)}</ol> : <p>{missing(props.zh)}</p>}</section>
    <section data-paimind-trace-section><h3>{props.zh ? '计算逻辑' : 'Calculation Logic'}</h3><dl data-paimind-trace-sheet><div data-paimind-trace-field><dt>{props.zh ? '计算' : 'Calculation'}</dt><dd>{technical?.calculation ?? missing(props.zh)}</dd></div><div data-paimind-trace-field><dt>{props.zh ? '聚合' : 'Aggregation'}</dt><dd>{technical?.aggregation ?? missing(props.zh)}</dd></div><div data-paimind-trace-field><dt>{props.zh ? '源字段' : 'Source fields'}</dt><dd>{technical?.sourceFields?.join(' · ') ?? missing(props.zh)}</dd></div><div data-paimind-trace-field><dt>{props.zh ? '连接键' : 'Join keys'}</dt><dd>{technical?.joinKeys?.join(' · ') ?? missing(props.zh)}</dd></div></dl></section>
    <section data-paimind-trace-section><h3>{props.zh ? '代码与运行' : 'Code & Runtime'}</h3><dl data-paimind-trace-sheet><div data-paimind-trace-field><dt>{props.zh ? '代码文件' : 'Code file'}</dt><dd>{technical?.codeFile ?? missing(props.zh)}</dd></div><div data-paimind-trace-field><dt>{props.zh ? '运行时长' : 'Execution duration'}</dt><dd>{technical?.executionDurationMs === undefined ? missing(props.zh) : `${technical.executionDurationMs} ms`}</dd></div></dl></section>
  </div>
}

export function PresentationTracePanel(props: { readonly service: PaimindPresentationTraceService; readonly bento: PaimindBentoPreviewService; readonly scope: PaimindSidebarTabScope }): React.JSX.Element {
  const snapshot = useSyncExternalStore(props.service.subscribe.bind(props.service), props.service.getSnapshot.bind(props.service), props.service.getSnapshot.bind(props.service))
  const bento = useSyncExternalStore(props.bento.subscribe.bind(props.bento), props.bento.getSnapshot.bind(props.bento), props.bento.getSnapshot.bind(props.bento))
  const activeLocale = useSyncExternalStore(props.scope.locale.subscribe.bind(props.scope.locale), () => props.scope.locale.getLocale().active, () => props.scope.locale.getLocale().active)
  const zh = activeLocale.startsWith('zh')
  const trace = selectedPresentationTrace(snapshot)
  const [slideIndex, setSlideIndex] = useState(0)
  const [blockId, setBlockId] = useState('')
  const [metricId, setMetricId] = useState('')
  const [factId, setFactId] = useState('')
  const [detail, setDetail] = useState<'business' | 'technical'>('business')
  useEffect(() => { setSlideIndex(0); setBlockId(''); setMetricId(''); setFactId(''); setDetail('business') }, [snapshot.selection?.traceId, snapshot.selection?.artifactId])
  useEffect(() => {
    const event = bento.runtimeEvent; const request = bento.request; const selection = snapshot.selection
    if (trace === null || event === null || request === null || selection === null) return
    if (request.sessionId !== selection.sessionId || request.workspaceId !== selection.workspaceId || request.path !== selection.path) return
    if (event.slide >= 1 && event.slide <= trace.document.slides.length) {
      setSlideIndex(event.slide - 1); setBlockId(''); setMetricId(''); setFactId(''); setDetail('business')
    }
  }, [bento.revision, snapshot.selection, trace])
  if (snapshot.selection === null) return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}><div data-paimind-trace-empty>{zh ? '请从 PAIMind 产物中选择“追溯”。' : 'Choose Trace from a PAIMind artifact.'}</div></section>
  if (trace === null) return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}><div role="alert" data-paimind-trace-error>{zh ? '关联的追溯记录不可用；原生预览与会话不受影响。' : 'The associated trace is unavailable; native preview and conversation remain available.'}</div></section>
  const slide = trace.document.slides[Math.min(slideIndex, trace.document.slides.length - 1)] as PaimindTraceSlide
  const activeBlock = slide.businessBlocks.find(block => block.blockId === blockId) ?? slide.businessBlocks[0]
  const metrics = slide.metrics.filter(metric => metric.businessBlockId === activeBlock?.blockId)
  const metric = metrics.find(row => row.metricId === metricId) ?? metrics[0]
  const fact = metric?.facts.find(row => row.factId === factId) ?? metric?.facts[0]
  return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}>
    <header data-paimind-trace-header><h2>{snapshot.selection.title}</h2><div data-paimind-trace-meta><span>{snapshot.selection.sessionId}</span><span data-paimind-trace-badge>{statusCopy(trace.document.reviewStatus, zh)}</span><span>{zh ? `第 ${slideIndex + 1} / ${trace.document.slides.length} 页` : `Slide ${slideIndex + 1} / ${trace.document.slides.length}`}</span></div></header>
    <section data-paimind-trace-section><h3>{zh ? '页面' : 'Slides'}</h3><div data-paimind-trace-scroll>{trace.document.slides.map((row, index) => <button key={row.slideId} type="button" data-paimind-trace-button aria-pressed={index === slideIndex} onClick={() => { setSlideIndex(index); setBlockId(''); setMetricId(''); setFactId(''); setDetail('business') }}>{index + 1}. {row.explanation}</button>)}</div></section>
    <section data-paimind-trace-section><h3>{zh ? '业务区块' : 'Business Blocks'}</h3><div data-paimind-trace-scroll>{slide.businessBlocks.map(block => <button key={block.blockId} type="button" data-paimind-trace-button aria-pressed={block.blockId === activeBlock?.blockId} onClick={() => { setBlockId(block.blockId); setMetricId(''); setFactId(''); setDetail('business') }}>{block.label}</button>)}</div></section>
    <section data-paimind-trace-section><h3>{zh ? '指标事实' : 'Metric Facts'}</h3><div data-paimind-trace-scroll>{metrics.map(row => <button key={row.metricId} type="button" data-paimind-trace-button aria-pressed={row.metricId === metric?.metricId} onClick={() => { setMetricId(row.metricId); setFactId(''); setDetail('business') }}>{row.label} · {row.facts.length}</button>)}</div>{metric !== undefined && metric.facts.length > 1 && <MetricFacts metric={metric} selectedId={fact?.factId ?? ''} zh={zh} onSelect={row => { setFactId(row.factId); setDetail('business') }} />}</section>
    {fact !== undefined && <section data-paimind-trace-section><h3>{detail === 'business' ? (zh ? '业务证据' : 'Business Evidence') : (zh ? '技术追溯' : 'Technical Trace')}</h3>{detail === 'business' ? <BusinessSheet fact={fact} document={trace.document} zh={zh} onTechnical={() => { setDetail('technical') }} /> : <TechnicalSheet fact={fact} zh={zh} onBusiness={() => { setDetail('business') }} />}</section>}
    <section data-paimind-trace-section><h3>{zh ? '已登记来源' : 'Registered Sources'}</h3><ul data-paimind-trace-list>{trace.document.sources.map(source => <li key={source.id} data-paimind-trace-row><strong>{source.name}</strong><span>{source.format}{source.version ? ` · ${source.version}` : ''}{source.size ? ` · ${source.size}` : ''}</span><p>{source.role}</p></li>)}</ul></section>
  </section>
}

class TraceErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-presentation-trace]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export function apply(ctx: PresentationTraceClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:presentation-trace',
    packageName: '@paimind/presentation-trace',
    category: 'content-rendering',
    nameZh: '演示追溯',
    nameEn: 'Presentation Trace',
    descriptionZh: '关联产物的数据来源、计算逻辑、代码与运行证据。',
    descriptionEn: 'Links artifacts to sources, calculations, code, and runtime evidence.',
    surface: 'side-card',
    maturity: 'technical-preview',
    order: 30,
  })
  ctx.effect(() => installStyle(), 'paimind-presentation-trace: style')
  ctx.effect(() => {
    const registry = new PresentationTraceRegistry()
    const projected = new HarnessProjectedPresentationTraceSource(ctx.sessions)
    const offProjected = registry.registerSource(projected)
    const qaEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('paimindTracePreview') === '1'
    const offQa = qaEnabled ? registry.registerSource(qaSource()) : () => {}
    const disposeService = ctx.reflect.provide('paimindPresentationTrace', registry)
    const disposeTab = ctx.paimindSidebar.registerTab({ id: 'paimind:presentation-trace', titleZh: '演示追溯', titleEn: 'Presentation Trace', order: 53, single: true, icon: <TraceIcon />, render: scope => <TraceErrorBoundary><PresentationTracePanel service={registry} bento={ctx.paimindBentoPreview} scope={scope} /></TraceErrorBoundary> })
    const disposeAction = ctx.paimindArtifacts.registerAction({
      id: 'paimind:presentation-trace', labelZh: '追溯', labelEn: 'Trace', supports: artifact => artifact.traceId !== undefined,
      run: artifact => {
        if (!registry.selectArtifact(artifact)) {
          return { state: 'failed', messageZh: '这个产物没有可用的结构化追溯记录。', messageEn: 'This artifact has no available structured trace.' }
        }
        return ctx.paimindSidebar.openTab('paimind:presentation-trace')
          ? { state: 'opened' }
          : { state: 'failed', messageZh: '演示追溯已在侧栏设置中停用。', messageEn: 'Presentation Trace is disabled in the side card settings.' }
      },
    })
    return () => { disposeAction(); disposeTab(); void disposeService(); offQa(); offProjected(); projected.dispose(); registry.dispose() }
  }, 'paimind-presentation-trace: service, action and tab')
}
