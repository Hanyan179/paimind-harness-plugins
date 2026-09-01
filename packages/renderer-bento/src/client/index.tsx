import { Component, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { contributePaimindExtension, type PaimindClientContext } from '@paimind/harness-compat'
import type { PaimindSidebarService, PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'
import {
  BENTO_INFO_PATH,
  type BentoSandboxInfo,
  type PaimindBentoPreviewRequest,
  type PaimindBentoPreviewSnapshot,
  type PaimindBentoPreviewService,
  type PaimindBentoInspectorContribution,
  type PaimindBentoFocusTarget,
  type PaimindBentoSlideNavigationItem,
  type PaimindBentoSlideTarget,
  type PaimindBentoMode,
  type PaimindBentoRuntimeEvent,
} from '../shared.js'

export const inject = ['slots', 'paimindSidebar', 'locale']

export interface BentoClientContext extends PaimindClientContext {
  readonly paimindSidebar: PaimindSidebarService
}

const RUNTIME_EVENT_TYPES = new Set(['paimind:bento-ready', 'paimind:bento-manifest', 'paimind:bento-slide', 'paimind:bento-select', 'paimind:bento-exit'])

export function normalizeBentoRuntimeMessage(value: unknown): PaimindBentoRuntimeEvent | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Partial<PaimindBentoRuntimeEvent>
  if (!RUNTIME_EVENT_TYPES.has(candidate.type ?? '')) return null
  const rawMode = (value as { readonly mode?: unknown }).mode
  const mode = rawMode === 'present' ? 'preview' : rawMode
  if (mode !== 'preview' && mode !== 'edit' && mode !== 'trace') return null
  if (!Number.isInteger(candidate.slide) || (candidate.slide ?? 0) < 1 || (candidate.slide ?? 0) > 10_000) return null
  const optionalId = (value: unknown): string | undefined => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value) ? value : undefined
  let slides: readonly PaimindBentoSlideNavigationItem[] | undefined
  if (candidate.type === 'paimind:bento-manifest') {
    const rawSlides = (value as { readonly slides?: unknown }).slides
    if (!Array.isArray(rawSlides) || rawSlides.length < 1 || rawSlides.length > 10_000) return null
    const normalizedSlides: PaimindBentoSlideNavigationItem[] = []
    for (const rawSlide of rawSlides) {
      if (rawSlide === null || typeof rawSlide !== 'object') return null
      const entry = rawSlide as { readonly slideId?: unknown; readonly title?: unknown }
      const slideId = optionalId(entry.slideId)
      const title = typeof entry.title === 'string' ? entry.title.trim() : ''
      if (slideId === undefined || title === '' || title.length > 500) return null
      normalizedSlides.push(Object.freeze({ slideId, title }))
    }
    slides = Object.freeze(normalizedSlides)
  }
  let selector = candidate.selector
  if (selector !== undefined) {
    if (selector.kind === 'object') selector = Object.freeze({ kind: 'object' })
    else if (selector.kind === 'chart-point' && optionalId(selector.seriesKey) !== undefined && optionalId(selector.categoryKey) !== undefined) selector = Object.freeze({ kind: 'chart-point', seriesKey: selector.seriesKey, categoryKey: selector.categoryKey })
    else if (selector.kind === 'table-cell' && optionalId(selector.rowKey) !== undefined && optionalId(selector.columnKey) !== undefined) selector = Object.freeze({ kind: 'table-cell', rowKey: selector.rowKey, columnKey: selector.columnKey })
    else return null
  }
  if (candidate.type === 'paimind:bento-select' && (optionalId(candidate.slideId) === undefined || optionalId(candidate.objectId) === undefined || optionalId(candidate.factId) === undefined || selector === undefined)) return null
  return Object.freeze({ type: candidate.type as PaimindBentoRuntimeEvent['type'], mode, slide: candidate.slide as number, ...(optionalId(candidate.slideId) === undefined ? {} : { slideId: candidate.slideId }), ...(optionalId(candidate.objectId) === undefined ? {} : { objectId: candidate.objectId }), ...(optionalId(candidate.factId) === undefined ? {} : { factId: candidate.factId }), ...(selector === undefined ? {} : { selector }), ...(slides === undefined ? {} : { slides }) })
}

