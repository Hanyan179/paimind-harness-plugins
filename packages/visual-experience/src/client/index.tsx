import { PAIMIND_UI_FOUNDATION_CSS, installPaimindMotionPreference, readPaimindMotion, subscribePaimindMotion, type PaimindMotionPreference } from '@hansen/ui-foundation'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ResourceNavigationSlot } from './resource-navigation.js'
import {
  markHarnessClientStyle,
  contributePaimindExtension,
  installHarnessSettingsNavigationIcons,
  installHarnessSettingsTriggerAccessibility,
  installHarnessSettingsSectionScrollReset,
  resolveHarnessSettingsNamespace,
  resolveHarnessAgentPresetSeatControl,
  type HarnessAgentChoice,
  type HarnessAgentChoiceBridge,
  type HarnessAgentPresetConnection,
  type HarnessSkillConnection,
  type HarnessInspectableSlotRegistry,
  type PaimindClientContext,
  type PaimindSettingsScope,
  type PaimindSettingsScopeBinder,
  type PaimindThemeService,
} from '@hansen/harness-compat'
import {
  NativeHarnessInputTriggerBridge,
  type HarnessComposerInputSnapshot,
  type HarnessInputTriggerSource,
} from '@hansen/harness-compat'
import {
  HarnessExperienceMarkers,
  NativeHarnessAgentChoiceBridge,
  resolvePaimindAgentAvatarOverride,
  subscribePaimindAgentAvatarOverrides,
  isPaimindProductSurfaceAvailable,
  requestPaimindAgentBuilder,
  requestPaimindProductSurface,
} from '@hansen/harness-compat/client-surface'
import {
  PaimindAgentIcon,
  PaimindCheckIcon,
  PaimindChevronDownIcon,
  PaimindChevronRightIcon,
  PaimindDeveloperIcon,
  PaimindConnectionIcon,
  PaimindTemplateIcon,
  PaimindMarketplaceIcon,
  PaimindExtensionIcon,
  PaimindNewConversationIcon,
  PaimindPersonalizationIcon,
  PaimindPlusIcon,
  PaimindSchedulerIcon,
} from '@hansen/harness-compat/client-icons'
import { APPEARANCE_STYLE } from './appearance-style.js'
import HERO_LIGHT from '../../assets/hero-ridge-light.webp'
import HERO_DARK from '../../assets/hero-ridge-dark.webp'
import {
  canonicalIdFromPaimindAgentAvatarIcon,
  paimindAgentAvatarIcon,
  resolvePaimindAgentAvatar,
} from './agent-avatars.js'
import {
  DEFAULT_PAIMIND_EXPERIENCE_MODE,
  PAIMIND_VISUAL_EXPERIENCE_NAMESPACE,
  decodePaimindVisualExperienceSettings,
  type PaimindExperienceMode,
  type PaimindVisualExperienceSettings,
} from '../settings.js'

const PACKAGE_NAME = '@hansen/visual-experience'
const STYLE_ID = PACKAGE_NAME

const BASE_INJECT = [
  'slots', 'locale', 'connection', 'remote', 'settingsScope', 'theme', 'inputTriggers', 'sessions',
] as const
export const inject = [...BASE_INJECT]

interface VisualExperienceClientContext extends PaimindClientContext {
  readonly slots: HarnessInspectableSlotRegistry
  readonly settingsScope: PaimindSettingsScopeBinder
  readonly theme: PaimindThemeService
  get(name: 'connection'): HarnessAgentPresetConnection & HarnessSkillConnection
  get(name: 'inputTriggers' | 'sessions'): unknown
}

interface ExperienceModeSnapshot {
  readonly mode: PaimindExperienceMode
  readonly motion: PaimindMotionPreference
  readonly error: boolean
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly writable: boolean
  readonly busy: boolean
}

export class PaimindExperienceModeController {
  private snapshot: ExperienceModeSnapshot = Object.freeze({
    mode: DEFAULT_PAIMIND_EXPERIENCE_MODE,
    motion: 'system',
    error: false,
    status: 'loading',
    writable: false,
    busy: false,
  })
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private disposed = false

  constructor(private readonly scope: PaimindSettingsScope<PaimindVisualExperienceSettings>) {
    this.unsubscribe = scope.subscribe(() => { this.adopt() })
    this.adopt()
  }

  getSnapshot = (): ExperienceModeSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(mode: PaimindExperienceMode): Promise<void> { await this.update('mode', mode) }
  async setMotion(motion: PaimindMotionPreference): Promise<void> { await this.update('motion', motion) }

  private async update<Key extends keyof PaimindVisualExperienceSettings>(field: Key, value: PaimindVisualExperienceSettings[Key]): Promise<void> {
    if (this.disposed || this.snapshot.busy || !this.snapshot.writable || this.snapshot[field] === value) return
    const previous = this.snapshot
    this.publish({ ...previous, [field]: value, busy: true, error: false })
    let failed = false
    try {
      await this.scope.set(field, value)
    } catch {
      failed = true
    } finally {
      if (!this.disposed) {
        const state = this.scope.getSnapshot()
        this.publish({
          mode: state.value?.mode ?? previous.mode,
          motion: state.value?.motion ?? previous.motion,
          status: state.status,
          writable: state.writable,
          busy: false,
          error: failed || state.status !== 'ready' || state.value?.[field] !== value,
        })
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.listeners.clear()
  }

  private adopt(): void {
    if (this.disposed) return
    const state = this.scope.getSnapshot()
    this.publish({
      mode: state.value?.mode ?? DEFAULT_PAIMIND_EXPERIENCE_MODE,
      motion: state.value?.motion ?? 'system',
      error: false,
      status: state.status,
      writable: state.writable,
      busy: this.snapshot.busy,
    })
  }

  private publish(snapshot: ExperienceModeSnapshot): void {
    if (this.snapshot.motion === snapshot.motion
      && this.snapshot.error === snapshot.error
      && this.snapshot.mode === snapshot.mode
      && this.snapshot.status === snapshot.status
      && this.snapshot.writable === snapshot.writable
      && this.snapshot.busy === snapshot.busy) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of [...this.listeners]) listener()
  }
}

const THEME_TOKENS = Object.freeze({
  '--dsw-alias-bg-base': { light: '#f7f8fb', dark: '#0c1320' },
  // Harness-owned structural surfaces must stay opaque so dialogs never reveal
  // unrelated page content. Plugin-owned glass surfaces use --paimind-glass below.
  '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#141d2d' },
  '--dsw-alias-bg-layer-2': { light: '#eff3f9', dark: '#1d283b' },
  '--dsw-alias-bg-overlay': { light: '#fcfcfb', dark: '#111927' },
  '--dsw-alias-border-l1': { light: 'rgba(19,45,76,.10)', dark: 'rgba(190,204,225,.13)' },
  '--dsw-alias-border-l2': { light: 'rgba(19,45,76,.18)', dark: 'rgba(190,204,225,.22)' },
  '--dsw-alias-brand-primary': { light: '#123d68', dark: '#8eb5df' },
  '--dsw-alias-label-primary': { light: '#142842', dark: '#edf3fb' },
  '--dsw-alias-label-secondary': { light: '#5d6f83', dark: '#a7b7ca' },
  '--dsw-alias-label-tertiary': { light: '#7c8b9c', dark: '#8192a8' },
  '--dsw-alias-label-caption': { light: '#98a4b2', dark: '#6f8299' },
  '--dsw-specific-sidebar-fill': { light: 'rgba(249,250,252,.92)', dark: 'rgba(13,21,34,.94)' },
  '--dsw-alias-state-business-primary': { light: '#356fa8', dark: '#78a9d9' },
})

