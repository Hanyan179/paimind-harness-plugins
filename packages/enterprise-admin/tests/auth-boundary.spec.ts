import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enterpriseAuthDocument, enterpriseAuthClientSource, mountAuthenticationPage } from '../src/auth-boundary.js'
import { EnterpriseApi, EnterpriseSession } from '../src/client/api.js'
import { installAuthLifecycle } from '../src/client/auth-lifecycle.js'

const disposers: (() => void)[] = []
const ok = (data: object) => new Response(JSON.stringify({ data }), { status: 200 })
function modalFixture(unsupported = false) {
  for (const name of ['showModal', 'close'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)
    Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, value: function (this: HTMLDialogElement) {
      if (unsupported && name === 'showModal') throw new Error('unsupported')
      this.open = name === 'showModal'
    } })
    disposers.push(() => {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
      else delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[name]
    })
  }
}
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  document.body.innerHTML = ''; document.documentElement.style.visibility = ''; document.documentElement.inert = false
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})
function mount(configured: boolean, mode: 'authenticate' | 'recover' = 'authenticate') {
  const parsed = new DOMParser().parseFromString(enterpriseAuthDocument(configured, mode), 'text/html')
  document.body.innerHTML = parsed.body.innerHTML
  const navigate = vi.fn()
  disposers.push(mountAuthenticationPage(document, navigate))
  return navigate
}
function enter(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function submit() { fireEvent.submit(screen.getByRole('form', { name: '企业账户认证' })) }

describe('minimal authentication boundary (component tests, not Browser E2E)', () => {
  it('has only an authentication form, no application shell or native object facsimiles; client asset is valid standalone JavaScript', () => {
    const html = enterpriseAuthDocument(false)
    expect(html).not.toMatch(/<aside|<nav|id="root"|<style|<script>/)
    expect(html).not.toContain('localStorage')
    expect(() => new Function(enterpriseAuthClientSource)).not.toThrow()
    mount(false)
    expect(screen.getByLabelText('初始化口令')).toBeRequired()
  })
  it('initializes then returns to login, clears secrets and keeps the verified username', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(ok({ userId: 'test', status: 'active' }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(false)
    enter('用户名', 'admin'); enter('姓名', '管理员'); enter('密码', 'Synthetic browser password 2026'); enter('初始化口令', 'x'.repeat(43))
    submit()
    await screen.findByText('管理员已初始化，请登录。')
    expect(screen.getByRole('heading')).toHaveTextContent('登录企业账户')
    expect(screen.getByLabelText('用户名')).toHaveValue('admin')
    expect(screen.getByLabelText('密码')).toHaveValue('')
    expect(screen.getByLabelText('初始化口令')).toBeDisabled()
    expect(navigate).not.toHaveBeenCalled()
    expect(transport.mock.calls[0]![0]).toBe('/haas/v1/bootstrap')
  })
  it('keeps a failed command key stable, blocks duplicate submission, and replaces the full document only after verified login', async () => {
    let resolve!: (value: Response) => void
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(done => { resolve = done }))
      .mockResolvedValueOnce(ok({ userId: 'test', status: 'active' }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true)
    enter('用户名', 'admin'); enter('密码', 'Synthetic browser password 2026')
    submit(); submit()
    expect(transport).toHaveBeenCalledTimes(1)
    resolve(new Response(JSON.stringify({ title: '请重试' }), { status: 503 }))
    await screen.findByText('请重试')
    expect(screen.getByLabelText('密码')).toHaveFocus()
    submit()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(transport.mock.calls[0]![1]!.headers).toEqual(transport.mock.calls[1]![1]!.headers)
    expect(transport.mock.calls[1]![1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
    expect(screen.getByLabelText('密码')).toHaveValue('')
  })
  it('aborts page-owned work on unload', () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', transport)
    mount(true); enter('用户名', 'admin'); enter('密码', 'Synthetic browser password 2026'); submit()
    const signal = transport.mock.calls[0]![1]!.signal!
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(signal.aborted).toBe(true)
  })
})

describe('native document authentication lifecycle', () => {
  async function fixture(observeConnectionLoss?: (onLoss: () => void) => () => void) {
    const account = { userId: 'admin-a', tenantId: 'tenant', username: 'admin', displayName: '管理员', role: 'admin', status: 'active' }
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => ok(account))
    const session = new EnterpriseSession(new EnterpriseApi(transport))
    disposers.push(() => session.dispose())
    await session.refresh()
    const navigate = vi.fn()
    disposers.push(installAuthLifecycle(session, navigate, observeConnectionLoss))
    return { session, transport, account, navigate }
  }
  it('isolates a lost native worker while login remains valid, and requires both original recovery checks before return', async () => {
    modalFixture()
    let lost!: () => void
    const stop = vi.fn(), postMessage = vi.fn()
    vi.stubGlobal('BroadcastChannel', class {
      postMessage = postMessage
      addEventListener() {} removeEventListener() {} close() {}
    })
    const { session, account, navigate } = await fixture(listener => { lost = listener; return stop })
    let nativeAvailable = false
    const recovery = vi.fn<typeof fetch>().mockImplementation(async path => path === '/haas/v1/auth/me' ? ok(account)
      : nativeAvailable ? new Response('<!doctype html><title>Original native host</title>', { headers: { 'content-type': 'text/html' } })
        : new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', recovery)
    lost(); lost()
    expect(session.getSnapshot()).toEqual({ status: 'ready', account })
    expect(document.documentElement.inert).toBe(true)
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(screen.getAllByRole('dialog', { name: '正在恢复连接' })).toHaveLength(1)
    await screen.findByText('登录仍有效，但原生运行环境暂不可用。将自动重试；若持续未恢复，请联系管理员。')
    expect(navigate).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled()
    await session.refresh()
    expect(document.documentElement.inert).toBe(true); expect(navigate).not.toHaveBeenCalled()
    nativeAvailable = true
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/'))
    expect(recovery.mock.calls.map(([path]) => path)).toEqual(['/haas/v1/auth/me', '/', '/haas/v1/auth/me', '/'])
    expect(postMessage).not.toHaveBeenCalled()
  })
  it('removes the native connection observer when the enterprise plugin unloads', async () => {
    const stop = vi.fn()
    await fixture(() => stop)
    disposers.pop()!()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(document.documentElement.inert).toBe(false)
    expect(document.querySelector('[data-paimind-auth-recovery]')).toBeNull()
  })
  it('locks and replaces the whole native document immediately on logout', async () => {
    const { session, navigate } = await fixture()
    session.invalidate()
    expect(document.documentElement.inert).toBe(true)
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(navigate).toHaveBeenCalledWith('/haas/login')
  })
  it('does not retain native UI state when a fresh identity read returns another account', async () => {
    const { session, transport, account, navigate } = await fixture()
    transport.mockImplementation(async () => ok({ ...account, userId: 'admin-b' }))
    await session.refresh()
    expect(navigate).toHaveBeenCalledWith('/haas/recover')
  })
  it('discards native administrative memory when the same user loses their admin role', async () => {
    const { session, transport, account, navigate } = await fixture()
    transport.mockImplementation(async () => ok({ ...account, role: 'member' }))
    await session.refresh()
    expect(document.documentElement.inert).toBe(true)
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/recover')
  })
  it('locks the native document on a transient 503 without treating it as logout', async () => {
    const postMessage = vi.fn()
    vi.stubGlobal('BroadcastChannel', class {
      postMessage = postMessage
      addEventListener() {} removeEventListener() {} close() {}
    })
    // JSDOM has no top layer; actual modality/inertness needs browser evidence.
    modalFixture()
    const { session, transport, navigate } = await fixture()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}', { status: 503 })))
    transport.mockImplementation(async () => new Response(JSON.stringify({ title: '暂时不可用' }), { status: 503 }))
    await session.refresh()
    expect(session.getSnapshot().status).toBe('unavailable')
    expect(document.documentElement.inert).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    await screen.findByText('企业服务仍不可用，将自动重试。你也可以重新验证。')
    expect(screen.getByRole('dialog', { name: '正在恢复连接' })).toHaveAttribute('open')
    expect(postMessage).not.toHaveBeenCalled()
    expect(transport.mock.calls.every(([url]) => String(url).endsWith('/auth/me'))).toBe(true)
  })
  it('keeps one isolated recovery dialog across failures and only replaces the document after BOTH fresh checks', async () => {
    modalFixture()
    const { session, transport, account, navigate } = await fixture()
    let restored = false
    const recovery = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (!restored) throw new TypeError('Failed to fetch')
      return path === '/haas/v1/auth/me' ? ok(account)
        : new Response('<!doctype html><title>Native document</title>', { headers: { 'content-type': 'text/html' } })
    })
    vi.stubGlobal('fetch', recovery)
    transport.mockRejectedValue(new TypeError('Failed to fetch'))
    await session.refresh()
    await screen.findByText('企业服务仍不可用，将自动重试。你也可以重新验证。')
    const dialog = screen.getByRole('dialog', { name: '正在恢复连接' })
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(dialog).toHaveAttribute('open')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    dialog.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(dialog).toHaveAttribute('closedby', 'none')
    ;(dialog as HTMLDialogElement).open = false
    dialog.dispatchEvent(new Event('close'))
    expect(dialog).toHaveAttribute('open')
    await session.refresh()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(navigate).not.toHaveBeenCalled()
    restored = true
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/'))
    expect(recovery.mock.calls.map(([url]) => url)).toEqual(['/haas/v1/auth/me', '/haas/v1/auth/me', '/'])
    expect(recovery.mock.calls.every(([, options]) => options?.credentials === 'same-origin'
      && options.cache === 'no-store' && options.redirect === 'error')).toBe(true)
    expect(document.documentElement.inert).toBe(true)
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(document.querySelector('[data-paimind-auth-recovery]')).toBeNull()
  })
  it('does not re-expose the old document just because the original identity watcher recovers', async () => {
    modalFixture()
    const { session, transport, account, navigate } = await fixture()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async path => path === '/haas/v1/auth/me'
      ? ok(account) : new Response('{}', { status: 503 })))
    transport.mockRejectedValue(new TypeError('Failed to fetch'))
    await session.refresh()
    await screen.findByText('登录仍有效，但原生运行环境暂不可用。将自动重试；若持续未恢复，请联系管理员。')
    transport.mockImplementation(async () => ok(account))
    await session.refresh()
    expect(session.getSnapshot().status).toBe('ready')
    expect(navigate).not.toHaveBeenCalled()
    expect(document.documentElement.inert).toBe(true)
    expect(document.documentElement.style.visibility).toBe('hidden')
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
  })
  it.each(['logout', 'identity', 'pagehide', 'unload'] as const)('aborts inline recovery and never accepts a late check after %s', async kind => {
    modalFixture()
    const { session, transport, account, navigate } = await fixture()
    const dispose = disposers[disposers.length - 1]!
    let release!: (response: Response) => void
    const recovery = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { release = resolve }))
    vi.stubGlobal('fetch', recovery)
    transport.mockRejectedValue(new TypeError('Failed to fetch'))
    await session.refresh()
    expect(recovery).toHaveBeenCalledTimes(1)
    const signal = recovery.mock.calls[0]![1]!.signal!
    if (kind === 'logout') session.invalidate()
    else if (kind === 'identity') {
      transport.mockImplementation(async () => ok({ ...account, userId: 'another' }))
      await session.refresh()
    } else if (kind === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide'))
    else dispose()
    expect(signal.aborted).toBe(true)
    expect(document.querySelector('[data-paimind-auth-recovery]')).toBeNull()
    expect(document.documentElement.inert).toBe(true)
    release(ok(account))
    await Promise.resolve(); await Promise.resolve()
    expect(recovery).toHaveBeenCalledTimes(1)
    if (kind === 'logout') expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/login')
    else if (kind === 'identity') expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/recover')
    else expect(navigate).not.toHaveBeenCalled()
    if (kind === 'pagehide') {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/recover')
    }
  })
  it('fails closed and removes partial recovery UI if the browser cannot create a native modal', async () => {
    modalFixture(true)
    const { session, transport, navigate } = await fixture()
    transport.mockRejectedValue(new TypeError('Failed to fetch'))
    await session.refresh()
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/recover')
    expect(document.querySelector('[data-paimind-auth-recovery]')).toBeNull()
    expect(document.documentElement.inert).toBe(true)
    expect(document.documentElement.style.visibility).toBe('hidden')
  })
  it('removes lifecycle listeners on plugin unload while preserving the native document', async () => {
    const { session, navigate } = await fixture()
    disposers.pop()!()
    session.invalidate()
    expect(navigate).not.toHaveBeenCalled()
    expect(document.documentElement.style.visibility).toBe('')
  })
})

