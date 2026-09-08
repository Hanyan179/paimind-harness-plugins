import {
  PaimindHostRemoteService,
  describePaimindHostLoaderEntry,
  describePaimindHostSettings,
  markPaimindHostRemoteMethods,
  mutatePaimindHostSettings,
  registerPaimindHostSettings,
  setPaimindHostLoaderEntryEnabled,
  type PaimindHostLoaderFacility,
  type PaimindHostSettingsFacility,
} from '@hansen/harness-compat/host'
import {
  PAIMIND_FEATURE_PACKS,
  PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE,
  decodePaimindFeatureOverrides,
  featureToggleEnabled,
  findPaimindFeatureCapability,
  findPaimindFeaturePack,
  type PaimindFeatureOverrides,
  type PaimindFeaturePackView,
  type PaimindFeatureToggleMutationRequest,
} from './feature-packs.js'

export * from './feature-packs.js'
export * from './projection.js'

export const name = 'paimind-extension-center'
export const inject = ['loader', 'settings', 'webServer']

interface PaimindFeaturePackSettings {
  readonly overrides: string
}

const DEFAULT_FEATURE_PACK_SETTINGS: PaimindFeaturePackSettings = Object.freeze({ overrides: '{}' })
const HARNESS_ROOT_INCLUDE_LOADER_ENTRY_ID = 'include'

export interface PaimindFeaturePackHostContext {
  readonly loader: PaimindHostLoaderFacility
  readonly settings: PaimindHostSettingsFacility
  readonly webServer: PaimindBootWebServer
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
  on(
    name: 'loader/entry-init',
    listener: (entry: { readonly options: { readonly id?: string; readonly disabled?: boolean | null } }) => void,
  ): () => void
  on(
    name: 'loader/partial-dispose',
    listener: (
      entry: { readonly options: { readonly id?: string; readonly disabled?: boolean | null } },
      legacyOptions: { readonly id?: string; readonly disabled?: boolean | null },
      active: boolean,
    ) => void,
  ): () => void
  on(
    name: 'webserver/index-inject',
    listener: (table: PaimindBootIndexInjection[]) => void,
  ): () => void
}

export interface PaimindBootHttpRequest extends AsyncIterable<Uint8Array> {
  readonly method?: string
}

export interface PaimindBootHttpResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): this
  end(body?: string): void
}

export interface PaimindBootWebServer {
  register(route: {
    readonly kind: 'exact'
    readonly path: string
    readonly handler: (request: PaimindBootHttpRequest, response: PaimindBootHttpResponse) => void | Promise<void>
  }): () => void
}

export interface PaimindBootIndexInjection {
  readonly kind: 'script'
  readonly placement: 'head'
  readonly text: string
}

export interface PaimindBootReadinessOptions {
  readonly deadlineMs?: number
  readonly pollMs?: number
  readonly recoveryDelayMs?: number
}

const BOOT_READINESS_RECOVERY_KEY = 'paimind:boot-readiness-recovery-v1'
const BOOT_READINESS_FAILURE_KEY = 'paimind:boot-readiness-last-failure-v1'
const BOOT_READINESS_RECEIPT_PATH = '/paimind/boot-readiness'
const BOOT_READINESS_MAX_BODY_BYTES = 256 * 1024
const BOOT_READINESS_RECEIPT_LIMIT = 24

interface PaimindBootReceiptEnvelope {
  readonly receivedAt: number
  readonly receipt: unknown
}

async function readPaimindBootReceiptBody(request: PaimindBootHttpRequest): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > BOOT_READINESS_MAX_BODY_BYTES) throw new Error('boot readiness receipt exceeds 256 KiB')
    chunks.push(chunk)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body))
}

