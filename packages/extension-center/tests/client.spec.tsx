import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PaimindExtensionCenterClientContext } from '@paimind/harness-compat'
import { createClientContextFixture } from '@paimind/testkit'
import { apply, ExtensionCenterSection } from '../src/client/index.js'

const extension = {
  id: 'paimind:runtime-orbs' as const,
  packageName: '@paimind/runtime-orbs' as const,
  category: 'experience' as const,
  nameZh: '运行状态球', nameEn: 'Runtime Orb',
  descriptionZh: '显示真实运行状态。', descriptionEn: 'Displays real runtime state.',
  surface: 'conversation' as const, maturity: 'available' as const,
}
const extensions = Object.freeze([extension])

describe('Extension Center client contribution', () => {
  it('registers an independent Settings section and its own product descriptor', () => {
    document.getElementById('@paimind/extension-center')?.remove()
    const fixture = createClientContextFixture()
    const context = {
      ...fixture.context,
      remote: { pluginInventory: { list: vi.fn().mockResolvedValue({ ok: true, value: { entries: [] } }) } },
    } as PaimindExtensionCenterClientContext
    apply(context)
    expect(fixture.slots.find(entry => entry.injectedName === 'settings.section')).toMatchObject({
      options: { id: 'paimind-extensions', order: 17 },
    })
    expect(fixture.slots.find(entry => entry.injectedName === 'paimind.extension')).toMatchObject({
      options: { id: 'paimind:extension-center' },
    })
    expect(document.getElementById('@paimind/extension-center')).not.toBeNull()
    fixture.disposeEffects()
    expect(document.getElementById('@paimind/extension-center')).toBeNull()
    expect(fixture.slots.every(entry => entry.disposed())).toBe(true)
  })

  it('explains capability, availability, configuration location, and progressive details', async () => {
    const locale = { getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }
    render(<ExtensionCenterSection
      close={() => {}}
      locale={locale}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => ({ entries: [{ entryId: 'orb', moduleName: '@paimind/runtime-orbs', enabled: true, fiberPhase: 'active' }] })}
    />)
    await waitFor(() => expect(screen.getByText('已加载')).toBeInTheDocument())
    expect(screen.getByText('可用')).toBeInTheDocument()
    expect(screen.getByText('Harness 原生对话与输入区')).toBeInTheDocument()
    expect(screen.getByText('产品能力').parentElement).toHaveTextContent('1产品能力')
    const summary = screen.getByRole('button', { name: /运行状态球/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('产品成熟度')).toBeInTheDocument()
    expect(screen.getByText('Harness 技术状态')).toBeInTheDocument()
    expect(screen.getByText('使用与配置')).toBeInTheDocument()
    expect(screen.getByText('包标识')).toBeInTheDocument()
    expect(screen.getByText('@paimind/runtime-orbs')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /自动化/ }))
    expect(screen.queryByText('运行状态球')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('没有匹配的能力')
    fireEvent.click(screen.getByRole('button', { name: /治理/ }))
    expect(screen.getByRole('status')).toHaveTextContent('当前没有可信身份提供方')
    expect(screen.queryByText(/管理员权限/, { selector: 'article *' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.getByText('运行状态球')).toBeInTheDocument()
  })

  it('searches bilingual metadata and package identity without inventing marketplace facts', async () => {
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => ({ entries: [] })}
    />)
    await waitFor(() => expect(screen.getByText('Not in registry')).toBeInTheDocument())
    const search = screen.getByRole('searchbox', { name: 'Search extensions' })
    fireEvent.change(search, { target: { value: '@paimind/runtime-orbs' } })
    expect(screen.getByText('Runtime Orb')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'no-such-marketplace-rating' } })
    expect(screen.getByRole('status')).toHaveTextContent('No matching capabilities')
    expect(screen.queryByText(/rating|download|verified|update/i)).not.toBeInTheDocument()
  })

  it('does not show stale technical truth when Harness inventory fails and can retry', async () => {
    const listInventory = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ entries: [{ entryId: 'orb', moduleName: '@paimind/runtime-orbs', enabled: true, fiberPhase: 'active' }] })
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={listInventory}
    />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('returned no result'))
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }))
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument())
    expect(listInventory).toHaveBeenCalledTimes(2)
  })

  it('contains loading state without rendering guessed technical status', () => {
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => await new Promise(() => {})}
    />)
    expect(screen.getByText('Reading Harness technical state…')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-paimind-extension-skeleton]')).toHaveLength(3)
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('omits a malformed extension contribution so sibling plugins keep working', async () => {
    const fixture = createClientContextFixture()
    const context = {
      ...fixture.context,
      remote: { pluginInventory: { list: vi.fn().mockResolvedValue({ ok: true, value: { entries: [] } }) } },
    } as PaimindExtensionCenterClientContext
    apply(context)
    const malformed = { id: 'paimind:malformed', packageName: '@paimind/malformed', category: 'unknown' }
    fixture.context.slots.register({
      name: 'paimind.extension',
      id: 'malformed-extension',
      inject: () => ({ descriptor: malformed }),
    }, () => null)
    const settings = fixture.slots.find(entry => entry.injectedName === 'settings.section')
    const SettingsComponent = settings?.component as ComponentType<Record<string, unknown>>
    const injected = settings?.inject?.() as Record<string, unknown>
    render(<><button type="button">Sibling plugin</button><SettingsComponent {...injected} close={() => {}} /></>)
    await waitFor(() => expect(screen.getByText('扩展中心')).toBeInTheDocument())
    expect(screen.queryByText('paimind:malformed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sibling plugin' }))
    expect(screen.getByRole('button', { name: 'Sibling plugin' })).toBeEnabled()
    fixture.disposeEffects()
  })
})