describe('minimal connection recovery boundary (component tests, not Browser E2E)', () => {
  const account = { userId: 'admin-a', tenantId: 'tenant', username: 'admin', displayName: '管理员', role: 'admin', status: 'active' }
  it.each([false, true])('restores keyboard retry focus without stealing a later focus choice (moved: %s)', async moved => {
    let resolveRetry!: (response: Response) => void
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(() => new Promise(resolve => { resolveRetry = resolve }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText('企业服务仍不可用，将自动重试。你也可以重新验证。')
    const retry = screen.getByRole('button', { name: '重新验证' })
    retry.focus(); fireEvent.click(retry)
    expect(retry).toBeDisabled()
    // JSDOM does not move focus when disabling a focused button; the real
    // browser diagnostic does. Model that transition explicitly, not modality.
    retry.blur()
    const logout = screen.getByRole('button', { name: '退出并切换账户' })
    if (moved) logout.focus()
    resolveRetry(new Response('{}', { status: 503 }))
    await waitFor(() => expect(retry).toBeEnabled())
    expect(moved ? logout : retry).toHaveFocus()
    expect(navigate).not.toHaveBeenCalled()
  })
  it('shows the verified normal member name and permits logout when no runtime is available', async () => {
    const member = { ...account, username: 'hansen', displayName: 'Hansen', role: 'member' }
    const postMessage = vi.fn()
    vi.stubGlobal('BroadcastChannel', class { postMessage = postMessage; close() {} })
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => path === '/haas/v1/auth/me'
      ? ok(member) : path === '/haas/v1/auth/logout' ? ok({ loggedOut: true }) : new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText('Hansen（hansen）')
    await screen.findByText(/登录仍有效，但原生运行环境暂不可用/)
    fireEvent.click(screen.getByRole('button', { name: '退出并切换账户' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/login'))
    expect(screen.queryByText('Hansen（hansen）')).toBeNull()
    expect(postMessage).toHaveBeenCalledExactlyOnceWith('reauthenticate')
    expect(transport.mock.calls.at(-1)).toMatchObject(['/haas/v1/auth/logout', {
      method: 'POST', body: '{}', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    }])
  })
  it('cancels a pending native check and suppresses its late successful navigation during logout', async () => {
    let nativeDone!: (value: Response) => void
    let logoutDone!: (value: Response) => void
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (path === '/haas/v1/auth/me') return ok(account)
      return new Promise(done => { if (path === '/') nativeDone = done; else logoutDone = done })
    })
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2))
    const button = screen.getByRole('button', { name: '退出并切换账户' })
    fireEvent.click(button); fireEvent.click(button)
    expect(transport).toHaveBeenCalledTimes(3)
    expect(transport.mock.calls[1]![1]!.signal!.aborted).toBe(true)
    nativeDone(new Response('<html>native</html>', { headers: { 'content-type': 'text/html' } }))
    await Promise.resolve(); await Promise.resolve()
    expect(navigate).not.toHaveBeenCalled()
    logoutDone(ok({ loggedOut: true }))
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/login'))
  })
  it('keeps the logout command key after an uncertain response and never resumes automatic admission', async () => {
    let logoutCalls = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (path === '/haas/v1/auth/me') return ok(account)
      if (path === '/') return new Response('{}', { status: 503 })
      if (++logoutCalls === 1) throw new TypeError('Synthetic lost response')
      return ok({ loggedOut: true })
    })
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText(/登录仍有效，但原生运行环境暂不可用/)
    fireEvent.click(screen.getByRole('button', { name: '退出并切换账户' }))
    await screen.findByRole('alert')
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重新验证' })).toBeDisabled()
    const retryLogout = screen.getByRole('button', { name: '重试退出并切换账户' })
    expect(retryLogout).toHaveFocus()
    window.dispatchEvent(new Event('online'))
    expect(transport).toHaveBeenCalledTimes(3)
    fireEvent.click(retryLogout)
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/login'))
    expect(transport.mock.calls[2]![1]!.headers).toEqual(transport.mock.calls[3]![1]!.headers)
  })
  it.each([401, 200])('handles expired logout or an invalid success body without claiming unverified logout (%s)', async status => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async path => path === '/haas/v1/auth/me'
      ? ok(account) : path === '/' ? new Response('{}', { status: 503 }) : new Response('{}', { status })))
    const navigate = mount(true, 'recover')
    await screen.findByText(/登录仍有效，但原生运行环境暂不可用/)
    fireEvent.click(screen.getByRole('button', { name: '退出并切换账户' }))
    if (status === 401) await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/login'))
    else { await screen.findByRole('alert'); expect(navigate).not.toHaveBeenCalled() }
  })
  it('aborts an in-flight logout on unload and ignores its late response', async () => {
    let logoutDone!: (value: Response) => void
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => path === '/haas/v1/auth/me'
      ? ok(account) : path === '/' ? new Response('{}', { status: 503 }) : new Promise(done => { logoutDone = done }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText(/登录仍有效，但原生运行环境暂不可用/)
    fireEvent.click(screen.getByRole('button', { name: '退出并切换账户' }))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(transport.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true)
    logoutDone(ok({ loggedOut: true })); await Promise.resolve(); await Promise.resolve()
    expect(navigate).not.toHaveBeenCalled()
  })
  it('retains no native content or credentials and recovers through a fresh identity read, not a login command', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response('{}', { status: 503 }))
      .mockImplementationOnce(async () => ok(account))
      .mockImplementationOnce(async () => new Response('<html>native document</html>', { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText(/企业服务仍不可用/)
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByLabelText('密码')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/'))
    expect(transport.mock.calls.map(([url]) => url)).toEqual(['/haas/v1/auth/me', '/haas/v1/auth/me', '/'])
    expect(transport.mock.calls.every(([, init]) => !init?.body && init?.redirect === 'error')).toBe(true)
    expect(transport.mock.calls[2]![1]!.headers).toEqual({ Accept: 'text/html' })
  })
  it.each([502, 503, 200])('does not navigate just because identity works when the native root is not valid HTML (%s)', async status => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => url === '/haas/v1/auth/me'
      ? ok(account) : new Response('{}', { status, headers: { 'content-type': 'application/problem+json' } }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText(/登录仍有效，但原生运行环境暂不可用/)
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重新验证' })).toBeEnabled()
    expect(transport.mock.calls.map(([url]) => url)).toEqual(['/haas/v1/auth/me', '/'])
  })
  it('keeps a runtime permission rejection on an actionable recovery page, without a login or redirect loop', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => url === '/haas/v1/auth/me'
      ? ok(account) : new Response('{}', { status: 403 }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText(/请联系管理员配置权限后重新验证/)
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重新验证' })).toBeEnabled()
  })
  it('checks revocation again on native admission and does not return to the app with only an earlier valid identity', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => url === '/haas/v1/auth/me'
      ? ok(account) : new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/login'))
  })
  it.each([401, 403])('only a real authorization rejection (%s) returns to login', async status => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}', { status })))
    const navigate = mount(true, 'recover')
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/login'))
  })
  it('rejects malformed successful identity responses and suppresses late navigation after unload', async () => {
    let resolve!: (response: Response) => void
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(async () => ok({ ...account, role: 'super-admin' }))
      .mockImplementationOnce(() => new Promise(done => { resolve = done }))
    vi.stubGlobal('fetch', transport)
    const navigate = mount(true, 'recover')
    await screen.findByText(/企业服务仍不可用/)
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }))
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }))
    expect(transport).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(transport.mock.calls[1]![1]!.signal!.aborted).toBe(true)
    resolve(ok(account)); await Promise.resolve(); await Promise.resolve()
    expect(navigate).not.toHaveBeenCalled()
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/haas/recover')
  })
})
