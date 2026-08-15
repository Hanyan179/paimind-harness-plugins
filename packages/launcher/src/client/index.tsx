import {
  Component, useEffect, useRef, useSyncExternalStore,
  type ErrorInfo, type ReactNode,
} from 'react'
import type { PaimindClientContext, PaimindLocaleSource } from '@paimind/harness-compat'
import {
  LauncherController,
  type LauncherDestination,
  type LauncherSnapshot,
  type PaimindLauncherService,
} from './controller.js'

export {
  DEFAULT_DESTINATIONS, LauncherController,
  type LauncherAvailability, type LauncherDestination, type LauncherPanelProps,
  type LauncherSnapshot, type PaimindLauncherService,
} from './controller.js'

/** Host services required before the FP02 client contribution can register. */
export const inject = ['slots', 'locale']

const STYLE_ID = '@paimind/launcher'
const FOCUSABLE = [
  'button:not([disabled])', '[href]', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

const STYLE = `
[data-paimind-launcher-trigger] {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 8px);
  height: 34px;
  margin: 4px -4px;
  padding: 6px 2px 6px 10px;
  border: 0;
  border-radius: 12px;
  color: var(--dsw-alias-label-primary, #202124);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
[data-paimind-launcher-trigger]:hover,
[data-paimind-launcher-trigger]:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));
}
[data-paimind-launcher-trigger][data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 8px 0;
  padding: 0;
  justify-content: center;
  gap: 0;
  border-radius: 50%;
}
[data-paimind-launcher-mark] {
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  flex: none;
  display: grid;
  grid-template-columns: repeat(2, 4px);
  grid-template-rows: repeat(2, 4px);
  place-content: center;
  gap: 2px;
  border-radius: 6px;
  color: var(--dsw-alias-state-business-primary, #4f7ff8);
  background: color-mix(in srgb, currentColor 12%, transparent);
}
[data-paimind-launcher-mark] > i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
[data-paimind-launcher-trigger-label] {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
[data-paimind-launcher-overlay] {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  pointer-events: auto;
}
[data-paimind-launcher-mask] {
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.32));
  backdrop-filter: var(--dsw-mask-blur, blur(8px));
}
[data-paimind-launcher-panel] {
  position: relative;
  z-index: 1;
  width: min(920px, calc(100vw - 48px));
  height: min(680px, calc(100vh - 48px));
  min-height: 440px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2));
  border-radius: 24px;
  color: var(--dsw-alias-label-primary, #202124);
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: var(--dsw-shadow-lv3, 0 20px 60px rgba(0,0,0,.22));
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
[data-paimind-launcher-header] {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16));
}
[data-paimind-launcher-heading] {
  min-width: 0;
  flex: 1;
}
[data-paimind-launcher-heading] h2 {
  margin: 0;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
}
[data-paimind-launcher-heading] p {
  margin: 2px 0 0;
  color: var(--dsw-alias-label-secondary, #626872);
  font-size: 12px;
  line-height: 18px;
}
[data-paimind-launcher-close] {
  width: 32px;
  height: 32px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
[data-paimind-launcher-close]:hover,
[data-paimind-launcher-close]:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12));
}
[data-paimind-launcher-body] {
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
}
[data-paimind-launcher-nav] {
  min-width: 0;
  overflow-y: auto;
  padding: 14px;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16));
  background: var(--dsw-specific-sidebar-fill, rgba(128,128,128,.045));
}
[data-paimind-launcher-nav-title] {
  padding: 2px 10px 8px;
  color: var(--dsw-alias-label-tertiary, #7a808a);
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
}
[data-paimind-launcher-destination] {
  width: 100%;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
[data-paimind-launcher-destination] + [data-paimind-launcher-destination] { margin-top: 3px; }
[data-paimind-launcher-destination]:hover,
[data-paimind-launcher-destination]:focus-visible {
  background: var(--dsw-specific-sidebar-nav-item-hover, rgba(128,128,128,.1));
}
[data-paimind-launcher-destination][aria-current='page'] {
  background: var(--dsw-specific-sidebar-nav-item-active, rgba(79,127,248,.12));
}
[data-paimind-launcher-destination-icon] {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--dsw-alias-state-business-primary, #4f7ff8);
  background: color-mix(in srgb, currentColor 11%, transparent);
  font-size: 12px;
  font-weight: 700;
}
[data-paimind-launcher-destination-copy] { min-width: 0; }
[data-paimind-launcher-destination-copy] strong {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  line-height: 19px;
  font-weight: 500;
}
[data-paimind-launcher-destination-copy] small {
  display: block;
  color: var(--dsw-alias-label-tertiary, #7a808a);
  font-size: 10px;
  line-height: 15px;
}
[data-paimind-launcher-chevron] {
  color: var(--dsw-alias-label-tertiary, #7a808a);
  font-size: 16px;
}
[data-paimind-launcher-content] {
  min-width: 0;
  overflow-y: auto;
  padding: 32px;
}
[data-paimind-launcher-content] h3 {
  margin: 14px 0 8px;
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
}
[data-paimind-launcher-content] p {
  max-width: 600px;
  margin: 0;
  color: var(--dsw-alias-label-secondary, #626872);
  font-size: 14px;
  line-height: 22px;
}
[data-paimind-launcher-badges] {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
[data-paimind-launcher-badge] {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 2px 9px;
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary, #626872);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1));
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
}
[data-paimind-launcher-badge][data-status='available'] {
  color: var(--dsw-alias-state-business-primary, #4f7ff8);
  background: color-mix(in srgb, currentColor 12%, transparent);
}
[data-paimind-launcher-note] {
  margin-top: 24px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.045));
}
[data-paimind-launcher-note] strong {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  line-height: 18px;
}
[data-paimind-launcher-footer] {
  padding: 10px 20px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16));
  color: var(--dsw-alias-label-tertiary, #7a808a);
  font-size: 11px;
  line-height: 16px;
}
@media (max-width: 700px) {
  [data-paimind-launcher-overlay] { padding: 0; }
  [data-paimind-launcher-panel] {
    width: 100vw;
    height: 100dvh;
    min-height: 0;
    border: 0;
    border-radius: 0;
  }
  [data-paimind-launcher-header] { padding: 14px 16px; }
  [data-paimind-launcher-body] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  [data-paimind-launcher-nav] {
    flex: none;
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 10px 16px;
    border-right: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16));
  }
  [data-paimind-launcher-nav-title] { display: none; }
  [data-paimind-launcher-destination] {
    width: auto;
    min-width: max-content;
    min-height: 38px;
    display: flex;
    padding: 4px 10px;
  }
  [data-paimind-launcher-destination] + [data-paimind-launcher-destination] { margin-top: 0; }
  [data-paimind-launcher-destination-icon] { width: 26px; height: 26px; border-radius: 8px; }
  [data-paimind-launcher-destination-copy] small,
  [data-paimind-launcher-chevron] { display: none; }
  [data-paimind-launcher-content] { flex: 1; padding: 24px 20px; }
  [data-paimind-launcher-content] h3 { font-size: 21px; line-height: 28px; }
}
@media (prefers-reduced-motion: reduce) {
  [data-paimind-launcher-overlay] *, [data-paimind-launcher-trigger] { transition: none !important; }
}
`

const COPY = {
  zh: {
    open: '打开 PAIMind', title: 'PAIMind 平台启动器', subtitle: 'Agent、Skill 与平台扩展',
    close: '关闭 PAIMind', destinations: '平台能力', planned: '待迁移', available: '可使用',
    unavailable: '不可用', plannedTitle: '功能包尚未迁移',
    plannedBody: '这里只建立真实的插件入口与容器。对应功能包完成验证后，会在此处替换为可操作页面。',
    unavailableBody: '插件已注册，但当前环境或权限不满足使用条件。',
    projectTitle: 'Project 继续使用 Harness Workspace',
    projectBody: 'PAIMind 不创建第二套 Project 存储；项目入口、Session 归属与上下文将在 FP04 接入原生 Workspace。',
    footer: '独立插件包 · 不修改 DeepSeek Harness 上游源码',
  },
  en: {
    open: 'Open PAIMind', title: 'PAIMind Launcher', subtitle: 'Agents, Skills, and platform extensions',
    close: 'Close PAIMind', destinations: 'Platform capabilities', planned: 'Planned', available: 'Available',
    unavailable: 'Unavailable', plannedTitle: 'Feature package not migrated yet',
    plannedBody: 'FP02 provides only the real plugin entry and container. The matching package will replace this placeholder after verification.',
    unavailableBody: 'The plugin is registered, but this environment or your permissions do not currently allow access.',
    projectTitle: 'Project continues to use Harness Workspace',
    projectBody: 'PAIMind does not create a second Project store. FP04 will connect project entry, Session ownership, and context to native Workspace.',
    footer: 'Independent plugin package · zero DeepSeek Harness upstream changes',
  },
} as const

function useLocaleId(locale: PaimindLocaleSource): 'zh' | 'en' {
  const active = useSyncExternalStore(
    locale.subscribe.bind(locale),
    () => locale.getLocale().active,
    () => locale.getLocale().active,
  )
  return active === 'en' ? 'en' : 'zh'
}

function useLauncherSnapshot(controller: PaimindLauncherService): LauncherSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
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

interface LauncherInjectedProps {
  readonly controller: LauncherController
  readonly locale: PaimindLocaleSource
}

export interface LauncherTriggerProps extends LauncherInjectedProps {
  readonly wide: boolean
}

/** Responsive sidebar-footer entry registered into Harness's additive action slot. */
export function LauncherTrigger({ wide, controller, locale }: LauncherTriggerProps): ReactNode {
  const language = useLocaleId(locale)
  const snapshot = useLauncherSnapshot(controller)
  const copy = COPY[language]
  return (
    <button
      type="button"
      data-paimind-launcher-trigger
      data-wide={wide}
      aria-label={copy.open}
      title={wide ? undefined : copy.open}
      aria-haspopup="dialog"
      aria-expanded={snapshot.open}
      onClick={(event) => { controller.open(event.currentTarget) }}
    >
      <span data-paimind-launcher-mark aria-hidden="true"><i /><i /><i /><i /></span>
      {wide && <span data-paimind-launcher-trigger-label>PAIMind</span>}
    </button>
  )
}

function availabilityLabel(destination: LauncherDestination, language: 'zh' | 'en'): string {
  return COPY[language][destination.availability]
}

function destinationTitle(destination: LauncherDestination, language: 'zh' | 'en'): string {
  return language === 'en' ? destination.titleEn : destination.titleZh
}

function destinationDescription(destination: LauncherDestination, language: 'zh' | 'en'): string {
  return language === 'en' ? destination.descriptionEn : destination.descriptionZh
}

function iconText(destination: LauncherDestination): string {
  const labels: Readonly<Record<string, string>> = {
    agents: 'A', skills: 'S', notifications: 'N', 'scheduled-tasks': 'T',
    'personal-settings': 'P', administration: 'R', 'developer-resources': 'D',
  }
  return labels[destination.id] ?? destination.titleEn.slice(0, 1).toUpperCase()
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

/** Accessible frame overlay that renders registered destination panels or honest placeholders. */
export function LauncherOverlay({ controller, locale }: LauncherInjectedProps): ReactNode {
  const snapshot = useLauncherSnapshot(controller)
  const language = useLocaleId(locale)
  const copy = COPY[language]
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const active = snapshot.destinations.find(destination => destination.id === snapshot.activeId)
    ?? snapshot.destinations[0]

  useEffect(() => {
    if (!snapshot.open) return
    const root = rootRef.current
    if (root === null) return
    const overlayLayer = root.closest<HTMLElement>('[data-shell-overlay]')
    const frame = overlayLayer?.parentElement
    const background = frame === null || frame === undefined
      ? []
      : [...frame.children].filter((element): element is HTMLElement => (
        element instanceof HTMLElement && element !== overlayLayer
      ))
    const records = background.map(element => ({
      element,
      inert: element.getAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
    for (const element of background) {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        controller.close()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(element => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) {
        event.preventDefault()
        return
      }
      const focused = document.activeElement
      if (event.shiftKey && (focused === first || !root.contains(focused))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (focused === last || !root.contains(focused))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    queueMicrotask(() => { closeRef.current?.focus({ preventScroll: true }) })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      for (const record of records) {
        restoreAttribute(record.element, 'inert', record.inert)
        restoreAttribute(record.element, 'aria-hidden', record.ariaHidden)
      }
    }
  }, [controller, snapshot.open])

  if (!snapshot.open || active === undefined) return null
  const Panel = active.Panel
  return (
    <div ref={rootRef} data-paimind-launcher-overlay>
      <div data-paimind-launcher-mask aria-hidden="true" onMouseDown={() => { controller.close() }} />
      <section
        data-paimind-launcher-panel
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
      >
        <header data-paimind-launcher-header>
          <span data-paimind-launcher-mark aria-hidden="true"><i /><i /><i /><i /></span>
          <div data-paimind-launcher-heading>
            <h2>{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            data-paimind-launcher-close
            aria-label={copy.close}
            onClick={() => { controller.close() }}
          >×</button>
        </header>
        <div data-paimind-launcher-body>
          <nav data-paimind-launcher-nav aria-label={copy.destinations}>
            <div data-paimind-launcher-nav-title>{copy.destinations}</div>
            {snapshot.destinations.map(destination => (
              <button
                type="button"
                key={destination.id}
                data-paimind-launcher-destination
                aria-current={destination.id === active.id ? 'page' : undefined}
                onClick={() => { controller.select(destination.id) }}
              >
                <span data-paimind-launcher-destination-icon aria-hidden="true">{iconText(destination)}</span>
                <span data-paimind-launcher-destination-copy>
                  <strong>{destinationTitle(destination, language)}</strong>
                  <small>{destination.featurePackage} · {availabilityLabel(destination, language)}</small>
                </span>
                <span data-paimind-launcher-chevron aria-hidden="true">›</span>
              </button>
            ))}
          </nav>
          <main data-paimind-launcher-content>
            {active.availability === 'available' && Panel !== undefined ? (
              <Panel closeLauncher={() => { controller.close() }} />
            ) : (
              <>
                <div data-paimind-launcher-badges>
                  <span data-paimind-launcher-badge data-status={active.availability}>
                    {availabilityLabel(active, language)}
                  </span>
                  <span data-paimind-launcher-badge>{active.featurePackage}</span>
                </div>
                <h3>{destinationTitle(active, language)}</h3>
                <p>{destinationDescription(active, language)}</p>
                <div data-paimind-launcher-note>
                  <strong>{active.availability === 'unavailable' ? copy.unavailable : copy.plannedTitle}</strong>
                  <p>{active.availability === 'unavailable' ? copy.unavailableBody : copy.plannedBody}</p>
                </div>
                <div data-paimind-launcher-note>
                  <strong>{copy.projectTitle}</strong>
                  <p>{copy.projectBody}</p>
                </div>
              </>
            )}
          </main>
        </div>
        <footer data-paimind-launcher-footer>{copy.footer}</footer>
      </section>
    </div>
  )
}

interface BoundaryProps {
  readonly controller: LauncherController
  readonly children: ReactNode
}

interface BoundaryState { readonly failed: boolean }

/** Contain launcher failures so native Harness conversation and Settings remain operational. */
export class LauncherBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState { return { failed: true } }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.controller.close({ restoreFocus: false })
    console.warn('[paimind/launcher] surface disabled after render failure', error, info.componentStack)
  }

  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

function SafeLauncherTrigger(props: LauncherTriggerProps): ReactNode {
  return <LauncherBoundary controller={props.controller}><LauncherTrigger {...props} /></LauncherBoundary>
}

function SafeLauncherOverlay(props: LauncherInjectedProps): ReactNode {
  return <LauncherBoundary controller={props.controller}><LauncherOverlay {...props} /></LauncherBoundary>
}

/** Register FP02 through the two official additive shell slots and publish its controller. */
export function apply(ctx: PaimindClientContext): void {
  const controller = new LauncherController()
  ctx.effect(installStyle, 'paimind-launcher: style')
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('paimindLauncher', controller)
    return () => {
      controller.dispose()
      void disposeService()
    }
  }, 'paimind-launcher: service')
  const injectProps = (): LauncherInjectedProps => ({ controller, locale: ctx.locale })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'paimind-launcher-trigger', order: -10, inject: injectProps,
  }, SafeLauncherTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'paimind-launcher-overlay', order: 10, inject: injectProps,
  }, SafeLauncherOverlay))
}
