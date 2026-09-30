import { classifyHarnessReadRequest, decodeHarnessRpcOperation, prepareHarnessMemberSettingsRead, prepareHarnessCommandListRequest, prepareHarnessExportCommandRequest, type HarnessOperationCapability } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseError } from './errors.js'
import { parsePaimindSidebarDownlink, parsePaimindSidebarTreeRequest, parsePaimindSidebarFileRequest, parsePaimindSidebarFileResource, preparePaimindSidebarPresentationRead } from '@paimind/better-sidebar-adapter'
import { ENTERPRISE_AGENT_PRESET_PREFIX } from '@paimind/agent-builder/publication'
import { resolveHarnessSettingsNamespace } from '@paimind/harness-compat'
import { PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE } from '@paimind/extension-center/feature-packs'
import { isPaimindBootReadinessSubmission } from '@paimind/extension-center'

export interface NativeOperationRequest {
  readonly method: string
  readonly target: string
  readonly contentType: string | undefined
  readonly body: Uint8Array
}

// Explicit reviewed operations, not namespace wildcards. These are role-level
// permissions, NOT proof that a requested object belongs to this user. Runtime
// admission, per-cell ownership, assigned-resource protection and tool/process
// enforcement remain separate mandatory gates before any member is admitted.
const MEMBER_NATIVE_CAPABILITIES: ReadonlySet<HarnessOperationCapability> = new Set([
  'host-description', 'conversation', 'workspace', 'agent-selection', 'skill-catalog', 'goal', 'model-catalog',
])
const MEMBER_PAIMIND_OPERATIONS: ReadonlySet<string> = new Set([
  'paimindAgentProfiles/listProfiles', 'paimindAgentProfiles/saveProfile',
  'paimindAgentProfiles/getPublicationSnapshot',
  'paimindAgentProfiles/setDefault', 'paimindAgentProfiles/removeProfile',
  'paimindAgentProfiles/sealAuthoringSession', 'paimindAgentProfiles/prepareAuthoringTurn',
  'paimindAgentProfiles/bindSession', 'paimindAgentProfiles/listSessionBindings',
  'paimindAgentProfiles/migrationPlan', 'paimindAgentProfiles/recordMigration',
  'paimindAgentProfiles/recordVerification', 'paimindAgentProfiles/verifySession', 'paimindAgentProfiles/listAudit',
  'paimindSkillInstaller/listInstalled', 'paimindSkillInstaller/getUserSkillPolicy',
  'paimindSkillInstaller/listSystemSkills', 'paimindSkillInstaller/getSessionBusinessSkillSelection',
  'paimindSkillInstaller/replaceSessionBusinessSkillSelection',
  'paimindSkillInstaller/readAdoptedSkillContent',
  'paimindSkillInstaller/setAdoptedSkillPreference',
  'paimindNotifications/list', 'paimindNotifications/markRead', 'paimindNotifications/markAllRead',
])
const denied = (): never => { throw new EnterpriseError(403, 'native-operation-denied', '当前账户未获授权执行此操作') }
const governed = (): never => { throw new EnterpriseError(403, 'feature-governance-required', '请通过扩展中心选择成员并确认功能包变更；直接修改或打开整体设置文件未获授权') }
const featureNamespace = resolveHarnessSettingsNamespace(PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE)
const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/** Authority is a server-authenticated role, never a cookie-adjacent header,
 * request argument or native workspace setting. Unknown member operations
 * remain closed until explicitly implemented and reviewed. */