const STYLE = `${PAIMIND_UI_FOUNDATION_CSS}
${APPEARANCE_STYLE}

body[data-paimind-experience='paimind']{
  --paimind-navy:#123d68;--paimind-navy-deep:#0b2f54;--paimind-accent:#4f83b8;
  --paimind-canvas:#f7f8fb;--paimind-warm:#fffdf9;--paimind-ink:#142842;
  --paimind-muted:#66798e;--paimind-line:rgba(19,45,76,.12);
  --paimind-glass:rgba(255,255,255,.74);--paimind-glass-strong:rgba(255,255,255,.9);
  --paimind-shadow:0 18px 50px rgba(24,48,75,.10);--paimind-radius:20px;
  color:var(--paimind-ink);background:var(--paimind-canvas);
}
body[data-paimind-experience='paimind'][data-ds-dark-theme]{
  --paimind-navy:#9fc2e5;--paimind-navy-deep:#d7e7f7;--paimind-accent:#78a9d9;
  --paimind-canvas:#0c1320;--paimind-warm:#131d2d;--paimind-ink:#edf3fb;
  --paimind-muted:#9eafc2;--paimind-line:rgba(190,204,225,.14);
  --paimind-glass:rgba(18,27,42,.76);--paimind-glass-strong:rgba(17,25,39,.92);
  --paimind-shadow:0 20px 58px rgba(0,0,0,.34);
}
body[data-paimind-experience='paimind'] [data-phase='hero'],
body[data-paimind-experience='paimind'] [data-phase='active'],
body[data-paimind-experience='paimind'] [data-phase='settling']{background:var(--paimind-canvas)!important}
body[data-paimind-experience='paimind'] [data-phase='hero']{position:relative;isolation:isolate;overflow:hidden}
body[data-paimind-experience='paimind'] [data-phase='hero']::before{
  content:'';position:absolute;inset:0;z-index:-2;pointer-events:none;
  background-image:url("${HERO_LIGHT}");background-position:center bottom;background-size:cover;background-repeat:no-repeat;
  opacity:.34;filter:saturate(.78) contrast(.92);
}
body[data-paimind-experience='paimind'][data-ds-dark-theme] [data-phase='hero']::before{background-image:url("${HERO_DARK}");opacity:.4;filter:saturate(.72) contrast(.9)}
body[data-paimind-experience='paimind'] [data-phase='hero']::after{
  content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background:linear-gradient(180deg,color-mix(in srgb,var(--paimind-canvas) 42%,transparent),color-mix(in srgb,var(--paimind-canvas) 8%,transparent) 52%,color-mix(in srgb,var(--paimind-canvas) 52%,transparent));
}
body[data-paimind-experience='paimind'] [data-phase='hero'] [data-composer-seat]{width:min(820px,calc(100% - 32px));margin:auto}
body[data-paimind-experience='paimind'] [data-phase='hero'] [data-slot='conversation.composer.bar']{display:block!important;order:4;width:100%}
body[data-paimind-experience='paimind'] [data-phase='hero'] [data-slot='conversation.input.dock']{display:block!important;order:5;width:100%;margin-top:8px}
body[data-paimind-experience='paimind'] [data-phase='hero'] [data-paimind-hero-brand-seat]{display:flex!important;flex-direction:column;align-items:center;gap:7px;margin-bottom:12px;text-align:center;color:var(--paimind-ink)}
body[data-paimind-experience='paimind'] [data-paimind-native-hero-preview]{display:none!important}
body[data-paimind-experience='paimind'] [data-paimind-paramont-hero-mark]{width:38px;height:25px;color:var(--paimind-navy-deep)}
[data-paimind-experience-copy]{display:contents}
[data-paimind-experience-eyebrow]{margin-top:-2px;color:var(--paimind-navy);font-size:10px;font-weight:750;line-height:14px;letter-spacing:.22em;text-transform:uppercase}
[data-paimind-experience-title]{max-width:760px;margin-top:1px;color:var(--paimind-ink);font-size:38px;font-weight:660;line-height:1.18;letter-spacing:-.035em;text-wrap:balance}
[data-paimind-experience-subtitle]{max-width:700px;color:var(--paimind-muted);font-size:13px;line-height:20px;text-wrap:balance}
body[data-paimind-experience='paimind'] [data-composer-card]{border:1px solid color-mix(in srgb,var(--paimind-line) 76%,white 24%)!important;border-radius:var(--paimind-radius)!important;background:var(--paimind-glass)!important;box-shadow:var(--paimind-shadow)!important;backdrop-filter:blur(20px) saturate(1.12);-webkit-backdrop-filter:blur(20px) saturate(1.12);transition:border-color var(--paimind-motion-enter,180ms) ease,background var(--paimind-motion-enter,180ms) ease,box-shadow var(--paimind-motion-slow,240ms) ease,transform var(--paimind-motion-enter,180ms) ease}
body[data-paimind-experience='paimind'] [data-composer-card]:focus-within{border-color:color-mix(in srgb,var(--paimind-accent) 62%,var(--paimind-line))!important;box-shadow:0 20px 58px rgba(30,61,93,.14),0 0 0 3px color-mix(in srgb,var(--paimind-accent) 20%,transparent)!important}
body[data-paimind-experience='paimind'] [data-composer-card] [data-input-backdrop='true']{color:var(--paimind-ink)!important}
body[data-paimind-experience='paimind'] [data-composer-card] textarea[data-phase]{background:transparent!important;color:transparent!important;-webkit-text-fill-color:transparent!important;caret-color:var(--paimind-accent)!important}
body[data-paimind-experience='paimind'] [data-composer-card] textarea[data-phase]::placeholder{color:var(--paimind-muted)!important;-webkit-text-fill-color:var(--paimind-muted)!important;opacity:1!important}
body[data-paimind-experience='paimind'] [data-composer-card] textarea[data-phase]::selection{color:transparent!important;-webkit-text-fill-color:transparent!important;background:color-mix(in srgb,var(--paimind-accent) 34%,transparent)!important}
body[data-paimind-experience='paimind'] [data-composer-card] textarea[data-phase]:disabled{caret-color:transparent!important}
body[data-paimind-experience='paimind'] [data-composer-card] textarea[data-phase]:disabled~[data-input-mirror='true'],
body[data-paimind-experience='paimind'] [data-composer-card]:has(textarea[data-phase]:disabled) [data-input-backdrop='true']{opacity:.58}
body[data-paimind-experience='paimind'] [data-composer-card] button[aria-haspopup='listbox']:not([data-paimind-context-launcher]){display:none!important}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor]{z-index:180}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [data-slot='conversation.input.overlay']{display:contents!important}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox']{
  box-sizing:border-box!important;top:auto!important;right:auto!important;bottom:calc(100% + 8px)!important;left:0!important;width:min(820px,100%)!important;min-width:0!important;max-width:100%!important;
  height:min(400px,var(--paimind-composer-overlay-room,400px))!important;max-height:min(400px,var(--paimind-composer-overlay-room,400px))!important;padding:0!important;border:1px solid var(--paimind-line)!important;
  border-radius:18px!important;background:var(--paimind-glass-strong)!important;box-shadow:0 24px 72px rgba(17,39,63,.2)!important;
  backdrop-filter:blur(24px) saturate(1.12);-webkit-backdrop-filter:blur(24px) saturate(1.12);animation:paimind-composer-menu-in var(--paimind-motion-enter,180ms) ease-out;
}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox']:has(>[data-paimind-composer-disclosure]){display:grid!important;grid-template-columns:minmax(250px,36%) minmax(360px,1fr);grid-template-rows:minmax(0,1fr);overflow:hidden!important}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox']:has(>[data-paimind-composer-disclosure])>:first-child{min-width:0;min-height:0;padding:8px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;border-right:1px solid var(--paimind-line)}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']{display:flex!important;align-items:center;gap:8px;min-width:0;min-height:36px;padding:7px 8px;border-radius:10px;color:var(--paimind-ink);font-size:12px;line-height:18px}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option'][aria-selected='true']{background:color-mix(in srgb,var(--paimind-accent) 17%,transparent)!important;box-shadow:inset 3px 0 0 var(--paimind-accent);font-weight:650}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>[aria-hidden]{display:inline-flex;flex:none;width:22px;height:22px;align-items:center;justify-content:center;border-radius:50%;background:color-mix(in srgb,var(--paimind-accent) 9%,transparent)}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>[data-paimind-agent-avatar-host]{width:30px;height:30px;overflow:hidden;background:transparent}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [data-paimind-candidate-name]{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [data-paimind-candidate-description]{display:none!important}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [data-paimind-context-kind-label]{flex:none;min-width:38px;color:var(--paimind-accent);font-size:9px;font-weight:700;line-height:14px;letter-spacing:.04em;text-transform:uppercase}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure]{display:grid;align-content:start;gap:16px;min-width:0;overflow:auto;padding:24px 26px;color:var(--paimind-ink)}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-header]{display:flex;align-items:flex-start;gap:12px;min-width:0}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-heading]{display:grid;gap:3px;min-width:0}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure] [data-paimind-composer-disclosure-avatar]{width:40px;height:40px}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure] small{color:var(--paimind-accent);font-size:10px;font-weight:750;line-height:15px;letter-spacing:.08em;text-transform:uppercase}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure] strong{font-size:18px;font-weight:680;line-height:25px;letter-spacing:-.012em;overflow-wrap:anywhere}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure] p{margin:0;color:var(--paimind-muted);font-size:12px;line-height:19px;overflow-wrap:anywhere}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-sections]{display:grid;gap:13px;padding-top:2px}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-section]{display:grid;gap:7px}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-section]>span{color:var(--paimind-muted);font-size:10px;font-weight:700;line-height:15px;letter-spacing:.04em}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-values]{display:flex;flex-wrap:wrap;gap:6px}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-values]>span,
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-values]>code{max-width:100%;padding:5px 8px;border:1px solid color-mix(in srgb,var(--paimind-line) 82%,transparent);border-radius:999px;color:var(--paimind-ink);background:color-mix(in srgb,var(--paimind-accent) 7%,transparent);font:inherit;font-size:10px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure-hint]{margin-top:auto;padding-top:2px;color:var(--paimind-muted);font-size:10px;line-height:15px}
body[data-paimind-experience='paimind'] [data-paimind-popup-select]{box-sizing:border-box!important;display:grid!important;grid-template-columns:minmax(250px,36%) minmax(360px,1fr)!important;grid-template-rows:auto minmax(0,1fr)!important;width:min(820px,100%)!important;min-width:0!important;max-width:100%!important;height:min(400px,var(--paimind-composer-overlay-room,400px))!important;max-height:min(400px,var(--paimind-composer-overlay-room,400px))!important;padding:0!important;border:1px solid var(--paimind-line)!important;border-radius:18px!important;background:var(--paimind-glass-strong)!important;box-shadow:0 24px 72px rgba(17,39,63,.2)!important;overflow:hidden!important}
body[data-paimind-experience='paimind'] [data-paimind-popup-select]>input[type='text']{grid-column:1;grid-row:1;box-sizing:border-box;width:calc(100% - 16px);min-height:38px;margin:8px;padding:8px 10px;border:1px solid var(--paimind-line);border-radius:10px;background:color-mix(in srgb,var(--paimind-glass-strong) 86%,transparent);color:var(--paimind-ink);outline:none}
body[data-paimind-experience='paimind'] [data-paimind-popup-select]>input[type='text']:focus{border-color:color-mix(in srgb,var(--paimind-accent) 58%,var(--paimind-line));box-shadow:0 0 0 3px color-mix(in srgb,var(--paimind-accent) 13%,transparent)}
body[data-paimind-experience='paimind'] [data-paimind-popup-select]>[role='listbox']{position:static!important;grid-column:1;grid-row:2;display:flex!important;flex-direction:column!important;width:auto!important;height:auto!important;max-height:none!important;margin:0!important;border:0!important;border-top:1px solid var(--paimind-line)!important;border-right:1px solid var(--paimind-line)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;backdrop-filter:none;animation:none;overflow-y:auto!important;padding:8px!important}
body[data-paimind-experience='paimind'] [data-paimind-popup-select]>[data-paimind-composer-disclosure]{grid-column:2;grid-row:1/3}
body[data-paimind-experience='paimind'][data-ds-dark-theme] [data-paimind-composer-overlay-anchor] [role='listbox']{background:var(--paimind-glass-strong)!important}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='presentation']{min-height:23px;padding:4px 8px;color:var(--paimind-muted);font-size:10px;font-weight:700;line-height:15px;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-agent-avatar]{display:block;flex:none;width:30px;height:30px;border:1px solid color-mix(in srgb,var(--paimind-line) 72%,white 28%);border-radius:50%;object-fit:cover;background:var(--paimind-glass-strong);box-shadow:0 1px 4px rgba(15,40,68,.12)}
[data-paimind-context-launcher]{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:5px 9px;border:0;border-radius:999px;color:var(--paimind-muted);background:transparent;font:inherit;font-size:12px;line-height:18px;cursor:pointer}
[data-paimind-context-launcher]:hover,[data-paimind-context-launcher]:focus-visible,[data-paimind-context-launcher][aria-expanded='true']{color:var(--paimind-navy);background:color-mix(in srgb,var(--paimind-accent) 11%,transparent);outline:none}
[data-paimind-context-launcher]:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--paimind-accent) 30%,transparent)}
[data-paimind-context-launcher]:disabled{opacity:.46;cursor:not-allowed}
body[data-paimind-experience='paimind'][data-paimind-composer-overlay='open'] [data-paimind-quick-agents]{visibility:hidden;opacity:0;pointer-events:none}
[data-paimind-quick-agents]{display:grid;gap:8px;width:calc(100% - 32px);margin-inline:16px;color:var(--paimind-muted)}
[data-paimind-quick-agents-label]{display:flex;align-items:center;gap:6px;padding:0 2px;font-size:11px;font-weight:650;line-height:16px;letter-spacing:.02em}
[data-paimind-quick-agents-list]{display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden}
[data-paimind-quick-agent],[data-paimind-quick-all]{display:inline-flex;align-items:center;gap:6px;min-width:0;min-height:38px;border:1px solid var(--paimind-line);border-radius:999px;color:var(--paimind-muted);background:color-mix(in srgb,var(--paimind-glass-strong) 82%,transparent);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:color var(--paimind-motion-fast,160ms) ease,border-color var(--paimind-motion-fast,160ms) ease,background var(--paimind-motion-fast,160ms) ease,transform var(--paimind-motion-fast,160ms) ease}
[data-paimind-quick-agent]{padding:4px 10px 4px 4px}
[data-paimind-quick-all]{padding:6px 11px}
[data-paimind-quick-agent] [data-paimind-agent-avatar]{width:28px;height:28px}
[data-paimind-quick-agent] span{overflow:hidden;text-overflow:ellipsis}
[data-paimind-quick-agent]:hover,[data-paimind-quick-agent]:focus-visible,[data-paimind-quick-all]:hover,[data-paimind-quick-all]:focus-visible{border-color:color-mix(in srgb,var(--paimind-accent) 42%,var(--paimind-line));color:var(--paimind-navy);background:var(--paimind-glass-strong);outline:none;transform:translateY(-1px)}
[data-paimind-quick-agent][aria-pressed='true']{border-color:color-mix(in srgb,var(--paimind-accent) 50%,var(--paimind-line));color:var(--paimind-navy);background:color-mix(in srgb,var(--paimind-accent) 10%,var(--paimind-glass-strong))}
[data-paimind-quick-agent]:disabled,[data-paimind-quick-all]:disabled{opacity:.46;cursor:not-allowed;transform:none}
[data-paimind-agent-picker-trigger]{display:inline-flex;align-items:center;gap:7px;max-width:260px;min-height:34px;padding:6px 10px;border:1px solid transparent;border-radius:999px;color:var(--paimind-ink);background:color-mix(in srgb,var(--paimind-ink) 5%,transparent);font:inherit;font-size:13px;line-height:18px;cursor:pointer;transition:background var(--paimind-motion-fast,160ms) ease,border-color var(--paimind-motion-fast,160ms) ease}
[data-paimind-agent-picker-trigger] span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-agent-picker-trigger]:hover,[data-paimind-agent-picker-trigger]:focus-visible{border-color:var(--paimind-line);background:color-mix(in srgb,var(--paimind-ink) 8%,transparent);outline:none}
[data-paimind-agent-picker-layer]{position:fixed;inset:0;z-index:1200;pointer-events:none}
[data-paimind-agent-picker-scrim]{display:none}
[data-paimind-agent-picker]{position:fixed;display:grid;grid-template-columns:minmax(190px,42%) minmax(240px,1fr);grid-template-rows:minmax(0,1fr) auto;height:min(360px,calc(100vh - 24px));max-height:360px;overflow:hidden;border:1px solid var(--paimind-line);border-radius:18px;background:var(--paimind-glass-strong);box-shadow:0 24px 72px rgba(17,39,63,.2);backdrop-filter:blur(24px) saturate(1.12);-webkit-backdrop-filter:blur(24px) saturate(1.12);pointer-events:auto;animation:paimind-pop-in var(--paimind-motion-enter,180ms) ease-out}
[data-paimind-agent-picker-list]{min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:8px;border-right:1px solid var(--paimind-line)}
[data-paimind-agent-picker-group]+[data-paimind-agent-picker-group]{margin-top:8px;padding-top:8px;border-top:1px solid var(--paimind-line)}
[data-paimind-agent-picker-group] h3{margin:0;padding:4px 8px;color:var(--paimind-muted);font-size:10px;font-weight:700;line-height:15px;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-agent-choice]{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:36px;padding:7px 8px;border:0;border-radius:10px;color:var(--paimind-ink);background:transparent;font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
[data-paimind-agent-choice-copy]{display:flex;align-items:center;gap:8px;min-width:0}
[data-paimind-agent-choice] span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-agent-choice]:hover,[data-paimind-agent-choice]:focus-visible,[data-paimind-agent-choice][data-focused='true']{background:color-mix(in srgb,var(--paimind-accent) 10%,transparent);outline:none}
[data-paimind-agent-choice][aria-selected='true']{color:var(--paimind-navy);font-weight:650}
[data-paimind-agent-picker-detail]{display:grid;align-content:start;gap:9px;min-width:0;padding:22px}
.paimind-agent-picker-detail-avatar{width:32px;height:32px}
[data-paimind-agent-picker-detail] small{color:var(--paimind-accent);font-size:10px;font-weight:700;line-height:15px;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-agent-picker-detail] strong{color:var(--paimind-ink);font-size:16px;line-height:22px}
[data-paimind-agent-picker-detail] p{margin:0;color:var(--paimind-muted);font-size:12px;line-height:19px;overflow-wrap:anywhere}
[data-paimind-agent-picker-hint]{margin-top:4px;color:var(--paimind-muted);font-size:10px;line-height:15px}
[data-paimind-agent-picker-error]{grid-column:1/-1;margin:0;padding:7px 12px;border-top:1px solid var(--paimind-line);color:var(--dsw-alias-state-error-primary,#c64d4d);font-size:11px;line-height:17px}
body[data-paimind-experience='paimind'][data-paimind-density='focus'] [data-variant][aria-expanded='false'],
body[data-paimind-experience='paimind'][data-paimind-density='focus'] [data-variant]:has(> [data-disclosure-row][aria-expanded='false']),
body[data-paimind-experience='paimind'][data-paimind-density='focus'] [data-paimind-conversation] :not([data-variant]):has(> [data-disclosure-row][aria-expanded='false']){min-height:24px!important;padding-block:0!important}
body[data-paimind-experience='paimind'][data-paimind-density='focus'] [data-disclosure-row][aria-expanded='false']{min-height:24px!important}
body[data-paimind-experience='paimind'][data-paimind-density='focus'] [data-paimind-quick-agents],
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-phase='active'] [data-paimind-quick-agents]{display:none}
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-phase='hero']::before,
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-phase='hero']::after{display:none}
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-phase='hero'] [data-composer-seat]{width:min(680px,calc(100% - 24px))}
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-paimind-hero-brand-seat]{margin-bottom:4px;gap:5px}
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-paimind-paramont-hero-mark],
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-paimind-experience-eyebrow]{display:none}
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-paimind-experience-title]{font-size:28px}
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-paimind-experience-subtitle]{display:none}
body[data-paimind-experience='paimind'][data-paimind-density='workbench'] [data-paimind-quick-agent]:nth-of-type(n+3){display:none}
[data-paimind-experience-setting]{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;width:100%;padding:2px 0;color:var(--dsw-alias-label-primary,#202124)}
[data-paimind-experience-setting-copy]{display:grid;gap:3px;min-width:0}
[data-paimind-experience-setting-copy] strong{font-size:13px;line-height:19px}
[data-paimind-experience-setting-copy] span{max-width:560px;color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:17px}
[data-paimind-experience-mode]{display:inline-flex;padding:3px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04))}
[data-paimind-experience-mode] label{position:relative}
[data-paimind-experience-mode] input{position:absolute;inset:0;z-index:1;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
[data-paimind-experience-mode] span{display:block;min-width:74px;padding:6px 10px;border-radius:7px;color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:16px;text-align:center;cursor:pointer}
[data-paimind-experience-mode] input:checked+span{color:var(--paimind-navy,#123d68);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 4px rgba(20,43,68,.1);font-weight:650}
[data-paimind-experience-mode] input:focus-visible+span{outline:2px solid color-mix(in srgb,var(--paimind-accent,#4f83b8) 42%,transparent);outline-offset:1px}
[data-paimind-experience-mode] input:disabled+span{opacity:.5;cursor:not-allowed}
[data-paimind-experience-mode] input:disabled{cursor:not-allowed}
@media(min-width:761px){body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon]){width:min(1480px,calc(100vw - 48px))!important;height:min(920px,calc(100vh - 48px))!important;max-width:none!important}}
@media(max-width:600px){body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon]){width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;max-width:none!important;max-height:none!important;flex-direction:column!important}body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon])>nav{width:100%!important;max-width:none!important;max-height:60px;box-sizing:border-box;padding:8px 12px!important;border-right:0!important;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,125,150,.16));overflow:hidden}body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon])>nav>:first-child{display:none!important}body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon])>nav>:last-child{display:flex!important;flex-direction:row!important;gap:6px;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:none}body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon])>nav>:last-child::-webkit-scrollbar{display:none}body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon])>nav>:last-child>*{flex:0 0 auto}body[data-paimind-experience='paimind'] [role='dialog'][aria-modal='true']:has(>nav button[data-paimind-settings-navigation-icon])>nav+*{width:100%!important;min-width:0!important;flex:1 1 auto!important}}
body[data-paimind-experience='paimind'] [data-paimind-skill-center],body[data-paimind-experience='paimind'] [data-paimind-extension-center],body[data-paimind-experience='paimind'] [data-paimind-notifications],body[data-paimind-experience='paimind'] [data-paimind-user-settings]{--paimind-surface:var(--paimind-glass-strong);background:color-mix(in srgb,var(--paimind-canvas) 92%,var(--paimind-accent) 8%)}
@keyframes paimind-pop-in{from{opacity:0;transform:translateY(-4px) scale(.988)}to{opacity:1;transform:none}}
@keyframes paimind-composer-menu-in{from{opacity:0;transform:translateY(-5px) scale(.992)}to{opacity:1;transform:none}}
@media(max-width:900px){[data-paimind-experience-title]{font-size:32px}[data-paimind-quick-agent]:nth-of-type(n+3){display:none}}
@media(max-width:640px){
  body[data-paimind-experience='paimind'] [data-phase='hero'] [data-composer-seat]{width:calc(100% - 20px)}
  body[data-paimind-experience='paimind'] [data-phase='hero'] :has(> [data-slot='conversation.hero.agentPreset']) > button{min-width:0;overflow:hidden}
  [data-paimind-agent-picker-trigger]{min-width:0;max-width:45%}
  body[data-paimind-experience='paimind'] [data-phase='hero']::before{opacity:.2;background-position:center bottom}
  [data-paimind-experience-title]{font-size:27px;letter-spacing:-.025em}
  [data-paimind-experience-subtitle]{max-width:330px;font-size:12px;line-height:18px}
  [data-paimind-quick-agent]:nth-of-type(n+2){display:none}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox']{width:100%!important;max-height:min(62vh,var(--paimind-composer-overlay-room,62vh))!important;padding:5px!important;border-radius:16px!important}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox']:has(>[data-paimind-composer-disclosure]){grid-template-columns:1fr;grid-template-rows:minmax(120px,1fr) auto}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox']:has(>[data-paimind-composer-disclosure])>:first-child{max-height:36vh;border-right:0;border-bottom:1px solid var(--paimind-line)}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']{min-height:48px;padding:8px 10px}
  body[data-paimind-experience='paimind'] [data-paimind-composer-disclosure]{max-height:150px;padding:13px 15px}
  body[data-paimind-experience='paimind'] [data-paimind-popup-select]{grid-template-columns:1fr!important;grid-template-rows:auto minmax(120px,1fr) auto!important;width:100%!important;height:auto!important;max-height:min(72vh,var(--paimind-composer-overlay-room,72vh))!important}
  body[data-paimind-experience='paimind'] [data-paimind-popup-select]>input[type='text']{grid-column:1;grid-row:1}
  body[data-paimind-experience='paimind'] [data-paimind-popup-select]>[role='listbox']{grid-column:1;grid-row:2;max-height:36vh!important;border-right:0!important;border-bottom:1px solid var(--paimind-line)!important}
  body[data-paimind-experience='paimind'] [data-paimind-popup-select]>[data-paimind-composer-disclosure]{grid-column:1;grid-row:3;max-height:150px}
  [data-paimind-context-launcher] span{display:none}
  [data-paimind-agent-picker-scrim]{display:block;position:absolute;inset:0;background:rgba(4,11,20,.42);pointer-events:auto}
  [data-paimind-agent-picker]{right:0!important;bottom:0!important;left:0!important;top:auto!important;grid-template-columns:1fr;grid-template-rows:auto auto;width:auto!important;height:auto;max-height:min(76vh,620px);border-width:1px 0 0;border-radius:22px 22px 0 0;animation:paimind-sheet-in var(--paimind-motion-slow,240ms) ease-out}
  [data-paimind-agent-picker-list]{max-height:44vh;border-right:0;border-bottom:1px solid var(--paimind-line)}
  [data-paimind-agent-picker-detail]{padding:16px 18px 22px}
  [data-paimind-experience-setting]{grid-template-columns:1fr;gap:10px}
  [data-paimind-experience-mode]{width:100%}[data-paimind-experience-mode] label{flex:1}[data-paimind-experience-mode] span{min-width:0}
}
@keyframes paimind-sheet-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}

`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = STYLE_ID; markHarnessClientStyle(style, STYLE_ID)
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

