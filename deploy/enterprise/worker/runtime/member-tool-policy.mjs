import { createHash } from 'node:crypto'

// Enterprise role policy over named, already-composed native/PAIMind tools.
// No tool implementation, dispatcher, object store or upstream source lives
// here. Native guards and the prepared execution world remain mandatory.
export const MEMBER_TOOL_POLICY = 'member-personal-v1'
export const ADMIN_TOOL_POLICY = 'admin-authoring-v1'
const tools = new Set([
  'read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash',
  'skill', 'ask_user_question', 'get_goal', 'create_goal', 'update_goal',
  'job_output', 'job_list', 'job_kill',
  'paimind_agent_prepare_create', 'paimind_agent_skill_binding',
])
const adminTools = new Set([...tools, 'paimind_skill_inspect_github', 'paimind_skill_install', 'paimind_skill_prepare_create'])
export function managedToolPolicyForRole(role) {
  if (role === 'member') return MEMBER_TOOL_POLICY
  if (role === 'admin') return ADMIN_TOOL_POLICY
  throw new Error('Unsupported managed account role')
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export function parseMemberCellPolicy(text) {
  const value = parseManagedCellPolicy(text)
  if (value.role !== 'member') throw new Error('Invalid managed member policy')
  return value
}
export function parseManagedCellPolicy(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 4096) throw new Error('Invalid managed member policy')
  let value
  try { value = JSON.parse(text) } catch { throw new Error('Invalid managed member policy') }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'cellId,policy,role,schemaVersion,tenantId,userId'
    || value.schemaVersion !== 1 || !['member', 'admin'].includes(value.role)
    || value.policy !== managedToolPolicyForRole(value.role)
    || typeof value.cellId !== 'string' || !uuid.test(value.cellId)
    || typeof value.userId !== 'string' || !uuid.test(value.userId)
    || typeof value.tenantId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.tenantId)) {
    throw new Error('Invalid managed member policy')
  }
  return Object.freeze({ ...value, digest: 'sha256:' + createHash('sha256').update(text).digest('hex') })
}

/** No dynamic grant expansion, role from tool args, network tools, package
 * installation, Skill authoring or platform/credential mutation. Files and
 * bash execute only through the already-installed managed native services.
 * This static role policy is not a live account lease or member acceptance.
 */
export function createMemberToolGuard(policy) {
  if (policy?.policy !== MEMBER_TOOL_POLICY || policy.role !== 'member') throw new Error('Unsupported member tool policy')
  return createManagedToolGuard(policy)
}

/** An explicit administrator capsule enables the original authoring owners,
 * not arbitrary tools, platform mutation, host access or current authority.
 * The same managed execution and per-call login guards remain mandatory. */
export function createManagedToolGuard(policy, connectorAdmission) {
  if (!policy || policy.policy !== managedToolPolicyForRole(policy.role)) throw new Error('Unsupported managed tool policy')
  if (connectorAdmission !== undefined && typeof connectorAdmission !== 'function') throw new Error('Invalid native connector admission')
  const allowed = policy.role === 'admin' ? adminTools : tools
  return call => {
    if (!call || typeof call.agentId !== 'string' || !call.agentId || typeof call.sessionId !== 'string' || !call.sessionId
      || typeof call.name !== 'string') return '当前账户未获授权使用此工具'
    // This projection is supplied only by the exact native registration guard.
    // It opens no prefix/name allowlist, and cannot bypass the root asynchronous
    // current-login/approval check at real execution. Missing owner still denies.
    if (call.connector !== undefined) {
      if (connectorAdmission === undefined) return '当前账户未获授权使用此工具'
      try { return connectorAdmission?.(call.connector) === true ? undefined : '当前连接器未获运行授权' }
      catch { return '当前连接器未获运行授权' }
    }
    if (!allowed.has(call.name)) return '当前账户未获授权使用此工具'
    return undefined
  }
}
