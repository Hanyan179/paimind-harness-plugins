import { useEffect, useState } from 'react'
import type {
  ContextCollection,
  ContextMount,
  ContextTarget,
} from '../contract.js'
import { contextResult, type ContextRemoteApi } from './api.js'
export { contextResult, type ContextRemoteApi } from './api.js'
export { ContextLibrarySection } from './library.js'
const label = (target: ContextTarget) =>
  ({ agent: '智能体', workspace: '工作区', session: '会话' })[target.kind]
export function ContextConnections({
  api,
  target,
  onPendingChange,
}: {
  api: ContextRemoteApi
  target: ContextTarget
  onPendingChange?: (pending: boolean) => void
}): React.JSX.Element {
  const [collections, setCollections] = useState<ContextCollection[]>([]),
    [mounts, setMounts] = useState<ContextMount[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    onPendingChange?.(busy)
  }, [busy, onPendingChange])
  const load = async () => {
    const [c, m] = await Promise.all([
      contextResult(api, { action: 'collections' }),
      contextResult(api, { action: 'mounts', target }),
    ])
    setCollections(c.collections ?? [])
    setMounts(m.mounts ?? [])
  }
  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [target.kind, target.id])
  const change = async (c: ContextCollection, value: string) => {
    setBusy(true)
    setError('')
    try {
      const current = mounts.find((m) => m.collectionId === c.id)
      if (value === 'none' && current)
        await contextResult(api, {
          action: 'removeMount',
          mountId: current.id,
          expectedRevision: current.revision,
        })
      else if (value !== 'none')
        await contextResult(api, {
          action: 'setMount',
          target,
          collectionId: c.id,
          mode: value === 'write' ? 'write' : 'read',
          expectedRevision: current?.revision ?? null,
        })
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section data-context-connections>
      <h3>{label(target)}的资料连接</h3>
      <p>连接保持引用。读写允许修改文件；其他连接的授权仍然有效。</p>
      {error && <p role="alert">{error}</p>}
      {collections.length === 0 ? (
        <p>还没有资料夹，请先在资料库中创建。</p>
      ) : (
        collections.map((c) => (
          <label className="cl-connection" key={c.id}>
            <span>{c.title}</span>
            <select
              aria-label={`${c.title}的访问权限`}
              disabled={busy}
              value={
                mounts.find((m) => m.collectionId === c.id)?.mode ?? 'none'
              }
              onChange={(e) => {
                void change(c, e.target.value)
              }}
            >
              <option value="none">未连接</option>
              <option value="read">只读</option>
              <option value="write">读写</option>
            </select>
          </label>
        ))
      )}
    </section>
  )
}