export class BentoPreviewStore implements PaimindBentoPreviewService {
  private snapshot: PaimindBentoPreviewSnapshot = Object.freeze({ revision: 0, requestRevision: 0, request: null, runtimeEvent: null, slides: Object.freeze([]), mode: 'preview', focusRevision: 0, focus: null, slideTargetRevision: 0, slideTarget: null, inspectorRevision: 0 })
  private readonly listeners = new Set<() => void>()
  private readonly inspectors: PaimindBentoInspectorContribution[] = []

  constructor(private readonly sidebar: PaimindSidebarService) {}
  getSnapshot(): PaimindBentoPreviewSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  open(request: PaimindBentoPreviewRequest): boolean {
    if (
      request.sessionId.trim() === '' || request.workspaceId.trim() === '' || request.cwd.trim() === ''
      || request.path.trim() === '' || request.title.trim() === ''
    ) return false
    this.snapshot = Object.freeze({
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      requestRevision: this.snapshot.requestRevision + 1,
      request: Object.freeze({ ...request }),
      runtimeEvent: null,
      slides: Object.freeze([]),
      mode: 'preview',
      focus: null,
      slideTarget: null,
    })
    for (const listener of [...this.listeners]) listener()
    return this.sidebar.openTab('paimind:bento-preview', { title: request.title })
  }
  publishRuntimeEvent(event: PaimindBentoRuntimeEvent): void {
    if (this.snapshot.request === null || event.mode !== this.snapshot.mode) return
    const slides = event.type === 'paimind:bento-manifest' && event.slides !== undefined
      ? Object.freeze(event.slides.map(slide => Object.freeze({ ...slide })))
      : this.snapshot.slides
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, runtimeEvent: Object.freeze({ ...event, ...(event.slides === undefined ? {} : { slides }) }), slides })
    for (const listener of [...this.listeners]) listener()
  }
  setMode(mode: PaimindBentoMode): boolean {
    const request = this.snapshot.request
    if (request === null) return false
    if (mode === 'trace') {
      const inspector = this.getInspector()
      if (inspector === null || (inspector.activate !== undefined && !inspector.activate(request))) return false
    }
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, mode })
    for (const listener of [...this.listeners]) listener()
    return this.sidebar.openTab('paimind:bento-preview', { title: request.title })
  }
  navigate(target: PaimindBentoSlideTarget): boolean {
    if (this.snapshot.request === null || target.slideId.trim() === '' || !Number.isInteger(target.slide) || target.slide < 1 || target.slide > 10_000) return false
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, slideTargetRevision: this.snapshot.slideTargetRevision + 1, slideTarget: Object.freeze({ ...target }) })
    for (const listener of [...this.listeners]) listener()
    return true
  }
  focus(target: PaimindBentoFocusTarget): boolean {
    if (this.snapshot.request === null || target.slideId.trim() === '' || target.objectId.trim() === '') return false
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, focusRevision: this.snapshot.focusRevision + 1, focus: Object.freeze({ ...target }) })
    for (const listener of [...this.listeners]) listener()
    return true
  }
  registerInspector(contribution: PaimindBentoInspectorContribution): () => void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(contribution.id)) throw new Error('invalid Bento inspector id')
    this.inspectors.push(contribution)
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, inspectorRevision: this.snapshot.inspectorRevision + 1 })
    for (const listener of [...this.listeners]) listener()
    return () => {
      const index = this.inspectors.lastIndexOf(contribution)
      if (index >= 0) this.inspectors.splice(index, 1)
      const mode = this.snapshot.mode === 'trace' && this.getInspector() === null ? 'preview' as const : this.snapshot.mode
      this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, inspectorRevision: this.snapshot.inspectorRevision + 1, mode })
      for (const listener of [...this.listeners]) listener()
    }
  }
  getInspector(): PaimindBentoInspectorContribution | null { return this.inspectors.at(-1) ?? null }
  dispose(): void { this.inspectors.length = 0; this.listeners.clear() }
}

