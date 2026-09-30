import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstalledSkillContent, readCurrentAdoptedContent, type AdoptedContentReader } from '../src/client/installed-content.js'
import type { SkillAdoptedContentInput } from '../src/adopted-content.js'

const reference = { tenantId: 'component-fixture', publicationId: 'a0000000-0000-4000-8000-000000000001', sourceUserId: 'b0000000-0000-4000-8000-000000000002',
  name: 'customer-notes', packageDigest: 'sha256:' + 'a'.repeat(64), archiveDigest: 'sha256:' + 'b'.repeat(64), archiveBytes: 200000, expandedBytes: 180000, entryCount: 200 }
const body = '<script>window.notExecuted = true</script>\nOriginal Skill body'
const digest = 'sha256:' + 'd'.repeat(64)
const entry = (name: string, size = body.length) => ({ path: name, name, kind: 'text' as const, size, digest })
const directory = (path: string, entries: unknown[], nextCursor?: string) => ({ ok: true as const, value: { reference, runtimeGrant: false as const, kind: 'directory' as const,
  page: { path, entries, ...(nextCursor === undefined ? {} : { nextCursor }) } } })
const file = (path: string, bytes: string, offset = 0, size = bytes.length, nextOffset: number | null = null) => ({ ok: true as const,
  value: { reference, runtimeGrant: false as const, kind: 'file' as const, path, size, offset, data: btoa(bytes), nextOffset } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function fixture() {
  const read = vi.fn<AdoptedContentReader>(async input => {
    if (input.kind === 'directory') return directory(input.path, input.path === '' ? [entry('SKILL.md'), { path: 'empty', name: 'empty', kind: 'directory', size: 0 }] : []) as never
    return file(input.path, body)
  })
  const view = render(<InstalledSkillContent reference={reference} read={read} />)
  return { read, view }
}
async function open() { fireEvent.click(screen.getByRole('button', { name: '查看只读内容' })); await screen.findByRole('button', { name: '文件 SKILL.md' }) }

describe('adopted native Skill content viewer (component fixtures, NOT Browser E2E)', () => {
  it('reads only on demand, displays inert text and empty directories, and closes with focus restored', async () => {
    const f = fixture(); expect(f.read).not.toHaveBeenCalled(); await open()
    expect(f.read).toHaveBeenLastCalledWith({ reference, kind: 'directory', path: '' })
    fireEvent.click(screen.getByRole('button', { name: '文件 SKILL.md' })); await screen.findByText(body, { normalizer: value => value })
    expect(document.querySelector('script')).toBeNull(); expect(screen.getByRole('heading', { name: 'SKILL.md' })).toHaveFocus()
    expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '根目录' })); fireEvent.click(await screen.findByRole('button', { name: '目录 empty' })); await screen.findByText('空目录')
    fireEvent.keyDown(screen.getByRole('heading'), { key: 'Escape' }); expect(screen.queryByText('空目录')).toBeNull()
    expect(screen.getByRole('button', { name: '查看只读内容' })).toHaveFocus()
  })
  it('traverses every bounded binary segment, goes back and retains exact zero-byte files', async () => {
    const f = fixture(), first = '\0'.repeat(32768), last = '\xff'.repeat(11)
    f.read.mockImplementation(async input => {
      if (input.kind === 'directory') return directory('', [entry('SKILL.md', 32779), entry('zero.txt', 0)]) as never
      if (input.path === 'zero.txt') return file(input.path, '')
      return input.offset === 0 ? file(input.path, first, 0, 32779, 32768) : file(input.path, last, 32768, 32779)
    })
    await open(); fireEvent.click(screen.getByRole('button', { name: '文件 SKILL.md' })); await screen.findByText(/二进制或当前分块/)
    expect(screen.getByRole('button', { name: '上一段' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: '下一段' }))
    await screen.findByText('ff '.repeat(10).trimEnd() + ' ff'); expect(screen.getByRole('button', { name: '下一段' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '上一段' })); await screen.findByText(/当前范围 0–32768/)
    fireEvent.click(screen.getByRole('button', { name: '根目录' })); fireEvent.click(await screen.findByRole('button', { name: '文件 zero.txt' })); await screen.findByText('空文件')
    expect(screen.getByRole('button', { name: '下一段' })).toBeDisabled()
  })
  it('pages a complete directory without inventing or dropping empty entries', async () => {
    const f = fixture()
    f.read.mockImplementation(async input => directory('', input.kind === 'directory' && input.cursor === '100'
      ? [entry('last.txt', 0)] : Array.from({ length: 100 }, (_, index) => entry(index === 0 ? 'SKILL.md' : 'file-' + index, 0)),
    input.kind === 'directory' && input.cursor === '100' ? undefined : '100') as never)
    await open(); expect(screen.getAllByRole('listitem')).toHaveLength(100)
    fireEvent.click(screen.getByRole('button', { name: '下一页目录' })); await screen.findByRole('button', { name: '文件 last.txt' })
    expect(screen.queryByRole('button', { name: '文件 SKILL.md' })).toBeNull(); expect(screen.getByRole('button', { name: '下一页目录' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '上一页目录' })); await screen.findByRole('button', { name: '文件 SKILL.md' })
  })
  it('clears previous directory and file bytes when current authority or native contents become unavailable', async () => {
    const f = fixture(); await open(); fireEvent.click(screen.getByRole('button', { name: '文件 SKILL.md' })); await screen.findByText(body, { normalizer: value => value })
    f.read.mockResolvedValue({ ok: false, error: { message: '当前权限已撤销' } } as never)
    fireEvent.focus(window); expect(await screen.findByRole('alert')).toHaveTextContent('当前权限已撤销')
    expect(screen.queryByText(body, { normalizer: value => value })).toBeNull(); expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button', { name: '文件 SKILL.md' })).toBeNull()
  })
  it('rejects wrong references, malformed ranges and unsafe directory entries without returning cached content', async () => {
    const abort = new AbortController().signal, request = { reference, kind: 'file' as const, path: 'SKILL.md', offset: 0 }
    for (const value of [{ ...file('SKILL.md', body).value, reference: { ...reference, publicationId: 'foreign' } },
      { ...file('SKILL.md', body).value, nextOffset: 1 }, { ...file('SKILL.md', body).value, data: 'invalid@@' }]) {
      const read = vi.fn<AdoptedContentReader>(async () => ({ ok: true, value }) as never)
      await expect(readCurrentAdoptedContent(read, request, abort)).rejects.toThrow('不一致')
    }
    await expect(readCurrentAdoptedContent(async () => directory('', [entry('../secret')]) as never,
      { reference, kind: 'directory', path: '' }, abort)).rejects.toThrow('不一致')
  })
  it('discards pending reads on close or native owner unmount and never opens a late result', async () => {
    const f = fixture(); let done!: (value: never) => void
    f.read.mockImplementation(() => new Promise(resolve => { done = resolve })); fireEvent.click(screen.getByRole('button', { name: '查看只读内容' }))
    await waitFor(() => expect(done).toBeTypeOf('function')); fireEvent.click(screen.getByRole('button', { name: '收起只读内容' }))
    await act(async () => done(directory('', [entry('late.txt')]) as never)); expect(screen.queryByText('late.txt')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看只读内容' })); f.view.unmount(); await act(async () => done(directory('', []) as never))
    expect(screen.queryByText('空目录')).toBeNull()
  })
})