export function authorizeNativeOperation(role: 'admin' | 'member', request: NativeOperationRequest): void {
  if (request.target.startsWith('/_paimind/')) return denied()
  if (role !== 'admin' && role !== 'member') return denied()
  // The original provider registers a prefix. Neither role may fall through
  // to its unrestricted host read using suffixes or unreviewed parameters.
  if (request.target.startsWith('/sidebar/file')) {
    try { if (request.body.byteLength === 0 && parsePaimindSidebarFileResource(request.method, request.target)) return }
    catch { throw new EnterpriseError(400, 'invalid-native-operation', '文件下载请求格式无效') }
    return denied()
  }
  // This owner uses plain JSON, not the Harness RPC carrier. Submission cannot
  // select another cell or mutate settings; diagnostic reads remain admin-only.
  if (isPaimindBootReadinessSubmission(request.method, request.target, request.contentType, request.body)) return
  // Listing may invoke the native Agent resolver. NativeGateway separately
  // requires current private-session preset eligibility, including for admin.
  try { if (prepareHarnessCommandListRequest(request.method, request.target, request.contentType, request.body)) return }
  catch { throw new EnterpriseError(400, 'invalid-native-operation', '命令列表请求格式无效') }
  // Only the reviewed original export command. NativeGateway and the managed
  // native owner independently check current actor, exact Session and preset.
  try { if (prepareHarnessExportCommandRequest(request.method, request.target, request.contentType, request.body)) return }
  catch { throw new EnterpriseError(400, 'invalid-native-operation', '导出命令请求格式无效') }
  try { if (preparePaimindSidebarPresentationRead(request.method, request.target, request.contentType, request.body)) return }
  catch { throw new EnterpriseError(400, 'invalid-native-operation', '侧栏显示请求格式无效') }
  try { if (parsePaimindSidebarTreeRequest(request.method, request.target, request.contentType, request.body)) return }
  catch { throw new EnterpriseError(400, 'invalid-native-operation', '文件树请求格式无效') }
  try { if (parsePaimindSidebarFileRequest(request.method, request.target, request.contentType, request.body)) return }
  catch { throw new EnterpriseError(400, 'invalid-native-operation', '文件读取请求格式无效') }
  if (request.body.byteLength === 0 && classifyHarnessReadRequest(request.method, request.target)) return
  // Resource existence in the admitted private cell is checked independently
  // by the gateway, inside Identity's audited authorization boundary.
  if (request.body.byteLength === 0 && parsePaimindSidebarDownlink(request.method, request.target)) return
  // Retain administrator-only native document/file reads. Native RPC requests
  // must use the same exact published carrier as member requests; role cannot
  // skip decoding and thereby hide a settings write behind an alias.
  if (role === 'admin' && request.body.byteLength === 0 && ['GET', 'HEAD'].includes(request.method)
    && !request.target.startsWith('/api/')) return
  let operation
  try { operation = decodeHarnessRpcOperation(request.method, request.target, request.contentType, request.body) }
  catch { throw new EnterpriseError(400, 'invalid-native-operation', '原生操作请求格式无效') }
  // Responding to this cell's own native question is not platform authority.
  // The execution boundary must independently reject impermissible escalation.
  if (operation.kind === 'response') return
  if (role === 'admin') {
    if (operation.capability === 'settings-document' || operation.capability === 'unsupported-settings') return governed()
    if (operation.capability === 'settings-write') {
      let namespace: string
      try {
        if (typeof operation.args.ns !== 'string') throw new TypeError('Missing settings namespace')
        namespace = resolveHarnessSettingsNamespace(operation.args.ns)
      } catch { throw new EnterpriseError(400, 'invalid-native-operation', '原生设置命名空间无效') }
      if (namespace === featureNamespace) return governed()
    }
    // This service belongs to PAIMind, not the upstream vocabulary adapter.
    // Its public management method never substitutes for control-plane
    // approval/current target pin/durable command/audit. Reads still boot UI.
    if (operation.endpoint.startsWith('paimindFeaturePacks/') && operation.endpoint !== 'paimindFeaturePacks/describe') return governed()
    return
  }
  if (operation.capability === 'settings-read') {
    // This is permission to receive the two-field presentation projection,
    // never the original settings document. NativeGateway owns that required
    // response boundary and rechecks identity before releasing any bytes.
    try {
      if (prepareHarnessMemberSettingsRead(request.method, request.target, request.contentType, request.body)) return
    } catch { return denied() }
    return denied()
  }
  // Only admitted managed member cells reach this path. Their native browse
  // provider pins a per-call owned directory in the execution world; these two
  // operations do not grant host.openPath, an OS chooser or general host I/O.
  if (operation.endpoint === 'host.listDirectory' || operation.endpoint === 'host.createDirectory') {
    const { path, name } = operation.args
    const create = operation.endpoint === 'host.createDirectory'
    if (Object.keys(operation.args).some(key => !['path', ...(create ? ['name'] : [])].includes(key))
      || (path !== undefined || create) && (typeof path !== 'string' || path.length > 4096 || path.includes('\0'))
      || create && (typeof name !== 'string' || name.length > 255 || name.includes('\0'))) return denied()
    return
  }
  // Agent Center's actual save sequence copies the native standard preset
  // before writing its personal business profile. Do not expose arbitrary
  // native preset composition/document writes or permit a privileged source.
  if (operation.endpoint === 'agentPreset.copy') {
    const { from, agentPreset, name } = operation.args
    if (from !== 'standard' || typeof agentPreset !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(agentPreset)
      || agentPreset.startsWith(ENTERPRISE_AGENT_PRESET_PREFIX)
      || ['standard', 'minimal', 'ptc', 'code', 'cordis'].includes(agentPreset)
      || name !== undefined && (typeof name !== 'string' || name.length > 80)
      || Object.keys(operation.args).some(key => !['from', 'agentPreset', 'name'].includes(key))) return denied()
    return
  }
  if (operation.capability && MEMBER_NATIVE_CAPABILITIES.has(operation.capability)) return
  if (!MEMBER_PAIMIND_OPERATIONS.has(operation.endpoint)) return denied()
  if (operation.endpoint.startsWith('paimindNotifications/')) {
    // The notification owner is instantiated in this admitted member's private
    // cell and durable volume. No request can select a different recipient,
    // user, tenant or source; recipientIds in stored records are metadata, not
    // a query scope or a grant. Publishing remains a trusted producer service.
    if (operation.endpoint === 'paimindNotifications/markRead') {
      const input = operation.args.request
      const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
      if (Object.keys(operation.args).join(',') !== 'request' || !record(input)
        || Object.keys(input).sort().join(',') !== 'id,ifVersion'
        || typeof input.id !== 'string' || !id.test(input.id)
        || typeof input.ifVersion !== 'string' || !id.test(input.ifVersion)) return denied()
    } else if (Object.keys(operation.args).length !== 0) return denied()
  }
  if (operation.endpoint === 'paimindSkillInstaller/setAdoptedSkillPreference') {
    const input = operation.args.input
    if (Object.keys(operation.args).join(',') !== 'input' || !record(input) || !record(input.reference)
      || Object.keys(input).sort().join(',') !== 'expectedRevision,field,reference,value'
      || !['enabled', 'direct'].includes(String(input.field)) || typeof input.value !== 'boolean'
      || typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return denied()
    // The native owner checks exact adoption/current assignment, preserves all
    // other stored preferences, and never actuates system Plugin capabilities.
  }
  if (operation.endpoint === 'paimindSkillInstaller/readAdoptedSkillContent') {
    const input = operation.args.input
    if (Object.keys(operation.args).join(',') !== 'input' || !record(input) || !record(input.reference)
      || !['directory', 'file'].includes(String(input.kind)) || typeof input.path !== 'string'
      || Object.keys(input).some(key => !['reference', 'kind', 'path', ...(input.kind === 'file' ? ['offset'] : ['cursor'])].includes(key))) return denied()
    // The original owner validates the complete fixed reference, reads only
    // this cell's adoption, and checks current assignment before returning.
  }
  if (operation.endpoint === 'paimindAgentProfiles/saveProfile') {
    const input = operation.args.input
    if (!record(input) || ![undefined, 'personal'].includes(input.productKind as string | undefined)
      || input.basePresetId !== 'standard' || (input.businessCategory !== undefined && input.businessCategory !== '')
      || input.businessCategoryId !== undefined) return denied()
  }
  if (operation.endpoint === 'paimindAgentProfiles/prepareAuthoringTurn') {
    const input = operation.args.input
    if (!record(input) || !record(input.draft) || input.draft.productKind !== 'personal'
      || input.draft.basePresetId !== 'standard' || input.draft.businessCategory !== '') return denied()
  }
}