const STYLE_ID = '@paimind/renderer-bento'
const STYLE = `
[data-paimind-bento] { container-name:paimind-bento; container-type:inline-size; width:100%; height:100%; min-width:0; min-height:0; display:grid; grid-template-rows:auto auto minmax(0,1fr); overflow:hidden; color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-bg-layer-1,transparent); }
[data-paimind-bento-header] { padding: 10px 12px 6px; }
[data-paimind-bento-heading] { min-width:0; }
[data-paimind-bento-header] strong { display: block; overflow: hidden; font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
[data-paimind-bento-heading] span { display: block; margin-top: 2px; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 10px; line-height: 15px; }
[data-paimind-bento-toolbar] { display:flex; align-items:center; justify-content:flex-start; padding:4px 12px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16)); }
[data-paimind-bento-canvas] { min-width:0; min-height:0; display:grid; grid-template-columns:minmax(0,1fr); overflow:hidden; }
[data-paimind-bento-canvas][data-has-slide-rail='true'] { grid-template-columns:118px minmax(0,1fr); }
[data-paimind-bento-stage] { min-width: 0; min-height: 0; position: relative; overflow:hidden; }
[data-paimind-bento-workbench] { min-width:0; min-height:0; display:grid; grid-template-columns:minmax(0,1fr); overflow:hidden; }
[data-paimind-bento-workbench][data-mode='trace'] { grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr); }
[data-paimind-bento-workbench][data-mode='preview'] [data-paimind-bento-canvas] { background:var(--dsw-alias-bg-base,#e8ebf0); }
[data-paimind-bento-workbench][data-mode='preview'] [data-paimind-bento-stage] { display:grid; place-items:center; padding:clamp(14px,2.4vw,32px); }
[data-paimind-bento-workbench][data-mode='preview'] [data-paimind-bento-stage] > iframe { border-radius:8px; box-shadow:0 18px 55px #07172530; }
[data-paimind-bento-inspector] { min-width:0; min-height:0; overflow:hidden; border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16)); }
[data-paimind-bento-slide-rail] { min-width:0; min-height:0; padding:10px 8px 14px; overflow-y:auto; border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16)); background:var(--dsw-alias-bg-layer-2,#f5f7fa); scrollbar-width:thin; }
[data-paimind-bento-slide-rail] > header { padding:0 2px 10px; color:var(--dsw-alias-label-tertiary,#7a808a); font-size:9px; font-weight:650; line-height:14px; letter-spacing:.02em; white-space:nowrap; }
[data-paimind-bento-slide-list] { display:grid; gap:8px; margin:0; padding:0; list-style:none; }
[data-paimind-bento-slide-item] { position:relative; min-width:0; display:grid; grid-template-columns:14px minmax(0,1fr); align-items:center; gap:4px; padding:5px 4px; border:1px solid transparent; border-radius:10px; transition:border-color .15s ease,background .15s ease,box-shadow .15s ease,transform .15s ease; }
[data-paimind-bento-slide-item][data-active='true'] { border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 58%,transparent); background:var(--dsw-alias-bg-layer-1,#fff); box-shadow:0 6px 18px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 14%,transparent); }
[data-paimind-bento-slide-number] { color:var(--dsw-alias-label-tertiary,#7a808a); font-size:9px; font-weight:650; line-height:14px; text-align:center; }
[data-paimind-bento-slide-item][data-active='true'] [data-paimind-bento-slide-number] { color:var(--dsw-alias-state-business-primary,#2f6df6); }
[data-paimind-bento-thumbnail-frame] { position:relative; min-width:0; aspect-ratio:16/9; overflow:hidden; border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22)); border-radius:6px; background:#071725; box-shadow:0 2px 7px #0717251a; }
[data-paimind-bento-thumbnail-frame] iframe { position:absolute; top:0; left:0; width:1280px; height:720px; display:block; border:0; pointer-events:none; transform:scale(var(--paimind-thumbnail-scale,.06)); transform-origin:0 0; }
[data-paimind-bento-slide-item] > button { position:absolute; inset:0; z-index:1; width:100%; border:0; border-radius:9px; background:transparent; cursor:pointer; }
[data-paimind-bento-slide-item] > button:hover,[data-paimind-bento-slide-item] > button:focus-visible { outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 75%,transparent); outline-offset:1px; }
[data-paimind-bento-modes] { display:flex; align-items:center; gap:4px; padding:3px; border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14)); border-radius:11px; background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08)); }
[data-paimind-bento-mode-option] { position:relative; display:grid; place-items:center; }
[data-paimind-bento-mode-option] button { width:32px; height:32px; display:grid; place-items:center; padding:0; border:0; border-radius:8px; color:var(--dsw-alias-label-secondary,#59606b); background:transparent; cursor:pointer; transition:color .16s ease,background .16s ease,box-shadow .16s ease,transform .16s ease; }
[data-paimind-bento-mode-option] button:hover:not(:disabled),[data-paimind-bento-mode-option] button:focus-visible { color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.12)); transform:translateY(-1px); }
[data-paimind-bento-mode-option] button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8); outline-offset:2px; }
[data-paimind-bento-mode-option] button[aria-pressed='true'] { color:#fff; background:var(--dsw-alias-state-business-primary,#4f7ff8); box-shadow:0 5px 14px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 30%,transparent); }
[data-paimind-bento-mode-option] button:disabled { opacity:.34; cursor:not-allowed; }
[data-paimind-bento-mode-tooltip] { position:absolute; z-index:20; top:calc(100% + 8px); left:50%; min-width:max-content; padding:5px 8px; border-radius:6px; color:#fff; background:#1f2329; box-shadow:0 8px 24px #0004; font-size:11px; line-height:16px; white-space:nowrap; opacity:0; pointer-events:none; transform:translate(-50%,-4px); transition:opacity .14s ease,transform .14s ease; }
[data-paimind-bento-mode-option]:hover [data-paimind-bento-mode-tooltip] { opacity:1; transform:translate(-50%,0); }
[data-paimind-bento-edit-guidance] { position:absolute; z-index:5; top:10px; left:50%; max-width:calc(100% - 24px); padding:6px 10px; border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 35%,transparent); border-radius:999px; color:var(--dsw-alias-label-primary,#202124); background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,transparent); box-shadow:0 8px 24px #0002; font-size:10px; line-height:15px; text-align:center; transform:translateX(-50%); backdrop-filter:blur(12px); }
[data-paimind-bento-stage] > iframe { width:100%; height:100%; min-height:0; display:block; border:0; background:#071725; }
[data-paimind-bento-player-controls] { position:absolute; z-index:6; left:50%; bottom:16px; display:flex; align-items:center; gap:8px; padding:5px 7px; border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,rgba(128,128,128,.2)) 82%,transparent); border-radius:999px; color:var(--dsw-alias-label-primary,#202124); background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,transparent); box-shadow:0 10px 30px #07172533; transform:translateX(-50%); backdrop-filter:blur(14px); }
[data-paimind-bento-player-controls] button { width:30px; height:30px; display:grid; place-items:center; padding:0; border:0; border-radius:50%; color:inherit; background:transparent; cursor:pointer; font-size:22px; line-height:1; }
[data-paimind-bento-player-controls] button:hover:not(:disabled),[data-paimind-bento-player-controls] button:focus-visible { color:#fff; background:var(--dsw-alias-state-business-primary,#4f7ff8); }
[data-paimind-bento-player-controls] button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8); outline-offset:2px; }
[data-paimind-bento-player-controls] button:disabled { opacity:.3; cursor:not-allowed; }
[data-paimind-bento-player-position] { min-width:52px; color:var(--dsw-alias-label-secondary,#59606b); font-size:11px; font-weight:650; line-height:16px; text-align:center; font-variant-numeric:tabular-nums; }
[data-paimind-bento-state] { min-height: 240px; display: grid; place-items: center; padding: 24px; color: var(--dsw-alias-label-tertiary, #7a808a); font-size: 12px; line-height: 19px; text-align: center; }
[data-paimind-bento-state][data-error='true'] { color: var(--dsw-alias-state-error-primary, #d04444); }
@container paimind-bento (max-width:1040px){[data-paimind-bento-workbench][data-mode='trace']{grid-template-columns:minmax(0,1.35fr) minmax(280px,1fr)}[data-paimind-bento-canvas][data-has-slide-rail='true']{grid-template-columns:104px minmax(0,1fr)}}
@container paimind-bento (max-width:900px){[data-paimind-bento-workbench][data-mode='trace']{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(280px,58%) minmax(0,42%);overflow:hidden}[data-paimind-bento-inspector]{border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));border-left:0}[data-paimind-bento-canvas][data-has-slide-rail='true']{grid-template-columns:76px minmax(0,1fr)}[data-paimind-bento-slide-rail]{padding-inline:5px}[data-paimind-bento-slide-item]{grid-template-columns:1fr}[data-paimind-bento-slide-number]{position:absolute;z-index:2;top:5px;left:5px;min-width:14px;padding:1px 3px;border-radius:4px;color:var(--dsw-alias-label-primary-inverted,#fff);background:color-mix(in srgb,var(--dsw-alias-bg-base,#071725) 86%,transparent)}}
@container paimind-bento (max-width:620px){[data-paimind-bento-workbench][data-mode='trace']{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(240px,54%) minmax(0,46%)}[data-paimind-bento-canvas][data-has-slide-rail='true']{grid-template-columns:64px minmax(0,1fr)}[data-paimind-bento-slide-rail]{padding-inline:3px}[data-paimind-bento-workbench][data-mode='preview'] [data-paimind-bento-stage]{padding:8px}[data-paimind-bento-player-controls]{bottom:10px}}
@media(prefers-reduced-motion:reduce){[data-paimind-bento] *,[data-paimind-bento] *::before,[data-paimind-bento] *::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
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

function PreviewModeIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden="true"><path d="M2.4 10s2.7-4.5 7.6-4.5 7.6 4.5 7.6 4.5-2.7 4.5-7.6 4.5S2.4 10 2.4 10Z" stroke="currentColor" strokeWidth="1.5"/><circle cx="10" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.5"/></svg>
}

function EditModeIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden="true"><path d="m4 13.8-.6 2.8 2.8-.6L15 7.2a1.8 1.8 0 0 0 0-2.5l-.1-.1a1.8 1.8 0 0 0-2.5 0L4 13.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="m11.3 5.8 2.8 2.8" stroke="currentColor" strokeWidth="1.5"/></svg>
}

function TraceModeIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5.2" stroke="currentColor" strokeWidth="1.5"/><path d="m12.6 12.6 4 4M6.3 8.7h4.8M8.7 6.3v4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
}

function BentoModeButton(props: { readonly mode: PaimindBentoMode; readonly active: boolean; readonly disabled: boolean; readonly zh: boolean; readonly onClick: () => void }): React.JSX.Element {
  const tooltipId = useId()
  const label = props.mode === 'preview' ? (props.zh ? '预览' : 'Preview') : props.mode === 'edit' ? (props.zh ? '编辑' : 'Edit') : (props.zh ? '溯源' : 'Trace')
  const icon = props.mode === 'preview' ? <PreviewModeIcon /> : props.mode === 'edit' ? <EditModeIcon /> : <TraceModeIcon />
  return <span data-paimind-bento-mode-option>
    <button type="button" aria-label={label} aria-describedby={tooltipId} aria-pressed={props.active} disabled={props.disabled} onClick={props.onClick}>{icon}</button>
    <span id={tooltipId} role="tooltip" data-paimind-bento-mode-tooltip>{label}</span>
  </span>
}

function BentoSlideThumbnail(props: {
  readonly item: PaimindBentoSlideNavigationItem
  readonly index: number
  readonly source: { readonly origin: string; readonly url: string }
}): React.JSX.Element {
  const frameRef = useRef<HTMLSpanElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(0.06)
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const update = (): void => { setScale(frame.clientWidth / 1280) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    let initialized = false
    const receive = (event: MessageEvent): void => {
      if (initialized || event.source !== iframeRef.current?.contentWindow || event.origin !== props.source.origin) return
      if (normalizeBentoRuntimeMessage(event.data) === null) return
      initialized = true
      iframeRef.current?.contentWindow?.postMessage({ type: 'paimind:bento-mode', mode: 'preview' }, props.source.origin)
      iframeRef.current?.contentWindow?.postMessage({ type: 'paimind:bento-navigate', slideId: props.item.slideId, slide: props.index + 1 }, props.source.origin)
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [props.index, props.item.slideId, props.source.origin])
  return <span ref={frameRef} data-paimind-bento-thumbnail-frame aria-hidden="true" style={{ '--paimind-thumbnail-scale': String(scale) } as CSSProperties}><iframe
    ref={iframeRef}
    title=""
    src={props.source.url}
    sandbox="allow-scripts allow-same-origin"
    referrerPolicy="no-referrer"
    loading="lazy"
    tabIndex={-1}
  /></span>
}

function BentoSlideRail(props: {
  readonly slides: readonly PaimindBentoSlideNavigationItem[]
  readonly activeSlide: number
  readonly source: { readonly origin: string; readonly url: string }
  readonly store: BentoPreviewStore
  readonly zh: boolean
}): React.JSX.Element {
  const navigate = (index: number): void => {
    const item = props.slides[index]
    if (item !== undefined) props.store.navigate({ slideId: item.slideId, slide: index + 1 })
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | null = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = Math.min(props.slides.length - 1, index + 1)
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = props.slides.length - 1
    if (next === null || next === index) return
    event.preventDefault()
    navigate(next)
    event.currentTarget.closest('li')?.parentElement?.children.item(next)?.querySelector('button')?.focus()
  }
  return <aside data-paimind-bento-slide-rail aria-label={props.zh ? '幻灯片缩略图' : 'Slide thumbnails'}>
    <header>{props.zh ? `幻灯片 ${props.activeSlide} / ${props.slides.length}` : `Slides ${props.activeSlide} / ${props.slides.length}`}</header>
    <ol data-paimind-bento-slide-list>
      {props.slides.map((item, index) => <li key={item.slideId} data-paimind-bento-slide-item data-active={props.activeSlide === index + 1}>
        <span data-paimind-bento-slide-number>{index + 1}</span>
        <BentoSlideThumbnail item={item} index={index} source={props.source} />
        <button type="button" aria-label={props.zh ? `转到第 ${index + 1} 页：${item.title}` : `Go to slide ${index + 1}: ${item.title}`} aria-current={props.activeSlide === index + 1 ? 'page' : undefined} onClick={() => { navigate(index) }} onKeyDown={event => { onKeyDown(event, index) }} />
      </li>)}
    </ol>
  </aside>
}

function BentoPreviewControls(props: {
  readonly slides: readonly PaimindBentoSlideNavigationItem[]
  readonly activeSlide: number
  readonly store: BentoPreviewStore
  readonly zh: boolean
}): React.JSX.Element {
  const navigate = (index: number): void => {
    const item = props.slides[index]
    if (item !== undefined) props.store.navigate({ slideId: item.slideId, slide: index + 1 })
  }
  return <div role="group" aria-label={props.zh ? '幻灯片播放控制' : 'Slideshow controls'} data-paimind-bento-player-controls>
    <button type="button" aria-label={props.zh ? '上一张幻灯片' : 'Previous slide'} disabled={props.activeSlide <= 1} onClick={() => { navigate(props.activeSlide - 2) }}><span aria-hidden="true">‹</span></button>
    <span aria-live="polite" data-paimind-bento-player-position>{props.activeSlide} / {props.slides.length}</span>
    <button type="button" aria-label={props.zh ? '下一张幻灯片' : 'Next slide'} disabled={props.activeSlide >= props.slides.length} onClick={() => { navigate(props.activeSlide) }}><span aria-hidden="true">›</span></button>
  </div>
}

export function BentoPreviewPanel(props: { readonly store: BentoPreviewStore; readonly scope: PaimindSidebarTabScope }): React.JSX.Element {
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
  const [readySourceUrl, setReadySourceUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const request = snapshot.request
    setSource(null)
    setReadySourceUrl(null)
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
      if (normalized !== null) {
        setReadySourceUrl(source.url)
        props.store.publishRuntimeEvent(normalized)
      }
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [props.store, source])

  useEffect(() => {
    if (source === null || readySourceUrl !== source.url) return
    frameRef.current?.contentWindow?.postMessage({ type: 'paimind:bento-mode', mode: snapshot.mode }, source.origin)
  }, [readySourceUrl, snapshot.mode, source])

  useEffect(() => {
    if (source === null || readySourceUrl !== source.url || snapshot.focus === null) return
    frameRef.current?.contentWindow?.postMessage({ type: 'paimind:bento-focus', ...snapshot.focus }, source.origin)
  }, [readySourceUrl, snapshot.focusRevision, source])

  useEffect(() => {
    if (source === null || readySourceUrl !== source.url || snapshot.slideTarget === null) return
    frameRef.current?.contentWindow?.postMessage({ type: 'paimind:bento-navigate', ...snapshot.slideTarget }, source.origin)
  }, [readySourceUrl, snapshot.slideTargetRevision, source])

  const request = snapshot.request
  const inspectorSlides = props.store.getInspector()?.getSlideNavigation?.()?.slides ?? []
  const slides = snapshot.slides.length > 0 ? snapshot.slides : snapshot.mode === 'preview' ? [] : inspectorSlides
  const activeSlide = Math.min(slides.length, Math.max(1, snapshot.runtimeEvent?.slide ?? snapshot.slideTarget?.slide ?? 1))
  const showSlideRail = snapshot.mode !== 'preview' && source !== null && slides.length > 0
  return (
    <section data-paimind-bento aria-label={zh ? 'Bento 隔离预览' : 'Isolated Bento preview'}>
      <header data-paimind-bento-header>
        <div data-paimind-bento-heading><strong>{request?.title ?? (zh ? 'Bento 预览' : 'Bento Preview')}</strong>
        <span>{zh ? '独立 Origin · 无外部网络资源' : 'Isolated origin · no external network resources'}</span></div>
      </header>
      <div data-paimind-bento-toolbar>
        <div data-paimind-bento-modes aria-label={zh ? '工作台模式' : 'Workbench mode'}>{(['preview', 'edit', 'trace'] as const).map(mode => <BentoModeButton key={mode} mode={mode} active={snapshot.mode === mode} disabled={mode === 'trace' && props.store.getInspector() === null} zh={zh} onClick={() => { props.store.setMode(mode) }} />)}</div>
      </div>
      <div data-paimind-bento-workbench data-mode={snapshot.mode}>
      <div data-paimind-bento-canvas data-has-slide-rail={showSlideRail}>
      {showSlideRail && <BentoSlideRail slides={slides} activeSlide={activeSlide} source={source} store={props.store} zh={zh} />}
      <div data-paimind-bento-stage>
        {snapshot.mode === 'edit' && <div role="status" data-paimind-bento-edit-guidance>{zh ? '可编辑标题、说明与展示文案 · 事实值和派生指标已锁定' : 'Edit titles, explanations, and presentation copy · facts and derived metrics are locked'}</div>}
        {request === null ? <div data-paimind-bento-state>{zh ? '请打开一个 Bento 产物。' : 'Open a Bento artifact.'}</div>
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
        {snapshot.mode === 'preview' && source !== null && slides.length > 0 && <BentoPreviewControls slides={slides} activeSlide={activeSlide} store={props.store} zh={zh} />}
      </div>
      </div>
      {snapshot.mode === 'trace' && <aside data-paimind-bento-inspector>{props.store.getInspector()?.render(props.scope)}</aside>}
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
    ctx.paimindSidebar.closeTab('paimind:bento-preview')
    const disposeTab = ctx.paimindSidebar.registerTab({
      id: 'paimind:bento-preview',
      titleZh: 'Bento 预览',
      titleEn: 'Bento Preview',
      order: 52,
      single: true,
      hidden: true,
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
