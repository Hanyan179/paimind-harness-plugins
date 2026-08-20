import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import {
  contributePaimindExtension,
  resolveHarnessSettingsNamespace,
  resolveHarnessAgentPresetSeatControl,
  type HarnessAgentChoice,
  type HarnessAgentChoiceBridge,
  type HarnessAgentPresetConnection,
  type HarnessInspectableSlotRegistry,
  type PaimindClientContext,
  type PaimindSettingsScope,
  type PaimindSettingsScopeBinder,
  type PaimindThemeService,
} from '@paimind/harness-compat'
import {
  NativeHarnessInputTriggerBridge,
  type HarnessComposerInputSnapshot,
  type HarnessInputTriggerSource,
} from '@paimind/harness-compat'
import {
  HarnessExperienceMarkers,
  NativeHarnessAgentChoiceBridge,
  isPaimindProductSurfaceAvailable,
  requestPaimindProductSurface,
} from '@paimind/harness-compat/client-surface'
import {
  PaimindAgentIcon,
  PaimindCheckIcon,
  PaimindChevronDownIcon,
  PaimindChevronRightIcon,
  PaimindPlusIcon,
} from '@paimind/harness-compat/client-icons'
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

const PACKAGE_NAME = '@paimind/visual-experience'
const STYLE_ID = PACKAGE_NAME

const BASE_INJECT = [
  'slots', 'locale', 'connection', 'remote', 'settingsScope', 'theme', 'inputTriggers', 'sessions',
] as const
export const inject = [...BASE_INJECT]

interface VisualExperienceClientContext extends PaimindClientContext {
  readonly slots: HarnessInspectableSlotRegistry
  readonly settingsScope: PaimindSettingsScopeBinder
  readonly theme: PaimindThemeService
  get(name: 'connection'): HarnessAgentPresetConnection
  get(name: 'inputTriggers' | 'sessions'): unknown
}

interface ExperienceModeSnapshot {
  readonly mode: PaimindExperienceMode
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly writable: boolean
  readonly busy: boolean
}