/** Register the pre-shell watchdog and its bounded, process-local Host receipt endpoint. */
export function registerPaimindBootReadiness(
  ctx: Pick<PaimindFeaturePackHostContext, 'on' | 'webServer'>,
  options: PaimindBootReadinessOptions = {},
): () => void {
  const receipts: PaimindBootReceiptEnvelope[] = []
  const stopInjection = ctx.on('webserver/index-inject', table => {
    table.push(createPaimindBootReadinessInjection(options))
  })
  const stopRoute = ctx.webServer.register({
    kind: 'exact',
    path: BOOT_READINESS_RECEIPT_PATH,
    async handler(request, response) {
      if (request.method === 'GET') {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        }).end(JSON.stringify({ schema: 'paimind.boot-readiness-receipts/v1', receipts }))
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'GET, POST' }).end()
        return
      }
      const receipt = await readPaimindBootReceiptBody(request)
      if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('invalid boot readiness receipt')
        return
      }
      receipts.push(Object.freeze({ receivedAt: Date.now(), receipt }))
      if (receipts.length > BOOT_READINESS_RECEIPT_LIMIT) receipts.splice(0, receipts.length - BOOT_READINESS_RECEIPT_LIMIT)
      response.writeHead(202, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      }).end(JSON.stringify({ ok: true }))
    },
  })
  return () => {
    stopRoute()
    stopInjection()
  }
}

/**
 * Install before the Vite shell so a stalled base module/Loader boot remains
 * bounded, diagnosable, and recoverable even when the Extension Center client
 * itself never activates.
 */
