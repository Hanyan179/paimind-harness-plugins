import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { AgentCenterContribution, AgentCenterPanelProps, AgentCenterPersonalActionProps } from '@paimind/agent-market/client'
import { EnterpriseSession, type AccountView, type EnterpriseApi } from './api.js'
import { adoptedPublicationPreset, publicationDetail, publicationView, publicationViews, type PublicationDetail, type PublicationView } from './publication-view.js'

const statuses = { pending: '待审核', published: '已发布', rejected: '已拒绝', withdrawn: '已下架' }
const grants = ['user-allow', 'group-allow', 'all-allow'] as const
type GrantedPublication = PublicationView & { access: typeof grants[number] }
export function assignedPublications(input: unknown): GrantedPublication[] {
  const views = publicationViews(input)
  return views.map((view, index) => {
    const access: unknown = (input as Record<string, unknown>[])[index]?.access
    if (view.status !== 'published' || !grants.includes(access as typeof grants[number])) throw new Error('企业分配目录响应无效，请重新读取')
    return { ...view, access: access as typeof grants[number] }
  })
}
const samePublication = (left: PublicationView, right: PublicationView) => left.publicationId === right.publicationId
  && left.sourceUserId === right.sourceUserId && left.presetId === right.presetId && left.configVersion === right.configVersion
  && left.digest === right.digest && left.revision === right.revision && left.status === right.status

function Detail({ value, assigned }: { value: PublicationDetail; assigned: boolean }): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [value])
  return <section aria-label="企业智能体详情"><h3 ref={heading} tabIndex={-1}>{value.name} · {statuses[value.status]}</h3>
    <p>{assigned ? '来自当前企业分配目录。内容只读，不能改写他人的来源智能体。' : '这是你的提交审核副本，不代表你已经获得企业运行授权。'}</p>
    <p>配置版本：{value.configVersion}</p><p>内容摘要：{value.digest}</p>
    <p data-enterprise-source>角色：{value.profile.role}</p><p data-enterprise-source>目标：{value.profile.goal}</p>
    <p data-enterprise-source>行为：{value.profile.behavior}</p><p data-enterprise-source>补充要求：{value.profile.instructions || '无'}</p>
    <p>提交原因：{value.submissionReason}</p><p>审核反馈：{value.reviewReason ?? '等待管理员审核'}</p>
    <p>技能依赖：{value.dependencies.length === 0 ? '无' : value.dependencies.map(ref => `${ref.name} · ${ref.digest}`).join('；')}</p>
    {value.skillPublications.length > 0 && <><p>先获得以下技能的分配并采用准确发布版本，再采用此智能体；此操作不会代你启用或升级技能。</p>
      <ul>{value.skillPublications.map(ref => <li key={ref.name}>{ref.name} · 技能发布 {ref.publicationId}</li>)}</ul></>}
  </section>
}