const COMPOSER_OVERLAY_ANCHOR_MARKER = 'data-paimind-composer-overlay-anchor'
const COMPOSER_OVERLAY_ROOM = '--paimind-composer-overlay-room'

interface CommandDisclosureCopy {
  readonly titleZh: string
  readonly titleEn: string
  readonly summaryZh: string
  readonly summaryEn: string
  readonly usages: readonly string[]
}

const COMMAND_DISCLOSURE_COPY: Readonly<Record<string, CommandDisclosureCopy>> = Object.freeze({
  compact: {
    titleZh: '压缩较早对话', titleEn: 'Compact earlier conversation',
    summaryZh: '将较早内容整理成摘要，为后续对话释放上下文空间。',
    summaryEn: 'Summarize earlier content to free context space for the rest of the conversation.',
    usages: ['/compact'],
  },
  export: {
    titleZh: '导出会话记录', titleEn: 'Export session log',
    summaryZh: '下载当前会话、子会话和附件的 ZIP 记录。',
    summaryEn: 'Download the current session, descendant sessions, and attachments as a ZIP archive.',
    usages: ['/export'],
  },
  feedback: {
    titleZh: '提交使用反馈', titleEn: 'Send product feedback',
    summaryZh: '把本次会话中的体验问题记录为反馈，不会作为消息发送给模型。',
    summaryEn: 'Record product feedback for this session without sending it to the model.',
    usages: ['/feedback 反馈内容'],
  },
  goal: {
    titleZh: '管理长期目标', titleEn: 'Manage a long-running goal',
    summaryZh: '创建、查看、暂停或恢复需要持续推进的会话目标。',
    summaryEn: 'Create, inspect, pause, or resume a goal that continues across multiple rounds.',
    usages: ['/goal 目标', '/goal pause', '/goal resume', '/goal clear'],
  },
  permission: {
    titleZh: '切换访问权限', titleEn: 'Change access permission',
    summaryZh: '选择当前会话可访问的文件范围，以及扩大权限时是否需要确认。',
    summaryEn: 'Choose the file-access scope and whether wider access requires confirmation.',
    usages: ['/permission'],
  },
  plan: {
    titleZh: '进入规划模式', titleEn: 'Enter plan mode',
    summaryZh: '先分析需求并形成可评审计划，不立即执行修改。',
    summaryEn: 'Analyze the request and produce a reviewable plan before making changes.',
    usages: ['/plan 任务', '/plan off'],
  },
  model: {
    titleZh: '选择对话模型', titleEn: 'Choose the conversation model',
    summaryZh: '切换当前会话使用的模型；选择后立即应用。',
    summaryEn: 'Switch the model used by the current conversation and apply it immediately.',
    usages: ['/model'],
  },
  panel: {
    titleZh: '打开 GenUI 面板', titleEn: 'Open the GenUI panel',
    summaryZh: '打开可持续更新的会话面板，也可以用一句指令定制面板内容。',
    summaryEn: 'Open the persistent session panel or tailor its content with an instruction.',
    usages: ['/panel', '/panel 指令', '/panel clear'],
  },
})

