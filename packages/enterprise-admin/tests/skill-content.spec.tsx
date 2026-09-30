import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicationContent } from '../src/client/skill-content.js'
import { EnterpriseApi } from '../src/client/api.js'
const version = { publicationId: 'c0000000-0000-4000-8000-000000000003', revision: 4, archiveDigest: 'sha256:' + 'a'.repeat(64), entryCount: 3 }
const text = '<script>globalThis.pwned=true</script>'
const entries = [{ index: 0, path: 'SKILL.md', kind: 'file', size: text.length }, { index: 1, path: 'empty', kind: 'directory', size: 0 }, { index: 2, path: 'script.js', kind: 'file', size: 32771 }]
const disposers: Array<() => void> = []
afterEach(() => { cleanup(); for (const off of disposers.splice(0)) off(); vi.restoreAllMocks() })
function fixture() {
  const state = { failure: 0, wrongVersion: false, late: undefined as undefined | (() => Promise<Response>) }
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (state.late) return state.late()
    if (state.failure) return new Response(JSON.stringify({ title: '当前内容不可访问' }), { status: state.failure })
    const path = String(url)
    const content = path.endsWith('/entries/0') ? { kind: 'entries', cursor: 0, total: 3, entries, nextCursor: null }
      : path.endsWith('/files/0/0') ? { kind: 'file', entry: entries[0], offset: 0, data: btoa(text), nextOffset: null }
      : path.endsWith('/files/2/0') ? { kind: 'file', entry: entries[2], offset: 0, data: btoa('x'.repeat(32768)), nextOffset: 32768 }
      : { kind: 'file', entry: entries[2], offset: 32768, data: btoa('\x00\x01\x02'), nextOffset: null }
    return new Response(JSON.stringify({ data: { publicationId: version.publicationId, revision: state.wrongVersion ? 5 : version.revision,
      archiveDigest: version.archiveDigest, runtimeGrant: false, content } }))
  })
  const api = new EnterpriseApi(transport); disposers.push(() => api.dispose())
  return { api, transport, state }
}
async function open(f: ReturnType<typeof fixture>, admin = false) {
  const view = render(<PublicationContent api={f.api} publication={version} admin={admin} />)
  expect(f.transport).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '查看封存内容' }))
  await screen.findByRole('button', { name: '查看文件 SKILL.md' }); return view
}
describe('bounded sealed-content component fixture, not real Browser E2E', () => {
  it('reads on demand from the exact member endpoint, renders source as text and does not execute or download it', async () => {
    const f = fixture(); await open(f)
    fireEvent.click(screen.getByRole('button', { name: '查看文件 SKILL.md' }))
    await screen.findByText(text)
    expect(document.querySelector('script, iframe, a[download]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'SKILL.md' })).toHaveFocus()
    expect(f.transport.mock.calls.every(([url, init]) => String(url).includes('/catalog/skills/') && init?.method === 'GET' && init.credentials === 'same-origin')).toBe(true)
    expect(screen.getByText('empty /（目录）')).toBeInTheDocument()
  })
  it('reads all large-file ranges, retains binary bytes and allows returning to earlier content', async () => {
    const f = fixture(); await open(f, true)
    fireEvent.click(screen.getByRole('button', { name: '查看文件 script.js' })); await screen.findByText('x'.repeat(32768))
    fireEvent.click(screen.getByRole('button', { name: '下一段文件' })); await screen.findByText('00 01 02')
    expect(screen.getByRole('button', { name: '下一段文件' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '上一段文件' })); await screen.findByText('x'.repeat(32768))
    expect(f.transport.mock.calls.every(([url]) => String(url).includes('/admin/skill-publications/'))).toBe(true)
  })
  it.each([401, 403, 404, 409])('clears visible content and filenames on %s while fetching another range', async status => {
    const f = fixture(); await open(f); fireEvent.click(screen.getByRole('button', { name: '查看文件 script.js' }))
    await screen.findByText('x'.repeat(32768)); f.state.failure = status
    fireEvent.click(screen.getByRole('button', { name: '下一段文件' })); await screen.findByRole('alert')
    expect(screen.queryByText('x'.repeat(32768))).toBeNull(); expect(screen.queryByRole('button', { name: '查看文件 SKILL.md' })).toBeNull()
  })
  it('rejects mismatched versions and ignores late replies after close', async () => {
    const f = fixture(); await open(f); f.state.wrongVersion = true
    fireEvent.click(screen.getByRole('button', { name: '查看文件 SKILL.md' })); await screen.findByRole('alert'); expect(screen.queryByText(text)).toBeNull()
    let release!: (value: Response) => void
    f.state.late = () => new Promise(done => { release = done })
    fireEvent.click(screen.getByRole('button', { name: '重新读取封存内容' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    const abort = f.transport.mock.calls.at(-1)![1]!.signal!
    fireEvent.click(screen.getByRole('button', { name: '关闭封存内容' })); expect(abort.aborted).toBe(true)
    await act(async () => release(new Response(JSON.stringify({ data: {} }))))
    expect(screen.queryByRole('region', { name: '封存技能文件' })).toBeNull()
  })
})
