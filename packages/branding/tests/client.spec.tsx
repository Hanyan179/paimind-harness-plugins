import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentType } from 'react'
import { createClientContextFixture } from '@hansen/testkit'
import type { PaimindSettingsScope, PaimindSettingsScopeSnapshot } from '@hansen/harness-compat'
import { apply } from '../src/client/index.js'
import { DEFAULT_BRANDING, type BrandingSettings } from '../src/settings.js'

class FakeScope implements PaimindSettingsScope<BrandingSettings> {
  listeners = new Set<() => void>()
  fail = false
  recoverFailure = false
  snapshot: PaimindSettingsScopeSnapshot<BrandingSettings> = {
    status: 'ready', value: DEFAULT_BRANDING, base: {}, user: {}, revision: 1, writable: true, mode: 'host',
  }
  getSnapshot = () => this.snapshot
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback) } }
  async set(field: keyof BrandingSettings, value: unknown) {
    if (this.fail) throw new Error('Connection lost')
    if (this.recoverFailure) return
    this.push({ ...this.snapshot.value!, [field]: value })
  }
  async unset(field: keyof BrandingSettings) { await this.set(field, DEFAULT_BRANDING[field]) }
  push(value: BrandingSettings) {
    this.snapshot = { ...this.snapshot, value, revision: this.snapshot.revision! + 1 }
    for (const listener of this.listeners) listener()
  }
}
function setup(scope = new FakeScope()) {
  document.head.innerHTML = '<title>Planning — DeepSeek Harness</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest">'
  document.body.innerHTML = '<div id="hero"><span id="fish"><svg viewBox="0 0 20 20"></svg></span><span id="headline">探索未至之境</span><span id="preview">预览版</span></div>'
  const fixture = createClientContextFixture()
  apply({ ...fixture.context, settingsScope: { bind: () => scope } } as Parameters<typeof apply>[0])
  const component = (name: string) => fixture.slots.find(entry => entry.injectedName === name)!.component as ComponentType
  const Overlay = component('shell.overlay')
  const Name = component('sidebar.brand.name')
  const Mark = component('sidebar.brand.mark')
  const Settings = component('settings.section')
  const view = render(<><Overlay /><Name /><Mark /><Settings /></>)
  return { scope, fixture, view }
}
afterEach(() => { cleanup(); document.body.innerHTML = ''; document.head.innerHTML = ''; document.documentElement.style.colorScheme = '' })

