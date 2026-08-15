import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClientContextFixture } from '@paimind/testkit'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({ promise: Promise.resolve({
    numPages: 1, cleanup: vi.fn(),
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

  it('loads bytes locally and exposes a page count instead of a download-only blank surface', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    render(<PdfPreview title="Report" mediaUrl="/media/report.pdf" />)
    await waitFor(() => { expect(screen.getByText('1 page')).toBeInTheDocument() })
    expect(screen.getByRole('link', { name: '下载 / Download' })).toHaveAttribute('href', '/media/report.pdf')
    vi.unstubAllGlobals()
  })
})
