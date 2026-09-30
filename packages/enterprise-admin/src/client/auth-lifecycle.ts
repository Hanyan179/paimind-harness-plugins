import type { EnterpriseSession } from './api.js'
import { enterpriseAuthDocument, enterpriseAuthStyle, mountAuthenticationPage } from '../auth-boundary.js'

/** A temporary carrier for the SAME recovery boundary while its server is
 * offline. The native document remains hidden/inert until real navigation;
 * only a native modal dialog can escape the ancestor's inertness. No React
 * root, identity cache, native content copy, or alternate permission exists. */
function mountCurrentRecovery(doc: Document, navigate: (path: string) => void): () => void {
  const parsed = new DOMParser().parseFromString(enterpriseAuthDocument(true, 'recover'), 'text/html')
  const boundary = doc.importNode(parsed.querySelector<HTMLElement>('[data-auth-boundary]')!, true)
  const title = boundary.querySelector<HTMLElement>('h1')!
  title.id = 'paimind-enterprise-recovery-title'
  title.tabIndex = -1
  boundary.querySelector('section')!.setAttribute('aria-labelledby', title.id)
  const dialog = doc.createElement('dialog')
  dialog.dataset.paimindAuthRecovery = ''
  dialog.dataset.paimindUiScope = 'enterprise-recovery'
  dialog.setAttribute('aria-labelledby', title.id)
  dialog.setAttribute('closedby', 'none')
  const preventDismiss = (event: Event) => event.preventDefault()
  const preventEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') event.preventDefault() }
  dialog.addEventListener('cancel', preventDismiss)
  dialog.addEventListener('keydown', preventEscape, true)
  dialog.append(boundary)
  const style = doc.createElement('style')
  style.dataset.paimindAuthRecovery = ''
  style.textContent = `${enterpriseAuthStyle}
dialog[data-paimind-auth-recovery]{position:fixed;inset:0;box-sizing:border-box;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;padding:0;border:0;visibility:visible;overflow:auto;background:var(--paimind-ui-canvas);color:var(--paimind-ui-text)}
dialog[data-paimind-auth-recovery]::backdrop{background:#f8fafc}
`
  let stop = () => {}
  let disposed = false
  // Some browsers can close an asynchronously opened modal without a
  // cancellable cancel event. Keep a retry surface, never unlock the old UI.
  const reopen = () => {
    if (disposed || dialog.open) return
    try { dialog.showModal(); title.focus() }
    catch { navigate('/haas/recover') }
  }
  dialog.addEventListener('close', reopen)
  const dispose = () => {
    if (disposed) return
    disposed = true; stop()
    dialog.removeEventListener('cancel', preventDismiss)
    dialog.removeEventListener('keydown', preventEscape, true)
    dialog.removeEventListener('close', reopen)
    if (dialog.open) dialog.close()
    dialog.remove(); style.remove()
  }
  try {
    doc.head.append(style); doc.body.append(dialog)
    dialog.showModal()
    doc.title = '正在恢复连接 · DeepSeek Harness'
    title.focus()
    stop = mountAuthenticationPage(doc, navigate, boundary)
    return dispose
  } catch (error) { dispose(); throw error }
}

/** Immediately isolate the whole native document on authority loss. A known
 * logout/identity change navigates immediately; transient service loss keeps
 * the existing recovery boundary available until a fresh document can load.
 * Broadcast messages request fresh authentication, never grant access. */
export function installAuthLifecycle(session: EnterpriseSession,
  navigate: (path: string) => void = path => window.location.replace(path),
  observeConnectionLoss?: (onLoss: () => void) => () => void): () => void {
  let account: string | undefined
  let exiting = false
  let navigating = false
  let stopRecovery = () => {}
  const document = window.document
  const root = document.documentElement
  const visibility = root.style.visibility
  const inert = root.inert
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('paimind.enterprise.auth-change')
  const hide = () => { root.style.visibility = 'hidden'; root.inert = true }
  const exit = (path = '/haas/login', broadcast = false) => {
    if (navigating) return
    navigating = true; exiting = true; hide(); stopRecovery()
    if (broadcast) channel?.postMessage('reauthenticate')
    navigate(path)
  }
  const recover = () => {
    if (exiting) return
    exiting = true; hide()
    try { stopRecovery = mountCurrentRecovery(document, path => exit(path)) }
    catch { exit('/haas/recover') }
  }
  const update = () => {
    const view = session.getSnapshot()
    if (view.status === 'signed-out') { exit('/haas/login', true); return }
    // Do not navigate to an offline gateway and lose the only retry UI. Never
    // unhide this document even if the same identity later becomes available.
    if (view.status === 'unavailable') { recover(); return }
    if (view.status === 'ready') {
      const current = JSON.stringify([view.account.tenantId, view.account.userId, view.account.role])
      if (account !== undefined && account !== current) exit('/haas/recover')
      else account = current
    }
  }
  const message = (event: MessageEvent) => { if (event.data === 'reauthenticate') exit('/haas/recover') }
  const pageHide = () => { exiting = true; hide(); stopRecovery() }
  const pageShow = (event: PageTransitionEvent) => {
    if (event.persisted) { navigating = false; exit('/haas/recover') }
  }
  channel?.addEventListener('message', message)
  window.addEventListener('pagehide', pageHide)
  window.addEventListener('pageshow', pageShow)
  const unsubscribe = session.subscribe(update)
  update()
  // Identity can remain valid when only this member's native worker is lost.
  // Reuse the same recovery boundary without invalidating or broadcasting a
  // logout. Its original two fresh checks, not connection recovery, unlock UI.
  const stopConnection = observeConnectionLoss?.(recover) ?? (() => {})
  return () => {
    stopConnection()
    stopRecovery()
    unsubscribe(); channel?.removeEventListener('message', message); channel?.close()
    window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow)
    if (!exiting) { root.style.visibility = visibility; root.inert = inert }
  }
}
