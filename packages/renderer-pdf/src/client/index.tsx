import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import { contributePaimindExtension, type PaimindClientContext } from '@paimind/harness-compat'
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

export function PdfPreview(props: { readonly title: string; readonly mediaUrl: string | undefined }): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
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
    const controller = new AbortController()
    let loading: ReturnType<typeof getDocument> | undefined
    let loaded: PDFDocumentProxy | undefined
    setState({ status: 'loading' })
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
  }, [props.mediaUrl])

  return <section data-paimind-pdf aria-label="PAIMind PDF Preview">
    <header data-paimind-pdf-toolbar>
      <strong>{props.title}</strong>
      {state.status === 'ready' && <span>{state.document.numPages} {state.document.numPages === 1 ? 'page' : 'pages'}</span>}
      {props.mediaUrl !== undefined && <a href={props.mediaUrl} download>{'下载 / Download'}</a>}
    </header>
    <div ref={stageRef} data-paimind-pdf-stage>
      {state.status === 'loading' && <div data-paimind-pdf-state>Loading PDF…</div>}
      {state.status === 'error' && <div role="alert" data-paimind-pdf-state>{state.message}</div>}
      {state.status === 'ready' && Array.from({ length: state.document.numPages }, (_, index) => (
        <PdfPage key={index + 1} document={state.document} pageNumber={index + 1} width={width} />
      ))}
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
[data-paimind-pdf-toolbar]{min-width:0;min-height:40px;display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));font-size:11px}
[data-paimind-pdf-toolbar] strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-pdf-toolbar] span{color:var(--dsw-alias-label-tertiary,#7a808a)}
[data-paimind-pdf-toolbar] a{color:var(--dsw-alias-state-business-primary,#4f7ff8);text-decoration:none}
[data-paimind-pdf-stage]{min-width:0;min-height:0;overflow:auto;display:grid;align-content:start;justify-items:center;gap:14px;padding:16px;background:var(--dsw-alias-bg-layer-2,#eef0f3)}
[data-paimind-pdf-page]{display:grid;place-items:center;max-width:100%;background:#fff;box-shadow:0 3px 14px rgba(0,0,0,.14)}
[data-paimind-pdf-page] canvas{display:block;max-width:100%;height:auto}
[data-paimind-pdf-state]{min-height:240px;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary,#7a808a);font-size:12px}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = '@paimind/renderer-pdf'
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

export function apply(ctx: PdfRendererClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:renderer-pdf', packageName: '@paimind/renderer-pdf', category: 'content-rendering',
    nameZh: 'PDF 预览', nameEn: 'PDF Preview',
    descriptionZh: '使用本地 PDF.js 渲染真实产物，不依赖浏览器内置 PDF 插件。',
    descriptionEn: 'Renders real artifacts locally with PDF.js without relying on the browser PDF plugin.',
    surface: 'preview', maturity: 'technical-preview', order: 22,
  })
  ctx.effect(() => installStyle(), 'paimind-renderer-pdf: style')
  ctx.effect(() => ctx.paimindSidebar.registerFileViewer({
    id: 'paimind:pdf', titleZh: 'PAIMind PDF 预览', titleEn: 'PAIMind PDF Preview',
    extensions: ['pdf'], priority: 120,
    render: ({ title, mediaUrl }) => <PdfErrorBoundary><PdfPreview title={title} mediaUrl={mediaUrl} /></PdfErrorBoundary>,
  }), 'paimind-renderer-pdf: viewer')
}
