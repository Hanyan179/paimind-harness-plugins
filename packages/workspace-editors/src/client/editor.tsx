import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DOMPurify from 'dompurify'
import type { HarnessRemoteResult } from '@hansen/harness-compat'
import { editorFrame, standaloneEditor } from './frame.js'
import type { EditorInput, EditorResult } from '../contract.js'
export interface EditorRemoteApi {
  call(input: EditorInput): Promise<HarnessRemoteResult<EditorResult>>
}
async function result(
  api: EditorRemoteApi,
  input: EditorInput,
): Promise<EditorResult> {
  const r = await api.call(input)
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        (k === 'html' || k === 'legacyContent' || k === 'markup') &&
        typeof v === 'string'
          ? DOMPurify.sanitize(v, {
              USE_PROFILES: { html: true },
              FORBID_TAGS: ['iframe', 'form', 'input', 'button', 'style'],
              FORBID_ATTR: ['srcdoc'],
            })
          : clean(v),
      ]),
    )
  return value
}
function download(content: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function WorkspaceEditor({
  api,
  workspaceId,
  path,
}: {
  api: EditorRemoteApi
  workspaceId: string
  path: string
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState(''),
    [status, setStatus] = useState('正在读取…'),
    [error, setError] = useState(''),
    [format, setFormat] = useState<EditorResult['format']>('docs'),
    [epoch, setEpoch] = useState(0),
    [printSource, setPrintSource] = useState(''),
    [expanded, setExpanded] = useState(false),
    [exportSheetId, setExportSheetId] = useState(''),
    [recovered, setRecovered] = useState('')
  const draftKey = 'paimind-editor-draft:' + workspaceId + ':' + path
  const state = useRef({
    revision: '',
    dirty: false,
    blocked: false,
    channel: crypto.randomUUID(),
    snapshot: null as unknown,
    format: 'docs' as EditorResult['format'],
    queue: Promise.resolve(),
    pending: 0,
  })
  const post = (message: object) =>
    frame.current?.contentWindow?.postMessage(
      { channel: state.current.channel, ...message },
      '*',
    )
  useEffect(() => {
    let live = true
    const current = state.current
    try {
      const previous = sessionStorage.getItem(draftKey)
      if (previous) {
        const old = sessionStorage.getItem(draftKey + ':recovered')
        const history: unknown[] = old ? [JSON.parse(old)] : []
        history.push(JSON.parse(previous))
        sessionStorage.setItem(draftKey + ':recovered', JSON.stringify(history))
      }
      sessionStorage.removeItem(draftKey)
      setRecovered(sessionStorage.getItem(draftKey + ':recovered') ?? '')
    } catch {
      setError('浏览器无法暂存草稿，请在关闭前下载草稿。')
    }
    current.channel = crypto.randomUUID()
    current.dirty = false
    current.blocked = false
    current.revision = ''
    setSource('')
    setError('')
    const read = async () => {
      let r: EditorResult
      try {
        r = await result(api, {
          workspaceId,
          path,
          method: 'getDocument',
          args: [],
        })
      } catch (e) {
        if (!String(e).includes('该格式不支持')) throw e
        r = await result(api, {
          workspaceId,
          path,
          method: 'getDeck',
          args: [],
        })
      }
      return r
    }
    void read()
      .then((r) => {
        if (!live) return
        current.revision = r.revision
        current.snapshot = r.snapshot
        current.format = r.format
        setFormat(r.format)
        setSource(editorFrame(r.format, current.channel))
        setStatus('已读取保存版本')
      })
      .catch((e) => {
        if (live) setError(String(e))
      })
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== current.channel ||
        !live
      )
        return
      const m = event.data
      if (
        m.draft &&
        (m.kind === 'dirty' ||
          (m.kind === 'call' && !String(m.method).startsWith('get')))
      ) {
        try {
          sessionStorage.setItem(
            draftKey,
            JSON.stringify({
              format: current.format,
              baseRevision: current.revision,
              snapshot: m.draft,
              ...(m.kind === 'call'
                ? { operation: { method: m.method, args: m.args } }
                : {}),
            }),
          )
        } catch {
          setError('草稿超过浏览器暂存空间，请下载当前草稿。')
        }
      }
      if (m.kind === 'dirty') {
        current.dirty = true
        setStatus('有未提交修改')
      }
      if (m.kind === 'clean') {
        current.dirty = false
        sessionStorage.removeItem(draftKey)
        setStatus('已保存')
      }
      if (m.kind === 'blocked') {
        current.blocked = true
        setStatus('需要处理冲突')
        setError(
          '文件出现并发修改。当前草稿已保留，请先下载草稿，再重新打开最新版本。',
        )
      }
      if (m.kind === 'draft') {
        if (m.draft)
          download(
            JSON.stringify(
              {
                format: current.format,
                baseRevision: current.revision,
                snapshot: m.draft,
              },
              null,
              2,
            ),
            '未提交草稿.json',
            'application/json',
          )
      }
      if (m.kind !== 'call') return
      const write = !String(m.method).startsWith('get')
      if (write) {
        current.dirty = true
        setStatus('正在保存…')
      }
      current.pending++
      current.queue = current.queue.then(async () => {
        try {
          if (current.blocked && write)
            throw new Error('VERSION_CONFLICT: 保留草稿后重新打开')
          const r = await result(api, {
            workspaceId,
            path,
            method: String(m.method),
            args: clean(m.args) as EditorInput['args'],
            expectedRevision: current.revision,
            operationId: crypto.randomUUID(),
          })
          if (!live) return
          current.revision = r.revision
          current.snapshot = r.snapshot
          post({
            kind: 'result',
            id: m.id,
            value: clean(r.value),
            snapshot: clean(r.snapshot),
            undo: r.undo,
            changed: r.changed,
            saved: write,
            dirty: m.dirty,
          })
          if (write) setStatus('已保存')
        } catch (e) {
          if (!live) return
          current.blocked = true
          setError(String(e))
          post({ kind: 'result', id: m.id, error: String(e) })
        } finally {
          current.pending--
        }
      })
    }
    window.addEventListener('message', receive)
    const timer = setInterval(() => {
      if (!current.revision || current.pending || current.blocked) return
      void read()
        .then((r) => {
          if (!live || r.revision === current.revision) return
          if (current.dirty) {
            current.blocked = true
            setStatus('需要处理冲突')
            setError(
              '文件已被其他操作修改。草稿已保留，请先下载草稿，再重新打开。',
            )
            return
          }
          current.revision = r.revision
          current.snapshot = r.snapshot
          post({ kind: 'refresh', snapshot: clean(r.snapshot), undo: r.undo })
          setStatus('已同步文件变更')
        })
        .catch((e) => {
          if (live) setError(String(e))
        })
    }, 2000)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('message', receive)
    }
  }, [api, workspaceId, path, epoch])
  const exportText = async (
    method: string,
    args: EditorInput['args'],
    name: string,
    type: string,
  ) => {
    try {
      if (state.current.dirty || state.current.blocked)
        throw new Error('请先保存或处理冲突，再导出保存版本')
      const r = await result(api, { workspaceId, path, method, args })
      download(String(r.value), name, type)
    } catch (e) {
      setError(String(e))
    }
  }
  const exportPage = async (print: boolean) => {
    try {
      if (state.current.dirty || state.current.blocked)
        throw new Error('请先保存或处理冲突，再导出保存版本')
      const r = await result(api, {
        workspaceId,
        path,
        method: format === 'slides' ? 'getDeck' : 'getDocument',
        args: [],
      })
      const html = standaloneEditor(format, clean(r.snapshot), print)
      if (print) setPrintSource(html)
      else download(html, '工作区导出.html', 'text/html')
    } catch (e) {
      setError(String(e))
    }
  }
  const sheetSnapshot = state.current.snapshot as {
    sheetOrder?: string[]
    sheets?: Record<string, { name: string }>
  } | null
  const exportSheet = sheetSnapshot?.sheetOrder?.includes(exportSheetId)
    ? exportSheetId
    : (sheetSnapshot?.sheetOrder?.[0] ?? '')
  const content = (
    <section
      data-workspace-editor
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
        overflow: 'hidden',
        background: 'var(--dsw-alias-bg-base,white)',
        ...(expanded ? { position: 'fixed', inset: 0, zIndex: 1000 } : {}),
      }}
    >
      <header
        style={{
          padding: 10,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <style>{`[data-workspace-editor] button {font:inherit;color:inherit;border:1px solid #d7dde5;border-radius:7px;padding:6px 10px;background:var(--dsw-alias-bg-base,white);cursor:pointer} [data-workspace-editor] header {border-bottom:1px solid #e4e8ee;font-size:13px;flex-shrink:0} [data-workspace-editor] button:hover {background:#f0f4f8} [data-workspace-editor] button:disabled {opacity:.5;cursor:default}`}</style>
        <button
          onClick={() => {
            if (state.current.dirty || state.current.pending) {
              setError('请等待当前修改保存，再切换编辑布局。')
              return
            }
            setExpanded((v) => !v)
          }}
        >
          {expanded ? '返回分栏' : '专注编辑'}
        </button>
        <strong>
          {{ docs: '文档', slides: '幻灯片', sheets: '表格' }[format]}工作区
        </strong>
        <small role="status">{status}</small>
        <button onClick={() => post({ kind: 'draft' })}>下载当前草稿</button>
        <button
          onClick={() => {
            setEpoch((v) => v + 1)
          }}
        >
          重新打开
        </button>
        {format === 'docs' && (
          <button
            onClick={() => {
              void exportText('exportMarkdown', [], '文档.md', 'text/markdown')
            }}
          >
            导出标记文本
          </button>
        )}
        {format === 'sheets' ? (
          <>
            <select
              aria-label="导出工作表"
              value={exportSheet}
              onChange={(event) => setExportSheetId(event.target.value)}
            >
              {(sheetSnapshot?.sheetOrder ?? []).map((id) => (
                <option key={id} value={id}>
                  {sheetSnapshot?.sheets?.[id]?.name ?? id}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (exportSheet)
                  void exportText(
                    'exportCsv',
                    [exportSheet],
                    `${sheetSnapshot?.sheets?.[exportSheet]?.name ?? exportSheet}.csv`,
                    'text/csv',
                  )
              }}
            >
              导出所选工作表 CSV（逗号分隔文件，保留公式）
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                void exportPage(false)
              }}
            >
              导出网页
            </button>
            <button
              onClick={() => {
                void exportPage(true)
              }}
            >
              打印另存 PDF（便携文档）
            </button>
          </>
        )}
      </header>
      {recovered && (
        <details style={{ padding: 10 }}>
          <summary>检测到未提交草稿，内容已保留</summary>
          <button
            onClick={() =>
              download(recovered, '未提交草稿.json', 'application/json')
            }
          >
            下载此前草稿
          </button>
          <pre
            style={{ maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap' }}
          >
            {recovered}
          </pre>
        </details>
      )}
      {error && (
        <p
          role="alert"
          style={{ padding: 12, background: '#fff0eb', color: '#a82c20' }}
        >
          {error}
        </p>
      )}
      {source ? (
        <iframe
          ref={frame}
          title="工作区内容编辑器"
          sandbox="allow-scripts allow-downloads allow-modals"
          srcDoc={source}
          style={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
        />
      ) : (
        <p>内容尚未加载；无效文件不会被空白内容覆盖。</p>
      )}
      {printSource && (
        <iframe
          title="打印保存版本"
          sandbox="allow-scripts allow-modals"
          srcDoc={printSource}
          style={{
            position: 'fixed',
            width: 1,
            height: 1,
            left: -9999,
            border: 0,
          }}
        />
      )}
    </section>
  )
  return expanded ? createPortal(content, window.document.body) : content
}
