// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPaimindBootReadinessInjection,
  registerPaimindBootReadiness,
  type PaimindBootHttpRequest,
  type PaimindBootHttpResponse,
} from '../src/index.js'

interface DiagnosticGlobal {
  __DSH_BOOT__?: unknown
  __ModuleLoader__?: unknown
  __PAIMIND_BOOT_READINESS__?: {
    readonly state: string
    readonly graphRev: string | null
    readonly hostInventory: readonly { readonly id: string }[]
    readonly registrationGaps: readonly string[]
    readonly pendingImports: readonly { readonly id: string }[]
  }
  __PAIMIND_BOOT_READINESS_DISPOSE__?: () => void
}

const diagnosticGlobal = globalThis as typeof globalThis & DiagnosticGlobal

describe('base Browser boot readiness injection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.sessionStorage.clear()
    document.documentElement.removeAttribute('data-paimind-boot-readiness')
    document.documentElement.removeAttribute('data-paimind-boot-consistency')
    document.body.replaceChildren()
    delete diagnosticGlobal.__DSH_BOOT__
    delete diagnosticGlobal.__ModuleLoader__
    delete diagnosticGlobal.__PAIMIND_BOOT_READINESS__
    delete diagnosticGlobal.__PAIMIND_BOOT_READINESS_DISPOSE__
  })

  afterEach(() => {
    diagnosticGlobal.__PAIMIND_BOOT_READINESS_DISPOSE__?.()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('turns a silent Loader stall into a bounded visible failure with graph, registration, import, and request diagnostics', async () => {
    document.body.innerHTML = '<div data-dsh-boot>Loading plugins…</div>'
    window.sessionStorage.setItem('paimind:boot-readiness-recovery-v1', 'attempted')
    diagnosticGlobal.__DSH_BOOT__ = {
      rev: 'graph-r13',
      entries: [
        { id: '@paimind/registered', url: '/plugins/registered/client.js?rev=1', rev: '1', inject: [] },
        { id: '@paimind/missing', url: '/plugins/missing/client.js?rev=2', rev: '2', inject: [] },
      ],
    }
    const facade = {
      mode: 'queue',
      pendingQueue: [{ id: '@paimind/registered', factory: () => ({}) }],
      load() {},
      create() {
        this.mode = 'live'
        return {
          import: async () => await new Promise<never>(() => {}),
          prefetch: async () => {},
        }
      },
    }
    diagnosticGlobal.__ModuleLoader__ = facade
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const injection = createPaimindBootReadinessInjection({ deadlineMs: 20, pollMs: 5 })

    expect(injection).toMatchObject({ kind: 'script', placement: 'head' })
    expect(injection.text.toLowerCase()).not.toContain('</script')
    new Function(injection.text)()
    const system = facade.create() as unknown as { import(id: string): Promise<unknown> }
    void system.import('@paimind/registered')
    await vi.advanceTimersByTimeAsync(25)

    expect(document.documentElement).toHaveAttribute('data-paimind-boot-readiness', 'failed')
    expect(document.documentElement).toHaveAttribute('data-paimind-boot-consistency', 'failed')
    expect(document.querySelector('[data-paimind-boot-readiness-error]')).toHaveTextContent('启动未在限定时间内完成')
    expect(diagnosticGlobal.__PAIMIND_BOOT_READINESS__).toMatchObject({
      state: 'failed',
      graphRev: 'graph-r13',
      hostInventory: [{ id: '@paimind/registered' }, { id: '@paimind/missing' }],
      registrationGaps: ['@paimind/missing'],
      pendingImports: [{ id: '@paimind/registered' }],
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[paimind-extension-center] Browser boot readiness deadline exceeded',
      expect.objectContaining({ graphRev: 'graph-r13', hostInventoryCount: 2 }),
    )
    expect(JSON.parse(window.sessionStorage.getItem('paimind:boot-readiness-last-failure-v1') ?? '{}')).toMatchObject({
      graphRev: 'graph-r13',
      registrationGaps: ['@paimind/missing'],
    })
  })

  it('marks a completed product shell ready and clears the one-shot recovery marker', async () => {
    document.body.innerHTML = '<main data-paimind-shell>Ready</main>'
    window.sessionStorage.setItem('paimind:boot-readiness-recovery-v1', 'attempted')
    const injection = createPaimindBootReadinessInjection({ deadlineMs: 50, pollMs: 5 })

    new Function(injection.text)()
    await vi.advanceTimersByTimeAsync(6)

    expect(document.documentElement).toHaveAttribute('data-paimind-boot-readiness', 'ready')
    expect(document.documentElement).toHaveAttribute('data-paimind-boot-consistency', 'checking')
    expect(window.sessionStorage.getItem('paimind:boot-readiness-recovery-v1')).toBeNull()
    expect(diagnosticGlobal.__PAIMIND_BOOT_READINESS__?.state).toBe('ready')
  })

  it('observes re-entrant imports and shared dependencies without deferring or blocking the original call order', async () => {
    document.body.innerHTML = '<div data-dsh-boot>Loading plugins…</div>'
    const receiptFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }))
    const started: string[] = []
    let releaseShared: ((value: { id: string }) => void) | undefined
    const shared = new Promise<{ id: string }>(resolve => { releaseShared = resolve })
    const facade = {
      mode: 'queue',
      pendingQueue: [],
      load() {},
      create() {
        this.mode = 'live'
        return {
          import(id: string): Promise<{ id: string }> {
            started.push(id)
            if (id === 'parent') return this.import('shared').then(() => ({ id }))
            if (id === 'sibling') return this.import('shared').then(() => ({ id }))
            if (id === 'shared') return shared
            return Promise.resolve({ id })
          },
          async prefetch() {},
        }
      },
    }
    diagnosticGlobal.__DSH_BOOT__ = { rev: 'bounded', entries: [] }
    diagnosticGlobal.__ModuleLoader__ = facade
    new Function(createPaimindBootReadinessInjection({
      deadlineMs: 1_000,
      pollMs: 100,
    }).text)()
    const system = facade.create() as unknown as { import(id: string): Promise<unknown> }
    const parent = system.import('parent')
    const sibling = system.import('sibling')
    const sharedResult = system.import('shared')

    // The original calls, including recursive shared imports, happen before
    // either top-level call returns. A monitoring queue would change this order
    // and can deadlock when all slots wait on the same recursive dependency.
    expect(started).toEqual(['parent', 'shared', 'sibling', 'shared', 'shared'])
    expect(sharedResult).toBe(shared)
    releaseShared?.({ id: 'shared' })
    await expect(Promise.all([parent, sibling, sharedResult])).resolves.toEqual([
      { id: 'parent' },
      { id: 'sibling' },
      { id: 'shared' },
    ])
    expect(diagnosticGlobal.__PAIMIND_BOOT_READINESS__?.pendingImports).toEqual([])
    expect(receiptFetch.mock.calls.map(([, init]) => {
      const receipt = JSON.parse(String(init?.body ?? '{}')) as { readonly phase?: string }
      return receipt.phase
    })).toEqual(expect.arrayContaining([
      'bootstrap',
      'facade-instrumented',
      'module-create-start',
      'module-create-complete',
      'import-launch',
    ]))
  })

  it('registers one early index injection and exposes bounded process-local receipts for authoritative Host read-back', async () => {
    let injectListener: ((table: Array<{ kind: 'script'; placement: 'head'; text: string }>) => void) | undefined
    let route: {
      readonly path: string
      readonly handler: (request: PaimindBootHttpRequest, response: PaimindBootHttpResponse) => void | Promise<void>
    } | undefined
    const stopInjection = vi.fn()
    const stopRoute = vi.fn()
    const dispose = registerPaimindBootReadiness({
      on(name, listener) {
        expect(name).toBe('webserver/index-inject')
        injectListener = listener
        return stopInjection
      },
      webServer: {
        register(value) {
          route = value
          return stopRoute
        },
      },
    }, { deadlineMs: 25 })

    const table: Array<{ kind: 'script'; placement: 'head'; text: string }> = []
    injectListener?.(table)
    expect(table).toHaveLength(1)
    expect(table[0]?.text).toContain('paimind.boot-readiness/v1')
    expect(route?.path).toBe('/paimind/boot-readiness')

    const request = (method: string, value?: unknown): PaimindBootHttpRequest => ({
      method,
      async *[Symbol.asyncIterator]() {
        if (value !== undefined) yield new TextEncoder().encode(JSON.stringify(value))
      },
    })
    const response = () => {
      const state: { status?: number; headers?: Readonly<Record<string, string>>; body?: string } = {}
      const target: PaimindBootHttpResponse = {
        writeHead(status, headers) { state.status = status; state.headers = headers; return this },
        end(body) { state.body = body },
      }
      return { state, target }
    }
    const posted = response()
    await route?.handler(request('POST', { schema: 'paimind.boot-readiness/v1', state: 'failed' }), posted.target)
    expect(posted.state.status).toBe(202)
    const listed = response()
    await route?.handler(request('GET'), listed.target)
    expect(listed.state.status).toBe(200)
    expect(JSON.parse(listed.state.body ?? '{}')).toMatchObject({
      schema: 'paimind.boot-readiness-receipts/v1',
      receipts: [{ receipt: { schema: 'paimind.boot-readiness/v1', state: 'failed' } }],
    })

    dispose()
    expect(stopRoute).toHaveBeenCalledOnce()
    expect(stopInjection).toHaveBeenCalledOnce()
  })
})
