import { Component, useEffect, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ThinkingOrb } from 'thinking-orbs'
import {
  contributePaimindExtension,
  RUNTIME_ORB_STATES, locateRuntimeActivityIconSlots, locateRuntimeSidebarActivitySlots,
  locateRuntimeTurnStatus, runtimePresentation,
  type PaimindClientContext,
  type RuntimeActivityIconSlot,
  type RuntimeOrbDockProps,
  type RuntimeOrbState,
  type PaimindLocaleSource,
} from '@paimind/harness-compat'

/** Host services required before the FP01 client contribution can register. */
export const inject = ['slots', 'locale']

const STYLE_ID = '@paimind/runtime-orbs'
const PREVIEW_QUERY = 'paimindOrbPreview'
const FAULT_QUERY = 'paimindOrbFault'
const STYLE = `
[data-paimind-runtime-orb] {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  width: 20px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
[data-paimind-runtime-orb][data-placement='sidebar'] {
  width: 16px;
  height: 16px;
}
[data-paimind-runtime-orb][data-placement='history'] {
  position: absolute;
  inset: -2px;
}
[data-paimind-runtime-orb][data-placement='sidebar'] [data-paimind-runtime-orb-canvas] {
  transform: scale(0.8);
}
[data-paimind-runtime-history-host] {
  position: relative;
}
[data-paimind-runtime-history-host]:has(> [data-paimind-runtime-orb]) > :first-child:not([data-paimind-runtime-orb]) {
  visibility: hidden !important;
}
[data-disclosure-row]:hover > [data-paimind-runtime-history-host] > [data-paimind-runtime-orb] {
  opacity: 0;
}
[data-sample='bash']:hover > [data-paimind-runtime-history-host] > [data-paimind-runtime-orb] {
  opacity: 0;
}
[data-paimind-runtime-sidebar-host] {
  position: relative;
}
[data-paimind-runtime-sidebar-host]:has(> [data-paimind-runtime-orb]) > [data-state] {
  visibility: hidden !important;
}
[data-paimind-runtime-turn-status-host]:has(> [data-paimind-runtime-status]) {
  gap: 8px;
  background: none !important;
  animation: none !important;
  color: var(--dsw-alias-label-secondary) !important;
  -webkit-text-fill-color: var(--dsw-alias-label-secondary) !important;
  font-size: 0 !important;
}
[data-paimind-runtime-turn-status-host]:has(> [data-paimind-runtime-status]) > [aria-hidden] {
  margin-left: 0 !important;
  font: var(--dsw-font-xs-13) !important;
}
[data-paimind-runtime-status] {
  order: -1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  color: var(--dsw-alias-label-secondary, #555b64);
  -webkit-text-fill-color: var(--dsw-alias-label-secondary, #555b64);
  font: var(--dsw-font-s-strong-14);
  white-space: nowrap;
}
[data-paimind-runtime-status][data-placement='dock'] {
  padding: 0 2px;
}
[data-paimind-runtime-orb-canvas] {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
[data-paimind-runtime-orb-preview] {
  box-sizing: border-box;
  position: fixed;
  z-index: 70;
  top: 72px;
  right: 24px;
  width: min(320px, calc(100vw - 32px));
  max-height: calc(100vh - 96px);
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, 0.24));
  border-radius: 16px;
  color: var(--dsw-alias-label-primary, #202124);
  background: var(--dsw-alias-bg-layer-primary, rgba(255, 255, 255, 0.96));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(16px);
  pointer-events: auto;
}
[data-ds-dark-theme] [data-paimind-runtime-orb-preview] {
  color: var(--dsw-alias-label-primary, #f1f3f5);
  background: var(--dsw-alias-bg-layer-primary, rgba(31, 33, 37, 0.96));
}
[data-paimind-runtime-orb-preview-heading] {
  margin: 0 0 4px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
[data-paimind-runtime-orb-preview-note] {
  margin: 0 0 12px;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  font-size: 11px;
  line-height: 16px;
}
[data-paimind-runtime-orb-preview-stage] {
  height: 88px;
  margin: 8px 0 12px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-secondary, rgba(128, 128, 128, 0.08));
}
[data-paimind-runtime-orb-preview-current] {
  display: grid;
  place-items: center;
  gap: 3px;
  color: var(--dsw-alias-label-secondary, #555b64);
  font-size: 11px;
  line-height: 14px;
}
[data-paimind-runtime-orb-preview-list] {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
[data-paimind-runtime-orb-preview-item] {
  min-width: 0;
  padding: 6px 4px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--dsw-alias-label-secondary, #555b64);
  background: var(--dsw-alias-bg-layer-secondary, rgba(128, 128, 128, 0.08));
  font: inherit;
  font-size: 10px;
  line-height: 14px;
  cursor: pointer;
}
[data-paimind-runtime-orb-preview-item][aria-pressed='true'] {
  border-color: var(--dsw-alias-state-business-primary, #4f7ff8);
  color: var(--dsw-alias-label-primary, #202124);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f7ff8) 12%, transparent);
}
@media (max-width: 520px) {
  [data-paimind-runtime-orb-preview] {
    top: 64px;
    right: 16px;
    left: 16px;
    width: auto;
  }
}
`

