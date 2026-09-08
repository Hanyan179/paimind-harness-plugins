import { useEffect, useRef, useState } from 'react'
import {
  PaimindTemplateIcon,
  PaimindAttachmentIcon,
  PaimindMoreIcon,
  PaimindPlusIcon,
  PaimindSearchIcon,
  PaimindUploadIcon,
  PaimindCloseIcon,
  PaimindChevronRightIcon,
  PaimindConnectionIcon,
  PaimindTrashIcon,
} from '@hansen/harness-compat/client-icons'
import type {
  ContextCollection,
  ContextEntry,
  ContextInput,
  ContextMount,
  ContextRead,
  ContextResult,
} from '../contract.js'
import { contextResult, type ContextRemoteApi } from './api.js'
import { LibraryDialog, LibraryMenu, MoveFileDialog } from './controls.js'
const op = () => crypto.randomUUID()
const parentPath = (path: string) => path.split('/').slice(0, -1).join('/')
const itemName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) || path
const sizeLabel = (bytes: number) =>
  bytes < 1024
    ? bytes + ' 字节'
    : bytes < 1024 * 1024
      ? (bytes / 1024).toFixed(1) + ' KB'
      : (bytes / 1024 / 1024).toFixed(1) + ' MB'
const kindLabel = (entry: ContextEntry) =>
  entry.kind === 'directory'
    ? '文件夹'
    : entry.kind === 'text'
      ? '文本文件'
      : entry.contentType.startsWith('image/')
        ? '图片'
        : '文件'
