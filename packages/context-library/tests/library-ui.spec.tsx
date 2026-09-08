import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { ContextLibrarySection } from '../src/client/library.js'
import type {
  ContextInput,
  ContextResult,
  ContextEntry,
} from '../src/contract.js'
import type { ContextRemoteApi } from '../src/client/api.js'
beforeEach(() => {
  sessionStorage.clear()
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
})
afterEach(cleanup)
function fixture(nested = false) {
  const collections = [
    {
      id: 'c',
      owner: 'local',
      title: '产品资料',
      description: '经审核的产品规格',
      revision: 1,
      updatedAt: 0,
    },
  ]
  let body = '数量 12，交期 7 天'
  let conflict = false
  const entry: ContextEntry = {
    path: nested ? '归档/产品说明.md' : '产品说明.md',
    name: '产品说明.md',
    kind: 'text',
    bytes: 32,
    revision: 'v1',
    description: '',
    contentType: 'text/markdown',
  }
  const request = vi.fn(async (input: ContextInput) => {
    let value: ContextResult = {}
    switch (input.action) {
      case 'collections':
        value = { collections: [...collections] }
        break
      case 'list':
        value = {
          entries: nested && input.path !== '归档'
            ? [{ ...entry, kind: 'directory', name: '归档', path: '归档' }]
            : [entry],
        }
        break
      case 'mounts':
        value = {
          mounts: [
            {
              id: 'm',
              collectionId: 'c',
              target: { kind: 'workspace', id: 'w' },
              mode: 'read',
              revision: 1,
            },
          ],
        }
        break
      case 'targets':
        value = {
          targets: [
            {
              target: { kind: 'workspace', id: 'w' },
              title: '/private/tmp/workspaces/客户方案',
            },
          ],
        }
        break
      case 'search':
        value = {
          hits: [
            {
              collectionId: 'c',
              path: entry.path,
              description: '',
              snippet: body,
            },
          ],
        }
        break
      case 'read':
        value = {
          document: {
            entry: { ...entry },
            content: body,
            encoding: 'utf8',
            offset: 0,
            nextOffset: null,
          },
        }
        break
      case 'write':
        if (conflict)
          return {
            ok: false as const,
            error: { message: 'VERSION_CONFLICT: 文件已被其他操作修改' },
          }
        body = input.content!
        entry.revision = 'v2'
        break
      case 'createCollection':
        collections.push({
          ...collections[0]!,
          id: 'new',
          title: input.title!,
          description: input.description!,
        })
        value = { collection: collections[1]! }
        break
    }
    return { ok: true as const, value }
  })
  return {
    api: { request } as ContextRemoteApi,
    request,
    conflict: () => {
      conflict = true
    },
  }
}
it('keeps the library a file manager and makes usage a read-only view with human names', async () => {
  const f = fixture()
  render(<ContextLibrarySection api={f.api} close={() => {}} />)
  await screen.findByRole('button', { name: '打开文件：产品说明.md' })
  expect(
    screen.queryByRole('textbox', { name: '资料夹名称' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByText('连接位置')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /被谁使用/ }))
  const usage = await screen.findByRole('region', { name: '资料夹使用记录' })
  expect(await within(usage).findByText('客户方案')).toBeInTheDocument()
  expect(within(usage).getByText('只读')).toBeInTheDocument()
  expect(usage.textContent).not.toContain('/private/tmp/')
  expect(within(usage).queryByRole('combobox')).not.toBeInTheDocument()
  expect(
    f.request.mock.calls.some(([i]) =>
      ['setMount', 'removeMount'].includes(i.action),
    ),
  ).toBe(false)
})
it('opens a separate creation form and does not implicitly bind the new folder', async () => {
  const f = fixture()
  render(<ContextLibrarySection api={f.api} close={() => {}} />)
  await screen.findByRole('button', { name: '打开资料夹：产品资料' })
  fireEvent.click(
    screen.getByRole('button', { name: '新建资料夹', exact: true }),
  )
  const dialog = screen.getByRole('dialog', { name: '新建资料夹' })
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: '资料夹名称' }),
    { target: { value: '品牌素材' } },
  )
  fireEvent.click(within(dialog).getByRole('button', { name: '创建资料夹' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(
    await screen.findByRole('button', { name: '打开资料夹：品牌素材' }),
  ).toHaveAttribute('aria-current', 'page')
  expect(f.request).toHaveBeenCalledWith({
    action: 'createCollection',
    title: '品牌素材',
    description: '',
  })
  expect(f.request.mock.calls.some(([i]) => i.action === 'setMount')).toBe(
    false,
  )
})
it('opens nested search results, saves the read revision and returns to their actual folder', async () => {
  const f = fixture(true)
  render(<ContextLibrarySection api={f.api} close={() => {}} />)
  await screen.findByRole('button', { name: '打开文件夹：归档' })
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索此资料夹' }), {
    target: { value: '数量' },
  })
  fireEvent.click(screen.getByRole('button', { name: '开始搜索' }))
  fireEvent.click(
    await screen.findByRole('button', { name: /产品说明.md.*数量 12/ }),
  )
  const text = await screen.findByRole('textbox', { name: '资料正文' })
  fireEvent.change(text, { target: { value: '数量 15，交期 7 天' } })
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
  await screen.findByText('修改已保存')
  expect(f.request).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'write',
      collectionId: 'c',
      path: '归档/产品说明.md',
      expectedRevision: 'v1',
      content: '数量 15，交期 7 天',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '关闭文件' }))
  expect(await screen.findByRole('button', { name: '打开文件：产品说明.md' })).toBeInTheDocument()
})
it('keeps unsaved content visible on conflict and blocks leaving through tabs or file close', async () => {
  const f = fixture()
  f.conflict()
  render(<ContextLibrarySection api={f.api} close={() => {}} />)
  fireEvent.click(
    await screen.findByRole('button', { name: '打开文件：产品说明.md' }),
  )
  const text = await screen.findByRole('textbox', { name: '资料正文' })
  fireEvent.change(text, { target: { value: '尚未保存的人工修改' } })
  fireEvent.click(screen.getByRole('button', { name: /被谁使用/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('请先保存修改')
  expect(text).toHaveValue('尚未保存的人工修改')
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('VERSION_CONFLICT')
  expect(text).toHaveValue('尚未保存的人工修改')
  expect(
    sessionStorage.getItem('paimind-library-draft:c:产品说明.md'),
  ).toContain('尚未保存的人工修改')
  fireEvent.click(screen.getByRole('button', { name: '关闭文件' }))
  expect(screen.getByRole('textbox', { name: '资料正文' })).toHaveValue(
    '尚未保存的人工修改',
  )
})