export function createPaimindBootReadinessInjection(
  options: PaimindBootReadinessOptions = {},
): Readonly<PaimindBootIndexInjection> {
  const config = Object.freeze({
    deadlineMs: Math.max(1, Math.floor(options.deadlineMs ?? 20_000)),
    pollMs: Math.max(1, Math.floor(options.pollMs ?? 100)),
    recoveryDelayMs: Math.max(0, Math.floor(options.recoveryDelayMs ?? 120)),
    recoveryKey: BOOT_READINESS_RECOVERY_KEY,
    failureKey: BOOT_READINESS_FAILURE_KEY,
  })
  const text = `(() => {
  const root = document.documentElement
  const config = ${JSON.stringify(config)}
  const previousDispose = globalThis.__PAIMIND_BOOT_READINESS_DISPOSE__
  if (typeof previousDispose === 'function') previousDispose()
  const startedAt = Date.now()
  const events = []
  const registered = new Set()
  const pendingImports = new Map()
  const pendingPrefetches = new Map()
  const previousFailure = (() => {
    try { const value = sessionStorage.getItem(config.failureKey); return value === null ? null : JSON.parse(value) }
    catch { return null }
  })()
  const diagnostic = {
    schema: 'paimind.boot-readiness/v1', state: 'bootstrap', startedAt,
    deadlineMs: config.deadlineMs, previousFailure, events,
    graphRev: null, hostInventory: [], facade: null, registrationGaps: [],
    pendingImports: [], pendingPrefetches: [], requestTiming: [],
  }
  globalThis.__PAIMIND_BOOT_READINESS__ = diagnostic
  root.setAttribute('data-paimind-boot-readiness', 'checking')
  if (!root.hasAttribute('data-paimind-boot-consistency')) {
    root.setAttribute('data-paimind-boot-consistency', 'bootstrap')
  }
  const record = (type, detail = {}) => {
    events.push({ type, elapsedMs: Date.now() - startedAt, ...detail })
    if (events.length > 512) events.splice(0, events.length - 512)
  }
  const inventory = () => {
    const boot = globalThis.__DSH_BOOT__
    const entries = boot && Array.isArray(boot.entries) ? boot.entries : []
    diagnostic.graphRev = boot && typeof boot.rev === 'string' ? boot.rev : null
    diagnostic.hostInventory = entries.map(entry => ({
      id: entry.id, url: entry.url, rev: entry.rev,
      immediately: entry.immediately === true,
      inject: Array.isArray(entry.inject) ? entry.inject.slice() : [],
    }))
    return entries
  }
  let milestoneSequence = 0
  const reportReceipt = (receipt) => {
    try {
      void fetch('${BOOT_READINESS_RECEIPT_PATH}', {
        method: 'POST', cache: 'no-store', keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(receipt),
      }).catch(() => {})
    } catch {}
  }
  const pageContext = () => ({
    href: location.href,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    userAgent: navigator.userAgent,
  })
  const reportMilestone = (phase, detail = {}) => {
    reportReceipt({
      schema: diagnostic.schema, state: 'milestone', phase,
      sequence: ++milestoneSequence, at: Date.now(), elapsedMs: Date.now() - startedAt,
      page: pageContext(),
      ...detail,
    })
  }
  reportMilestone('bootstrap', {
    graphRev: globalThis.__DSH_BOOT__ && globalThis.__DSH_BOOT__.rev,
    hostInventoryCount: globalThis.__DSH_BOOT__ && Array.isArray(globalThis.__DSH_BOOT__.entries)
      ? globalThis.__DSH_BOOT__.entries.length : 0,
  })
  let importLaunchCount = 0
  const observeAsync = (owner, name, pending, type) => {
    const original = owner && owner[name]
    if (typeof original !== 'function') return
    owner[name] = function(specifier, ...args) {
      const id = String(specifier)
      const began = Date.now()
      pending.set(id, began)
      record(type + '-start', { id })
      if (type === 'import') {
        importLaunchCount += 1
        const expected = diagnostic.hostInventory.length
        if (importLaunchCount === 1 || importLaunchCount % 16 === 0 || importLaunchCount === expected) {
          reportMilestone('import-launch', { id, importLaunchCount, expected })
        }
      }
      let result
      try {
        // Invoke synchronously and with the original receiver. The observer must
        // never queue or defer re-entrant imports because that changes Loader semantics.
        result = original.call(this, specifier, ...args)
      } catch (reason) {
        record(type + '-error', {
          id, durationMs: Date.now() - began,
          message: reason instanceof Error ? reason.message : String(reason),
        })
        pending.delete(id)
        throw reason
      }
      // Attach an observation branch, but return the exact original result so
      // Promise identity, synchronous re-entry, and Loader scheduling stay intact.
      void Promise.resolve(result).then(
        value => {
          record(type + '-complete', { id, durationMs: Date.now() - began })
          pending.delete(id)
          return value
        },
        reason => {
          record(type + '-error', {
            id, durationMs: Date.now() - began,
            message: reason instanceof Error ? reason.message : String(reason),
          })
          pending.delete(id)
        },
      )
      return result
    }
  }
  const instrumentFacade = (target) => {
    if (!target || typeof target !== 'object' || target.__paimindBootReadinessInstrumented === true) return false
    try { Object.defineProperty(target, '__paimindBootReadinessInstrumented', { value: true }) }
    catch { return false }
    if (Array.isArray(target.pendingQueue)) {
      for (const row of target.pendingQueue) if (row && typeof row.id === 'string') registered.add(row.id)
    }
    const originalLoad = typeof target.load === 'function' ? target.load : null
    if (originalLoad !== null) {
      target.load = function(registration) {
        if (registration && typeof registration.id === 'string') registered.add(registration.id)
        record('registration', { id: registration && registration.id })
        return originalLoad.call(this, registration)
      }
    }
    const originalCreate = typeof target.create === 'function' ? target.create : null
    if (originalCreate !== null) {
      target.create = function(options) {
        inventory()
        record('module-system-create-start', {
          graphRev: diagnostic.graphRev,
          pendingQueue: Array.isArray(target.pendingQueue) ? target.pendingQueue.map(row => row && row.id) : [],
        })
        reportMilestone('module-create-start', {
          graphRev: diagnostic.graphRev,
          hostInventoryCount: diagnostic.hostInventory.length,
          pendingQueueCount: Array.isArray(target.pendingQueue) ? target.pendingQueue.length : 0,
        })
        const system = originalCreate.call(this, options)
        observeAsync(system, 'import', pendingImports, 'import')
        observeAsync(system, 'prefetch', pendingPrefetches, 'prefetch')
        const liveLoad = typeof target.load === 'function' ? target.load : null
        if (liveLoad !== null) {
          target.load = function(registration) {
            if (registration && typeof registration.id === 'string') registered.add(registration.id)
            record('registration', { id: registration && registration.id })
            return liveLoad.call(this, registration)
          }
        }
        record('module-system-create-complete', { graphRev: diagnostic.graphRev })
        reportMilestone('module-create-complete', {
          graphRev: diagnostic.graphRev,
          hostInventoryCount: diagnostic.hostInventory.length,
        })
        return system
      }
    }
    record('facade-instrumented', { mode: target.mode })
    reportMilestone('facade-instrumented', {
      mode: target.mode,
      pendingQueueCount: Array.isArray(target.pendingQueue) ? target.pendingQueue.length : 0,
    })
    return true
  }
  let facadeAccessorInstalled = false
  let facadeValue
  if (!instrumentFacade(globalThis.__ModuleLoader__)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__ModuleLoader__')
    if (descriptor === undefined || descriptor.configurable === true) {
      facadeAccessorInstalled = true
      facadeValue = descriptor && 'value' in descriptor ? descriptor.value : undefined
      Object.defineProperty(globalThis, '__ModuleLoader__', {
        configurable: true,
        get() { return facadeValue },
        set(value) { facadeValue = value; instrumentFacade(value) },
      })
      if (facadeValue !== undefined) instrumentFacade(facadeValue)
    }
  }
  let interval
  let deadline
  let disposed = false
  const shellReady = () => document.readyState !== 'loading' && document.querySelector('[data-dsh-boot]') === null
  const settleReady = () => {
    if (disposed) return
    diagnostic.state = 'ready'
    root.setAttribute('data-paimind-boot-readiness', 'ready')
    if (root.getAttribute('data-paimind-boot-consistency') === 'bootstrap') {
      root.setAttribute('data-paimind-boot-consistency', 'checking')
    }
    try { sessionStorage.removeItem(config.recoveryKey) } catch {}
    record('shell-ready')
    const receipt = snapshot()
    reportReceipt({ ...receipt, state: 'ready', phase: 'shell-ready' })
    disposeTimers()
  }
  const requestTiming = () => {
    try {
      return performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/plugins/') || entry.name.includes('/assets/'))
        .slice(-160)
        .map(entry => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, responseEnd: entry.responseEnd, transferSize: entry.transferSize }))
    } catch { return [] }
  }
  const snapshot = () => {
    const entries = inventory()
    const target = globalThis.__ModuleLoader__
    diagnostic.facade = target && typeof target === 'object' ? {
      mode: target.mode,
      pendingQueue: Array.isArray(target.pendingQueue) ? target.pendingQueue.map(row => row && row.id) : [],
    } : null
    diagnostic.registrationGaps = entries.map(entry => entry.id).filter(id => !registered.has(id))
    diagnostic.pendingImports = [...pendingImports].map(([id, at]) => ({ id, elapsedMs: Date.now() - at }))
    diagnostic.pendingPrefetches = [...pendingPrefetches].map(([id, at]) => ({ id, elapsedMs: Date.now() - at }))
    diagnostic.requestTiming = requestTiming()
    return {
      schema: diagnostic.schema, at: Date.now(), elapsedMs: Date.now() - startedAt,
      page: pageContext(),
      graphRev: diagnostic.graphRev, hostInventoryCount: diagnostic.hostInventory.length,
      facade: diagnostic.facade, registrationGaps: diagnostic.registrationGaps,
      pendingImports: diagnostic.pendingImports,
      pendingPrefetches: diagnostic.pendingPrefetches,
      requestTiming: diagnostic.requestTiming, events: events.slice(-160),
    }
  }
  const renderFailure = () => {
    const boot = document.querySelector('[data-dsh-boot]')
    if (!(boot instanceof HTMLElement)) return
    const existing = boot.querySelector('[data-paimind-boot-readiness-error]')
    if (existing !== null) return
    const alert = document.createElement('div')
    alert.setAttribute('data-paimind-boot-readiness-error', '')
    alert.setAttribute('role', 'alert')
    alert.textContent = '应用启动未在限定时间内完成，仍在等待插件。诊断已保留。'
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = '重新加载'
    retry.addEventListener('click', () => window.location.reload())
    alert.append(retry)
    boot.append(alert)
  }
  const failOrRecover = () => {
    if (disposed || shellReady()) { settleReady(); return }
    const receipt = snapshot()
    try { sessionStorage.setItem(config.failureKey, JSON.stringify(receipt)) } catch {}
    diagnostic.state = 'failed'
    root.setAttribute('data-paimind-boot-readiness', 'failed')
    root.setAttribute('data-paimind-boot-consistency', 'failed')
    record('deadline-exceeded', { registrationGapCount: diagnostic.registrationGaps.length })
    reportReceipt({ ...receipt, state: diagnostic.state, phase: 'deadline-exceeded' })
    console.error('[paimind-extension-center] Browser boot readiness deadline exceeded', receipt)
    // Keep in-flight Loader work and readiness polling alive. A slow browser
    // must not lose its progress to an automatic navigation.
    renderFailure()
  }
  function disposeTimers() {
    if (interval !== undefined) window.clearInterval(interval)
    if (deadline !== undefined) window.clearTimeout(deadline)
  }
  interval = window.setInterval(() => { if (shellReady()) settleReady() }, config.pollMs)
  deadline = window.setTimeout(failOrRecover, config.deadlineMs)
  globalThis.__PAIMIND_BOOT_READINESS_DISPOSE__ = () => {
    disposed = true
    disposeTimers()
    if (facadeAccessorInstalled) {
      try { Object.defineProperty(globalThis, '__ModuleLoader__', { configurable: true, writable: true, value: facadeValue }) } catch {}
    }
  }
})()`
  if (text.toLowerCase().includes('</script')) {
    throw new Error('PAIMind boot readiness injection must not contain a script closing tag')
  }
  return Object.freeze({ kind: 'script', placement: 'head', text })
}