export function ContextLibrarySection({
  api,
  close,
  blockClose,
}: {
  api: ContextRemoteApi
  close: () => void
  blockClose?: () => () => void
}): React.JSX.Element {
  const [collections, setCollections] = useState<ContextCollection[]>([]),
    [selected, setSelected] = useState(''),
    [path, setPath] = useState(''),
    [entries, setEntries] = useState<ContextEntry[]>([]),
    [document, setDocument] = useState<ContextRead | null>(null),
    [draft, setDraft] = useState(''),
    [fileDescription, setFileDescription] = useState(''),
    [draftRevision, setDraftRevision] = useState<string | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [newName, setNewName] = useState(''),
    [description, setDescription] = useState(''),
    [targets, setTargets] = useState<NonNullable<ContextResult['targets']>>([]),
    [mounts, setMounts] = useState<ContextMount[]>([]),
    [view, setView] = useState<'files' | 'usage' | 'trash'>('files'),
    [submittedQuery, setSubmittedQuery] = useState(''),
    [hits, setHits] = useState<NonNullable<ContextResult['hits']>>([]),
    [loading, setLoading] = useState(true),
    [refreshVersion, setRefreshVersion] = useState(0),
    [collectionDialog, setCollectionDialog] = useState<'new' | 'edit' | null>(
      null,
    ),
    [moveEntry, setMoveEntry] = useState<ContextEntry | null>(null)
  const recycle = view === 'trash'
  const loadSequence = useRef(0)
  const [promptState, setPromptState] = useState<{
    title: string
    value: string
  } | null>(null)
  const promptResolve = useRef<((value: string | null) => void) | null>(null)
  const prompt = (title: string, value = '') =>
    new Promise<string | null>((resolve) => {
      promptResolve.current = resolve
      setPromptState({ title, value })
    })
  const finishPrompt = (value: string | null) => {
    promptResolve.current?.(value)
    promptResolve.current = null
    setPromptState(null)
  }
  const upload = useRef<HTMLInputElement>(null),
    folderUpload = useRef<HTMLInputElement>(null)
  const dirty =
    document !== null &&
    (draft !== document.content ||
      fileDescription !== document.entry.description)
  const draftKey = (filePath: string) =>
    'paimind-library-draft:' + selected + ':' + filePath
  const remember = (content: string, desc: string) => {
    if (!document) return
    try {
      sessionStorage.setItem(
        draftKey(document.entry.path),
        JSON.stringify({
          content,
          description: desc,
          revision: draftRevision ?? document.entry.revision,
        }),
      )
    } catch {
      setError('浏览器无法暂存草稿，请保持页面开启并保存。')
    }
  }
  const forget = () => {
    if (document) sessionStorage.removeItem(draftKey(document.entry.path))
  }
  useEffect(() => {
    if (dirty) return blockClose?.()
  }, [dirty, blockClose])
  useEffect(
    () => () => {
      promptResolve.current?.(null)
    },
    [],
  )
  const request = (input: ContextInput) => contextResult(api, input)
  const load = async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const c = await request({ action: 'collections' })
      if (sequence !== loadSequence.current) return
      const items = c.collections ?? []
      setCollections(items)
      if (!selected || !items.some((item) => item.id === selected)) {
        setSelected(items[0]?.id ?? '')
        setEntries([])
        setMounts([])
        return
      }
      const [files, usage, names] = await Promise.all([
        request(
          submittedQuery && view === 'files'
            ? {
                action: 'search',
                collectionId: selected,
                query: submittedQuery,
              }
            : {
                action: recycle ? 'recycle' : 'list',
                collectionId: selected,
                path: recycle ? '' : path,
              },
        ),
        request({ action: 'mounts', collectionId: selected }),
        view === 'usage'
          ? request({ action: 'targets' })
          : Promise.resolve({} as ContextResult),
      ])
      if (sequence !== loadSequence.current) return
      setEntries(files.entries ?? [])
      setHits(files.hits ?? [])
      setMounts(usage.mounts ?? [])
      if (names.targets) setTargets(names.targets)
    } catch (e) {
      if (sequence === loadSequence.current) setError(String(e))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }
  const act = async (fn: () => Promise<void>): Promise<boolean> => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      setRefreshVersion((version) => version + 1)
      return true
    } catch (e) {
      setError(String(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setError('')
    void load()
    return () => {
      loadSequence.current++
    }
  }, [api, selected, path, view, submittedQuery, refreshVersion])
  const canLeave = () => {
    if (dirty) {
      setError('请先保存修改，或点击放弃当前编辑。')
      return false
    }
    return true
  }
  const read = async (filePath: string) => {
    if (!canLeave()) return
    const r = await request({
      action: 'read',
      collectionId: selected,
      path: filePath,
    })
    setDocument(r.document ?? null)
    setDraft(r.document?.content ?? '')
    setFileDescription(r.document?.entry.description ?? '')
    setDraftRevision(r.document?.entry.revision ?? null)
    if (r.document?.encoding === 'utf8' && r.document.nextOffset === null) {
      try {
        const saved = sessionStorage.getItem(draftKey(filePath))
        if (saved) {
          const d = JSON.parse(saved) as {
            content: string
            description: string
            revision: string
          }
          if (
            d.content === r.document.content &&
            d.description === r.document.entry.description
          )
            sessionStorage.removeItem(draftKey(filePath))
          else {
            setDraft(d.content)
            setFileDescription(d.description)
            setDraftRevision(d.revision)
            setNotice('已恢复未提交草稿。保存时仍检查草稿读取时的文件版本。')
          }
        }
      } catch {
        setError('未提交草稿无法读取；已保留浏览器记录。')
      }
    }
  }
  const fileBytes = async (entry: ContextEntry) => {
    const pieces: Uint8Array[] = []
    let offset = 0
    let revision: string | null = null
    do {
      const r = (
        await request({
          action: 'read',
          collectionId: selected,
          path: entry.path,
          offset,
          limit: 65536,
        })
      ).document!
      if (revision !== null && revision !== r.entry.revision)
        throw new Error('VERSION_CONFLICT: 下载期间文件已变化，请重试')
      revision = r.entry.revision
      pieces.push(
        r.encoding === 'base64'
          ? Uint8Array.from(atob(r.content), (c) => c.charCodeAt(0))
          : new TextEncoder().encode(r.content),
      )
      if (r.nextOffset === null) break
      offset = r.nextOffset
    } while (true)
    return new Blob(pieces as BlobPart[], { type: entry.contentType })
  }
  const download = async (entry: ContextEntry) => {
    const blob = await fileBytes(entry)
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = entry.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const uploadFiles = async (files: FileList | null) => {
    if (!files || !canLeave()) return
    await act(async () => {
      for (const file of Array.from(files)) {
        const relative = file.webkitRelativePath || file.name
        const destination = path ? `${path}/${relative}` : relative
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        let expectedRevision: string | null = null
        try {
          expectedRevision = (
            await request({
              action: 'read',
              collectionId: selected,
              path: destination,
              limit: 1,
            })
          ).document!.entry.revision
        } catch (e) {
          if (!String(e).includes('ENOENT')) throw e
        }
        if (expectedRevision !== null) {
          const answer = await prompt(
            '覆盖已存在文件？输入“覆盖”以保存 ' + destination,
          )
          if (answer !== '覆盖') continue
        }
        await request({
          action: 'write',
          collectionId: selected,
          path: destination,
          content: btoa(binary),
          encoding: 'base64',
          expectedRevision,
          operationId: op(),
        })
      }
      setNotice('文件已上传')
    })
  }

  const current = collections.find((c) => c.id === selected)
  const browse = (nextPath: string) => {
    if (!canLeave()) return
    setPath(nextPath)
    setDocument(null)
    setSubmittedQuery('')
    setQuery('')
    setNotice('')
  }
  const chooseCollection = (id: string) => {
    if (!canLeave()) return
    setSelected(id)
    setPath('')
    setDocument(null)
    setView('files')
    setSubmittedQuery('')
    setQuery('')
    setNotice('')
  }
  const chooseView = (next: typeof view) => {
    if (!canLeave()) return
    setView(next)
    setDocument(null)
    setNotice('')
  }
  const editCollection = (mode: 'new' | 'edit') => {
    if (!canLeave()) return
    setNewName(mode === 'edit' ? (current?.title ?? '') : '')
    setDescription(mode === 'edit' ? (current?.description ?? '') : '')
    setError('')
    setCollectionDialog(mode)
  }
  const createEntry = async (directory: boolean) => {
    if (!canLeave()) return
    const name = await prompt(
      directory ? '新建文件夹' : '新建文件',
      directory ? '' : '未命名.md',
    )
    if (!name?.trim()) return
    if (/[\\/]/.test(name) || name === '.' || name === '..') {
      setError('名称不能包含路径分隔符。')
      return
    }
    const destination = path ? path + '/' + name : name
    await act(async () => {
      await request(
        directory
          ? {
              action: 'mkdir',
              collectionId: selected,
              path: destination,
              operationId: op(),
            }
          : {
              action: 'write',
              collectionId: selected,
              path: destination,
              content: '',
              expectedRevision: null,
              operationId: op(),
            },
      )
      if (!directory) await read(destination)
      setNotice(directory ? '文件夹已创建' : '文件已创建，可以开始编辑')
    })
  }
  const rename = async (entry: ContextEntry) => {
    if (!canLeave()) return
    const name = await prompt('重命名', entry.name)
    if (!name || name === entry.name) return
    if (/[\\/]/.test(name) || name === '.' || name === '..') {
      setError('名称不能包含路径分隔符。')
      return
    }
    const folder = parentPath(entry.path)
    await act(async () => {
      await request({
        action: 'move',
        collectionId: selected,
        path: entry.path,
        toPath: folder ? folder + '/' + name : name,
        expectedRevision: entry.revision,
        operationId: op(),
      })
      setDocument(null)
      setNotice('名称已更新')
    })
  }
  const trash = async (entry: ContextEntry) => {
    if (!canLeave()) return
    await act(async () => {
      await request({
        action: 'trash',
        collectionId: selected,
        path: entry.path,
        expectedRevision: entry.revision,
        operationId: op(),
      })
      setDocument(null)
      setNotice('已移入回收站，可以随时恢复')
    })
  }
  const saveDocument = async () => {
    if (!document) return
    await act(async () => {
      await request({
        action: 'write',
        collectionId: selected,
        path: document.entry.path,
        content: draft,
        description: fileDescription,
        expectedRevision: draftRevision,
        operationId: op(),
      })
      const updated = (
        await request({
          action: 'read',
          collectionId: selected,
          path: document.entry.path,
        })
      ).document!
      forget()
      setDocument(updated)
      setDraft(updated.content)
      setFileDescription(updated.entry.description)
      setDraftRevision(updated.entry.revision)
      setNotice('修改已保存')
    })
  }
  const usageTitle = (mount: ContextMount) => {
    const target = targets.find(
      (t) =>
        t.target.kind === mount.target.kind && t.target.id === mount.target.id,
    )
    if (!target) return '原使用位置已不可用'
    if (mount.target.kind === 'workspace') return itemName(target.title)
    if (
      mount.target.kind === 'session' &&
      target.title.includes(mount.target.id)
    )
      return '会话名称暂不可用'
    return target.title
  }
  return (
    <section
      data-context-library
      data-paimind-ui-scope
      aria-label="资料文件管理"
    >
      <header className="cl-page-header">
        <div>
          <h1>资料库</h1>
          <p>整理、保存和查找可复用的资料。</p>
        </div>
        <button
          className="cl-icon-button"
          aria-label="关闭资料库"
          title="关闭资料库"
          disabled={busy}
          onClick={() => {
            if (canLeave()) close()
          }}
        >
          <PaimindCloseIcon size={20} />
        </button>
      </header>
      <div className="cl-layout">
        <nav className="cl-sidebar" aria-label="资料夹">
          <div className="cl-sidebar-heading">
            <h2>资料夹</h2>
            <span>{collections.length}</span>
          </div>
          <button
            className="cl-new-collection"
            disabled={busy}
            onClick={() => editCollection('new')}
          >
            <PaimindPlusIcon size={16} />
            新建资料夹
          </button>
          <div className="cl-collections">
            {collections.map((collection) => (
              <button
                key={collection.id}
                disabled={busy}
                className="cl-collection"
                aria-label={'打开资料夹：' + collection.title}
                aria-current={selected === collection.id ? 'page' : undefined}
                onClick={() => chooseCollection(collection.id)}
              >
                <PaimindTemplateIcon size={18} />
                <span>{collection.title}</span>
              </button>
            ))}
          </div>
          <p className="cl-sidebar-note">按主题或项目整理资料。</p>
        </nav>
        <div className="cl-content" aria-busy={busy || loading}>
          {current ? (
            <>
              <header className="cl-collection-header">
                <div className="cl-collection-heading">
                  <span className="cl-folder-emblem">
                    <PaimindTemplateIcon size={24} />
                  </span>
                  <div>
                    <h2>{current.title}</h2>
                    <p>{current.description || '还没有资料夹说明。'}</p>
                  </div>
                </div>
                <button
                  className="cl-subtle"
                  disabled={busy}
                  onClick={() => editCollection('edit')}
                >
                  编辑资料夹信息
                </button>
              </header>
              <nav className="cl-tabs" aria-label="资料夹视图">
                <button
                  disabled={busy}
                  aria-current={view === 'files' ? 'page' : undefined}
                  onClick={() => chooseView('files')}
                >
                  文件
                </button>
                <button
                  disabled={busy}
                  aria-current={view === 'usage' ? 'page' : undefined}
                  onClick={() => chooseView('usage')}
                >
                  被谁使用<span className="cl-count">{mounts.length}</span>
                </button>
                <button
                  disabled={busy}
                  aria-current={view === 'trash' ? 'page' : undefined}
                  onClick={() => chooseView('trash')}
                >
                  回收站
                </button>
              </nav>
              {error && (
                <div className="cl-feedback cl-error" role="alert">
                  {error}
                </div>
              )}
              {notice && (
                <div className="cl-feedback" role="status">
                  {notice}
                </div>
              )}
              {view === 'usage' ? (
                <section className="cl-usage" aria-label="资料夹使用记录">
                  <h3>正在使用此资料夹</h3>
                  <p>
                    由使用方选择资料。需要调整资料或权限时，请前往对应的智能体、工作区或会话。
                  </p>
                  {loading ? (
                    <p role="status">正在读取使用记录…</p>
                  ) : mounts.length ? (
                    <table className="cl-table">
                      <thead>
                        <tr>
                          <th>使用位置</th>
                          <th>类型</th>
                          <th>访问权限</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mounts.map((mount) => (
                          <tr key={mount.id}>
                            <td>
                              <div className="cl-usage-name">
                                <PaimindConnectionIcon size={17} />
                                <strong>{usageTitle(mount)}</strong>
                              </div>
                            </td>
                            <td>
                              {
                                {
                                  agent: '智能体',
                                  workspace: '工作区',
                                  session: '会话',
                                }[mount.target.kind]
                              }
                            </td>
                            <td>
                              <span
                                className={
                                  'cl-access ' +
                                  (mount.mode === 'write'
                                    ? 'cl-access-write'
                                    : '')
                                }
                              >
                                {mount.mode === 'write' ? '读写' : '只读'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="cl-empty">
                      <PaimindConnectionIcon size={30} />
                      <h3>还没有被使用</h3>
                      <p>可以在智能体、工作区或会话中选择此资料夹。</p>
                    </div>
                  )}
                </section>
              ) : (
                <>
                  {view === 'files' && !document && (
                    <div className="cl-file-toolbar">
                      <form
                        className="cl-search"
                        role="search"
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (!canLeave()) return
                          setSubmittedQuery(query.trim())
                          setNotice('')
                        }}
                      >
                        <PaimindSearchIcon size={17} />
                        <input
                          type="search"
                          aria-label="搜索此资料夹"
                          placeholder="搜索文件名称、说明或正文"
                          value={query}
                          disabled={busy}
                          onChange={(event) => {
                            setQuery(event.target.value)
                            if (!event.target.value) setSubmittedQuery('')
                          }}
                        />
                        <button
                          type="submit"
                          className="cl-search-submit"
                          disabled={busy || !query.trim()}
                          aria-label="开始搜索"
                        >
                          搜索
                        </button>
                      </form>
                      <div className="cl-file-actions">
                        <LibraryMenu label="新建" disabled={busy}>
                          <button
                            role="menuitem"
                            onClick={() => {
                              void createEntry(false)
                            }}
                          >
                            新建文件
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              void createEntry(true)
                            }}
                          >
                            新建文件夹
                          </button>
                        </LibraryMenu>
                        <LibraryMenu label="上传" primary disabled={busy}>
                          <button
                            role="menuitem"
                            onClick={() => upload.current?.click()}
                          >
                            上传文件
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => folderUpload.current?.click()}
                          >
                            上传文件夹
                          </button>
                        </LibraryMenu>
                      </div>
                    </div>
                  )}
                  <input
                    aria-label="上传资料文件"
                    hidden
                    type="file"
                    multiple
                    ref={upload}
                    onChange={(event) => {
                      void uploadFiles(event.target.files)
                      event.target.value = ''
                    }}
                  />
                  <input
                    aria-label="上传资料文件夹"
                    hidden
                    type="file"
                    multiple
                    ref={folderUpload}
                    {...{ webkitdirectory: '' }}
                    onChange={(event) => {
                      void uploadFiles(event.target.files)
                      event.target.value = ''
                    }}
                  />
                  <div className="cl-location-row">
                    <nav className="cl-breadcrumbs" aria-label="文件路径">
                      {recycle ? (
                        <strong>回收站</strong>
                      ) : submittedQuery && !document ? (
                        <>
                          <button onClick={() => browse(path)}>全部文件</button>
                          <PaimindChevronRightIcon size={12} />
                          <strong>“{submittedQuery}”的搜索结果</strong>
                        </>
                      ) : (
                        <>
                          <button
                            disabled={busy || (!path && !document)}
                            onClick={() => browse('')}
                          >
                            全部文件
                          </button>
                          {path
                            .split('/')
                            .filter(Boolean)
                            .map((part, index, parts) => (
                              <span key={index}>
                                <PaimindChevronRightIcon size={12} />
                                <button
                                  disabled={
                                    busy ||
                                    (index === parts.length - 1 && !document)
                                  }
                                  onClick={() =>
                                    browse(parts.slice(0, index + 1).join('/'))
                                  }
                                >
                                  {part}
                                </button>
                              </span>
                            ))}
                          {document && (
                            <span>
                              <PaimindChevronRightIcon size={12} />
                              <strong>{document.entry.name}</strong>
                            </span>
                          )}
                        </>
                      )}
                    </nav>
                    {!document && (
                      <small>
                        {loading
                          ? '读取中…'
                          : (submittedQuery && !recycle
                              ? hits.length
                              : entries.length) + ' 项'}
                      </small>
                    )}
                  </div>
                  {recycle && (
                    <p className="cl-view-hint">
                      移入回收站的文件仍会保留，恢复后回到原来的位置。
                    </p>
                  )}
                  {document ? (
                    <section className="cl-document" aria-label="文件内容">
                      <header>
                        <div>
                          <h3>{document.entry.name}</h3>
                          <small>
                            {kindLabel(document.entry)} ·{' '}
                            {sizeLabel(document.entry.bytes)} ·{' '}
                            {dirty ? '有未保存修改' : '已保存'}
                          </small>
                        </div>
                        <div className="cl-document-actions">
                          <button
                            disabled={busy}
                            onClick={() => {
                              void act(() => download(document.entry))
                            }}
                          >
                            下载
                          </button>
                          {document.encoding === 'utf8' &&
                            document.nextOffset === null && (
                              <button
                                className="cl-primary"
                                disabled={busy || !dirty}
                                onClick={() => {
                                  void saveDocument()
                                }}
                              >
                                {busy ? '正在保存…' : '保存修改'}
                              </button>
                            )}
                          <button
                            className="cl-icon-button"
                            aria-label="关闭文件"
                            disabled={busy}
                            onClick={() => {
                              if (canLeave()) setDocument(null)
                            }}
                          >
                            <PaimindCloseIcon size={18} />
                          </button>
                        </div>
                      </header>
                      {document.encoding === 'utf8' ? (
                        <>
                          <label className="cl-document-description">
                            文件说明
                            <input
                              placeholder="添加简短说明，方便查找"
                              aria-label="文件说明"
                              value={fileDescription}
                              disabled={busy || document.nextOffset !== null}
                              onChange={(event) => {
                                setFileDescription(event.target.value)
                                remember(draft, event.target.value)
                              }}
                            />
                          </label>
                          <textarea
                            aria-label="资料正文"
                            spellCheck={false}
                            value={draft}
                            disabled={busy || document.nextOffset !== null}
                            onChange={(event) => {
                              setDraft(event.target.value)
                              remember(event.target.value, fileDescription)
                            }}
                          />
                          {document.nextOffset !== null && (
                            <p>大文件显示部分内容，请下载后编辑并重新上传。</p>
                          )}
                          {dirty && (
                            <footer>
                              <span>离开前请保存修改。</span>
                              <button
                                className="cl-subtle"
                                disabled={busy}
                                onClick={() => {
                                  forget()
                                  setDraft(document.content)
                                  setFileDescription(document.entry.description)
                                  setDraftRevision(document.entry.revision)
                                  setError('')
                                }}
                              >
                                放弃当前编辑
                              </button>
                            </footer>
                          )}
                        </>
                      ) : (
                        <div className="cl-binary">
                          {document.entry.contentType.startsWith('image/') &&
                          document.nextOffset === null ? (
                            <img
                              alt={document.entry.name}
                              src={
                                'data:' +
                                document.entry.contentType +
                                ';base64,' +
                                document.content
                              }
                            />
                          ) : (
                            <>
                              <PaimindAttachmentIcon size={36} />
                              <h3>此文件暂不支持在线预览</h3>
                              <p>原文件已保存，可以下载查看。</p>
                            </>
                          )}
                        </div>
                      )}
                    </section>
                  ) : loading ? (
                    <div className="cl-empty" role="status">
                      正在读取资料…
                    </div>
                  ) : submittedQuery && !recycle ? (
                    <div className="cl-results">
                      {hits.length ? (
                        hits.map((hit) => (
                          <button
                            className="cl-result"
                            key={hit.collectionId + ':' + hit.path}
                            disabled={busy}
                            onClick={() => {
                              if (!canLeave()) return
                              setPath(parentPath(hit.path))
                              setSubmittedQuery('')
                              setQuery('')
                              void act(() => read(hit.path))
                            }}
                          >
                            <PaimindAttachmentIcon size={20} />
                            <span>
                              <strong>{itemName(hit.path)}</strong>
                              <small>{hit.path}</small>
                              <p>{hit.snippet}</p>
                            </span>
                            <PaimindChevronRightIcon size={15} />
                          </button>
                        ))
                      ) : (
                        <div className="cl-empty">
                          <PaimindSearchIcon size={30} />
                          <h3>没有找到相关资料</h3>
                          <p>换一个文件名或正文关键词试试。</p>
                          <button onClick={() => browse(path)}>返回文件</button>
                        </div>
                      )}
                    </div>
                  ) : entries.length ? (
                    <table className="cl-table cl-file-table">
                      <thead>
                        <tr>
                          <th>名称</th>
                          <th className="cl-type-column">类型</th>
                          <th>大小</th>
                          <th>
                            <span className="cl-sr-only">操作</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry) => (
                          <tr key={entry.path}>
                            <td>
                              {recycle ? (
                                <div className="cl-filename">
                                  <PaimindTrashIcon size={19} />
                                  <span>
                                    <strong>{itemName(entry.name)}</strong>
                                    <small>原位置：{entry.name}</small>
                                  </span>
                                </div>
                              ) : (
                                <button
                                  className="cl-filename"
                                  aria-label={
                                    (entry.kind === 'directory'
                                      ? '打开文件夹：'
                                      : '打开文件：') + entry.name
                                  }
                                  disabled={busy}
                                  onClick={() => {
                                    if (entry.kind === 'directory')
                                      browse(entry.path)
                                    else void act(() => read(entry.path))
                                  }}
                                >
                                  {entry.kind === 'directory' ? (
                                    <PaimindTemplateIcon size={20} />
                                  ) : (
                                    <PaimindAttachmentIcon size={19} />
                                  )}
                                  <span>
                                    <strong>{entry.name}</strong>
                                    {entry.description && (
                                      <small>{entry.description}</small>
                                    )}
                                  </span>
                                </button>
                              )}
                            </td>
                            <td className="cl-type-column">
                              {recycle ? '已回收' : kindLabel(entry)}
                            </td>
                            <td>
                              {recycle || entry.kind === 'directory'
                                ? '—'
                                : sizeLabel(entry.bytes)}
                            </td>
                            <td className="cl-row-actions">
                              {recycle ? (
                                <button
                                  disabled={busy}
                                  onClick={() => {
                                    void act(async () => {
                                      await request({
                                        action: 'restore',
                                        collectionId: selected,
                                        path: entry.path,
                                        operationId: op(),
                                      })
                                      setNotice('文件已恢复到原位置')
                                    })
                                  }}
                                >
                                  恢复
                                </button>
                              ) : (
                                <LibraryMenu
                                  label={'更多操作：' + entry.name}
                                  icon={<PaimindMoreIcon size={19} />}
                                  disabled={busy}
                                >
                                  {entry.kind !== 'directory' && (
                                    <button
                                      role="menuitem"
                                      onClick={() => {
                                        void act(() => download(entry))
                                      }}
                                    >
                                      下载
                                    </button>
                                  )}
                                  <button
                                    role="menuitem"
                                    onClick={() => {
                                      void rename(entry)
                                    }}
                                  >
                                    重命名
                                  </button>
                                  <button
                                    role="menuitem"
                                    onClick={() => {
                                      if (canLeave()) setMoveEntry(entry)
                                    }}
                                  >
                                    移动
                                  </button>
                                  <button
                                    role="menuitem"
                                    className="cl-danger"
                                    onClick={() => {
                                      void trash(entry)
                                    }}
                                  >
                                    移入回收站
                                  </button>
                                </LibraryMenu>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="cl-empty">
                      {recycle ? (
                        <PaimindTrashIcon size={32} />
                      ) : (
                        <PaimindTemplateIcon size={32} />
                      )}
                      <h3>{recycle ? '回收站是空的' : '这里还没有文件'}</h3>
                      <p>
                        {recycle
                          ? '移入回收站的文件会显示在这里。'
                          : '上传已有资料，或新建一份文件。'}
                      </p>
                      {!recycle && (
                        <button
                          className="cl-primary"
                          onClick={() => upload.current?.click()}
                        >
                          <PaimindUploadIcon size={16} />
                          上传文件
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="cl-empty">
              {error && <p role="alert">{error}</p>}
              <PaimindTemplateIcon size={36} />
              <h2>{loading ? '正在读取资料库…' : '从一份资料开始'}</h2>
              <p>新建资料夹，用来保存同一主题的文件。</p>
              <button
                className="cl-primary"
                disabled={busy || loading}
                onClick={() => editCollection('new')}
              >
                新建资料夹
              </button>
            </div>
          )}
        </div>
      </div>
      {collectionDialog && (
        <LibraryDialog
          title={collectionDialog === 'new' ? '新建资料夹' : '编辑资料夹信息'}
          busy={busy}
          close={() => setCollectionDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void (async () => {
                const done = await act(async () => {
                  const r = await request(
                    collectionDialog === 'new'
                      ? {
                          action: 'createCollection',
                          title: newName.trim(),
                          description,
                        }
                      : {
                          action: 'updateCollection',
                          collectionId: selected,
                          title: newName.trim(),
                          description,
                          expectedRevision: current!.revision,
                        },
                  )
                  if (collectionDialog === 'new') {
                    setSelected(r.collection!.id)
                    setPath('')
                    setDocument(null)
                    setView('files')
                    setSubmittedQuery('')
                    setQuery('')
                  }
                })
                if (done) setCollectionDialog(null)
              })()
            }}
          >
            <label>
              名称
              <input
                aria-label="资料夹名称"
                placeholder="例如：产品资料、品牌素材"
                autoFocus
                maxLength={200}
                value={newName}
                disabled={busy}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label>
              <span>说明 <small>可选</small></span>
              <textarea
                aria-label="资料夹说明"
                placeholder="简要说明这里保存什么资料"
                maxLength={16000}
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCollectionDialog(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className="cl-primary"
                disabled={busy || !newName.trim()}
              >
                {busy
                  ? '正在保存…'
                  : collectionDialog === 'new'
                    ? '创建资料夹'
                    : '保存'}
              </button>
            </footer>
          </form>
        </LibraryDialog>
      )}
      {promptState && (
        <LibraryDialog
          title={promptState.title}
          close={() => finishPrompt(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              finishPrompt(promptState.value)
            }}
          >
            <label>
              {promptState.title}
              <input
                aria-label={promptState.title}
                autoFocus
                value={promptState.value}
                onChange={(event) =>
                  setPromptState({ ...promptState, value: event.target.value })
                }
              />
            </label>
            <footer>
              <button type="button" onClick={() => finishPrompt(null)}>
                取消
              </button>
              <button
                className="cl-primary"
                type="submit"
                disabled={!promptState.value.trim()}
              >
                确定
              </button>
            </footer>
          </form>
        </LibraryDialog>
      )}
      {moveEntry && (
        <MoveFileDialog
          api={api}
          collectionId={selected}
          entry={moveEntry}
          close={() => setMoveEntry(null)}
          move={(destination) =>
            act(async () => {
              await request({
                action: 'move',
                collectionId: selected,
                path: moveEntry.path,
                toPath: destination,
                expectedRevision: moveEntry.revision,
                operationId: op(),
              })
              setDocument(null)
              setNotice('文件已移动')
            })
          }
        />
      )}
    </section>
  )
}
