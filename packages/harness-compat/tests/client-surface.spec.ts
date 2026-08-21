import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PaimindAgentBuilderRequestController,
  PaimindProductSurfaceController,
  installPaimindProductCenterHost,
  setPaimindProductCenterNativeConversation,
  installPaimindProductSurfaceInteraction,
  resolvePaimindProductCenterHost,
  requestPaimindAgentBuilder,
} from '../src/client-surface.js'

afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  vi.useRealTimers()
})

describe('PAIMind product surface controller', () => {
  it('keeps independently installed Agent and Skill surfaces mutually exclusive', () => {
    const agents = new PaimindProductSurfaceController('agent-center', window, document)
    const skills = new PaimindProductSurfaceController('skill-center', window, document)

    agents.open()
    expect(agents.getSnapshot().open).toBe(true)
    expect(skills.getSnapshot().open).toBe(false)

    skills.open()
    expect(agents.getSnapshot().open).toBe(false)
    expect(skills.getSnapshot().open).toBe(true)

    agents.dispose()
    skills.dispose()
  })

  it('restores focus to the invoking sidebar action on close', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button data-paimind-product-trigger="agent-center">Agent Center</button>'
    const trigger = document.querySelector<HTMLButtonElement>('button')!
    const controller = new PaimindProductSurfaceController('agent-center', window, document)

    controller.open(trigger)
    controller.close()
    vi.runAllTimers()

    expect(document.activeElement).toBe(trigger)
    controller.dispose()
  })

  it('routes a creation-assistant request into the existing Agent Center without creating a domain entity', () => {
    const surface = new PaimindProductSurfaceController('agent-center', window, document)
    const builder = new PaimindAgentBuilderRequestController(surface, window)
    const listener = vi.fn()
    const unsubscribe = builder.subscribe(listener)

    requestPaimindAgentBuilder({ productKind: 'business', brief: '  Build a PDM review Agent  ' }, window)

    expect(surface.getSnapshot().open).toBe(true)
    expect(builder.getSnapshot()).toEqual({
      revision: 1,
      productKind: 'business',
      brief: 'Build a PDM review Agent',
    })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    builder.dispose()
    requestPaimindAgentBuilder({ productKind: 'personal' }, window)
    expect(builder.getSnapshot().revision).toBe(1)
    surface.dispose()
  })
})