function overridesFromSettingsValue(value: unknown): PaimindFeatureOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return Object.freeze({})
  return decodePaimindFeatureOverrides((value as { readonly overrides?: unknown }).overrides)
}

function featurePackErrorDiagnostic(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error) || depth >= 5) return String(error)
  const cause = 'cause' in error ? featurePackErrorDiagnostic(error.cause, depth + 1) : undefined
  const errors = error instanceof AggregateError
    ? error.errors.map(item => featurePackErrorDiagnostic(item, depth + 1))
    : undefined
  return Object.freeze({ name: error.name, message: error.message, stack: error.stack, cause, errors })
}

function featurePackFailureMessage(error: unknown): string {
  const messages: string[] = []
  const visit = (candidate: unknown, depth = 0): void => {
    if (depth >= 8) return
    if (!(candidate instanceof Error)) {
      const message = String(candidate).trim()
      if (message !== '') messages.push(message)
      return
    }
    if (candidate instanceof AggregateError) {
      for (const item of candidate.errors) visit(item, depth + 1)
    }
    if ('cause' in candidate && candidate.cause !== undefined) visit(candidate.cause, depth + 1)
    if (candidate.message.trim() !== '') messages.push(candidate.message.trim())
  }
  visit(error)
  const actionable = messages.find(message => (
    /cannot find (?:package|module)|module_not_found|failed to (?:import|load)/i.test(message)
  ))
  return (actionable ?? messages[0] ?? 'Unknown Loader reconciliation failure').slice(0, 800)
}

