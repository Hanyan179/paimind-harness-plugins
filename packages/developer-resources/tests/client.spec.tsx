import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindExtensionDescriptor } from '@hansen/contracts'
import type { PaimindDeveloperResourcesClientContext } from '@hansen/harness-compat'
import { createClientContextFixture } from '@hansen/testkit'
import { apply, DeveloperResourcesSection } from '../src/client/index.js'

const runtimeOrb: PaimindExtensionDescriptor = {
  id: 'paimind:runtime-orbs', packageName: '@hansen/runtime-orbs', category: 'experience',
  nameZh: '运行状态球', nameEn: 'Runtime Orb', descriptionZh: '真实状态。', descriptionEn: 'Real state.',
  surface: 'conversation', maturity: 'available',
}
const extensions = Object.freeze([runtimeOrb])

const snapshot = { entries: [
  { entryId: 'orb-root', moduleName: '@hansen/runtime-orbs', enabled: true, fiberPhase: 'active' as const },
  { entryId: 'orb-invariant', moduleName: '@hansen/runtime-orbs/invariant', enabled: true, fiberPhase: 'active' as const },
  { entryId: 'native', moduleName: '@deepseek-ai/dsh-native', enabled: true, fiberPhase: 'active' as const },
] }

function locale(active = 'en-US') {
  return { getLocale: () => ({ active }), subscribe: () => () => {} }
}

describe('Developer Resources client', () => {
  it('registers one native Settings section and Developer descriptor', () => {
    const fixture = createClientContextFixture()
    apply({
      ...fixture.context,
      remote: { pluginInventory: { list: vi.fn().mockResolvedValue({ ok: true, value: snapshot }) } },
    } as PaimindDeveloperResourcesClientContext)
    expect(fixture.slots.find(entry => entry.injectedName === 'settings.section')).toMatchObject({
      options: { id: 'paimind-developer-resources', order: 25 },
    })
    expect(fixture.slots.find(entry => entry.injectedName === 'paimind.extension')).toMatchObject({
      options: { id: 'paimind:developer-resources' },
    })
    const style = document.getElementById('@hansen/developer-resources')?.textContent ?? ''
    expect(style).toContain('@media(max-width:600px){[data-paimind-developer-tabs]')
    expect(style).not.toContain(":has([data-paimind-developer-resources])>nav")
    fixture.disposeEffects()
  })

  it('does not declare a second paimind.extension child-slot owner', () => {
    const fixture = createClientContextFixture()
    apply({
      ...fixture.context,
      remote: { pluginInventory: { list: vi.fn().mockResolvedValue({ ok: true, value: snapshot }) } },
    } as PaimindDeveloperResourcesClientContext)
    const section = fixture.slots.find(entry => entry.injectedName === 'settings.section')
    expect(section?.options.children).toBeUndefined()
    fixture.disposeEffects()
  })

  it('renders exact native diagnostics without non-rows or guessed fields', async () => {
    render(<DeveloperResourcesSection close={() => {}} locale={locale()} getExtensions={() => extensions} subscribeExtensions={() => () => {}} listInventory={async () => snapshot} />)
    await waitFor(() => expect(screen.getByText('@hansen/runtime-orbs')).toBeInTheDocument())
    expect(screen.getByText('@hansen/runtime-orbs/invariant')).toBeInTheDocument()
    expect(screen.getByText('orb-root')).toBeInTheDocument()
    expect(screen.queryByText('@deepseek-ai/dsh-native')).not.toBeInTheDocument()
    expect(screen.getByText(/no versions, dependency graph, or failure stack/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enable|disable|install|uninstall/i })).not.toBeInTheDocument()
    expect(screen.getByText('2 @hansen/* Loader entries', { exact: false })).toBeInTheDocument()
  })

  it('uses live extension contributions for surfaces and bundled labels for references', async () => {
    render(<DeveloperResourcesSection close={() => {}} locale={locale()} getExtensions={() => extensions} subscribeExtensions={() => () => {}} listInventory={async () => snapshot} />)
    await waitFor(() => expect(screen.getByText('@hansen/runtime-orbs')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Surface Catalog' }))
    const surface = screen.getByText('Runtime Orb').closest('li')
    expect(surface).not.toBeNull()
    expect(within(surface as HTMLElement).getByText('Experience')).toBeInTheDocument()
    expect(within(surface as HTMLElement).getByText('conversation')).toBeInTheDocument()
    expect(within(surface as HTMLElement).getByText('Active')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Integration Reference' }))
    expect(screen.getAllByText('Bundled reference')).toHaveLength(8)
    expect(screen.getByText('paimind.tool-result/v1')).toBeInTheDocument()
    expect(screen.getByText('paimindSidebar')).toBeInTheDocument()
    expect(screen.getByText(/not runtime discovery/i)).toBeInTheDocument()
  })

  it('discards technical truth on failure and retries the native Remote', async () => {
    const listInventory = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snapshot)
    render(<DeveloperResourcesSection close={() => {}} locale={locale('zh-CN')} getExtensions={() => extensions} subscribeExtensions={() => () => {}} listInventory={listInventory} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('没有展示缓存或猜测状态'))
    expect(screen.queryByText('@hansen/runtime-orbs')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByText('@hansen/runtime-orbs')).toBeInTheDocument())
    expect(listInventory).toHaveBeenCalledTimes(2)
  })
})
