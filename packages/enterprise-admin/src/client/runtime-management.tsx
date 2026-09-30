import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EnterpriseApi, memberViews, type AccountView } from './api.js'
import { object, resourcePolicy, runtimeState, recoveryState, recoveryReceipt, recoveryLabels, type RuntimeState, type RecoveryReceipt } from './runtime-view.js'

/** Native settings contribution; no browser-persisted policy, runtime or timer. */
export function MemberRuntimeManagement({ api, onEditing }: { api: EnterpriseApi; onEditing?: (value: boolean) => void }): JSX.Element {
  const [members, setMembers] = useState<AccountView[]>(), [target, setTarget] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [snapshot, setSnapshot] = useState<RuntimeState>(), [receipt, setReceipt] = useState<RecoveryReceipt | null>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [stale, setStale] = useState(false), [reload, setReload] = useState(0)
  const [draft, setDraft] = useState<'policy' | 'recovery'>(), [draftReason, setDraftReason] = useState(''), [draftConfirmed, setDraftConfirmed] = useState(false), [focusBack, setFocusBack] = useState(0)
  const current = useRef<AbortController>(), feedback = useRef<HTMLDivElement>(null), reasonInput = useRef<HTMLTextAreaElement>(null), opener = useRef<HTMLButtonElement | null>(null)
  const writing = useRef(false)
  const clear = () => { current.current?.abort(); current.current = undefined; setSnapshot(undefined); setReceipt(undefined); setBusy(false); setStale(false); setError(''); setMessage('') }
  useEffect(() => { onEditing?.(Boolean(draft) || busy); return () => onEditing?.(false) }, [draft, busy, onEditing])
  useEffect(() => {
    const abort = new AbortController(); clear(); setMembers(undefined); setTarget(''); setConfirmed(false); setDraft(undefined)
    void api.request('/admin/members', 'GET', undefined, undefined, abort.signal).then(memberViews).then(rows => {
      if (!abort.signal.aborted) setMembers(rows.filter(row => row.role === 'member'))
    }).catch(failure => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '成员读取失败') })
    return () => { abort.abort(); current.current?.abort(); current.current = undefined }
  }, [api, reload])
  useEffect(() => { if (draft) reasonInput.current?.focus() }, [draft])
  useEffect(() => { if (focusBack && !draft && !busy) opener.current?.focus() }, [focusBack, draft, busy])
  useEffect(() => { if (message || error) feedback.current?.focus() }, [message, error])
  const member = members?.find(row => row.userId === target), reasonValid = reason.trim().length >= 3 && reason.trim().length <= 500
  const read = async (event: FormEvent) => {
    event.preventDefault(); if (!member || !confirmed || !reasonValid || current.current || draft) return
    const abort = new AbortController(); current.current = abort; writing.current = false; setBusy(true); setError(''); setMessage(''); setStale(true)
    const input = { targetUserId: target, reason: reason.trim(), confirmed: true }
    try {
      const [state, recovery] = await Promise.all([
        api.request('/admin/runtime-state', 'POST', input, crypto.randomUUID(), abort.signal),
        api.request('/admin/runtime-recovery-state', 'POST', input, crypto.randomUUID(), abort.signal),
      ])
      const next = runtimeState(state, target), request = recoveryState(recovery, target)
      if (current.current !== abort || abort.signal.aborted) return
      setSnapshot(next); setReceipt(request); setStale(false); setMessage('运行观察与恢复记录已读取，原因已记入审计；页面不会自动轮询。')
    } catch (failure) { if (current.current === abort && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : '运行状态读取失败') }
    finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  const open = (kind: 'policy' | 'recovery', button: HTMLButtonElement) => {
    opener.current = button; setDraft(kind); setDraftReason(''); setDraftConfirmed(false); setError(''); setMessage('')
  }
  const cancel = () => { if (current.current) return; setDraft(undefined); setDraftReason(''); setDraftConfirmed(false); setFocusBack(value => value + 1) }
  const pending = receipt && ['queued', 'executing', 'unconfirmed'].includes(receipt.outcome)
  const canWrite = Boolean(snapshot && receipt !== undefined && !stale && !busy && !draft && member?.status === 'active')
  const canRecover = canWrite && !pending && snapshot?.desired.desiredState === 'running' && snapshot.runtime?.bindingState === 'suspended' && !snapshot.runtime.leaseValid
  const stopWaiting = () => {
    const wasWrite = writing.current
    current.current?.abort(); current.current = undefined; setBusy(false); setDraft(undefined); setStale(true)
    setError(wasWrite ? '已停止等待，操作可能已经生效；这不是撤销。请重新读取运行状态与恢复记录，不要重复提交。' : '已停止读取，之前的观察不能作为当前状态。')
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!snapshot || current.current || !draft || !draftConfirmed || draftReason.trim().length < 3 || draftReason.trim().length > 500 || stale || member?.status !== 'active') return
    const action = draft, values = new FormData(event.currentTarget), targetId = target
    let input: object
    try {
      if (action === 'policy') {
        const { revision, ...policy } = resourcePolicy({ revision: snapshot.desired.revision, desiredState: values.get('desiredState'),
          cpuMillis: Number(values.get('cpuMillis')), memoryMiB: Number(values.get('memoryMiB')), pidsLimit: Number(values.get('pidsLimit')) })
        input = { targetUserId: targetId, expectedRevision: revision, ...policy, reason: draftReason.trim(), confirmed: true }
      } else {
        if (pending || !snapshot.runtime || snapshot.runtime.bindingState !== 'suspended' || snapshot.runtime.leaseValid || snapshot.desired.desiredState !== 'running') return
        input = { targetUserId: targetId, expectedCellRevision: snapshot.runtime.cellRevision, expectedResourceRevision: snapshot.desired.revision, reason: draftReason.trim(), confirmed: true }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '请核对资源范围'); return }
    const abort = new AbortController(); current.current = abort; writing.current = true; setBusy(true); setStale(true); setError(''); setMessage('')
    setDraft(undefined); setDraftReason(''); setDraftConfirmed(false)
    try {
      const value = await api.request(action === 'policy' ? '/admin/runtime-resource-policy' : '/admin/runtime-recovery-requests', 'POST', input, crypto.randomUUID(), abort.signal)
      if (current.current !== abort || abort.signal.aborted) return
      if (action === 'policy') {
        const row = object(value), expected = object(input), policy = resourcePolicy(row.policy)
        if (row.targetUserId !== targetId || row.outcome !== 'intent-recorded' || row.enforcement !== 'unconfirmed' || row.automaticRestart !== false || row.persistentStorageQuota !== 'not-enforced'
          || policy.revision !== snapshot.desired.revision + 1 || ['desiredState', 'cpuMillis', 'memoryMiB', 'pidsLimit'].some(key => object(policy)[key] !== expected[key])) throw Error('资源意图回执不匹配')
        setMessage('资源意图已记录，旧运行准入将失效；尚未确认实际停止或新限额生效，不会自动恢复。请重新读取。')
      } else {
        const request = recoveryReceipt(value, targetId)
        if (request.outcome !== 'queued' || request.acceptedResourceRevision !== snapshot.desired.revision) throw Error('恢复提交回执不匹配')
        setReceipt(request); setMessage(recoveryLabels.queued)
      }
    } catch (failure) {
      if (current.current === abort && !abort.signal.aborted) setError(`${failure instanceof Error ? failure.message : '提交失败'}；结果未确认，请先重新读取，不自动重试。`)
    } finally { if (current.current === abort) { current.current = undefined; setBusy(false) } }
  }
  return <section aria-label="成员配额与运行管理" onKeyDown={event => {
    if (event.key === 'Escape' && draft) { event.preventDefault(); event.stopPropagation(); cancel() }
  }}>
    <h3>成员配额与运行管理</h3>
    <p>资源目标、实际观察和历史恢复结果分开显示。变更会撤回该成员的旧运行准入，其他成员保持独立。</p>
    <button data-paimind-ui-button disabled={busy || Boolean(draft)} onClick={() => setReload(value => value + 1)}>刷新成员列表</button>
    {members === undefined && !error && <p role="status">正在读取成员…</p>}
    {members?.length === 0 && <p role="status">暂无使用人员，请先在成员管理中开通。</p>}
    <form aria-label="读取成员运行状态" onSubmit={event => { void read(event) }}>
      <fieldset disabled={busy || Boolean(draft)}>
        <label>成员<select value={target} onChange={event => { clear(); setTarget(event.target.value); setConfirmed(false) }}><option value="">请选择成员</option>
          {members?.map(row => <option key={row.userId} value={row.userId}>{row.displayName}{row.status === 'disabled' ? '（已停用，仅可读取）' : ''}</option>)}</select></label>
        <label>读取原因<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={500} required /></label>
        <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认读取该成员运行状态与恢复记录，原因将记入审计</label>
        <button data-paimind-ui-button disabled={!member || !confirmed || !reasonValid}>记录原因并读取运行状态</button>
      </fieldset>
    </form>
    {busy && <p role="status" aria-busy="true">{writing.current ? '正在提交，关闭等待不会撤销已发出的操作…' : '正在读取运行观察与恢复记录…'}</p>}
    {busy && <button data-paimind-ui-button onClick={stopWaiting}>停止等待</button>}
    <div ref={feedback} tabIndex={-1} data-enterprise-feedback>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}</div>
    {snapshot && <>
      <h4>{snapshot.targetName} 的运行观察</h4>
      {stale && <p role="status">以下是之前读取的观察，已失去当前性；重新读取前不能提交变更。</p>}
      <p>目标状态：{snapshot.desired.desiredState === 'running' ? '运行' : '暂停'}；资源修订 {snapshot.desired.revision}。</p>
      <p>目标限额：处理器 {snapshot.desired.cpuMillis} 毫核，内存 {snapshot.desired.memoryMiB} MiB，进程数 {snapshot.desired.pidsLimit}。</p>
      <p>{snapshot.enforcement === 'operator-observed' ? '读取时，操作者观察与当前策略及有效准入匹配。' : '尚未确认资源限制生效。'}</p>
      {snapshot.runtime ? <>
        <p>绑定状态：{({ ready: '已准入', suspended: '已撤回', failed: '失败', starting: '启动中' } as Record<string, string>)[snapshot.runtime.bindingState]}；租约{snapshot.runtime.leaseValid ? '有效' : '无效'}；策略观察{snapshot.runtime.policyMatches ? '匹配' : '不匹配'}。</p>
        {snapshot.runtime.observed && <p>最近观察：处理器 {snapshot.runtime.observed.cpuMillis} 毫核，内存 {snapshot.runtime.observed.memoryMiB} MiB，进程数 {snapshot.runtime.observed.pidsLimit}；资源修订 {snapshot.runtime.observed.revision}。</p>}
        <p>实际停止状态未由本次读取核实。恢复前，操作者必须独立确认旧写入者已停止。</p>
      </> : <p>没有运行绑定；此入口不创建新运行单元，需完成原操作者的首次准入。</p>}
      <p>持久存储配额尚未实施；以上观察不代表磁盘限额或压力测试通过。</p>
      <section aria-label="历史恢复请求"><h4>历史恢复请求</h4>{receipt ? <><p>{recoveryLabels[receipt.outcome]}</p><p>请求编号：{receipt.requestId}</p><p>接受的资源修订：{receipt.acceptedResourceRevision}</p></> : <p>没有恢复请求记录。</p>}</section>
      <div data-enterprise-actions>
        <button data-paimind-ui-button disabled={!canWrite} onClick={event => open('policy', event.currentTarget)}>调整资源与目标状态</button>
        <button data-paimind-ui-button disabled={!canRecover} onClick={event => open('recovery', event.currentTarget)}>请求恢复已停止单元</button>
      </div>
      {draft && <form aria-label={draft === 'policy' ? '调整成员资源' : '请求成员恢复'} onSubmit={event => { void submit(event) }} data-enterprise-form>
        <fieldset disabled={busy}><legend>{draft === 'policy' ? '调整资源与目标状态' : '请求恢复已停止单元'} · {snapshot.targetName}</legend>
          <label>操作原因<textarea ref={reasonInput} value={draftReason} onChange={event => setDraftReason(event.target.value)} required minLength={3} maxLength={500} /></label>
          {draft === 'policy' ? <>
            <label>目标状态<select name="desiredState" defaultValue={snapshot.desired.desiredState}><option value="running">运行</option><option value="suspended">暂停</option></select></label>
            <label>处理器（毫核）<input name="cpuMillis" type="number" min={100} max={1000} step={1} required defaultValue={snapshot.desired.cpuMillis} /></label>
            <label>内存（MiB）<input name="memoryMiB" type="number" min={256} max={1024} step={1} required defaultValue={snapshot.desired.memoryMiB} /></label>
            <label>进程数<input name="pidsLimit" type="number" min={32} max={256} step={1} required defaultValue={snapshot.desired.pidsLimit} /></label>
            <p>保存只记录意图并使旧准入失效；设为运行不会自动重启。重新读取后，才能明确请求恢复。</p>
          </> : <p>恢复使用准确当前资源修订和已撤回的绑定，保留原数据卷。重复点击不应创建第二个恢复请求；未知结果须核查，不自动重试。</p>}
          <label data-enterprise-checkbox><input type="checkbox" checked={draftConfirmed} onChange={event => setDraftConfirmed(event.target.checked)} />我确认以上影响与目标成员，操作将记入审计</label>
          <div data-enterprise-actions><button data-paimind-ui-button disabled={!draftConfirmed || draftReason.trim().length < 3 || draftReason.trim().length > 500}>确认提交</button>
            <button data-paimind-ui-button type="button" onClick={cancel}>取消</button></div>
        </fieldset>
      </form>}
    </>}
  </section>
}