export function resolvePaimindFeatureToggleOverrides(
  id: string,
  enabled: boolean,
  source: PaimindFeatureOverrides,
): PaimindFeatureOverrides {
  const next: Record<string, boolean> = { ...source, [id]: enabled }
  const pack = findPaimindFeaturePack(id)
  if (pack === undefined) return Object.freeze(next)
  if (enabled) {
    const enableRequired = (packId: string): void => {
      const required = findPaimindFeaturePack(packId)
      if (required === undefined || next[required.id] === true) return
      next[required.id] = true
      for (const requiredId of required.requiredPackIds) enableRequired(requiredId)
    }
    for (const requiredId of pack.requiredPackIds) enableRequired(requiredId)
  } else {
    const disableDependents = (packId: string): void => {
      for (const dependent of PAIMIND_FEATURE_PACKS) {
        if (!dependent.requiredPackIds.includes(packId as never) || next[dependent.id] === false) continue
        next[dependent.id] = false
        disableDependents(dependent.id)
      }
    }
    disableDependents(pack.id)
  }
  return Object.freeze(next)
}

/** Product Feature Pack controller over public Cordis Loader groups and canonical Harness Settings. */
export class PaimindFeaturePackService extends PaimindHostRemoteService {
  static inject = inject
  private source: () => Readonly<PaimindFeaturePackSettings> = () => DEFAULT_FEATURE_PACK_SETTINGS
  private reconciliation: Promise<void> = Promise.resolve()
  private bootSettled = false
  private bootTimer: ReturnType<typeof setTimeout> | undefined
  private externalRepairTimer: ReturnType<typeof setTimeout> | undefined
  private settingsMutationDepth = 0
  private loaderMutationDepth = 0
  private readonly toggleFailures = new Map<string, string>()

