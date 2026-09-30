import { useEffect, useRef, useState } from 'react'
import type { HarnessRemoteResult } from '@paimind/harness-compat'
import type { SkillAdoptedContent, SkillAdoptedContentInput } from '../adopted-content.js'
import type { SkillPublicationAdoptionInput } from '../publication.js'
import type { SkillPackageEntry, SkillPackageDirectoryPage } from '../installer.js'

export type AdoptedContentReader = (input: SkillAdoptedContentInput) => Promise<HarnessRemoteResult<Readonly<SkillAdoptedContent>>>
const limit = 32768
const invalid = (): never => { throw new Error('已采用技能内容或版本回读不一致，请重新读取') }
const pathIsSafe = (path: unknown): path is string => typeof path === 'string' && path.length <= 500 && !/[\\\x00-\x1f\x7f]/u.test(path)
  && (path === '' || path.split('/').every(part => part && !['.', '..', '.paimind-install.json'].includes(part)))
const sameReference = (value: SkillPublicationAdoptionInput, reference: SkillPublicationAdoptionInput) => value
  && Object.keys(value).sort().join(',') === Object.keys(reference).sort().join(',')
  && Object.entries(reference).every(([key, expected]) => value[key as keyof typeof value] === expected)

/** Bounded current native read. Cancellation discards late replies even when
 * an old host transport does not support aborting its underlying RPC. */
export async function readCurrentAdoptedContent(read: AdoptedContentReader, input: SkillAdoptedContentInput, signal: AbortSignal): Promise<SkillAdoptedContent> {
  const abort = AbortSignal.any([signal, AbortSignal.timeout(35_000)])
  abort.throwIfAborted()
  let stop!: () => void
  try {
    const result = await Promise.race([read(input), new Promise<never>((_resolve, reject) => {
      stop = () => reject(abort.reason); abort.addEventListener('abort', stop, { once: true }); if (abort.aborted) stop()
    })])
    abort.throwIfAborted()
    if (!result?.ok) throw new Error(result && 'error' in result && result.error && typeof result.error === 'object' && 'message' in result.error
      ? String(result.error.message) : '原技能所有者未确认内容读取')
    const value = result.value
    if (!value || value.runtimeGrant !== false || !sameReference(value.reference, input.reference) || value.kind !== input.kind) return invalid()
    if (value.kind === 'directory' && input.kind === 'directory') {
      const page = value.page, offset = Number(input.cursor ?? '0'), prefix = input.path ? input.path + '/' : ''
      if (!page || page.path !== input.path || !pathIsSafe(page.path) || !Array.isArray(page.entries) || page.entries.length > 100
        || new Set(page.entries.map(row => row.path)).size !== page.entries.length) return invalid()
      for (const row of page.entries) {
        if (!pathIsSafe(row.path) || !row.path.startsWith(prefix) || row.path.slice(prefix.length) !== row.name || row.name.includes('/')
          || !['directory', 'text', 'binary'].includes(row.kind) || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > input.reference.expandedBytes
          || (row.kind === 'directory' ? row.size !== 0 : !/^sha256:[a-f0-9]{64}$/u.test(row.digest ?? ''))) return invalid()
      }
      if (page.nextCursor !== undefined && (page.entries.length !== 100 || page.nextCursor !== String(offset + 100)
        || Number(page.nextCursor) >= input.reference.entryCount)) return invalid()
    } else if (value.kind === 'file' && input.kind === 'file') {
      if (value.path !== input.path || !pathIsSafe(value.path) || value.offset !== input.offset || !Number.isSafeInteger(value.size)
        || value.size < 0 || value.size > input.reference.expandedBytes || (value.size === 0 ? value.offset !== 0 : value.offset >= value.size)
        || typeof value.data !== 'string' || value.data.length > 43692) return invalid()
      let decoded: string
      try { decoded = atob(value.data) } catch { return invalid() }
      const count = Math.min(limit, value.size - value.offset), next = value.offset + count
      if (decoded.length !== count || btoa(decoded) !== value.data || value.nextOffset !== (next < value.size ? next : null)) return invalid()
    } else return invalid()
    return value
  } finally { if (stop) abort.removeEventListener('abort', stop) }
}

