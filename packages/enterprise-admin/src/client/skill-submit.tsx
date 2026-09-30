import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { SkillCenterSourceActionProps, SkillPublicationSourceSelection } from '@paimind/skill-market/client'
import { ApiFailure, EnterpriseSession, type AccountView, type EnterpriseApi } from './api.js'
import { skillPublication } from './member-skills.js'

/** The native owner supplies an exact directory version, never archive bytes
 * or a user-supplied principal. The existing control-plane command authorizes
 * and captures that fixed source independently. */
function SubmitSkill({ api, account, selection, readSource, disabled, onEditing, registerCloseGuard }: SkillCenterSourceActionProps & {
  api: EnterpriseApi; account: AccountView }): JSX.Element {
  const [open, setOpen] = useState(false), [source, setSource] = useState<SkillPublicationSourceSelection>()
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState<'reading' | 'submitting'>()
  const [error, setError] = useState<unknown>(), [message, setMessage] = useState('')
  const lifetime = useRef<AbortController>(), operation = useRef<AbortController>(), locked = useRef(false)
  const attempt = useRef<{ signature: string; key: string }>(), guard = useRef<() => boolean>(() => true)
  const opener = useRef<HTMLButtonElement>(null), reasonInput = useRef<HTMLTextAreaElement>(null), failure = useRef<HTMLParagraphElement>(null)
  const dirty = useRef(false); dirty.current = !!(reason || confirmed)
  guard.current = () => !locked.current && (!dirty.current || window.confirm('放弃这次提交填写？停止等待或关闭页面不会撤回可能已提交的审核副本。'))
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    return () => abort.abort()
  }, [])
  useEffect(() => {
    onEditing(open)
    if (!open) return () => onEditing(false)
    const off = registerCloseGuard?.(() => guard.current())
    const unload = (event: BeforeUnloadEvent) => { if (locked.current || dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { off?.(); onEditing(false); window.removeEventListener('beforeunload', unload) }
  }, [open, onEditing, registerCloseGuard])
  useEffect(() => { if (source) reasonInput.current?.focus() }, [source])
  useEffect(() => { if (error) failure.current?.focus() }, [error])
  const read = async () => {
    if (disabled || locked.current || !lifetime.current || lifetime.current.signal.aborted) return
    const owner = lifetime.current.signal, abort = new AbortController(); operation.current = abort
    const signal = AbortSignal.any([owner, abort.signal])
    locked.current = true; setBusy('reading'); setOpen(true); setSource(undefined); setError(undefined); setMessage('')
    try {
      const value = await readSource(selection.skillId, signal); signal.throwIfAborted()
      if (value.skillId !== selection.skillId || value.name !== selection.name || value.name !== value.skillId
        || !/^[a-z0-9][a-z0-9-]{0,254}$/u.test(value.skillId) || !/^sha256:[a-f0-9]{64}$/u.test(value.digest)) {
        throw new Error('原技能来源或目录版本不一致，请重新读取')
      }
      setSource(Object.freeze({ ...value }))
    } catch (cause) { if (!owner.aborted) setError(cause) }
    finally { locked.current = false; if (operation.current === abort) operation.current = undefined; if (!owner.aborted) setBusy(undefined) }
  }
  const cancel = () => {
    if (!guard.current()) return
    setOpen(false); setSource(undefined); setReason(''); setConfirmed(false); setError(undefined); attempt.current = undefined
    queueMicrotask(() => opener.current?.focus())
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled || locked.current || !source || !confirmed || reason.trim().length < 3 || reason.trim().length > 500
      || !lifetime.current || lifetime.current.signal.aborted) return
    const owner = lifetime.current.signal, abort = new AbortController(); operation.current = abort
    const signal = AbortSignal.any([owner, abort.signal]), body = { skillId: source.skillId, expectedDigest: source.digest, reason: reason.trim() }
    const signature = JSON.stringify(body)
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    locked.current = true; setBusy('submitting'); setError(undefined)
    try {
      const value = await api.request('/admin/skill-publications', 'POST', body, attempt.current.key, signal)
      signal.throwIfAborted()
      const receipt = skillPublication(value)
      if (receipt.sourceUserId !== account.userId || receipt.name !== source.name || receipt.digest !== source.digest
        || receipt.status !== 'pending' || receipt.revision !== 1 || receipt.submissionReason !== body.reason || receipt.reviewReason !== null) {
        throw new Error('提交回执与准确来源不一致；保留本次命令，不自动重复提交')
      }
      setMessage(`已确认提交 ${source.name}，发布编号 ${receipt.publicationId}。请在原生设置的技能审核中查看当前状态；未自动批准、分配、启用或运行。`)
      setOpen(false); setSource(undefined); setReason(''); setConfirmed(false); attempt.current = undefined
      queueMicrotask(() => opener.current?.focus())
    } catch (cause) {
      if (!owner.aborted) {
        setError(cause)
        if (cause instanceof ApiFailure && [401, 403, 404].includes(cause.status)) {
          setSource(undefined); setReason(''); setConfirmed(false); attempt.current = undefined
        }
      }
    } finally { locked.current = false; if (operation.current === abort) operation.current = undefined; if (!owner.aborted) setBusy(undefined) }
  }
  return <section data-paimind-enterprise data-paimind-ui-scope="enterprise-skill-submit" aria-label="管理员提交技能" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); cancel() }
  }}>
    <button ref={opener} type="button" data-paimind-ui-button disabled={disabled || open} onClick={() => { void read() }}>提交技能审核</button>
    {message && <p role="status">{message}</p>}
    {open && <form aria-label={`提交技能 ${selection.name}`} onSubmit={event => { void submit(event) }}>
      <h3>{selection.name} · 提交审核</h3>
      <p>只提交当前管理员本人保存的准确目录版本。完整正文、脚本和附件由原所有者封存；后续编辑不覆盖审核副本。提交不改变原技能、使用范围或会话。</p>
      {busy === 'reading' && <p role="status">正在从原技能中心读取完整目录版本…</p>}
      {source && <><p data-enterprise-source>目录摘要：{source.digest}</p><fieldset disabled={!!busy || disabled}>
        <label>提交原因<textarea ref={reasonInput} value={reason} maxLength={500} onChange={event => setReason(event.currentTarget.value)} /></label>
        <label data-enterprise-checkbox><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} />我已确认此来源和准确版本，同意提交企业审核</label>
      </fieldset><button type="submit" data-paimind-ui-button disabled={!!busy || disabled || !confirmed || reason.trim().length < 3 || reason.trim().length > 500}>
        {busy === 'submitting' ? '正在封存并提交…' : '确认提交技能'}</button></>}
      {!source && !busy && <button type="button" data-paimind-ui-button disabled={disabled} onClick={() => { void read() }}>重新读取技能来源</button>}
      {!!busy && <button type="button" data-paimind-ui-button onClick={() => operation.current?.abort(new Error('已停止等待；提交结果可能未知，请以原命令重试确认。'))}>停止等待</button>}
      <button type="button" data-paimind-ui-button disabled={!!busy} onClick={cancel}>取消提交</button>
      {!!error && <p ref={failure} tabIndex={-1} role="alert">{error instanceof Error ? error.message : '提交未确认'}。原文件和可能已提交的副本不会被删除；重试相同内容会复用原命令。</p>}
    </form>}
  </section>
}

export function createSkillSourceAction(session: EnterpriseSession): NonNullable<import('@paimind/skill-market/client').SkillCenterContribution['SourceAction']> {
  return props => {
    const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
    return view.status === 'ready' && view.account.role === 'admin' && view.account.status === 'active'
      ? <SubmitSkill key={`${view.account.tenantId}:${view.account.userId}:${props.selection.skillId}`} {...props} api={session.api} account={view.account} /> : null
  }
}
