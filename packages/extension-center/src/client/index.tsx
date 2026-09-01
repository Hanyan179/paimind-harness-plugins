import {
  Component,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import {
  PAIMIND_EXTENSION_CATEGORIES,
  type PaimindExtensionCategory,
  type PaimindExtensionDescriptor,
} from '@paimind/contracts'
import {
  contributePaimindExtension,
  type HarnessPluginInventoryRemote,
  type HarnessPluginInventorySnapshot,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type HarnessSettingsSectionOwnerProps,
  type PaimindExtensionCenterClientContext,
  projectHarnessPluginTechnicalState,
} from '@paimind/harness-compat'
import {
  PaimindCheckIcon,
  PaimindChevronDownIcon,
  PaimindRefreshIcon,
  PaimindSearchIcon,
  PaimindSettingsIcon,
  PaimindWarningIcon,
} from '@paimind/harness-compat/client-icons'
import {
  compareExtensionDescriptors,
  projectExtensionTechnicalState,
  type ExtensionTechnicalState,
} from '../projection.js'
import type {
  PaimindFeaturePackState,
  PaimindFeaturePackView,
  PaimindFeatureToggleMutationRequest,
} from '../feature-packs.js'
import TYPERT_REMOTE from '../remote.js'

export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

const SLOT = 'paimind.extension'
const STYLE_ID = '@paimind/extension-center'

const SELF: PaimindExtensionDescriptor = {
  id: 'paimind:extension-center',
  packageName: '@paimind/extension-center',
  category: 'developer',
  nameZh: '扩展中心',
  nameEn: 'Extension Center',
  descriptionZh: '按产品类别管理 PAIMind 能力，并映射 Harness 的真实技术加载状态。',
  descriptionEn: 'Manages PAIMind capabilities by product category and projects native Harness loader state.',
  surface: 'settings',
  maturity: 'available',
  order: -100,
}

const CATEGORY_COPY: Readonly<Record<PaimindExtensionCategory, { readonly zh: string; readonly en: string }>> = {
  experience: { zh: '体验', en: 'Experience' },
  'content-rendering': { zh: '内容与渲染', en: 'Content & Rendering' },
  agents: { zh: '智能体', en: 'Agents' },
  'skills-tools': { zh: '技能与工具', en: 'Skills & Tools' },
  automation: { zh: '自动化', en: 'Automation' },
  governance: { zh: '治理', en: 'Governance' },
  developer: { zh: '开发者', en: 'Developer' },
}

const TECHNICAL_COPY: Readonly<Record<ExtensionTechnicalState, { readonly zh: string; readonly en: string }>> = {
  active: { zh: '已加载', en: 'Active' },
  loading: { zh: '加载中', en: 'Loading' },
  failed: { zh: '加载失败', en: 'Failed' },
  disabled: { zh: '已停用', en: 'Disabled' },
  unobserved: { zh: '已启用 · 未观测', en: 'Enabled · Unobserved' },
  unavailable: { zh: '注册表未发现', en: 'Not in registry' },
}

const MATURITY_COPY = {
  available: { zh: '可用', en: 'Available' },
  'technical-preview': { zh: '技术已验证', en: 'Technical preview' },
  reopened: { zh: '纠偏中', en: 'Reopened' },
} as const

const SURFACE_COPY = {
  shell: { zh: '应用外壳', en: 'App shell' },
  conversation: { zh: '原生对话', en: 'Native conversation' },
  settings: { zh: '设置', en: 'Settings' },
  'header-button': { zh: '独立按钮', en: 'Independent button' },
  'side-card': { zh: '侧卡', en: 'Side card' },
  preview: { zh: '预览通道', en: 'Preview channel' },
  headless: { zh: '无界面适配器', en: 'Headless adapter' },
} as const

const CATEGORY_DESCRIPTION_COPY: Readonly<Record<PaimindExtensionCategory, { readonly zh: string; readonly en: string }>> = {
  experience: { zh: '品牌、主题与原生交互体验。', en: 'Brand, theme, and native interaction experience.' },
  'content-rendering': { zh: '生成、预览与交付内容。', en: 'Generate, preview, and deliver content.' },
  agents: { zh: '智能体发现、创建与治理入口。', en: 'Agent discovery, creation, and governance surfaces.' },
  'skills-tools': { zh: '技能、工具与可复用执行能力。', en: 'Skills, tools, and reusable execution capabilities.' },
  automation: { zh: '任务、通知与计划执行。', en: 'Tasks, notifications, and scheduled execution.' },
  governance: { zh: '身份、权限与组织级控制。', en: 'Identity, permission, and organization controls.' },
  developer: { zh: '集成、诊断与扩展开发能力。', en: 'Integration, diagnostics, and extension development.' },
}

const ATTENTION_STATES = new Set<ExtensionTechnicalState>(['failed', 'disabled', 'unavailable'])
const CATEGORY_SET = new Set<string>(PAIMIND_EXTENSION_CATEGORIES)
const MATURITY_SET = new Set<string>(Object.keys(MATURITY_COPY))
const SURFACE_SET = new Set<string>(Object.keys(SURFACE_COPY))
const BOOT_CLIENT_SENTINEL_BY_PACK_ID = Object.freeze<Record<string, `@paimind/${string}`>>({
  'paimind:pack:experience': '@paimind/branding',
  'paimind:pack:agents': '@paimind/agent-market',
  'paimind:pack:content': '@paimind/artifacts',
  'paimind:pack:proposal': '@paimind/proposal-experience',
  'paimind:pack:automation': '@paimind/notifications',
  'paimind:pack:operations': '@paimind/task-monitor',
})
const BOOT_CONSISTENCY_ATTRIBUTE = 'data-paimind-boot-consistency'
const BOOT_RECOVERY_SESSION_KEY = 'paimind:feature-pack-client-recovery-v1'

export function findPaimindFeaturePackClientGaps(
  view: Readonly<PaimindFeaturePackView>,
  inventory: Readonly<HarnessPluginInventorySnapshot>,
  extensions: readonly Readonly<PaimindExtensionDescriptor>[],
): readonly string[] {
  if (view.status !== 'ready') return Object.freeze([])
  const contributedPackages = new Set(extensions.map(extension => extension.packageName))
  return Object.freeze(view.packs.flatMap(pack => {
    if (!pack.enabled || pack.failure !== undefined) return []
    const sentinel = BOOT_CLIENT_SENTINEL_BY_PACK_ID[pack.id]
    if (sentinel === undefined || contributedPackages.has(sentinel)) return []
    return projectHarnessPluginTechnicalState(sentinel, inventory).technicalState === 'active'
      ? [pack.id]
      : []
  }))
}

function surfaceGuidance(
  descriptor: Readonly<PaimindExtensionDescriptor>,
  zh: boolean,
): string {
  const name = zh ? descriptor.nameZh : descriptor.nameEn
  switch (descriptor.surface) {
    case 'settings': return zh ? `Harness 设置 → ${name}` : `Harness Settings → ${name}`
    case 'conversation': return zh ? 'Harness 原生对话与输入区' : 'Harness native conversation and Composer'
    case 'header-button': return zh ? `对话页独立入口 → ${name}` : `Independent conversation action → ${name}`
    case 'preview': return zh ? 'Harness 交付物与预览面板' : 'Harness deliverable and preview panel'
    case 'shell': return zh ? 'Harness 应用外壳或该能力自有入口' : 'Harness app shell or the capability’s own surface'
    case 'side-card': return zh ? 'Better Sidebar 侧卡' : 'Better Sidebar side card'
    case 'headless': return zh ? '无独立界面，由依赖它的能力使用' : 'No standalone UI; consumed by dependent capabilities'
  }
}

const STYLE = `
[data-paimind-extension-center]{--extension-ink:var(--paimind-ink,var(--dsw-alias-label-primary,#17223a));--extension-muted:var(--paimind-muted,var(--dsw-alias-label-secondary,#65718a));--extension-faint:var(--dsw-alias-label-tertiary,#7c8798);--extension-line:var(--paimind-line,var(--dsw-alias-border-l1,rgba(110,128,154,.16)));--extension-line-strong:var(--dsw-alias-border-l2,rgba(110,128,154,.26));--extension-accent:var(--paimind-accent,var(--dsw-alias-state-business-primary,#3471f5));--extension-surface:var(--paimind-glass-strong,var(--dsw-alias-bg-layer-2,#fff));--extension-soft:var(--paimind-glass,var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05)));--extension-canvas:var(--paimind-canvas,var(--dsw-alias-bg-layer-2,#fff));--extension-radius:var(--paimind-radius,16px);box-sizing:border-box;min-width:0;min-height:100%;padding:24px;color:var(--extension-ink);font:inherit}
[data-paimind-extension-center] *{box-sizing:border-box}
[data-paimind-extension-header]{display:grid;gap:6px;margin-bottom:14px}
[data-paimind-extension-header] h2{margin:0;font-size:20px;line-height:28px;font-weight:680;letter-spacing:-.02em}
[data-paimind-extension-header] p{margin:0;max-width:680px;color:var(--extension-muted);font-size:13px;line-height:20px}
[data-paimind-extension-note]{display:flex;gap:9px;align-items:flex-start;margin:0 0 14px;padding:9px 11px;border:1px solid var(--extension-line);border-radius:10px;background:var(--extension-soft);color:var(--extension-muted);font-size:12px;line-height:18px}
[data-paimind-extension-note] svg{flex:none;margin-top:1px;color:var(--extension-accent)}
[data-paimind-feature-pack-section]{display:grid;gap:10px;margin:0 0 18px}
[data-paimind-feature-pack-heading]{display:flex;align-items:end;justify-content:space-between;gap:12px}
[data-paimind-feature-pack-heading] h3{margin:0;font-size:15px;line-height:22px}
[data-paimind-feature-pack-heading] p{margin:2px 0 0;color:var(--extension-muted);font-size:11px;line-height:17px}
[data-paimind-feature-pack-heading]>span{color:var(--extension-faint);font-size:11px}
[data-paimind-feature-pack-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
[data-paimind-feature-pack]{display:grid;gap:9px;padding:13px;border:1px solid var(--extension-line);border-radius:12px;background:color-mix(in srgb,var(--extension-surface) 94%,transparent)}
[data-paimind-feature-pack][data-enabled='false']{background:color-mix(in srgb,var(--extension-soft) 80%,transparent)}
[data-paimind-feature-pack-main]{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
[data-paimind-feature-pack-copy]{min-width:0}
[data-paimind-feature-pack-copy] h4{margin:0;font-size:14px;line-height:20px}
[data-paimind-feature-pack-copy] p{margin:3px 0 0;color:var(--extension-muted);font-size:11px;line-height:17px}
[data-paimind-feature-pack-meta]{display:flex;flex-wrap:wrap;gap:5px;color:var(--extension-faint);font-size:10px;line-height:15px}
[data-paimind-feature-pack-error]{margin:0;padding:7px 9px;border:1px solid color-mix(in srgb,#d83a52 34%,var(--extension-line));border-radius:8px;background:color-mix(in srgb,#d83a52 8%,transparent);color:#b4233b;font-size:11px;line-height:17px;overflow-wrap:anywhere}
[data-paimind-feature-switch]{position:relative;flex:0 0 auto;width:40px;height:22px;padding:0;border:0;border-radius:999px;background:color-mix(in srgb,var(--extension-faint) 36%,transparent);cursor:pointer}
[data-paimind-feature-switch]::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform 160ms ease}
[data-paimind-feature-switch][aria-checked='true']{background:var(--extension-accent)}
[data-paimind-feature-switch][aria-checked='true']::after{transform:translateX(18px)}
[data-paimind-feature-switch]:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-feature-capabilities]{display:grid;gap:6px;padding-top:8px;border-top:1px solid var(--extension-line)}
[data-paimind-feature-capability]{display:flex;align-items:center;justify-content:space-between;gap:10px}
[data-paimind-feature-capability] strong{display:block;font-size:11px;line-height:17px}
[data-paimind-feature-capability] span{display:block;color:var(--extension-faint);font-size:10px;line-height:15px}
[data-paimind-feature-pack-feedback]{min-height:17px;color:var(--extension-muted);font-size:11px;line-height:17px}
[data-paimind-technical-catalog]{border-top:1px solid var(--extension-line);padding-top:12px}
[data-paimind-technical-catalog]>summary{margin-bottom:12px;color:var(--extension-muted);font-size:12px;line-height:18px;cursor:pointer}
[data-paimind-extension-summary]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:hidden;margin-bottom:14px;border:1px solid var(--extension-line);border-radius:12px;background:color-mix(in srgb,var(--extension-surface) 90%,transparent)}
[data-paimind-extension-summary] div{min-width:0;padding:10px 12px;border-right:1px solid var(--extension-line)}
[data-paimind-extension-summary] div:last-child{border-right:0}
[data-paimind-extension-summary] strong{display:block;font-size:16px;line-height:20px;font-weight:680;font-variant-numeric:tabular-nums}
[data-paimind-extension-summary] span{display:block;margin-top:2px;overflow:hidden;color:var(--extension-muted);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-extension-search]{position:relative;display:flex;align-items:center;margin:0 0 10px;color:var(--extension-faint)}
[data-paimind-extension-search]>svg{position:absolute;left:12px;pointer-events:none}
[data-paimind-extension-search] input{width:100%;min-width:0;height:38px;padding:0 34px 0 36px;border:1px solid var(--extension-line-strong);border-radius:10px;color:var(--extension-ink);background:var(--extension-surface);font:inherit;font-size:13px;outline:none}
[data-paimind-extension-search] input::placeholder{color:var(--extension-faint)}
[data-paimind-extension-search] input:focus-visible{border-color:var(--extension-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--extension-accent) 18%,transparent)}
[data-paimind-extension-categories]{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0}
[data-paimind-extension-category-button]{display:inline-flex;align-items:center;gap:5px;min-height:30px;padding:5px 9px;border:1px solid var(--extension-line);border-radius:999px;color:var(--extension-muted);background:transparent;font:inherit;font-size:11px;line-height:18px;cursor:pointer}
[data-paimind-extension-category-button] small{color:var(--extension-faint);font-size:10px;font-variant-numeric:tabular-nums}
[data-paimind-extension-category-button]:hover{border-color:var(--extension-line-strong);background:var(--extension-soft)}
[data-paimind-extension-category-button]:focus-visible{outline:2px solid var(--extension-accent);outline-offset:2px}
[data-paimind-extension-category-button][aria-pressed='true']{border-color:color-mix(in srgb,var(--extension-accent) 42%,var(--extension-line));color:var(--extension-accent);background:color-mix(in srgb,var(--extension-accent) 9%,transparent)}
[data-paimind-extension-results]{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 2px 12px;color:var(--extension-muted);font-size:11px;line-height:17px}
[data-paimind-extension-groups]{display:grid;gap:20px}
[data-paimind-extension-group]{display:grid;gap:8px}
[data-paimind-extension-group-header]{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:12px;padding:0 2px}
[data-paimind-extension-group-header] h3{margin:0;font-size:13px;line-height:20px;font-weight:650}
[data-paimind-extension-group-header] p{margin:1px 0 0;color:var(--extension-muted);font-size:11px;line-height:17px}
[data-paimind-extension-group-header]>span{color:var(--extension-faint);font-size:11px;font-variant-numeric:tabular-nums}
[data-paimind-extension-grid]{display:grid;gap:7px}
[data-paimind-extension-card]{min-width:0;overflow:hidden;border:1px solid var(--extension-line);border-radius:12px;background:color-mix(in srgb,var(--extension-surface) 94%,transparent)}
[data-paimind-extension-card][data-open='true']{border-color:color-mix(in srgb,var(--extension-accent) 26%,var(--extension-line));box-shadow:var(--paimind-shadow,var(--dsw-shadow-lv1,0 8px 24px rgba(39,63,102,.08)))}
[data-paimind-extension-card-summary]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 14px;width:100%;min-height:78px;padding:12px 13px;border:0;color:inherit;background:transparent;font:inherit;text-align:left;cursor:pointer}
[data-paimind-extension-card-summary]:hover,[data-paimind-extension-card][data-open='true']>[data-paimind-extension-card-summary]{background:var(--dsw-alias-interactive-bg-hover,var(--extension-soft))}
[data-paimind-extension-card-summary]:focus-visible{outline:2px solid var(--extension-accent);outline-offset:-2px}
[data-paimind-extension-card-copy]{min-width:0}
[data-paimind-extension-card] h4{margin:0;font-size:14px;line-height:20px;font-weight:650}
[data-paimind-extension-card-copy] p{display:-webkit-box;margin:3px 0 0;overflow:hidden;color:var(--extension-muted);font-size:12px;line-height:18px;-webkit-box-orient:vertical;-webkit-line-clamp:2}
[data-paimind-extension-card-meta]{display:flex;align-items:center;justify-content:flex-end;gap:7px;min-width:max-content}
[data-paimind-extension-card-meta]>svg{flex:none;color:var(--extension-faint)}
[data-paimind-extension-card][data-open='true'] [data-paimind-extension-card-meta]>svg{transform:rotate(180deg)}
[data-paimind-extension-location]{display:flex;align-items:center;gap:6px;min-width:0;grid-column:1/-1;color:var(--extension-faint);font-size:11px;line-height:16px}
[data-paimind-extension-location] svg{flex:none}
[data-paimind-extension-location] span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-extension-badge]{display:inline-flex;align-items:center;gap:4px;min-height:20px;padding:1px 6px;border-radius:6px;background:var(--extension-soft);color:var(--extension-muted);font-size:10px;line-height:16px;white-space:nowrap}
[data-paimind-extension-badge] svg{width:12px;height:12px}
[data-paimind-extension-badge][data-state='active']{color:var(--dsw-alias-state-success-primary,#238c55);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-extension-badge][data-state='failed'],[data-paimind-extension-badge][data-state='unavailable']{color:var(--dsw-alias-state-error-primary,#d04444);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-extension-badge][data-state='loading']{color:var(--extension-accent);background:color-mix(in srgb,currentColor 10%,transparent)}
[data-paimind-extension-details]{padding:12px 13px 13px;border-top:1px solid var(--extension-line);background:color-mix(in srgb,var(--extension-soft) 72%,transparent)}
[data-paimind-extension-details] dl{display:grid;grid-template-columns:124px minmax(0,1fr);gap:7px 12px;margin:0}
[data-paimind-extension-details] div{display:contents}
[data-paimind-extension-details] dt{color:var(--extension-faint);font-size:11px;line-height:17px}
[data-paimind-extension-details] dd{min-width:0;margin:0;overflow-wrap:anywhere;color:var(--extension-muted);font-size:12px;line-height:17px}
[data-paimind-extension-details] code{color:var(--extension-ink);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px}
[data-paimind-extension-technical-note]{margin:10px 0 0;padding-top:9px;border-top:1px solid var(--extension-line);color:var(--extension-faint);font-size:10px;line-height:16px}
[data-paimind-extension-status]{display:grid;justify-items:center;gap:6px;padding:34px 16px;color:var(--extension-muted);font-size:13px;line-height:20px;text-align:center}
[data-paimind-extension-status] h3,[data-paimind-extension-status] p{margin:0}
[data-paimind-extension-status] h3{color:var(--extension-ink);font-size:14px;line-height:20px}
[data-paimind-extension-status]>svg{color:var(--extension-faint)}
[data-paimind-extension-status] button{display:inline-flex;align-items:center;gap:6px;min-height:34px;margin-top:5px;padding:6px 10px;border:1px solid var(--extension-line-strong);border-radius:8px;color:var(--extension-ink);background:var(--extension-surface);font:inherit;font-size:12px;cursor:pointer}
[data-paimind-extension-status] button:focus-visible{outline:2px solid var(--extension-accent);outline-offset:2px}
[data-paimind-extension-skeletons]{display:grid;gap:8px;width:100%;margin-top:4px}
[data-paimind-extension-skeleton]{height:78px;border:1px solid var(--extension-line);border-radius:12px;background:linear-gradient(100deg,var(--extension-soft) 20%,color-mix(in srgb,var(--extension-soft) 38%,var(--extension-surface)) 45%,var(--extension-soft) 70%);background-size:220% 100%}
[data-paimind-extension-boundary]{margin:24px;padding:18px;border:1px solid var(--paimind-line,var(--dsw-alias-border-l1,rgba(110,128,154,.16)));border-radius:12px;color:var(--paimind-muted,var(--dsw-alias-label-secondary,#65718a));background:var(--paimind-glass,var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05)));font-size:13px;line-height:20px}
@media(prefers-reduced-motion:no-preference){[data-paimind-extension-card-meta]>svg{transition:transform 160ms ease}[data-paimind-extension-skeleton]{animation:paimind-extension-loading 1.4s ease-in-out infinite}}
@keyframes paimind-extension-loading{to{background-position:-220% 0}}
@media(max-width:760px){[data-paimind-feature-pack-grid]{grid-template-columns:1fr}}
@media(max-width:560px){[data-paimind-extension-center]{position:fixed;z-index:4;inset:72px 24px 24px;min-height:0;padding:16px;overflow:auto;border-radius:16px;background:var(--extension-canvas);box-shadow:var(--dsw-shadow-lv3,0 18px 60px rgba(0,0,0,.18))}[data-paimind-extension-header] h2{font-size:19px;line-height:26px}[data-paimind-extension-summary] div{padding:8px}[data-paimind-extension-summary] strong{font-size:14px}[data-paimind-extension-summary] span{font-size:10px}[data-paimind-extension-card-summary]{grid-template-columns:minmax(0,1fr);gap:8px}[data-paimind-extension-card-meta]{justify-content:flex-start;min-width:0}[data-paimind-extension-location]{grid-column:1}[data-paimind-extension-details] dl{grid-template-columns:minmax(0,1fr);gap:2px 0}[data-paimind-extension-details] dd{margin-bottom:7px}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function isDescriptor(value: unknown): value is Readonly<PaimindExtensionDescriptor> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PaimindExtensionDescriptor>
  return typeof candidate.id === 'string'
    && candidate.id.startsWith('paimind:')
    && typeof candidate.packageName === 'string'
    && candidate.packageName.startsWith('@paimind/')
    && typeof candidate.category === 'string'
    && CATEGORY_SET.has(candidate.category)
    && typeof candidate.nameZh === 'string'
    && candidate.nameZh.trim().length > 0
    && typeof candidate.nameEn === 'string'
    && candidate.nameEn.trim().length > 0
    && typeof candidate.descriptionZh === 'string'
    && typeof candidate.descriptionEn === 'string'
    && typeof candidate.maturity === 'string'
    && MATURITY_SET.has(candidate.maturity)
    && typeof candidate.surface === 'string'
    && SURFACE_SET.has(candidate.surface)
}

function descriptorFromEntry(entry: { readonly inject?: () => unknown }): unknown {
  try {
    const injected = entry.inject?.()
    return typeof injected === 'object' && injected !== null
      ? (injected as { readonly descriptor?: unknown }).descriptor
      : undefined
  } catch {
    return undefined
  }
}

interface ExtensionCenterInjected {
  readonly getExtensions: () => readonly Readonly<PaimindExtensionDescriptor>[]
  readonly subscribeExtensions: (listener: () => void) => () => void
  readonly listInventory: () => Promise<HarnessPluginInventorySnapshot>
  readonly describeFeaturePacks?: () => Promise<PaimindFeaturePackView>
  readonly mutateFeaturePack?: (request: PaimindFeatureToggleMutationRequest) => Promise<PaimindFeaturePackView>
  readonly reloadApplication?: () => void
  readonly locale: PaimindExtensionCenterClientContext['locale']
}

type ExtensionCenterProps = HarnessSettingsSectionOwnerProps & ExtensionCenterInjected

type InventoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: HarnessPluginInventorySnapshot }

type FeaturePackState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly view: Extract<PaimindFeaturePackView, { readonly status: 'ready' }> }

export function ExtensionCenterSection(props: ExtensionCenterProps): React.JSX.Element {
  const extensions = useSyncExternalStore(
    props.subscribeExtensions,
    props.getExtensions,
    props.getExtensions,
  )
  const locale = useSyncExternalStore(
    props.locale.subscribe.bind(props.locale),
    () => props.locale.getLocale().active,
    () => props.locale.getLocale().active,
  )
  const zh = locale.startsWith('zh')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PaimindExtensionCategory | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [request, setRequest] = useState(0)
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading' })
  const [featurePacks, setFeaturePacks] = useState<FeaturePackState>({ status: 'loading' })
  const [pendingToggle, setPendingToggle] = useState<string | null>(null)
  const [featurePackFeedback, setFeaturePackFeedback] = useState('')
  const detailsBaseId = useId()

  useEffect(() => {
    let current = true
    setInventory({ status: 'loading' })
    void props.listInventory().then(
      snapshot => { if (current) setInventory({ status: 'ready', snapshot }) },
      () => { if (current) setInventory({ status: 'error' }) },
    )
    return () => { current = false }
  }, [props.listInventory, request])

  useEffect(() => {
    let current = true
    if (props.describeFeaturePacks === undefined) {
      setFeaturePacks({ status: 'unavailable' })
      return () => { current = false }
    }
    setFeaturePacks({ status: 'loading' })
    void props.describeFeaturePacks().then(
      view => {
        if (!current) return
        setFeaturePacks(view.status === 'ready' ? { status: 'ready', view } : { status: 'unavailable' })
      },
      () => { if (current) setFeaturePacks({ status: 'error' }) },
    )
    return () => { current = false }
  }, [props.describeFeaturePacks])

  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const queryMatched = useMemo(() => extensions.filter(extension => {
    if (normalizedQuery.length === 0) return true
    return [extension.nameZh, extension.nameEn, extension.packageName, extension.descriptionZh, extension.descriptionEn]
      .some(value => value.toLocaleLowerCase(locale).includes(normalizedQuery))
  }), [extensions, locale, normalizedQuery])
  const visible = useMemo(() => queryMatched.filter(extension => (
    category === 'all' || extension.category === category
  )), [category, queryMatched])
  const counts = useMemo(() => new Map(PAIMIND_EXTENSION_CATEGORIES.map(categoryId => [
    categoryId,
    queryMatched.filter(extension => extension.category === categoryId).length,
  ])), [queryMatched])
  const projections = useMemo(() => inventory.status === 'ready'
    ? extensions.map(descriptor => projectExtensionTechnicalState(descriptor, inventory.snapshot))
    : [], [extensions, inventory])
  const projectionById = useMemo(() => new Map(projections.map(projection => [
    projection.descriptor.id,
    projection,
  ])), [projections])
  const packModuleStateByPackageName = useMemo(() => {
    if (inventory.status !== 'ready' || featurePacks.status !== 'ready') return new Map<string, ExtensionTechnicalState>()
    return new Map(featurePacks.view.packs.flatMap(pack => pack.packageNames).map(packageName => [
      packageName,
      projectHarnessPluginTechnicalState(packageName, inventory.snapshot).technicalState,
    ]))
  }, [featurePacks, inventory])
  const expectedPackPackageNames = (pack: Readonly<PaimindFeaturePackState>): readonly `@paimind/${string}`[] => {
    const intentionallyDisabled = new Set<string>(pack.capabilities
      .filter(capability => !(capability.desiredEnabled ?? capability.enabled))
      .flatMap(capability => capability.packageNames))
    return pack.packageNames.filter(packageName => !intentionallyDisabled.has(packageName))
  }
  const activeCount = projections.filter(projection => projection.technicalState === 'active').length
  const attentionPackageNames = new Set(projections
    .filter(projection => ATTENTION_STATES.has(projection.technicalState))
    .map(projection => projection.descriptor.packageName))
  if (featurePacks.status === 'ready') {
    for (const pack of featurePacks.view.packs) {
      if (!(pack.desiredEnabled ?? pack.enabled)) continue
      for (const packageName of expectedPackPackageNames(pack)) {
        if (ATTENTION_STATES.has(packModuleStateByPackageName.get(packageName) ?? 'unavailable')) {
          attentionPackageNames.add(packageName)
        }
      }
    }
  }
  const attentionCount = attentionPackageNames.size

  useEffect(() => {
    if (expandedId !== null && !visible.some(extension => extension.id === expandedId)) setExpandedId(null)
  }, [expandedId, visible])

  const clearFilters = (): void => {
    setQuery('')
    setCategory('all')
  }

  const toggleFeature = async (id: string, enabled: boolean): Promise<void> => {
    if (featurePacks.status !== 'ready' || props.mutateFeaturePack === undefined) return
    setPendingToggle(id)
    setFeaturePackFeedback(zh ? '正在应用并保存…' : 'Applying and saving…')
    try {
      const next = await props.mutateFeaturePack({
        id, enabled, expectedRevision: featurePacks.view.revision,
      })
      if (next.status === 'ready') {
        setFeaturePacks({ status: 'ready', view: next })
        setFeaturePackFeedback(props.reloadApplication === undefined
          ? (zh
              ? '已应用；依赖功能包会按产品规则联动。'
              : 'Applied. Dependent Feature Packs follow the product dependency rules.')
          : (zh
              ? '已保存；正在重新加载应用以同步界面模块。'
              : 'Saved. Reloading the application to synchronize Client modules.'))
        if (props.reloadApplication !== undefined) setTimeout(props.reloadApplication, 120)
      } else {
        setFeaturePacks({ status: 'unavailable' })
        setFeaturePackFeedback(zh ? '主机当前不可写。' : 'The Host is currently unavailable for writes.')
      }
    } catch {
      setFeaturePackFeedback(zh ? '未保存；已恢复主机中的实际状态。' : 'Not saved; the actual Host state was restored.')
      if (props.describeFeaturePacks !== undefined) {
        try {
          const actual = await props.describeFeaturePacks()
          setFeaturePacks(actual.status === 'ready' ? { status: 'ready', view: actual } : { status: 'unavailable' })
        } catch { setFeaturePacks({ status: 'error' }) }
      }
    } finally {
      setRequest(value => value + 1)
      setPendingToggle(null)
    }
  }

  return <section data-paimind-extension-center aria-label={zh ? 'PAIMind 扩展中心' : 'PAIMind Extension Center'}>
    <header data-paimind-extension-header>
      <h2>{zh ? 'PAIMind 扩展中心' : 'PAIMind Extension Center'}</h2>
      <p>{zh ? '按产品功能包启用所需能力；内部技术模块继续独立测试与故障隔离。' : 'Enable the Product Feature Packs you need while internal modules remain independently tested and isolated.'}</p>
    </header>
    <div data-paimind-extension-note role="note"><PaimindSettingsIcon aria-hidden="true" /><span>{zh ? '功能包开关直接调用 Harness Loader，并保存到 Harness Settings；安装、卸载和版本升级仍由 Harness Plugin Registry 管理。' : 'Feature Pack switches call the Harness Loader directly and persist in Harness Settings. Installation, removal, and upgrades remain owned by the Harness Plugin Registry.'}</span></div>
    <section data-paimind-feature-pack-section aria-label={zh ? '产品功能包' : 'Product Feature Packs'}>
      <header data-paimind-feature-pack-heading><div><h3>{zh ? '产品功能包' : 'Product Feature Packs'}</h3><p>{zh ? '一个功能包对应一项可理解、可关闭的产品能力集合。' : 'Each Feature Pack is one understandable, switchable product capability set.'}</p></div><span>{featurePacks.status === 'ready' ? featurePacks.view.packs.length : '—'}</span></header>
      {featurePacks.status === 'loading' && <div data-paimind-extension-status aria-busy="true">{zh ? '正在读取功能包状态…' : 'Reading Feature Pack state…'}</div>}
      {featurePacks.status === 'error' && <div data-paimind-extension-status role="alert">{zh ? '暂时无法读取功能包状态。' : 'Feature Pack state is temporarily unavailable.'}</div>}
      {featurePacks.status === 'unavailable' && <div data-paimind-extension-status role="note">{zh ? '当前组合尚未提供功能包控制接口；技术模块明细仍可查看。' : 'This composition does not expose Feature Pack controls yet. Technical module details remain available.'}</div>}
      {featurePacks.status === 'ready' && <div data-paimind-feature-pack-grid>{featurePacks.view.packs.map(pack => {
        const desiredEnabled = pack.desiredEnabled ?? pack.enabled
        const expectedPackageNames = expectedPackPackageNames(pack)
        const activePackageCount = expectedPackageNames.filter(packageName => (
          packModuleStateByPackageName.get(packageName) === 'active'
        )).length
        const complete = !desiredEnabled || (pack.failure === undefined && activePackageCount === expectedPackageNames.length)
        return <article key={pack.id} data-paimind-feature-pack data-enabled={pack.enabled ? 'true' : 'false'} data-complete={complete ? 'true' : 'false'}>
        <div data-paimind-feature-pack-main>
          <div data-paimind-feature-pack-copy><h4>{zh ? pack.nameZh : pack.nameEn}</h4><p>{zh ? pack.descriptionZh : pack.descriptionEn}</p></div>
          <button
            type="button" role="switch" data-paimind-feature-switch
            aria-label={`${zh ? pack.nameZh : pack.nameEn} · ${pack.failure === undefined ? (desiredEnabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Disabled')) : (zh ? '启用失败' : 'Failed to enable')}`}
            aria-checked={desiredEnabled}
            disabled={!pack.installed || !featurePacks.view.writable || pendingToggle !== null}
            onClick={() => { void toggleFeature(pack.id, !desiredEnabled) }}
          />
        </div>
        <div data-paimind-feature-pack-meta>
          <span>{desiredEnabled ? (complete ? expectedPackageNames.length : `${activePackageCount} / ${expectedPackageNames.length}`) : pack.packageNames.length} {zh ? '个内部模块' : 'internal modules'}</span>
          <span>{pack.installed ? (pack.failure !== undefined ? (zh ? '启动失败' : 'Failed to start') : (desiredEnabled ? (complete ? (zh ? '运行中' : 'Running') : (zh ? '部分运行' : 'Partially running')) : (zh ? '已关闭' : 'Disabled'))) : (zh ? '待应用新组合' : 'Composition update required')}</span>
          {pack.requiredPackIds.length > 0 && <span>{zh ? `依赖 ${pack.requiredPackIds.length} 个功能包` : `${pack.requiredPackIds.length} required pack(s)`}</span>}
        </div>
        {pack.failure !== undefined && <p data-paimind-feature-pack-error role="alert">{pack.failure}</p>}
        {pack.capabilities.length > 0 && <div data-paimind-feature-capabilities>{pack.capabilities.map(capability => <div key={capability.id} data-paimind-feature-capability>
          <div><strong>{zh ? capability.nameZh : capability.nameEn}</strong><span>{zh ? capability.descriptionZh : capability.descriptionEn}</span></div>
          <button
            type="button" role="switch" data-paimind-feature-switch
            aria-label={`${zh ? capability.nameZh : capability.nameEn} · ${capability.failure === undefined ? ((capability.desiredEnabled ?? capability.enabled) ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Disabled')) : (zh ? '启用失败' : 'Failed to enable')}`}
            aria-checked={capability.desiredEnabled ?? capability.enabled}
            disabled={!pack.enabled || pack.failure !== undefined || !capability.installed || !featurePacks.view.writable || pendingToggle !== null}
            onClick={() => { void toggleFeature(capability.id, !(capability.desiredEnabled ?? capability.enabled)) }}
          />
        </div>)}</div>}
      </article>
      })}</div>}
      {featurePackFeedback !== '' && <div data-paimind-feature-pack-feedback role="status">{featurePackFeedback}</div>}
    </section>
    <section data-paimind-technical-catalog aria-label={zh ? '技术模块明细' : 'Technical module details'}>
      <h3>{zh ? '技术模块明细' : 'Technical module details'}</h3>
    <div data-paimind-extension-summary aria-label={zh ? '扩展概览' : 'Extension overview'}>
      <div><strong>{extensions.length}</strong><span>{zh ? '产品能力' : 'Product capabilities'}</span></div>
      <div><strong>{inventory.status === 'ready' ? activeCount : '—'}</strong><span>{zh ? 'Harness 已加载' : 'Active in Harness'}</span></div>
      <div><strong>{inventory.status === 'ready' ? attentionCount : '—'}</strong><span>{zh ? '技术状态需关注' : 'Need technical attention'}</span></div>
    </div>
    <label data-paimind-extension-search>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{zh ? '搜索扩展' : 'Search extensions'}</span>
      <PaimindSearchIcon aria-hidden="true" />
      <input type="search" value={query} placeholder={zh ? '搜索名称、包或能力' : 'Search name, package, or capability'} onChange={event => { setQuery(event.currentTarget.value) }} />
    </label>
    <nav data-paimind-extension-categories aria-label={zh ? '扩展类别' : 'Extension categories'}>
      <button type="button" data-paimind-extension-category-button aria-pressed={category === 'all'} onClick={() => { setCategory('all') }}>{zh ? '全部' : 'All'} <small>{queryMatched.length}</small></button>
      {PAIMIND_EXTENSION_CATEGORIES.map(id => <button key={id} type="button" data-paimind-extension-category-button aria-pressed={category === id} onClick={() => { setCategory(id) }}>{zh ? CATEGORY_COPY[id].zh : CATEGORY_COPY[id].en} <small>{counts.get(id) ?? 0}</small></button>)}
    </nav>
    <div data-paimind-extension-results aria-live="polite"><span>{zh ? `显示 ${visible.length} / ${extensions.length} 项能力` : `Showing ${visible.length} of ${extensions.length} capabilities`}</span><span>{category === 'all' ? (zh ? '全部类别' : 'All categories') : (zh ? CATEGORY_COPY[category].zh : CATEGORY_COPY[category].en)}</span></div>
    {inventory.status === 'loading' && <div data-paimind-extension-status aria-busy="true" aria-live="polite"><PaimindRefreshIcon aria-hidden="true" /><p>{zh ? '正在读取 Harness 技术状态…' : 'Reading Harness technical state…'}</p><div data-paimind-extension-skeletons aria-hidden="true"><div data-paimind-extension-skeleton /><div data-paimind-extension-skeleton /><div data-paimind-extension-skeleton /></div></div>}
    {inventory.status === 'error' && <div data-paimind-extension-status><PaimindWarningIcon aria-hidden="true" /><h3>{zh ? '暂时无法读取技术状态' : 'Technical state is temporarily unavailable'}</h3><p role="alert">{zh ? 'Harness Plugin Registry 没有返回结果；本页不会回退到缓存或猜测状态。' : 'Harness Plugin Registry returned no result; this page does not fall back to cached or inferred state.'}</p><button type="button" onClick={() => { setRequest(value => value + 1) }}><PaimindRefreshIcon aria-hidden="true" />{zh ? '重新读取' : 'Read again'}</button></div>}
    {inventory.status === 'ready' && visible.length === 0 && <div data-paimind-extension-status role="status"><PaimindSearchIcon aria-hidden="true" /><h3>{zh ? '没有匹配的能力' : 'No matching capabilities'}</h3><p>{category === 'governance' && normalizedQuery.length === 0
      ? (zh
          ? '当前没有可信身份提供方，因此不展示治理扩展；Harness Full Access 不等于企业管理员权限。'
          : 'No trusted identity provider is configured, so no governance extension is shown. Harness Full Access is not enterprise administrator authority.')
      : (zh ? '请调整搜索词或类别筛选。' : 'Adjust the search term or category filter.')}</p><button type="button" onClick={clearFilters}>{zh ? '清除筛选' : 'Clear filters'}</button></div>}
    {inventory.status === 'ready' && <div data-paimind-extension-groups>{PAIMIND_EXTENSION_CATEGORIES.map(categoryId => {
      const rows = visible.filter(extension => extension.category === categoryId)
      if (rows.length === 0) return null
      return <section key={categoryId} data-paimind-extension-group>
        <header data-paimind-extension-group-header><div><h3>{zh ? CATEGORY_COPY[categoryId].zh : CATEGORY_COPY[categoryId].en}</h3><p>{zh ? CATEGORY_DESCRIPTION_COPY[categoryId].zh : CATEGORY_DESCRIPTION_COPY[categoryId].en}</p></div><span>{rows.length}</span></header>
        <div data-paimind-extension-grid>{rows.map(descriptor => {
          const projection = projectionById.get(descriptor.id) ?? projectExtensionTechnicalState(descriptor, inventory.snapshot)
          const open = expandedId === descriptor.id
          const detailsId = `${detailsBaseId}-${descriptor.id.replace(':', '-')}`
          const TechnicalIcon = projection.technicalState === 'active' ? PaimindCheckIcon : ATTENTION_STATES.has(projection.technicalState) ? PaimindWarningIcon : null
          return <article key={descriptor.id} data-paimind-extension-card data-open={open ? 'true' : 'false'}>
            <button type="button" data-paimind-extension-card-summary aria-expanded={open} aria-controls={detailsId} onClick={() => { setExpandedId(current => current === descriptor.id ? null : descriptor.id) }}>
              <div data-paimind-extension-card-copy><h4>{zh ? descriptor.nameZh : descriptor.nameEn}</h4><p>{zh ? descriptor.descriptionZh : descriptor.descriptionEn}</p></div>
              <span data-paimind-extension-card-meta><span data-paimind-extension-badge>{zh ? MATURITY_COPY[descriptor.maturity].zh : MATURITY_COPY[descriptor.maturity].en}</span><span data-paimind-extension-badge data-state={projection.technicalState}>{TechnicalIcon !== null && <TechnicalIcon aria-hidden="true" />}{zh ? TECHNICAL_COPY[projection.technicalState].zh : TECHNICAL_COPY[projection.technicalState].en}</span><PaimindChevronDownIcon aria-hidden="true" /></span>
              <span data-paimind-extension-location><PaimindSettingsIcon aria-hidden="true" /><span>{surfaceGuidance(descriptor, zh)}</span></span>
            </button>
            {open && <div id={detailsId} data-paimind-extension-details>
              <dl>
                <div><dt>{zh ? '产品成熟度' : 'Product maturity'}</dt><dd>{zh ? MATURITY_COPY[descriptor.maturity].zh : MATURITY_COPY[descriptor.maturity].en}</dd></div>
                <div><dt>{zh ? 'Harness 技术状态' : 'Harness technical state'}</dt><dd>{zh ? TECHNICAL_COPY[projection.technicalState].zh : TECHNICAL_COPY[projection.technicalState].en}</dd></div>
                <div><dt>{zh ? '使用与配置' : 'Use and configure'}</dt><dd>{surfaceGuidance(descriptor, zh)}</dd></div>
                <div><dt>{zh ? '入口类型' : 'Surface type'}</dt><dd>{zh ? SURFACE_COPY[descriptor.surface].zh : SURFACE_COPY[descriptor.surface].en}</dd></div>
                <div><dt>{zh ? '包标识' : 'Package id'}</dt><dd><code>{descriptor.packageName}</code></dd></div>
              </dl>
              <p data-paimind-extension-technical-note>{zh ? '版本、依赖、启停、安装与更新仍由 Harness Plugin Registry 管理；无真实接口的数据不会在此推断。' : 'Version, dependencies, enablement, installation, and updates remain managed by Harness Plugin Registry; unavailable facts are not inferred here.'}</p>
            </div>}
          </article>
        })}</div>
      </section>
    })}</div>}
    </section>
  </section>
}