function UseAssignedAgent({ api, value, prepareConversation, returnToConversation, onEditing, registerCloseGuard }: AgentCenterPanelProps & {
  api: EnterpriseApi; value: PublicationDetail }): JSX.Element {
  const [confirming, setConfirming] = useState(false), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [adopted, setAdopted] = useState(false), [ready, setReady] = useState(false)
  const [error, setError] = useState<unknown>()
  const lifetime = useRef<AbortController>(), locked = useRef(false), attempt = useRef<string>()
  const opener = useRef<HTMLButtonElement>(null), confirmation = useRef<HTMLInputElement>(null), failure = useRef<HTMLParagraphElement>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    const off = registerCloseGuard?.(() => !locked.current)
    const beforeUnload = (event: BeforeUnloadEvent) => { if (locked.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { abort.abort(); off?.(); window.removeEventListener('beforeunload', beforeUnload) }
  }, [registerCloseGuard])
  useEffect(() => { onEditing?.(confirming || busy); return () => onEditing?.(false) }, [confirming, busy, onEditing])
  useEffect(() => { if (confirming) confirmation.current?.focus() }, [confirming])
  useEffect(() => { if (error) failure.current?.focus() }, [error])
  useEffect(() => { if (adopted && !busy && !error) startButton.current?.focus() }, [adopted, busy, error])
  const cancel = () => {
    if (locked.current) return
    setConfirming(false); setConfirmed(false); setError(undefined); queueMicrotask(() => opener.current?.focus())
  }
  const command = async (start: boolean) => {
    if (locked.current || !lifetime.current || lifetime.current.signal.aborted || !start && !confirmed
      || start && (!adopted || !prepareConversation || !returnToConversation)) return
    const signal = lifetime.current.signal
    locked.current = true; setBusy(true); setError(undefined); setReady(false)
    let opened = false
    try {
      // Recheck one current assigned snapshot, never an author's review copy.
      // Replay of the same command also verifies the native immutable bytes.
      const current = publicationDetail(await api.request(`/catalog/agents/${value.publicationId}`, 'GET', undefined, undefined, signal), grants)
      signal.throwIfAborted()
      if (!samePublication(value, current)) throw new Error('发布版本或归属已变化，请重新读取目录')
      attempt.current ??= crypto.randomUUID()
      const receipt = await api.request(`/publications/${value.publicationId}/adopt`, 'POST',
        { expectedRevision: value.revision, expectedDigest: value.digest }, attempt.current, signal)
      signal.throwIfAborted()
      const presetId = adoptedPublicationPreset(receipt, value)
      setAdopted(true); setConfirming(false); setConfirmed(false)
      if (start) {
        const sessionId = await prepareConversation!(presetId, signal)
        signal.throwIfAborted()
        if (typeof sessionId !== 'string' || !sessionId) throw new Error('原生对话准备结果未确认')
        setReady(true); opened = true
      }
    } catch (cause) { if (!signal.aborted) setError(cause) }
    finally {
      locked.current = false
      if (!signal.aborted) setBusy(false)
    }
    if (opened && !signal.aborted) { onEditing?.(false); returnToConversation?.() }
  }
  return <section aria-label="使用企业智能体" onKeyDown={event => {
    if (event.key === 'Escape' && (confirming || locked.current)) { event.preventDefault(); event.stopPropagation(); cancel() }
  }}>
    <p>采用后仍归类为“企业分配的”，不会变成个人可编辑智能体，也不会自动安装或启用依赖技能。采用记录不等于运行许可。</p>
    <p>开始对话会选择当前工作区的原生空白对话，保留已有输入草稿，不自动发送消息。历史对话保持原智能体；每次实际发送仍检查当前权限。</p>
    {!adopted && <button ref={opener} data-paimind-ui-button disabled={confirming || busy} onClick={() => {
      setConfirming(true); setConfirmed(false); setError(undefined)
    }}>采用企业版本</button>}
    {confirming && <form aria-label={`采用 ${value.name}`} onSubmit={event => { event.preventDefault(); void command(false) }}>
      <label data-enterprise-checkbox><input ref={confirmation} type="checkbox" disabled={busy} checked={confirmed}
        onChange={event => setConfirmed(event.currentTarget.checked)} />我确认采用当前显示的企业版本，保留个人智能体和历史内容</label>
      <div data-enterprise-actions><button type="button" data-paimind-ui-button disabled={busy} onClick={cancel}>取消采用</button>
        <button type="submit" data-paimind-ui-button disabled={busy || !confirmed}>{busy ? '正在核对并采用…' : '确认采用'}</button></div>
    </form>}
    {adopted && <p role="status">已确认采用记录；开始前会再次核对当前分配和原生版本。</p>}
    <button ref={startButton} data-paimind-ui-button disabled={!adopted || busy || !prepareConversation || !returnToConversation}
      onClick={() => { void command(true) }}>{busy && adopted ? '正在准备原生对话…' : '开始对话'}</button>
    {(!prepareConversation || !returnToConversation) && <p>原生对话入口尚不可用；请先恢复智能体中心与宿主连接。</p>}
    {ready && <p role="status">原生对话已准备，尚未发送消息；可从宿主返回对话入口查看。</p>}
    {!!error && <p ref={failure} tabIndex={-1} role="alert">{error instanceof Error ? error.message : '操作未确认，请重试'}。原资源不会被删除；采用结果不明确时，重试会复用本次命令。</p>}
  </section>
}

