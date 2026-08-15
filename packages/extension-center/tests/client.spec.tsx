import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    fixture.disposeEffects()
  })

  it('renders product maturity separately from native technical state and filters categories', async () => {
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
    expect(screen.getByText('原生对话')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '自动化' }))
    expect(screen.queryByText('运行状态球')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('当前筛选条件下没有扩展')
    fireEvent.click(screen.getByRole('button', { name: '治理' }))
    expect(screen.getByRole('status')).toHaveTextContent('当前没有可信身份提供方')
    expect(screen.queryByText(/管理员权限/, { selector: 'article *' })).not.toBeInTheDocument()
  })

  it('does not show stale technical truth when Harness inventory fails', async () => {
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={vi.fn().mockRejectedValue(new Error('offline'))}
    />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unavailable'))
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })
})