  constructor(private readonly featureCtx: PaimindFeaturePackHostContext) {
    super(featureCtx, 'paimindFeaturePacks')
    markPaimindHostRemoteMethods(this, ['describe', 'mutate'])
    const settingsScope = registerPaimindHostSettings<PaimindFeaturePackSettings>(
      featureCtx.settings,
      PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE,
      { overrides: { kind: 'string', default: '{}', maxLength: 8_192 } },
      { base: { ...DEFAULT_FEATURE_PACK_SETTINGS } },
    )
    this.source = () => settingsScope.get()
    const stopWatchingSettings = settingsScope.watch(() => {
      if (this.settingsMutationDepth > 0) return
      if (this.bootSettled) this.queueReconciliation()
      else this.scheduleBootReconciliation()
    })
    const stopWatchingEntries = featureCtx.on('loader/entry-init', () => {
      if (this.loaderMutationDepth > 0) return
      // Entry-init fires before the Loader attaches options and before it decides
      // whether to start the entry. Mutating that entry in a later microtask races
      // with import/start. Bootstrap inertness is therefore owned by the static
      // Bundle config; this listener only extends the startup quiet-period barrier.
      // After boot, raw entry-init also fires for unrelated dynamic children such
      // as Agent presets. Replaying every Product Pack for those child entries
      // would briefly stop healthy packs, so only an explicit Settings mutation
      // may reconcile the settled control plane.
      if (!this.bootSettled) this.scheduleBootReconciliation()
    })
    const stopWatchingRootIncludeReplays = featureCtx.on(
      'loader/partial-dispose',
      (entry, legacyOptions, active) => {
        if (!active) return
        const entryId = entry.options.id ?? legacyOptions.id
        // Extension Center mutates only nested Product Pack groups. A live
        // partial-dispose of the Host's Root Include therefore identifies the
        // external HMR full-config replay that can overwrite Settings-owned
        // runtime switches, even when it overlaps our own reconciliation.
        if (entryId !== HARNESS_ROOT_INCLUDE_LOADER_ENTRY_ID) return
        if (this.bootSettled) this.scheduleExternalRepair()
        else this.scheduleBootReconciliation()
      },
    )
    featureCtx.effect(
      () => () => {
        stopWatchingSettings()
        stopWatchingEntries()
        stopWatchingRootIncludeReplays()
        if (this.bootTimer !== undefined) clearTimeout(this.bootTimer)
        if (this.externalRepairTimer !== undefined) clearTimeout(this.externalRepairTimer)
      },
      'paimind-extension-center: Feature Pack reconciliation lifecycle',
    )
    this.scheduleBootReconciliation()
  }

  private scheduleBootReconciliation(): void {
    if (this.bootSettled) return
    if (this.bootTimer !== undefined) clearTimeout(this.bootTimer)
    // Root Include creates nested groups concurrently. A short quiet-period
    // debounce waits until no new Loader entry is being constructed; Loader
    // await then supplies the actual lifecycle barrier before any persisted
    // switch is applied.
    this.bootTimer = setTimeout(() => {
      this.bootTimer = undefined
      void this.featureCtx.loader.await().then(() => {
        this.bootSettled = true
        this.queueReconciliation()
      }).catch(error => {
        console.warn('[paimind-extension-center] Loader boot barrier failed', error)
        this.scheduleBootReconciliation()
      })
    }, 50)
  }

  private scheduleExternalRepair(): void {
    if (this.externalRepairTimer !== undefined) clearTimeout(this.externalRepairTimer)
    // Root Include HMR starts after the initial Host boot barrier and can replay
    // the static disabled composition over a just-enabled product group. A
    // Root Include partial-dispose is the public signal for that transaction.
    // Coalesce sibling events, then let the Loader settle before restoring the
    // Settings-owned desired state.
    this.externalRepairTimer = setTimeout(() => {
      this.externalRepairTimer = undefined
      this.queueReconciliation()
    }, 25)
  }

  private queueReconciliation(): void {
    this.reconciliation = this.reconciliation
      .then(async () => {
        // Product groups can be inserted after the control plane and their
        // children start concurrently. Wait for the Loader transaction to
        // settle before applying persisted switches, avoiding a startup race
        // between initial Group creation and Feature Pack reconciliation.
        await this.featureCtx.loader.await()
        await this.applyOverrides(decodePaimindFeatureOverrides(this.source().overrides))
      })
      .catch(error => { console.warn('[paimind-extension-center] feature-pack reconciliation failed', error) })
  }

