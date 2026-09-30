import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { AdoptedSkillSelection, SkillCenterContribution, SkillCenterPanelProps } from '@paimind/skill-market/client'
import { ApiFailure, EnterpriseSession, type AccountView, type EnterpriseApi } from './api.js'
import { PublicationContent } from './skill-content.js'
import { createSkillSourceAction } from './skill-submit.js'

export interface SkillPublicationView {
  publicationId: string; artifactId: string; sourceUserId: string; name: string; digest: string; status: 'pending' | 'published' | 'rejected' | 'withdrawn'; revision: number;
  submissionReason: string; reviewReason: string | null; archiveDigest: string; archiveBytes: number; expandedBytes: number; entryCount: number
}
const invalid = (): never => { throw new Error('企业技能版本或采用响应不完整，请重新读取') }
const object = (value: unknown): Record<string, unknown> => !value || typeof value !== 'object' || Array.isArray(value) ? invalid() : value as Record<string, unknown>
const text = (value: unknown, min: number, max: number): string => typeof value === 'string' && value.length >= min && value.length <= max ? value : invalid()
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value) ? value : invalid()
const digest = (value: unknown) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value) ? value : invalid()
const integer = (value: unknown, max: number, min = 1): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid()
export function skillPublication(input: unknown): SkillPublicationView {
  const row = object(input), name = text(row.name, 1, 255)
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(name) || !['pending', 'published', 'rejected', 'withdrawn'].includes(String(row.status)) || row.runtimeGrant !== false) return invalid()
  return { publicationId: uuid(row.publicationId), artifactId: uuid(row.artifactId), sourceUserId: uuid(row.sourceUserId), name,
    digest: digest(row.digest), status: row.status as SkillPublicationView['status'], revision: integer(row.revision, 2_147_483_647),
    submissionReason: text(row.submissionReason, 3, 500), reviewReason: row.reviewReason === null ? null : text(row.reviewReason, 3, 500),
    archiveDigest: digest(row.archiveDigest), archiveBytes: integer(row.archiveBytes, 216 * 1024 ** 2),
    expandedBytes: integer(row.expandedBytes, 200 * 1024 ** 2), entryCount: integer(row.entryCount, 10_000) }
}
type AssignedSkill = SkillPublicationView & { status: 'published' }
export function assignedSkill(input: unknown): AssignedSkill {
  const row = object(input), view = skillPublication(input)
  if (view.status !== 'published' || !['user-allow', 'group-allow', 'all-allow'].includes(String(row.access))) return invalid()
  return { ...view, status: 'published' }
}
export function assignedSkills(input: unknown): AssignedSkill[] {
  if (!Array.isArray(input) || input.length > 1000) return invalid()
  const rows = input.map(assignedSkill)
  if (new Set(rows.map(row => row.publicationId)).size !== rows.length) return invalid()
  return rows
}
export function adoptedSkillReference(input: unknown, selected: AssignedSkill, account: AccountView): AdoptedSkillSelection {
  const row = object(input)
  if (Object.keys(row).sort().join(',') !== 'adoptedAt,archiveBytes,archiveDigest,entryCount,expandedBytes,name,packageDigest,publicationId,runtimeGrant,schema,sourceUserId,tenantId'
    || row.schema !== 'paimind.skill-adoption/v1' || row.runtimeGrant !== false || row.tenantId !== account.tenantId
    || row.publicationId !== selected.publicationId || row.sourceUserId !== selected.sourceUserId || row.name !== selected.name
    || row.packageDigest !== selected.digest || row.archiveDigest !== selected.archiveDigest || row.archiveBytes !== selected.archiveBytes
    || row.expandedBytes !== selected.expandedBytes || row.entryCount !== selected.entryCount) return invalid()
  integer(row.adoptedAt, Number.MAX_SAFE_INTEGER, 0)
  return { publicationId: selected.publicationId, name: selected.name, packageDigest: selected.digest, archiveDigest: selected.archiveDigest }
}
const same = (left: AssignedSkill, right: AssignedSkill) => JSON.stringify(left) === JSON.stringify(right)