export class PaimindExperienceModeController {
  private snapshot: ExperienceModeSnapshot = Object.freeze({
    mode: DEFAULT_PAIMIND_EXPERIENCE_MODE,
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

  async set(mode: PaimindExperienceMode): Promise<void> {
    if (this.disposed || this.snapshot.busy || !this.snapshot.writable || this.snapshot.mode === mode) return
    const previous = this.snapshot.mode
    this.publish({ ...this.snapshot, mode, busy: true })
    try {
      await this.scope.set('mode', mode)
    } finally {
      if (!this.disposed) {
        const state = this.scope.getSnapshot()
        this.publish({
          mode: state.value?.mode ?? previous,
          status: state.status,
          writable: state.writable,
          busy: false,
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
      status: state.status,
      writable: state.writable,
      busy: false,
    })
  }

  private publish(snapshot: ExperienceModeSnapshot): void {
    if (this.snapshot.mode === snapshot.mode
      && this.snapshot.status === snapshot.status
      && this.snapshot.writable === snapshot.writable
      && this.snapshot.busy === snapshot.busy) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of [...this.listeners]) listener()
  }
}

const THEME_TOKENS = Object.freeze({
  '--dsw-alias-bg-base': { light: '#f7f8fb', dark: '#0c1320' },
  '--dsw-alias-bg-layer-1': { light: 'rgba(255,255,255,.86)', dark: 'rgba(20,29,45,.88)' },
  '--dsw-alias-bg-layer-2': { light: 'rgba(239,243,249,.72)', dark: 'rgba(29,40,59,.72)' },
  '--dsw-alias-bg-overlay': { light: 'rgba(252,252,251,.96)', dark: 'rgba(17,25,39,.96)' },
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

const STYLE = `
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
body[data-paimind-experience='paimind'] [data-paimind-paramont-hero-headline],
body[data-paimind-experience='paimind'] [data-paimind-native-hero-preview]{display:none!important}
body[data-paimind-experience='paimind'] [data-paimind-paramont-hero-mark]{width:38px;height:25px;color:var(--paimind-navy-deep)}
[data-paimind-experience-copy]{display:contents}
[data-paimind-experience-eyebrow]{margin-top:-2px;color:var(--paimind-navy);font-size:10px;font-weight:750;line-height:14px;letter-spacing:.22em;text-transform:uppercase}
[data-paimind-experience-title]{max-width:760px;margin-top:1px;color:var(--paimind-ink);font-size:38px;font-weight:660;line-height:1.18;letter-spacing:-.035em;text-wrap:balance}
[data-paimind-experience-subtitle]{max-width:700px;color:var(--paimind-muted);font-size:13px;line-height:20px;text-wrap:balance}
body[data-paimind-experience='paimind'] [data-composer-card]{border:1px solid color-mix(in srgb,var(--paimind-line) 76%,white 24%)!important;border-radius:var(--paimind-radius)!important;background:var(--paimind-glass)!important;box-shadow:var(--paimind-shadow)!important;backdrop-filter:blur(20px) saturate(1.12);-webkit-backdrop-filter:blur(20px) saturate(1.12);transition:border-color .18s ease,background .18s ease,box-shadow .2s ease,transform .18s ease}
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
  box-sizing:border-box!important;top:auto!important;right:auto!important;bottom:calc(100% + 8px)!important;left:0!important;width:min(720px,100%)!important;min-width:0!important;max-width:100%!important;
  max-height:min(360px,var(--paimind-composer-overlay-room,360px))!important;padding:6px!important;border:1px solid color-mix(in srgb,var(--paimind-line) 82%,white 18%)!important;
  border-radius:16px!important;background:color-mix(in srgb,var(--paimind-canvas) 94%,white 6%)!important;box-shadow:0 22px 62px rgba(17,39,63,.18)!important;
  backdrop-filter:blur(24px) saturate(1.12);-webkit-backdrop-filter:blur(24px) saturate(1.12);animation:paimind-composer-menu-in .18s ease-out;
}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']{display:grid;grid-template-columns:auto minmax(110px,40%) minmax(0,1fr);align-items:center;min-height:44px;padding:8px 11px;border-radius:11px;color:var(--paimind-ink);font-size:13px;line-height:20px}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option'][aria-selected='true']{background:color-mix(in srgb,var(--paimind-accent) 15%,transparent)!important;box-shadow:inset 3px 0 0 color-mix(in srgb,var(--paimind-accent) 74%,transparent)}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>[aria-hidden]{display:inline-flex;flex:none;width:22px;height:22px;align-items:center;justify-content:center;border-radius:50%;background:color-mix(in srgb,var(--paimind-accent) 9%,transparent)}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>[data-paimind-agent-avatar-host]{width:30px;height:30px;overflow:hidden;background:transparent}
body[data-paimind-experience='paimind'][data-ds-dark-theme] [data-paimind-composer-overlay-anchor] [role='listbox']{background:color-mix(in srgb,var(--paimind-canvas) 94%,#233149 6%)!important}
body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='presentation']{min-height:24px;padding:6px 11px 2px;color:var(--paimind-muted);font-size:10px;font-weight:700;line-height:16px;letter-spacing:.06em;text-transform:uppercase}
[data-paimind-agent-avatar]{display:block;flex:none;width:30px;height:30px;border:1px solid color-mix(in srgb,var(--paimind-line) 72%,white 28%);border-radius:50%;object-fit:cover;background:var(--paimind-glass-strong);box-shadow:0 1px 4px rgba(15,40,68,.12)}
[data-paimind-context-launcher]{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:5px 9px;border:0;border-radius:999px;color:var(--paimind-muted);background:transparent;font:inherit;font-size:12px;line-height:18px;cursor:pointer}
[data-paimind-context-launcher]:hover,[data-paimind-context-launcher]:focus-visible,[data-paimind-context-launcher][aria-expanded='true']{color:var(--paimind-navy);background:color-mix(in srgb,var(--paimind-accent) 11%,transparent);outline:none}
[data-paimind-context-launcher]:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--paimind-accent) 30%,transparent)}
[data-paimind-context-launcher]:disabled{opacity:.46;cursor:not-allowed}
body[data-paimind-experience='paimind'][data-paimind-composer-overlay='open'] [data-paimind-quick-agents]{visibility:hidden;opacity:0;pointer-events:none}
[data-paimind-quick-agents]{display:grid;gap:8px;width:100%;color:var(--paimind-muted)}
[data-paimind-quick-agents-label]{display:flex;align-items:center;gap:6px;padding:0 2px;font-size:11px;font-weight:650;line-height:16px;letter-spacing:.02em}
[data-paimind-quick-agents-list]{display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden}
[data-paimind-quick-agent],[data-paimind-quick-all]{display:inline-flex;align-items:center;gap:6px;min-width:0;min-height:38px;border:1px solid var(--paimind-line);border-radius:999px;color:var(--paimind-muted);background:color-mix(in srgb,var(--paimind-glass-strong) 82%,transparent);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:color .16s ease,border-color .16s ease,background .16s ease,transform .16s ease}
[data-paimind-quick-agent]{padding:4px 10px 4px 4px}
[data-paimind-quick-all]{padding:6px 11px}
[data-paimind-quick-agent] [data-paimind-agent-avatar]{width:28px;height:28px}
[data-paimind-quick-agent] span{overflow:hidden;text-overflow:ellipsis}
[data-paimind-quick-agent]:hover,[data-paimind-quick-agent]:focus-visible,[data-paimind-quick-all]:hover,[data-paimind-quick-all]:focus-visible{border-color:color-mix(in srgb,var(--paimind-accent) 42%,var(--paimind-line));color:var(--paimind-navy);background:var(--paimind-glass-strong);outline:none;transform:translateY(-1px)}
[data-paimind-quick-agent][aria-pressed='true']{border-color:color-mix(in srgb,var(--paimind-accent) 50%,var(--paimind-line));color:var(--paimind-navy);background:color-mix(in srgb,var(--paimind-accent) 10%,var(--paimind-glass-strong))}
[data-paimind-quick-agent]:disabled,[data-paimind-quick-all]:disabled{opacity:.46;cursor:not-allowed;transform:none}
[data-paimind-agent-picker-trigger]{display:inline-flex;align-items:center;gap:7px;max-width:260px;min-height:34px;padding:6px 10px;border:1px solid transparent;border-radius:999px;color:var(--paimind-ink);background:color-mix(in srgb,var(--paimind-ink) 5%,transparent);font:inherit;font-size:13px;line-height:18px;cursor:pointer;transition:background .16s ease,border-color .16s ease}
[data-paimind-agent-picker-trigger] span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-agent-picker-trigger]:hover,[data-paimind-agent-picker-trigger]:focus-visible{border-color:var(--paimind-line);background:color-mix(in srgb,var(--paimind-ink) 8%,transparent);outline:none}
[data-paimind-agent-picker-layer]{position:fixed;inset:0;z-index:1200;pointer-events:none}
[data-paimind-agent-picker-scrim]{display:none}
[data-paimind-agent-picker]{position:fixed;display:grid;grid-template-columns:minmax(190px,42%) minmax(240px,1fr);overflow:hidden;max-height:360px;border:1px solid var(--paimind-line);border-radius:18px;background:var(--paimind-glass-strong);box-shadow:0 24px 72px rgba(17,39,63,.2);backdrop-filter:blur(24px) saturate(1.12);-webkit-backdrop-filter:blur(24px) saturate(1.12);pointer-events:auto;animation:paimind-pop-in .18s ease-out}
[data-paimind-agent-picker-list]{min-width:0;overflow:auto;padding:8px;border-right:1px solid var(--paimind-line)}
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
body[data-paimind-experience='paimind'] [data-paimind-agent-center],body[data-paimind-experience='paimind'] [data-paimind-skill-center],body[data-paimind-experience='paimind'] [data-paimind-extension-center],body[data-paimind-experience='paimind'] [data-paimind-notifications],body[data-paimind-experience='paimind'] [data-paimind-user-settings]{--paimind-surface:var(--paimind-glass-strong);background:color-mix(in srgb,var(--paimind-canvas) 92%,var(--paimind-accent) 8%)}
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
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox']{width:100%!important;max-height:min(52vh,var(--paimind-composer-overlay-room,52vh))!important;padding:5px!important;border-radius:16px!important}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']{grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;height:auto!important;min-height:66px;padding:8px 10px;align-items:start;column-gap:8px;row-gap:2px}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>[aria-hidden]{grid-column:1;grid-row:1/span 2;align-self:start}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>span:nth-child(2){grid-column:2;grid-row:1;align-self:end;white-space:nowrap}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>span:last-child:not(:first-child){display:-webkit-box!important;grid-column:2;grid-row:2;overflow:hidden;white-space:normal!important;line-height:17px;-webkit-box-orient:vertical;-webkit-line-clamp:2}
  body[data-paimind-experience='paimind'] [data-paimind-composer-overlay-anchor] [role='listbox'] [role='option']>span{max-width:100%}
  [data-paimind-context-launcher] span{display:none}
  [data-paimind-agent-picker-scrim]{display:block;position:absolute;inset:0;background:rgba(4,11,20,.42);pointer-events:auto}
  [data-paimind-agent-picker]{right:0!important;bottom:0!important;left:0!important;top:auto!important;grid-template-columns:1fr;width:auto!important;max-height:min(76vh,620px);border-width:1px 0 0;border-radius:22px 22px 0 0;animation:paimind-sheet-in .2s ease-out}
  [data-paimind-agent-picker-list]{max-height:44vh;border-right:0;border-bottom:1px solid var(--paimind-line)}
  [data-paimind-agent-picker-detail]{padding:16px 18px 22px}
  [data-paimind-experience-setting]{grid-template-columns:1fr;gap:10px}
  [data-paimind-experience-mode]{width:100%}[data-paimind-experience-mode] label{flex:1}[data-paimind-experience-mode] span{min-width:0}
}
@keyframes paimind-sheet-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){body[data-paimind-experience='paimind'] *,body[data-paimind-experience='paimind'] *::before,body[data-paimind-experience='paimind'] *::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
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

const COMPOSER_OVERLAY_ANCHOR_MARKER = 'data-paimind-composer-overlay-anchor'
const COMPOSER_OVERLAY_ROOM = '--paimind-composer-overlay-room'

/**
 * Restyles the native Harness input overlay without owning its candidate
 * data, selection state, or keyboard behavior. All annotations and inline
 * measurements are removed when PAIMind mode is disabled or the plugin exits.
 */
export class PaimindComposerOverlayPresenter {
  private mode: PaimindExperienceMode = 'native'
  private disposed = false
  private queued = false
  private anchor: HTMLElement | null = null
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
    this.observer.disconnect()
    this.resizeObserver?.disconnect()
    this.win.removeEventListener('resize', this.schedule)
    this.clearAnchor()
    this.doc.body.removeAttribute('data-paimind-composer-overlay')
  }

  private readonly schedule = (): void => {
    if (this.queued || this.disposed) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      this.apply()
    })
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
    this.resizeObserver?.disconnect()
    if (composer !== null) this.resizeObserver?.observe(composer)
    const top = composer?.getBoundingClientRect().top ?? this.win.innerHeight
    const room = Math.max(0, Math.floor(top - 16))
    nextAnchor.style.setProperty(COMPOSER_OVERLAY_ROOM, `${room}px`)
    const open = slot.querySelector('[role="listbox"]') !== null
    if (open) this.doc.body.dataset.paimindComposerOverlay = 'open'
    else this.doc.body.removeAttribute('data-paimind-composer-overlay')
  }

  private clearAnchor(): void {
    this.resizeObserver?.disconnect()
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

function usePortalTarget(selector: string): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(() => document.querySelector<HTMLElement>(selector))
  useEffect(() => {
    const refresh = (): void => { setTarget(document.querySelector<HTMLElement>(selector)) }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [selector])
  return target
}

export function ExperienceHeroPortal({ mode, locale }: {
  readonly mode: PaimindExperienceModeController
  readonly locale: PaimindClientContext['locale']
}): React.JSX.Element | null {
  const state = useMode(mode)
  const zh = useChinese(locale)
  const target = usePortalTarget('[data-paimind-hero-brand-seat]')
  if (state.mode !== 'paimind' || target === null) return null
  return createPortal(<>
    <span data-paimind-experience-eyebrow>PARAMONT · PAIMIND</span>
    <span data-paimind-experience-title role="heading" aria-level={1}>{zh ? '有什么可以帮你完成？' : 'What can we help you accomplish?'}</span>
    <span data-paimind-experience-subtitle>{zh
      ? '提问、分析资料、生成内容；用 @ 选择 Agent 或 Skill，用 + 添加文件与会话上下文，用 / 调用原生模式与命令。'
      : 'Ask, analyze materials, and create content. Use @ for Agents or Skills, + for file and session context, and / for native modes and commands.'}</span>
  </>, target)
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
  const identity = resolvePaimindAgentAvatar(choice)
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
 * replaces only PAIMind Agent icon tokens with an image; it never reorders,
 * focuses, selects, or owns candidates, and restores the original text token
 * byte-for-byte on Native mode or plugin disposal.
 */
export class PaimindAgentAvatarPresenter {
  private static readonly PROJECTION_OWNER = '@paimind/visual-experience'
  private readonly observer: MutationObserver
  private disposed = false

  constructor(private readonly doc: Document = document) {
    this.observer = new MutationObserver(() => { this.hydrate() })
    this.observer.observe(doc.body, { childList: true, subtree: true })
    this.hydrate()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observer.disconnect()
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
      const identity = resolvePaimindAgentAvatar({ id: canonicalId })
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
      '[data-paimind-agent-avatar-seat][data-paimind-agent-id]',
    )
    for (const seat of seats) {
      const canonicalId = seat.dataset.paimindAgentId?.trim() ?? ''
      if (canonicalId === '') continue
      const owned = seat.querySelector<HTMLImageElement>(
        `:scope > img[data-paimind-agent-avatar-owner="${PaimindAgentAvatarPresenter.PROJECTION_OWNER}"]`,
      )
      if (owned !== null) continue
      // Native/avatar metadata, when Harness exposes it, wins over PAIMind's
      // deterministic visual projection without replacing identity semantics.
      if (seat.querySelector(':scope > img') !== null) continue
      const identity = resolvePaimindAgentAvatar({ id: canonicalId })
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
    <div data-paimind-quick-agents-label><PaimindAgentIcon size={13} />{zh ? '快捷 Agent' : 'Quick Agents'}</div>
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
      >{zh ? '全部' : 'All'}<PaimindChevronRightIcon size={13} /></button>
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
  const choiceRefs = useRef(new Map<string, HTMLButtonElement>())
  const current = snapshot.choices.find(choice => choice.id === snapshot.current)
  const focused = snapshot.choices.find(choice => choice.id === focusedId) ?? current

  useEffect(() => { if (!open) setFocusedId(snapshot.current) }, [open, snapshot.current])
  useEffect(() => {
    if (!open || triggerRef.current === null) return
    const update = (): void => { if (triggerRef.current !== null) setStyle(pickerPosition(triggerRef.current)) }
    const closeOutside = (event: MouseEvent): void => {
      const node = event.target
      if (!(node instanceof Node) || triggerRef.current?.contains(node) === true || panelRef.current?.contains(node) === true) return
      setOpen(false)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('mousedown', closeOutside)
    const timer = window.setTimeout(() => { choiceRefs.current.get(focusedId)?.focus() }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('mousedown', closeOutside)
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
      aria-label={zh ? '选择 Agent 或平台模式' : 'Choose an Agent or platform mode'}
      style={style}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
        else if (event.key === 'ArrowDown') { event.preventDefault(); focusChoice(1) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); focusChoice(-1) }
        else if (event.key === 'Home') { event.preventDefault(); const first = ordered[0]; if (first !== undefined) { setFocusedId(first.id); choiceRefs.current.get(first.id)?.focus() } }
        else if (event.key === 'End') { event.preventDefault(); const last = ordered.at(-1); if (last !== undefined) { setFocusedId(last.id); choiceRefs.current.get(last.id)?.focus() } }
      }}
    >
      <div data-paimind-agent-picker-list>
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
      <strong>{zh ? 'PAIMind 视觉体验' : 'PAIMind visual experience'}</strong>
      <span>{zh ? 'PAIMind 模式启用完整视觉与交互；原生模式立即撤销并恢复 Harness。' : 'PAIMind enables the full visual layer; Native immediately restores Harness.'}</span>
    </div>
    <div data-paimind-experience-mode role="radiogroup" aria-label={zh ? '视觉体验模式' : 'Visual experience mode'}>
      {(['paimind', 'native'] as const).map(value => <label key={value}>
        <input
          type="radio"
          name="paimind-visual-experience-mode"
          value={value}
          checked={snapshot.mode === value}
          disabled={!snapshot.writable || snapshot.busy}
          onChange={() => { void mode.set(value) }}
        />
        <span>{value === 'paimind' ? 'PAIMind' : (zh ? '原生' : 'Native')}</span>
      </label>)}
    </div>
  </section>
}

function installExperienceRuntime(
  ctx: VisualExperienceClientContext,
  mode: PaimindExperienceModeController,
): () => void {
  const markers = new HarnessExperienceMarkers(document)
  const composerOverlay = new PaimindComposerOverlayPresenter(document, window)
  let themeDispose: (() => void) | null = null
  let disposed = false

  const sync = (): void => {
    if (disposed) return
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
  }
}

function installAgentExperience(
  ctx: VisualExperienceClientContext,
  mode: PaimindExperienceModeController,
): () => void {
  const inputBridge = new NativeHarnessInputTriggerBridge(ctx.get('inputTriggers'), ctx.get('sessions'))
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
            .filter(choice => includes(`${choice.name} ${choice.description}`, request.query))
            .map(choice => ({
              name: choice.name,
              description: choice.description,
              icon: paimindAgentAvatarIcon(choice.id),
              section: language() ? 'Agent（智能体）' : 'Agents',
              value: choice.id,
            }))
        },
        onPick({ candidate: choice, session }) {
          const id = choice.value
          if (id === undefined || !inputBridge.isBlankSession(session.sessionId)) return 'handled'
          void candidate.select(id)
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

export function apply(ctx: VisualExperienceClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:visual-experience',
    packageName: PACKAGE_NAME,
    category: 'experience',
    nameZh: 'PAIMind 视觉体验',
    nameEn: 'PAIMind Visual Experience',
    descriptionZh: '为 Harness 提供可逆的 PAIMind 主题、密度、欢迎页与 Agent 选择体验。',
    descriptionEn: 'Adds a reversible PAIMind theme, density, welcome and Agent choice experience to Harness.',
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
  ctx.effect(() => () => { mode.dispose() }, 'paimind-visual-experience: mode controller')
  ctx.effect(() => installExperienceRuntime(ctx, mode), 'paimind-visual-experience: reversible runtime')
  ctx.effect(() => installAgentExperience(ctx, mode), 'paimind-visual-experience: native Agent bridge')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'paimind-visual-experience-hero',
    order: -90,
    inject: () => ({ mode, locale: ctx.locale }),
  }, ExperienceHeroPortal))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'paimind-visual-experience',
    order: 15,
    inject: () => ({ mode, locale: ctx.locale }),
  }, ExperienceSettingsRow))
}