interface ComposerDisclosureSection {
  readonly label: string
  readonly values: readonly string[]
  readonly code?: boolean
}

interface ComposerDisclosureContent {
  readonly eyebrow: string
  readonly title: string
  readonly summary: string
  readonly sections: readonly ComposerDisclosureSection[]
}

/**
 * Restyles the native Harness input overlay without owning its candidate
 * data, selection state, or keyboard behavior. All annotations and inline
 * measurements are removed when mode is disabled or the plugin exits.
 */
export class PaimindComposerOverlayPresenter {
  private mode: PaimindExperienceMode = 'native'
  private disposed = false
  private queued = false
  private animationFrame: number | null = null
  private anchor: HTMLElement | null = null
  private observedComposer: HTMLElement | null = null
  private disclosureList: HTMLElement | null = null
  private disclosureShell: HTMLElement | null = null
  private disclosure: HTMLElement | null = null
  private hoveredOption: HTMLElement | null = null
  private disclosureSignature = ''
  private readonly observer: MutationObserver
  private readonly resizeObserver: ResizeObserver | null

  constructor(
    private readonly doc: Document = document,
    private readonly win: Window = window,
  ) {
    this.observer = new MutationObserver(() => { this.schedule() })
    this.observer.observe(doc.body, { childList: true, subtree: true })
    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => { this.schedule() })
    this.win.addEventListener('resize', this.schedule)
    this.doc.addEventListener('keydown', this.onKeyboardNavigation, true)
    this.apply()
  }

  setMode(mode: PaimindExperienceMode): void {
    if (this.disposed || this.mode === mode) return
    this.mode = mode
    this.apply()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.animationFrame !== null) {
      this.win.cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }
    this.queued = false
    this.observer.disconnect()
    this.resizeObserver?.disconnect()
    this.observedComposer = null
    this.win.removeEventListener('resize', this.schedule)
    this.doc.removeEventListener('keydown', this.onKeyboardNavigation, true)
    this.clearDisclosure()
    this.clearAnchor()
    this.doc.body.removeAttribute('data-paimind-composer-overlay')
  }

  private readonly schedule = (): void => {
    if (this.queued || this.disposed) return
    this.queued = true
    const apply = (): void => {
      this.animationFrame = null
      this.queued = false
      this.apply()
    }
    if (typeof this.win.requestAnimationFrame === 'function') {
      this.animationFrame = this.win.requestAnimationFrame(apply)
    } else {
      queueMicrotask(apply)
    }
  }

  private apply(): void {
    if (this.disposed) return
    const slot = this.doc.querySelector<HTMLElement>("[data-slot='conversation.input.overlay']")
    const nextAnchor = slot?.parentElement ?? null
    if (this.anchor !== nextAnchor) {
      this.clearAnchor()
      this.anchor = nextAnchor
    }
    if (this.mode !== 'paimind' || slot === null || nextAnchor === null) {
      this.clearAnchor()
      this.doc.body.removeAttribute('data-paimind-composer-overlay')
      return
    }

    const composer = slot.closest<HTMLElement>('[data-composer-card]')
    nextAnchor.setAttribute(COMPOSER_OVERLAY_ANCHOR_MARKER, '')
    if (this.observedComposer !== composer) {
      this.resizeObserver?.disconnect()
      this.observedComposer = composer
      if (composer !== null) this.resizeObserver?.observe(composer)
    }
    const top = composer?.getBoundingClientRect().top ?? this.win.innerHeight
    const room = Math.max(0, Math.floor(top - 16))
    const roomValue = `${room}px`
    if (nextAnchor.style.getPropertyValue(COMPOSER_OVERLAY_ROOM) !== roomValue) {
      nextAnchor.style.setProperty(COMPOSER_OVERLAY_ROOM, roomValue)
    }
    const list = slot.querySelector<HTMLElement>('[role="listbox"]')
    if (list !== null) {
      this.doc.body.dataset.paimindComposerOverlay = 'open'
      this.syncDisclosure(list)
    } else {
      this.doc.body.removeAttribute('data-paimind-composer-overlay')
      this.clearDisclosure()
    }
  }

  private readonly onKeyboardNavigation = (event: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || this.disclosureList === null) return
    this.hoveredOption = null
    this.schedule()
  }

  private readonly onPointerOver = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="option"]') : null
    if (target === null || !this.disclosureList?.contains(target) || target === this.hoveredOption) return
    this.hoveredOption = target
    this.renderDisclosure(target)
  }

  private readonly onPointerLeave = (): void => {
    if (this.hoveredOption === null) return
    this.hoveredOption = null
    this.schedule()
  }

  private syncDisclosure(list: HTMLElement): void {
    if (this.disclosureList !== list) {
      this.clearDisclosure()
      this.disclosureList = list
      const shell = list.parentElement
      this.disclosureShell = shell?.querySelector(':scope > input[type="text"]') === null ? null : shell
      this.disclosureShell?.setAttribute('data-paimind-popup-select', '')
      list.addEventListener('pointerover', this.onPointerOver)
      list.addEventListener('pointerleave', this.onPointerLeave)
    }
    for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) this.annotateOption(option)
    const activeId = list.getAttribute('aria-activedescendant')
    const active = this.hoveredOption
      ?? (activeId === null ? null : this.doc.getElementById(activeId))
      ?? list.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?? list.querySelector<HTMLElement>('[role="option"]')
    if (active !== null) this.renderDisclosure(active)
  }

  private annotateOption(option: HTMLElement): void {
    if (!option.hasAttribute('data-paimind-candidate-option')) option.setAttribute('data-paimind-candidate-option', '')
    const children = [...option.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
    const name = children.find(child => child.className.includes('itemName'))
      ?? children.find(child => child.getAttribute('aria-hidden') !== 'true')
    const description = children.find(child => child.className.includes('itemDescription'))
      ?? (this.disclosureShell === null ? undefined : children.find(child => child !== name
        && child.textContent?.trim() !== '' && child.querySelector('svg') === null))
    if (name !== undefined && !name.hasAttribute('data-paimind-candidate-name')) name.setAttribute('data-paimind-candidate-name', '')
    if (description !== undefined && !description.hasAttribute('data-paimind-candidate-description')) description.setAttribute('data-paimind-candidate-description', '')
    if (name !== undefined && option.id.includes('paimind-context')) this.annotateContextName(option, name)
  }

  private renderDisclosure(option: HTMLElement): void {
    const name = option.querySelector<HTMLElement>('[data-paimind-candidate-name]')?.textContent?.trim()
      ?? option.textContent?.trim() ?? ''
    const description = option.querySelector<HTMLElement>('[data-paimind-candidate-description]')?.textContent?.trim() ?? ''
    const section = this.sectionFor(option)
    const content = this.disclosureContent(option, name, description, section)
    const avatarKey = option.querySelector<HTMLElement>('[data-paimind-agent-avatar]')?.dataset.paimindAgentAvatarKey ?? ''
    const signature = `${option.id}|${content.eyebrow}|${content.title}|${content.summary}|${content.sections.map(item => item.values.join(',')).join('|')}|${avatarKey}`
    if (signature === this.disclosureSignature && this.disclosure?.isConnected === true) return
    this.disclosureSignature = signature
    const disclosure = this.disclosure ?? this.doc.createElement('aside')
    disclosure.dataset.paimindComposerDisclosure = ''
    disclosure.setAttribute('aria-live', 'polite')
    disclosure.setAttribute('aria-atomic', 'true')
    const header = this.doc.createElement('div'); header.dataset.paimindComposerDisclosureHeader = ''
    const heading = this.doc.createElement('div'); heading.dataset.paimindComposerDisclosureHeading = ''
    const kind = this.doc.createElement('small'); kind.textContent = content.eyebrow
    const title = this.doc.createElement('strong'); title.textContent = content.title
    heading.append(kind, title)
    const copy = this.doc.createElement('p'); copy.textContent = content.summary
    const sections = this.doc.createElement('div'); sections.dataset.paimindComposerDisclosureSections = ''
    for (const item of content.sections) {
      if (item.values.length === 0) continue
      const block = this.doc.createElement('div'); block.dataset.paimindComposerDisclosureSection = ''
      const label = this.doc.createElement('span'); label.textContent = item.label
      const values = this.doc.createElement('div'); values.dataset.paimindComposerDisclosureValues = ''
      for (const value of item.values) {
        const element = this.doc.createElement(item.code === true ? 'code' : 'span')
        element.textContent = value
        values.append(element)
      }
      block.append(label, values)
      sections.append(block)
    }
    const hint = this.doc.createElement('span')
    hint.dataset.paimindComposerDisclosureHint = ''
    hint.textContent = this.isChinese() ? '方向键浏览 · Enter 选择 · Esc 返回' : 'Arrow keys to browse · Enter to select · Esc to return'
    const avatarSource = option.querySelector<HTMLImageElement>('[data-paimind-agent-avatar]')
    const avatar = avatarSource?.cloneNode(true) as HTMLImageElement | undefined
    if (avatar !== undefined) {
      avatar.dataset.paimindComposerDisclosureAvatar = ''
      avatar.removeAttribute('data-paimind-agent-avatar-owner')
      header.append(avatar, heading)
    } else {
      header.append(heading)
    }
    disclosure.replaceChildren(header, copy, sections, hint)
    if (this.disclosure !== disclosure) this.disclosure = disclosure
    if (!disclosure.isConnected) (this.disclosureShell ?? this.disclosureList)?.append(disclosure)
  }

  private disclosureContent(
    option: HTMLElement,
    name: string,
    description: string,
    section: string,
  ): ComposerDisclosureContent {
    const zh = this.isChinese()
    const popupCommand = this.popupCommand()
    if (popupCommand === 'model') {
      const provider = description === '' ? (zh ? '当前提供方' : 'Current provider') : description
      return {
        eyebrow: zh ? '对话模型' : 'Conversation model',
        title: name,
        summary: zh ? `由 ${provider} 提供，选择后用于当前会话。` : `Provided by ${provider}; selecting it applies it to this conversation.`,
        sections: [{ label: zh ? '作用范围' : 'Scope', values: [provider, zh ? '当前会话' : 'Current conversation'] }],
      }
    }
    if (popupCommand === 'permission') {
      return {
        eyebrow: zh ? '权限预设' : 'Permission preset',
        title: name,
        summary: description || (zh ? '选择后立即应用到当前会话。' : 'Selecting it applies it to the current conversation.'),
        sections: [{ label: zh ? '作用范围' : 'Scope', values: [zh ? '当前会话' : 'Current conversation'] }],
      }
    }
    if (option.id.includes('paimind-agent')) {
      const currentAgent = this.doc.querySelector<HTMLElement>('[data-paimind-agent-picker-trigger] > span')?.textContent?.trim()
      const isCurrent = currentAgent === name
      const skills = isCurrent ? this.currentSkillNames() : []
      return {
        eyebrow: zh ? 'Agent（智能体）' : 'Agent',
        title: name,
        summary: description || this.emptyDescription(section),
        sections: [{
          label: zh ? '已挂载 Skill' : 'Mounted Skills',
          values: isCurrent
            ? (skills.length === 0 ? [zh ? '当前没有可用 Skill' : 'No Skills available'] : skills)
            : [zh ? '选择后载入该 Agent 的真实 Skill' : 'Select to load this Agent’s actual Skills'],
        }],
      }
    }
    if (option.id.includes('paimind-skill')) {
      return {
        eyebrow: zh ? 'Skill（技能）' : 'Skill',
        title: name,
        summary: description || this.emptyDescription(section),
        sections: [
          { label: zh ? '调用方式' : 'Invocation', values: [`/${name}`], code: true },
          { label: zh ? '可用范围' : 'Availability', values: [zh ? '当前 Agent' : 'Current Agent'] },
        ],
      }
    }
    if (option.dataset.paimindContextKind !== undefined) {
      return {
        eyebrow: section,
        title: name,
        summary: this.contextDescription(option.dataset.paimindContextKind, name),
        sections: [{ label: zh ? '添加到' : 'Add to', values: [zh ? '当前对话上下文' : 'Current conversation context'] }],
      }
    }
    const command = name.replace(/^\//u, '')
    const commandCopy = COMMAND_DISCLOSURE_COPY[command]
    if (commandCopy !== undefined) {
      return {
        eyebrow: zh ? '命令' : 'Command',
        title: `/${command}`,
        summary: zh ? commandCopy.titleZh : commandCopy.titleEn,
        sections: [
          { label: zh ? '可以做什么' : 'What it does', values: [zh ? commandCopy.summaryZh : commandCopy.summaryEn] },
          { label: zh ? '常用写法' : 'Common usage', values: commandCopy.usages, code: true },
        ],
      }
    }
    return {
      eyebrow: section,
      title: name,
      summary: description || this.emptyDescription(section),
      sections: [],
    }
  }

  private popupCommand(): string | null {
    const label = this.disclosureShell?.getAttribute('aria-label') ?? ''
    return /^\/([^\s]+)/u.exec(label)?.[1] ?? null
  }

  private currentSkillNames(): string[] {
    if (this.disclosureList === null) return []
    return [...this.disclosureList.querySelectorAll<HTMLElement>("[id*='paimind-skill']")]
      .map(skill => skill.querySelector<HTMLElement>('[data-paimind-candidate-name]')?.textContent?.trim() ?? '')
      .filter((name, index, names) => name !== '' && names.indexOf(name) === index)
  }

  private annotateContextName(option: HTMLElement, name: HTMLElement): void {
    if (name.dataset.paimindCandidateOriginalName !== undefined) return
    const original = name.textContent?.trim() ?? ''
    const match = /^(Folder|File|Session)\s*·\s*(.+)$/u.exec(original)
    if (match === null) return
    const kind = match[1]!.toLowerCase()
    const label = match[2]!.trim()
    name.dataset.paimindCandidateOriginalName = original
    name.textContent = label
    option.dataset.paimindContextKind = kind
    const kindLabel = this.doc.createElement('span')
    kindLabel.dataset.paimindContextKindLabel = ''
    kindLabel.textContent = this.contextKindLabel(kind)
    option.insertBefore(kindLabel, name)
  }

  private contextKindLabel(kind: string): string {
    const zh = this.isChinese()
    if (kind === 'folder') return zh ? '文件夹' : 'Folder'
    if (kind === 'file') return zh ? '文件' : 'File'
    if (kind === 'session') return zh ? '会话' : 'Session'
    return zh ? '上下文' : 'Context'
  }

  private contextDescription(kind: string, name: string): string {
    const label = this.contextKindLabel(kind)
    return this.isChinese()
      ? `将这个${label}“${name}”添加到当前对话上下文。`
      : `Add this ${label.toLowerCase()} “${name}” to the current conversation context.`
  }

  private sectionFor(option: HTMLElement): string {
    const id = option.id
    if (id.includes('paimind-agent')) return this.isChinese() ? 'Agent（智能体）' : 'Agent'
    if (id.includes('paimind-skill')) return this.isChinese() ? 'Skill（技能）' : 'Skill'
    if (id.includes('paimind-context')) return this.isChinese() ? 'Context（上下文）' : 'Context'
    let previous = option.previousElementSibling
    while (previous !== null) {
      if (previous.getAttribute('role') === 'presentation') {
        const value = previous.textContent?.trim()
        if (value !== undefined && value !== '') return value
      }
      previous = previous.previousElementSibling
    }
    return this.isChinese() ? 'Command（命令与模式）' : 'Command or mode'
  }

  private emptyDescription(section: string): string {
    if (section.includes('Context') || section.includes('上下文')) return this.isChinese()
      ? '添加这个文件、文件夹或会话作为当前对话的上下文。'
      : 'Add this file, folder, or session to the current conversation context.'
    return this.isChinese() ? '选择后将应用到当前对话。' : 'Select to apply this item to the current conversation.'
  }

  private isChinese(): boolean {
    return (this.doc.documentElement.lang || this.doc.body.dataset.locale || 'zh').toLowerCase().startsWith('zh')
  }

  private clearDisclosure(): void {
    if (this.disclosureList !== null) {
      this.disclosureList.removeEventListener('pointerover', this.onPointerOver)
      this.disclosureList.removeEventListener('pointerleave', this.onPointerLeave)
      for (const option of this.disclosureList.querySelectorAll<HTMLElement>('[data-paimind-candidate-option]')) {
        option.removeAttribute('data-paimind-candidate-option')
        option.removeAttribute('data-paimind-context-kind')
        option.querySelector('[data-paimind-context-kind-label]')?.remove()
        const name = option.querySelector<HTMLElement>('[data-paimind-candidate-name]')
        if (name?.dataset.paimindCandidateOriginalName !== undefined) {
          name.textContent = name.dataset.paimindCandidateOriginalName
          name.removeAttribute('data-paimind-candidate-original-name')
        }
        name?.removeAttribute('data-paimind-candidate-name')
        option.querySelector('[data-paimind-candidate-description]')?.removeAttribute('data-paimind-candidate-description')
      }
    }
    this.disclosureShell?.removeAttribute('data-paimind-popup-select')
    this.disclosure?.remove()
    this.disclosure = null
    this.disclosureList = null
    this.disclosureShell = null
    this.hoveredOption = null
    this.disclosureSignature = ''
  }

  private clearAnchor(): void {
    this.clearDisclosure()
    this.resizeObserver?.disconnect()
    this.observedComposer = null
    this.anchor?.removeAttribute(COMPOSER_OVERLAY_ANCHOR_MARKER)
    this.anchor?.style.removeProperty(COMPOSER_OVERLAY_ROOM)
    this.anchor = null
  }
}

function useMode(controller: PaimindExperienceModeController): ExperienceModeSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}

