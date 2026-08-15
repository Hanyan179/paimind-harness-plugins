import { Component, useEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react'
import { contributePaimindExtension, type PaimindClientContext } from '@paimind/harness-compat'
import type { PaimindSidebarService, PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'
import {
  BENTO_INFO_PATH,
  type BentoSandboxInfo,
  type PaimindBentoPreviewRequest,
  type PaimindBentoPreviewSnapshot,
  type PaimindBentoPreviewService,
  type PaimindBentoRuntimeEvent,
} from '../shared.js'

export const inject = ['slots', 'paimindSidebar', 'locale']

export interface BentoClientContext extends PaimindClientContext {
  readonly paimindSidebar: PaimindSidebarService
}

const RUNTIME_EVENT_TYPES = new Set(['paimind:bento-ready', 'paimind:bento-slide', 'paimind:bento-exit'])

export function normalizeBentoRuntimeMessage(value: unknown): PaimindBentoRuntimeEvent | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Partial<PaimindBentoRuntimeEvent>
  if (!RUNTIME_EVENT_TYPES.has(candidate.type ?? '')) return null
  if (candidate.mode !== 'edit' && candidate.mode !== 'present') return null
  if (!Number.isInteger(candidate.slide) || (candidate.slide ?? 0) < 1 || (candidate.slide ?? 0) > 10_000) return null
  return Object.freeze({ type: candidate.type as PaimindBentoRuntimeEvent['type'], mode: candidate.mode, slide: candidate.slide as number })
}

export class BentoPreviewStore implements PaimindBentoPreviewService {
  private snapshot: PaimindBentoPreviewSnapshot = Object.freeze({ revision: 0, requestRevision: 0, request: null, runtimeEvent: null })
  private readonly listeners = new Set<() => void>()

  constructor(private readonly sidebar: PaimindSidebarService) {}
  getSnapshot(): PaimindBentoPreviewSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  open(request: PaimindBentoPreviewRequest): boolean {
    if (
      request.sessionId.trim() === '' || request.workspaceId.trim() === '' || request.cwd.trim() === ''
      || request.path.trim() === '' || request.title.trim() === ''
    ) return false
    this.snapshot = Object.freeze({
      revision: this.snapshot.revision + 1,
      requestRevision: this.snapshot.requestRevision + 1,
      request: Object.freeze({ ...request }),
      runtimeEvent: null,
    })
    for (const listener of [...this.listeners]) listener()
    return this.sidebar.openTab('paimind:bento-preview')
  }
  publishRuntimeEvent(event: PaimindBentoRuntimeEvent): void {
    if (this.snapshot.request === null) return
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, runtimeEvent: Object.freeze({ ...event }) })
    for (const listener of [...this.listeners]) listener()
  }
  dispose(): void { this.listeners.clear() }
}

