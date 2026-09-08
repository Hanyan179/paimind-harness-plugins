import docs from '../vendor/docs/client.js?raw'
import slides from '../vendor/slides/client.js?raw'
import sheets from '../vendor/sheets/client.js?raw'
import type { WorkspaceFormat } from '../contract.js'
const sources = { docs, slides, sheets }
// Runs inside an opaque-origin frame. Only this source-owned bridge can request named methods.
function bridgeRuntime(
  channel: string,
  format: string,
  exportMode: boolean,
): void {
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let next = 0
  let subscriber: any
  let dirty = 0
  let blocked = false
  const send = (message: object) =>
    parent.postMessage({ channel, ...message }, '*')
  const request = (method: string, args: unknown[]) =>
    new Promise((resolve, reject) => {
      if (blocked && !method.startsWith('get')) {
        reject(new Error('保存冲突，请保留草稿并重新打开'))
        return
      }
      const id = ++next
      pending.set(id, { resolve, reject })
      send({
        kind: 'call',
        id,
        method,
        args,
        dirty,
        draft: globals.paimindDraft?.(),
      })
    })
  const globals = globalThis as any
  globals.RpcTarget = class {
    dup() {
      return this
    }
    onRpcBroken() {}
  }
  globals.gadget = new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === 'subscribe')
          return async (callback: unknown) => {
            subscriber = callback
            return request(format === 'slides' ? 'getDeck' : 'getDocument', [])
          }
        if (method === 'updatePresence' || method === 'leavePresence')
          return async () => null
        return (...args: unknown[]) => request(method, args)
      },
    },
  )
  globals.gadgetExportFormatId = exportMode ? 'html' : undefined
  document.addEventListener(
    'input',
    () => {
      dirty++
      queueMicrotask(() =>
        send({ kind: 'dirty', dirty, draft: globals.paimindDraft?.() }),
      )
    },
    true,
  )
  window.addEventListener('beforeunload', (event) => {
    if (dirty) {
      event.preventDefault()
      event.returnValue = '尚有未保存内容'
    }
  })
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.channel !== channel) return
    const m = event.data
    if (m.kind === 'result') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) {
        blocked = true
        send({ kind: 'blocked' })
        p.reject(new Error(m.error))
        return
      }
      p.resolve(m.value)
      if (m.changed && format === 'slides')
        subscriber?.deckChanged(m.snapshot, m.undo)
      if (m.dirty === dirty && m.saved) {
        dirty = 0
        send({ kind: 'clean' })
      }
    }
    if (m.kind === 'refresh') {
      if (dirty || pending.size) {
        send({ kind: 'blocked' })
        blocked = true
        return
      }
      if (format === 'slides') subscriber?.deckChanged(m.snapshot, m.undo)
      else subscriber?.operation({ type: 'snapshot', document: m.snapshot })
    }
    if (m.kind === 'print') window.print()
    if (m.kind === 'exportHtml')
      send({ kind: 'exportHtml', html: document.documentElement.outerHTML })
    if (m.kind === 'draft')
      send({
        kind: 'draft',
        draft: globals.paimindDraft?.(),
        html: document.documentElement.outerHTML,
      })
  })
  // Translate the shared editor chrome while keeping user content untouched.
  const labels: Record<string, string> = {
    'Document title': '文档标题',
    'Spreadsheet title': '表格标题',
    Strikethrough: '删除线',
    'Save status': '保存状态',
    Saved: '已保存',
    'Saving…': '保存中…',
    'Save failed': '保存失败',
    Offline: '加载失败',
    File: '文件',
    Edit: '编辑',
    View: '视图',
    Insert: '插入',
    Format: '格式',
    Tools: '工具',
    Help: '帮助',
    Undo: '撤销',
    Redo: '重做',
    Print: '打印',
    Present: '演示',
    Search: '搜索',
    Text: '文本',
    Title: '标题',
    Image: '图片',
    Link: '链接',
    Bold: '加粗',
    Italic: '斜体',
    Underline: '下划线',
    'Align left': '左对齐',
    'Align center': '居中',
    'Align right': '右对齐',
    'Add slide': '添加页面',
    'New slide': '新页面',
    Duplicate: '复制',
    Delete: '删除',
    Slides: '幻灯片',
    Components: '组件',
    Background: '背景',
    Properties: '属性',
    'No selection': '尚未选择',
    'Insert image': '插入图片',
    'Font size': '字号',
    'Normal text': '正文',
    'Heading 1': '一级标题',
    'Heading 2': '二级标题',
    'Heading 3': '三级标题',
    'Add sheet': '添加工作表',
    Copy: '复制',
    Paste: '粘贴',
    Cut: '剪切',
    'Select all': '全选',
  }
  const translate = () => {
    for (const element of document.querySelectorAll(
      'button,button span,button div,[role=menuitem],option,[aria-label="Save status"] *,input',
    )) {
      if (element.closest('[contenteditable=true],.slide,.cell')) continue
      for (const child of element.childNodes)
        if (child.nodeType === 3 && labels[child.textContent?.trim() ?? ''])
          child.textContent = labels[child.textContent!.trim()]!
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const title = element.getAttribute(attr)
        if (title) {
          const plain = title.replace(/ \(.*$/, '')
          if (labels[plain])
            element.setAttribute(
              attr,
              labels[plain]! + title.slice(plain.length),
            )
        }
      }
    }
  }
  new MutationObserver(translate).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  translate()
}
export function editorFrame(
  format: WorkspaceFormat,
  channel: string,
  exportMode = false,
): string {
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const draft = {
    docs: '({title:titleInput.value,blocks:serializeBlocks()})',
    slides: 'deck',
    sheets: 'model',
  }[format]
  const source = (
    sources[format] +
    '\nglobalThis.paimindDraft=()=>({content:(' +
    draft +
    '),fields:Array.from(document.querySelectorAll(\"input,textarea,[contenteditable=true]\")).map((e,index)=>({index,label:e.getAttribute(\"aria-label\")||e.getAttribute(\"placeholder\")||e.id,value:e.value??e.innerHTML}))});'
  ).replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"></head><body><script nonce="${nonce}" type="module">(${bridgeRuntime.toString()})(${JSON.stringify(channel)},${JSON.stringify(format)},${exportMode});\n${source}\n</script></body></html>`
}
/** Export contains the saved snapshot and this pinned renderer, with no host bridge or file access. */
export function standaloneEditor(
  format: WorkspaceFormat,
  snapshot: unknown,
  print = false,
): string {
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const data = JSON.stringify(snapshot).replaceAll('<', '\\u003c')
  const script =
    `const snapshot=${data};globalThis.RpcTarget=class{};globalThis.gadgetExportFormatId='html';globalThis.gadget={getDeck:async()=>snapshot,getDocument:async()=>snapshot,subscribe:async()=>snapshot,updatePresence:async()=>null,leavePresence:async()=>null};\n${sources[format]}\n${print ? 'setTimeout(()=>window.print(),600)' : ''}`.replace(
      /<\/script/gi,
      '<\\/script',
    )
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>工作区导出</title></head><body><script nonce="${nonce}" type="module">${script}</script></body></html>`
}
