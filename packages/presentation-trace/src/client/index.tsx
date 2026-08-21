import {
  Component,
  useEffect,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { contributePaimindExtension, type HarnessSessionService, type PaimindClientContext } from '@paimind/harness-compat'
import { resolveArtifactPath, type PaimindArtifactService } from '@paimind/artifacts'
import type { PaimindSidebarService, PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'
import type { PaimindBentoPreviewService } from '@paimind/renderer-bento'
import type { PaimindWorkspaceProjectService } from '@paimind/workspace-project'
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

const STYLE_ID = '@paimind/presentation-trace'
const STYLE = `
[data-paimind-trace] { --paimind-trace-accent:var(--dsw-alias-state-business-primary,#2f6df6); --paimind-trace-surface:var(--dsw-alias-bg-layer-1,#fff); --paimind-trace-surface-subtle:var(--dsw-alias-bg-layer-2,#f5f7fa); --paimind-trace-surface-raised:var(--dsw-alias-bg-layer-3,#eef2f7); --paimind-trace-border:var(--dsw-alias-border-l1,#dce3ec); --paimind-trace-ink:var(--dsw-alias-label-primary,#142944); --paimind-trace-muted:var(--dsw-alias-label-secondary,#61738a); --paimind-trace-faint:var(--dsw-alias-label-tertiary,#7a8ca4); width:100%; height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; overflow:hidden; color:var(--paimind-trace-ink); background:var(--paimind-trace-surface-subtle); color-scheme:light dark; font:inherit; }
[data-paimind-trace] h2,[data-paimind-trace] h3,[data-paimind-trace] p { margin:0; }
[data-paimind-trace-header] { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:17px 16px 14px; border-bottom:1px solid var(--paimind-trace-border); background:var(--paimind-trace-surface); }
[data-paimind-trace-title] { min-width:0; display:grid; gap:4px; }
[data-paimind-trace-eyebrow] { color:var(--paimind-trace-accent); font-size:8px; line-height:12px; font-weight:750; letter-spacing:.13em; text-transform:uppercase; }
[data-paimind-trace-header] h2 { overflow:hidden; font-size:15px; line-height:20px; letter-spacing:-.02em; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-trace-meta] { flex:0 0 auto; display:flex; align-items:center; gap:6px; color:var(--paimind-trace-faint); font-size:9px; line-height:15px; white-space:nowrap; }
[data-paimind-trace-badge] { padding:2px 7px; border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#27946b) 42%,var(--paimind-trace-border)); border-radius:99px; color:var(--dsw-alias-state-success-primary,#27946b); background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#27946b) 10%,var(--paimind-trace-surface)); font-weight:650; }
[data-paimind-trace-nav] { flex:0 0 auto; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; padding:10px 12px; border-bottom:1px solid var(--paimind-trace-border); background:var(--paimind-trace-surface); }
[data-paimind-trace-nav] button { min-width:0; min-height:46px; display:flex; align-items:center; justify-content:center; gap:6px; padding:7px 5px; border:1px solid var(--paimind-trace-border); border-radius:11px; color:var(--paimind-trace-muted); background:var(--paimind-trace-surface-subtle); font:inherit; cursor:pointer; transition:border-color .16s ease,background .16s ease,color .16s ease,transform .16s ease; }
[data-paimind-trace-nav] button span { width:19px; height:19px; display:grid; place-items:center; flex:0 0 auto; border-radius:99px; color:var(--paimind-trace-faint); background:var(--paimind-trace-surface-raised); font-size:7px; line-height:10px; font-weight:750; letter-spacing:.04em; }
[data-paimind-trace-nav] button strong { overflow:hidden; font-size:9px; line-height:13px; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-trace-nav] button:hover:not(:disabled),[data-paimind-trace-nav] button:focus-visible { border-color:color-mix(in srgb,var(--paimind-trace-accent) 58%,var(--paimind-trace-border)); outline:none; transform:translateY(-1px); }
[data-paimind-trace-nav] button[aria-current='page'] { border-color:var(--paimind-trace-accent); color:var(--dsw-alias-label-primary-inverted,#fff); background:var(--paimind-trace-accent); box-shadow:0 7px 18px color-mix(in srgb,var(--paimind-trace-accent) 24%,transparent); }
[data-paimind-trace-nav] button[aria-current='page'] span { color:var(--paimind-trace-accent); background:var(--dsw-alias-label-primary-inverted,#fff); }
[data-paimind-trace-nav] button:disabled { opacity:.38; cursor:not-allowed; }
[data-paimind-trace-page] { min-height:0; flex:1 1 auto; padding:15px 14px 22px; overflow-x:hidden; overflow-y:auto; scrollbar-width:thin; }
[data-paimind-trace-page-head] { display:grid; gap:5px; padding:2px 2px 14px; }
[data-paimind-trace-page-head] span { color:var(--paimind-trace-accent); font-size:9px; line-height:14px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
[data-paimind-trace-page-head] h3 { font-size:19px; line-height:24px; letter-spacing:-.025em; }
[data-paimind-trace-page-head] p { max-width:40ch; color:var(--paimind-trace-faint); font-size:10px; line-height:16px; }
[data-paimind-trace-overview] { display:grid; gap:10px; margin-bottom:13px; padding:13px; border:1px solid var(--paimind-trace-border); border-radius:14px; background:var(--paimind-trace-surface); }
[data-paimind-trace-overview] > span { color:var(--paimind-trace-accent); font-size:8px; line-height:12px; font-weight:750; letter-spacing:.1em; text-transform:uppercase; }
[data-paimind-trace-overview] h4 { margin:0; font-size:13px; line-height:18px; letter-spacing:-.01em; }
[data-paimind-trace-overview-stats] { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
[data-paimind-trace-overview-stats] div { display:grid; gap:1px; padding:8px; border-radius:9px; background:var(--paimind-trace-surface-subtle); }
[data-paimind-trace-overview-stats] dt { color:var(--paimind-trace-faint); font-size:7px; line-height:11px; font-weight:650; text-transform:uppercase; letter-spacing:.07em; }
[data-paimind-trace-overview-stats] dd { margin:0; color:var(--paimind-trace-accent); font-size:15px; line-height:19px; font-weight:750; }
[data-paimind-trace-section] { display:grid; gap:8px; padding:11px 0; }
[data-paimind-trace-section] + [data-paimind-trace-section] { border-top:1px solid var(--paimind-trace-border); }
[data-paimind-trace-section] h3 { font-size:9px; line-height:15px; color:var(--paimind-trace-muted); text-transform:uppercase; letter-spacing:.1em; }
[data-paimind-trace-section] > p { color:var(--paimind-trace-muted); font-size:10px; line-height:16px; }
[data-paimind-trace-grid] { display:grid; gap:7px; }
[data-paimind-trace-button] { min-width:0; padding:10px; border:1px solid var(--paimind-trace-border); border-radius:10px; color:var(--paimind-trace-ink); background:var(--paimind-trace-surface); font:inherit; font-size:10px; line-height:15px; cursor:pointer; text-align:left; transition:border-color .16s ease,background .16s ease,color .16s ease,transform .16s ease; }
[data-paimind-trace-button][aria-pressed='true'] { border-color:var(--paimind-trace-accent); color:var(--paimind-trace-ink); background:color-mix(in srgb,var(--paimind-trace-accent) 10%,var(--paimind-trace-surface)); box-shadow:inset 3px 0 0 var(--paimind-trace-accent); }
[data-paimind-trace-button]:hover,[data-paimind-trace-button]:focus-visible,[data-paimind-trace-row]:hover,[data-paimind-trace-row]:focus-visible { border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6df6) 58%,transparent); outline:none; }
[data-paimind-trace-list] { display:grid; gap:6px; margin:0; padding:0; list-style:none; }
[data-paimind-trace-row] { display:grid; gap:3px; padding:10px; border:1px solid var(--paimind-trace-border); border-radius:11px; background:var(--paimind-trace-surface); }
button[data-paimind-trace-row] { width:100%; color:inherit; font:inherit; cursor:pointer; text-align:left; }
[data-paimind-trace-row] strong { font-size:10px; line-height:16px; color:var(--paimind-trace-ink); }
[data-paimind-trace-row] span,[data-paimind-trace-row] p { color:var(--paimind-trace-faint); font-size:9px; line-height:15px; overflow-wrap:anywhere; }
[data-paimind-trace-sheet] { display:grid; gap:11px; }
[data-paimind-trace-field] { display:grid; gap:4px; padding:11px; border:1px solid var(--paimind-trace-border); border-radius:11px; background:var(--paimind-trace-surface); }
[data-paimind-trace-field] dt { color:var(--dsw-alias-label-tertiary,#7a8ca4); font-size:8px; line-height:13px; text-transform:uppercase; letter-spacing:.08em; }
[data-paimind-trace-field] dd { margin:0; color:var(--paimind-trace-ink); font-size:10px; line-height:17px; overflow-wrap:anywhere; white-space:pre-line; }
[data-paimind-trace-value] { display:grid; gap:3px; padding:16px; border:1px solid color-mix(in srgb,var(--paimind-trace-accent) 44%,var(--paimind-trace-border)); border-radius:14px; color:var(--paimind-trace-ink); background:color-mix(in srgb,var(--paimind-trace-accent) 14%,var(--paimind-trace-surface)); font-size:26px; line-height:31px; font-weight:750; }
[data-paimind-trace-value] span { color:var(--paimind-trace-accent); font-size:8px; line-height:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
[data-paimind-trace-cta] { width:100%; min-height:40px; border:0; border-radius:10px; color:var(--dsw-alias-label-primary-inverted,#fff); background:var(--paimind-trace-accent); box-shadow:0 8px 18px color-mix(in srgb,var(--paimind-trace-accent) 28%,transparent); font:inherit; font-size:10px; font-weight:700; cursor:pointer; transition:background .16s ease,transform .16s ease; }
[data-paimind-trace-cta]:hover,[data-paimind-trace-cta]:focus-visible { background:var(--dsw-alias-button-primary-hover,var(--paimind-trace-accent)); outline:none; transform:translateY(-1px); }
[data-paimind-trace-back] { justify-self:start; border:0; padding:2px 0; color:var(--paimind-trace-accent); background:transparent; font:inherit; font-size:9px; font-weight:650; line-height:15px; cursor:pointer; }
[data-paimind-trace-empty],[data-paimind-trace-error] { padding:18px 12px; color:var(--dsw-alias-label-tertiary,#7a8ca4); font-size:11px; line-height:18px; text-align:center; }
[data-paimind-trace-error] { color:var(--dsw-alias-state-error-primary,#d04444); }
[data-paimind-trace-header] { align-items:center; padding:11px 14px 10px; background:color-mix(in srgb,var(--paimind-trace-surface) 96%,transparent); backdrop-filter:blur(18px); }
[data-paimind-trace-title] { gap:2px; }
[data-paimind-trace-header] h2 { font-size:14px; line-height:18px; }
[data-paimind-trace-nav] { gap:5px; padding:7px 10px; }
[data-paimind-trace-nav] button { min-height:36px; padding:5px 4px; border-radius:9px; }
[data-paimind-trace-nav] button span { width:17px; height:17px; }
[data-paimind-trace-nav] button[aria-current='page'] { box-shadow:0 6px 18px color-mix(in srgb,var(--paimind-trace-accent) 20%,transparent),inset 0 1px 0 color-mix(in srgb,#fff 30%,transparent); }
[data-paimind-trace-page] { display:flex; flex-direction:column; padding:10px 12px 11px; overflow:hidden; }
[data-paimind-trace-page-head] { flex:0 0 auto; gap:2px; padding:0 1px 8px; }
[data-paimind-trace-page-head] span { font-size:8px; line-height:12px; }
[data-paimind-trace-page-head] h3 { font-size:17px; line-height:21px; }
[data-paimind-trace-page-head] p { max-width:none; overflow:hidden; font-size:9px; line-height:14px; text-overflow:ellipsis; white-space:nowrap; }
[data-paimind-trace-page] > [data-paimind-trace-sheet] { flex:1 1 auto; min-height:0; }
[data-paimind-trace-sheet] { gap:7px; }
[data-paimind-trace-back] { font-size:8px; line-height:13px; }
[data-paimind-trace-value] { align-content:center; gap:1px; min-height:64px; padding:10px 12px; border-radius:12px; font-size:24px; line-height:28px; box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 8%,transparent); }
[data-paimind-trace-field] { align-content:start; gap:2px; min-width:0; padding:8px 9px; border-radius:9px; }
[data-paimind-trace-field] dt { font-size:7px; line-height:11px; }
[data-paimind-trace-field] dd { display:-webkit-box; overflow:hidden; font-size:9px; line-height:14px; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
[data-paimind-trace-field][data-field='source'] dd { -webkit-line-clamp:3; }
[data-paimind-trace-sheet][data-layout='business'] { grid-template-rows:auto auto minmax(0,1fr) auto; }
[data-paimind-trace-business-hero] { display:grid; grid-template-columns:minmax(88px,.62fr) minmax(0,1.38fr); gap:7px; }
[data-paimind-trace-business-fields] { min-height:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
[data-paimind-trace-business-fields] [data-paimind-trace-field]:last-child { grid-column:1/-1; }
[data-paimind-trace-cta] { min-height:34px; border-radius:9px; box-shadow:0 7px 16px color-mix(in srgb,var(--paimind-trace-accent) 22%,transparent),inset 0 1px 0 color-mix(in srgb,#fff 25%,transparent); }
[data-paimind-trace-sheet][data-layout='technical'] { align-content:start; }
[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-section] { gap:5px; padding:6px 0; }
[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-list] { grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-row] { gap:1px; padding:7px 8px; border-radius:9px; }
[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-row] strong { font-size:9px; line-height:13px; }
[data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-row] p { display:-webkit-box; overflow:hidden; font-size:8px; line-height:12px; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
[data-paimind-trace-sheet][data-layout='technical'] dl[data-paimind-trace-sheet] { grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
[data-page='technical'] [data-paimind-trace-page-head] { padding-bottom:5px; }
[data-page='technical'] [data-paimind-trace-page-head] p { display:none; }
[data-page='technical'] [data-paimind-trace-sheet][data-layout='technical'] { gap:4px; }
[data-page='technical'] [data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-section] { gap:3px; padding:4px 0; }
[data-page='technical'] [data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-field] { padding:6px 7px; }
[data-page='technical'] [data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-row] { padding:6px 7px; }
[data-page='technical'] [data-paimind-trace-sheet][data-layout='technical'] [data-paimind-trace-row] p { -webkit-line-clamp:1; }
[data-paimind-trace-overview] { grid-template-columns:minmax(0,1fr) 112px; gap:4px 9px; margin-bottom:4px; padding:8px 9px; border-radius:11px; }
[data-paimind-trace-overview] > span,[data-paimind-trace-overview] h4 { grid-column:1; }
[data-paimind-trace-overview] h4 { display:-webkit-box; overflow:hidden; font-size:10px; line-height:14px; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
[data-paimind-trace-overview-stats] { grid-column:2; grid-row:1/3; align-self:stretch; gap:5px; }
[data-paimind-trace-overview-stats] div { align-content:center; padding:5px 6px; }
[data-paimind-trace-overview-stats] dd { font-size:13px; line-height:16px; }
[data-page='directory'] [data-paimind-trace-section] { gap:5px; padding:5px 0; }
[data-page='directory'] [data-paimind-trace-section] h3 { font-size:8px; line-height:12px; }
[data-page='directory'] [data-paimind-trace-grid],[data-page='directory'] [data-paimind-trace-list] { grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }
[data-page='directory'] [data-paimind-trace-button],[data-page='directory'] [data-paimind-trace-row] { min-height:31px; padding:6px 7px; border-radius:8px; font-size:8px; line-height:12px; }
[data-page='directory'] [data-paimind-trace-button] { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
[data-page='directory'] [data-paimind-trace-row] { gap:0; }
[data-page='directory'] [data-paimind-trace-row] strong { overflow:hidden; font-size:8px; line-height:12px; text-overflow:ellipsis; white-space:nowrap; }
[data-page='directory'] [data-paimind-trace-row] span { overflow:hidden; font-size:7px; line-height:10px; text-overflow:ellipsis; white-space:nowrap; }
[data-page='directory'] [data-paimind-trace-page-head] { padding-bottom:5px; }
[data-page='directory'] [data-paimind-trace-page-head] p { display:none; }
[data-page='directory'] [data-paimind-trace-overview] { grid-template-columns:minmax(0,1fr) 92px; gap:2px 6px; margin-bottom:2px; padding:6px 7px; }
[data-page='directory'] [data-paimind-trace-overview] h4 { -webkit-line-clamp:1; }
[data-page='directory'] [data-paimind-trace-overview-stats] { gap:3px; }
[data-page='directory'] [data-paimind-trace-overview-stats] div { padding:3px 4px; }
[data-page='directory'] [data-paimind-trace-overview-stats] dt { font-size:6px; line-height:9px; }
[data-page='directory'] [data-paimind-trace-overview-stats] dd { font-size:11px; line-height:13px; }
[data-page='directory'] [data-paimind-trace-section] { gap:3px; padding:3px 0; }
[data-page='directory'] [data-paimind-trace-grid],[data-page='directory'] [data-paimind-trace-list] { gap:3px; }
[data-page='directory'] [data-paimind-trace-button],[data-page='directory'] [data-paimind-trace-row] { min-height:25px; padding:4px 6px; -webkit-line-clamp:1; }
[data-page='directory'] [data-paimind-trace-row] span { display:none; }
@container paimind-bento (max-width:900px){[data-paimind-trace-header]{align-items:center;flex-direction:row}[data-paimind-trace-meta]{white-space:nowrap}[data-paimind-trace-page]{padding-inline:10px}[data-paimind-trace-nav]{padding-inline:8px}}
@container paimind-bento (max-width:620px){[data-paimind-trace-title] h2{max-width:18ch}[data-paimind-trace-business-hero]{grid-template-columns:84px minmax(0,1fr)}[data-paimind-trace-nav] button{gap:3px}[data-paimind-trace-nav] button span{display:none}}
@media(prefers-reduced-motion:reduce){[data-paimind-trace] *,[data-paimind-trace] *::before,[data-paimind-trace] *::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style'); style.id = STYLE_ID; style.dataset.paimindPlugin = '@paimind/presentation-trace'; style.textContent = STYLE; document.head.append(style)
  return () => { style.remove() }
}

const statusCopy = (status: string, zh: boolean): string => ({ generated: zh ? '已生成' : 'Generated', reviewed: zh ? '已审核' : 'Reviewed', verified: zh ? '已验证' : 'Verified' }[status] ?? status)
const missing = (zh: boolean): string => zh ? '未登记' : 'Not registered'

type TracePage = 'directory' | 'business' | 'technical'

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
    <button type="button" data-paimind-trace-back onClick={props.onDirectory}>← {props.zh ? '返回目录' : 'Back to directory'}</button>
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
    <button type="button" data-paimind-trace-back onClick={props.onBusiness}>← {props.zh ? '返回业务溯源' : 'Back to business trace'}</button>
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
  useEffect(() => { setSlideIndex(0); setBlockId(''); setMetricId(''); setFactId(''); setPage('directory') }, [snapshot.selection?.traceId, snapshot.selection?.artifactId])
  useEffect(() => {
    const event = bento.runtimeEvent; const request = bento.request; const selection = snapshot.selection
    if (trace === null || event === null || request === null || selection === null) return
    if (request.sessionId !== selection.sessionId || request.workspaceId !== selection.workspaceId || request.path !== selection.path) return
    const nextSlideIndex = event.slideId === undefined ? event.slide - 1 : trace.document.slides.findIndex(slide => slide.slideId === event.slideId)
    if (nextSlideIndex >= 0 && nextSlideIndex < trace.document.slides.length) {
      const slideChanged = nextSlideIndex !== slideIndex
      setSlideIndex(nextSlideIndex)
      if (event.type !== 'paimind:bento-select') {
        if (slideChanged) { setBlockId(''); setMetricId(''); setFactId(''); setPage('directory') }
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
  if (snapshot.selection === null) return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}><div data-paimind-trace-empty>{zh ? '请从 PAIMind 产物中选择“追溯”。' : 'Choose Trace from a PAIMind artifact.'}</div></section>
  if (trace === null) return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}><div role="alert" data-paimind-trace-error>{zh ? '关联的追溯记录不可用；原生预览与会话不受影响。' : 'The associated trace is unavailable; native preview and conversation remain available.'}</div></section>
  const slide = trace.document.slides[Math.min(slideIndex, trace.document.slides.length - 1)] as PaimindTraceSlide
  const activeBlock = slide.businessBlocks.find(block => block.blockId === blockId) ?? slide.businessBlocks[0]
  const metrics = slide.metrics.filter(metric => metric.businessBlockId === activeBlock?.blockId)
  const metric = metrics.find(row => row.metricId === metricId) ?? metrics[0]
  const fact = metric?.facts.find(row => row.factId === factId) ?? metric?.facts[0]
  const focusFact = (targetSlide: PaimindTraceSlide, targetFactId: string): void => {
    const targetSlideIndex = trace.document.slides.findIndex(row => row.slideId === targetSlide.slideId)
    if (targetSlideIndex >= 0) props.bento.navigate({ slideId: targetSlide.slideId, slide: targetSlideIndex + 1 })
    for (const visual of targetSlide.visualBindings) {
      const binding = visual.factBindings.find(row => row.factId === targetFactId)
      if (binding !== undefined) { props.bento.focus({ slideId: targetSlide.slideId, objectId: visual.objectId, selector: binding.selector.kind === 'chart-point' ? { kind: 'chart-point', seriesKey: binding.selector.seriesKey ?? '', categoryKey: binding.selector.categoryKey ?? '' } : binding.selector.kind === 'table-cell' ? { kind: 'table-cell', rowKey: binding.selector.rowKey ?? '', columnKey: binding.selector.columnKey ?? '' } : { kind: 'object' } }); return }
    }
  }
  const selectSlide = (index: number): void => {
    const target = trace.document.slides[index]
    if (target === undefined) return
    setSlideIndex(index); setBlockId(''); setMetricId(''); setFactId(''); setPage('directory')
    props.bento.navigate({ slideId: target.slideId, slide: index + 1 })
  }
  const selectFact = (targetMetric: PaimindTraceMetric, targetFact: PaimindTraceFact): void => {
    setBlockId(targetMetric.businessBlockId); setMetricId(targetMetric.metricId); setFactId(targetFact.factId); setPage('business'); focusFact(slide, targetFact.factId)
  }
  return <section data-paimind-trace aria-label={zh ? '演示追溯' : 'Presentation Trace'}>
    <header data-paimind-trace-header><div data-paimind-trace-title><span data-paimind-trace-eyebrow>{zh ? '实时证据' : 'Live evidence'}</span><h2>{snapshot.selection.title}</h2></div><div data-paimind-trace-meta><span data-paimind-trace-badge>{statusCopy(trace.document.reviewStatus, zh)}</span><span>{zh ? `${slideIndex + 1} / ${trace.document.slides.length} 页` : `${slideIndex + 1} / ${trace.document.slides.length}`}</span></div></header>
    <TracePageNav page={page} hasFact={fact !== undefined} zh={zh} onNavigate={setPage} />
    {page === 'directory' && <main data-paimind-trace-page data-page="directory">
      <header data-paimind-trace-page-head><span>{zh ? '溯源目录' : 'Trace Directory'}</span><h3>{zh ? '这份演示中的证据地图' : 'Evidence map for this deck'}</h3><p>{zh ? '选择页面、业务区块或事实，进入对应溯源。' : 'Choose a slide, business block, or verified fact to inspect its evidence.'}</p></header>
      <section data-paimind-trace-overview><span>{zh ? `当前第 ${slideIndex + 1} 页` : `Current slide · ${String(slideIndex + 1).padStart(2, '0')}`}</span><h4>{slide.explanation}</h4><dl data-paimind-trace-overview-stats><div><dt>{zh ? '业务区块' : 'Business blocks'}</dt><dd>{slide.businessBlocks.length}</dd></div><div><dt>{zh ? '已验证事实' : 'Verified facts'}</dt><dd>{slide.metrics.reduce((total, row) => total + row.facts.length, 0)}</dd></div></dl></section>
      <section data-paimind-trace-section><h3>{zh ? '页面目录' : 'Slide Directory'}</h3><div data-paimind-trace-grid>{trace.document.slides.map((row, index) => <button key={row.slideId} type="button" data-paimind-trace-button aria-pressed={index === slideIndex} onClick={() => { selectSlide(index) }}>{String(index + 1).padStart(2, '0')} · {row.explanation}</button>)}</div></section>
      <section data-paimind-trace-section><h3>{zh ? '业务区块' : 'Business Blocks'}</h3><div data-paimind-trace-grid>{slide.businessBlocks.map(block => <button key={block.blockId} type="button" data-paimind-trace-button aria-pressed={block.blockId === activeBlock?.blockId} onClick={() => { setBlockId(block.blockId); setMetricId(''); setFactId('') }}><strong>{block.label}</strong>{block.description ? <><br />{block.description}</> : null}</button>)}</div></section>
      <section data-paimind-trace-section><h3>{zh ? '已验证事实' : 'Verified Facts'}</h3><ul data-paimind-trace-list>{metrics.flatMap(row => row.facts.map(rowFact => <li key={rowFact.factId}><button type="button" data-paimind-trace-row onClick={() => { selectFact(row, rowFact) }}><strong>{row.label} · {rowFact.displayValue}</strong><span>{rowFact.dimensions.map(dimension => dimension.value).join(' · ') || rowFact.business.scope.period}</span></button></li>))}</ul></section>
    </main>}
    {page === 'business' && fact !== undefined && <main data-paimind-trace-page data-page="business">
      <header data-paimind-trace-page-head><span>{zh ? '业务溯源' : 'Business Trace'}</span><h3>{zh ? '是什么支撑了这个结论？' : 'What supports this result?'}</h3><p>{metric?.label} · {zh ? '面向业务用户解释结论、口径、范围与来源。' : 'Conclusion, method, scope, and registered source.'}</p></header>
      <BusinessSheet fact={fact} document={trace.document} zh={zh} onDirectory={() => { setPage('directory') }} onTechnical={() => { setPage('technical') }} />
    </main>}
    {page === 'technical' && fact !== undefined && <main data-paimind-trace-page data-page="technical">
      <header data-paimind-trace-page-head><span>{zh ? '技术溯源' : 'Technical Trace'}</span><h3>{zh ? '这个事实是如何生成的？' : 'How was this fact produced?'}</h3><p>{metric?.label} · {zh ? '数据链路、计算逻辑、代码与执行证据。' : 'Lineage, calculation logic, code, and execution evidence.'}</p></header>
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
    packageName: '@paimind/presentation-trace',
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