interface VisualPreferences {
  readonly dark: boolean
  readonly reducedMotion: boolean
}

function readPreferences(): VisualPreferences {
  return {
    dark: document.body.hasAttribute('data-ds-dark-theme'),
    reducedMotion: document.documentElement.dataset.paimindMotion === 'reduce'
      || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false),
  }
}

function samePreferences(left: VisualPreferences, right: VisualPreferences): boolean {
  return left.dark === right.dark
    && left.reducedMotion === right.reducedMotion
}

function useVisualPreferences(): VisualPreferences {
  const [preferences, setPreferences] = useState(readPreferences)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const refresh = (): void => {
      setPreferences(current => {
        const next = readPreferences()
        return samePreferences(current, next) ? current : next
      })
    }
    const themeObserver = new MutationObserver(refresh)
    const motionObserver = new MutationObserver(refresh)
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-paimind-motion'] })
    media?.addEventListener?.('change', refresh)
    return () => {
      themeObserver.disconnect()
      motionObserver.disconnect()
      media?.removeEventListener?.('change', refresh)
    }
  }, [])
  return preferences
}

const FALLBACK_LOCALE: PaimindLocaleSource = {
  getLocale: () => ({
    active: (document.documentElement.lang || navigator.language).toLowerCase().startsWith('en') ? 'en' : 'zh',
  }),
  subscribe: () => () => {},
}

function useActiveLocale(locale: PaimindLocaleSource | undefined): string {
  const source = locale ?? FALLBACK_LOCALE
  return useSyncExternalStore(
    source.subscribe.bind(source),
    () => source.getLocale().active,
    () => source.getLocale().active,
  )
}

interface BoundaryProps {
  readonly children: ReactNode
}

interface BoundaryState {
  readonly failed: boolean
}

/** Prevent an animation/rendering failure from replacing the native Harness conversation. */
export class RuntimeOrbBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('[paimind/runtime-orbs] animation disabled after render failure', error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

function sameElements(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index])
}

function sameActivitySlots(
  left: readonly RuntimeActivityIconSlot[],
  right: readonly RuntimeActivityIconSlot[],
): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index]
    return other !== undefined
      && entry.host === other.host
      && entry.state === other.state
  })
}

function RuntimeOrbGlyph({ state, placement, preferences, paused }: {
  state: RuntimeOrbState
  placement: 'history' | 'sidebar' | 'status'
  preferences: VisualPreferences
  paused?: boolean
}): ReactNode {
  const isPaused = preferences.reducedMotion || paused === true
  return (
    <span
      data-paimind-runtime-orb
      data-orb-state={state}
      data-placement={placement}
      data-paused={isPaused}
      aria-hidden="true"
    >
      <span data-paimind-runtime-orb-canvas>
        <ThinkingOrb
          state={state}
          size={20}
          speed={0.9}
          theme={preferences.dark ? 'dark' : 'light'}
          paused={isPaused}
          aria-hidden="true"
        />
      </span>
    </span>
  )
}

