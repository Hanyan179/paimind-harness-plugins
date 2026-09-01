import {
  Component,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import {
  PAIMIND_EXTENSION_CATEGORIES,
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
  PaimindAgentIcon,
  PaimindCheckIcon,
  PaimindChevronRightIcon,
  PaimindDeveloperIcon,
  PaimindExtensionIcon,
  PaimindPersonalizationIcon,
  PaimindRefreshIcon,
  PaimindSchedulerIcon,
  PaimindSearchIcon,
  PaimindSkillIcon,
  PaimindWarningIcon,
} from '@paimind/harness-compat/client-icons'
import {
  compareExtensionDescriptors,
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

const TECHNICAL_COPY: Readonly<Record<ExtensionTechnicalState, { readonly zh: string; readonly en: string }>> = {
  active: { zh: '已加载', en: 'Active' },
  loading: { zh: '加载中', en: 'Loading' },
  failed: { zh: '加载失败', en: 'Failed' },
  disabled: { zh: '已停用', en: 'Disabled' },
  unobserved: { zh: '已启用 · 未观测', en: 'Enabled · Unobserved' },
  unavailable: { zh: '注册表未发现', en: 'Not in registry' },
}

const ATTENTION_STATES = new Set<ExtensionTechnicalState>(['failed', 'disabled', 'unavailable'])
const CATEGORY_SET = new Set<string>(PAIMIND_EXTENSION_CATEGORIES)
const MATURITY_SET = new Set<string>(['available', 'technical-preview', 'reopened'])
const SURFACE_SET = new Set<string>(['shell', 'conversation', 'settings', 'header-button', 'side-card', 'preview', 'headless'])
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

const STYLE = `
[data-paimind-extension-center]{--extension-ink:var(--paimind-ink,var(--dsw-alias-label-primary,#17223a));--extension-muted:var(--paimind-muted,var(--dsw-alias-label-secondary,#65718a));--extension-faint:var(--dsw-alias-label-tertiary,#7c8798);--extension-line:var(--paimind-line,var(--dsw-alias-border-l1,rgba(110,128,154,.16)));--extension-line-strong:var(--dsw-alias-border-l2,rgba(110,128,154,.26));--extension-accent:var(--paimind-accent,var(--dsw-alias-state-business-primary,#3471f5));--extension-surface:var(--paimind-glass-strong,var(--dsw-alias-bg-layer-2,#fff));--extension-soft:var(--paimind-glass,var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05)));--extension-canvas:var(--paimind-canvas,var(--dsw-alias-bg-layer-2,#fff));--extension-radius:var(--paimind-radius,16px);box-sizing:border-box;min-width:0;min-height:100%;padding:24px;color:var(--extension-ink);font:inherit}
[data-paimind-extension-center] *{box-sizing:border-box}
[data-paimind-extension-header]{display:grid;gap:6px;margin-bottom:14px}
[data-paimind-extension-header] h2{margin:0;font-size:20px;line-height:28px;font-weight:680;letter-spacing:-.02em}
[data-paimind-extension-header] p{margin:0;max-width:680px;color:var(--extension-muted);font-size:13px;line-height:20px}
[data-paimind-extension-note]{display:flex;gap:9px;align-items:flex-start;margin:12px 0 0;padding:9px 11px;border:1px solid var(--extension-line);border-radius:10px;background:var(--extension-soft);color:var(--extension-muted);font-size:12px;line-height:18px}
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
[data-paimind-technical-catalog]{overflow:hidden;border:1px solid var(--extension-line);border-radius:14px;background:color-mix(in srgb,var(--extension-surface) 94%,transparent)}
[data-paimind-technical-catalog]>summary{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;padding:14px 16px;color:var(--extension-muted);cursor:pointer;list-style:none}
[data-paimind-technical-catalog]>summary::-webkit-details-marker{display:none}
[data-paimind-technical-catalog]>summary:hover{background:var(--extension-soft)}
[data-paimind-technical-catalog]>summary>span:first-child{display:grid;gap:2px}
[data-paimind-technical-catalog]>summary strong{color:var(--extension-ink);font-size:14px;line-height:20px}
[data-paimind-technical-catalog]>summary small{font-size:11px;line-height:17px}
[data-paimind-technical-catalog]>summary svg{color:var(--extension-faint);transition:transform 160ms ease}
[data-paimind-technical-catalog][open]>summary svg{transform:rotate(180deg)}
[data-paimind-technical-catalog-body]{padding:0 16px 16px;border-top:1px solid var(--extension-line)}
[data-paimind-extension-summary]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:hidden;margin:14px 0;border:1px solid var(--extension-line);border-radius:12px;background:color-mix(in srgb,var(--extension-surface) 90%,transparent)}
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
[data-paimind-extension-center]{display:grid;align-content:start;gap:18px;min-height:720px;padding:28px 30px}
[data-paimind-extension-header]{margin:0}
[data-paimind-extension-header] h2{font-size:24px;line-height:32px}
[data-paimind-pack-toolbar]{display:grid;grid-template-columns:minmax(240px,560px) auto;align-items:center;gap:18px}
[data-paimind-pack-toolbar] [data-paimind-extension-search]{margin:0}
[data-paimind-pack-filters]{display:flex;justify-content:flex-end;gap:20px;border-bottom:1px solid var(--extension-line)}
[data-paimind-pack-filter]{position:relative;min-height:38px;padding:7px 0 10px;border:0;color:var(--extension-muted);background:transparent;font:inherit;font-size:12px;cursor:pointer}
[data-paimind-pack-filter][aria-pressed='true']{color:var(--extension-accent);font-weight:650}
[data-paimind-pack-filter][aria-pressed='true']::after{content:'';position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px;background:var(--extension-accent)}
[data-paimind-feature-pack-grid]{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
[data-paimind-feature-pack]{position:relative;display:grid;gap:14px;min-height:142px;padding:0;border-radius:16px;background:var(--extension-surface);transition:border-color 160ms ease,box-shadow 160ms ease}
[data-paimind-feature-pack]:hover{border-color:color-mix(in srgb,var(--extension-accent) 28%,var(--extension-line));box-shadow:0 10px 30px rgba(37,58,92,.07)}
[data-paimind-feature-pack][data-enabled='false']{opacity:.72;background:var(--extension-soft)}
[data-paimind-feature-pack-open]{display:grid;grid-template-columns:46px minmax(0,1fr);gap:12px;width:100%;padding:18px 70px 12px 18px;border:0;color:inherit;background:transparent;font:inherit;text-align:left;cursor:pointer}
[data-paimind-feature-pack-icon]{display:grid;place-items:center;width:46px;height:46px;border-radius:13px;color:var(--extension-accent);background:color-mix(in srgb,var(--extension-accent) 10%,var(--extension-surface))}
[data-paimind-feature-pack-icon] svg{width:21px;height:21px}
[data-paimind-feature-pack-copy] h4{font-size:15px;line-height:22px}
[data-paimind-feature-pack-copy] p{display:-webkit-box;margin-top:4px;overflow:hidden;font-size:12px;line-height:18px;-webkit-box-orient:vertical;-webkit-line-clamp:2}
[data-paimind-feature-pack]>[data-paimind-feature-switch]{position:absolute;top:22px;right:18px}
[data-paimind-feature-pack-meta]{align-items:center;padding:0 18px 16px;font-size:11px}
[data-paimind-pack-state]{display:inline-flex;align-items:center;gap:5px}
[data-paimind-pack-state]::before{content:'';width:6px;height:6px;border-radius:50%;background:#2aa66d}
[data-paimind-pack-state][data-state='attention']::before{background:#d38b25}
[data-paimind-pack-state][data-state='disabled']::before{background:var(--extension-faint)}
[data-paimind-pack-empty]{padding:56px 20px;color:var(--extension-muted);text-align:center}
[data-paimind-pack-detail]{display:grid;gap:18px}
[data-paimind-pack-back]{justify-self:start;display:inline-flex;align-items:center;gap:6px;padding:0;border:0;color:var(--extension-muted);background:transparent;font:inherit;font-size:12px;cursor:pointer}
[data-paimind-pack-back] svg{transform:rotate(180deg)}
[data-paimind-pack-detail-header]{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:14px;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--extension-line)}
[data-paimind-pack-detail-header] [data-paimind-feature-pack-icon]{width:52px;height:52px}
[data-paimind-pack-detail-header] h3{margin:0;font-size:21px;line-height:29px}
[data-paimind-pack-detail-header] p{margin:3px 0 0;color:var(--extension-muted);font-size:12px;line-height:18px}
[data-paimind-pack-extensions]{overflow:hidden;border:1px solid var(--extension-line);border-radius:16px;background:var(--extension-surface)}
[data-paimind-pack-extensions-header]{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--extension-line)}
[data-paimind-pack-extensions-header] h4{margin:0;font-size:13px;line-height:20px}
[data-paimind-pack-extensions-header] span{color:var(--extension-faint);font-size:11px}
[data-paimind-pack-extension-row]{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:18px;align-items:center;min-height:66px;padding:11px 16px;border-bottom:1px solid var(--extension-line)}
[data-paimind-pack-extension-row]:last-child{border-bottom:0}
[data-paimind-pack-extension-row] strong{display:block;font-size:13px;line-height:19px}
[data-paimind-pack-extension-row] code{display:block;margin-top:2px;color:var(--extension-faint);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;line-height:15px}
[data-paimind-pack-extension-row] [data-paimind-extension-badge]{font-size:10px}
@media(max-width:920px){[data-paimind-pack-toolbar]{grid-template-columns:1fr}[data-paimind-pack-filters]{justify-content:flex-start;overflow-x:auto}[data-paimind-feature-pack-grid]{grid-template-columns:1fr}}
@media(max-width:560px){[data-paimind-extension-center]{position:static;inset:auto;min-height:100%;padding:18px;border-radius:0;box-shadow:none}[data-paimind-pack-detail-header]{grid-template-columns:44px minmax(0,1fr)}[data-paimind-pack-detail-header]>[data-paimind-feature-switch]{grid-column:1/-1}[data-paimind-pack-extension-row]{grid-template-columns:minmax(0,1fr) auto}[data-paimind-pack-extension-row]>[data-paimind-feature-switch]{grid-column:1/-1}}
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

type PackFilter = 'all' | 'enabled' | 'attention' | 'disabled'

function FeaturePackIcon(props: { readonly id: string }): React.JSX.Element {
  if (props.id === 'paimind:pack:experience') return <PaimindPersonalizationIcon aria-hidden="true" />
  if (props.id === 'paimind:pack:agents') return <PaimindAgentIcon aria-hidden="true" />
  if (props.id === 'paimind:pack:content') return <PaimindExtensionIcon aria-hidden="true" />
  if (props.id === 'paimind:pack:proposal') return <PaimindSkillIcon aria-hidden="true" />
  if (props.id === 'paimind:pack:automation') return <PaimindSchedulerIcon aria-hidden="true" />
  return <PaimindDeveloperIcon aria-hidden="true" />
}

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
  const [filter, setFilter] = useState<PackFilter>('all')
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  const [request, setRequest] = useState(0)
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading' })
  const [featurePacks, setFeaturePacks] = useState<FeaturePackState>({ status: 'loading' })
  const [pendingToggle, setPendingToggle] = useState<string | null>(null)
  const [featurePackFeedback, setFeaturePackFeedback] = useState('')

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
  const extensionByPackageName = useMemo(() => new Map(extensions.map(extension => [
    extension.packageName,
    extension,
  ])), [extensions])
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
  const packNeedsAttention = (pack: Readonly<PaimindFeaturePackState>): boolean => {
    if (pack.failure !== undefined) return true
    if (!(pack.desiredEnabled ?? pack.enabled) || inventory.status !== 'ready') return false
    return expectedPackPackageNames(pack).some(packageName => (
      ATTENTION_STATES.has(packModuleStateByPackageName.get(packageName) ?? 'unavailable')
    ))
  }
  const visiblePacks = featurePacks.status === 'ready' ? featurePacks.view.packs.filter(pack => {
    const desiredEnabled = pack.desiredEnabled ?? pack.enabled
    const matchesQuery = normalizedQuery === '' || [
      pack.nameZh,
      pack.nameEn,
      pack.descriptionZh,
      pack.descriptionEn,
      ...pack.packageNames,
      ...pack.packageNames.flatMap(packageName => {
        const descriptor = extensionByPackageName.get(packageName)
        return descriptor === undefined ? [] : [descriptor.nameZh, descriptor.nameEn]
      }),
    ].some(value => value.toLocaleLowerCase(locale).includes(normalizedQuery))
    if (!matchesQuery) return false
    if (filter === 'enabled') return desiredEnabled && !packNeedsAttention(pack)
    if (filter === 'attention') return packNeedsAttention(pack)
    if (filter === 'disabled') return !desiredEnabled
    return true
  }) : []
  const featurePackView = featurePacks.status === 'ready' ? featurePacks.view : undefined
  const selectedPack = featurePackView !== undefined
    ? featurePackView.packs.find(pack => pack.id === selectedPackId)
    : undefined

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

  const packStatus = (pack: Readonly<PaimindFeaturePackState>): { readonly state: 'enabled' | 'attention' | 'disabled'; readonly label: string } => {
    const desiredEnabled = pack.desiredEnabled ?? pack.enabled
    if (!desiredEnabled) return { state: 'disabled', label: zh ? '已关闭' : 'Disabled' }
    if (inventory.status === 'loading') return { state: 'enabled', label: zh ? '同步中' : 'Syncing' }
    if (inventory.status === 'error') return { state: 'attention', label: zh ? '状态不可用' : 'Status unavailable' }
    if (packNeedsAttention(pack)) return { state: 'attention', label: pack.failure === undefined ? (zh ? '部分运行' : 'Partially running') : (zh ? '启动失败' : 'Failed') }
    return { state: 'enabled', label: zh ? '运行中' : 'Running' }
  }

  return <section data-paimind-extension-center aria-label={zh ? '扩展中心' : 'Extension Center'}>
    <header data-paimind-extension-header>
      <h2>{zh ? '扩展中心' : 'Extension Center'}</h2>
    </header>
    {selectedPack === undefined && <section data-paimind-feature-pack-section aria-label={zh ? '功能包' : 'Feature Packs'}>
      <div data-paimind-pack-toolbar>
        <label data-paimind-extension-search>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{zh ? '搜索功能包或扩展' : 'Search packs or extensions'}</span>
          <PaimindSearchIcon aria-hidden="true" />
          <input type="search" value={query} placeholder={zh ? '搜索功能包或扩展' : 'Search packs or extensions'} onChange={event => { setQuery(event.currentTarget.value) }} />
        </label>
        <nav data-paimind-pack-filters aria-label={zh ? '功能包筛选' : 'Feature Pack filters'}>
          {(['all', 'enabled', 'attention', 'disabled'] as const).map(value => <button key={value} type="button" data-paimind-pack-filter aria-pressed={filter === value} onClick={() => { setFilter(value) }}>{value === 'all' ? (zh ? '全部' : 'All') : value === 'enabled' ? (zh ? '已启用' : 'Enabled') : value === 'attention' ? (zh ? '需关注' : 'Attention') : (zh ? '已关闭' : 'Disabled')}</button>)}
        </nav>
      </div>
      {featurePacks.status === 'loading' && <div data-paimind-extension-status aria-busy="true">{zh ? '正在读取功能包状态…' : 'Reading Feature Pack state…'}</div>}
      {featurePacks.status === 'error' && <div data-paimind-extension-status role="alert">{zh ? '暂时无法读取功能包状态。' : 'Feature Pack state is temporarily unavailable.'}</div>}
      {featurePacks.status === 'unavailable' && <div data-paimind-extension-status role="note">{zh ? '当前不可管理功能包。' : 'Feature Packs are unavailable.'}</div>}
      {inventory.status === 'loading' && <div data-paimind-extension-status aria-busy="true" aria-live="polite"><PaimindRefreshIcon aria-hidden="true" /><p>{zh ? '正在同步扩展状态…' : 'Syncing extension status…'}</p></div>}
      {inventory.status === 'error' && <div data-paimind-extension-status><PaimindWarningIcon aria-hidden="true" /><p role="alert">{zh ? '扩展状态暂时不可用。' : 'Extension status is temporarily unavailable.'}</p><button type="button" onClick={() => { setRequest(value => value + 1) }}><PaimindRefreshIcon aria-hidden="true" />{zh ? '重试' : 'Retry'}</button></div>}
      {featurePacks.status === 'ready' && visiblePacks.length === 0 && <div data-paimind-pack-empty>{zh ? '没有匹配的功能包。' : 'No matching Feature Packs.'}</div>}
      {featurePacks.status === 'ready' && visiblePacks.length > 0 && <div data-paimind-feature-pack-grid>{visiblePacks.map(pack => {
        const desiredEnabled = pack.desiredEnabled ?? pack.enabled
        const expectedPackageNames = expectedPackPackageNames(pack)
        const activePackageCount = expectedPackageNames.filter(packageName => (
          packModuleStateByPackageName.get(packageName) === 'active'
        )).length
        const complete = !desiredEnabled || (pack.failure === undefined && activePackageCount === expectedPackageNames.length)
        const status = packStatus(pack)
        return <article key={pack.id} data-paimind-feature-pack data-enabled={pack.enabled ? 'true' : 'false'} data-complete={complete ? 'true' : 'false'}>
          <button type="button" data-paimind-feature-pack-open aria-label={`${zh ? '打开' : 'Open'} ${zh ? pack.nameZh : pack.nameEn}`} onClick={() => { setSelectedPackId(pack.id) }}>
            <span data-paimind-feature-pack-icon><FeaturePackIcon id={pack.id} /></span>
            <span data-paimind-feature-pack-copy><h4>{zh ? pack.nameZh : pack.nameEn}</h4><p>{zh ? pack.descriptionZh : pack.descriptionEn}</p></span>
          </button>
          <button
            type="button" role="switch" data-paimind-feature-switch
            aria-label={`${zh ? pack.nameZh : pack.nameEn} · ${pack.failure === undefined ? (desiredEnabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Disabled')) : (zh ? '启用失败' : 'Failed to enable')}`}
            aria-checked={desiredEnabled}
            disabled={!pack.installed || !featurePacks.view.writable || pendingToggle !== null}
            onClick={() => { void toggleFeature(pack.id, !desiredEnabled) }}
          />
          <div data-paimind-feature-pack-meta><span>{desiredEnabled && !complete ? `${activePackageCount} / ${expectedPackageNames.length}` : pack.packageNames.length} {zh ? '个扩展' : 'extensions'}</span><span data-paimind-pack-state data-state={status.state}>{status.label}</span></div>
        {pack.failure !== undefined && <p data-paimind-feature-pack-error role="alert">{pack.failure}</p>}
      </article>
      })}</div>}
      {featurePackFeedback !== '' && <div data-paimind-feature-pack-feedback role="status">{featurePackFeedback}</div>}
    </section>}
    {selectedPack !== undefined && <section data-paimind-pack-detail>
      <button type="button" data-paimind-pack-back onClick={() => { setSelectedPackId(null) }}><PaimindChevronRightIcon aria-hidden="true" />{zh ? '返回扩展中心' : 'Back to Extension Center'}</button>
      <header data-paimind-pack-detail-header>
        <span data-paimind-feature-pack-icon><FeaturePackIcon id={selectedPack.id} /></span>
        <div><h3>{zh ? selectedPack.nameZh : selectedPack.nameEn}</h3><p>{zh ? selectedPack.descriptionZh : selectedPack.descriptionEn}</p></div>
        <button
          type="button" role="switch" data-paimind-feature-switch
          aria-label={`${zh ? selectedPack.nameZh : selectedPack.nameEn} · ${(selectedPack.desiredEnabled ?? selectedPack.enabled) ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Disabled')}`}
          aria-checked={selectedPack.desiredEnabled ?? selectedPack.enabled}
          disabled={!selectedPack.installed || featurePackView?.writable !== true || pendingToggle !== null}
          onClick={() => { void toggleFeature(selectedPack.id, !(selectedPack.desiredEnabled ?? selectedPack.enabled)) }}
        />
      </header>
      {selectedPack.failure !== undefined && <p data-paimind-feature-pack-error role="alert">{selectedPack.failure}</p>}
      <section data-paimind-pack-extensions aria-label={zh ? '包内扩展' : 'Extensions in this pack'}>
        <header data-paimind-pack-extensions-header><h4>{zh ? '包内扩展' : 'Extensions'}</h4><span>{selectedPack.packageNames.length}</span></header>
        {selectedPack.packageNames.map(packageName => {
          const descriptor = extensionByPackageName.get(packageName)
          const technicalState = inventory.status === 'ready' ? (packModuleStateByPackageName.get(packageName) ?? 'unavailable') : 'loading'
          const capability = selectedPack.capabilities.find(item => item.packageNames.includes(packageName))
          const TechnicalIcon = technicalState === 'active' ? PaimindCheckIcon : ATTENTION_STATES.has(technicalState) ? PaimindWarningIcon : null
          return <div key={packageName} data-paimind-pack-extension-row>
            <div><strong>{descriptor === undefined ? packageName.replace('@paimind/', '') : (zh ? descriptor.nameZh : descriptor.nameEn)}</strong><code>{packageName}</code></div>
            <span data-paimind-extension-badge data-state={technicalState}>{TechnicalIcon !== null && <TechnicalIcon aria-hidden="true" />}{zh ? TECHNICAL_COPY[technicalState].zh : TECHNICAL_COPY[technicalState].en}</span>
            {capability !== undefined && <button
              type="button" role="switch" data-paimind-feature-switch
              aria-label={`${zh ? capability.nameZh : capability.nameEn} · ${capability.failure === undefined ? ((capability.desiredEnabled ?? capability.enabled) ? (zh ? '已启用' : 'Enabled') : (zh ? '已关闭' : 'Disabled')) : (zh ? '启用失败' : 'Failed to enable')}`}
              aria-checked={capability.desiredEnabled ?? capability.enabled}
              disabled={!selectedPack.enabled || selectedPack.failure !== undefined || !capability.installed || featurePackView?.writable !== true || pendingToggle !== null}
              onClick={() => { void toggleFeature(capability.id, !(capability.desiredEnabled ?? capability.enabled)) }}
            />}
          </div>
        })}
      </section>
      {featurePackFeedback !== '' && <div data-paimind-feature-pack-feedback role="status">{featurePackFeedback}</div>}
    </section>}
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