class ExtensionCenterBoundary extends Component<{ readonly children: ReactNode; readonly fallback: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-extension-center]', error, info) }
  render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children }
}

interface FeaturePackRemoteNamespace {
  describe(): Promise<HarnessRemoteResult<PaimindFeaturePackView>>
  mutate(request: PaimindFeatureToggleMutationRequest): Promise<HarnessRemoteResult<PaimindFeaturePackView>>
}

interface ExtensionCenterRemote extends HarnessRemoteMountService {
  readonly pluginInventory: HarnessPluginInventoryRemote
  readonly paimindFeaturePacks?: FeaturePackRemoteNamespace
}

interface ExtensionCenterClientContext extends Omit<PaimindExtensionCenterClientContext, 'remote'> {
  readonly remote: ExtensionCenterRemote
  inject(
    dependencies: readonly string[],
    install: (ctx: ExtensionCenterClientContext) => void,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

/** Register one product Feature Pack control surface plus read-only technical diagnostics. */
export async function apply(ctx: ExtensionCenterClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...inject, 'remote.paimindFeaturePacks'], scopeCtx => {
    const featurePackRemote = scopeCtx.remote.paimindFeaturePacks
    if (featurePackRemote === undefined) throw new Error('PAIMind Feature Pack Remote did not mount')
    scopeCtx.effect(installStyle, 'paimind-extension-center: style')
    contributePaimindExtension(scopeCtx.slots, SELF)

    let cachedVersion = -1
    let cachedExtensions: readonly Readonly<PaimindExtensionDescriptor>[] = Object.freeze([])
    const getExtensions = (): readonly Readonly<PaimindExtensionDescriptor>[] => {
      const version = scopeCtx.slots.getVersion(SLOT)
      if (version === cachedVersion) return cachedExtensions
      const seen = new Set<string>()
      cachedExtensions = Object.freeze(scopeCtx.slots.entries(SLOT)
        .map(descriptorFromEntry)
        .filter(isDescriptor)
        .filter(descriptor => {
          if (seen.has(descriptor.id)) return false
          seen.add(descriptor.id)
          return true
        })
        .sort(compareExtensionDescriptors))
      cachedVersion = version
      return cachedExtensions
    }
    const listInventory = async (): Promise<HarnessPluginInventorySnapshot> => {
      const result = await scopeCtx.remote.pluginInventory.list()
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    }
    const describeFeaturePacks = async (): Promise<PaimindFeaturePackView> => {
      const result = await featurePackRemote.describe()
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    }
    const mutateFeaturePack = async (request: PaimindFeatureToggleMutationRequest): Promise<PaimindFeaturePackView> => {
      const result = await featurePackRemote.mutate(request)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    }
    let bootCheckTimer: ReturnType<typeof setTimeout> | undefined
    let bootCheckDisposed = false
    let bootCheckAttempt = 0
    const checkBootConsistency = async (): Promise<void> => {
      if (bootCheckDisposed) return
      document.documentElement.setAttribute(BOOT_CONSISTENCY_ATTRIBUTE, 'checking')
      try {
        const [view, inventory] = await Promise.all([describeFeaturePacks(), listInventory()])
        if (bootCheckDisposed) return
        const unsettled = view.status === 'ready' && view.packs.some(pack => (
          (pack.desiredEnabled ?? pack.defaultEnabled) && !pack.enabled && pack.failure === undefined
        ))
        const gaps = findPaimindFeaturePackClientGaps(view, inventory, getExtensions())
        if (!unsettled && gaps.length === 0) {
          window.sessionStorage.removeItem(BOOT_RECOVERY_SESSION_KEY)
          document.documentElement.setAttribute(BOOT_CONSISTENCY_ATTRIBUTE, 'ready')
          return
        }
        if (!unsettled && gaps.length > 0) {
          if (window.sessionStorage.getItem(BOOT_RECOVERY_SESSION_KEY) !== 'attempted') {
            window.sessionStorage.setItem(BOOT_RECOVERY_SESSION_KEY, 'attempted')
            document.documentElement.setAttribute(BOOT_CONSISTENCY_ATTRIBUTE, 'reloading')
            window.location.reload()
            return
          }
          document.documentElement.setAttribute(BOOT_CONSISTENCY_ATTRIBUTE, 'failed')
          console.error('[paimind-extension-center] Client Feature Pack recovery remained incomplete', gaps)
          return
        }
      } catch {
        // The always-on Settings surface owns the readable remote error state.
        // Keep the bounded startup check quiet until its final attempt.
      }
      bootCheckAttempt += 1
      if (bootCheckAttempt < 20) {
        bootCheckTimer = setTimeout(() => { void checkBootConsistency() }, 250)
      } else {
        document.documentElement.setAttribute(BOOT_CONSISTENCY_ATTRIBUTE, 'failed')
        console.error('[paimind-extension-center] Feature Pack boot consistency did not settle within 5 seconds')
      }
    }
    scopeCtx.effect(() => {
      bootCheckTimer = setTimeout(() => { void checkBootConsistency() }, 250)
      return () => {
        bootCheckDisposed = true
        if (bootCheckTimer !== undefined) clearTimeout(bootCheckTimer)
        document.documentElement.removeAttribute(BOOT_CONSISTENCY_ATTRIBUTE)
      }
    }, 'paimind-extension-center: bounded Client Feature Pack readiness')
    const injectSection = (): ExtensionCenterInjected => ({
      getExtensions,
      subscribeExtensions: listener => scopeCtx.slots.subscribe(SLOT, listener),
      listInventory,
      describeFeaturePacks,
      mutateFeaturePack,
      reloadApplication: () => { window.location.reload() },
      locale: scopeCtx.locale,
    })
    const label = (): string => scopeCtx.locale.getLocale().active.startsWith('zh') ? '扩展中心' : 'Extension Center'

    scopeCtx.slots.inject('settings.section', () => scopeCtx.slots.register({
      name: 'settings.section',
      id: 'paimind-extensions',
      order: 17,
      label,
      inject: injectSection,
      children: { [SLOT]: { kind: 'list', scope: 'root' } },
    }, props => <ExtensionCenterBoundary fallback={<div data-paimind-extension-boundary role="alert">{scopeCtx.locale.getLocale().active.startsWith('zh') ? '扩展中心遇到错误，其他 Harness 插件仍可继续工作。' : 'Extension Center encountered an error. Other Harness plugins can continue working.'}</div>}><ExtensionCenterSection {...props as ExtensionCenterProps} /></ExtensionCenterBoundary>))
  })
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
