import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClientContextFixture } from '@paimind/testkit'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({ promise: Promise.resolve({
    numPages: 3, cleanup: vi.fn(),
    getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })), cleanup: vi.fn(),
    })),
  }), destroy: vi.fn() })),
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?raw', () => ({ default: 'worker' }))

import { apply, PdfPreview } from '../src/client/index.tsx'

describe('FP06 PAIMind PDF renderer', () => {
  it('registers one higher-priority PDF channel through the stable adapter', () => {
    const fixture = createClientContextFixture()
    const registerFileViewer = vi.fn(() => () => {})
    apply(Object.assign(fixture.context, { paimindSidebar: { registerFileViewer } }) as any)
    expect(registerFileViewer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'paimind:pdf', extensions: ['pdf'], priority: 120,
    }))
  })

  it('loads bytes locally and exposes paged navigation, zoom and boundary feedback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    render(<PdfPreview title="Report" mediaUrl="/media/report.pdf" />)
    await waitFor(() => { expect(screen.getByRole('status', { name: '页码' })).toHaveTextContent('1 / 3') })
    const previous = screen.getByRole('button', { name: '上一页' })
    const next = screen.getByRole('button', { name: '下一页' })
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(screen.getByRole('status', { name: '页码' })).toHaveTextContent('2 / 3')
    fireEvent.click(next)
    expect(screen.getByRole('status', { name: '页码' })).toHaveTextContent('3 / 3')
    expect(next).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(screen.getByRole('status', { name: '缩放' })).toHaveTextContent('125%')
    const viewport = screen.getByLabelText('文档阅读区')
    const scrollBy = vi.fn()
    const scrollTo = vi.fn()
    Object.defineProperties(viewport, { scrollBy: { value: scrollBy }, scrollTo: { value: scrollTo } })
    fireEvent.keyDown(viewport, { key: 'PageDown' })
    expect(scrollBy).toHaveBeenCalledWith({ top: 120, left: 0 })
    fireEvent.keyDown(viewport, { key: 'End' })
    expect(scrollTo).toHaveBeenCalledWith({ top: viewport.scrollHeight, left: 0 })
    expect(screen.getByRole('link', { name: '下载文档' })).toHaveAttribute('href', '/media/report.pdf')
    vi.unstubAllGlobals()
  })

  it('shows a readable error instead of a blank preview when PDF loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    render(<PdfPreview title="Broken report" mediaUrl="/media/broken.pdf" />)
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503') })
    vi.unstubAllGlobals()
  })
})