function Bytes({ data, forceHex }: { data: string; forceHex: boolean }): JSX.Element {
  const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0))
  let text: string | undefined
  if (!forceHex && !bytes.includes(0)) try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { /* exact bytes remain visible below */ }
  const hex = text === undefined
  return <>{hex && <p>二进制或当前分块未构成完整 UTF-8 文本，按原始十六进制字节显示。</p>}
    <pre style={{ overflow: 'auto', maxHeight: '24rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text ?? [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(' ')}</pre>
    {!bytes.length && <p>空文件</p>}</>
}

function Content({ reference, read }: { reference: SkillPublicationAdoptionInput; read: AdoptedContentReader }): JSX.Element {
  const [request, setRequest] = useState<SkillAdoptedContentInput>({ reference, kind: 'directory', path: '' })
  const [page, setPage] = useState<SkillAdoptedContent>(), [error, setError] = useState<unknown>(), [reload, setReload] = useState(0)
  const [hex, setHex] = useState(false), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const abort = new AbortController(); setPage(undefined); setError(undefined)
    void readCurrentAdoptedContent(read, request, abort.signal).then(value => { if (!abort.signal.aborted) setPage(value) })
      .catch(error => { if (!abort.signal.aborted) { setPage(undefined); setError(error) } })
    return () => abort.abort()
  }, [read, request, reload])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setReload(value => value + 1) }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(() => { if (page) heading.current?.focus() }, [page])
  const directory = (path: string, cursor?: string) => setRequest({ reference, kind: 'directory', path, ...(cursor === undefined ? {} : { cursor }) })
  const file = (entry: Pick<SkillPackageEntry, 'path'>, offset = 0) => setRequest({ reference, kind: 'file', path: entry.path, offset })
  const directoryPage: SkillPackageDirectoryPage | undefined = page?.kind === 'directory' ? page.page : undefined
  return <div aria-label="已采用技能只读内容">
    {!!error ? <><p role="alert">{error instanceof Error ? error.message : '内容读取失败'}。旧文件内容已清除；不会修复或删除原文件。</p>
      <button type="button" data-paimind-skill-button onClick={() => directory('')}>重新读取根目录</button></>
      : !page ? <p role="status">正在核对当前分配与本地完整版本…</p> : <>
        <h3 ref={heading} tabIndex={-1}>{page.kind === 'file' ? page.path : page.page.path || '技能根目录'}</h3>
        <p>只读内容来自原技能中心已采用的实际文件，不是运行许可；不会启用、编辑或执行。</p>
        <button type="button" data-paimind-skill-button onClick={() => directory('')}>根目录</button>
        {page.kind === 'file' ? <>
          <button type="button" data-paimind-skill-button onClick={() => directory(page.path.split('/').slice(0, -1).join('/'))}>返回所在目录</button>
          <p>文件大小 {page.size} 字节；当前范围 {page.offset}–{page.offset + atob(page.data).length}</p>
          <label><input type="checkbox" checked={hex} onChange={event => setHex(event.currentTarget.checked)} />显示原始字节</label>
          <Bytes data={page.data} forceHex={hex} />
          <button type="button" data-paimind-skill-button disabled={page.offset === 0} onClick={() => file(page, Math.max(0, page.offset - limit))}>上一段</button>
          <button type="button" data-paimind-skill-button disabled={page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) file(page, page.nextOffset) }}>下一段</button>
        </> : directoryPage && <>
          {!!directoryPage.path && <button type="button" data-paimind-skill-button onClick={() => directory(directoryPage.path.split('/').slice(0, -1).join('/'))}>上级目录</button>}
          {!directoryPage.entries.length && <p>空目录</p>}
          <ul>{directoryPage.entries.map(entry => <li key={entry.path}><button type="button" data-paimind-skill-button
            onClick={() => entry.kind === 'directory' ? directory(entry.path) : file(entry)}>{entry.kind === 'directory' ? '目录' : '文件'} {entry.name}</button>
            <span> {entry.kind === 'directory' ? '' : `${entry.size} 字节`}</span></li>)}</ul>
          <button type="button" data-paimind-skill-button disabled={request.kind !== 'directory' || !request.cursor || request.cursor === '0'} onClick={() => {
            if (request.kind === 'directory') directory(directoryPage.path, String(Math.max(0, Number(request.cursor ?? '0') - 100)))
          }}>上一页目录</button>
          <button type="button" data-paimind-skill-button disabled={directoryPage.nextCursor === undefined} onClick={() => directory(directoryPage.path, directoryPage.nextCursor)}>下一页目录</button>
        </>}
      </>}
  </div>
}

export function InstalledSkillContent({ reference, read }: { reference: SkillPublicationAdoptionInput; read: AdoptedContentReader }): JSX.Element {
  const [open, setOpen] = useState(false), opener = useRef<HTMLButtonElement>(null)
  return <section aria-label="查看已采用技能" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); opener.current?.focus() }
  }}><button ref={opener} type="button" data-paimind-skill-button onClick={() => setOpen(value => !value)}>{open ? '收起只读内容' : '查看只读内容'}</button>
    {open && <Content reference={reference} read={read} />}</section>
}
