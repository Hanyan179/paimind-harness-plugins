import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { WorkspaceEditor } from '../src/client/editor.js'
import type { EditorInput } from '../src/contract.js'
beforeEach(() => sessionStorage.clear())
afterEach(cleanup)
const saved = {
  format: 'docs',
  revision: 'v1',
  value: { title: '已保存', blocks: [] },
  snapshot: { title: '已保存', blocks: [] },
  undo: { canUndo: false, canRedo: false },
  changed: false,
}
function api() {
  return {
    call: vi.fn(async (input: EditorInput) =>
      input.method === 'getDocument'
        ? { ok: true, value: saved }
        : { ok: false, error: { message: 'VERSION_CONFLICT: 其他修改已保存' } },
    ),
  } as any
}
async function frame() {
  const element = screen.getByTitle('工作区内容编辑器') as HTMLIFrameElement
  await waitFor(() =>
    expect(element.srcdoc).toContain('globalThis.paimindDraft'),
  )
  const channel = element.srcdoc.match(/\)\("([a-f0-9-]{36})",/)?.[1]
  expect(channel).toBeTruthy()
  return { element, channel }
}
it('preserves unsent field text after a version conflict and reopening', async () => {
  const remote = api()
  const view = render(
    <WorkspaceEditor
      api={remote}
      workspaceId="w"
      path="content/document.json"
    />,
  )
  await screen.findByTitle('工作区内容编辑器')
  const { element, channel } = await frame()
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: element.contentWindow,
        data: {
          channel,
          kind: 'call',
          id: 1,
          method: 'setDocument',
          args: [{ title: '草稿', blocks: [] }],
          dirty: 1,
          draft: {
            content: { title: '草稿' },
            fields: [{ label: '单元格值或公式', value: '尚未提交的输入' }],
          },
        },
      }),
    )
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('VERSION_CONFLICT')
  expect(
    sessionStorage.getItem('paimind-editor-draft:w:content/document.json'),
  ).toContain('尚未提交的输入')
  view.unmount()
  render(
    <WorkspaceEditor
      api={remote}
      workspaceId="w"
      path="content/document.json"
    />,
  )
  expect(
    await screen.findByText('检测到未提交草稿，内容已保留'),
  ).toBeInTheDocument()
  expect(screen.getByText(/尚未提交的输入/)).toBeInTheDocument()
})
it('keeps earlier recovered drafts when another unsubmitted edit is reopened', async () => {
  const key = 'paimind-editor-draft:w:content/document.json'
  sessionStorage.setItem(
    key + ':recovered',
    JSON.stringify({ text: '此前草稿' }),
  )
  sessionStorage.setItem(key, JSON.stringify({ text: '最新草稿' }))
  render(
    <WorkspaceEditor
      api={api()}
      workspaceId="w"
      path="content/document.json"
    />,
  )
  await screen.findByText('检测到未提交草稿，内容已保留')
  expect(sessionStorage.getItem(key + ':recovered')).toContain('此前草稿')
  expect(sessionStorage.getItem(key + ':recovered')).toContain('最新草稿')
})
it('rejects a forged bridge sender even when its channel is known', async () => {
  const remote = api()
  render(
    <WorkspaceEditor
      api={remote}
      workspaceId="w"
      path="content/document.json"
    />,
  )
  await screen.findByTitle('工作区内容编辑器')
  const { channel } = await frame()
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { channel, kind: 'call', id: 1, method: 'setDocument', args: [] },
      }),
    )
  })
  expect(remote.call).toHaveBeenCalledTimes(1)
})