describe('PAIMind product Center host adapter', () => {
  function harnessShell(): {
    readonly center: HTMLElement
    readonly conversation: HTMLElement
    readonly conversationContent: HTMLElement
  } {
    document.body.innerHTML = `
      <div data-slot="root">
        <div data-harness-frame>
          <aside data-harness-sidebar></aside>
          <main data-harness-center>
            <div data-slot="conversation" style="display: contents">
              <section data-native-conversation></section>
            </div>
          </main>
          <aside data-harness-details></aside>
          <div data-shell-overlay></div>
        </div>
      </div>
    `
    return {
      center: document.querySelector<HTMLElement>('[data-harness-center]')!,
      conversation: document.querySelector<HTMLElement>('[data-slot="conversation"]')!,
      conversationContent: document.querySelector<HTMLElement>('[data-native-conversation]')!,
    }
  }

  it('resolves the native conversation parent as the only portal mount', () => {
    const fixture = harnessShell()
    const target = resolvePaimindProductCenterHost(document)

    expect(target).toEqual({ mount: fixture.center, nativeConversation: fixture.conversation })
    expect(target?.mount).not.toBe(document.body)
  })

  it('fails closed for absent, ambiguous, detached, body-level, or structurally ambiguous anchors', () => {
    expect(resolvePaimindProductCenterHost(document)).toBeNull()

    document.body.innerHTML = `
      <main>
        <div data-slot="conversation"><section></section></div>
        <div data-slot="conversation"><section></section></div>
      </main>
    `
    expect(resolvePaimindProductCenterHost(document)).toBeNull()

    document.body.innerHTML = '<div data-slot="conversation"><section></section></div>'
    expect(resolvePaimindProductCenterHost(document)).toBeNull()

    document.body.innerHTML = '<main><div data-slot="conversation"></div></main>'
    expect(resolvePaimindProductCenterHost(document)).toBeNull()

    document.body.innerHTML = `
      <main><div data-slot="conversation"><section></section><section></section></div></main>
    `
    expect(resolvePaimindProductCenterHost(document)).toBeNull()

    document.body.innerHTML = `
      <main><div data-slot="conversation"><svg xmlns="http://www.w3.org/2000/svg"></svg></div></main>
    `
    expect(resolvePaimindProductCenterHost(document)).toBeNull()

    const detached = document.createElement('main')
    const anchor = document.createElement('div')
    anchor.dataset.slot = 'conversation'
    anchor.append(document.createElement('section'))
    detached.append(anchor)
    expect(installPaimindProductCenterHost({ mount: detached, nativeConversation: anchor })).toBeNull()
  })

  it('isolates the native conversation and restores an unmodified host exactly', () => {
    const fixture = harnessShell()
    const target = resolvePaimindProductCenterHost(document)!

    const dispose = installPaimindProductCenterHost(target)
    expect(dispose).not.toBeNull()
    expect(fixture.conversation).toHaveAttribute('inert')
    expect(fixture.conversation).toHaveAttribute('aria-hidden', 'true')
    expect(fixture.center).toHaveAttribute('data-paimind-product-center-host', '')
    expect(fixture.conversationContent).toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
      '',
    )
    expect(fixture.center.style.position).toBe('relative')

    dispose?.()
    expect(fixture.conversation).not.toHaveAttribute('inert')
    expect(fixture.conversation).not.toHaveAttribute('aria-hidden')
    expect(fixture.center).not.toHaveAttribute('data-paimind-product-center-host')
    expect(fixture.conversationContent).not.toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
    )
    expect(fixture.center).not.toHaveAttribute('style')
  })

  it('reveals the same native conversation for split authoring and can isolate it again', () => {
    const fixture = harnessShell()
    const target = resolvePaimindProductCenterHost(document)!
    const dispose = installPaimindProductCenterHost(target)!

    expect(setPaimindProductCenterNativeConversation(target, true)).toBe(true)
    expect(fixture.conversation).not.toHaveAttribute('inert')
    expect(fixture.conversation).not.toHaveAttribute('aria-hidden')
    expect(fixture.center).toHaveAttribute('data-paimind-product-center-native-conversation', '')

    expect(setPaimindProductCenterNativeConversation(target, true, false)).toBe(true)
    expect(fixture.conversation).toHaveAttribute('inert')
    expect(fixture.center).toHaveAttribute('data-paimind-product-center-native-conversation-disabled', '')

    expect(setPaimindProductCenterNativeConversation(target, true)).toBe(true)
    expect(fixture.conversation).not.toHaveAttribute('inert')
    expect(fixture.center).not.toHaveAttribute('data-paimind-product-center-native-conversation-disabled')

    expect(setPaimindProductCenterNativeConversation(target, false)).toBe(true)
    expect(fixture.conversation).toHaveAttribute('inert')
    expect(fixture.conversation).toHaveAttribute('aria-hidden', 'true')
    expect(fixture.center).not.toHaveAttribute('data-paimind-product-center-native-conversation')

    dispose()
    expect(fixture.conversation).not.toHaveAttribute('inert')
    expect(fixture.conversation).not.toHaveAttribute('aria-hidden')
  })

  it('restores pre-existing attributes, marker, and positioning byte-for-byte', () => {
    const fixture = harnessShell()
    fixture.conversation.setAttribute('inert', 'inert')
    fixture.conversation.setAttribute('aria-hidden', 'false')
    fixture.center.setAttribute('data-paimind-product-center-host', 'native-owner')
    fixture.center.setAttribute('style', 'position: absolute; color: red;')
    fixture.conversationContent.setAttribute(
      'data-paimind-product-center-native-conversation-content',
      'native-owner',
    )
    const beforeConversation = fixture.conversation.outerHTML
    const beforeStyle = fixture.center.getAttribute('style')

    const target = resolvePaimindProductCenterHost(document)!
    const dispose = installPaimindProductCenterHost(target)
    expect(fixture.conversation).toHaveAttribute('aria-hidden', 'true')
    expect(fixture.center.style.position).toBe('absolute')
    expect(fixture.conversationContent).toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
      '',
    )

    dispose?.()
    expect(fixture.conversation.outerHTML).toBe(beforeConversation)
    expect(fixture.center).toHaveAttribute('data-paimind-product-center-host', 'native-owner')
    expect(fixture.center.getAttribute('style')).toBe(beforeStyle)
  })

  it('follows a detached native Conversation content replacement without changing the Slot lease', () => {
    const fixture = harnessShell()
    const target = resolvePaimindProductCenterHost(document)!
    const dispose = installPaimindProductCenterHost(target)!
    const replacement = document.createElement('section')

    fixture.conversation.replaceChildren(replacement)

    expect(setPaimindProductCenterNativeConversation(target, true)).toBe(true)
    expect(replacement).toHaveAttribute('data-paimind-product-center-native-conversation-content', '')
    expect(fixture.center).toHaveAttribute('data-paimind-product-center-native-conversation', '')
    const overlapping = installPaimindProductCenterHost(target)
    expect(overlapping).not.toBeNull()

    dispose()
    expect(replacement).toHaveAttribute('data-paimind-product-center-native-conversation-content', '')
    overlapping?.()
    expect(fixture.conversationContent).not.toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
    )
    expect(replacement).not.toHaveAttribute('data-paimind-product-center-native-conversation-content')
  })

  it('fails closed if the previous native Conversation content was moved instead of detached', () => {
    const fixture = harnessShell()
    const target = resolvePaimindProductCenterHost(document)!
    const dispose = installPaimindProductCenterHost(target)!
    const replacement = document.createElement('section')
    const foreign = document.createElement('aside')
    document.body.append(foreign)
    foreign.append(fixture.conversationContent)
    fixture.conversation.append(replacement)

    expect(setPaimindProductCenterNativeConversation(target, true)).toBe(false)
    expect(installPaimindProductCenterHost(target)).toBeNull()
    expect(replacement).not.toHaveAttribute('data-paimind-product-center-native-conversation-content')

    dispose()
    expect(fixture.conversationContent).not.toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
    )
  })

  it('fails closed if another owner changes the leased content marker', () => {
    const fixture = harnessShell()
    const target = resolvePaimindProductCenterHost(document)!
    const dispose = installPaimindProductCenterHost(target)!

    fixture.conversationContent.setAttribute(
      'data-paimind-product-center-native-conversation-content',
      'foreign-owner',
    )

    expect(setPaimindProductCenterNativeConversation(target, true)).toBe(false)
    expect(installPaimindProductCenterHost(target)).toBeNull()

    dispose()
    expect(fixture.conversationContent).not.toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
    )
  })

  it('keeps isolation active across overlapping Agent and Skill leases', () => {
    const fixture = harnessShell()
    const firstTarget = resolvePaimindProductCenterHost(document)!
    const first = installPaimindProductCenterHost(firstTarget)!
    const second = installPaimindProductCenterHost({ ...firstTarget })!

    first()
    first()
    expect(fixture.conversation).toHaveAttribute('inert')
    expect(fixture.conversation).toHaveAttribute('aria-hidden', 'true')
    expect(fixture.center).toHaveAttribute('data-paimind-product-center-host')
    expect(fixture.conversationContent).toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
      '',
    )

    second()
    expect(fixture.conversation).not.toHaveAttribute('inert')
    expect(fixture.conversation).not.toHaveAttribute('aria-hidden')
    expect(fixture.center).not.toHaveAttribute('data-paimind-product-center-host')
    expect(fixture.conversationContent).not.toHaveAttribute(
      'data-paimind-product-center-native-conversation-content',
    )
  })
})

