import { useEffect, useRef, useState } from 'react'
import type { EnterpriseApi } from './api.js'
type Version = { publicationId: string; revision: number; archiveDigest: string; entryCount: number }
type Entry = { index: number; path: string; kind: 'file' | 'directory'; size: number }
type Index = { kind: 'entries'; cursor: number; total: number; entries: Entry[]; nextCursor: number | null }
type FilePage = { kind: 'file'; entry: Entry; offset: number; data: string; nextOffset: number | null }
const PAGE = 32768, ROWS = 100
const invalid = (): never => { throw new Error('封存内容响应与所选版本不一致，请重新读取') }
const object = (v: unknown): Record<string, unknown> => !v || typeof v !== 'object' || Array.isArray(v) ? invalid() : v as Record<string, unknown>
const integer = (v: unknown, min: number, max: number): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : invalid()
function entry(input: unknown, total: number): Entry {
  const v = object(input), path = v.path
  if (typeof path !== 'string' || !path || path.length > 500 || /[\\\x00-\x1f\x7f]/u.test(path)
    || path.split('/').some(p => !p || p === '.' || p === '..' || p === '.paimind-install.json') || !['file', 'directory'].includes(String(v.kind))) return invalid()
  return { index: integer(v.index, 0, total - 1), path, kind: v.kind as Entry['kind'], size: integer(v.size, 0, v.kind === 'directory' ? 0 : 209715200) }
}
function payload(input: unknown, version: Version) {
  const v = object(input)
  if (v.publicationId !== version.publicationId || v.revision !== version.revision || v.archiveDigest !== version.archiveDigest || v.runtimeGrant !== false) return invalid()
  return object(v.content)
}
function readIndex(input: unknown, version: Version, cursor: number): Index {
  const v = payload(input, version), next = cursor + ROWS < version.entryCount ? cursor + ROWS : null
  if (v.kind !== 'entries' || v.cursor !== cursor || v.total !== version.entryCount || v.nextCursor !== next
    || !Array.isArray(v.entries) || v.entries.length !== Math.min(ROWS, version.entryCount - cursor)) return invalid()
  const entries = v.entries.map(x => entry(x, version.entryCount))
  if (entries.some((x, i) => x.index !== cursor + i) || new Set(entries.map(x => x.path)).size !== entries.length) return invalid()
  return { kind: 'entries', cursor, total: version.entryCount, entries, nextCursor: next }
}
function readFilePage(input: unknown, version: Version, selected: Entry, offset: number): FilePage {
  const v = payload(input, version), length = Math.min(PAGE, selected.size - offset), next = offset + length < selected.size ? offset + length : null
  if (v.kind !== 'file' || JSON.stringify(entry(v.entry, version.entryCount)) !== JSON.stringify(selected) || v.offset !== offset || v.nextOffset !== next
    || typeof v.data !== 'string' || v.data.length !== 4 * Math.ceil(length / 3)) return invalid()
  let bytes: string
  try { bytes = atob(v.data) } catch { return invalid() }
  if (bytes.length !== length || btoa(bytes) !== v.data) return invalid()
  return { kind: 'file', entry: selected, offset, data: v.data, nextOffset: next }
}
function display(data: string, hex: boolean) {
  const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0))
  if (!hex && !bytes.includes(0)) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), binary: false } } catch { /* Exact bytes remain available. */ }
  }
  return { text: Array.from({ length: Math.ceil(bytes.length / 16) }, (_, i) => Array.from(bytes.subarray(i * 16, i * 16 + 16), n => n.toString(16).padStart(2, '0')).join(' ')).join('\n'), binary: true }
}
/** Inert bounded projection of a pinned archive, never an HTML preview or an
 * editable copy. Parent identity changes unmount this request lifetime. */