function RuntimeStatus({ presentation, label, placement, preferences, showOrb = true }: {
  presentation: NonNullable<ReturnType<typeof runtimePresentation>>
  label: string
  placement: 'native' | 'dock'
  preferences: VisualPreferences
  showOrb?: boolean
}): ReactNode {
  return (
    <span
      data-paimind-runtime-status
      data-runtime-phase={presentation.phase}
      data-orb-state={presentation.state}
      data-placement={placement}
      data-orb-visible={showOrb}
      role={placement === 'dock' ? 'status' : undefined}
      aria-live={placement === 'dock' ? 'polite' : undefined}
      aria-label={placement === 'dock' ? label : undefined}
      title={label}
    >
      {showOrb && <RuntimeOrbGlyph state={presentation.state} placement="status" preferences={preferences} />}
      <span aria-hidden="true">{label}</span>
    </span>
  )
}

/**
 * One orb per visible member of the active operation or parallel batch, plus a
 * compact orb for each genuinely active sidebar session. Rows outside the
 * active batch retain native icons. If activity rows own the progress orbs,
 * the live status keeps only its localized dynamic label.
 */
export function RuntimeOrbDock({ useSession, useSessions, locale }: RuntimeOrbDockProps): ReactNode {
  const snapshot = useSession(value => value)
  const sessions = useSessions(value => value)
  const presentation = runtimePresentation(snapshot)
  const preferences = useVisualPreferences()
  const activeLocale = useActiveLocale(locale)
  const phase = presentation?.phase ?? 'loading'
  const [turnStatus, setTurnStatus] = useState<HTMLElement | null>(() => locateRuntimeTurnStatus(document))
  const [sidebarSlots, setSidebarSlots] = useState<readonly HTMLElement[]>(
    () => locateRuntimeSidebarActivitySlots(phase, document),
  )
  const [activitySlots, setActivitySlots] = useState<readonly RuntimeActivityIconSlot[]>(
    () => locateRuntimeActivityIconSlots(document),
  )

  useEffect(() => {
    const refresh = (): void => {
      const nextTurnStatus = locateRuntimeTurnStatus(document)
      const nextSidebarSlots = locateRuntimeSidebarActivitySlots(phase, document)
      const nextActivitySlots = locateRuntimeActivityIconSlots(document)
      setTurnStatus(current => current === nextTurnStatus ? current : nextTurnStatus)
      setSidebarSlots(current => sameElements(current, nextSidebarSlots) ? current : nextSidebarSlots)
      setActivitySlots(current => sameActivitySlots(current, nextActivitySlots) ? current : nextActivitySlots)
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-open', 'data-tool', 'data-variant', 'aria-selected', 'role'],
    })
    return () => { observer.disconnect() }
  }, [phase, sessions])

  useEffect(() => {
    for (const slot of sidebarSlots) slot.setAttribute('data-paimind-runtime-sidebar-host', '')
    return () => {
      for (const slot of sidebarSlots) slot.removeAttribute('data-paimind-runtime-sidebar-host')
    }
  }, [sidebarSlots])

  useEffect(() => {
    for (const slot of activitySlots) slot.host.setAttribute('data-paimind-runtime-history-host', '')
    return () => {
      for (const slot of activitySlots) slot.host.removeAttribute('data-paimind-runtime-history-host')
    }
  }, [activitySlots])

  const label = presentation === null
    ? ''
    : activeLocale === 'en' ? presentation.labelEn : presentation.labelZh
  useEffect(() => {
    if (turnStatus === null || presentation === null) return
    const previousLabel = turnStatus.getAttribute('aria-label')
    turnStatus.setAttribute('data-paimind-runtime-turn-status-host', '')
    turnStatus.setAttribute('aria-label', label)
    return () => {
      turnStatus.removeAttribute('data-paimind-runtime-turn-status-host')
      if (previousLabel === null) turnStatus.removeAttribute('aria-label')
      else turnStatus.setAttribute('aria-label', previousLabel)
    }
  }, [label, presentation, turnStatus])

  const currentSessionRunning = sessions.current === undefined
    ? false
    : sessions.byId[sessions.current]?.running === true
  return (
    <RuntimeOrbBoundary>
      {activitySlots.map((slot, index) => createPortal(
        <RuntimeOrbGlyph
          state={slot.state}
          placement="history"
          preferences={preferences}
        />,
        slot.host,
        `paimind-history-orb-${index}`,
      ))}
      {sidebarSlots.map((slot, index) => {
        const selected = slot.closest<HTMLElement>('[role="treeitem"]')?.getAttribute('aria-selected') === 'true'
        const state = selected && presentation !== null ? presentation.state : 'working'
        return createPortal(
          <RuntimeOrbGlyph state={state} placement="sidebar" preferences={preferences} />,
          slot,
          `paimind-sidebar-orb-${index}`,
        )
      })}
      {presentation !== null && turnStatus !== null && createPortal(
        <RuntimeStatus
          presentation={presentation}
          label={label}
          placement="native"
          preferences={preferences}
          showOrb={activitySlots.length === 0}
        />,
        turnStatus,
      )}
      {presentation !== null && turnStatus === null && (currentSessionRunning || phase === 'waiting') && (
        <RuntimeStatus presentation={presentation} label={label} placement="dock" preferences={preferences} />
      )}
    </RuntimeOrbBoundary>
  )
}