function useBridge(bridge: HarnessAgentChoiceBridge): ReturnType<HarnessAgentChoiceBridge['getSnapshot']> {
  return useSyncExternalStore(bridge.subscribe.bind(bridge), bridge.getSnapshot.bind(bridge), bridge.getSnapshot.bind(bridge))
}

function useChinese(locale: PaimindClientContext['locale']): boolean {
  return useSyncExternalStore(
    locale.subscribe.bind(locale),
    () => locale.getLocale().active.toLowerCase().startsWith('zh'),
    () => locale.getLocale().active.toLowerCase().startsWith('zh'),
  )
}

interface ComposerContextLauncherProps {
  readonly session: { readonly sessionId: string }
  readonly input: HarnessComposerInputSnapshot
  readonly bridge: NativeHarnessInputTriggerBridge
  readonly mode: PaimindExperienceModeController
  readonly locale: PaimindClientContext['locale']
}

export function ComposerContextLauncher({ session, input, bridge, mode, locale }: ComposerContextLauncherProps): React.JSX.Element | null {
  const experience = useMode(mode)
  const zh = useChinese(locale)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const sync = (): void => {
      const list = document.querySelector<HTMLElement>("[data-paimind-composer-overlay-anchor] [role='listbox']")
      const contextOption = list?.querySelector("[id^='dsh-slash-option-paimind-context-']")
      const contextGroup = list?.querySelector("[data-source='paimind-context']")
      if (list === null || (contextOption === null && contextGroup === null)) setOpen(false)
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [open])
  if (experience.mode !== 'paimind') return null
  const disabled = input.phase !== 'plain'
  const label = zh ? '添加上下文' : 'Add context'
  return <button
    type="button"
    data-paimind-context-launcher
    aria-label={label}
    aria-haspopup="listbox"
    aria-expanded={open}
    disabled={disabled}
    onClick={() => {
      const toggled = bridge.toggleContext(session.sessionId, input)
      if (toggled) setOpen(value => !value)
    }}
  ><PaimindPlusIcon size={14} /><span>{label}</span></button>
}

