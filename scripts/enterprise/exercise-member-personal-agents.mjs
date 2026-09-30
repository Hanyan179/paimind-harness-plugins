import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, writeFile, appendFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Explicitly MUTATING acceptance setup for the two existing members. Creates
// personal Agents and real blank native Sessions through their authenticated
// gateway, retaining them for subsequent browser acceptance. Never creates an
// account, sends a model prompt, changes a default or restarts any runtime.
// Successful HTTP operations are NOT Browser E2E or successful Agent use.
assert.equal(process.argv.length, 4)
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/enterprise-haas-hybrid-refactor')
const evidenceRoot = await realpath(join(root, '../.paimind-goal-evidence'))
const runtime = await realpath(process.argv[2]), credentialPath = await realpath(process.argv[3])
assert.ok(dirname(runtime) === evidenceRoot && runtime.startsWith(evidenceRoot + '/haas-member-browser-cells-'))
assert.ok(dirname(dirname(credentialPath)) === evidenceRoot && dirname(credentialPath).startsWith(evidenceRoot + '/haas-members-normal-names-'))
async function privateJson(path) {
  const stat = await lstat(path)
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && !(stat.mode & 0o077))
  assert.equal(await realpath(path), path)
  return JSON.parse(await readFile(path, 'utf8'))
}
const state = await privateJson(join(runtime, 'operator-state.json'))
const config = await privateJson(join(runtime, 'gateway-config.json'))
const credentials = await privateJson(credentialPath)
assert.equal(state.sourceRoot, root)
assert.equal(config.publicOrigin, 'http://127.0.0.1:62167')
assert.deepEqual(state.cells.map(cell => cell.member).sort(), ['alex', 'hansen'])
const origin = config.publicOrigin
const db = new URL(config.applicationUrl)
assert.equal(db.hostname, '127.0.0.1'); assert.equal(db.pathname, '/haas_e2e')
assert.ok(db.port && !['3080', '5432', '10012'].includes(db.port))
const inspect = () => state.cells.map(cell => {
  const actual = JSON.parse(execFileSync('docker', ['inspect', cell.pin.containerId], { encoding: 'utf8' }))[0]
  assert.equal(actual.Image, cell.pin.imageId); assert.equal(actual.State.Running, true)
  assert.equal(actual.Config.User, '10001:10001'); assert.equal(actual.HostConfig.ReadonlyRootfs, true)
  assert.ok(actual.Mounts.some(mount => mount.Type === 'volume' && mount.Name === cell.pin.volumeName))
  return { member: cell.member, cellId: cell.pin.cellId, containerId: actual.Id, imageId: actual.Image,
    startedAt: actual.State.StartedAt, volume: cell.pin.volumeName }
})
const runtimeBefore = inspect()
process.umask(0o077)
const evidence = await mkdtemp(join(evidenceRoot, 'haas-member-agents-'))
const run = randomUUID(), accounts = [], completed = [], objects = []
let phase = 'preflight', passed = false, cleanupVerified = false
const write = (name, value) => writeFile(join(evidence, name), JSON.stringify(value, null, 2))
const record = async value => {
  completed.push(value)
  await appendFile(join(evidence, 'operations.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n')
}
await write('inputs.json', { sourceRoot: root, runtime, run, runtimeBefore, browserE2EVerified: false, modelCallsAllowed: false })
console.log(JSON.stringify({ status: 'EXERCISING_REAL_PERSONAL_AGENTS', evidence, browserE2EVerified: false }))
const sql = createRequire(join(root, 'apps/enterprise-server/package.json'))('postgres')(config.applicationUrl,
  { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { statement_timeout: 5000, lock_timeout: 5000 } })
const userIds = state.cells.map(cell => cell.pin.userId)
const readLogins = () => sql`select session_id, user_id, revoked_at, expires_at from haas.login_sessions
  where tenant_id=${config.tenantId} and user_id in ${sql(userIds)} order by session_id`
const previousLogins = Array.from(await readLogins())
const http = async (path, { cookie, method = 'GET', body } = {}) => {
  const response = await fetch(origin + path, { method, headers: { origin, ...(cookie ? { cookie } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(12_000) })
  const text = await response.text(); assert.ok(Buffer.byteLength(text) < 2 * 1024 * 1024)
  return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], value: JSON.parse(text) }
}
const rpc = async (account, method, payload = {}) => {
  const rpcId = randomUUID()
  const response = await http('/api/' + method, { cookie: account.cookie, method: 'POST',
    body: { type: 'client-request', rpcId, method, payload: method.includes('/') ? { args: payload } : payload } })
  if (response.status === 200) assert.equal(response.value.rpcId, rpcId)
  return response
}
const accepted = async (account, method, payload) => {
  const response = await rpc(account, method, payload)
  if (response.status !== 200 || response.value.result?.ok !== true) {
    await write('rejected-operation.json', { phase, member: account.member, method, status: response.status, response: response.value })
    throw Error('Expected native operation was rejected')
  }
  return response.value.result.value
}
const denied = async (account, method, payload) => {
  const response = await rpc(account, method, payload)
  assert.ok(response.status === 403 || response.status === 200 && response.value.result?.ok === false, 'Unauthorized operation succeeded')
  await record({ member: account.member, method, status: 'denied', httpStatus: response.status,
    code: response.value.code ?? response.value.result.error.code })
}
const snapshot = async account => ({ member: account.member,
  profiles: await accepted(account, 'paimindAgentProfiles/listProfiles'),
  presets: await accepted(account, 'agentPreset.list'),
  workspaces: await accepted(account, 'workspace.list'),
  sessions: await accepted(account, 'session.list'),
  bindings: await accepted(account, 'paimindAgentProfiles/listSessionBindings') })
const definitions = {
  hansen: [
    { name: 'Hansen 客户跟进助手', role: '客户跟进助理', goal: '根据已提供的信息整理客户进展和下一步行动', behavior: '区分已知事实和待确认信息，不编造客户承诺' },
    { name: 'Hansen 报价核对助手', role: '报价审核助理', goal: '检查报价条件是否完整并列出需要确认的问题', behavior: '逐项核对数量、价格、币种和交付条件，缺失信息明确指出' },
  ],
  alex: [
    { name: 'Alex 市场研究助手', role: '市场研究助理', goal: '从提供的材料提炼市场信息和证据', behavior: '区分事实与推测，注明材料出处和未核实事项' },
    { name: 'Alex 竞品摘要助手', role: '竞品分析助理', goal: '对比已提供的竞品材料并整理差异', behavior: '使用一致的比较维度，不替缺失材料作结论' },
  ],
}
const profileInput = profile => Object.fromEntries(['agentId', 'presetId', 'name', 'description', 'basePresetId', 'role',
  'goal', 'behavior', 'preferredSkillNames', 'instructions', 'productKind', 'avatarId'].filter(key => profile[key] !== undefined).map(key => [key, profile[key]]))
async function createProfile(account, definition, index) {
  const presetId = `${account.member}-personal-${run.slice(0, 8)}-${index}`
  phase = `${account.member}:copy:${index}`
  const copy = await accepted(account, 'agentPreset.copy', { from: 'standard', agentPreset: presetId, name: definition.name })
  assert.equal(copy.agentPreset, presetId)
  const object = { member: account.member, presetId, copied: true, profile: null, sessionId: null, removed: false }
  objects.push(object); await write('objects.json', objects)
  phase = `${account.member}:save:${index}`
  const input = { ...definition, agentId: presetId, presetId, description: definition.goal, basePresetId: 'standard',
    preferredSkillNames: [], instructions: '', productKind: 'personal', avatarId: 'standard' }
  object.profile = await accepted(account, 'paimindAgentProfiles/saveProfile', { input })
  assert.equal(object.profile.productKind, 'personal'); assert.equal(object.profile.revision, 1)
  assert.equal(object.profile.basePresetId, 'standard'); assert.equal(object.profile.health, 'healthy')
  await write('objects.json', objects)
  await record({ member: account.member, phase: 'personal-agent-created', presetId, name: definition.name, version: object.profile.configVersion })
  return object
}
try {
  assert.equal((await http('/health')).status, 200)
  for (const cell of state.cells) {
    phase = cell.member + ':login'
    const credential = credentials.members.find(member => member.username === cell.member)
    assert.ok(credential)
    const result = await http('/haas/v1/auth/login', { method: 'POST', body: { username: credential.username, password: credential.password } })
    assert.equal(result.status, 200); assert.ok(result.cookie?.startsWith('paimind_haas_session='))
    const account = { member: cell.member, userId: cell.pin.userId, cookie: result.cookie, closed: false }
    accounts.push(account)
    const me = await http('/haas/v1/auth/me', { cookie: account.cookie })
    assert.equal(me.status, 200); assert.equal(me.value.data.userId, account.userId); assert.equal(me.value.data.role, 'member')
    assert.equal(me.value.data.displayName, cell.member === 'hansen' ? 'Hansen' : 'Alex')
    account.before = await snapshot(account)
    // A previous partial exercise must be resumed explicitly, never silently
    // duplicated or overwritten by a new fixture run.
    assert.equal(account.before.profiles.profiles.length, 0)
    assert.equal(account.before.bindings.bindings.length, 0)
    assert.equal(account.before.workspaces.items.length, 1)
    assert.equal(account.before.sessions.items.length, 1)
  }
  await write('before.json', accounts.map(account => account.before))
  for (const account of accounts) {
    for (const [index, definition] of definitions[account.member].entries()) {
      const object = await createProfile(account, definition, index + 1)
      const original = object.profile
      phase = `${account.member}:edit:${index + 1}`
      object.profile = await accepted(account, 'paimindAgentProfiles/saveProfile', { input: {
        ...profileInput(original), goal: original.goal + '，明确下一步可执行建议', expectedVersion: original.configVersion,
      } })
      assert.equal(object.profile.revision, 2); assert.notEqual(object.profile.configVersion, original.configVersion)
      await write('objects.json', objects)
      await denied(account, 'paimindAgentProfiles/saveProfile', { input: { ...profileInput(original), expectedVersion: original.configVersion } })
      phase = `${account.member}:native-session:${index + 1}`
      const sessionId = 'session-' + randomUUID(), workspaceId = account.before.workspaces.items[0].workspaceId
      const created = await accepted(account, 'session.create', { sessionId, workspaceId, agentPreset: object.presetId })
      assert.equal(created.sessionId, sessionId); assert.equal(created.agentPreset, object.presetId)
      object.sessionId = sessionId; await write('objects.json', objects)
      const selected = await accepted(account, 'agentPreset.select', { sessionId, agentPreset: object.presetId })
      assert.equal(selected.agentPreset, object.presetId)
      await accepted(account, 'session.rename', { sessionId, title: definition.name + ' · 交互验收' })
      const binding = await accepted(account, 'paimindAgentProfiles/bindSession', { input: {
        sessionId, agentId: object.profile.agentId, presetId: object.presetId, configVersion: object.profile.configVersion, purpose: 'conversation',
      } })
      assert.equal(binding.sessionId, sessionId); assert.equal(binding.configVersion, object.profile.configVersion)
      await record({ member: account.member, phase: 'native-session-bound', presetId: object.presetId, sessionId, workspaceId, version: binding.configVersion })
      await denied(account, 'paimindAgentProfiles/removeProfile', { input: { presetId: object.presetId } })
    }
    const unused = await createProfile(account, { name: account.member === 'hansen' ? 'Hansen 临时整理助手' : 'Alex 临时整理助手',
      role: '整理助理', goal: '验证未引用的个人智能体可以安全删除', behavior: '只处理用户明确提供的测试资料' }, 'delete')
    phase = account.member + ':remove-unused'
    const removed = await accepted(account, 'paimindAgentProfiles/removeProfile', { input: { presetId: unused.presetId } })
    assert.equal(removed.removed, true); assert.equal(removed.presetId, unused.presetId)
    unused.removed = true; await write('objects.json', objects)
    await denied(account, 'agentPreset.read', { agentPreset: unused.presetId })
    await record({ member: account.member, phase: 'unused-personal-agent-removed', presetId: unused.presetId, ownerMediated: true })
  }
  for (const account of accounts) {
    const other = objects.find(object => object.member !== account.member && !object.removed)
    assert.ok(other)
    phase = account.member + ':foreign-known-ids'
    await denied(account, 'agentPreset.read', { agentPreset: other.presetId })
    await denied(account, 'paimindAgentProfiles/saveProfile', { input: profileInput(other.profile) })
    await denied(account, 'paimindAgentProfiles/removeProfile', { input: { presetId: other.presetId } })
    await denied(account, 'session.history', { sessionId: other.sessionId })
    await denied(account, 'agentPreset.select', { sessionId: other.sessionId, agentPreset: other.presetId })
    phase = account.member + ':final-readback'
    const actual = await snapshot(account), own = objects.filter(object => object.member === account.member && !object.removed)
    assert.equal(actual.profiles.profiles.length, 2); assert.equal(actual.bindings.bindings.length, 2)
    assert.equal(actual.sessions.items.length, 3); assert.equal(actual.workspaces.items.length, 1)
    assert.deepEqual(actual.profiles.profiles.map(profile => profile.presetId).sort(), own.map(object => object.presetId).sort())
    const workspace = actual.workspaces.items[0]
    assert.equal(workspace.workspaceId, account.before.workspaces.items[0].workspaceId)
    for (const object of own) {
      assert.deepEqual(actual.profiles.profiles.find(profile => profile.presetId === object.presetId), object.profile)
      const session = actual.sessions.items.find(row => row.sessionId === object.sessionId)
      assert.equal(session?.agentPreset, object.presetId); assert.equal(session.cwd, workspace.path); assert.equal(session.blank, true)
      assert.ok(workspace.sessionIds.includes(object.sessionId))
      const binding = actual.bindings.bindings.find(row => row.sessionId === object.sessionId)
      assert.equal(binding?.presetId, object.presetId); assert.equal(binding.configVersion, object.profile.configVersion)
      assert.equal(binding.purpose, 'conversation')
    }
    await write(account.member + '-after.json', actual)
  }
  assert.deepEqual(inspect(), runtimeBefore)
  passed = true
} catch (error) {
  process.exitCode = 1
  await write('failure.json', { status: 'FAILED', phase, completed, objects, error: error instanceof assert.AssertionError ? 'assertion-failed' : error.message,
    browserE2EVerified: false, retainedObjectsRequireExplicitResume: true })
  console.error(JSON.stringify({ status: 'PERSONAL_AGENT_EXERCISE_FAILED', evidence, phase, retainedObjects: objects.length }))
} finally {
  try {
    for (const account of accounts) {
      if (account.closed) continue
      assert.equal((await http('/haas/v1/auth/logout', { method: 'POST', cookie: account.cookie, body: {} })).status, 200)
      account.closed = true
    }
    const after = Array.from(await readLogins()), oldIds = new Set(previousLogins.map(row => row.session_id))
    assert.deepEqual(after.filter(row => oldIds.has(row.session_id)), previousLogins)
    const created = after.filter(row => !oldIds.has(row.session_id))
    assert.equal(created.length, accounts.length); assert.ok(created.every(row => row.revoked_at !== null))
    cleanupVerified = true
    await write('test-login-closure.json', { existingLoginsUnchanged: true, existingCount: previousLogins.length, createdTestLogins: created })
  } finally {
    await sql.end({ timeout: 5 })
    await write('closed.json', { testLoginsRevoked: accounts.every(account => account.closed), cleanupVerified,
      workerRestarted: false, userVolumesRemoved: false, browserE2EVerified: false })
  }
}
if (passed && cleanupVerified) {
  await write('result.json', { status: 'REAL_PERSONAL_AGENT_BACKEND_LIFECYCLE_PASSED', evidence, runtime,
    members: accounts.map(account => account.member), retainedAgents: objects.filter(object => !object.removed), completed,
    browserE2EVerified: false, modelRepliesVerified: false, enterpriseAssignedClassificationVerified: false, finalWorkerImageAccepted: false })
  console.log(JSON.stringify({ status: 'REAL_PERSONAL_AGENT_BACKEND_LIFECYCLE_PASSED', evidence,
    retainedAgents: objects.filter(object => !object.removed).length, browserE2EVerified: false, modelRepliesVerified: false }))
}