/** This catalog never enables a Skill or writes native files itself. */
export function MemberSkillCatalog({ api, account, showAdoptedSkill, onEditing, registerCloseGuard }: SkillCenterPanelProps & {
  api: EnterpriseApi; account: AccountView }): JSX.Element {
  const [rows, setRows] = useState<AssignedSkill[]>(), [selected, setSelected] = useState<AssignedSkill>(), [detail, setDetail] = useState<AssignedSkill>()
  const [query, setQuery] = useState(''), [reload, setReload] = useState(0), [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState('')
  const locked = useRef(false), lifetime = useRef<AbortController>(), attempt = useRef<{ signature: string; key: string }>()
  const operation = useRef<AbortController>()
  const opener = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLHeadingElement>(null), failure = useRef<HTMLParagraphElement>(null)
  const editing = !!selected || busy, editingRef = useRef(editing), refreshPending = useRef(false); editingRef.current = editing
  useEffect(() => { onEditing?.(editing); return () => onEditing?.(false) }, [editing, onEditing])
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    const off = registerCloseGuard?.(() => !locked.current && (!editingRef.current || window.confirm('取消本次技能采用确认？原技能和历史不会被删除。')))
    const unload = (event: BeforeUnloadEvent) => { if (locked.current) { event.preventDefault(); event.returnValue = '' } }
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      if (editingRef.current) refreshPending.current = true; else setReload(value => value + 1)
    }
    window.addEventListener('beforeunload', unload); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { abort.abort(); off?.(); window.removeEventListener('beforeunload', unload); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [registerCloseGuard])
  useEffect(() => { if (!editing && refreshPending.current) { refreshPending.current = false; setReload(value => value + 1) } }, [editing])
  useEffect(() => {
    const abort = new AbortController(); setRows(undefined); setSelected(undefined); setDetail(undefined); setError(undefined)
    void api.request('/catalog/skills', 'GET', undefined, undefined, abort.signal).then(assignedSkills)
      .then(rows => { if (!abort.signal.aborted) setRows(rows) }).catch(error => { if (!abort.signal.aborted) setError(error) })
    return () => abort.abort()
  }, [api, reload])
  useEffect(() => {
    const abort = new AbortController(); setDetail(undefined); setConfirmed(false)
    if (selected) void api.request(`/catalog/skills/${selected.publicationId}`, 'GET', undefined, undefined, abort.signal).then(assignedSkill)
      .then(row => {
        if (!same(row, selected)) throw new Error('技能版本或分配已变化，请重新读取目录')
        if (!abort.signal.aborted) setDetail(row)
      }).catch(error => { if (!abort.signal.aborted) setError(error) })
    return () => abort.abort()
  }, [api, selected])
  useEffect(() => { if (detail) heading.current?.focus() }, [detail])
  useEffect(() => { if (error) failure.current?.focus() }, [error])
  const cancel = () => { if (locked.current) return; setSelected(undefined); setDetail(undefined); setError(undefined); queueMicrotask(() => opener.current?.focus()) }
  const adopt = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail || !confirmed || locked.current || !showAdoptedSkill || !lifetime.current || lifetime.current.signal.aborted) return
    const ownerSignal = lifetime.current.signal, abort = new AbortController(); operation.current = abort
    const signal = AbortSignal.any([ownerSignal, abort.signal])
    locked.current = true; setBusy(true); setError(undefined); setMessage('')
    const body = { expectedRevision: detail.revision, expectedDigest: detail.digest }
    const path = `/catalog/skills/${detail.publicationId}/adoption`, signature = JSON.stringify([path, body])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    try {
      const current = assignedSkill(await api.request(`/catalog/skills/${detail.publicationId}`, 'GET', undefined, undefined, signal))
      signal.throwIfAborted()
      if (!same(current, detail)) throw new Error('技能版本或分配已变化，请重新读取目录')
      const input = await api.request(path, 'POST', body, attempt.current.key, signal)
      signal.throwIfAborted()
      await showAdoptedSkill(adoptedSkillReference(input, detail, account), signal)
      if (!signal.aborted) { setSelected(undefined); setMessage('原生技能版本已回读；尚未自动启用或加入任何会话。') }
    } catch (error) {
      if (!ownerSignal.aborted) {
        setError(error)
        if (error instanceof ApiFailure && [401, 403, 404].includes(error.status)) { setRows(undefined); setSelected(undefined); setDetail(undefined) }
      }
    } finally { locked.current = false; if (operation.current === abort) operation.current = undefined; if (!ownerSignal.aborted) setBusy(false) }
  }
  const filtered = rows?.filter(row => row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section data-paimind-enterprise data-paimind-ui-scope="enterprise-skill-catalog" aria-label="企业分配的技能" onKeyDown={event => {
    if (event.key === 'Escape' && selected) { event.preventDefault(); event.stopPropagation(); cancel() }
  }}><header data-enterprise-toolbar><div><h2>企业分配的技能</h2><p>仅展示当前明确分配的固定版本。管理员或作者身份不会自动获得使用权限。</p></div>
    <button data-paimind-ui-button disabled={editing} onClick={() => { setReload(value => value + 1); setMessage('') }}>重新读取技能目录</button></header>
    <label>搜索企业技能<input type="search" disabled={editing} value={query} onChange={event => setQuery(event.currentTarget.value)} /></label>
    {!!error && <p ref={failure} tabIndex={-1} role="alert">{error instanceof Error ? error.message : '读取或采用未确认'}。保留原资源；未知结果请重试原操作。</p>}
    {message && <p role="status">{message}</p>}
    {rows === undefined ? !error && <p role="status">正在读取当前技能分配…</p> : <><p role="status">{filtered!.length} 个结果</p>
      {!filtered!.length ? <p>{query.trim() ? '没有匹配结果，请调整搜索。' : '当前没有分配给你的企业技能。'}</p>
        : <ul data-enterprise-list>{filtered!.map(row => <li key={row.publicationId} data-enterprise-row><div><h3>{row.name}</h3><p>固定目录版本：{row.digest}</p></div>
          <button data-paimind-ui-button disabled={editing} aria-label={`查看企业技能 ${row.name}`} onClick={event => {
            opener.current = event.currentTarget; setError(undefined); setMessage(''); setSelected(row)
          }}>查看并采用</button></li>)}</ul>}</>}
    {selected && <div data-enterprise-form>{detail ? <form aria-label={`采用企业技能 ${detail.name}`} onSubmit={event => { void adopt(event) }}>
      <h3 ref={heading} tabIndex={-1}>{detail.name} · 固定企业版本</h3><p>发布：{detail.publicationId}</p><p>目录摘要：{detail.digest}</p><p>归档摘要：{detail.archiveDigest}</p>
      <p>{detail.entryCount} 个条目 · 归档 {detail.archiveBytes} 字节 · 展开 {detail.expandedBytes} 字节</p><p>审核反馈：{detail.reviewReason ?? '未提供'}</p>
      <PublicationContent api={api} publication={detail} admin={false} disabled={busy} />
      <p>采用不会运行脚本、启用技能或改变会话范围；已有同名个人技能或其他发布版本时会拒绝覆盖。</p>
      <label data-enterprise-checkbox><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我确认采用这个固定企业版本，并保留现有个人内容和历史</label>
      <button data-paimind-ui-button type="submit" disabled={busy || !confirmed || !showAdoptedSkill}>{busy ? '正在采用并回读原生版本…' : '确认采用并查看已安装技能'}</button>
      {busy && <><p role="status">完整包传输最多等待 5 分钟；停止等待或登录失效不会删除已经写入的原生内容。</p>
        <button type="button" data-paimind-ui-button onClick={() => operation.current?.abort(new Error('已停止等待，实际采用结果可能尚未确认；重试会复用原命令'))}>停止等待</button></>}
      {!showAdoptedSkill && <p>原技能中心未连接，不能确认采用及已安装版本。</p>}
    </form> : !error && <p role="status">正在核对准确技能版本…</p>}
      <button data-paimind-ui-button disabled={busy} onClick={cancel}>取消采用</button></div>}
  </section>
}

export function createSkillCenterContribution(session: EnterpriseSession): SkillCenterContribution {
  return { id: 'enterprise', zh: '企业分配的', en: 'Assigned by enterprise', SourceAction: createSkillSourceAction(session), Panel: props => {
    const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
    return view.status === 'ready' ? <MemberSkillCatalog key={`${view.account.tenantId}:${view.account.userId}`}
      {...props} api={session.api} account={view.account} /> : <div><p role="status">{view.status === 'signed-out' ? '登录已失效，企业技能内容已清除。'
        : view.status === 'unavailable' ? '企业服务暂时不可用，旧技能内容已清除。' : '正在验证企业账户…'}</p>
      <button data-paimind-ui-button onClick={() => { void session.refresh() }}>重新验证账户</button></div>
  } }
}
