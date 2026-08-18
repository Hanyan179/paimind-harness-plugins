import type {
  HarnessInspectableSlotRegistry, PaimindClientContext,
} from '@paimind/harness-compat'

/** Captured slot entry used by external plugin tests. */
export interface CapturedSlot {
  readonly injectedName: string
  readonly options: Readonly<Record<string, unknown>>
  readonly component: unknown
  readonly inject?: () => unknown
  readonly disposed: () => boolean
}

/** Construct a small Cordis client context that proves registration and disposal behavior. */
export function createClientContextFixture(): {
  readonly context: PaimindClientContext
  readonly slots: CapturedSlot[]
  readonly services: ReadonlyMap<string, unknown>
  disposeEffects(): void
} {
  const captured: CapturedSlot[] = []
  const effects: Array<() => void> = []
  const services = new Map<string, unknown>()
  const locale = {
    getLocale: () => ({ active: 'zh' }),
    subscribe: () => () => {},
  }
  let currentInjection = ''
  const versions = new Map<string, number>()
  const listeners = new Map<string, Set<() => void>>()
  const bump = (name: string): void => {
    versions.set(name, (versions.get(name) ?? 0) + 1)
    for (const listener of listeners.get(name) ?? []) listener()
  }
  const registry: HarnessInspectableSlotRegistry = {
    inject(name, install) {
      currentInjection = name
      const installed = install()
      const disposers = typeof installed === 'function' ? [installed] : [...installed]
      effects.push(() => { for (const dispose of disposers.reverse()) dispose() })
      currentInjection = ''
    },
    register(options, component) {
      let disposed = false
      const injectedName = currentInjection
      const entry = {
        injectedName: currentInjection,
        options,
        component,
        ...(typeof options.inject === 'function' ? { inject: options.inject as () => unknown } : {}),
        disposed: () => disposed,
      }
      captured.push(entry)
      bump(injectedName)
      return () => {
        if (disposed) return
        disposed = true
        bump(injectedName)
      }
    },
    entries(name) {
      return captured.filter(entry => entry.injectedName === name && !entry.disposed())
    },
    subscribe(name, listener) {
      let group = listeners.get(name)
      if (group === undefined) {
        group = new Set()
        listeners.set(name, group)
      }
      group.add(listener)
      return () => { group?.delete(listener) }
    },
    getVersion(name) {
      return versions.get(name) ?? 0
    },
  }
  return {
    context: {
      slots: registry,
      locale,
      reflect: {
        provide(name, service) {
          services.set(name, service)
          return () => { services.delete(name) }
        },
      },
      effect(install) {
        const dispose = install()
        if (typeof dispose === 'function') effects.push(dispose)
      },
    },
    slots: captured,
    services,
    disposeEffects() {
      for (const dispose of effects.splice(0).reverse()) dispose()
    },
  }
}