  private async disableAllProductGroups(): Promise<void> {
    for (const pack of [...PAIMIND_FEATURE_PACKS].reverse()) {
      for (const capability of [...pack.capabilities].reverse()) {
        const state = describePaimindHostLoaderEntry(this.featureCtx.loader, capability.loaderEntryId)
        if (state.installed) {
          await setPaimindHostLoaderEntryEnabled(this.featureCtx.loader, capability.loaderEntryId, false)
        }
      }
      const state = describePaimindHostLoaderEntry(this.featureCtx.loader, pack.loaderEntryId)
      if (state.installed) await setPaimindHostLoaderEntryEnabled(this.featureCtx.loader, pack.loaderEntryId, false)
    }
  }

  /**
   * A failed Cordis Group update can roll back sibling runtime contexts without
   * rolling back their Loader option flags. Rebuild from an all-disabled known
   * state and replay healthy groups after every newly isolated failure so the
   * product projection never reports those stale option flags as success.
   */
  private async applyOverrides(overrides: PaimindFeatureOverrides, strictToggleId?: string): Promise<void> {
    this.loaderMutationDepth += 1
    try {
      const failures = new Map<string, string>()
      const failureErrors = new Map<string, unknown>()
      for (;;) {
        await this.disableAllProductGroups()
        let discoveredFailure = false
        for (const pack of PAIMIND_FEATURE_PACKS) {
          if (!featureToggleEnabled(pack.id, overrides) || failures.has(pack.id)) continue
          const failedRequirement = pack.requiredPackIds.find(requiredId => failures.has(requiredId))
          if (failedRequirement !== undefined) {
            failures.set(pack.id, `Required Product Pack failed: ${failedRequirement}`)
            continue
          }
          const state = describePaimindHostLoaderEntry(this.featureCtx.loader, pack.loaderEntryId)
          if (!state.installed) continue
          try {
            await setPaimindHostLoaderEntryEnabled(this.featureCtx.loader, pack.loaderEntryId, true)
          } catch (error) {
            failures.set(pack.id, featurePackFailureMessage(error))
            failureErrors.set(pack.id, error)
            discoveredFailure = true
            break
          }
        }
        if (discoveredFailure) continue

        for (const pack of PAIMIND_FEATURE_PACKS) {
          if (!featureToggleEnabled(pack.id, overrides) || failures.has(pack.id)) continue
          for (const capability of pack.capabilities) {
            if (!featureToggleEnabled(capability.id, overrides) || failures.has(capability.id)) continue
            const state = describePaimindHostLoaderEntry(this.featureCtx.loader, capability.loaderEntryId)
            if (!state.installed) continue
            try {
              await setPaimindHostLoaderEntryEnabled(this.featureCtx.loader, capability.loaderEntryId, true)
            } catch (error) {
              failures.set(capability.id, featurePackFailureMessage(error))
              failureErrors.set(capability.id, error)
              discoveredFailure = true
              break
            }
          }
          if (discoveredFailure) break
        }
        if (!discoveredFailure) break
      }
      const previousFailures = JSON.stringify([...this.toggleFailures])
      const nextFailures = JSON.stringify([...failures])
      this.toggleFailures.clear()
      for (const [id, message] of failures) this.toggleFailures.set(id, message)
      if (nextFailures !== previousFailures) {
        if (failures.size > 0) {
          console.warn('[paimind-extension-center] isolated failed Feature Pack groups', nextFailures)
        } else if (previousFailures !== '[]') {
          console.info('[paimind-extension-center] Feature Pack groups recovered')
        }
      }

      if (strictToggleId === undefined || !featureToggleEnabled(strictToggleId, overrides)) return
      const strictPack = findPaimindFeaturePack(strictToggleId)
      const failureId = strictPack === undefined
        ? strictToggleId
        : [strictPack.id, ...strictPack.requiredPackIds].find(id => failures.has(id))
      if (failureId === undefined || !failures.has(failureId)) return
      const error = failureErrors.get(failureId)
      if (error !== undefined) throw error
      throw new Error(failures.get(failureId))
    } finally {
      this.loaderMutationDepth -= 1
    }
  }