const STYLE_ID = '@paimind/renderer-bento'
const STYLE = `
[data-paimind-bento] { min-height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr); color: var(--dsw-alias-label-primary, #202124); background: var(--dsw-alias-bg-layer-1, transparent); }
[data-paimind-bento-header] { padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.16)); }
[data-paimind-bento-header] strong { display: block; overflow: hidden; font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
[data-paimind-bento-header] span { display: block; margin-top: 2px; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 10px; line-height: 15px; }
[data-paimind-bento-stage] { min-width: 0; min-height: 0; position: relative; }
[data-paimind-bento-stage] iframe { width: 100%; height: 100%; min-height: 420px; display: block; border: 0; background: #071725; }
[data-paimind-bento-state] { min-height: 240px; display: grid; place-items: center; padding: 24px; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 12px; line-height: 19px; text-align: center; }
[data-paimind-bento-state][data-error='true'] { color: var(--dsw-alias-state-error-primary, #d04444); }
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/renderer-bento'
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

function validInfo(value: unknown): value is BentoSandboxInfo {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<BentoSandboxInfo>
  if (typeof candidate.origin !== 'string' || typeof candidate.token !== 'string' || !/^[A-Za-z0-9_-]{24,}$/.test(candidate.token)) return false
  try {
    const parsed = new URL(candidate.origin)
    return parsed.protocol === 'http:' && parsed.hostname.startsWith('127.') && parsed.origin !== window.location.origin
  } catch { return false }
}

function BentoPreviewPanel(props: { readonly store: BentoPreviewStore; readonly scope: PaimindSidebarTabScope }): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    props.store.subscribe.bind(props.store),
    props.store.getSnapshot.bind(props.store),
    props.store.getSnapshot.bind(props.store),
  )
  const activeLocale = useSyncExternalStore(
    props.scope.locale.subscribe.bind(props.scope.locale),
    () => props.scope.locale.getLocale().active,
    () => props.scope.locale.getLocale().active,
  )
  const zh = activeLocale.startsWith('zh')
  const [source, setSource] = useState<{ readonly requestRevision: number; readonly origin: string; readonly url: string } | null>(null)
  const [error, setError] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const request = snapshot.request
    setSource(null)
    setError(false)
    if (request === null) return
    const controller = new AbortController()
    void fetch(BENTO_INFO_PATH, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<unknown> : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(info => {
        if (!validInfo(info)) throw new Error('invalid isolated origin')
        const url = new URL('/file', info.origin)
        url.searchParams.set('token', info.token)
        url.searchParams.set('sessionId', request.sessionId)
        url.searchParams.set('path', request.path)
        setSource(Object.freeze({ requestRevision: snapshot.requestRevision, origin: info.origin, url: url.toString() }))
      })
      .catch(reason => { if ((reason as { name?: string }).name !== 'AbortError') setError(true) })
    return () => { controller.abort() }
  }, [snapshot.request, snapshot.requestRevision])

  useEffect(() => {
    if (source === null) return
    const receive = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== source.origin) return
      const normalized = normalizeBentoRuntimeMessage(event.data)
      if (normalized !== null) props.store.publishRuntimeEvent(normalized)
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [props.store, source])

  const request = snapshot.request
  return (
    <section data-paimind-bento aria-label={zh ? 'Bento 隔离预览' : 'Isolated Bento preview'}>
      <header data-paimind-bento-header>
        <strong>{request?.title ?? (zh ? 'Bento 预览' : 'Bento Preview')}</strong>
        <span>{zh ? '独立 Origin · 可使用本地存储 · 无 Harness 网络通道' : 'Isolated origin · storage enabled · no Harness network channel'}</span>
      </header>
      <div data-paimind-bento-stage>
        {request === null ? <div data-paimind-bento-state>{zh ? '请从 PAIMind 产物中打开 Bento。' : 'Open a Bento artifact from PAIMind Artifacts.'}</div>
          : error ? <div role="alert" data-paimind-bento-state data-error="true">{zh ? 'Bento 隔离服务不可用；原生会话不受影响。' : 'The isolated Bento service is unavailable; native conversation remains available.'}</div>
            : source === null ? <div data-paimind-bento-state>{zh ? '正在建立隔离预览…' : 'Preparing isolated preview…'}</div>
              : <iframe
                  ref={frameRef}
                  key={`${source.requestRevision}:${source.url}`}
                  title={request.title}
                  src={source.url}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-downloads allow-modals"
                  referrerPolicy="no-referrer"
                  allow=""
                />}
      </div>
    </section>
  )
}

class BentoErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-renderer-bento]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

function BentoIcon(): React.JSX.Element {
  return <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true"><path d="M3 5.2h12v8.2H3zM5.4 3h7.2v2.2H5.4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M6 8h6M6 10.6h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
}

export function apply(ctx: BentoClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:renderer-bento',
    packageName: '@paimind/renderer-bento',
    category: 'content-rendering',
    nameZh: 'Bento 渲染器',
    nameEn: 'Bento Renderer',
    descriptionZh: 'PAIMind 自研的隔离式 Bento 预览通道，仅依赖稳定的预览与侧卡适配契约。',
    descriptionEn: 'PAIMind-owned isolated Bento preview channel using only stable preview and side-card adapters.',
    surface: 'preview',
    maturity: 'technical-preview',
    order: 20,
  })
  ctx.effect(() => installStyle(), 'paimind-renderer-bento: style')
  ctx.effect(() => {
    const store = new BentoPreviewStore(ctx.paimindSidebar)
    const disposeTab = ctx.paimindSidebar.registerTab({
      id: 'paimind:bento-preview',
      titleZh: 'Bento 预览',
      titleEn: 'Bento Preview',
      order: 52,
      single: true,
      icon: <BentoIcon />,
      render: scope => <BentoErrorBoundary><BentoPreviewPanel store={store} scope={scope} /></BentoErrorBoundary>,
    })
    const disposeService = ctx.reflect.provide('paimindBentoPreview', store)
    return () => {
      void disposeService()
      disposeTab()
      store.dispose()
    }
  }, 'paimind-renderer-bento: service and tab')
}
