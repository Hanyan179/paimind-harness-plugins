import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  PaimindCloseIcon,
  PaimindChevronDownIcon,
  PaimindTemplateIcon,
} from '@hansen/harness-compat/client-icons'
import { contextResult, type ContextRemoteApi } from './api.js'
import type { ContextEntry } from '../contract.js'

export function LibraryDialog({
  title,
  children,
  close,
  busy = false,
}: {
  title: string
  children: ReactNode
  close: () => void
  busy?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector<HTMLElement>('input, textarea')?.focus()
  }, [])
  return (
    <dialog
      role="dialog"
      className="cl-dialog"
      data-paimind-ui-scope
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) close()
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="cl-icon-button"
          aria-label="关闭对话框"
          disabled={busy}
          onClick={close}
        >
          <PaimindCloseIcon size={18} />
        </button>
      </header>
      {children}
    </dialog>
  )
}

export function LibraryMenu({
  label,
  icon,
  children,
  primary = false,
  disabled = false,
}: {
  label: string
  icon?: ReactNode
  children: ReactNode
  primary?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const close = (focus = false) => {
    setPosition(null)
    if (focus) trigger.current?.focus()
  }
  useEffect(() => {
    if (!position) return
    popup.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus()
    const outside = (event: PointerEvent) => {
      if (
        !popup.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close()
    }
    const hide = () => close()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [position])
  return (
    <>
      <button
        ref={trigger}
        className={primary ? 'cl-primary' : icon ? 'cl-icon-button' : ''}
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        onClick={() => {
          if (position) return close()
          const rect = trigger.current!.getBoundingClientRect()
          setPosition({
            left: Math.max(
              12,
              Math.min(rect.right - 196, window.innerWidth - 208),
            ),
            top: Math.max(
              12,
              Math.min(rect.bottom + 6, window.innerHeight - 220),
            ),
          })
        }}
      >
        {icon ?? (
          <>
            {label}
            <PaimindChevronDownIcon size={14} />
          </>
        )}
      </button>
      {position && (
        <div
          ref={popup}
          role="menu"
          aria-label={label}
          className="cl-menu"
          data-paimind-ui-scope
          style={position}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) close(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close(true)
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const items = [
                ...popup.current!.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ),
              ]
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              )
              items[
                (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                  items.length
              ]?.focus()
            }
          }}
        >
          {children}
        </div>
      )}
    </>
  )
}

export function MoveFileDialog({
  api,
  collectionId,
  entry,
  close,
  move,
}: {
  api: ContextRemoteApi
  collectionId: string
  entry: ContextEntry
  close: () => void
  move: (path: string) => Promise<boolean>
}): React.JSX.Element {
  const [path, setPath] = useState(''),
    [folders, setFolders] = useState<ContextEntry[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    void contextResult(api, { action: 'list', collectionId, path })
      .then((r) => {
        if (live)
          setFolders(
            (r.entries ?? []).filter(
              (e) => e.kind === 'directory' && e.path !== entry.path,
            ),
          )
      })
      .catch((e) => {
        if (live) setError(String(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [api, collectionId, path, entry.path])
  const destination = path ? path + '/' + entry.name : entry.name
  return (
    <LibraryDialog title={'移动“' + entry.name + '”'} close={close} busy={busy}>
      <p>选择目标文件夹。</p>
      <nav className="cl-move-path" aria-label="目标文件夹">
        <button
          disabled={!path || busy}
          onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}
        >
          上一级
        </button>
        <span>{path || '全部文件'}</span>
      </nav>
      {error && <p role="alert">{error}</p>}
      <div className="cl-folder-picker">
        {loading ? (
          <p role="status">正在读取文件夹…</p>
        ) : folders.length ? (
          folders.map((folder) => (
            <button
              key={folder.path}
              disabled={busy}
              onClick={() => setPath(folder.path)}
            >
              <PaimindTemplateIcon size={18} />
              {folder.name}
            </button>
          ))
        ) : (
          <p>这里没有子文件夹。</p>
        )}
      </div>
      <footer>
        <button disabled={busy} onClick={close}>
          取消
        </button>
        <button
          className="cl-primary"
          disabled={
            busy || loading || Boolean(error) || destination === entry.path
          }
          onClick={async () => {
            setBusy(true)
            try {
              if (await move(destination)) close()
              else setError('未能移动，请检查页面提示后重试。')
            } finally {
              setBusy(false)
            }
          }}
        >
          移动到此处
        </button>
      </footer>
    </LibraryDialog>
  )
}