  async describe(): Promise<Readonly<PaimindFeaturePackView>> {
    const descriptor = describePaimindHostSettings(
      this.featureCtx.settings,
      PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE,
    )
    if (descriptor === undefined) return Object.freeze({ status: 'unavailable' })
    const overrides = overridesFromSettingsValue(descriptor.value)
    const packs = PAIMIND_FEATURE_PACKS.map(pack => {
      const runtime = describePaimindHostLoaderEntry(this.featureCtx.loader, pack.loaderEntryId)
      const desiredEnabled = featureToggleEnabled(pack.id, overrides)
      const failure = this.toggleFailures.get(pack.id)
      return Object.freeze({
        ...pack,
        installed: runtime.installed,
        desiredEnabled,
        ...(failure === undefined ? {} : { failure }),
        enabled: runtime.installed && runtime.enabled && desiredEnabled && failure === undefined,
        capabilities: Object.freeze(pack.capabilities.map(capability => {
          const capabilityRuntime = describePaimindHostLoaderEntry(this.featureCtx.loader, capability.loaderEntryId)
          const capabilityDesiredEnabled = desiredEnabled && featureToggleEnabled(capability.id, overrides)
          const capabilityFailure = this.toggleFailures.get(capability.id)
          return Object.freeze({
            ...capability,
            installed: capabilityRuntime.installed,
            desiredEnabled: capabilityDesiredEnabled,
            ...(capabilityFailure === undefined ? {} : { failure: capabilityFailure }),
            enabled: runtime.enabled && capabilityRuntime.enabled && capabilityDesiredEnabled
              && failure === undefined && capabilityFailure === undefined,
          })
        })),
      })
    })
    return Object.freeze({
      status: 'ready', packs: Object.freeze(packs),
      revision: descriptor.revision, writable: descriptor.writable,
    })
  }

  async mutate(request: PaimindFeatureToggleMutationRequest): Promise<Readonly<PaimindFeaturePackView>> {
    if (findPaimindFeaturePack(request.id) === undefined && findPaimindFeatureCapability(request.id) === undefined) {
      throw new Error(`unknown PAIMind Feature Pack toggle "${request.id}"`)
    }
    const settings = this.featureCtx.settings
    const descriptor = describePaimindHostSettings(settings, PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE)
    if (descriptor === undefined) return Object.freeze({ status: 'unavailable' })
    const current = overridesFromSettingsValue(descriptor.value)
    const next = resolvePaimindFeatureToggleOverrides(request.id, request.enabled, current)
    this.settingsMutationDepth += 1
    try {
      await mutatePaimindHostSettings(
        settings,
        PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE,
        'overrides',
        JSON.stringify(next),
        request.expectedRevision,
      )
      try {
        await this.applyOverrides(next, request.id)
      } catch (error) {
        console.warn('[paimind-extension-center] feature-pack mutation failed; rolling back', JSON.stringify({
          id: request.id,
          enabled: request.enabled,
          error: featurePackErrorDiagnostic(error),
        }))
        const appliedDescriptor = describePaimindHostSettings(
          settings,
          PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE,
        )
        const rollbackErrors: unknown[] = [error]
        try {
          if (appliedDescriptor === undefined) throw new Error('PAIMind Feature Pack Settings disappeared during rollback')
          await mutatePaimindHostSettings(
            settings,
            PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE,
            'overrides',
            JSON.stringify(current),
            appliedDescriptor.revision,
          )
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
        try {
          await this.applyOverrides(current)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
        if (rollbackErrors.length > 1) {
          throw new AggregateError(
            rollbackErrors,
            'PAIMind Feature Pack mutation and rollback failed',
          )
        }
        throw error
      }
    } catch (error) {
      throw error
    } finally {
      this.settingsMutationDepth -= 1
    }
    return await this.describe()
  }
}

/** Extension Center is the always-on control plane; product packs are its managed groups. */
export function apply(ctx: PaimindFeaturePackHostContext): void {
  ctx.effect(
    () => registerPaimindBootReadiness(ctx),
    'paimind-extension-center: bounded base browser boot readiness',
  )
  new PaimindFeaturePackService(ctx)
}