function ContentBrowser({ api, publication, admin, disabled, onAvailabilityChange }: { api: EnterpriseApi; publication: Version; admin: boolean; disabled: boolean; onAvailabilityChange?: (ready: boolean) => void }) {
  const [cursor, setCursor] = useState(0), [index, setIndex] = useState<Index>(), [selected, setSelected] = useState<Entry>()
  const [offset, setOffset] = useState(0), [file, setFile] = useState<FilePage>(), [error, setError] = useState<unknown>()
  const [reload, setReload] = useState(0), [hex, setHex] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const rootPages = useRef(new Set<number>()), rootComplete = useRef(false)
  const prefix = `/${admin ? 'admin/skill-publications' : 'catalog/skills'}/${publication.publicationId}/content/${publication.revision}/${publication.archiveDigest.slice(7)}`
  useEffect(() => {
    const abort = new AbortController(); setIndex(undefined); setSelected(undefined); setFile(undefined); setError(undefined)
    void api.request(`${prefix}/entries/${cursor}`, 'GET', undefined, undefined, abort.signal).then(raw => readIndex(raw, publication, cursor))
      .then(value => { if (!abort.signal.aborted) setIndex(value) }).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, prefix, publication.entryCount, cursor, reload])
  useEffect(() => {
    const abort = new AbortController(); setFile(undefined); setError(undefined)
    if (selected) void api.request(`${prefix}/files/${selected.index}/${offset}`, 'GET', undefined, undefined, abort.signal)
      .then(raw => readFilePage(raw, publication, selected, offset)).then(value => {
        if (abort.signal.aborted) return
        if (value.entry.path === 'SKILL.md' && value.entry.size > 0) {
          rootPages.current.add(value.offset)
          rootComplete.current = rootPages.current.size === Math.ceil(value.entry.size / PAGE)
        }
        setFile(value)
      })
      .catch(failure => { if (!abort.signal.aborted) { setFile(undefined); setIndex(undefined); setError(failure) } })
    return () => abort.abort()
  }, [api, prefix, publication.entryCount, selected, offset])
  useEffect(() => { if (file) heading.current?.focus() }, [file])
  useEffect(() => {
    onAvailabilityChange?.(!!index && !!file && !error && rootComplete.current)
    return () => onAvailabilityChange?.(false)
  }, [index, file, error, onAvailabilityChange])
  const rendered = file ? display(file.data, hex) : undefined
  return <section aria-label="封存技能文件"><p>查看准确封存版本，不读取后来修改的源文件。脚本、网页和附件均不自动执行。</p>
    {!!error && <p role="alert">{error instanceof Error ? error.message : '内容不可读取'}；未确认完整查看。</p>}
    <button type="button" data-paimind-ui-button disabled={disabled} onClick={() => setReload(x => x + 1)}>重新读取封存内容</button>
    {!index && !error && <p role="status">正在读取封存文件目录…</p>}
    {index && <><p>目录条目 {cursor + 1}–{cursor + index.entries.length}，共 {index.total} 项；包含空目录和二进制。</p>
      <ul data-enterprise-list>{index.entries.map(row => <li key={row.index} data-enterprise-row>
        <span>{row.path}{row.kind === 'directory' ? ' /（目录）' : ` · ${row.size} 字节`}</span>
        {row.kind === 'file' && <button type="button" data-paimind-ui-button disabled={disabled} aria-pressed={selected?.index === row.index}
          onClick={() => { setSelected(row); setOffset(0); setHex(false) }}>查看文件 {row.path}</button>}
      </li>)}</ul>
      <button type="button" data-paimind-ui-button disabled={disabled || cursor === 0} onClick={() => setCursor(cursor - ROWS)}>上一页目录</button>
      <button type="button" data-paimind-ui-button disabled={disabled || index.nextCursor === null} onClick={() => setCursor(index.nextCursor!)}>下一页目录</button></>}
    {selected && !file && !error && <p role="status">正在读取所选文件…</p>}
    {file && rendered && <section aria-label={`文件内容 ${file.entry.path}`}><h4 tabIndex={-1} ref={heading}>{file.entry.path}</h4>
      <p>{file.entry.size === 0 ? '这是一个空文件。' : `字节范围 ${file.offset}–${file.offset + atob(file.data).length - 1}，共 ${file.entry.size} 字节。`}</p>
      <label data-enterprise-checkbox><input type="checkbox" checked={hex} disabled={disabled} onChange={event => setHex(event.currentTarget.checked)} />以十六进制核对原始字节</label>
      {rendered.binary && <p>当前分块为二进制或不是完整文本编码，显示原始字节；没有省略文件内容。</p>}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '24rem', overflow: 'auto' }}>{rendered.text}</pre>
      <button type="button" data-paimind-ui-button disabled={disabled || offset === 0} onClick={() => setOffset(offset - PAGE)}>上一段文件</button>
      <button type="button" data-paimind-ui-button disabled={disabled || file.nextOffset === null} onClick={() => setOffset(file.nextOffset!)}>下一段文件</button>
    </section>}
  </section>
}
export function PublicationContent({ api, publication, admin, disabled = false, onAvailabilityChange }: { api: EnterpriseApi; publication: Version; admin: boolean; disabled?: boolean; onAvailabilityChange?: (ready: boolean) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  return <div><button type="button" data-paimind-ui-button disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '关闭封存内容' : '查看封存内容'}</button>
    {open && <ContentBrowser key={`${publication.publicationId}:${publication.revision}:${publication.archiveDigest}`} api={api} publication={publication} admin={admin} disabled={disabled} {...(onAvailabilityChange ? { onAvailabilityChange } : {})} />}</div>
}