describe('Configurable branding', () => {
  it('saves the brand through native Settings, updates every shell surface and restores native identity on unload', async () => {
    const { fixture, scope, view } = setup()
    await screen.findByText('从一个想法开始', { selector: '[data-hansen-brand-hero-headline]' })
    expect(document.title).toBe('Planning — Hansen')
    expect(document.body.textContent).not.toMatch(/Paramont|PAIMind/)
    const field = screen.getByLabelText('品牌名称').closest('form')!
    fireEvent.change(screen.getByLabelText('品牌名称'), { target: { value: '远山实验室' } })
    fireEvent.click(within(field).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(document.title).toBe('Planning — 远山实验室'))
    expect(scope.snapshot.value?.brandName).toBe('远山实验室')
    expect(document.querySelector('[data-hansen-brand-name]')).toHaveTextContent('远山实验室')
    expect(document.querySelector('[data-hansen-brand-mark]')).toHaveAttribute('aria-label', '远山实验室')
    const manifest = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href
    expect(JSON.parse(decodeURIComponent(manifest.split(',')[1]!)).name).toBe('远山实验室')
    document.title = 'Live session — DeepSeek Harness'
    await waitFor(() => expect(document.title).toBe('Live session — 远山实验室'))
    fireEvent.click(within(field).getByRole('button', { name: '恢复默认' }))
    await waitFor(() => expect(document.title).toBe('Live session — Hansen'))
    view.unmount(); fixture.disposeEffects()
    expect(scope.listeners.size).toBe(0)
    expect(document.title).toBe('Live session — DeepSeek Harness')
    expect(document.querySelector('link[rel=icon]')).toHaveAttribute('href', '/favicon.svg')
    expect(document.querySelector('link[rel=icon]')).toHaveAttribute('type', 'image/svg+xml')
    expect(document.querySelector('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest')
    expect(document.querySelector('[data-paimind-native-hero-brand]')).toBeNull()
    expect(document.querySelector('[data-paimind-hero-brand-seat]')).toBeNull()
    expect(document.getElementById('@hansen/branding')).toBeNull()
    expect(fixture.slots.every(entry => entry.disposed())).toBe(true)
  })

  it('uses persisted values on a fresh mount, switches logo with theme and handles broken images', async () => {
    const scope = new FakeScope()
    scope.push({ ...DEFAULT_BRANDING, brandName: 'North', logoUrl: '/logo.png', darkLogoUrl: '/dark.png', welcomeZh: '欢迎回来', welcomeEn: 'Welcome back' })
    const { fixture, view } = setup(scope)
    await waitFor(() => expect(document.title).toBe('Planning — North'))
    expect(document.querySelector('[data-hansen-brand-mark] img')).toHaveAttribute('src', '/logo.png')
    document.documentElement.style.colorScheme = 'dark'
    await waitFor(() => expect(document.querySelector('[data-hansen-brand-mark] img')).toHaveAttribute('src', '/dark.png'))
    fireEvent.error(document.querySelector('[data-hansen-brand-mark] img')!)
    expect(document.querySelector('[data-hansen-brand-mark]')).toHaveTextContent('NO')
    document.querySelector('#headline')!.textContent = 'Into the Unknown'
    document.querySelector('#preview')!.textContent = 'Preview'
    await screen.findByText('Welcome back', { selector: '[data-hansen-brand-hero-headline]' })
    act(() => scope.push({ ...scope.snapshot.value!, brandName: 'Remote change' }))
    await waitFor(() => expect(document.title).toBe('Planning — Remote change'))
    view.unmount(); fixture.disposeEffects()
  })

  it('rejects executable image URLs and leaves the saved identity unchanged on a write failure', async () => {
    const { scope, fixture, view } = setup()
    const logo = screen.getByLabelText('品牌标志')
    fireEvent.change(logo, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(within(logo.closest('form')!).getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('有效的图片地址')
    expect(scope.snapshot.value?.logoUrl).toBe('')
    scope.fail = true
    const name = screen.getByLabelText('品牌名称')
    fireEvent.change(name, { target: { value: 'Unsaved' } })
    fireEvent.click(within(name.closest('form')!).getByRole('button', { name: '保存' }))
    await screen.findByText('Connection lost')
    expect(document.title).toBe('Planning — Hansen')
    expect(scope.snapshot.value?.brandName).toBe('Hansen')
    view.unmount(); fixture.disposeEffects()
  })

  it('uploads a persistent image and saves it instead of a temporary blob URL', async () => {
    const { scope, fixture, view } = setup()
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('上传品牌标志'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByLabelText('品牌标志')).toHaveAttribute('placeholder', '已选择上传的图片；输入地址可替换'))
    expect(screen.getByLabelText('品牌标志')).toHaveValue('')
    fireEvent.click(within(screen.getByLabelText('品牌标志').closest('form')!).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(scope.snapshot.value?.logoUrl).toBe('data:image/png;base64,iVBORw=='))
    expect(document.querySelector('link[rel=icon]')).not.toHaveAttribute('type', 'image/svg+xml')
    view.unmount(); fixture.disposeEffects()
  })

  it('does not report success when native Settings silently recovers a rejected write', async () => {
    const { scope, fixture, view } = setup()
    scope.recoverFailure = true
    const name = screen.getByLabelText('品牌名称')
    fireEvent.change(name, { target: { value: 'Not committed' } })
    fireEvent.click(within(name.closest('form')!).getByRole('button', { name: '保存' }))
    await screen.findByText('未保存，请检查连接后重试。')
    expect(screen.queryByText('已保存')).toBeNull()
    expect(name).toHaveValue('Not committed')
    expect(document.title).toBe('Planning — Hansen')
    view.unmount(); fixture.disposeEffects()
  })

  it('does not offer writes while host persistence is unavailable', () => {
    const scope = new FakeScope()
    scope.snapshot = { ...scope.snapshot, mode: 'memory', writable: true }
    const { fixture, view } = setup(scope)
    expect(screen.getByLabelText('品牌名称')).toBeDisabled()
    expect(screen.getByText('品牌设置当前不可写，请检查主机连接。')).toBeInTheDocument()
    view.unmount(); fixture.disposeEffects()
  })
})
