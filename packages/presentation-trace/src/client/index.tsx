import {
  Component,
  useEffect,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { contributePaimindExtension, type HarnessSessionService, type PaimindClientContext } from '@hansen/harness-compat'
import { resolveArtifactPath, type PaimindArtifactService } from '@hansen/artifacts'
import type { PaimindSidebarService, PaimindSidebarTabScope } from '@hansen/better-sidebar-adapter'
import type { PaimindBentoPreviewService } from '@hansen/renderer-bento'
import type { PaimindWorkspaceProjectService } from '@hansen/workspace-project'
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
} from '../shared.js'

export const inject = ['slots', 'sessions', 'paimindArtifacts', 'paimindSidebar', 'paimindBentoPreview', 'paimindWorkspaceProject', 'locale']

export interface PresentationTraceClientContext extends PaimindClientContext {
  readonly sessions: HarnessSessionService
  readonly paimindArtifacts: PaimindArtifactService
  readonly paimindSidebar: PaimindSidebarService
  readonly paimindBentoPreview: PaimindBentoPreviewService
  readonly paimindWorkspaceProject: PaimindWorkspaceProjectService
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

const STYLE_ID = '@hansen/presentation-trace'
const STYLE = `
[data-paimind-trace] { --paimind-trace-accent:var(--dsw-alias-state-business-primary,#2f6df6); --paimind-trace-surface:var(--dsw-alias-bg-layer-1,#fff); --paimind-trace-surface-subtle:var(--dsw-alias-bg-layer-2,#f5f7fa); --paimind-trace-surface-raised:var(--dsw-alias-bg-layer-3,#eef2f7); --paimind-trace-border:var(--dsw-alias-border-l1,#dce3ec); --paimind-trace-ink:var(--dsw-alias-label-primary,#142944); --paimind-trace-muted:var(--dsw-alias-label-secondary,#61738a); --paimind-trace-faint:var(--dsw-alias-label-tertiary,#7a8ca4); width:100%; height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; overflow:hidden; isolation:isolate; container-name:paimind-trace-panel; container-type:inline-size; color:var(--paimind-trace-ink); background:var(--paimind-trace-surface-subtle); color-scheme:light dark; font:inherit; }
[data-paimind-trace] h2,[data-paimind-trace] h3,[data-paimind-trace] h4,[data-paimind-trace] p { margin:0; }
[data-paimind-trace] button:focus-visible { outline:2px solid color-mix(in srgb,var(--paimind-trace-accent) 72%,#fff); outline-offset:2px; }
[data-paimind-trace-nav] { flex:0 0 auto; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; padding:10px 12px; border-bottom:1px solid var(--paimind-trace-border); background:var(--paimind-trace-surface); }
[data-paimind-trace-nav] button { min-width:0; min-height:44px; display:flex; align-items:center; justify-content:center; gap:7px; padding:8px 7px; border:1px solid var(--paimind-trace-border); border-radius:11px; color:var(--paimind-trace-muted); background:var(--paimind-trace-surface-subtle); font:inherit; cursor:pointer; transition:border-color .16s ease,background .16s ease,color .16s ease,transform .16s ease,box-shadow .16s ease; }
[data-paimind-trace-nav] button span { width:20px; height:20px; display:grid; place-items:center; flex:0 0 auto; border-radius:99px; color:var(--paimind-trace-faint); background:var(--paimind-trace-surface-raised); font-size:8px; line-height:11px; font-weight:750; letter-spacing:.04em; }
[data-paimind-trace-nav] button strong { overflow:hidden; font-size:11px; line-height:15px; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-trace-nav] button:hover:not(:disabled) { border-color:color-mix(in srgb,var(--paimind-trace-accent) 58%,var(--paimind-trace-border)); transform:translateY(-1px); }
[data-paimind-trace-nav] button[aria-current='page'] { border-color:var(--paimind-trace-accent); color:var(--dsw-alias-label-primary-inverted,#fff); background:var(--paimind-trace-accent); box-shadow:0 8px 18px color-mix(in srgb,var(--paimind-trace-accent) 22%,transparent),inset 0 1px 0 color-mix(in srgb,#fff 28%,transparent); }
[data-paimind-trace-nav] button[aria-current='page'] span { color:var(--paimind-trace-accent); background:var(--dsw-alias-label-primary-inverted,#fff); }
[data-paimind-trace-nav] button:disabled { opacity:.38; cursor:not-allowed; }
[data-paimind-trace-page] { min-height:0; flex:1 1 auto; display:flex; flex-direction:column; padding:17px 16px 24px; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
[data-paimind-trace-section] { display:grid; gap:9px; padding:15px 0; }
[data-paimind-trace-section] + [data-paimind-trace-section] { border-top:1px solid var(--paimind-trace-border); }
[data-paimind-trace-section] h3 { color:var(--paimind-trace-muted); font-size:10px; line-height:15px; font-weight:750; text-transform:uppercase; letter-spacing:.11em; }
[data-paimind-trace-section] > p { color:var(--paimind-trace-muted); font-size:12px; line-height:18px; }
[data-paimind-trace-grid],[data-paimind-trace-list] { display:grid; grid-template-columns:minmax(0,1fr); gap:8px; margin:0; padding:0; list-style:none; }
[data-page='directory'] { gap:12px; }
[data-page='directory'] [data-paimind-trace-section] { padding:0; }
[data-paimind-trace-category] { min-width:0; min-height:108px; display:grid; align-content:start; gap:6px; padding:15px; border:1px solid var(--paimind-trace-border); border-radius:14px; color:var(--paimind-trace-ink); background:var(--paimind-trace-surface); box-shadow:0 8px 24px color-mix(in srgb,var(--paimind-trace-ink) 4%,transparent); font:inherit; text-align:left; cursor:pointer; transition:border-color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease; }
[data-paimind-trace-category]:hover { border-color:color-mix(in srgb,var(--paimind-trace-accent) 55%,var(--paimind-trace-border)); transform:translateY(-1px); box-shadow:0 11px 28px color-mix(in srgb,var(--paimind-trace-accent) 10%,transparent); }
[data-paimind-trace-category] strong { font-size:14px; line-height:20px; letter-spacing:-.01em; }
[data-paimind-trace-category] p { color:var(--paimind-trace-muted); font-size:11px; line-height:16px; }
[data-paimind-trace-category] span { margin-top:auto; color:var(--paimind-trace-accent); font-size:10px; line-height:14px; font-weight:750; letter-spacing:.07em; text-transform:uppercase; }
[data-paimind-trace-context] { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px 13px; border:1px solid color-mix(in srgb,var(--paimind-trace-accent) 38%,var(--paimind-trace-border)); border-radius:12px; background:color-mix(in srgb,var(--paimind-trace-accent) 8%,var(--paimind-trace-surface)); }
[data-paimind-trace-context] div { min-width:0; display:grid; gap:2px; text-align:right; }
[data-paimind-trace-context] strong { overflow:hidden; color:var(--paimind-trace-ink); font-size:12px; line-height:17px; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-trace-context] span { color:var(--paimind-trace-faint); font-size:10px; line-height:14px; }
[data-paimind-trace-button],[data-paimind-trace-row] { min-width:0; min-height:44px; padding:11px 12px; border:1px solid var(--paimind-trace-border); border-radius:11px; color:var(--paimind-trace-ink); background:var(--paimind-trace-surface); font:inherit; cursor:pointer; text-align:left; transition:border-color .16s ease,background .16s ease,color .16s ease,transform .16s ease,box-shadow .16s ease; }
[data-paimind-trace-button] { font-size:12px; line-height:18px; }
[data-paimind-trace-button][aria-pressed='true'] { border-color:var(--paimind-trace-accent); background:color-mix(in srgb,var(--paimind-trace-accent) 10%,var(--paimind-trace-surface)); box-shadow:inset 3px 0 0 var(--paimind-trace-accent),0 6px 16px color-mix(in srgb,var(--paimind-trace-accent) 8%,transparent); }
[data-paimind-trace-button]:hover,[data-paimind-trace-row]:hover { border-color:color-mix(in srgb,var(--paimind-trace-accent) 55%,var(--paimind-trace-border)); transform:translateY(-1px); }
[data-paimind-trace-row] { display:grid; gap:4px; }
button[data-paimind-trace-row] { width:100%; }
[data-paimind-trace-row] strong { color:var(--paimind-trace-ink); font-size:12px; line-height:18px; }
[data-paimind-trace-row] span,[data-paimind-trace-row] p { color:var(--paimind-trace-faint); font-size:11px; line-height:16px; overflow-wrap:anywhere; }
[data-paimind-trace-group] { display:grid; gap:7px; }
[data-paimind-trace-group] + [data-paimind-trace-group] { margin-top:5px; }
[data-paimind-trace-group-label] { color:var(--paimind-trace-faint); font-size:10px; line-height:14px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
[data-paimind-trace-more] { min-height:42px; padding:9px 12px; border:1px dashed color-mix(in srgb,var(--paimind-trace-accent) 48%,var(--paimind-trace-border)); border-radius:11px; color:var(--paimind-trace-accent); background:color-mix(in srgb,var(--paimind-trace-accent) 5%,var(--paimind-trace-surface)); font:inherit; font-size:11px; line-height:16px; font-weight:700; cursor:pointer; }
[data-paimind-trace-sheet] { display:grid; gap:12px; align-content:start; }
[data-paimind-trace-field] { min-width:0; display:grid; align-content:start; gap:5px; padding:12px 13px; border:1px solid var(--paimind-trace-border); border-radius:11px; background:var(--paimind-trace-surface); }
[data-paimind-trace-field] dt { color:var(--paimind-trace-faint); font-size:10px; line-height:15px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
[data-paimind-trace-field] dd { margin:0; color:var(--paimind-trace-ink); font-size:12px; line-height:18px; overflow-wrap:anywhere; white-space:pre-line; }
[data-paimind-trace-value] { min-height:90px; display:grid; align-content:center; gap:3px; padding:16px; border:1px solid color-mix(in srgb,var(--paimind-trace-accent) 48%,var(--paimind-trace-border)); border-radius:14px; color:var(--paimind-trace-ink); background:color-mix(in srgb,var(--paimind-trace-accent) 12%,var(--paimind-trace-surface)); font-size:28px; line-height:34px; font-weight:750; box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 8%,transparent); }
[data-paimind-trace-value] span { color:var(--paimind-trace-accent); font-size:10px; line-height:14px; font-weight:750; letter-spacing:.1em; text-transform:uppercase; }
[data-paimind-trace-back] { justify-self:start; min-height:36px; border:0; padding:6px 0; color:var(--paimind-trace-accent); background:transparent; font:inherit; font-size:11px; font-weight:700; line-height:16px; cursor:pointer; }
[data-paimind-trace-cta] { width:100%; min-height:44px; border:0; border-radius:11px; color:var(--dsw-alias-label-primary-inverted,#fff); background:var(--paimind-trace-accent); box-shadow:0 8px 18px color-mix(in srgb,var(--paimind-trace-accent) 24%,transparent),inset 0 1px 0 color-mix(in srgb,#fff 25%,transparent); font:inherit; font-size:12px; font-weight:750; cursor:pointer; transition:background .16s ease,transform .16s ease; }
[data-paimind-trace-cta]:hover { background:var(--dsw-alias-button-primary-hover,var(--paimind-trace-accent)); transform:translateY(-1px); }
[data-paimind-trace-business-hero],[data-paimind-trace-business-fields],[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-list],[data-paimind-trace-sheet][data-layout='technical'] dl[data-paimind-trace-sheet] { display:grid; grid-template-columns:minmax(0,1fr); gap:9px; }
[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-section] { gap:8px; padding:10px 0; }
[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-row] { cursor:default; }
[data-paimind-trace-empty],[data-paimind-trace-error] { padding:20px 14px; color:var(--paimind-trace-faint); font-size:12px; line-height:19px; text-align:center; }
[data-paimind-trace-error] { color:var(--dsw-alias-state-error-primary,#d04444); }
@container paimind-trace-panel (min-width:720px){[data-paimind-trace-page]{padding:19px 18px 26px}[data-paimind-trace-business-hero]{grid-template-columns:minmax(148px,.72fr) minmax(0,1.28fr)}[data-paimind-trace-business-fields],[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-list],[data-paimind-trace-sheet][data-layout='technical'] dl[data-paimind-trace-sheet]{grid-template-columns:repeat(2,minmax(0,1fr))}[data-paimind-trace-business-fields] [data-paimind-trace-field]:last-child{grid-column:1/-1}[data-page='directory'] [data-paimind-trace-grid]{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container paimind-trace-panel (max-width:430px){[data-paimind-trace-nav] button{gap:3px}[data-paimind-trace-nav] button span{display:none}[data-paimind-trace-page]{padding-inline:12px}[data-paimind-trace-context]{align-items:stretch;flex-direction:column}[data-paimind-trace-context] div{text-align:left}}
@media(prefers-reduced-motion:reduce){[data-paimind-trace] *,[data-paimind-trace] *::before,[data-paimind-trace] *::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style'); style.id = STYLE_ID; style.dataset.paimindPlugin = '@hansen/presentation-trace'; style.textContent = STYLE; document.head.append(style)
  return () => { style.remove() }
}

const missing = (zh: boolean): string => zh ? '未登记' : 'Not registered'

type TracePage = 'directory' | 'business' | 'technical'

interface DirectoryFactEntry {
  readonly metric: PaimindTraceMetric
  readonly fact: PaimindTraceFact
  readonly groupLabel: string
}

function priorityDirectoryFacts(entries: readonly DirectoryFactEntry[], limit = 4): readonly DirectoryFactEntry[] {
  if (entries.length <= limit) return entries
  const groups = new Map<string, DirectoryFactEntry[]>()
  for (const entry of entries) groups.set(entry.groupLabel, [...(groups.get(entry.groupLabel) ?? []), entry])
  const prioritized: DirectoryFactEntry[] = []
  let depth = 0
  while (prioritized.length < limit) {
    let added = false
    for (const group of groups.values()) {
      const entry = group[depth]
      if (entry === undefined) continue
      prioritized.push(entry); added = true
      if (prioritized.length === limit) break
    }
    if (!added) break
    depth += 1
  }
  return prioritized
}

function groupDirectoryFacts(entries: readonly DirectoryFactEntry[]): readonly { readonly label: string; readonly entries: readonly DirectoryFactEntry[] }[] {
  const groups = new Map<string, DirectoryFactEntry[]>()
  for (const entry of entries) groups.set(entry.groupLabel, [...(groups.get(entry.groupLabel) ?? []), entry])
  return [...groups].map(([label, groupedEntries]) => ({ label, entries: groupedEntries }))
}

function TracePageNav(props: { readonly page: TracePage; readonly hasFact: boolean; readonly zh: boolean; readonly onNavigate: (page: TracePage) => void }): React.JSX.Element {
  const rows: readonly { readonly page: TracePage; readonly step: string; readonly en: string; readonly zh: string }[] = [
    { page: 'directory', step: '01', en: 'Directory', zh: '目录' },
    { page: 'business', step: '02', en: 'Business', zh: '业务溯源' },
    { page: 'technical', step: '03', en: 'Technical', zh: '技术溯源' },
  ]
  return <nav data-paimind-trace-nav aria-label={props.zh ? '溯源页面' : 'Trace pages'}>{rows.map(row => <button key={row.page} type="button" aria-current={props.page === row.page ? 'page' : undefined} disabled={row.page !== 'directory' && !props.hasFact} onClick={() => { props.onNavigate(row.page) }}><span>{row.step}</span><strong>{props.zh ? row.zh : row.en}</strong></button>)}</nav>
}

function BusinessSheet(props: { readonly fact: PaimindTraceFact; readonly document: PaimindPresentationTraceDocument; readonly zh: boolean; readonly onDirectory: () => void; readonly onTechnical: () => void }): React.JSX.Element {
  const sources = props.document.sources.filter(source => props.fact.sourceIds.includes(source.id))
  const sourceSummary = sources.map(source => `${source.name} · ${source.role}${source.sha256 ? ` · SHA-256 ${source.sha256.slice(0, 12)}…` : ''}`).join('\n') || missing(props.zh)
  return <div data-paimind-trace-sheet data-layout="business">
    <button type="button" data-paimind-trace-back onClick={props.onDirectory}>{props.zh ? '返回指标' : 'Back to metrics'}</button>
    <div data-paimind-trace-business-hero>
      <div data-paimind-trace-value><span>{props.zh ? '已验证事实' : 'Verified fact'}</span>{props.fact.displayValue}</div>
      <div data-paimind-trace-field data-field="source" title={sourceSummary}><dt>{props.zh ? '来源文件' : 'Source files'}</dt><dd>{sourceSummary}</dd></div>
    </div>
    <dl data-paimind-trace-business-fields>
      <div data-paimind-trace-field><dt>{props.zh ? '结论定义' : 'Conclusion definition'}</dt><dd>{props.fact.business.definition ?? props.fact.business.explanation}</dd></div>
      <div data-paimind-trace-field><dt>{props.zh ? '公式与方法定义' : 'Formula & method definition'}</dt><dd>{props.fact.technical?.definition ?? props.fact.technical?.calculation ?? missing(props.zh)}</dd></div>
      <div data-paimind-trace-field><dt>{props.zh ? '范围' : 'Scope'}</dt><dd>{props.fact.business.scope.period} · {props.fact.business.scope.filters.join(' · ')}</dd></div>
    </dl>
    <button type="button" data-paimind-trace-cta onClick={props.onTechnical}>{props.zh ? '查看技术追溯' : 'View technical trace'}</button>
  </div>
}

function TechnicalSheet(props: { readonly fact: PaimindTraceFact; readonly zh: boolean; readonly onBusiness: () => void }): React.JSX.Element {
  const technical = props.fact.technical
  return <div data-paimind-trace-sheet data-layout="technical">
    <button type="button" data-paimind-trace-back onClick={props.onBusiness}>{props.zh ? '返回业务溯源' : 'Back to business trace'}</button>
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
  const [page, setPage] = useState<TracePage>('directory')
  const [showAllFacts, setShowAllFacts] = useState(false)
  useEffect(() => { setSlideIndex(0); setBlockId(''); setMetricId(''); setFactId(''); setPage('directory'); setShowAllFacts(false) }, [snapshot.selection?.traceId, snapshot.selection?.artifactId])
  useEffect(() => {
    const event = bento.runtimeEvent; const request = bento.request; const selection = snapshot.selection
    if (trace === null || event === null || request === null || selection === null) return
    if (request.sessionId !== selection.sessionId || request.workspaceId !== selection.workspaceId || request.path !== selection.path) return
    const nextSlideIndex = event.slideId === undefined ? event.slide - 1 : trace.document.slides.findIndex(slide => slide.slideId === event.slideId)
    if (nextSlideIndex >= 0 && nextSlideIndex < trace.document.slides.length) {
      const slideChanged = nextSlideIndex !== slideIndex
      setSlideIndex(nextSlideIndex)
      if (event.type !== 'paimind:bento-select') {
        if (slideChanged) { setBlockId(''); setMetricId(''); setFactId(''); setPage('directory'); setShowAllFacts(false) }
        return
      }
      const slide = trace.document.slides[nextSlideIndex]
      const binding = slide?.visualBindings.find(row => row.objectId === event.objectId)?.factBindings.find(row => row.factId === event.factId && JSON.stringify(row.selector) === JSON.stringify(event.selector))
      const metric = binding === undefined ? undefined : slide?.metrics.find(row => row.facts.some(fact => fact.factId === binding.factId))
      if (binding !== undefined && metric !== undefined) {
        setBlockId(metric.businessBlockId); setMetricId(metric.metricId); setFactId(binding.factId); setPage('business')
      }
    }
  }, [bento.runtimeEvent, slideIndex, snapshot.selection, trace])
  if (snapshot.selection === null) return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}><div data-paimind-trace-empty>{zh ? '请从 产物中选择“追溯”。' : 'Choose Trace from a artifact.'}</div></section>
  if (trace === null) return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}><div role="alert" data-paimind-trace-error>{zh ? '关联的追溯记录不可用；原生预览与会话不受影响。' : 'The associated trace is unavailable; native preview and conversation remain available.'}</div></section>
  const slide = trace.document.slides[Math.min(slideIndex, trace.document.slides.length - 1)] as PaimindTraceSlide
  const hasCategoryDirectory = slide.businessBlocks.length > 1
  const activeBlock = slide.businessBlocks.find(block => block.blockId === blockId)
    ?? (hasCategoryDirectory ? undefined : slide.businessBlocks[0])
  const metrics = slide.metrics.filter(metric => metric.businessBlockId === activeBlock?.blockId)
  const metric = slide.metrics.find(row => row.metricId === metricId)
  const fact = metric?.facts.find(row => row.factId === factId)
  const allDirectoryFacts = metrics.flatMap(row => row.facts.map(rowFact => ({ metric: row, fact: rowFact, groupLabel: row.label })))
  const directoryFacts = showAllFacts ? allDirectoryFacts : priorityDirectoryFacts(allDirectoryFacts)
  const directoryFactGroups = groupDirectoryFacts(directoryFacts)
  const focusFact = (targetSlide: PaimindTraceSlide, targetFactId: string): void => {
    const targetSlideIndex = trace.document.slides.findIndex(row => row.slideId === targetSlide.slideId)
    if (targetSlideIndex >= 0) props.bento.navigate({ slideId: targetSlide.slideId, slide: targetSlideIndex + 1 })
    for (const visual of targetSlide.visualBindings) {
      const binding = visual.factBindings.find(row => row.factId === targetFactId)
      if (binding !== undefined) { props.bento.focus({ slideId: targetSlide.slideId, objectId: visual.objectId, selector: binding.selector.kind === 'chart-point' ? { kind: 'chart-point', seriesKey: binding.selector.seriesKey ?? '', categoryKey: binding.selector.categoryKey ?? '' } : binding.selector.kind === 'table-cell' ? { kind: 'table-cell', rowKey: binding.selector.rowKey ?? '', columnKey: binding.selector.columnKey ?? '' } : { kind: 'object' } }); return }
    }
  }
  const selectFact = (targetMetric: PaimindTraceMetric, targetFact: PaimindTraceFact): void => {
    setBlockId(targetMetric.businessBlockId); setMetricId(targetMetric.metricId); setFactId(targetFact.factId); setPage('business'); focusFact(slide, targetFact.factId)
  }
  return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}>
    <TracePageNav page={page} hasFact={fact !== undefined} zh={zh} onNavigate={setPage} />
    {page === 'directory' && <main data-paimind-trace-page data-page="directory">
      {activeBlock === undefined ? <section data-paimind-trace-section><h3>{zh ? '证据分类' : 'Evidence Categories'}</h3><div data-paimind-trace-grid>{slide.businessBlocks.map(block => {
        const blockMetrics = slide.metrics.filter(row => row.businessBlockId === block.blockId)
        const blockFactCount = blockMetrics.reduce((total, row) => total + row.facts.length, 0)
        return <button key={block.blockId} type="button" data-paimind-trace-category onClick={() => { setBlockId(block.blockId); setMetricId(''); setFactId(''); setShowAllFacts(false) }}><strong>{block.label}</strong><p>{block.description}</p><span>{zh ? `${blockMetrics.length} 个指标 · ${blockFactCount} 条事实` : `${blockMetrics.length} ${blockMetrics.length === 1 ? 'metric' : 'metrics'} · ${blockFactCount} ${blockFactCount === 1 ? 'fact' : 'facts'}`}</span></button>
      })}</div></section> : <>
        {hasCategoryDirectory && <div data-paimind-trace-context><button type="button" data-paimind-trace-back onClick={() => { setBlockId(''); setMetricId(''); setFactId(''); setShowAllFacts(false) }}>{zh ? '返回分类' : 'Back to categories'}</button><div><strong>{activeBlock.label}</strong><span>{zh ? `${metrics.length} 个指标 · ${allDirectoryFacts.length} 条事实` : `${metrics.length} ${metrics.length === 1 ? 'metric' : 'metrics'} · ${allDirectoryFacts.length} ${allDirectoryFacts.length === 1 ? 'fact' : 'facts'}`}</span></div></div>}
        <section data-paimind-trace-section><h3>{zh ? '指标与事实' : 'Metrics & Facts'}</h3>{directoryFactGroups.map(group => <div key={group.label} data-paimind-trace-group><span data-paimind-trace-group-label>{group.label}</span><ul data-paimind-trace-list>{group.entries.map(entry => <li key={entry.fact.factId}><button type="button" data-paimind-trace-row onClick={() => { selectFact(entry.metric, entry.fact) }}><strong>{entry.fact.displayValue}</strong><span>{entry.fact.dimensions.map(dimension => dimension.value).join(' · ') || entry.fact.business.scope.period}</span></button></li>)}</ul></div>)}{allDirectoryFacts.length > 4 && <button type="button" data-paimind-trace-more aria-expanded={showAllFacts} onClick={() => { setShowAllFacts(value => !value) }}>{showAllFacts ? (zh ? '仅显示重点事实' : 'Show priority facts') : (zh ? `查看全部 ${allDirectoryFacts.length} 条事实` : `View all ${allDirectoryFacts.length} facts`)}</button>}</section>
      </>}
    </main>}
    {page === 'business' && fact !== undefined && <main data-paimind-trace-page data-page="business">
      <BusinessSheet fact={fact} document={trace.document} zh={zh} onDirectory={() => { setPage('directory') }} onTechnical={() => { setPage('technical') }} />
    </main>}
    {page === 'technical' && fact !== undefined && <main data-paimind-trace-page data-page="technical">
      <TechnicalSheet fact={fact} zh={zh} onBusiness={() => { setPage('business') }} />
    </main>}
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
    packageName: '@hansen/presentation-trace',
    category: 'content-rendering',
    nameZh: '演示追溯',
    nameEn: 'Presentation Trace',
    descriptionZh: '关联产物的数据来源、计算逻辑、代码与运行证据。',
    descriptionEn: 'Links artifacts to sources, calculations, code, and runtime evidence.',
    surface: 'preview',
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
    const disposeInspector = ctx.paimindBentoPreview.registerInspector({
      id: 'paimind:presentation-trace',
      activate: request => {
        if (request.artifactId === undefined || request.artifactSourceId === undefined || request.traceId === undefined) return false
        const project = ctx.paimindWorkspaceProject.getSnapshot().projects.find(row => (
          row.workspaceId === request.workspaceId
          && row.sessionIds.includes(request.sessionId)
          && row.path === request.cwd
        ))
        if (project === undefined) return false
        const requestedPath = resolveArtifactPath(project.path, request.path)
        if (requestedPath.state !== 'safe') return false
        const artifact = ctx.paimindArtifacts.getSnapshot().artifacts.find(row =>
          row.id === request.artifactId
          && row.sourceId === request.artifactSourceId
          && row.traceId === request.traceId
          && row.sessionId === request.sessionId
          && row.workspaceId === request.workspaceId
          && (() => {
            const artifactPath = resolveArtifactPath(project.path, row.path)
            return artifactPath.state === 'safe' && artifactPath.path === requestedPath.path
          })(),
        )
        return artifact !== undefined && registry.selectArtifact(artifact)
      },
      getSlideNavigation: () => {
        const trace = selectedPresentationTrace(registry.getSnapshot())
        return trace === null ? null : Object.freeze({ slides: Object.freeze(trace.document.slides.map(slide => Object.freeze({ slideId: slide.slideId, title: slide.explanation }))) })
      },
      render: scope => <TraceErrorBoundary><PresentationTracePanel service={registry} bento={ctx.paimindBentoPreview} scope={scope} /></TraceErrorBoundary>,
    })
    const disposeAction = ctx.paimindArtifacts.registerAction({
      id: 'paimind:presentation-trace', labelZh: '追溯', labelEn: 'Trace', supports: artifact => artifact.traceId !== undefined,
      run: artifact => {
        if (!registry.selectArtifact(artifact)) {
          return { state: 'failed', messageZh: '这个产物没有可用的结构化追溯记录。', messageEn: 'This artifact has no available structured trace.' }
        }
        const cwd = ctx.paimindWorkspaceProject.getSnapshot().projects.find(project => project.workspaceId === artifact.workspaceId)?.path
        if (cwd === undefined || !ctx.paimindBentoPreview.open({
          sessionId: artifact.sessionId,
          workspaceId: artifact.workspaceId,
          cwd,
          path: artifact.path,
          title: artifact.title,
          artifactSourceId: artifact.sourceId,
          artifactId: artifact.id,
          ...(artifact.traceId === undefined ? {} : { traceId: artifact.traceId }),
        }) || !ctx.paimindBentoPreview.setMode('trace')) {
          return { state: 'failed', messageZh: 'Bento 工作台或会话工作区不可用。', messageEn: 'The Bento workbench or Session Workspace is unavailable.' }
        }
        return { state: 'opened' }
      },
    })
    return () => { disposeAction(); disposeInspector(); void disposeService(); offQa(); offProjected(); projected.dispose(); registry.dispose() }
  }, 'paimind-presentation-trace: service, action and workbench inspector')
}