export function PaimindAgentAvatar({ choice, className }: {
  readonly choice: Pick<HarnessAgentChoice, 'id' | 'name'>
  readonly className?: string
}): React.JSX.Element {
  const avatarId = useSyncExternalStore(
    subscribePaimindAgentAvatarOverrides,
    () => resolvePaimindAgentAvatarOverride(choice.id),
    () => choice.id,
  )
  const identity = resolvePaimindAgentAvatar({ id: avatarId })
  return <img
    className={className}
    data-paimind-agent-avatar
    data-paimind-agent-avatar-id={identity.canonicalId}
    data-paimind-agent-avatar-key={identity.assetKey}
    data-paimind-agent-avatar-fallback={identity.fallback ? 'true' : undefined}
    data-paimind-agent-avatar-projected={identity.projected ? 'true' : undefined}
    src={identity.asset}
    alt=""
    aria-hidden="true"
    draggable={false}
  />
}

/**
 * RC8's native MenuView renders candidate.icon as text only. This presenter
 * replaces only Agent icon tokens with an image; it never reorders,
 * focuses, selects, or owns candidates, and restores the original text token
 * byte-for-byte on Native mode or plugin disposal.
 */
export class PaimindAgentAvatarPresenter {
  private static readonly PROJECTION_OWNER = '@hansen/visual-experience'
  private readonly observer: MutationObserver
  private disposed = false
  private readonly stopAvatarOverrides: () => void
  private readonly failedSeats = new WeakMap<HTMLElement, string>()

  constructor(private readonly doc: Document = document) {
    this.observer = new MutationObserver(() => { this.hydrate() })
    this.stopAvatarOverrides = subscribePaimindAgentAvatarOverrides(() => {
      for (const image of this.doc.querySelectorAll<HTMLImageElement>(
        `img[data-paimind-agent-avatar-owner="${PaimindAgentAvatarPresenter.PROJECTION_OWNER}"]`,
      )) image.remove()
      for (const seat of this.doc.querySelectorAll<HTMLElement>('[data-paimind-agent-avatar-seat]')) {
        seat.removeAttribute('data-paimind-agent-avatar-ready')
      }
      this.hydrate()
    })
    this.observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-paimind-agent-id', 'data-paimind-agent-avatar-choice'] })
    this.hydrate()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observer.disconnect()
    this.stopAvatarOverrides()
    for (const host of this.doc.querySelectorAll<HTMLElement>('[data-paimind-agent-avatar-host]')) {
      const token = host.dataset.paimindAgentAvatarToken
      if (token !== undefined) host.replaceChildren(this.doc.createTextNode(token))
      host.removeAttribute('data-paimind-agent-avatar-host')
      host.removeAttribute('data-paimind-agent-avatar-token')
    }
    for (const image of this.doc.querySelectorAll<HTMLImageElement>(
      `img[data-paimind-agent-avatar-owner="${PaimindAgentAvatarPresenter.PROJECTION_OWNER}"]`,
    )) image.remove()
    for (const seat of this.doc.querySelectorAll<HTMLElement>('[data-paimind-agent-avatar-seat]')) {
      seat.removeAttribute('data-paimind-agent-avatar-ready')
    }
  }

  private hydrate(): void {
    if (this.disposed) return
    const options = this.doc.querySelectorAll<HTMLElement>("[id^='dsh-slash-option-paimind-agent-']")
    for (const option of options) {
      const host = [...option.querySelectorAll<HTMLElement>('[aria-hidden="true"]')]
        .find(element => canonicalIdFromPaimindAgentAvatarIcon(element.textContent?.trim() ?? '') !== null)
      if (host === undefined) continue
      const token = host.textContent?.trim() ?? ''
      const canonicalId = canonicalIdFromPaimindAgentAvatarIcon(token)
      if (canonicalId === null) continue
      const identity = resolvePaimindAgentAvatar({ id: resolvePaimindAgentAvatarOverride(canonicalId) })
      const image = this.doc.createElement('img')
      image.dataset.paimindAgentAvatar = ''
      image.dataset.paimindAgentAvatarId = canonicalId
      image.dataset.paimindAgentAvatarKey = identity.assetKey
      if (identity.fallback) image.dataset.paimindAgentAvatarFallback = 'true'
      if (identity.projected) image.dataset.paimindAgentAvatarProjected = 'true'
      image.alt = ''
      image.setAttribute('aria-hidden', 'true')
      image.draggable = false
      image.src = identity.asset
      host.dataset.paimindAgentAvatarHost = ''
      host.dataset.paimindAgentAvatarToken = token
      host.replaceChildren(image)
    }
    const seats = this.doc.querySelectorAll<HTMLElement>(
      '[data-paimind-agent-avatar-seat]',
    )
    for (const seat of seats) {
      const canonicalId = seat.dataset.paimindAgentId?.trim() ?? ''
      const owned = seat.querySelector<HTMLImageElement>(
        `:scope > img[data-paimind-agent-avatar-owner="${PaimindAgentAvatarPresenter.PROJECTION_OWNER}"]`,
      )
      if (canonicalId === '') { owned?.remove(); seat.removeAttribute('data-paimind-agent-avatar-ready'); continue }
      const identity = resolvePaimindAgentAvatar({ id: seat.dataset.paimindAgentAvatarChoice ?? resolvePaimindAgentAvatarOverride(canonicalId) })
      if (owned !== null) {
        if (owned.dataset.paimindAgentAvatarId === canonicalId && owned.dataset.paimindAgentAvatarKey === identity.assetKey) continue
        owned.remove()
        seat.removeAttribute('data-paimind-agent-avatar-ready')
      }
      // Native/avatar metadata, when Harness exposes it, wins over PAIMind's
      // deterministic visual projection without replacing identity semantics.
      if (seat.querySelector(':scope > img') !== null) continue
      if (this.failedSeats.get(seat) === identity.assetKey) continue
      const image = this.doc.createElement('img')
      image.dataset.paimindAgentAvatar = ''
      image.dataset.paimindAgentAvatarOwner = PaimindAgentAvatarPresenter.PROJECTION_OWNER
      image.dataset.paimindAgentAvatarId = canonicalId
      image.dataset.paimindAgentAvatarKey = identity.assetKey
      if (identity.fallback) image.dataset.paimindAgentAvatarFallback = 'true'
      if (identity.projected) image.dataset.paimindAgentAvatarProjected = 'true'
      image.alt = ''
      image.setAttribute('aria-hidden', 'true')
      image.draggable = false
      image.addEventListener('load', () => {
        if (!this.disposed && image.isConnected) seat.dataset.paimindAgentAvatarReady = 'true'
      }, { once: true })
      image.addEventListener('error', () => {
        this.failedSeats.set(seat, identity.assetKey)
        image.remove()
        seat.removeAttribute('data-paimind-agent-avatar-ready')
      }, { once: true })
      image.src = identity.asset
      seat.append(image)
    }
  }
}

export function QuickAgents({ bridge, mode, locale }: {
  readonly bridge: HarnessAgentChoiceBridge
  readonly mode: PaimindExperienceModeController
  readonly locale: PaimindClientContext['locale']
}): React.JSX.Element | null {
  const experience = useMode(mode)
  const snapshot = useBridge(bridge)
  const zh = useChinese(locale)
  const choices = useMemo(() => snapshot.choices
    .filter(choice => choice.category === 'recommended')
    .slice(0, 4), [snapshot.choices])
  if (experience.mode !== 'paimind' || snapshot.status !== 'ready' || choices.length === 0) return null
  const centerAvailable = isPaimindProductSurfaceAvailable('agent-center')
  return <section data-paimind-quick-agents aria-label={zh ? '快捷智能体' : 'Quick Agents'}>
    <div data-paimind-quick-agents-label><PaimindAgentIcon size={13} />{zh ? '常用智能体' : 'Quick Agents'}</div>
    <div data-paimind-quick-agents-list>
      {choices.map(choice => <button
        key={choice.id}
        type="button"
        data-paimind-quick-agent
        aria-pressed={snapshot.current === choice.id}
        title={choice.description}
        disabled={snapshot.busy}
        onClick={() => { void bridge.select(choice.id) }}
      ><PaimindAgentAvatar choice={choice} /><span>{choice.name}</span></button>)}
      <button
        type="button"
        data-paimind-quick-all
        disabled={!centerAvailable}
        title={centerAvailable ? (zh ? '打开 Agent Center' : 'Open Agent Center') : (zh ? 'Agent Center 未安装' : 'Agent Center is not installed')}
        onClick={() => { requestPaimindProductSurface('agent-center') }}
      >{zh ? '全部智能体' : 'All Agents'}<PaimindChevronRightIcon size={13} /></button>
    </div>
  </section>
}

function categoryLabel(category: HarnessAgentChoice['category'], zh: boolean): string {
  return category === 'recommended' ? (zh ? '推荐 Agent' : 'Recommended Agents') : (zh ? '平台模式' : 'Platform Modes')
}