function RuntimeOrbFault(): ReactNode {
  throw new Error('FP01 explicit QA fault')
}

/** Explicit QA surface for inspecting every visual primitive without a model request. */
export function RuntimeOrbPreview(): ReactNode {
  const preferences = useVisualPreferences()
  const [state, setState] = useState<RuntimeOrbState>('solving')
  return (
    <RuntimeOrbBoundary>
      {faultRequested() ? <RuntimeOrbFault /> : (
        <aside data-paimind-runtime-orb-preview aria-label="PAIMind Runtime Orb Preview">
          <h2 data-paimind-runtime-orb-preview-heading>Runtime Orb Preview</h2>
          <p data-paimind-runtime-orb-preview-note>
            QA only · one active orb; choose a state below
          </p>
          <div data-paimind-runtime-orb-preview-stage>
            <div data-paimind-runtime-orb-preview-current data-testid="runtime-orb-preview-current">
              <ThinkingOrb
                state={state}
                size={64}
                speed={0.9}
                theme={preferences.dark ? 'dark' : 'light'}
                paused={preferences.reducedMotion}
                aria-label={state}
              />
              <span>{state}</span>
            </div>
          </div>
          <div data-paimind-runtime-orb-preview-list>
            {RUNTIME_ORB_STATES.map((option: RuntimeOrbState) => (
              <button
                type="button"
                key={option}
                data-paimind-runtime-orb-preview-item
                data-testid="runtime-orb-preview-state"
                data-orb-state={option}
                aria-pressed={option === state}
                onClick={() => { setState(option) }}
              >
                {option}
              </button>
            ))}
          </div>
        </aside>
      )}
    </RuntimeOrbBoundary>
  )
}

function previewRequested(): boolean {
  return new URLSearchParams(window.location.search).get(PREVIEW_QUERY) === '1'
}

function faultRequested(): boolean {
  return new URLSearchParams(window.location.search).get(FAULT_QUERY) === '1'
}

function installStyle(): () => void {
  const existing = document.head.querySelector(`style[data-paimind-plugin="${STYLE_ID}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.paimindPlugin = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

/** Register through an official dock; the compatibility adapter reuses the two native status surfaces. */
export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:runtime-orbs',
    packageName: '@paimind/runtime-orbs',
    category: 'experience',
    nameZh: '运行状态球',
    nameEn: 'Runtime Orb',
    descriptionZh: '在 Harness 原生对话中用单一动态球表达真实运行阶段。',
    descriptionEn: 'Uses one animated orb to express real runtime phases in the native Harness conversation.',
    surface: 'conversation',
    maturity: 'available',
    order: 10,
  })
  ctx.effect(installStyle, 'paimind-runtime-orbs: style')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'paimind-runtime-orbs',
    order: -20,
    inject: () => ({ locale: ctx.locale }),
  }, RuntimeOrbDock))
  if (previewRequested()) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'paimind-runtime-orbs-preview',
      order: 100,
    }, RuntimeOrbPreview))
  }
}
