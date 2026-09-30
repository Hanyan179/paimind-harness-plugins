import { PAIMIND_UI_FOUNDATION_CSS } from '@paimind/ui-foundation'

/** Authentication boundary only. After login the native document takes over;
 * no application shell, navigation, router, or duplicate React root exists. */
export function enterpriseAuthDocument(configured: boolean, mode: 'authenticate' | 'recover' = 'authenticate'): string {
  if (mode === 'recover') return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>正在恢复连接 · DeepSeek Harness</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/haas/auth.css"><script src="/haas/auth.js" defer></script></head>
<body><main data-paimind-ui-scope="enterprise-auth" data-auth-boundary data-auth-recovery>
<section data-paimind-ui-panel aria-labelledby="auth-title"><p data-paimind-ui-summary>DeepSeek Harness · 企业账户</p>
<h1 id="auth-title">正在恢复连接</h1><p>正在检查企业账户与原生运行环境，原生页面暂不可用。登录有效时无需重新输入密码；两项检查通过后会自动进入。</p>
<p data-recovery-account hidden></p><p role="status" aria-live="polite" data-recovery-status>正在重新验证…</p>
<p role="alert" data-recovery-error hidden></p><div data-recovery-actions>
<button data-paimind-ui-button type="button" data-recovery-retry>重新验证</button>
<button data-paimind-ui-button type="button" data-recovery-logout>退出并切换账户</button></div>
</section></main></body></html>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>企业账户 · DeepSeek Harness</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/haas/auth.css"><script src="/haas/auth.js" defer></script></head>
<body><main data-paimind-ui-scope="enterprise-auth" data-auth-boundary data-configured="${configured}">
<section data-paimind-ui-panel aria-labelledby="auth-title"><p data-paimind-ui-summary>DeepSeek Harness · 企业账户</p>
<h1 id="auth-title">${configured ? '登录企业账户' : '初始化管理员'}</h1>
<p data-auth-description>${configured ? '登录后进入原生对话与工作区。' : '首次使用，请使用部署人员提供的初始化口令开通管理员。'}</p>
<form aria-label="企业账户认证"><fieldset><label>用户名<input name="username" required minlength="3" maxlength="128" autocomplete="username" pattern="[A-Za-z0-9][A-Za-z0-9._+@-]*" autocapitalize="none" spellcheck="false" autofocus></label>
<label data-bootstrap-field ${configured ? 'hidden' : ''}>姓名<input name="displayName" maxlength="120" autocomplete="name" ${configured ? 'disabled' : 'required'}></label>
<label>密码<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="${configured ? 'current-password' : 'new-password'}"></label>
<label data-bootstrap-field ${configured ? 'hidden' : ''}>初始化口令<input name="bootstrapSecret" type="password" minlength="32" maxlength="128" autocomplete="off" ${configured ? 'disabled' : 'required'}></label>
<button data-paimind-ui-button data-variant="primary" type="submit">${configured ? '登录' : '初始化管理员'}</button></fieldset>
<p role="alert" data-auth-error hidden></p><p role="status" data-auth-status aria-live="polite"></p></form>
<p data-paimind-ui-summary>管理员管理企业能力；使用人员仅使用已授权的内容。</p></section></main></body></html>`
}

export const enterpriseAuthStyle: string = `${PAIMIND_UI_FOUNDATION_CSS}
html,body{min-height:100%;margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
[data-auth-boundary]{min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--paimind-ui-canvas)}
[data-auth-boundary] section{width:min(100%,416px);padding:28px}
[data-auth-boundary] h1{font-size:24px;line-height:32px;letter-spacing:-.3px;margin:12px 0 8px;font-weight:600}
[data-auth-boundary] p{margin:8px 0 16px;overflow-wrap:anywhere}
[data-auth-boundary] form{margin:24px 0 16px}
[data-auth-boundary] fieldset{border:0;padding:0;margin:0;display:grid;gap:16px}
[data-auth-boundary] label{display:grid;gap:6px;font-size:13px}
[data-auth-boundary] input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--paimind-ui-border);border-radius:var(--paimind-ui-radius-sm);color:inherit;background:var(--paimind-ui-panel)}
[data-auth-boundary] button{width:100%;min-height:40px;font-size:14px}
[data-recovery-actions]{display:grid;gap:8px}
[data-auth-boundary] [role=alert]{color:var(--paimind-ui-danger);margin-top:16px}
[data-auth-boundary] [role=status]{color:var(--paimind-ui-muted);font-size:13px}
[data-auth-boundary] [hidden]{display:none!important}
@media(max-width:480px){[data-auth-boundary]{padding:16px}[data-auth-boundary] section{padding:22px}}
`

/** Self-contained controller, serialized as the external authentication asset.
 * No secrets or roles are stored in browser persistence. Injectable navigation
 * is solely for component tests; production uses a real document replacement. */
export function mountAuthenticationPage(doc: Document, navigate: (url: string) => void = url => location.replace(url),
  boundary: HTMLElement = doc.querySelector<HTMLElement>('[data-auth-boundary]')!): () => void {
  const root = boundary
  if (root.hasAttribute('data-auth-recovery')) {
    const status = root.querySelector<HTMLElement>('[data-recovery-status]')!
    const retry = root.querySelector<HTMLButtonElement>('[data-recovery-retry]')!
    const logout = root.querySelector<HTMLButtonElement>('[data-recovery-logout]')!
    const accountLabel = root.querySelector<HTMLElement>('[data-recovery-account]')!
    const error = root.querySelector<HTMLElement>('[data-recovery-error]')!
    const controller = new AbortController()
    let checking: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let busy = false
    let leaving = false
    let logoutAttempted = false
    let loggingOut = false
    let logoutKey: string | undefined
    let delay = 2_000
    const check = async () => {
      if (busy || leaving || logoutAttempted || controller.signal.aborted) return
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      const currentCheck = new AbortController()
      checking = currentCheck
      const cancelled = () => controller.signal.aborted || currentCheck.signal.aborted || logoutAttempted
      const retryHadFocus = doc.activeElement === retry
      busy = true; retry.disabled = true; status.setAttribute('aria-busy', 'true')
      let automaticRetry = true
      status.textContent = '正在重新验证…'
      accountLabel.hidden = true; accountLabel.textContent = ''
      try {
        const response = await fetch('/haas/v1/auth/me', {
          credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          signal: AbortSignal.any([controller.signal, currentCheck.signal, AbortSignal.timeout(15_000)]),
        })
        if (cancelled()) return
        if (response.status === 401 || response.status === 403) {
          leaving = true; navigate('/haas/login'); return
        }
        if (!response.ok) throw new Error('unavailable')
        const result = await response.json() as { data?: Record<string, unknown> }
        if (cancelled()) return
        const account = result?.data
        if (!account || !['userId', 'tenantId', 'username', 'displayName'].every(key => typeof account[key] === 'string' && account[key] !== '')
          || !['admin', 'member'].includes(String(account.role)) || account.status !== 'active') throw new Error('invalid-identity')
        accountLabel.textContent = `${account.displayName}（${account.username}）`; accountLabel.hidden = false
        status.textContent = '登录仍有效，正在检查原生运行环境…'
        // Fetch the existing authenticated host document. Its gateway checks
        // live admission, upstream availability and the native bootstrap before
        // returning HTML. No new registry, health authority or native API.
        // Browser fetch sends Sec-Fetch-Dest: empty; the server preserves its
        // error status instead of redirecting this probe to the recovery page.
        const native = await fetch('/', {
          headers: { Accept: 'text/html' }, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          signal: AbortSignal.any([controller.signal, currentCheck.signal, AbortSignal.timeout(15_000)]),
        })
        await native.arrayBuffer()
        if (cancelled()) return
        if (native.status === 401) { leaving = true; navigate('/haas/login'); return }
        if (native.status === 403) {
          automaticRetry = false
          status.textContent = '登录有效，但当前账户尚未获准使用原生运行环境。请联系管理员配置权限后重新验证。'
          return
        }
        if (native.status !== 200 || native.headers.get('content-type')?.split(';')[0]?.trim() !== 'text/html') {
          status.textContent = '登录仍有效，但原生运行环境暂不可用。将自动重试；若持续未恢复，请联系管理员。'
          return
        }
        leaving = true; status.textContent = '连接已恢复，正在进入原生宿主…'; navigate('/')
      } catch {
        if (!cancelled()) status.textContent = '企业服务仍不可用，将自动重试。你也可以重新验证。'
      } finally {
        busy = false
        if (!cancelled() && !leaving) {
          retry.disabled = false; status.removeAttribute('aria-busy')
          if (retryHadFocus && (doc.activeElement === doc.body || doc.activeElement === retry)) retry.focus()
          if (automaticRetry) {
            timer = setTimeout(() => { void check() }, delay)
            delay = Math.min(delay * 2, 15_000)
          }
        }
      }
    }
    const onLogout = async () => {
      if (loggingOut || leaving || controller.signal.aborted) return
      logoutAttempted = true; loggingOut = true; logoutKey ??= crypto.randomUUID()
      checking?.abort()
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      retry.disabled = true; logout.disabled = true; logout.textContent = '正在退出…'
      status.textContent = '正在确认退出当前账户…'; status.setAttribute('aria-busy', 'true')
      error.hidden = true; error.textContent = ''
      try {
        const response = await fetch('/haas/v1/auth/logout', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', body: '{}',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': logoutKey },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        })
        if (controller.signal.aborted) return
        // A lost response is not a confirmed logout. Keep its command key and
        // do not resume automatic native admission while the result is unknown.
        if (response.status !== 401) {
          const result = await response.json() as { data?: { loggedOut?: boolean } }
          if (!response.ok || result.data?.loggedOut !== true) throw new Error('logout-unconfirmed')
        }
        if (controller.signal.aborted) return
        leaving = true; accountLabel.hidden = true; accountLabel.textContent = ''
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('paimind.enterprise.auth-change')
          channel.postMessage('reauthenticate'); channel.close()
        }
        navigate('/haas/login')
      } catch {
        if (!controller.signal.aborted) {
          error.hidden = false; error.textContent = '退出尚未确认，请重试。确认前不会自动进入原生运行环境。'
          status.textContent = ''
        }
      } finally {
        loggingOut = false
        if (!controller.signal.aborted && !leaving) {
          logout.disabled = false; logout.textContent = '重试退出并切换账户'
          status.removeAttribute('aria-busy'); logout.focus()
        }
      }
    }
    const onRetry = () => { delay = 2_000; void check() }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) navigate('/haas/recover') }
    const dispose = () => {
      controller.abort(); checking?.abort(); if (timer !== undefined) clearTimeout(timer)
      retry.removeEventListener('click', onRetry)
      logout.removeEventListener('click', onLogout)
      window.removeEventListener('online', onRetry); window.removeEventListener('pagehide', dispose)
      // Keep a one-shot restoration guard: a BFCache-restored document must
      // acquire a fresh controller rather than remain permanently aborted.
    }
    retry.addEventListener('click', onRetry); logout.addEventListener('click', onLogout); window.addEventListener('online', onRetry)
    window.addEventListener('pagehide', dispose, { once: true })
    window.addEventListener('pageshow', onPageShow)
    void check()
    return () => { dispose(); window.removeEventListener('pageshow', onPageShow) }
  }
  const form = root.querySelector<HTMLFormElement>('form')!
  const fields = form.querySelector<HTMLFieldSetElement>('fieldset')!
  const error = form.querySelector<HTMLElement>('[data-auth-error]')!
  const status = form.querySelector<HTMLElement>('[data-auth-status]')!
  const submit = fields.querySelector<HTMLButtonElement>('button[type=submit]')!
  const title = root.querySelector<HTMLElement>('h1')!
  const controller = new AbortController()
  let configured = root.dataset.configured === 'true'
  let busy = false
  let attempt: { body: string; key: string } | undefined
  const initialLabel = () => configured ? '登录' : '初始化管理员'
  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (busy || !form.reportValidity()) return
    const values = new FormData(form)
    const input = configured ? { username: String(values.get('username')), password: String(values.get('password')) }
      : { username: String(values.get('username')), password: String(values.get('password')),
        displayName: String(values.get('displayName')), bootstrapSecret: String(values.get('bootstrapSecret')) }
    const body = JSON.stringify(input)
    if (attempt?.body !== body) attempt = { body, key: crypto.randomUUID() }
    busy = true; fields.disabled = true; form.setAttribute('aria-busy', 'true')
    error.hidden = true; error.textContent = ''; status.textContent = ''; submit.textContent = '正在验证…'
    try {
      const response = await fetch(configured ? '/haas/v1/auth/login' : '/haas/v1/bootstrap', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', body,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      const result = await response.json() as { title?: string; data?: { userId?: string; status?: string } }
      if (!response.ok) throw new Error(typeof result.title === 'string' ? result.title : '请求未完成，请重试。')
      if (typeof result.data?.userId !== 'string' || result.data.status !== 'active') throw new Error('企业服务响应无效，请重新验证。')
      attempt = undefined; form.reset()
      if (configured) {
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('paimind.enterprise.auth-change')
          channel.postMessage('reauthenticate'); channel.close()
        }
        status.textContent = '登录成功，正在进入原生宿主…'; navigate('/'); return
      }
      configured = true; root.dataset.configured = 'true'; title.textContent = '登录企业账户'
      root.querySelector<HTMLElement>('[data-auth-description]')!.textContent = '登录后进入原生对话与工作区。'
      for (const group of root.querySelectorAll<HTMLElement>('[data-bootstrap-field]')) {
        group.hidden = true
        const input = group.querySelector<HTMLInputElement>('input')!; input.disabled = true; input.required = false
      }
      form.querySelector<HTMLInputElement>('[name=username]')!.value = input.username
      form.querySelector<HTMLInputElement>('[name=password]')!.autocomplete = 'current-password'
      status.textContent = '管理员已初始化，请登录。'
    } catch (failure) {
      if (!controller.signal.aborted) {
        error.hidden = false; error.textContent = failure instanceof Error ? failure.message : '服务暂时不可用，请重试。'
      }
    } finally {
      if (!controller.signal.aborted) {
        busy = false; fields.disabled = false; form.removeAttribute('aria-busy'); submit.textContent = initialLabel()
        if (!error.hidden) form.querySelector<HTMLInputElement>('[name=password]')!.focus()
        else if (configured) form.querySelector<HTMLInputElement>('[name=password]')!.focus()
      }
    }
  }
  form.addEventListener('submit', onSubmit)
  const dispose = () => { controller.abort(); form.removeEventListener('submit', onSubmit); window.removeEventListener('pagehide', dispose) }
  window.addEventListener('pagehide', dispose, { once: true })
  return dispose
}

export const enterpriseAuthClientSource: string = `(${mountAuthenticationPage.toString()})(document);`