function pickerPosition(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(590, window.innerWidth - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const height = 360
  const top = rect.bottom + 8 + height <= window.innerHeight
    ? rect.bottom + 8
    : Math.max(12, rect.top - height - 8)
  return { left, top, width }
}

export function AgentChoiceSeat({ bridge, mode, locale }: {
  readonly bridge: HarnessAgentChoiceBridge
  readonly mode: PaimindExperienceModeController
  readonly locale: PaimindClientContext['locale']
}): React.JSX.Element | null {
  const experience = useMode(mode)
  const snapshot = useBridge(bridge)
  const zh = useChinese(locale)
  const [open, setOpen] = useState(false)
  const [focusedId, setFocusedId] = useState(snapshot.current)
  const [style, setStyle] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const choiceRefs = useRef(new Map<string, HTMLButtonElement>())
  const current = snapshot.choices.find(choice => choice.id === snapshot.current)
  const focused = snapshot.choices.find(choice => choice.id === focusedId) ?? current

  useEffect(() => { if (!open) setFocusedId(snapshot.current) }, [open, snapshot.current])
  useEffect(() => {
    if (!open || triggerRef.current === null) return
    const panel = panelRef.current
    const update = (): void => { if (triggerRef.current !== null) setStyle(pickerPosition(triggerRef.current)) }
    const closeOutside = (event: MouseEvent): void => {
      const node = event.target
      if (!(node instanceof Node) || triggerRef.current?.contains(node) === true || panelRef.current?.contains(node) === true) return
      setOpen(false)
    }
    const routeDetailWheel = (event: WheelEvent): void => {
      const list = listRef.current
      const node = event.target
      if (list === null || !(node instanceof Node) || list.contains(node) || event.deltaY === 0) return
      const maxScrollTop = list.scrollHeight - list.clientHeight
      if (maxScrollTop <= 0) return
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientHeight : 1
      event.preventDefault()
      list.scrollTop = Math.max(0, Math.min(maxScrollTop, list.scrollTop + event.deltaY * multiplier))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('mousedown', closeOutside)
    panel?.addEventListener('wheel', routeDetailWheel, { passive: false })
    const timer = window.setTimeout(() => { choiceRefs.current.get(focusedId)?.focus() }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('mousedown', closeOutside)
      panel?.removeEventListener('wheel', routeDetailWheel)
    }
  }, [open, focusedId])

  if (experience.mode !== 'paimind' || snapshot.status !== 'ready' || current === undefined) return null
  const ordered = snapshot.choices
  const focusChoice = (offset: number): void => {
    const index = Math.max(0, ordered.findIndex(choice => choice.id === focusedId))
    const next = ordered[(index + offset + ordered.length) % ordered.length]
    if (next === undefined) return
    setFocusedId(next.id)
    choiceRefs.current.get(next.id)?.focus()
  }
  const select = (choice: HarnessAgentChoice): void => {
    setOpen(false)
    void bridge.select(choice.id)
    window.setTimeout(() => { triggerRef.current?.focus() }, 0)
  }
  const groups = (['recommended', 'platform-mode'] as const)
    .map(category => ({ category, choices: ordered.filter(choice => choice.category === category) }))
    .filter(group => group.choices.length > 0)

  const panel = open ? createPortal(<div data-paimind-agent-picker-layer>
    <div data-paimind-agent-picker-scrim aria-hidden="true" onMouseDown={() => { setOpen(false) }} />
    <div
      ref={panelRef}
      data-paimind-agent-picker
      role="dialog"
      aria-label={zh ? '选择 Agent' : 'Choose an Agent'}
      style={style}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
        else if (event.key === 'ArrowDown') { event.preventDefault(); focusChoice(1) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); focusChoice(-1) }
        else if (event.key === 'Home') { event.preventDefault(); const first = ordered[0]; if (first !== undefined) { setFocusedId(first.id); choiceRefs.current.get(first.id)?.focus() } }
        else if (event.key === 'End') { event.preventDefault(); const last = ordered.at(-1); if (last !== undefined) { setFocusedId(last.id); choiceRefs.current.get(last.id)?.focus() } }
      }}
    >
      <div ref={listRef} data-paimind-agent-picker-list>
        {groups.map(group => <section key={group.category} data-paimind-agent-picker-group>
          <h3>{categoryLabel(group.category, zh)}</h3>
          {group.choices.map(choice => <button
            key={choice.id}
            ref={element => { if (element === null) choiceRefs.current.delete(choice.id); else choiceRefs.current.set(choice.id, element) }}
            type="button"
            data-paimind-agent-choice
            data-focused={focused?.id === choice.id}
            aria-selected={snapshot.current === choice.id}
            onMouseEnter={() => { setFocusedId(choice.id) }}
            onFocus={() => { setFocusedId(choice.id) }}
            onClick={() => { select(choice) }}
          ><span data-paimind-agent-choice-copy><PaimindAgentAvatar choice={choice} /><span>{choice.name}</span></span>{snapshot.current === choice.id ? <PaimindCheckIcon size={14} /> : null}</button>)}
        </section>)}
      </div>
      <aside data-paimind-agent-picker-detail aria-live="polite">
        {focused === undefined ? null : <PaimindAgentAvatar choice={focused} className="paimind-agent-picker-detail-avatar" />}
        <small>{focused === undefined ? '' : categoryLabel(focused.category, zh)}</small>
        <strong>{focused?.name}</strong>
        <p>{focused?.description}</p>
        <span data-paimind-agent-picker-hint>{zh ? '方向键浏览 · Enter 选择 · Esc 返回' : 'Arrow keys to browse · Enter to select · Esc to return'}</span>
      </aside>
      {snapshot.error === null ? null : <p data-paimind-agent-picker-error role="status">{snapshot.error}</p>}
    </div>
  </div>, document.body) : null

  return <>
    <button
      ref={triggerRef}
      type="button"
      data-paimind-agent-picker-trigger
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={snapshot.busy}
      title={current.description}
      onClick={() => { setOpen(value => !value) }}
      onKeyDown={event => {
        if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !open) {
          event.preventDefault(); setOpen(true)
        }
      }}
    ><PaimindAgentAvatar choice={current} /><span>{current.name}</span><PaimindChevronDownIcon size={13} /></button>
    {panel}
  </>
}

export function ExperienceSettingsRow({ mode, locale }: {
  readonly mode: PaimindExperienceModeController
  readonly locale: PaimindClientContext['locale']
}): React.JSX.Element {
  const snapshot = useMode(mode)
  const zh = useChinese(locale)
  return <section data-paimind-experience-setting>
    <div data-paimind-experience-setting-copy>
      <strong>{zh ? '界面样式' : 'Display style'}</strong>
      <span>{zh ? '标准样式提供配色、布局和快捷入口；基础样式使用系统默认界面。' : 'Standard includes styled layouts and shortcuts. Basic uses the system’s default interface.'}</span>
    </div>
    <div data-paimind-experience-mode role="radiogroup" aria-label={zh ? '选择界面样式' : 'Choose display style'}>
      {(['paimind', 'native'] as const).map(value => <label key={value}>
        <input
          type="radio"
          name="paimind-visual-experience-mode"
          value={value}
          checked={snapshot.mode === value}
          disabled={!snapshot.writable || snapshot.busy}
          onChange={() => { void mode.set(value) }}
        />
        <span>{value === 'paimind' ? (zh ? '标准样式' : 'Standard') : (zh ? '基础样式' : 'Basic')}</span>
      </label>)}
    </div>
  </section>
}

/** One persisted controller backs both the contributed page and standalone fallback. */
export function AppearanceSettings({ mode, locale }: {
  readonly mode: PaimindExperienceModeController
  readonly locale: PaimindClientContext['locale']
}): React.JSX.Element {
  const snapshot = useMode(mode)
  const zh = useChinese(locale)
  const enabled = useSyncExternalStore(subscribePaimindMotion, readPaimindMotion, () => true)
  const choices = [
    { value: 'system', title: zh ? '跟随系统' : 'Follow system', detail: zh ? '使用设备的动画设置' : 'Use your device’s animation setting' },
    { value: 'on', title: zh ? '开启' : 'On', detail: zh ? '显示页面切换和状态动画' : 'Animate page transitions and status indicators' },
    { value: 'off', title: zh ? '关闭' : 'Off', detail: zh ? '静态显示，保留状态提示' : 'Keep status information without animation' },
  ] as const
  return <section data-paimind-ui-scope data-paimind-ui-card data-paimind-appearance aria-label={zh ? '界面设置' : 'Display settings'}>
    <div data-paimind-motion-title><h3>{zh ? '界面设置' : 'Display settings'}</h3>
      <p data-paimind-ui-summary>{zh ? '选择界面样式和动画效果，修改后自动保存并立即生效。' : 'Choose a display style and animations. Changes save automatically and apply immediately.'}</p></div>
    <ExperienceSettingsRow mode={mode} locale={locale} />
    <div data-paimind-motion-title><strong id="paimind-motion-title">{zh ? '界面动画' : 'Interface animations'}</strong>
      <p id="paimind-motion-description" data-paimind-ui-summary>{zh ? '调整页面切换和状态提示中的动画，不影响工作内容里的视频、演示动画及其他插件的独立动画。' : 'Adjust animations in page transitions and status indicators. Videos, presentation animations, and other plugins’ own animations are unaffected.'}</p></div>
    <div data-paimind-ui-choices role="radiogroup" aria-labelledby="paimind-motion-title" aria-describedby="paimind-motion-description" aria-busy={snapshot.busy}>
      {choices.map(choice => <label key={choice.value} data-paimind-ui-choice>
        <input type="radio" name="paimind-motion" value={choice.value} checked={snapshot.motion === choice.value}
          disabled={!snapshot.writable || snapshot.busy} onChange={() => { void mode.setMotion(choice.value) }} />
        <span><strong>{choice.title}</strong><small>{choice.detail}</small></span>
      </label>)}
    </div>
    <div data-paimind-motion-preview data-motion-enabled={enabled}>
      <i data-paimind-motion-indicator aria-hidden="true" />
      <span><strong>{zh ? '动画预览' : 'Animation preview'}</strong><small data-paimind-ui-summary>{enabled
        ? (zh ? '动画已开启，圆点正在缓慢闪动' : 'Animations are on; the dot gently pulses')
        : (zh ? '动画已关闭，状态提示仍然显示' : 'Animations are off; status information remains visible')}</small></span>
    </div>
    <p data-paimind-ui-state={snapshot.error ? 'error' : 'neutral'} role={snapshot.error ? 'alert' : 'status'}>{snapshot.error
      ? (zh ? '未能保存，已恢复当前设置。请重新选择以重试。' : 'Could not save. Current settings restored; select again to retry.')
      : snapshot.status === 'loading' ? (zh ? '正在读取界面设置…' : 'Loading display settings…')
      : !snapshot.writable ? (zh ? '暂时无法保存界面设置，请检查连接。' : 'Display settings cannot be saved right now. Check the connection.')
      : snapshot.busy ? (zh ? '正在保存…' : 'Saving…')
      : (zh ? '设置自动保存，重新打开后仍然生效。' : 'Settings save automatically and remain after reopening.')}</p>
  </section>
}

