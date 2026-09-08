import { useEffect, useState } from 'react'
import {
  contributePaimindExtension,
  type PaimindClientContext,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
} from '@hansen/harness-compat'
import type { PaimindWorkspaceProjectService } from '@hansen/workspace-project'
import type { PaimindSidebarService } from '@hansen/better-sidebar-adapter'
import { WorkspaceEditor, type EditorRemoteApi } from './editor.js'
import type { EditorDocumentList } from '../contract.js'
import TYPERT_REMOTE from '../remote.js'
export { WorkspaceEditor, type EditorRemoteApi } from './editor.js'
export const name = 'paimind-workspace-editors-client'
export const inject = [
  'slots',
  'remote',
  'paimindSidebar',
  'paimindWorkspaceProject',
  'locale',
]
interface Api extends EditorRemoteApi {
  list(input: {
    workspaceId: string
  }): Promise<HarnessRemoteResult<EditorDocumentList>>
}
interface Client extends PaimindClientContext {
  readonly paimindWorkspaceProject: PaimindWorkspaceProjectService
  readonly paimindSidebar: PaimindSidebarService
  readonly remote: HarnessRemoteMountService & {
    readonly paimindWorkspaceEditors?: Api
  }
  inject(
    services: readonly string[],
    install: (scope: Client) => void,
    label?: string,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}
function EditorHome({
  api,
  workspaceId,
}: {
  api: Api
  workspaceId: string | undefined
}): React.JSX.Element {
  const [items, setItems] = useState<EditorDocumentList>([]),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setSelected('')
    if (workspaceId)
      void api
        .list({ workspaceId })
        .then((r) => {
          if (!live) return
          if (!r.ok) throw new Error(r.error.message)
          setItems(r.value)
          if (r.value.length === 1) setSelected(r.value[0]!.path)
        })
        .catch((e) => {
          if (live) setError(String(e))
        })
    return () => {
      live = false
    }
  }, [api, workspaceId])
  if (!workspaceId)
    return <p style={{ padding: 20 }}>当前会话尚未归属工作区。</p>
  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {error && <p role="alert">{error}</p>}
      {selected ? (
        <>
          <button onClick={() => setSelected('')}>返回工作文件</button>
          <WorkspaceEditor
            api={api}
            workspaceId={workspaceId}
            path={selected}
          />
        </>
      ) : (
        <section style={{ padding: 24 }}>
          <h2>工作文件</h2>
          <p>文档、幻灯片与表格直接保存到当前工作区。</p>
          {items.length ? (
            items.map((item) => (
              <button
                style={{ display: 'block', margin: 10, padding: 14 }}
                key={item.path}
                onClick={() => setSelected(item.path)}
              >
                {item.title} ·{' '}
                {
                  { docs: '文档', slides: '幻灯片', sheets: '表格' }[
                    item.format
                  ]
                }
              </button>
            ))
          ) : (
            <p>
              没有可编辑格式。可以从工作区模板创建起始内容；普通文件继续使用原有预览。
            </p>
          )}
        </section>
      )}
    </div>
  )
}
export async function apply(ctx: Client): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject(
    [...inject, 'remote.paimindWorkspaceEditors'],
    (scope) => {
      const api = scope.remote.paimindWorkspaceEditors
      if (!api) throw new Error('Workspace editor service unavailable')
      contributePaimindExtension(scope.slots, {
        id: 'paimind:workspace-editors',
        packageName: '@hansen/workspace-editors',
        nameZh: '工作区编辑器',
        nameEn: 'Workspace Editors',
        descriptionZh: '在同一份工作文件中编辑文档、幻灯片和表格。',
        descriptionEn: 'Edit canonical local documents, slides and workbooks.',
        category: 'content-rendering',
        surface: 'preview',
        maturity: 'technical-preview',
        order: 32,
      })
      scope.effect(
        () =>
          scope.paimindSidebar.registerTab({
            id: 'paimind:workspace-editors',
            titleZh: '编辑',
            titleEn: 'Edit',
            order: 20,
            render: (tab) => (
              <EditorHome api={api} workspaceId={tab.workspaceId} />
            ),
          }),
        'workspace-editors: work files',
      )
      scope.effect(() => {
        let pending:
          | { workspaceId: string; sessionId?: string; path: string }
          | undefined
        const tryOpen = () => {
          if (!pending) return
          const next = pending
          if (
            !next.sessionId &&
            scope.paimindWorkspaceProject.getSnapshot().currentProject
              ?.workspaceId !== next.workspaceId
          )
            return
          pending = undefined
          if (
            !scope.paimindSidebar.openTab('paimind:workspace-editors', {
              path: next.path,
              ...(next.sessionId ? { sessionId: next.sessionId } : {}),
            })
          )
            pending = next
        }
        const stop = scope.paimindWorkspaceProject.subscribe(tryOpen),
          stopSidebar = scope.paimindSidebar.subscribe(tryOpen)
        const adopted = (event: Event) => {
          const detail = (
            event as CustomEvent<{ workspaceId?: string; sessionId?: string }>
          ).detail
          const id = detail?.workspaceId
          if (id)
            void api.list({ workspaceId: id }).then((r) => {
              if (r.ok && r.value.length) {
                pending = {
                  workspaceId: id,
                  path: r.value[0]!.path,
                  ...(detail.sessionId ? { sessionId: detail.sessionId } : {}),
                }
                tryOpen()
              }
            })
        }
        window.addEventListener('paimind:workspace-adopted', adopted)
        return () => {
          stop()
          stopSidebar()
          window.removeEventListener('paimind:workspace-adopted', adopted)
        }
      }, 'workspace-editors: adopted workspace')
    },
  )
  try {
    await mounted
  } catch (e) {
    await disposeRemote()
    throw e
  }
  return async () => {
    await mounted.dispose()
    await disposeRemote()
  }
}
