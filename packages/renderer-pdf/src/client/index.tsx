import { PAIMIND_UI_FOUNDATION_CSS } from '@paimind/ui-foundation'
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import {
  markHarnessClientStyle, contributePaimindExtension, type PaimindClientContext } from '@paimind/harness-compat'
import type { PaimindSidebarService } from '@paimind/better-sidebar-adapter'

export const inject = ['slots', 'paimindSidebar', 'locale']

export interface PdfRendererClientContext extends PaimindClientContext {
  readonly paimindSidebar: PaimindSidebarService
}

const workerUrl = typeof URL.createObjectURL === 'function'
  ? URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  : ''
if (workerUrl !== '') GlobalWorkerOptions.workerSrc = workerUrl

function PdfPage(props: { readonly document: PDFDocumentProxy; readonly pageNumber: number; readonly width: number }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let task: { cancel(): void } | undefined
    void props.document.getPage(props.pageNumber).then(async page => {
      if (!active || canvasRef.current === null) return
      const base = page.getViewport({ scale: 1 })
      const cssScale = Math.max(0.25, Math.min(2.5, props.width / base.width))
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: cssScale * pixelRatio })
      const canvas = canvasRef.current
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`
      canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('Canvas 2D is unavailable')
      const render = page.render({ canvas, canvasContext: context, viewport })
      task = render
      await render.promise
      page.cleanup()
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false; try { task?.cancel() } catch { /* render already settled */ } }
  }, [props.document, props.pageNumber, props.width])
  return <article data-paimind-pdf-page aria-label={`PDF page ${props.pageNumber}`}>
    {error === null ? <canvas ref={canvasRef} /> : <div role="alert">{error}</div>}
  </article>
}

export function PdfPreview(props: { readonly title: string; readonly mediaUrl: string | undefined; readonly zh?: boolean }): React.JSX.Element {
  const zh = props.zh ?? true
  const [retry, setRetry] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly document: PDFDocumentProxy }
    | { readonly status: 'error'; readonly message: string }
  >({ status: 'loading' })

  useEffect(() => {
    const element = stageRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const update = (): void => { setWidth(Math.max(240, element.clientWidth - 32)) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    const element = stageRef.current
    if (element !== null && typeof element.scrollTo === 'function') element.scrollTo({ top: 0, left: 0 })
  }, [pageNumber])

  useEffect(() => {
    const controller = new AbortController()
    let loading: ReturnType<typeof getDocument> | undefined
    let loaded: PDFDocumentProxy | undefined
    setState({ status: 'loading' })
    setPageNumber(1)
    setZoom(1)
    if (props.mediaUrl === undefined) {
      setState({ status: 'error', message: 'PDF media URL is unavailable.' })
      return () => { controller.abort() }
    }
    void fetch(props.mediaUrl, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      })
      .then(async data => {
        if (controller.signal.aborted) return
        loading = getDocument({ data })
        loaded = await loading.promise
        if (!controller.signal.aborted) setState({ status: 'ready', document: loaded })
      })
      .catch(error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) })
    return () => {
      controller.abort()
      void loading?.destroy()
      if (loaded !== undefined) void loaded.cleanup()
    }
  }, [props.mediaUrl, retry])

  return <section data-paimind-ui-scope="renderer-pdf" data-paimind-pdf aria-label={zh ? 'PDF 文档预览' : 'PDF preview'}>
    <header data-paimind-pdf-toolbar>
      <strong>{props.title}</strong>
      {state.status === 'ready' && <div data-paimind-pdf-controls>
        <button type="button" aria-label={zh ? '上一页' : 'Previous page'} disabled={pageNumber <= 1} onClick={() => { setPageNumber(current => Math.max(1, current - 1)) }}>{zh ? '上一页' : 'Previous'}</button>
        <output aria-label={zh ? '页码' : 'Page'}>{pageNumber} / {state.document.numPages}</output>
        <button type="button" aria-label={zh ? '下一页' : 'Next page'} disabled={pageNumber >= state.document.numPages} onClick={() => { setPageNumber(current => Math.min(state.document.numPages, current + 1)) }}>{zh ? '下一页' : 'Next'}</button>
        <button type="button" aria-label={zh ? '缩小' : 'Zoom out'} disabled={zoom <= 0.75} onClick={() => { setZoom(current => Math.max(0.75, current - 0.25)) }}>{zh ? '缩小' : 'Zoom out'}</button>
        <output aria-label={zh ? '缩放' : 'Zoom'}>{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label={zh ? '放大' : 'Zoom in'} disabled={zoom >= 2} onClick={() => { setZoom(current => Math.min(2, current + 0.25)) }}>{zh ? '放大' : 'Zoom in'}</button>
      </div>}
      {props.mediaUrl !== undefined && <a href={props.mediaUrl} download>{zh ? '下载文档' : 'Download'}</a>}
    </header>
    <div
      ref={stageRef}
      data-paimind-pdf-stage
      tabIndex={0}
      aria-label={zh ? '文档阅读区' : 'Document viewport'}
      onKeyDown={(event) => {
        const element = event.currentTarget
        const pageStep = Math.max(120, Math.round(element.clientHeight * 0.8))
        const delta = event.key === 'PageDown' ? pageStep
          : event.key === 'PageUp' ? -pageStep
            : event.key === 'ArrowDown' ? 48
              : event.key === 'ArrowUp' ? -48
                : undefined
        if (delta !== undefined) {
          event.preventDefault()
          element.scrollBy({ top: delta, left: 0 })
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          element.scrollTo({ top: event.key === 'Home' ? 0 : element.scrollHeight, left: 0 })
        }
      }}
    >
      {state.status === 'loading' && <div data-paimind-pdf-state role="status">{zh ? '正在打开文档…' : 'Loading PDF…'}</div>}
      {state.status === 'error' && <div role="alert" data-paimind-pdf-state><p>{zh ? '文档暂时无法打开，请重试或下载后查看。' : 'Could not open the document. Retry or download it to view.'}</p>{props.mediaUrl !== undefined && <button type="button" data-paimind-ui-button onClick={() => { setRetry(value => value + 1) }}>{zh ? '重新加载' : 'Retry'}</button>}<details><summary>{zh ? '错误详情' : 'Error details'}</summary>{state.message}</details></div>}
      {state.status === 'ready' && <PdfPage key={pageNumber} document={state.document} pageNumber={pageNumber} width={width * zoom} />}
    </div>
  </section>
}

class PdfErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('[paimind-renderer-pdf]', error, info) }
  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

const STYLE_ID = '@paimind/renderer-pdf'
const STYLE = `
[data-paimind-pdf]{height:100%;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-pdf-toolbar]{min-width:0;min-height:40px;display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));font-size:12px}
[data-paimind-pdf-toolbar] strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-pdf-toolbar] span{color:var(--dsw-alias-label-tertiary,#7a808a)}
[data-paimind-pdf-toolbar] a{color:var(--dsw-alias-state-business-primary,#4f7ff8);text-decoration:none}
[data-paimind-pdf-controls]{display:flex;flex-wrap:wrap;align-items:center;gap:4px;white-space:nowrap}
[data-paimind-pdf-controls] button{min-width:36px;min-height:36px;padding:6px 8px;font:inherit;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;cursor:pointer}
[data-paimind-pdf-controls] button:disabled{cursor:not-allowed;opacity:.38}
[data-paimind-pdf-controls] output{min-width:42px;text-align:center;color:var(--dsw-alias-label-secondary,#5b6270);font-variant-numeric:tabular-nums}
[data-paimind-pdf-stage]{min-width:0;min-height:0;overflow:auto;display:grid;align-content:start;justify-items:center;gap:14px;padding:16px;background:var(--dsw-alias-bg-layer-2,#eef0f3)}
[data-paimind-pdf-stage]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4f7ff8);outline-offset:-2px}
[data-paimind-pdf-page]{display:grid;place-items:center;background:#fff;box-shadow:0 3px 14px rgba(0,0,0,.14)}
[data-paimind-pdf-page] canvas{display:block;height:auto}
[data-paimind-pdf-state]{min-height:240px;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary,#7a808a);font-size:12px}
@media(max-width:680px){[data-paimind-pdf-toolbar]{align-items:flex-start;flex-wrap:wrap}[data-paimind-pdf-toolbar] strong{flex-basis:100%}[data-paimind-pdf-controls]{order:3;width:100%;justify-content:center}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/renderer-pdf'; markHarnessClientStyle(style, '@paimind/renderer-pdf')
  style.textContent = `${PAIMIND_UI_FOUNDATION_CSS}\n${STYLE}`
  document.head.append(style)
  return () => { style.remove() }
}

export function apply(ctx: PdfRendererClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:renderer-pdf', packageName: '@paimind/renderer-pdf', category: 'content-rendering',
    nameZh: 'PDF 预览', nameEn: 'PDF Preview',
    descriptionZh: '查看 PDF 文档，支持翻页和缩放。',
    descriptionEn: 'Renders real artifacts locally with PDF.js without relying on the browser PDF plugin.',
    surface: 'preview', maturity: 'technical-preview', order: 22,
  })
  ctx.effect(() => installStyle(), 'paimind-renderer-pdf: style')
  ctx.effect(() => ctx.paimindSidebar.registerFileViewer({
    id: 'paimind:pdf', titleZh: 'PDF 文档预览', titleEn: 'PAIMind PDF Preview',
    extensions: ['pdf'], priority: 120,
    render: ({ title, mediaUrl }) => <PdfErrorBoundary><PdfPreview title={title} mediaUrl={mediaUrl} zh={ctx.locale.getLocale().active.startsWith('zh')} /></PdfErrorBoundary>,
  }), 'paimind-renderer-pdf: viewer')
}
