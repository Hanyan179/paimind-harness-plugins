import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { authorizeNativeExecution, authorizeNativeSkillUse, authorizeNativeConnectorUse, deriveNativeOrigins, sealNativeJobOrigins } from './native-control.mjs'

// Process/resource ownership only. All version-sensitive native bootstrap
// calls live behind harness-compat; no upstream runtime source is embedded.
const preparedStorage = process.argv[2] === '--prepared-storage'
const inspectStorage = process.argv.at(-1) === '--inspect-storage'
assert.ok(preparedStorage ? process.argv.length === 4 || process.argv.length === 5 && inspectStorage
  : process.argv.length === 2 || process.argv.length === 3 && inspectStorage)
const runtimeRoot = '/opt/paimind'
const adapter = await realpath(`${runtimeRoot}/node_modules/@paimind/harness-compat/lib/managed-runtime.js`)
assert.ok(adapter.startsWith(`${runtimeRoot}/node_modules/`))
const { bootManagedHarnessProfile, readManagedHarnessStorageScopes } = await import(pathToFileURL(adapter).href)
const publicationModule = await realpath(`${runtimeRoot}/node_modules/@paimind/agent-builder/lib/publication.js`)
assert.ok(publicationModule.startsWith(`${runtimeRoot}/node_modules/`))
const { ENTERPRISE_AGENT_PRESET_PREFIX } = await import(pathToFileURL(publicationModule).href)
assert.ok(typeof ENTERPRISE_AGENT_PRESET_PREFIX === 'string' && ENTERPRISE_AGENT_PRESET_PREFIX.length > 0)
let executionDomain
if (preparedStorage) {
  const { readPreparedStorageLayout, verifyPreparedStorageMounts } = await import('./prepared-storage.mjs')
  const { createPreparedExecutionDomain } = await import('./confine-execution.mjs')
  const layout = readPreparedStorageLayout(process.argv[3], process.cwd())
  executionDomain = createPreparedExecutionDomain(layout.memberRoot, verifyPreparedStorageMounts(layout))
}
let context
let stopping
let stoppingRequested = false
let memberPolicy
let memberGuard
let privateControl
const controlLifetime = new AbortController()
if (process.env.PAIMIND_MANAGED_CELL_POLICY !== undefined) {
  assert.ok(preparedStorage && executionDomain && !inspectStorage, 'Member tools require a prepared execution world')
  const { parseManagedCellPolicy, createManagedToolGuard } = await import('./member-tool-policy.mjs')
  memberPolicy = parseManagedCellPolicy(process.env.PAIMIND_MANAGED_CELL_POLICY)
  memberGuard = createManagedToolGuard(memberPolicy, provenance => context?.get('paimindNativeConnectorActivation')?.admits(provenance) === true)
}
async function stop(code) {
  if (stopping) return stopping
  stoppingRequested = true
  controlLifetime.abort()
  stopping = (async () => {
    const deadline = setTimeout(() => process.exit(1), 8000)
    try {
      privateControl?.close()
      await context?.fiber.dispose()
      process.exitCode = code
    } catch (error) {
      process.stderr.write(`Managed native shutdown failed: ${error.message}\n`)
      process.exitCode = 1
    } finally { clearTimeout(deadline) }
  })()
  return stopping
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void stop(0))
try {
  context = await bootManagedHarnessProfile({
    runtimeRoot,
    profileHome: '/usr/share/paimind/managed',
    profileName: 'web',
    installationManifest: `${runtimeRoot}/node_modules/@deepseek-ai/dsh/package.json`,
    args: ['--host', '127.0.0.1', '--port', '3210', '--no-open'],
    environment: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
    executionDomain,
    ...(memberPolicy && preparedStorage && !inspectStorage ? {
      nativeConnectorDirectory: '/var/lib/paimind/dsh-home/.enterprise-connectors',
    } : {}),
    ...(memberPolicy?.role === 'member' ? { clientAudience: 'member' } : {}),
    requestExit: code => void stop(code),
    // Candidate cells have not passed member admission. Keep tool execution
    // explicitly sealed, including scope-local and Code Mode dispatch. This
    // is a temporary candidate gate, not the final member capability policy
    // and not a substitute for isolating subprocess/code/filesystem services.
    toolGuard: memberGuard ?? (() => '当前运行单元尚未通过成员权限与执行隔离验收，工具执行暂不可用'),
    // Materialization is not a grant. The synchronous floor requires a live
    // private channel; the root origin guard separately verifies exact native
    // bytes, login, assignment and revocation on every step and tool call.
    presetGuard: scope => typeof scope.presetId !== 'string'
      || scope.presetId.startsWith(ENTERPRISE_AGENT_PRESET_PREFIX) && !privateControl?.ready
      ? '企业发布版本的当前权限通道不可用，不能执行该预设' : undefined,
    ...(process.env.PAIMIND_NATIVE_CONTROL_SOCKET !== undefined ? { originCheck: async (input, signal) => {
      if (!privateControl?.ready) throw new Error('Private login origin authority unavailable')
      return authorizeNativeExecution(context, privateControl, input, signal)
    }, skillUseCheck: async (input, skill, signal) => {
      if (!privateControl?.ready) throw new Error('Private loaded Skill authority unavailable')
      return authorizeNativeSkillUse(context, privateControl, input, skill, signal)
    }, queueCheck: async ({ action, ...input }, signal) => {
      if (!privateControl?.ready) throw new Error('Private queue editor authority unavailable')
      // Removing unstarted work requires the actual editor's current login,
      // not permission to run a possibly withdrawn enterprise publication.
      // Hydrating the original cold owner cannot execute a message. The turn
      // guard performs full current composition authorization after hydration,
      // before the original prompt write; no cached resume grant is retained.
      if (action === 'remove' || action === 'resume' || action === 'approval-reject') await privateControl.checkOrigins({ nativeSessionId: input.nativeSessionId, sources: input.sources }, signal)
      else await authorizeNativeExecution(context, privateControl, input, signal)
    }, originDerive: async (input, signal) => {
      if (!privateControl?.ready) throw new Error('Private delegation authority unavailable')
      return deriveNativeOrigins(context, privateControl, input, signal)
    }, jobOriginSeal: async (input, signal) => {
      if (!privateControl?.ready) throw new Error('Private job origin authority unavailable')
      return sealNativeJobOrigins(context, privateControl, input, signal)
    } } : {}),
    prepare: value => {
      context = value
      if (process.env.PAIMIND_NATIVE_CONTROL_SOCKET !== undefined) {
        context.provide('paimindEnterpriseConnectorAuthority', Object.freeze({ signal: controlLifetime.signal,
          readApproval: (reference, expectedApprovalRevision, signal) => {
            if (!privateControl?.ready) throw new Error('Private connector authority unavailable')
            return privateControl.readConnectorApproval({ reference, expectedApprovalRevision }, signal)
          },
          authorizeUse: (origins, reference, revision, signal) => {
            if (!privateControl?.ready) throw new Error('Private connector execution authority unavailable')
            return authorizeNativeConnectorUse(context, privateControl, origins, reference, revision, signal)
          },
        }))
        context.provide('paimindEnterpriseSkillEligibility', Object.freeze({ read: (references, signal) => {
          if (!privateControl?.ready) throw new Error('Private Skill eligibility authority unavailable')
          return privateControl.readSkillEligibility(references, signal)
        } }))
      }
    },
  })
  if (process.env.PAIMIND_NATIVE_CONTROL_SOCKET !== undefined && !stopping) {
    assert.ok(preparedStorage && !inspectStorage, 'Private control requires a prepared runtime')
    const { connectNativeControl } = await import('./native-control.mjs')
    privateControl = await connectNativeControl(process.env.PAIMIND_NATIVE_CONTROL_SOCKET, context, () => { if (!stoppingRequested) void stop(1) })
    if (stoppingRequested) privateControl.close()
  }
  if (inspectStorage && !stopping) {
    // Operator-only cold preflight. No member binding or externally published
    // endpoint may route to this process. Native owners still load their own
    // records; output contains references only, not copied session history.
    const snapshot = await readManagedHarnessStorageScopes(context, process.cwd())
    if (stopping) throw Error('Native storage discovery cancelled')
    await stop(0)
    if (process.exitCode !== 0) throw Error('Native storage discovery did not join shutdown')
    process.stdout.write(`${JSON.stringify({ event: 'native-storage-discovery', snapshot,
      storagePrepared: false, memberAdmissionVerified: false })}\n`)
  } else if (stopping) await context.fiber.dispose()
  else process.stdout.write(`${JSON.stringify({ event: 'managed-native-profile-ready', nativeToolGuardActive: true,
    nativePrivateControlActive: privateControl?.ready === true,
    storageMounted: !!executionDomain, unpreparedExecutionRootGateActive: !!executionDomain,
    toolPolicy: memberPolicy?.policy ?? 'candidate-not-admitted',
    ...(memberPolicy ? { cellId: memberPolicy.cellId, cellRole: memberPolicy.role, policyDigest: memberPolicy.digest } : {}),
    memberAdmissionVerified: false })}\n`)
} catch (error) {
  process.stderr.write(`Managed native bootstrap failed: ${error.stack ?? error}\n`)
  await stop(1)
}