function AppearanceSettingsFallback(props: Parameters<typeof AppearanceSettings>[0] & { readonly slots: HarnessInspectableSlotRegistry }): React.JSX.Element | null {
  const hasPersonalization = useSyncExternalStore(
    listener => props.slots.subscribe('settings.section', listener),
    () => props.slots.entries('settings.section').some(entry => entry.options.id === 'paimind-user-settings'),
  )
  return hasPersonalization ? null : <AppearanceSettings {...props} />
}

function installExperienceRuntime(
  ctx: VisualExperienceClientContext,
  mode: PaimindExperienceModeController,
): () => void {
  const motion = installPaimindMotionPreference(document, window)
  // Inherit durations only; no native host rule consumes these variables.
  const previousMotionScope = document.body.getAttribute('data-paimind-motion-scope')
  document.body.setAttribute('data-paimind-motion-scope', 'visual-experience')
  const markers = new HarnessExperienceMarkers(document)
  const composerOverlay = new PaimindComposerOverlayPresenter(document, window)
  let themeDispose: (() => void) | null = null
  let disposed = false

  const sync = (): void => {
    if (disposed) return
    motion.set(mode.getSnapshot().motion)
    const active = mode.getSnapshot().mode === 'paimind'
    markers.setMode(active ? 'paimind' : 'native')
    composerOverlay.setMode(active ? 'paimind' : 'native')
    if (active && themeDispose === null) themeDispose = ctx.theme.overrideTokens(PACKAGE_NAME, THEME_TOKENS)
    if (!active && themeDispose !== null) { themeDispose(); themeDispose = null }
  }

  const stopMode = mode.subscribe(sync)
  sync()
  return () => {
    disposed = true
    stopMode()
    themeDispose?.()
    composerOverlay.dispose()
    markers.dispose()
    motion.dispose()
    if (document.body.getAttribute('data-paimind-motion-scope') === 'visual-experience') {
      if (previousMotionScope === null) document.body.removeAttribute('data-paimind-motion-scope')
      else document.body.setAttribute('data-paimind-motion-scope', previousMotionScope)
    }
  }
}

function installAgentExperience(
  ctx: VisualExperienceClientContext,
  mode: PaimindExperienceModeController,
): () => void {
  const inputBridge = new NativeHarnessInputTriggerBridge(
    ctx.get('inputTriggers'),
    ctx.get('sessions'),
    ctx.get('connection').api.skills,
  )
  let bridge: HarnessAgentChoiceBridge | null = null
  let seatDispose: (() => void) | null = null
  let quickDispose: (() => void) | null = null
  let contextDispose: (() => void) | null = null
  let avatarPresenter: PaimindAgentAvatarPresenter | null = null
  let generation = 0
  let disposed = false

  const clear = (): void => {
    generation += 1
    contextDispose?.(); contextDispose = null
    avatarPresenter?.dispose(); avatarPresenter = null
    inputBridge.restore()
    seatDispose?.(); seatDispose = null
    quickDispose?.(); quickDispose = null
    bridge?.restore()
    bridge?.dispose()
    bridge = null
  }

  const sync = (): void => {
    if (disposed) return
    if (mode.getSnapshot().mode !== 'paimind') { clear(); return }
    if (bridge !== null) return
    const nativeSeat = resolveHarnessAgentPresetSeatControl(ctx.slots)
    if (nativeSeat === null) return
    // One bridge owns every Agent selection entry point in mode. The
    // hero picker, Quick Agents and the @ source are different renderers over
    // the same native Harness Preset seat, never parallel Agent state.
    const candidate = new NativeHarnessAgentChoiceBridge(ctx.get('connection').api.agentPresets, nativeSeat)
    bridge = candidate
    const currentGeneration = ++generation
    void candidate.load().then(ready => {
      if (disposed || bridge !== candidate || generation !== currentGeneration
        || mode.getSnapshot().mode !== 'paimind') return
      if (!ready) { clear(); return }
      const language = (): boolean => ctx.locale.getLocale().active.toLowerCase().startsWith('zh')
      const includes = (value: string, query: string): boolean => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      const agentSource: HarnessInputTriggerSource = {
        trigger: '@', name: 'paimind-agent', order: -20, showGroupTitle: false,
        async candidates(session, request) {
          if (!inputBridge.isBlankSession(session.sessionId) || request.signal.aborted) return []
          return candidate.getSnapshot().choices
            .map(choice => choice.id === 'cordis' ? {
              ...choice,
              name: language() ? '个人智能体创建助手' : 'Personal Agent creation assistant',
              description: language()
                ? '使用 Harness 原生创造模式创建和配置个人智能体。'
                : 'Use the native Harness Creator mode to create and configure a personal Agent.',
            } : choice)
            .sort((left, right) => Number(right.category === 'recommended') - Number(left.category === 'recommended'))
            .filter(choice => includes(`${choice.name} ${choice.description}`, request.query))
            .map(choice => ({
              name: choice.name,
              description: choice.description,
              icon: paimindAgentAvatarIcon(choice.id),
              section: choice.category === 'recommended'
                ? (language() ? '推荐 Agent' : 'Recommended Agents')
                : (language() ? '平台模式' : 'Platform Modes'),
              value: choice.id,
            }))
        },
        onPick({ candidate: choice, session }) {
          const id = choice.value
          if (id === undefined || !inputBridge.isBlankSession(session.sessionId)) return 'handled'
          void candidate.select(id)
          if (id === 'cordis') requestPaimindAgentBuilder({ productKind: 'personal' })
          return { text: '' }
        },
      }
      const skillSource: HarnessInputTriggerSource = {
        trigger: '@', name: 'paimind-skill', order: -10, showGroupTitle: false,
        async candidates(session, request) {
          const skills = await inputBridge.nativeSkillCandidates(session, request)
          if (request.signal.aborted) return []
          return skills
            .filter(skill => includes(`${skill.name} ${skill.description ?? ''}`, request.query))
            .map(skill => ({
              name: skill.name,
              ...(skill.description === undefined ? {} : { description: skill.description }),
              section: language() ? 'Skill（技能）' : 'Skills',
              value: skill.name,
            }))
        },
        onPick(pick) {
          return inputBridge.pickNativeSkill(pick)
        },
      }
      avatarPresenter = new PaimindAgentAvatarPresenter(document)
      const semanticsReady = inputBridge.activate([agentSource, skillSource])
      quickDispose = ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'paimind-quick-agents',
        order: -100,
        inject: () => ({ bridge: candidate, mode, locale: ctx.locale }),
      }, QuickAgents)
      seatDispose = ctx.slots.register({
        name: 'conversation.hero.agentPreset',
        id: 'paimind-visual-agent-choice',
        priority: -100,
        inject: () => ({ bridge: candidate, mode, locale: ctx.locale }),
      }, AgentChoiceSeat)
      if (semanticsReady) {
        contextDispose = ctx.slots.register({
          name: 'conversation.input.left',
          id: 'paimind-add-context',
          order: -1000,
          inject: () => ({ bridge: inputBridge, mode, locale: ctx.locale }),
        }, ComposerContextLauncher)
      }
    })
  }

  const stopMode = mode.subscribe(sync)
  const stopSeat = ctx.slots.subscribe('conversation.hero.agentPreset', sync)
  sync()
  return () => {
    disposed = true
    stopSeat()
    stopMode()
    clear()
    inputBridge.dispose()
  }
}

// Preserve the published client export while keeping host DOM coupling in compat.
export { installHarnessSettingsTriggerAccessibility } from '@hansen/harness-compat'

export function apply(ctx: VisualExperienceClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:visual-experience',
    packageName: PACKAGE_NAME,
    category: 'experience',
    nameZh: '界面显示',
    nameEn: 'Visual Experience',
    descriptionZh: '选择界面样式和动画，调整欢迎页与智能体选择体验。',
    descriptionEn: 'Adds a reversible theme, density, welcome and Agent choice experience to Harness.',
    surface: 'shell',
    maturity: 'available',
    order: -80,
  })

  const scope = ctx.settingsScope.bind<PaimindVisualExperienceSettings>({
    namespace: resolveHarnessSettingsNamespace(PAIMIND_VISUAL_EXPERIENCE_NAMESPACE),
    decode: decodePaimindVisualExperienceSettings,
  })
  const mode = new PaimindExperienceModeController(scope)
  ctx.effect(installStyle, 'paimind-visual-experience: style')
  ctx.effect(() => installHarnessSettingsTriggerAccessibility(document), 'paimind-visual-experience: Settings trigger accessibility')
  ctx.effect(() => installHarnessSettingsSectionScrollReset(document), 'paimind-visual-experience: Settings section scroll position')
  ctx.effect(() => installHarnessSettingsNavigationIcons(ctx.slots, [
    { id: 'paimind-mcp-center', mount(container) { const root = createRoot(container); root.render(<PaimindConnectionIcon size={16} />); return () => { root.unmount() } } },
    { id: 'paimind-context-library', mount(container) { const root = createRoot(container); root.render(<PaimindTemplateIcon size={16} />); return () => { root.unmount() } } },
    { id: 'market', mount(container) { const root = createRoot(container); root.render(<PaimindMarketplaceIcon size={16} />); return () => { root.unmount() } } },
    { id: 'paimind-extensions', mount(container) { const root = createRoot(container); root.render(<PaimindExtensionIcon />); return () => { root.unmount() } } },
    { id: 'paimind-model-services', mount(container) { const root = createRoot(container); root.render(<PaimindNewConversationIcon />); return () => { root.unmount() } } },
    { id: 'paimind-platform-scheduler', mount(container) { const root = createRoot(container); root.render(<PaimindSchedulerIcon />); return () => { root.unmount() } } },
    { id: 'paimind-user-settings', mount(container) { const root = createRoot(container); root.render(<PaimindPersonalizationIcon />); return () => { root.unmount() } } },
    { id: 'paimind-developer-resources', mount(container) { const root = createRoot(container); root.render(<PaimindDeveloperIcon />); return () => { root.unmount() } } },
  ], document), 'paimind-visual-experience: Settings navigation icons')
  ctx.effect(() => () => { mode.dispose() }, 'paimind-visual-experience: mode controller')
  ctx.effect(() => installExperienceRuntime(ctx, mode), 'paimind-visual-experience: reversible runtime')
  ctx.effect(() => installAgentExperience(ctx, mode), 'paimind-visual-experience: native Agent bridge')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'paimind-resource-navigation', order: -30,
    inject: () => ({ mode, locale: ctx.locale }),
  }, ResourceNavigationSlot))

  ctx.slots.inject('paimind.personalization.appearance', () => ctx.slots.register({
    name: 'paimind.personalization.appearance', id: 'paimind-visual-preferences', order: 0,
    inject: () => ({ mode, locale: ctx.locale }),
  }, AppearanceSettings))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'paimind-visual-experience',
    order: 15,
    inject: () => ({ mode, locale: ctx.locale, slots: ctx.slots }),
  }, AppearanceSettingsFallback))
}