describe('PAIMind product surface interaction', () => {
  it('focuses the Center, leaves page scroll and Tab native, dismisses on outside activation, and cleans up', () => {
    vi.useFakeTimers()
    document.body.style.overflow = 'auto'
    const trigger = document.createElement('button')
    trigger.dataset.paimindProductTrigger = 'skill-center'
    document.body.append(trigger)
    const root = document.createElement('div')
    root.innerHTML = '<button data-paimind-product-initial-focus>First</button><button>Last</button>'
    document.body.append(root)
    const first = root.querySelectorAll('button')[0]!
    const last = root.querySelectorAll('button')[1]!
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    controller.open(trigger)

    const dispose = installPaimindProductSurfaceInteraction(root, controller, document)
    expect(document.body.style.overflow).toBe('auto')
    expect(document.activeElement).toBe(first)

    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(last)

    last.click()
    expect(controller.getSnapshot().open).toBe(true)

    const outside = document.createElement('button')
    outside.textContent = 'Workspace'
    document.body.append(outside)
    outside.focus()
    const outsideClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    outside.dispatchEvent(outsideClick)
    expect(outsideClick.defaultPrevented).toBe(false)
    expect(controller.getSnapshot().open).toBe(false)
    expect(document.activeElement).toBe(outside)

    controller.open(trigger)
    trigger.click()
    expect(controller.getSnapshot().open).toBe(true)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    vi.runAllTimers()
    expect(controller.getSnapshot().open).toBe(false)
    expect(document.activeElement).toBe(trigger)

    dispose()
    expect(document.body.style.overflow).toBe('auto')
    controller.open(trigger)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(controller.getSnapshot().open).toBe(true)
    controller.dispose()
  })
})
