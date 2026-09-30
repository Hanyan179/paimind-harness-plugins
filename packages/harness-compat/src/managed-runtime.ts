import assert from 'node:assert/strict'
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { symbols, type Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createNativeConnectorConfiguration } from './connector-configuration.js'
import { createManagedConnectorAuthority } from './connector-authority.js'
import { createManagedHarnessConnectorProvider } from './managed-connector.js'
import { captureConnectorToolOrigin, readConnectorToolOrigin } from './connector-tool-origin.js'
import { boot, composeEntries, healProfilesModuleFallback, installFailLoud, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { createManagedHarnessSubprocessProvider, type ManagedHarnessExecutionDomain } from './managed-subprocess.js'
import { createManagedHarnessFilesystemProvider, readManagedHarnessDirectoryView, readManagedHarnessFileChunk } from './managed-filesystem.js'
import { createManagedHarnessDirectoryPickerProvider } from './managed-directory-picker.js'
import NativeBrowseDirectoryPicker, { type Config as NativeDirectoryConfig } from '@deepseek-ai/dsh-host-directory-picker-browse'
import { createManagedHarnessCodeProvider } from './managed-code-runtime.js'
import { createManagedHarnessWorkflowProvider } from './managed-workflow.js'
import NativeWorkflow, { type Config as NativeWorkflowConfig } from '@deepseek-ai/dsh-workflow-worker-thread'
import type { Config as NativeFilesystemConfig } from '@deepseek-ai/dsh-fs-local'
import type { Config as NativeCodeConfig } from '@deepseek-ai/dsh-code-runtime-worker-thread'
import { PAIMIND_CLIENT_AUDIENCE_GLOBAL } from './client-audience.js'
import { executionScope, installManagedHarnessOriginGuard, type ManagedHarnessOriginCheck, type ManagedHarnessExecutionScope, type ManagedHarnessJobOriginSeal, type ManagedHarnessSkillUseCheck } from './managed-origins.js'
import { ApiProxyService } from '@deepseek-ai/dsh-host-apiproxy'
import { createManagedHarnessQueueApiProvider, readNativeTurnReceipt, type NativeTurnSelection, type ManagedHarnessQueueCheck } from './managed-queue.js'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { createManagedHarnessDelegationProviders, type ManagedHarnessOriginDerive } from './managed-delegation.js'
import { createManagedHarnessJobsProvider } from './managed-jobs.js'
import { readNativeConnectorInventory } from './connector-inventory.js'
import { createManagedHarnessCommandProviders } from './managed-command.js'
import { readPaimindNativeSessionPresetReference, readPaimindNativeSessionCreationReference, readPaimindNativeSessionDirectoryReference, readPaimindNativeSessionEventPage, readPaimindNativeApprovalReference } from './host.js'
export type { ManagedHarnessDelegationRequest, ManagedHarnessOriginDerive } from './managed-delegation.js'
export type { ManagedHarnessQueueRequest, ManagedHarnessQueueCheck } from './managed-queue.js'
export { installManagedHarnessOriginGuard } from './managed-origins.js'
export type { ManagedHarnessOrigins, ManagedHarnessOriginCheck, ManagedHarnessExecutionScope } from './managed-origins.js'
export type { ManagedHarnessJobOriginRequest, ManagedHarnessJobOriginSeal } from './managed-origins.js'
export type { ManagedHarnessLoadedSkill, ManagedHarnessSkillUseReference, ManagedHarnessSkillUseCheck } from './managed-origins.js'
export { readManagedHarnessStorageScopes } from './managed-storage.js'
export type { ManagedHarnessStorageScope, ManagedHarnessStorageSnapshot } from './managed-storage.js'

/** Immutable native call projection; deliberately excludes the live Context,
 * service handles, execution token and mutable Agent/Session objects. */
export interface ManagedHarnessToolCall {
  readonly name: string
  readonly callId: string
  readonly rootCallId: string
  readonly arguments: unknown
  readonly agentId?: string
  readonly sessionId?: string
  readonly presetId?: string
  /** Exact native registration provenance only; never a grant or cached approval. */
  readonly connector?: Readonly<{ entryId: string | null; serverName: string; transport: 'stdio' | 'streamable-http'; instanceId: string }>
}

/** Image-owned synchronous admission floor, not a cached enterprise grant. */
export type ManagedHarnessPresetGuard = (scope: Readonly<ManagedHarnessExecutionScope>) => string | undefined

function checkedReason(reason: unknown): string | undefined {
  if (reason === undefined || typeof reason === 'string' && reason.trim()) return reason as string | undefined
  if (reason && typeof (reason as PromiseLike<unknown>).then === 'function') void Promise.resolve(reason).catch(() => undefined)
  return policyFailure
}

/** Synchronous deployment policy. undefined does not override another denial. */
export type ManagedHarnessToolGuard = (call: Readonly<ManagedHarnessToolCall>) => string | undefined

const guardOwners = new WeakSet<Context>()
const policyFailure = 'Managed tool policy could not authorize this operation'

/** Register before the native Loader mounts tools; check readiness after boot.
 * The native registry remains the only dispatcher and scope/guard owner.
 * This is not a process sandbox or authority over direct service/RPC calls. */
export function installManagedHarnessToolGuard(root: Context, check: ManagedHarnessToolGuard,
  presetGuard?: ManagedHarnessPresetGuard): Readonly<{ assertReady(): void }> {
  assert.ok(root === root.root, 'Managed tool policy must belong to the application root')
  assert.equal(typeof check, 'function')
  assert.ok(!guardOwners.has(root), 'Managed tool policy already belongs to this application')
  guardOwners.add(root)
  let activeGeneration: object | undefined
  // Native preparation (including approval) can finish before its scheduler
  // dispatches the body. This is per-execution correlation, never a cached
  // allow, Session registry or transferable permission.
  const prepared = new WeakMap<object, {
    generation: object
    call: Readonly<ManagedHarnessToolCall>
    recheck(): string | undefined
  }>()
  const approvalStarts = new WeakMap<object, {
    session: NonNullable<ToolExecution['agent']>['session']; start: number
  }>()
  const lifetime = new AbortController()
  root.effect(() => () => lifetime.abort())
  root.on('tools/pre-execute', async (execution, next) => {
    const session = execution.agent?.session
    if (session) approvalStarts.set(execution, { session, start: session.events.length })
    return next()
  }, { prepend: true })
  const checkpointApproval = async (execution: ToolExecution) => {
    const start = approvalStarts.get(execution); approvalStarts.delete(execution)
    if (!execution.agent) return
    const session = execution.agent.session
    if (!start || start.session !== session || session.events.length < start.start
      || session.events.length - start.start > 10000) throw new Error(policyFailure)
    // Correlate only this native preparation interval and exact tool call.
    // Never select a historical approval by name or reuse a prior decision.
    const events = session.events.slice(start.start) as readonly {
      type: string; seq: number; data: { callId?: string; id: string; toolName: string }
    }[]
    const requests = events.filter(event => event.type === 'approval/asked'
      && event.data.callId === execution.callId)
    if (!requests.length) return
    if (requests.length !== 1 || requests[0]!.data.toolName !== execution.name) throw new Error(policyFailure)
    const request = requests[0]!, signal = AbortSignal.any([execution.signal, lifetime.signal, AbortSignal.timeout(4000)])
    const read = () => readPaimindNativeApprovalReference(root as never, session.id, request.data.id, signal)
    const before = await read()
    if (before.askedSeq !== request.seq || before.outcome !== 'allowed-once' || before.answerable) throw new Error(policyFailure)
    if (!before.persisted) {
      // This is the write-side dispatch barrier, not a side effect of a read.
      // SessionStore remains the sole writer and failure owner. A timeout or
      // abort can leave a late flush, but can never continue to the tool body.
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error(policyFailure))
        signal.addEventListener('abort', abort, { once: true })
        Promise.resolve().then(async () => {
          signal.throwIfAborted()
          if (!(await root.sessions.flush(session))) throw new Error(policyFailure)
          signal.throwIfAborted()
        }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
    }
    const after = await read()
    signal.throwIfAborted()
    if (execution.agent.session !== session || after.version !== before.version || !after.persisted
      || after.outcome !== 'allowed-once') throw new Error(policyFailure)
  }
  root.on('tools/execute', async (execution, next) => {
    const entry = prepared.get(execution)
    if (!entry || entry.generation !== activeGeneration) throw new Error(policyFailure)
    try {
      const reason = entry.recheck()
      if (reason !== undefined) throw new Error(reason)
      await checkpointApproval(execution)
      // Approval persistence may wait for I/O. It never caches a permission;
      // recheck the exact prepared scope and deployment guard at dispatch.
      if (entry.generation !== activeGeneration) throw new Error(policyFailure)
      const latest = entry.recheck()
      if (latest !== undefined) throw new Error(latest)
      return next()
    } finally { prepared.delete(execution); approvalStarts.delete(execution) }
  }, { prepend: true })
  if (presetGuard !== undefined) {
    assert.equal(typeof presetGuard, 'function')
    // Native Agent owns scheduling and model dispatch. The root listener also
    // remains when the optional business-profile plugin is unloaded.
    root.on('agent/pre-step', async ({ agent }, next) => {
      let reason: string | undefined
      try { reason = activeGeneration ? checkedReason(presetGuard(executionScope(agent))) : policyFailure }
      catch { reason = policyFailure }
      if (reason !== undefined) throw new Error(reason)
      return next()
    }, { prepend: true })
  }
  root.inject(['tools'], context => {
    const generation = Object.freeze({})
    const project = (execution: Readonly<ToolExecution>, capture: boolean): string | undefined => {
      if (activeGeneration !== generation) return policyFailure
      try {
        const scope = execution.agent === undefined ? undefined : executionScope(execution.agent)
        if (presetGuard !== undefined) {
          if (!scope) return policyFailure
          const reason = checkedReason(presetGuard(scope))
          if (reason !== undefined) return reason
        }
        const connectorCapture = capture ? captureConnectorToolOrigin(root, execution) : undefined
        const connector = capture ? connectorCapture?.reference : readConnectorToolOrigin(root, execution)
        const call = Object.freeze({
          name: execution.name, callId: execution.callId, rootCallId: execution.rootCallId,
          arguments: execution.arguments,
          ...scope,
          ...(connector === undefined ? {} : { connector }),
        })
        if (!capture) {
          const prior = prepared.get(execution)
          // The native execution carries immutable arguments/call identity;
          // the mounted Agent scope is live and can change while queued. Do
          // not silently move a prepared call into another permitted scope.
          if (!prior || prior.generation !== generation
            || Object.keys(call).length !== Object.keys(prior.call).length
            || Object.entries(call).some(([key, value]) => value !== prior.call[key as keyof ManagedHarnessToolCall])) return policyFailure
        }
        const reason = check(call)
        if (reason === undefined) {
          if (capture) prepared.set(execution, { generation, call, recheck: () => {
            try { connectorCapture?.assertCurrent() } catch { return policyFailure }
            return project(execution, false)
          } })
          return undefined
        }
        if (typeof reason === 'string' && reason.trim().length > 0) return reason
        // Native guards are synchronous. A misconfigured async check must never
        // become permission, including one which rejects after this dispatch.
        if (reason && typeof (reason as unknown as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(reason).catch(() => undefined)
        }
      } catch { /* fail closed without disclosing arguments or internal errors */ }
      return policyFailure
    }
    // Keep the guard on the root lifecycle, including an old registry retained
    // after its provider was withdrawn. Such references must deny, not become
    // unguarded when the dependency-injection callback unloads.
    root.tools.guard(execution => project(execution, true))
    context.effect(() => {
      activeGeneration = generation
      return () => { if (activeGeneration === generation) activeGeneration = undefined }
    }, 'managed native tool policy readiness')
  })
  return Object.freeze({ assertReady() { assert.ok(activeGeneration, 'Managed native tool policy is not active') } })
}

/** Trusted embedding facts, never values from a member request or workspace. */
export interface ManagedHarnessProfileOptions {
  runtimeRoot: string
  profileHome: string
  profileName: string
  installationManifest: string
  args: readonly string[]
  environment: Readonly<Record<string, string>>
  requestExit: (code: number) => void
  /** Lets the embedding process dispose even a still-starting native tree. */
  prepare?: (context: Context) => void | Promise<void>
  /** Image-owned execution policy, never user input. Does not grant admission. */
  toolGuard?: ManagedHarnessToolGuard
  /** Required enterprise adoption floor across native model steps and tools. */
  presetGuard?: ManagedHarnessPresetGuard
  /** Per-native-step and tool-dispatch live login/binding check, not a grant. */
  originCheck?: ManagedHarnessOriginCheck
  /** Original loaded body/version proof; paired with execution authority. */
  skillUseCheck?: ManagedHarnessSkillUseCheck
  /** Actual queue editor authority; paired with originCheck in managed cells. */
  queueCheck?: ManagedHarnessQueueCheck
  /** Native child provenance; requires the active-turn and queue authority. */
  originDerive?: ManagedHarnessOriginDerive
  /** Same-session native job completion provenance, never a scheduled login. */
  jobOriginSeal?: ManagedHarnessJobOriginSeal
  /** Presentation of an image-owned member cell, not role authorization.
   * Admin/non-enterprise compositions omit it and retain their native roster. */
  clientAudience?: 'member'
  /** Opt-in placement for native subprocess, filesystem, enabled Code Runtime
   * and native workflow entries together. Does not grant member admission. */
  executionDomain?: ManagedHarnessExecutionDomain
  /** Exact private DSH Home child owned by the original native Include.
   * Managed cells only; literal connector records are persisted disabled.
   * This does not approve activation, tool use or external network access. */
  nativeConnectorDirectory?: string
}

/** These native rows only provide platform management presentation/dynamic
 * client execution, already denied by member-personal-v1. Disable them via
 * the original composition contract before the native module graph is built.
 * Do not filter HTML, patch a client registry or grant their startup RPCs.
 * Keep ui-settings-general: it also owns the native Settings trigger, modal
 * and section slots used by the member's enterprise account/logout section. */
function memberClientPatches(rows: ReturnType<typeof composeEntries>) {
  const owners = [
    ['cordis-client-runner', '@deepseek-ai/dsh-cordis-client-runner'],
    ['ui-cordis', '@deepseek-ai/dsh-client-ui-cordis'],
    ['ui-settings-models', '@deepseek-ai/dsh-client-ui-settings-models'],
    ['ui-settings-plugins', '@deepseek-ai/dsh-client-ui-settings-plugins'],
    ['ui-settings-plugin-inventory', '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'],
  ] as const
  return owners.map(([id, name]) => {
    const matches = rows.filter(row => row.id === id || row.name === name)
    assert.ok(matches.length === 1 && matches[0]!.id === id && matches[0]!.name === name,
      `Unsupported member client owner: ${id}`)
    return { id, disabled: true }
  })
}

/** Preserve each original Loader row, schema, realm and lifetime, selecting
 * only exact pinned native implementations at the one normalization seam.
 * Root replacement alone misses preset-local workflows and adaptive pickers.
 * The original adaptive picker still owns its paired native browser UI. */
function installManagedImplementationSelection(root: Context, domain?: ManagedHarnessExecutionDomain, queueCheck?: ManagedHarnessQueueCheck,
  originDerive?: ManagedHarnessOriginDerive, installationManifest?: string,
  originCheck?: ManagedHarnessOriginCheck, requestExit?: (code: number) => void, jobOriginSeal?: ManagedHarnessJobOriginSeal) {
  const require = createRequire(import.meta.url)
  const version = JSON.parse(readFileSync(require.resolve('@deepseek-ai/cordis-plugin-loader/package.json'), 'utf8')) as { version: string }
  assert.equal(version.version, '1.0.2', 'Unsupported managed workflow Loader contract')
  assert.ok(root.get('loader'), 'Managed workflow selection requires the original Loader before entries mount')
  // Cordis wraps service functions per caller. Patch only this application's
  // original instance, never the prototype or another application's Loader.
  const loader = Reflect.get(root.loader, symbols.original) as Loader
  assert.ok(loader instanceof Loader, 'Unsupported native Loader identity')
  assert.equal(loader.unwrapExports, Loader.prototype.unwrapExports, 'Native Loader normalization already has another owner')
  assert.ok(!Object.hasOwn(loader, 'unwrapExports'), 'Native Loader normalization already has another owner')
  const original = loader.unwrapExports
  const connector = domain && (() => {
    assert.ok(installationManifest)
    const native = createRequire(installationManifest), name = '@deepseek-ai/dsh-mcp-client'
    const anchor = native.resolve(name + '/package.json')
    assert.equal(JSON.parse(readFileSync(anchor, 'utf8')).version, '0.1.1-rc.2')
    assert.equal(native('@deepseek-ai/dsh-tools/package.json').version, '0.1.1-rc.2',
      'Unsupported managed native connector dispatch contract')
    const sdk = createRequire(anchor).resolve('@modelcontextprotocol/sdk/client/stdio.js')
    assert.equal(JSON.parse(readFileSync(join(dirname(sdk), '../../../package.json'), 'utf8')).version, '1.30.0',
      'Unsupported managed native connector environment contract')
    return createManagedHarnessConnectorProvider(root, native(name), domain, native('@deepseek-ai/dsh-tools').ToolRuntime)
  })()
  let BoundDirectoryPicker: ReturnType<typeof createManagedHarnessDirectoryPickerProvider> | undefined
  let BoundWorkflow: ReturnType<typeof createManagedHarnessWorkflowProvider> | undefined
  if (domain) {
    const DirectoryPicker = createManagedHarnessDirectoryPickerProvider({ executionWorld: domain })
    BoundDirectoryPicker = class extends DirectoryPicker {
      constructor(context: Context, config: NativeDirectoryConfig) {
        for (const key of ['subprocess', 'sandbox', 'sandboxPolicy'] as const) {
          assert.equal(Reflect.get(context[key], symbols.original), Reflect.get(root[key], symbols.original),
            `Managed directory picker must use the root execution-world ${key}`)
        }
        super(context, config)
      }
    }
    const Workflow = createManagedHarnessWorkflowProvider({ executionWorld: domain })
    BoundWorkflow = class extends Workflow {
      constructor(context: Context, config: NativeWorkflowConfig) {
        assert.equal(Reflect.get(context.subprocess, symbols.original), Reflect.get(root.subprocess, symbols.original),
          'Managed workflow must use the root execution-world subprocess')
        assert.equal(Reflect.get(context.sandbox, symbols.original), Reflect.get(root.sandbox, symbols.original),
          'Managed workflow must use the root execution-world sandbox')
        assert.equal(Reflect.get(context.sandboxPolicy, symbols.original), Reflect.get(root.sandboxPolicy, symbols.original),
          'Managed workflow must use the root execution-world policy')
        super(context, config)
      }
    }
  }
  const queue = queueCheck && createManagedHarnessQueueApiProvider(queueCheck)
  const commands = originCheck && (() => {
    assert.ok(installationManifest)
    const native = createRequire(installationManifest)
    const modules = ['@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-commands', '@deepseek-ai/dsh-session-log-export'].map(name => {
      assert.equal(JSON.parse(readFileSync(native.resolve(name + '/package.json'), 'utf8')).version, '0.1.1-rc.2')
      return native(name)
    })
    const NativeWeb = modules[0].WebServer, NativeCommands = modules[1].CommandRuntime
    return { NativeWeb, NativeCommands, ...createManagedHarnessCommandProviders(root, NativeWeb, NativeCommands, modules[2], originCheck) }
  })()
  const jobs = originCheck && (() => {
    assert.ok(installationManifest && requestExit)
    const native = createRequire(installationManifest), name = '@deepseek-ai/dsh-jobs-local'
    assert.equal(JSON.parse(readFileSync(native.resolve(name + '/package.json'), 'utf8')).version, '0.1.1-rc.2')
    const Native = native(name).LocalJobRegistry as Parameters<typeof createManagedHarnessJobsProvider>[1]
    let completion: Parameters<typeof createManagedHarnessJobsProvider>[4]
    if (jobOriginSeal) {
      const name = '@deepseek-ai/dsh-tool-jobs'
      assert.equal(JSON.parse(readFileSync(native.resolve(name + '/package.json'), 'utf8')).version, '0.1.1-rc.2')
      completion = { controller: native(name), seal: jobOriginSeal,
        ownsFollowup: (agent, method) => delegation?.ownsFollowup(agent, method) ?? false }
    }
    return { Native, ...createManagedHarnessJobsProvider(root, Native, originCheck, requestExit, completion) }
  })()
  const delegation = originDerive && (() => {
    assert.ok(installationManifest)
    const native = createRequire(installationManifest)
    const modules = ['@deepseek-ai/dsh-subagent-spawn-in-process', '@deepseek-ai/dsh-subagent-fork-in-process'].map(name => {
      assert.equal(JSON.parse(readFileSync(native.resolve(name + '/package.json'), 'utf8')).version, '0.1.1-rc.2')
      return native(name) as Parameters<typeof createManagedHarnessDelegationProviders>[2][number]
    })
    return createManagedHarnessDelegationProviders(root, originDerive, modules)
  })()
  let active = false
  const select: Loader['unwrapExports'] = function (this: Loader, exports: unknown) {
    assert.ok(active, 'Managed workflow selection has been withdrawn')
    const plugin = original.call(this, exports)
    if (connector) { const selected = connector.select(plugin); if (selected !== plugin) return selected as typeof plugin }
    if (plugin === NativeWorkflow && BoundWorkflow) return BoundWorkflow
    if (plugin === NativeBrowseDirectoryPicker && BoundDirectoryPicker) return BoundDirectoryPicker
    if (plugin === ApiProxyService && queue) return queue.Provider
    if (commands && plugin === commands.NativeWeb) return commands.Web
    if (commands && plugin === commands.NativeCommands) return commands.Commands
    if (commands) { const selected = commands.selectExport(plugin); if (selected !== plugin) return selected as typeof plugin }
    if (jobs && plugin === jobs.Native) return jobs.Provider
    if (jobs) { const selected = jobs.selectController(plugin); if (selected !== plugin) return selected as typeof plugin }
    if (plugin === AgentRegistry && delegation) return delegation.Agents
    if (plugin === SubagentRuntime && delegation) return delegation.Subagents
    if (delegation) return delegation.selectProvider(plugin) as typeof plugin
    return plugin
  }
  root.effect(() => {
    active = true
    Object.defineProperty(loader, 'unwrapExports', { value: select, writable: true, configurable: true })
    return () => {
      active = false
      if (loader.unwrapExports === select) Reflect.deleteProperty(loader, 'unwrapExports')
    }
  }, 'managed native implementation selection')
  return { assertReady() {
    connector?.assertReady()
    assert.ok(active && Reflect.get(root.loader, symbols.original) === loader && loader.unwrapExports === select,
      'Managed workflow selection ownership changed')
    if (queue) assert.ok(root.get('apiProxy') && queue.owns(root.apiProxy), 'Managed queue authority is not active')
    if (commands) {
      assert.ok(root.get('webServer') && commands.ownsWeb(root.get('webServer') as object), 'Managed command carrier is not active')
      assert.ok(root.get('commands') && commands.ownsCommands(root.get('commands') as object), 'Managed command owner is not active')
    }
    if (jobs) assert.ok(root.get('jobs') && jobs.owns(root.get('jobs') as object), 'Managed job authority is not active')
    if (delegation) {
      assert.ok(root.get('agents') && delegation.ownsAgents(root.agents), 'Managed child creation authority is not active')
      assert.ok(root.get('subagents') && delegation.ownsSubagents(root.subagents), 'Managed delegation authority is not active')
    }
  } }
}

/** This version's default providers are replaced under one native owner. Reject unknown
 * composition/configuration instead of dropping it or evaluating native !!js
 * expressions through a second evaluator. The shipped filesystem row is empty;
 * literal native filesystem overrides are preserved and schema-validated. */
function managedCapabilityConfig(rows: ReturnType<typeof composeEntries>, domain: ManagedHarnessExecutionDomain) {
  for (const [id, name] of [
    ['subprocess', '@deepseek-ai/dsh-subprocess-local'], ['fs-sandbox', '@deepseek-ai/dsh-fs-sandbox'],
    ['sandbox', '@deepseek-ai/dsh-sandbox-local'], ['sandbox-policy', '@deepseek-ai/dsh-sandbox-policy'],
  ]) {
    const matches = rows.filter(row => row.id === id || row.name === name && row.disabled !== true)
    assert.ok(matches.length === 1 && matches[0]!.id === id && matches[0]!.name === name &&
      (matches[0]!.disabled === undefined || matches[0]!.disabled === false), `Unsupported managed capability owner: ${id}`)
  }
  assert.ok(!rows.some(row => row.name === '@deepseek-ai/dsh-fs-local' && row.disabled !== true),
    'Managed composition cannot also load a local filesystem provider')
  const subprocess = rows.find(row => row.id === 'subprocess')!
  assert.ok(subprocess.config === undefined || subprocess.config && typeof subprocess.config === 'object' &&
    Object.keys(subprocess.config).length === 0, 'Unsupported native subprocess configuration')
  const fs = rows.find(row => row.id === 'fs-sandbox')!
  for (const row of [subprocess, fs]) assert.ok(Object.keys(row).every(key => ['id', 'name', 'config', 'disabled'].includes(key)),
    'Unsupported managed capability row attributes')
  const config = fs.config ?? {}
  assert.ok(typeof config === 'object' && !Array.isArray(config) &&
    Object.keys(config).every(key => key === 'cwd' || key === 'diffBasisMaxBytes'), 'Unsupported native filesystem configuration')
  const native = config as Partial<NativeFilesystemConfig>
  assert.ok(native.cwd === undefined || native.cwd === domain.lookupCwd, 'Native filesystem cwd differs from its execution world')
  assert.ok(native.diffBasisMaxBytes === undefined || typeof native.diffBasisMaxBytes === 'number',
    'Managed filesystem requires literal native configuration')
  const codeRows = rows.filter(row => row.id === 'code-runtime' ||
    row.name === '@deepseek-ai/dsh-code-runtime-worker-thread' && row.disabled !== true)
  assert.ok(codeRows.length === 1 && codeRows[0]!.id === 'code-runtime' &&
    codeRows[0]!.name === '@deepseek-ai/dsh-code-runtime-worker-thread', 'Unsupported managed capability owner: code-runtime')
  const code = codeRows[0]!
  assert.ok(Object.keys(code).every(key => ['id', 'name', 'config', 'disabled'].includes(key)),
    'Unsupported managed code row attributes')
  const codeConfig = code.config ?? {}
  assert.ok(typeof codeConfig === 'object' && !Array.isArray(codeConfig) &&
    Object.entries(codeConfig).every(([key, value]) =>
      ['computeMs', 'maxWallMs', 'maxOutputBytes', 'maxOldGenerationSizeMb'].includes(key) && typeof value === 'number'),
  'Managed code requires literal native configuration')
  return { filesystem: { ...native, cwd: domain.lookupCwd },
    code: code.disabled === true ? undefined : codeConfig as Partial<NativeCodeConfig> }
}

/** Native DI owns both providers and their withdrawal/recreation. No parallel
 * service registry: readiness checks the actual root services and exact class
 * pair created from this one immutable deployment-world snapshot. */
function installManagedCapabilities(root: Context, domain: ManagedHarnessExecutionDomain, config: ReturnType<typeof managedCapabilityConfig>) {
  let assertCurrent: (() => void) | undefined
  const lifecycle = root.inject(['sandbox', 'sandboxPolicy'], async context => {
    assert.equal(context.sandboxPolicy.workspaceRoot, domain.lookupCwd, 'Native policy root differs from its execution world')
    assert.equal(root.get('subprocess'), undefined, 'Managed subprocess must replace its original provider')
    assert.equal(root.get('fs'), undefined, 'Managed filesystem must replace its original provider')
    assert.equal(root.get('codeRuntime'), undefined, 'Managed Code Runtime must replace its original provider')
    const Process = createManagedHarnessSubprocessProvider(domain, context.sandbox)
    const Filesystem = createManagedHarnessFilesystemProvider({ executionWorld: domain })
    class BoundFilesystem extends Filesystem {
      constructor(ctx: Context, nativeConfig: NativeFilesystemConfig) {
        assert.ok(ctx.subprocess instanceof Process, 'Managed filesystem must use the same execution-world subprocess')
        super(ctx, nativeConfig)
      }
    }
    const Code = createManagedHarnessCodeProvider({ executionWorld: domain })
    await context.plugin(Process)
    await context.plugin(BoundFilesystem, config.filesystem)
    if (config.code !== undefined) {
      // Read from the explicit root: asking the enclosing injection context
      // for its own child service adds a circular native tracked dependency.
      assert.ok(root.subprocess instanceof Process, 'Managed Code Runtime must use the same execution-world subprocess')
      await context.plugin(Code, config.code)
    }
    const check = () => {
      assert.ok(root.subprocess instanceof Process && root.fs instanceof BoundFilesystem, 'Managed capability ownership changed')
      assert.ok(config.code === undefined ? root.get('codeRuntime') === undefined : root.codeRuntime instanceof Code,
        'Managed Code Runtime ownership changed')
    }
    check()
    context.effect(() => {
      assertCurrent = check
      return () => { if (assertCurrent === check) assertCurrent = undefined }
    }, 'managed capability pair readiness')
  })
  return { async assertReady() {
    assert.ok(root.get('sandbox') && root.get('sandboxPolicy'), 'Managed native capability pair is not active')
    // A service is published during construction, before the enclosing native
    // fiber finishes its readiness effect. Await that owner, not a timer/poll.
    await lifecycle
    assert.ok(assertCurrent, 'Managed native capability pair is not active')
    assertCurrent()
  } }
}

/** Build-only preparation in a fresh generated carrier, before relocation and sealing. */
export function prepareManagedHarnessModuleRoot(runtimeRoot: string): void {
  assert.ok(isAbsolute(runtimeRoot))
  assert.equal(realpathSync(runtimeRoot), runtimeRoot)
  const carrier = JSON.parse(readFileSync(join(runtimeRoot, 'package.json'), 'utf8')) as { name?: string; private?: boolean }
  assert.equal(carrier.name, '@paimind/enterprise-worker-runtime')
  assert.equal(carrier.private, true)
  assert.ok(!existsSync(join(runtimeRoot, 'profiles')), 'Native module fallback must have a fresh build-owned target')
  // Use the published closure traversal, not a second list of native plugin
  // packages. Its generated absolute links must be made relocatable here;
  // the subsequent generic tree verifier intentionally rejects absolute roots.
  const anchor = realpathSync(join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'))
  assert.ok(anchor.startsWith(`${runtimeRoot}${sep}`))
  healProfilesModuleFallback(anchor, runtimeRoot)
  const pending = [join(runtimeRoot, 'profiles/node_modules')]
  const links: { path: string; target: string }[] = []
  while (pending.length) {
    const directory = pending.pop()!
    assert.ok(lstatSync(directory).isDirectory() && realpathSync(directory) === directory)
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isDirectory()) { pending.push(path); continue }
      assert.ok(stat.isSymbolicLink(), 'Native module fallback must contain only package links')
      const target = realpathSync(path)
      assert.ok(target.startsWith(`${runtimeRoot}${sep}`) && lstatSync(target).isDirectory(),
        'Native module fallback target escapes the generated runtime')
      links.push({ path, target })
    }
  }
  // Preflight all generated links before replacing any. Only this fresh
  // build-owned fallback is changed; installed package sources remain intact.
  for (const { path, target } of links) {
    const temporary = `${path}.paimind-relative`
    symlinkSync(relative(dirname(path), target), temporary, 'dir')
    renameSync(temporary, path)
  }
  writeFileSync(join(runtimeRoot, 'profiles/package.json'), '{"private":true,"type":"module"}\n', { flag: 'wx', mode: 0o444 })
}

function sealedPath(path: string, root: string, kind: 'file' | 'directory'): string {
  assert.ok(isAbsolute(path) && isAbsolute(root), 'Managed paths must be absolute')
  assert.equal(realpathSync(root), root, 'Managed root must be canonical')
  const canonical = realpathSync(path)
  const rel = relative(root, canonical)
  assert.ok(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Managed path escapes its root')
  let current = canonical
  for (;;) {
    const stat = lstatSync(current)
    assert.ok(!stat.isSymbolicLink() && (stat.mode & 0o022) === 0, 'Managed path permits untrusted writes')
    assert.throws(() => accessSync(current, constants.W_OK),
      error => ['EACCES', 'EROFS'].includes((error as NodeJS.ErrnoException).code ?? ''),
      'Managed path must be read-only to the runtime identity')
    if (current === canonical && kind === 'file') assert.ok(stat.isFile() && stat.nlink === 1)
    else assert.ok(stat.isDirectory())
    if (current === root) break
    current = dirname(current)
  }
  return canonical
}

/**
 * Boot the published native Loader against an image-owned profile. Unlike the
 * interactive CLI, this does not initialize/rewrite profiles, read workspace or
 * user .env/patch layers, or install configuration watchers. Native bundles,
 * UI, presets, sessions and service implementations remain the original ones.
 *
 * Read-only paths are a composition precondition, NOT member authorization or
 * a sandbox. The embedding deployment must separately enforce its filesystem,
 * execution-domain, transport and role policies before admitting a member.
 */
export async function bootManagedHarnessProfile(options: ManagedHarnessProfileOptions): Promise<Context> {
  const { runtimeRoot, profileHome, profileName } = options
  assert.match(profileName, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
  assert.notEqual(runtimeRoot, profileHome)
  const installAnchor = sealedPath(options.installationManifest, runtimeRoot, 'file')
  const moduleAnchor = sealedPath(join(runtimeRoot, 'profiles/package.json'), runtimeRoot, 'file')
  const installation = JSON.parse(readFileSync(installAnchor, 'utf8')) as { name?: string; version?: string }
  assert.equal(installation.name, '@deepseek-ai/dsh')
  assert.equal(installation.version, '0.1.1-rc.2', 'Managed bootstrap requires its verified native version')
  const profileDir = join(profileHome, 'profiles', profileName)
  assert.equal(sealedPath(profileDir, profileHome, 'directory'), profileDir)
  for (const file of ['package.json', 'cordis.patch.yml', 'cordis.yml']) {
    assert.equal(sealedPath(join(profileDir, file), profileHome, 'file'), join(profileDir, file))
  }
  const rootConfig = join(profileDir, 'cordis.yml')
  assert.equal(readFileSync(rootConfig, 'utf8').trim(), '[]', 'Managed root must remain the empty native include')
  const profile = loadProfile('paimind-managed', profileName, installAnchor, profileHome)
  for (const layer of profile.layers) {
    sealedPath(layer.packageDir, runtimeRoot, 'directory')
    sealedPath(join(layer.packageDir, 'package.json'), runtimeRoot, 'file')
    sealedPath(layer.patchPath, runtimeRoot, 'file')
  }
  const patches = [...profile.layers.flatMap(layer => layer.patches), ...profile.patches]
  const rows = composeEntries([patches], message => { throw new Error(`Unsupported managed composition: ${message}`) })
  assert.equal(options.originCheck !== undefined, options.queueCheck !== undefined, 'Managed execution and queue authority must be paired')
  assert.equal(options.originCheck !== undefined, options.skillUseCheck !== undefined, 'Managed execution and loaded Skill authority must be paired')
  assert.ok(options.originDerive === undefined || options.originCheck !== undefined, 'Managed delegation requires paired execution and queue authority')
  assert.ok(options.jobOriginSeal === undefined || options.originCheck !== undefined, 'Managed job completion requires paired execution and queue authority')
  assert.ok(options.clientAudience === undefined || options.clientAudience === 'member', 'Unsupported managed client audience')
  if (options.clientAudience === 'member') patches.push(...memberClientPatches(rows))
  const executionDomain = options.executionDomain === undefined ? undefined : Object.freeze({
    nodeExecutable: options.executionDomain.nodeExecutable, moduleAnchor: options.executionDomain.moduleAnchor,
    lookupCwd: options.executionDomain.lookupCwd, prepare: options.executionDomain.prepare.bind(options.executionDomain),
  })
  const capabilityConfig = executionDomain && managedCapabilityConfig(rows, executionDomain)
  if (options.nativeConnectorDirectory !== undefined) {
    assert.ok(executionDomain && options.originCheck, 'Native connector configuration requires a managed private execution boundary')
    assert.ok(options.environment.DSH_HOME, 'Native connector configuration requires the exact private home')
    assert.equal(options.nativeConnectorDirectory, join(options.environment.DSH_HOME!, '.enterprise-connectors'))
  }
  if (executionDomain) {
    patches.push({ id: 'subprocess', disabled: true }, { id: 'fs-sandbox', disabled: true }, { id: 'code-runtime', disabled: true })
  }
  // The web bundle disables its HMR row. Never silently add it back merely to
  // watch a member-writable home, as the interactive CLI intentionally does.
  assert.ok(!rows.some(row => row.name === '@deepseek-ai/cordis-plugin-hmr' && row.disabled !== true),
    'Managed composition cannot enable native config HMR')
  const presets = rows.find(row => row.id === 'agent-presets')
  if (presets) {
    const shipped = sealedPath(join(dirname(installAnchor), 'config/agent-presets'), runtimeRoot, 'directory')
    const config = presets.config as { roots?: unknown[] } | undefined
    assert.ok(config?.roots === undefined || Array.isArray(config.roots))
    patches.push({ id: 'agent-presets', config: {
      ...config, roots: [{ path: shipped, trust: 'system' }, ...(config?.roots ?? [])],
    } })
  }
  const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...options.environment } }])
  const args = Object.freeze([...options.args])
  let current: Context | undefined
  let toolPolicy: ReturnType<typeof installManagedHarnessToolGuard> | undefined
  let capabilities: ReturnType<typeof installManagedCapabilities> | undefined
  let implementations: ReturnType<typeof installManagedImplementationSelection> | undefined
  const releaseFailureHandler = installFailLoud('paimind-managed', process, () => current?.fiber.dispose())
  try {
    const result = await boot('paimind-managed', rootConfig, patches, async context => {
      current = context
      context.effect(() => releaseFailureHandler)
      context.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
      provideCmdline(context, { args, exit: options.requestExit })
      const referenceLifetime = new AbortController()
      context.effect(() => () => referenceLifetime.abort())
      // Exact private read only. Original Loader and MCP plugin retain all
      // configuration, connection and tool lifecycle ownership.
      context.provide('paimindNativeConnectorReferences', Object.freeze({ read: (signal: AbortSignal) =>
        readNativeConnectorInventory(context as never, AbortSignal.any([signal, referenceLifetime.signal])) }))
      // Private launcher consumer only; no Remote/RPC registration or stored
      // projection. Original live/persistent Session owners supply every read.
      context.provide('paimindNativeSessionReferences', Object.freeze({ read: (sessionId: string, signal: AbortSignal) =>
        readPaimindNativeSessionPresetReference(context as never, sessionId, AbortSignal.any([signal, referenceLifetime.signal])),
      creation: (sessionId: string | undefined, signal: AbortSignal) =>
        readPaimindNativeSessionCreationReference(context as never, sessionId, AbortSignal.any([signal, referenceLifetime.signal])),
      turnState: (sessionId: string, selection: NativeTurnSelection | undefined, signal: AbortSignal) =>
        readNativeTurnReceipt(context, sessionId, selection, AbortSignal.any([signal, referenceLifetime.signal])),
      events: (sessionId: string, selection: import('./host.js').PaimindNativeEventSelection, signal: AbortSignal) =>
        readPaimindNativeSessionEventPage(context as never, sessionId, selection, AbortSignal.any([signal, referenceLifetime.signal])),
      approval: (sessionId: string, approvalId: string, signal: AbortSignal) =>
        readPaimindNativeApprovalReference(context as never, sessionId, approvalId, AbortSignal.any([signal, referenceLifetime.signal])),
      directory: async (sessionId: string, path: string | undefined, signal: AbortSignal) => {
        const lifetime = AbortSignal.any([signal, referenceLifetime.signal])
        const reference = await readPaimindNativeSessionDirectoryReference(context as never, sessionId, lifetime)
        const view = await readManagedHarnessDirectoryView(context as never, reference.cwd, path ?? reference.cwd, lifetime)
        const current = await readPaimindNativeSessionDirectoryReference(context as never, sessionId, lifetime)
        assert.equal(current.cwd, reference.cwd, 'Native session directory changed during listing')
        return view
      },
      file: async (sessionId: string, path: string, offset: number, version: string | undefined, signal: AbortSignal) => {
        const lifetime = AbortSignal.any([signal, referenceLifetime.signal])
        const reference = await readPaimindNativeSessionDirectoryReference(context as never, sessionId, lifetime)
        // Relative names are rooted only in the original Session, never in a
        // submitted cwd/repoRoot or in the controller's working directory.
        assert.ok(typeof path === 'string' && !path.split('/').includes('..'))
        const selected = resolve(reference.cwd, path)
        const chunk = await readManagedHarnessFileChunk(context as never, reference.cwd, selected, offset, version, lifetime)
        const current = await readPaimindNativeSessionDirectoryReference(context as never, sessionId, lifetime)
        assert.equal(current.cwd, reference.cwd, 'Native session directory changed during file read')
        return chunk
      } }))
      if (options.clientAudience === 'member') {
        // Native webserver serializes this through its ordinary trusted index
        // seat. No interception/rewriting of HTML, module graphs or responses.
        // This says nothing about the browser's authenticated principal.
        const nativeIndex = context as unknown as {
          on(name: 'webserver/index-inject', listener: (table: { kind: string; name?: string; value?: unknown }[]) => void): () => void
        }
        nativeIndex.on('webserver/index-inject', table => {
          assert.ok(!table.some(row => row.kind === 'global' && row.name === PAIMIND_CLIENT_AUDIENCE_GLOBAL),
            'Managed client audience already has an index owner')
          table.push({ kind: 'global', name: PAIMIND_CLIENT_AUDIENCE_GLOBAL,
            value: { schemaVersion: 1, audience: 'member' } })
        })
      }
      if (options.presetGuard !== undefined && options.toolGuard === undefined) throw new Error('Managed preset policy requires the native tool guard')
      if (options.toolGuard !== undefined) toolPolicy = installManagedHarnessToolGuard(context, options.toolGuard, options.presetGuard)
      if (options.originCheck !== undefined) {
        const native = createRequire(installAnchor), name = '@deepseek-ai/dsh-skill'
        assert.equal(JSON.parse(readFileSync(native.resolve(name + '/package.json'), 'utf8')).version, '0.1.1-rc.2')
        installManagedHarnessOriginGuard(context, options.originCheck, { check: options.skillUseCheck!, render: native(name).renderSkillContent })
      }
      if (executionDomain || options.queueCheck) implementations = installManagedImplementationSelection(context, executionDomain, options.queueCheck,
        options.originDerive, installAnchor, options.originCheck, options.requestExit, options.jobOriginSeal)
      if (executionDomain) {
        capabilities = installManagedCapabilities(context, executionDomain, capabilityConfig!)
      }
      await options.prepare?.(context)
    }, pathToFileURL(moduleAnchor).href)
    toolPolicy?.assertReady()
    await capabilities?.assertReady()
    implementations?.assertReady()
    if (options.nativeConnectorDirectory !== undefined) {
      const configuration = await createNativeConnectorConfiguration(result, options.nativeConnectorDirectory)
      result.provide('paimindNativeConnectorConfiguration', configuration)
      // Trusted embedding owns enterprise identity, while this adapter alone
      // composes its current check with original native lifecycle/provenance.
      const authority = result.get('paimindEnterpriseConnectorAuthority') as Parameters<typeof createManagedConnectorAuthority>[2] | undefined
      if (authority) result.provide('paimindNativeConnectorActivation', createManagedConnectorAuthority(result, configuration, authority))
    }
    return result
  } catch (error) {
    try { await current?.fiber.dispose() } finally { releaseFailureHandler() }
    throw error
  }
}