/** Authenticated on-demand projections and explicit owner commands. No model call. */
export function MemberPublicationCatalog({ api, account, mode, query, onEditing, ...actions }: AgentCenterPanelProps & {
  api: EnterpriseApi; account: AccountView; mode: 'assigned' | 'submitted' }): JSX.Element {
  const [rows, setRows] = useState<PublicationView[]>()
  const [error, setError] = useState<unknown>()
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<PublicationView>()
  const [detail, setDetail] = useState<PublicationDetail>()
  const [detailError, setDetailError] = useState<unknown>()
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const [editing, setEditing] = useState(false), editingRef = useRef(false), deferredRefresh = useRef(false)
  const updateEditing = useCallback((value: boolean) => {
    editingRef.current = value; setEditing(value); onEditing?.(value)
  }, [onEditing])
  const title = mode === 'assigned' ? '企业分配的' : '我的提交记录'
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      if (editingRef.current) deferredRefresh.current = true; else setReload(value => value + 1)
    }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(() => {
    if (!editing && deferredRefresh.current) { deferredRefresh.current = false; setReload(value => value + 1) }
  }, [editing])
  useEffect(() => {
    const abort = new AbortController()
    setRows(undefined); setError(undefined); setSelected(undefined); setDetail(undefined); setDetailError(undefined)
    void api.request(mode === 'assigned' ? '/catalog/agents' : '/publications', 'GET', undefined, undefined, abort.signal)
      .then(input => {
        const next = mode === 'assigned' ? assignedPublications(input) : publicationViews(input)
        if (mode === 'submitted' && next.some(row => row.sourceUserId !== account.userId)) throw new Error('提交记录归属不一致，已停止显示')
        if (!abort.signal.aborted) setRows(next)
      }).catch(failure => { if (!abort.signal.aborted) setError(failure) })
    return () => abort.abort()
  }, [api, account.userId, account.tenantId, mode, reload])
  useEffect(() => {
    const abort = new AbortController()
    setDetail(undefined); setDetailError(undefined)
    if (selected) void (async () => {
      // Permission and immutable content must come from the same server-side
      // read. A review copy is never accepted as assigned content, even for
      // its author or an administrator; do not fall back to that endpoint.
      const path = `${mode === 'assigned' ? '/catalog/agents' : '/publications'}/${selected.publicationId}`
      const value = publicationDetail(await api.request(path, 'GET', undefined, undefined, abort.signal),
        mode === 'assigned' ? grants : ['review-copy'])
      if (!samePublication(value, selected) || mode === 'submitted' && value.sourceUserId !== account.userId) throw new Error('发布版本或归属已变化，请重新读取目录')
      if (!abort.signal.aborted) setDetail(value)
    })().catch(failure => { if (!abort.signal.aborted) setDetailError(failure) })
    return () => abort.abort()
  }, [api, selected, mode, account.userId])
  const filtered = rows?.filter(row => `${row.name}\n${row.description}\n${row.configVersion}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section data-paimind-enterprise data-paimind-ui-scope="enterprise-agent-catalog" aria-label={title}>
    <header data-enterprise-toolbar><div><h2>{title}</h2><p>{mode === 'assigned' ? '只展示当前明确分配给你的已发布版本；管理员身份和作者身份不会自动获得分配。'
      : `${account.displayName} 的提交历史。个人配置继续在“我创建的”里管理，提交不等于批准或分配。`}</p></div>
      <button data-paimind-ui-button disabled={editing} onClick={() => setReload(value => value + 1)}>重新读取目录</button></header>
    {error ? <p role="alert">{error instanceof Error ? error.message : '企业服务不可用，请重试'}</p> : rows === undefined ? <p role="status">正在读取{title}…</p>
      : <><p role="status">{filtered!.length} 个结果</p>{filtered!.length === 0 ? <p>{query.trim() ? '没有匹配结果，请调整或清空搜索。'
        : mode === 'assigned' ? '当前没有分配给你的企业智能体。' : '还没有提交记录；从自己的个人智能体卡片发起审核。'}</p>
        : <ul data-enterprise-list>{filtered!.map(row => <li key={row.publicationId} data-enterprise-row><div><h3>{row.name}</h3><p>{row.description}</p>
          <p>{statuses[row.status]} · {row.configVersion}</p></div><button data-paimind-ui-button disabled={editing} onClick={event => { detailOpener.current = event.currentTarget; setSelected(row) }} aria-label={`查看企业版本 ${row.name}`}>查看版本</button></li>)}</ul>}</>}
    {selected && <div data-enterprise-form>{detailError ? <p role="alert">{detailError instanceof Error ? detailError.message : '详情读取失败'}</p>
      : detail ? <><Detail value={detail} assigned={mode === 'assigned'} />{mode === 'assigned' && <UseAssignedAgent
        key={`${detail.publicationId}:${detail.revision}:${detail.digest}`} api={api} value={detail} query={query} {...actions} onEditing={updateEditing} />}</>
        : <p role="status">正在核对企业版本…</p>}
      <button data-paimind-ui-button disabled={editing} onClick={() => { setSelected(undefined); detailOpener.current?.focus() }}>收起详情</button></div>}
  </section>
}

export function SubmitPersonalAgent({ api, account, selection, disabled, onEditing, registerCloseGuard }: AgentCenterPersonalActionProps & {
  api: EnterpriseApi; account: AccountView }): JSX.Element {
  const [target, setTarget] = useState<AgentCenterPersonalActionProps['selection']>()
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(), [message, setMessage] = useState('')
  const opener = useRef<HTMLButtonElement>(null), reasonInput = useRef<HTMLTextAreaElement>(null)
  const attempt = useRef<{ signature: string; key: string }>(), locked = useRef(false), lifetime = useRef<AbortController>()
  const dirty = useRef(false); dirty.current = !!(reason || confirmed)
  const guard = useRef<() => boolean>(() => true)
  guard.current = () => !locked.current && (!(reason || confirmed) || window.confirm('提交理由尚未发送，确定放弃这次填写吗？'))
  useEffect(() => {
    if (!target) return
    const abort = new AbortController(); lifetime.current = abort
    onEditing(true); reasonInput.current?.focus()
    const off = registerCloseGuard?.(() => guard.current())
    const beforeUnload = (event: BeforeUnloadEvent) => { if (locked.current || dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { abort.abort(); onEditing(false); off?.(); window.removeEventListener('beforeunload', beforeUnload) }
    // The fixed target owns this form lifetime; input changes must not replace
    // its in-flight signal or native close guard.
  }, [target, onEditing, registerCloseGuard])
  const cancel = () => {
    if (!guard.current()) return
    setTarget(undefined); setReason(''); setConfirmed(false); setError(undefined); attempt.current = undefined
    queueMicrotask(() => opener.current?.focus())
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!target || locked.current || !confirmed || reason.trim().length < 3 || !lifetime.current || lifetime.current.signal.aborted) return
    const signal = lifetime.current.signal
    locked.current = true; setBusy(true); setError(undefined)
    const body = { presetId: target.presetId, expectedVersion: target.configVersion, reason: reason.trim() }
    const signature = JSON.stringify(body)
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    try {
      const result = publicationView(await api.request('/publications', 'POST', body, attempt.current.key, signal))
      if (signal.aborted) return
      if (result.sourceUserId !== account.userId || result.presetId !== target.presetId || result.configVersion !== target.configVersion
        || result.name !== target.name || result.status !== 'pending' || result.revision !== 1 || result.submissionReason !== body.reason) {
        throw new Error('提交回执与所选来源不一致，请重新读取提交记录；不会自动重复提交')
      }
      setMessage(`已提交 ${result.name} 的 ${result.configVersion} 版本，等待管理员审核。个人智能体和会话保持不变。`)
      setTarget(undefined); setReason(''); setConfirmed(false); attempt.current = undefined
      queueMicrotask(() => opener.current?.focus())
    } catch (failure) { if (!signal.aborted) setError(failure) }
    finally { locked.current = false; if (!signal.aborted) setBusy(false) }
  }
  return <div data-paimind-enterprise data-paimind-ui-scope="enterprise-agent-submit">
    <button ref={opener} type="button" data-paimind-ui-button disabled={disabled || !!target} onClick={() => {
      setTarget(Object.freeze({ ...selection })); setReason(''); setConfirmed(false); setError(undefined); setMessage('')
    }}>提交审核</button>
    {message && <p role="status">{message}</p>}
    {target && <form aria-label={`提交 ${target.name} 审核`} onSubmit={event => { void submit(event) }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    }}><h3>{target.name} · 提交审核</h3><p>已保存版本：{target.configVersion}</p><p>只提交此版本的审核副本。批准、企业分配和运行分别受控，后续个人编辑不会覆盖此副本。</p>
      <fieldset disabled={busy}><label>提交原因<textarea ref={reasonInput} value={reason} maxLength={500} onChange={event => setReason(event.currentTarget.value)} /></label>
        <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我已确认智能体和已保存版本，并同意提交给管理员审核</label></fieldset>
      {!!error && <p role="alert">{error instanceof Error ? error.message : '提交失败，请重试'}</p>}
      <div data-enterprise-actions><button type="button" data-paimind-ui-button disabled={busy} onClick={cancel}>取消提交</button>
        <button type="submit" data-paimind-ui-button disabled={busy || !confirmed || reason.trim().length < 3}>{busy ? '正在提交…' : '确认提交审核'}</button></div>
    </form>}
  </div>
}

export function createAgentCenterContribution(session: EnterpriseSession): AgentCenterContribution {
  function Panel({ mode, ...props }: AgentCenterPanelProps & { mode: 'assigned' | 'submitted' }): JSX.Element {
    const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
    return view.status === 'ready' ? <MemberPublicationCatalog key={`${view.account.tenantId}:${view.account.userId}:${mode}`}
      {...props} api={session.api} account={view.account} mode={mode} />
      : view.status === 'unavailable' ? <div><p role="alert">企业服务暂时不可用，旧内容已清除。</p><button data-paimind-agent-button onClick={() => { void session.refresh() }}>重新验证账户</button></div>
        : <p role="status">{view.status === 'signed-out' ? '登录已失效，企业内容已清除。' : '正在验证企业账户…'}</p>
  }
  return { id: 'enterprise', personalLabel: { zh: '我创建的', en: 'Created by me' }, tabs: [
    { id: 'assigned', zh: '企业分配的', en: 'Assigned by enterprise', Panel: props => <Panel {...props} mode="assigned" /> },
    { id: 'submitted', zh: '我的提交记录', en: 'My submissions', Panel: props => <Panel {...props} mode="submitted" /> },
  ], PersonalAction: props => {
    const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
    return view.status === 'ready' ? <SubmitPersonalAgent key={`${view.account.tenantId}:${view.account.userId}`}
      {...props} api={session.api} account={view.account} /> : null
  } }
}
