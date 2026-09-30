import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JSONValue, Sql, TransactionSql } from 'postgres'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import { Passwords, passwordInput } from './password.js'
import { authorizeNativeOperation, type NativeOperationRequest } from './native-operation-policy.js'
import { validateNativeSkillIds } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

export interface Account {
  userId: string
  tenantId: string
  username: string
  displayName: string
  role: 'admin' | 'member'
  status: 'active' | 'disabled'
}
interface UserRow {
  user_id: string
  tenant_id: string
  username: string
  display_name: string
  role: Account['role']
  status: Account['status']
  credential: string
}
export interface RuntimeIdentity { account: Account; sessionId: string }
export interface InteractiveOriginScope {
  tenantId: string; userId: string; role: Account['role']; cellId: string; nativeSessionId: string
}
export interface MemberGroup {
  groupId: string
  name: string
  status: 'active' | 'archived'
  revision: number
  memberIds: string[]
}
interface GroupRow { group_id: string; name: string; status: MemberGroup['status']; revision: number }
export interface CommandResult<T> { data: T; operationId: string; replayed: boolean }
interface Receipt { operation_id: string; request_digest: string; result: object; fresh: boolean }
export interface CommandContext { key: string; requestId: string }
type ResourceAction = 'resource.submit' | 'resource.review' | 'resource.assignment' | 'resource.adopt'
  | 'resource.skill.submit' | 'resource.skill.review' | 'resource.skill.assignment' | 'resource.skill.adopt'
  | 'runtime.feature.approval' | 'runtime.connector.approval' | 'runtime.resources.configure' | 'runtime.recovery.request'
export interface ResourcePreparationKey { key: string; requestDigest: string; scope: string }
interface UserInput { username: string; password: string; displayName: string }

const account = (row: UserRow): Account => ({
  userId: row.user_id, tenantId: row.tenant_id, username: row.username,
  displayName: row.display_name, role: row.role, status: row.status,
})
const digest = (input: string): string => createHash('sha256').update(input).digest('hex')
const unauthenticated = (): never => { throw new EnterpriseError(401, 'unauthenticated', '登录已失效，请重新登录') }
const forbidden = (): never => { throw new EnterpriseError(403, 'forbidden', '此操作仅限管理员') }
const notFound = (): never => { throw new EnterpriseError(404, 'not-found', '对象不存在或不可访问') }

function username(input: unknown): string {
  const value = text(input, 3, 128).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._+@-]*$/u.test(value)) return invalid('用户名格式无效')
  return value
}
function userInput(body: Record<string, unknown>): UserInput {
  return { username: username(body.username), password: passwordInput(body.password), displayName: text(body.displayName, 1, 120) }
}
function groupRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_646) return invalid('成员组版本无效')
  return value
}
function groupMemberIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) return invalid('每组最多选择 500 个账户')
  const ids = value.map(uuid).sort()
  if (new Set(ids).size !== ids.length) return invalid('成员编号不能重复')
  return ids
}

/** Deployment-bound tenant identity. Callers provide only an opaque token;
 * browser-supplied tenant, role and user identifiers never construct authority.
 * State writes, their receipt and success audit share a PostgreSQL transaction. */
export class Identity {
  private readonly passwords = new Passwords()

  constructor(
    private readonly sql: Sql,
    readonly tenantId: string,
    private readonly masterKey: Buffer,
    private readonly bootstrapSecret: string,
    private readonly sessionTtlSeconds = 28_800,
  ) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(tenantId) || masterKey.length !== 32
      || bootstrapSecret.length < 32 || bootstrapSecret.length > 128
      || !Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds < 60 || sessionTtlSeconds > 86_400) {
      throw new Error('Invalid enterprise identity configuration')
    }
  }

  private keyed(purpose: string, value: string): string {
    return createHmac('sha256', this.masterKey).update(JSON.stringify([purpose, this.tenantId, value])).digest('base64url')
  }

  private sessionToken(sessionId: string): string { return this.keyed('login-session', sessionId) }

  private async audit(db: Sql | TransactionSql, action: string, outcome: 'succeeded' | 'denied' | 'failed', requestId: string,
    actorId: string | null = null, targetId: string | null = null, reason: string | null = null): Promise<void> {
    await db`insert into haas.audit_events (event_id, tenant_id, actor_user_id, action, outcome, request_id, target_id, reason)
      values (${randomUUID()}, ${this.tenantId}, ${actorId}, ${action}, ${outcome}, ${requestId}, ${targetId}, ${reason})`
  }

  private async guarded<T>(action: string, requestId: string, run: () => Promise<T>, token?: string): Promise<T> {
    uuid(requestId)
    try { return await run() } catch (error) {
      let actorId: string | null = null
      if (token) {
        try { actorId = (await this.principal(this.sql, token)).account.userId } catch { /* no unverified attribution */ }
      }
      try {
        await this.audit(this.sql, action, error instanceof EnterpriseError ? 'denied' : 'failed', requestId,
          actorId, null, error instanceof EnterpriseError ? error.code : 'dependency-failed')
      } catch { throw new EnterpriseError(503, 'audit-unavailable', '审计服务不可用，操作未完成', true) }
      if (error instanceof EnterpriseError) throw error
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new EnterpriseError(409, 'conflict', '该名称已存在')
      }
      throw new EnterpriseError(503, 'dependency-unavailable', '服务暂时不可用，请稍后重试', true)
    }
  }

  private async lockTenant(db: TransactionSql): Promise<void> {
    // A short tenant mutation lock establishes a single revocation order across
    // service processes. Expensive password work happens before this lock.
    await db`select pg_advisory_xact_lock(hashtextextended(${`haas:identity:${this.tenantId}`}, 0))`
  }

  private async principal(db: Sql | TransactionSql, token: string | undefined, admin = false): Promise<RuntimeIdentity> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return unauthenticated()
    const rows = await db<(UserRow & { session_id: string })[]>`
      select u.*, s.session_id from haas.login_sessions s
      join haas.users u using (tenant_id, user_id) join haas.tenants t using (tenant_id)
      where s.tenant_id = ${this.tenantId} and s.token_digest = ${digest(token)}
        and s.revoked_at is null and s.expires_at > clock_timestamp()
        and u.status = 'active' and t.status = 'active'`
    const row = rows[0]
    if (!row) return unauthenticated()
    if (admin && row.role !== 'admin') return forbidden()
    return { account: account(row), sessionId: row.session_id }
  }

  private commandKey(scope: string, input: object, context: CommandContext): ResourcePreparationKey {
    const key = uuid(context.key)
    // Inputs have already been normalized into a fixed property order. Keyed
    // digests prevent offline password guessing through request fingerprints.
    const requestDigest = this.keyed('command-input', JSON.stringify(input))
    return { key, requestDigest, scope }
  }

  private async commandReplay<T extends object>(db: TransactionSql, { key, requestDigest, scope }: ResourcePreparationKey): Promise<CommandResult<T> | undefined> {
    const rows = await db<Receipt[]>`select operation_id, request_digest, result,
      created_at > clock_timestamp() - interval '24 hours' as fresh
      from haas.command_receipts where tenant_id = ${this.tenantId} and scope = ${scope} and idempotency_key = ${key}`
    const previous = rows[0]
    if (previous) {
      if (previous.request_digest !== requestDigest || !previous.fresh) throw new EnterpriseError(409, 'idempotency-conflict', '重复请求标识与内容不匹配或已过期')
      return { data: previous.result as T, operationId: previous.operation_id, replayed: true }
    }
    return undefined
  }

  private async command<T extends object>(db: TransactionSql, scope: string, input: object, context: CommandContext,
    run: () => Promise<T>): Promise<CommandResult<T>> {
    const selected = this.commandKey(scope, input, context)
    const previous = await this.commandReplay<T>(db, selected)
    if (previous) return previous
    const { key, requestDigest } = selected
    const data = await run()
    await db`insert into haas.command_receipts (tenant_id, scope, idempotency_key, request_digest, operation_id, result)
      values (${this.tenantId}, ${scope}, ${key}, ${requestDigest}, ${context.requestId}, ${db.json(data as JSONValue)})`
    return { data, operationId: context.requestId, replayed: false }
  }

  private async rateLimit(subject: string): Promise<void> {
    const key = this.keyed('authentication-subject', subject)
    const [row] = await this.sql<{ attempts: number }[]>`
      insert into haas.auth_buckets (tenant_id, subject_digest, window_start, attempts)
      values (${this.tenantId}, ${key}, clock_timestamp(), 1)
      on conflict (tenant_id, subject_digest) do update set
        attempts = case when haas.auth_buckets.window_start < clock_timestamp() - interval '1 minute'
          then 1 else haas.auth_buckets.attempts + 1 end,
        window_start = case when haas.auth_buckets.window_start < clock_timestamp() - interval '1 minute'
          then clock_timestamp() else haas.auth_buckets.window_start end
      returning attempts`
    if (!row || row.attempts > 8) throw new EnterpriseError(429, 'rate-limited', '尝试过于频繁，请一分钟后重试', true)
  }

  async bootstrapState(): Promise<{ configured: boolean }> {
    const [row] = await this.sql<{ configured: boolean }[]>`select exists (
      select 1 from haas.users where tenant_id = ${this.tenantId} and role = 'admin') as configured
      from haas.tenants where tenant_id = ${this.tenantId} and status = 'active'`
    if (!row) throw new EnterpriseError(503, 'tenant-unavailable', '企业环境不可用，请联系管理员', true)
    return { configured: row.configured }
  }

  async bootstrap(input: unknown, context: CommandContext): Promise<CommandResult<Account>> {
    return this.guarded('identity.bootstrap', context.requestId, async () => {
      const body = record(input, ['username', 'password', 'displayName', 'bootstrapSecret'])
      const data = userInput(body)
      const proof = text(body.bootstrapSecret, 32, 128)
      await this.rateLimit('bootstrap')
      if (!timingSafeEqual(Buffer.from(digest(proof)), Buffer.from(digest(this.bootstrapSecret)))) return forbidden()
      const credential = await this.passwords.hash(data.password)
      return await this.sql.begin(async db => {
        await this.lockTenant(db)
        return this.command(db, 'bootstrap', { ...data, bootstrapSecret: proof }, context, async () => {
          const [existing] = await db`select 1 from haas.users where tenant_id = ${this.tenantId} and role = 'admin'`
          if (existing) throw new EnterpriseError(409, 'bootstrap-closed', '管理员已经初始化，请登录')
          const [row] = await db<UserRow[]>`insert into haas.users (tenant_id, user_id, username, display_name, role, status, credential)
            values (${this.tenantId}, ${randomUUID()}, ${data.username}, ${data.displayName}, 'admin', 'active', ${credential}) returning *`
          if (!row) throw new Error('Missing inserted administrator')
          await this.audit(db, 'identity.bootstrap', 'succeeded', context.requestId, null, row.user_id)
          return account(row)
        })
      })
    })
  }

  async login(input: unknown, context: CommandContext, previousToken?: string): Promise<CommandResult<Account> & { token: string }> {
    return this.guarded('identity.login', context.requestId, async () => {
      const body = record(input, ['username', 'password'])
      const data = { username: username(body.username), password: passwordInput(body.password) }
      await this.rateLimit(`login:${data.username}`)
      const [candidate] = await this.sql<UserRow[]>`select * from haas.users where tenant_id = ${this.tenantId} and username = ${data.username}`
      const valid = await this.passwords.verify(data.password, candidate?.credential)
      if (!valid || !candidate || candidate.status !== 'active') throw new EnterpriseError(401, 'invalid-credentials', '用户名或密码不正确')
      return await this.sql.begin(async db => {
        await this.lockTenant(db)
        const [current] = await db<UserRow[]>`select u.* from haas.users u join haas.tenants t using (tenant_id)
          where u.tenant_id = ${this.tenantId} and u.user_id = ${candidate.user_id} and u.status = 'active' and t.status = 'active'`
        if (!current || current.credential !== candidate.credential) return unauthenticated()
        const result = await this.command(db, `login:${current.user_id}`, data, context, async () => {
          const sessionId = randomUUID()
          await db`insert into haas.login_sessions (tenant_id, session_id, user_id, token_digest, expires_at)
            values (${this.tenantId}, ${sessionId}, ${current.user_id}, ${digest(this.sessionToken(sessionId))},
              clock_timestamp() + ${this.sessionTtlSeconds} * interval '1 second')`
          await this.audit(db, 'identity.login', 'succeeded', context.requestId, current.user_id)
          return { sessionId }
        })
        const token = this.sessionToken(result.data.sessionId)
        const active = await this.principal(db, token)
        // Account switching in one browser must retire the cookie it replaces,
        // so existing native downlinks cannot keep delivering the former
        // account. Other devices/sessions remain valid. A replay with the new
        // cookie is deliberately a no-op, never self-revocation.
        if (previousToken && previousToken !== token && /^[A-Za-z0-9_-]{43}$/u.test(previousToken)) {
          const [previous] = await db<{ session_id: string }[]>`update haas.login_sessions set revoked_at = clock_timestamp()
            where tenant_id = ${this.tenantId} and token_digest = ${digest(previousToken)} and revoked_at is null
            returning session_id`
          if (previous) await this.audit(db, 'identity.session.replaced', 'succeeded', context.requestId,
            current.user_id, previous.session_id)
        }
        return { ...result, data: active.account, token }
      })
    })
  }

  async me(token: string | undefined, requestId: string): Promise<Account> {
    return this.guarded('identity.me', requestId, async () => (await this.principal(this.sql, token)).account, token)
  }

  /** Internal gateway boundary. No HTTP endpoint accepts a RuntimeIdentity.
   * The resolver rechecks current session and binding together before admission;
   * denial or dependency failure is audited without recording bearer tokens. */
  async withRuntimeIdentity<T>(token: string | undefined, requestId: string,
    resolve: (principal: RuntimeIdentity) => Promise<T>): Promise<T> {
    return this.guarded('runtime.admission', requestId,
      async () => resolve(await this.principal(this.sql, token)), token)
  }

  /** Internal pinned-cell metadata read, not login or execution authority.
   * No session is selected or created. The consumer must verify the pinned
   * cell in this same revocation transaction and may only return metadata. */
  async readRuntimeAccount<T>(scope: Pick<Account, 'tenantId' | 'userId' | 'role'>, requestId: string,
    read: (db: TransactionSql, current: Account) => Promise<T>): Promise<T> {
    return this.guarded('runtime.account.read', requestId, async () => {
      if (!scope || Object.keys(scope).sort().join(',') !== 'role,tenantId,userId'
        || scope.tenantId !== this.tenantId || !['admin', 'member'].includes(scope.role)) return notFound()
      const userId = uuid(scope.userId), role = scope.role
      const result = await this.sql.begin(async db => {
        await this.lockTenant(db)
        const [row] = await db<UserRow[]>`select u.* from haas.users u join haas.tenants t using (tenant_id)
          where u.tenant_id = ${this.tenantId} and u.user_id = ${userId}
            and u.role = ${role} and u.status = 'active' and t.status = 'active'`
        if (!row) return notFound()
        return { value: await read(db, account(row)) }
      })
      return result.value
    })
  }

  /** Internal provenance only, never a bearer token or a cached runtime grant.
   * Every request gets a server nonce even when its caller reuses an RPC ID. */
  async sealInteractiveOrigin(token: string | undefined, requestId: string, scope: InteractiveOriginScope, clientRpcId?: string): Promise<string> {
    return this.guarded('runtime.origin.seal', requestId, async () => {
      const principal = await this.principal(this.sql, token)
      this.assertOriginScope(scope, principal)
      if (clientRpcId !== undefined) text(clientRpcId, 1, 200)
      return this.sealOrigin(principal, requestId, scope, undefined, undefined, [], clientRpcId)
    }, token)
  }

  private sealOrigin(principal: RuntimeIdentity, requestId: string, scope: InteractiveOriginScope, delegatedPresetId?: string, nativeJobId?: string,
    requiredSkillIds: readonly string[] = [], clientRpcId?: string): string {
    validateNativeSkillIds(requiredSkillIds)
    const payload = JSON.stringify({ tenantId: this.tenantId, userId: principal.account.userId,
      role: principal.account.role, cellId: uuid(scope.cellId), nativeSessionId: text(scope.nativeSessionId, 1, 200),
      loginSessionId: principal.sessionId, requestId: uuid(requestId), nonce: randomUUID(),
      // Signed display metadata, not authority. Derived/job sources deliberately
      // omit it: their native message is not the browser's original submission.
      ...(clientRpcId === undefined ? {} : { clientRpcId }),
      ...(delegatedPresetId === undefined ? {} : { delegatedPresetId, requiredSkillIds: [...requiredSkillIds].sort() }),
      ...(nativeJobId === undefined ? {} : { nativeJobId }) })
    const encoded = Buffer.from(payload).toString('base64url')
    const source = `paimind-origin-v1.${encoded}.${this.keyed('interactive-origin-v1', encoded)}`
    if (source.length > 8192) return invalid('消息来源标识过长')
    return source
  }

  /** Private native delegation only. The native owner attests the actual
   * parent/child and mounted composition; this service rechecks all exact
   * original logins plus the caller's binding/resource decision under one lock.
   * A child source is constrained to that preset, including on re-delegation.
   * It cannot turn withdrawn enterprise work into unconstrained personal work. */
  async deriveInteractiveOrigins(sources: readonly string[], requestId: string, scope: InteractiveOriginScope,
    targetSessionId: string, presetId: string,
    verify: (db: TransactionSql, principals: readonly RuntimeIdentity[]) => Promise<void>, requiredSkillIds: readonly string[] = []): Promise<string[]> {
    validateNativeSkillIds(requiredSkillIds)
    const requirements = [...requiredSkillIds].sort()
    text(targetSessionId, 1, 200)
    if (targetSessionId === scope.nativeSessionId || typeof presetId !== 'string'
      || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(presetId)) return invalid('委派作用域无效')
    return this.withInteractiveOrigins(sources, requestId, scope, async (db, principals) => {
      await verify(db, principals)
      const unique = new Map(principals.map(principal => [principal.sessionId, principal]))
      return [...unique.values()].map(principal => this.sealOrigin(principal, requestId,
        { ...scope, nativeSessionId: targetSessionId }, presetId, undefined, requirements))
    }, presetId, requirements)
  }

  private assertOriginScope(scope: InteractiveOriginScope, principal: RuntimeIdentity): void {
    uuid(scope.cellId); text(scope.nativeSessionId, 1, 200)
    if (scope.tenantId !== principal.account.tenantId || scope.userId !== principal.account.userId
      || scope.role !== principal.account.role) throw new EnterpriseError(403, 'interactive-origin-denied', '消息来源与当前运行账户不一致')
  }

  /** An exact native completion in the SAME session. This narrows the original
   * login to its preset and job; it does not mint a login or delegate to a new
   * session. The native owner supplies job identity, never a public caller. */
  async sealJobOrigins(sources: readonly string[], requestId: string, scope: InteractiveOriginScope,
    nativeJobId: string, presetId: string,
    verify: (db: TransactionSql, principals: readonly RuntimeIdentity[]) => Promise<void>, requiredSkillIds: readonly string[] = []): Promise<string[]> {
    validateNativeSkillIds(requiredSkillIds)
    const requirements = [...requiredSkillIds].sort()
    text(nativeJobId, 1, 200)
    if (typeof presetId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(presetId)) return invalid('任务预设作用域无效')
    return this.withInteractiveOrigins(sources, requestId, scope, async (db, principals) => {
      await verify(db, principals)
      const unique = new Map(principals.map(principal => [principal.sessionId, principal]))
      return [...unique.values()].map(principal => this.sealOrigin(principal, requestId, scope, presetId, nativeJobId, requirements))
    }, presetId, requirements)
  }

  /** Only trusted native authority code may consume this association. Re-read
   * the exact originating login, never any other active login of the same user.
   * The consumer must additionally check current binding and resource policy. */
  async withInteractiveOrigin<T>(source: string, requestId: string, scope: InteractiveOriginScope,
    consume: (principal: RuntimeIdentity) => Promise<T>): Promise<T> {
    return this.withInteractiveOrigins([source], requestId, scope, async (_db, principals) => consume(principals[0]!))
  }

  /** One short revocation transaction for every source in a native step. The
   * consumer reads binding/policy only; it must not dispatch native work while
   * holding this lock or turn this result into a durable permission cache. */
  async withInteractiveOrigins<T>(sources: readonly string[], requestId: string, scope: InteractiveOriginScope,
    consume: (db: TransactionSql, principals: readonly RuntimeIdentity[]) => Promise<T>, expectedPresetId?: string,
    expectedSkillIds?: readonly string[]): Promise<T> {
    return this.guarded('runtime.origin.verify', requestId, async () => {
      if (!Array.isArray(sources) || sources.length === 0 || sources.length > 64) return invalid('消息来源数量无效')
      if (expectedSkillIds !== undefined) validateNativeSkillIds(expectedSkillIds)
      const ids = sources.map(source => this.originLoginId(source, scope, expectedPresetId, expectedSkillIds))
      const result = await this.sql.begin(async db => {
        await this.lockTenant(db)
        const principals: RuntimeIdentity[] = []
        for (const id of ids) {
          const principal = await this.principal(db, this.sessionToken(id))
          this.assertOriginScope(scope, principal)
          if (principal.sessionId !== id) throw new EnterpriseError(403, 'interactive-origin-denied', '消息登录来源无效或已变化')
          principals.push(principal)
        }
        return { value: await consume(db, principals) }
      })
      return result.value
    })
  }

  private originLoginId(source: string, scope: InteractiveOriginScope, expectedPresetId?: string, expectedSkillIds?: readonly string[]): string {
      const deny = (): never => { throw new EnterpriseError(403, 'interactive-origin-denied', '消息登录来源无效或已变化') }
      if (typeof source !== 'string' || source.length > 8192) return deny()
      const match = /^paimind-origin-v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u.exec(source)
      if (!match) return deny()
      const encoded = match[1]!, signature = match[2]!
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(this.keyed('interactive-origin-v1', encoded)))) return deny()
      let payload: Record<string, unknown>
      try {
        const bytes = Buffer.from(encoded, 'base64url')
        if (bytes.toString('base64url') !== encoded) return deny()
        const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        const delegated = decoded !== null && typeof decoded === 'object' && Object.hasOwn(decoded, 'delegatedPresetId')
        const job = decoded !== null && typeof decoded === 'object' && Object.hasOwn(decoded, 'nativeJobId')
        const constrained = decoded !== null && typeof decoded === 'object' && Object.hasOwn(decoded, 'requiredSkillIds')
        const correlated = decoded !== null && typeof decoded === 'object' && Object.hasOwn(decoded, 'clientRpcId')
        payload = record(decoded,
          ['tenantId', 'userId', 'role', 'cellId', 'nativeSessionId', 'loginSessionId', 'requestId', 'nonce',
            ...(delegated ? ['delegatedPresetId'] : []), ...(job ? ['nativeJobId'] : []), ...(constrained ? ['requiredSkillIds'] : []),
            ...(correlated ? ['clientRpcId'] : [])])
        uuid(payload.userId); uuid(payload.cellId); uuid(payload.loginSessionId); uuid(payload.requestId); uuid(payload.nonce)
        text(payload.nativeSessionId, 1, 200)
        if (correlated) {
          text(payload.clientRpcId, 1, 200)
          if (delegated || job) return deny()
        }
        if (job) { if (!delegated) return deny(); text(payload.nativeJobId, 1, 200) }
        // Existing signed no-Skill messages remain readable; removing this
        // field from a new constrained message invalidates its original HMAC.
        if (constrained) {
          if (!delegated) return deny()
          validateNativeSkillIds(payload.requiredSkillIds)
          if (expectedSkillIds !== undefined && payload.requiredSkillIds.some(id => !expectedSkillIds.includes(id))) return deny()
        }
        if (delegated && (typeof payload.delegatedPresetId !== 'string'
          || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(payload.delegatedPresetId)
          || (expectedPresetId !== undefined && payload.delegatedPresetId !== expectedPresetId))) return deny()
      } catch { return deny() }
      if (payload.tenantId !== this.tenantId || payload.tenantId !== scope.tenantId || payload.userId !== scope.userId
        || payload.role !== scope.role || payload.cellId !== scope.cellId || payload.nativeSessionId !== scope.nativeSessionId) return deny()
      return payload.loginSessionId as string
  }

  async authorizeRuntimeOperation(token: string | undefined, requestId: string,
    grant: { tenantId: string; userId: string; role: Account['role'] }, request: NativeOperationRequest,
    verifyNativeResource?: () => Promise<void>): Promise<void> {
    return this.guarded('runtime.operation', requestId, async () => {
      const { account } = await this.principal(this.sql, token)
      if (account.tenantId !== grant.tenantId || account.userId !== grant.userId || account.role !== grant.role) {
        throw new EnterpriseError(403, 'runtime-principal-changed', '账户运行权限已变化，请重新连接')
      }
      authorizeNativeOperation(account.role, request)
      await verifyNativeResource?.()
    }, token)
  }

  async listMembers(token: string | undefined, requestId: string): Promise<Account[]> {
    return this.guarded('identity.members.list', requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      await this.principal(db, token, true)
      const rows = await db<UserRow[]>`select * from haas.users where tenant_id = ${this.tenantId} order by created_at, user_id limit 501`
      if (rows.length > 500) throw new EnterpriseError(409, 'member-list-capacity', '当前界面最多读取 500 个账户；未返回不完整列表')
      return rows.map(account)
    }), token)
  }

  /** Internal short transaction seam for durable native management, not a
   * transferable grant. Native effects must run outside this transaction. */
  async featureTransaction<T>(token: string | undefined, requestId: string,
    action: 'runtime.feature.read' | 'runtime.feature.requested' | 'runtime.feature.authorized' | 'runtime.feature.confirmed',
    run: (db: TransactionSql, principal: RuntimeIdentity) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded(action, requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, true), result = await run(db, principal)
      await this.audit(db, action, 'succeeded', requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  async runtimeManagementRead<T>(token: string | undefined, requestId: string,
    run: (db: TransactionSql, principal: RuntimeIdentity) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded('runtime.resources.read', requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, true), result = await run(db, principal)
      await this.audit(db, 'runtime.resources.read', 'succeeded', requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  /** Session command identity shares the current principal/revocation/audit
   * transaction. Native effects occur outside this transaction. */
  async sessionCreateTransaction<T>(token: string | undefined, input: object, context: CommandContext,
    action: 'session.create.requested' | 'session.create.confirmed',
    run: (db: TransactionSql, principal: RuntimeIdentity, key: ResourcePreparationKey) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded(action, context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token)
      const result = await run(db, principal, this.commandKey(`session.create:${principal.account.userId}`, input, context))
      await this.audit(db, action, 'succeeded', context.requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  /** Turn identities share current member authority and the original audit
   * transaction. Message bodies are never persisted by this owner. */
  async sessionTurnTransaction<T>(token: string | undefined, input: object, context: CommandContext,
    action: 'session.turn.requested' | 'session.turn.confirmed',
    run: (db: TransactionSql, principal: RuntimeIdentity, key: ResourcePreparationKey) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded(action, context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token)
      const result = await run(db, principal, this.commandKey(`session.turn:${principal.account.userId}`, input, context))
      await this.audit(db, action, 'succeeded', context.requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  /** Approval command identity and audit share current actor authorization.
   * Native pending requests and decisions remain owned by Harness. */
  async sessionApprovalTransaction<T>(token: string | undefined, input: object, context: CommandContext,
    action: 'session.approval.requested' | 'session.approval.observed',
    run: (db: TransactionSql, principal: RuntimeIdentity, key: ResourcePreparationKey) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded(action, context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token)
      const result = await run(db, principal, this.commandKey(`session.approval:${principal.account.userId}`, input, context))
      await this.audit(db, action, 'succeeded', context.requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  /** Model command reservations/receipts share the current admin and audit
   * transaction. No native I/O or raw credential may enter the result/audit. */
  async modelTransaction<T>(token: string | undefined, requestId: string,
    action: 'runtime.model.command.authorized' | 'runtime.model.requested' | 'runtime.model.confirmed' | 'runtime.model.resolved' | 'runtime.model.receipt',
    run: (db: TransactionSql, principal: RuntimeIdentity) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded(action, requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, true), result = await run(db, principal)
      await this.audit(db, action, 'succeeded', requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  modelCommandTransaction<T>(token: string | undefined, input: object, context: CommandContext,
    action: 'runtime.model.command.authorized' | 'runtime.model.requested',
    run: (db: TransactionSql, principal: RuntimeIdentity, key: ResourcePreparationKey) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    return this.modelTransaction(token, context.requestId, action, (db, principal) => run(db, principal,
      this.commandKey(`runtime.model.command:${principal.account.userId}`, input, context)))
  }

  /** Member instruction command identity and audit, never prompt contents. */
  async instructionTransaction<T>(token: string | undefined, requestId: string,
    action: 'runtime.instructions.authorized' | 'runtime.instructions.read' | 'runtime.instructions.requested'
      | 'runtime.instructions.confirmed' | 'runtime.instructions.receipt' | 'runtime.instructions.resolved',
    run: (db: TransactionSql, principal: RuntimeIdentity) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded(action, requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, true), result = await run(db, principal)
      await this.audit(db, action, 'succeeded', requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  instructionCommandTransaction<T>(token: string | undefined, input: object, context: CommandContext,
    action: 'runtime.instructions.authorized' | 'runtime.instructions.requested',
    run: (db: TransactionSql, principal: RuntimeIdentity, key: ResourcePreparationKey) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    return this.instructionTransaction(token, context.requestId, action, (db, principal) => run(db, principal,
      this.commandKey(`runtime.instructions.command:${principal.account.userId}`, input, context)))
  }

  /** Connector operation metadata and redacted receipts, never raw config. */
  async connectorTransaction<T>(token: string | undefined, requestId: string,
    action: 'runtime.connector.command.authorized' | 'runtime.connector.configuration.read' | 'runtime.connector.activation.read' | 'runtime.connector.requested' | 'runtime.connector.confirmed' | 'runtime.connector.resolved' | 'runtime.connector.receipt' | 'runtime.connector.approval.read'
      | 'runtime.connector.activation.requested' | 'runtime.connector.activation.confirmed' | 'runtime.connector.activation.receipt' | 'runtime.connector.activation.resolved',
    run: (db: TransactionSql, principal: RuntimeIdentity) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    const result = await this.guarded(action, requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, true), result = await run(db, principal)
      await this.audit(db, action, 'succeeded', requestId, principal.account.userId, result.targetId, result.reason)
      return { value: result.data }
    }), token)
    return result.value
  }

  connectorCommandTransaction<T>(token: string | undefined, input: object, context: CommandContext,
    action: 'runtime.connector.command.authorized' | 'runtime.connector.requested',
    run: (db: TransactionSql, principal: RuntimeIdentity, key: ResourcePreparationKey) => Promise<{ data: T; targetId: string; reason: string }>): Promise<T> {
    return this.connectorTransaction(token, context.requestId, action, (db, principal) => run(db, principal,
      this.commandKey(`runtime.connector.command:${principal.account.userId}`, input, context)))
  }

  async connectorActivationCommandTransaction<T>(token: string | undefined, input: object, context: CommandContext,
    action: 'runtime.connector.command.authorized' | 'runtime.connector.activation.requested',
    run: (db: TransactionSql, principal: RuntimeIdentity, key: ResourcePreparationKey) => Promise<{ data: T; targetId: string; reason: string; replayed?: boolean }>): Promise<T> {
    const result = await this.guarded(action, context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, true), value = await run(db, principal,
        this.commandKey(`runtime.connector.activation-command:${principal.account.userId}`, input, context))
      // A racing duplicate reads history; it did not reserve another sender.
      await this.audit(db, value.replayed ? 'runtime.connector.activation.receipt' : action, 'succeeded', context.requestId,
        principal.account.userId, value.targetId, value.reason)
      return { value: value.data }
    }), token)
    return result.value
  }

  /** Internal readonly composition, never an impersonation/session grant.
   * Authorization audit commits before native content is read. The original
   * admin login and exact target are revalidated before returning any bytes. */
  async inspectMemberContent<Target extends object, Value>(token: string | undefined, userId: string,
    reason: string, selection: string, requestId: string, signal: AbortSignal,
    select: (db: TransactionSql, member: Account) => Promise<Target>,
    read: (target: Target, verify: () => Promise<void>) => Promise<Value>) {
    return this.inspectMember('content.access', token, userId, reason, selection, requestId, signal, select, read)
  }

  async inspectMemberModels<Target extends object, Value>(token: string | undefined, userId: string,
    reason: string, requestId: string, signal: AbortSignal,
    select: (db: TransactionSql, member: Account) => Promise<Target>,
    read: (target: Target, verify: () => Promise<void>) => Promise<Value>) {
    return this.inspectMember('runtime.model', token, userId, reason, 'default-model-state', requestId, signal, select, read)
  }

  async inspectMemberConnectors<Target extends object, Value>(token: string | undefined, userId: string,
    reason: string, requestId: string, signal: AbortSignal,
    select: (db: TransactionSql, member: Account) => Promise<Target>,
    read: (target: Target, verify: () => Promise<void>) => Promise<Value>) {
    return this.inspectMember('runtime.connector', token, userId, reason, 'native-connector-inventory', requestId, signal, select, read)
  }

  private async inspectMember<Target extends object, Value>(domain: 'content.access' | 'runtime.model' | 'runtime.connector', token: string | undefined, userId: string,
    reason: string, selection: string, requestId: string, signal: AbortSignal,
    select: (db: TransactionSql, member: Account) => Promise<Target>,
    read: (target: Target, verify: () => Promise<void>) => Promise<Value>): Promise<{ data: Value; disclosure: {
      memberId: string; memberName: string; reason: string; requestId: string; readOnly: true; authorizedAt: string; completedAt: string
    } }> {
    return this.guarded(`${domain}.read`, requestId, async () => {
      const targetId = uuid(userId), note = text(reason, 3, 500), resource = text(selection, 1, 500)
      const targetMember = async (db: TransactionSql) => {
        const [row] = await db<UserRow[]>`select * from haas.users where tenant_id = ${this.tenantId} and user_id = ${targetId} and role = 'member'`
        if (!row || domain !== 'content.access' && row.status !== 'active') {
          throw new EnterpriseError(403, domain === 'content.access' ? 'member-content-denied'
            : domain === 'runtime.model' ? 'member-model-denied' : 'member-connector-denied', '无法查看所选成员的信息')
        }
        return account(row)
      }
      const prepared = await this.sql.begin(async db => {
        await this.lockTenant(db); signal.throwIfAborted()
        const actor = await this.principal(db, token, true), member = await targetMember(db)
        const target = await select(db, member); signal.throwIfAborted()
        const authorizedAt = new Date().toISOString()
        await this.audit(db, `${domain}.authorized`, 'succeeded', requestId, actor.account.userId, targetId,
          JSON.stringify({ reason: note, selection: resource, readOnly: true }))
        return { actor, target, authorizedAt }
      })
      const revalidate = async (db: TransactionSql) => {
        await this.lockTenant(db); signal.throwIfAborted()
        const actor = await this.principal(db, token, true), member = await targetMember(db)
        if (actor.sessionId !== prepared.actor.sessionId || actor.account.userId !== prepared.actor.account.userId
          || !isDeepStrictEqual(await select(db, member), prepared.target)) {
          throw new EnterpriseError(403, domain === 'content.access' ? 'member-content-changed'
            : domain === 'runtime.model' ? 'member-model-changed' : 'member-connector-changed', '管理员身份或成员运行环境已变化，请重新确认')
        }
        signal.throwIfAborted(); return member
      }
      const verify = async () => { await this.sql.begin(async db => { await revalidate(db) }) }
      await verify()
      const data = await read(prepared.target, verify)
      const disclosure = await this.sql.begin(async db => {
        const member = await revalidate(db), completedAt = new Date().toISOString()
        await this.audit(db, `${domain}.read`, 'succeeded', requestId, prepared.actor.account.userId, targetId,
          JSON.stringify({ reason: note, selection: resource, readOnly: true }))
        return { memberId: targetId, memberName: member.displayName, reason: note, requestId, readOnly: true as const,
          authorizedAt: prepared.authorizedAt, completedAt }
      })
      signal.throwIfAborted()
      return { data, disclosure }
    }, token)
  }

  /** Internal composition seam, not an HTTP capability. Resource decisions use
   * the same identity/revocation transaction order as members and groups. */
  async resourceRead<T>(token: string | undefined, requestId: string, admin: boolean,
    read: (db: TransactionSql, principal: RuntimeIdentity) => Promise<T>): Promise<T> {
    const result = await this.guarded('resource.read', requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      return { value: await read(db, await this.principal(db, token, admin)) }
    }), token)
    return result.value
  }

  /** Large immutable captures reserve only in this short transaction. The
   * caller transfers outside it, then resourceCommand reauthorizes and commits
   * the result, command receipt and success audit together. Preparation itself
   * is neither a successful command nor a transferable permission. */
  async prepareResourceCommand<Input extends object, T extends object, Prepared>(token: string | undefined, action: ResourceAction,
    normalize: () => Input, context: CommandContext, admin: boolean,
    prepare: (db: TransactionSql, principal: RuntimeIdentity, input: Input, key: ResourcePreparationKey) => Promise<Prepared>,
    verifyReplay?: (db: TransactionSql, principal: RuntimeIdentity, input: Input, previous: T) => Promise<void>): Promise<
      { kind: 'replay'; input: Input; principal: RuntimeIdentity; result: CommandResult<T> } | { kind: 'prepared'; input: Input; principal: RuntimeIdentity; prepared: Prepared }> {
    return this.guarded(action, context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, admin), input = normalize()
      const key = this.commandKey(`${action}:${principal.account.userId}`, input, context)
      const replay = await this.commandReplay<T>(db, key)
      if (replay) {
        await verifyReplay?.(db, principal, input, replay.data)
        return { kind: 'replay' as const, principal, input, result: replay }
      }
      return { kind: 'prepared' as const, principal, input, prepared: await prepare(db, principal, input, key) }
    }), token)
  }

  /** A private transfer failure remains audited without holding tenant locks. */
  resourceTransfer<T>(token: string | undefined, requestId: string, run: () => Promise<T>,
    action: 'resource.skill.capture' | 'resource.skill.adoption.transfer' | 'runtime.feature.transfer' | 'runtime.connector.approval' = 'resource.skill.capture'): Promise<T> {
    return this.guarded(action, requestId, run, token)
  }

  async resourceCommand<Input extends object, T extends object>(token: string | undefined, action: ResourceAction,
    normalize: () => Input, context: CommandContext, admin: boolean,
    run: (db: TransactionSql, principal: RuntimeIdentity, input: Input) => Promise<{ data: T; targetId: string; reason: string }>,
    verifyReplay?: (db: TransactionSql, principal: RuntimeIdentity, input: Input, previous: T) => Promise<void>): Promise<CommandResult<T>> {
    return this.guarded(action, context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const principal = await this.principal(db, token, admin)
      const input = normalize()
      const result = await this.command(db, `${action}:${principal.account.userId}`, input, context, async () => {
        const result = await run(db, principal, input)
        await this.audit(db, action, 'succeeded', context.requestId, principal.account.userId, result.targetId, result.reason)
        return result.data
      })
      // A native adoption receipt is not current authority or proof that its
      // native target survived replacement. Its owner verifies both on replay;
      // a failed check cannot return the old successful command response.
      if (result.replayed) await verifyReplay?.(db, principal, input, result.data)
      return result
    }), token)
  }

  async createMember(token: string | undefined, input: unknown, context: CommandContext): Promise<CommandResult<Account>> {
    return this.guarded('identity.member.create', context.requestId, async () => {
      await this.principal(this.sql, token, true)
      const data = userInput(record(input, ['username', 'password', 'displayName']))
      const credential = await this.passwords.hash(data.password)
      return await this.sql.begin(async db => {
        await this.lockTenant(db)
        const actor = await this.principal(db, token, true)
        return this.command(db, `member.create:${actor.account.userId}`, data, context, async () => {
          const [row] = await db<UserRow[]>`insert into haas.users (tenant_id, user_id, username, display_name, role, status, credential)
            values (${this.tenantId}, ${randomUUID()}, ${data.username}, ${data.displayName}, 'member', 'active', ${credential}) returning *`
          if (!row) throw new Error('Missing inserted member')
          await this.audit(db, 'identity.member.create', 'succeeded', context.requestId, actor.account.userId, row.user_id)
          return account(row)
        })
      })
    }, token)
  }

  async renameMember(token: string | undefined, userId: string, input: unknown, context: CommandContext): Promise<CommandResult<Account>> {
    return this.guarded('identity.member.rename', context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const actor = await this.principal(db, token, true)
      const body = record(input, ['displayName', 'expectedDisplayName'])
      const data = { userId: uuid(userId), displayName: text(body.displayName, 1, 120), expectedDisplayName: text(body.expectedDisplayName, 1, 120) }
      return this.command(db, `member.rename:${actor.account.userId}`, data, context, async () => {
        const [current] = await db<UserRow[]>`select * from haas.users
          where tenant_id = ${this.tenantId} and user_id = ${data.userId} and role = 'member' for update`
        if (!current) return notFound()
        if (current.display_name !== data.expectedDisplayName) {
          throw new EnterpriseError(409, 'member-name-changed', '成员姓名已被修改，请刷新列表后重试')
        }
        const [row] = await db<UserRow[]>`update haas.users set display_name = ${data.displayName}
          where tenant_id = ${this.tenantId} and user_id = ${data.userId} and role = 'member' returning *`
        if (!row) throw new Error('Missing renamed member')
        await this.audit(db, 'identity.member.rename', 'succeeded', context.requestId, actor.account.userId, data.userId,
          `姓名从「${current.display_name}」改为「${data.displayName}」`)
        return account(row)
      })
    }), token)
  }

  async setMemberStatus(token: string | undefined, userId: string, input: unknown, context: CommandContext): Promise<CommandResult<Account>> {
    return this.guarded('identity.member.status', context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const actor = await this.principal(db, token, true)
      const body = record(input, ['status', 'reason'])
      if (body.status !== 'active' && body.status !== 'disabled') return invalid()
      const data = { userId: uuid(userId), status: body.status, reason: text(body.reason, 3, 500) }
      return this.command(db, `member.status:${actor.account.userId}`, data, context, async () => {
        const [row] = await db<UserRow[]>`update haas.users set status = ${data.status}
          where tenant_id = ${this.tenantId} and user_id = ${data.userId} and role = 'member' returning *`
        if (!row) return notFound()
        if (data.status === 'disabled') await db`update haas.login_sessions set revoked_at = clock_timestamp()
          where tenant_id = ${this.tenantId} and user_id = ${data.userId} and revoked_at is null`
        await this.audit(db, 'identity.member.status', 'succeeded', context.requestId, actor.account.userId, data.userId, data.reason)
        return account(row)
      })
    }), token)
  }

  private async groupView(db: TransactionSql, row: GroupRow): Promise<MemberGroup> {
    const members = await db<{ user_id: string }[]>`select user_id from haas.group_members
      where tenant_id = ${this.tenantId} and group_id = ${row.group_id} order by user_id limit 501`
    if (members.length > 500) throw new EnterpriseError(409, 'group-capacity', '成员组超过当前读取上限；未返回不完整列表')
    return { groupId: row.group_id, name: row.name, status: row.status, revision: row.revision, memberIds: members.map(member => member.user_id) }
  }

  async listGroups(token: string | undefined, requestId: string): Promise<MemberGroup[]> {
    return this.guarded('identity.groups.list', requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      await this.principal(db, token, true)
      const rows = await db<GroupRow[]>`select * from haas.member_groups where tenant_id = ${this.tenantId} order by created_at, group_id limit 201`
      if (rows.length > 200) throw new EnterpriseError(409, 'group-capacity', '成员组超过 200 个；未返回不完整列表')
      const members = await db<{ group_id: string; user_id: string }[]>`select group_id, user_id from haas.group_members
        where tenant_id = ${this.tenantId} order by group_id, user_id limit 100001`
      if (members.length > 100000) throw new EnterpriseError(409, 'group-capacity', '成员组超过当前读取上限；未返回不完整列表')
      const byGroup = new Map<string, string[]>()
      for (const member of members) {
        const ids = byGroup.get(member.group_id) ?? []; ids.push(member.user_id); byGroup.set(member.group_id, ids)
        if (ids.length > 500) throw new EnterpriseError(409, 'group-capacity', '成员组超过当前读取上限；未返回不完整列表')
      }
      return rows.map(row => ({ groupId: row.group_id, name: row.name, status: row.status, revision: row.revision, memberIds: byGroup.get(row.group_id) ?? [] }))
    }), token)
  }

  async createGroup(token: string | undefined, input: unknown, context: CommandContext): Promise<CommandResult<MemberGroup>> {
    return this.guarded('identity.group.create', context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const actor = await this.principal(db, token, true)
      const body = record(input, ['name'])
      const data = { name: text(body.name, 1, 120).normalize('NFC') }
      return this.command(db, `group.create:${actor.account.userId}`, data, context, async () => {
        const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.member_groups where tenant_id = ${this.tenantId}`
        if (!capacity) throw new Error('Missing group capacity')
        if (capacity.count >= 200) throw new EnterpriseError(409, 'group-capacity', '当前最多保留 200 个成员组，包括已归档组')
        const [row] = await db<GroupRow[]>`insert into haas.member_groups (tenant_id, group_id, name, status, revision)
          values (${this.tenantId}, ${randomUUID()}, ${data.name}, 'active', 1) returning *`
        if (!row) throw new Error('Missing created group')
        await this.audit(db, 'identity.group.create', 'succeeded', context.requestId, actor.account.userId, row.group_id, `创建成员组「${row.name}」，尚未分配资源权限`)
        return this.groupView(db, row)
      })
    }), token)
  }

  async updateGroup(token: string | undefined, groupId: string, input: unknown, context: CommandContext): Promise<CommandResult<MemberGroup>> {
    return this.guarded('identity.group.update', context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const actor = await this.principal(db, token, true)
      const body = record(input, ['name', 'memberIds', 'expectedRevision'])
      const data = { groupId: uuid(groupId), name: text(body.name, 1, 120).normalize('NFC'),
        memberIds: groupMemberIds(body.memberIds), expectedRevision: groupRevision(body.expectedRevision) }
      return this.command(db, `group.update:${actor.account.userId}`, data, context, async () => {
        const [current] = await db<GroupRow[]>`select * from haas.member_groups where tenant_id = ${this.tenantId} and group_id = ${data.groupId} for update`
        if (!current) return notFound()
        if (current.revision !== data.expectedRevision) throw new EnterpriseError(409, 'group-changed', '成员组已被修改，请刷新后重新编辑')
        if (current.status !== 'active') throw new EnterpriseError(409, 'group-archived', '请先恢复成员组，再编辑名称和成员')
        const known = data.memberIds.length ? await db<{ user_id: string }[]>`select user_id from haas.users
          where tenant_id = ${this.tenantId} and user_id in ${db(data.memberIds)}` : []
        if (known.length !== data.memberIds.length) return notFound()
        const previous = await this.groupView(db, current)
        await db`delete from haas.group_members where tenant_id = ${this.tenantId} and group_id = ${data.groupId}`
        if (data.memberIds.length) await db`insert into haas.group_members ${db(data.memberIds.map(userId => ({ tenant_id: this.tenantId, group_id: data.groupId, user_id: userId })))}`
        const [row] = await db<GroupRow[]>`update haas.member_groups set name = ${data.name}, revision = revision + 1
          where tenant_id = ${this.tenantId} and group_id = ${data.groupId} returning *`
        if (!row) throw new Error('Missing updated group')
        const change = { name: data.name, previousName: current.name, revision: row.revision,
          addedUserIds: data.memberIds.filter(id => !previous.memberIds.includes(id)),
          removedUserIds: previous.memberIds.filter(id => !data.memberIds.includes(id)) }
        await this.audit(db, 'identity.group.update', 'succeeded', context.requestId, actor.account.userId, data.groupId, JSON.stringify(change))
        return this.groupView(db, row)
      })
    }), token)
  }

  async setGroupStatus(token: string | undefined, groupId: string, input: unknown, context: CommandContext): Promise<CommandResult<MemberGroup>> {
    return this.guarded('identity.group.status', context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      const actor = await this.principal(db, token, true)
      const body = record(input, ['status', 'reason', 'expectedRevision'])
      if (body.status !== 'active' && body.status !== 'archived') return invalid()
      const data = { groupId: uuid(groupId), status: body.status, reason: text(body.reason, 3, 500), expectedRevision: groupRevision(body.expectedRevision) }
      return this.command(db, `group.status:${actor.account.userId}`, data, context, async () => {
        const [current] = await db<GroupRow[]>`select * from haas.member_groups where tenant_id = ${this.tenantId} and group_id = ${data.groupId} for update`
        if (!current) return notFound()
        if (current.revision !== data.expectedRevision) throw new EnterpriseError(409, 'group-changed', '成员组已被修改，请刷新后重新操作')
        if (current.status === data.status) throw new EnterpriseError(409, 'group-status-unchanged', '成员组已处于该状态，请刷新列表')
        const [row] = await db<GroupRow[]>`update haas.member_groups set status = ${data.status}, revision = revision + 1
          where tenant_id = ${this.tenantId} and group_id = ${data.groupId} returning *`
        if (!row) throw new Error('Missing group status')
        await this.audit(db, 'identity.group.status', 'succeeded', context.requestId, actor.account.userId, data.groupId,
          `${data.status === 'archived' ? '归档' : '恢复'}成员组「${row.name}」；原因：${data.reason}；版本 ${row.revision}`)
        return this.groupView(db, row)
      })
    }), token)
  }

  async logout(token: string | undefined, input: unknown, context: CommandContext): Promise<CommandResult<{ loggedOut: true }>> {
    return this.guarded('identity.logout', context.requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      record(input, [])
      // Revoked/expired sessions may only replay their exact logout, never read
      // any account projection or start a new protected operation.
      if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return unauthenticated()
      const [session] = await db<{ session_id: string; user_id: string }[]>`select session_id, user_id from haas.login_sessions
        where tenant_id = ${this.tenantId} and token_digest = ${digest(token)}`
      if (!session) return unauthenticated()
      return this.command(db, `logout:${session.session_id}`, {}, context, async () => {
        await this.principal(db, token)
        await db`update haas.login_sessions set revoked_at = clock_timestamp()
          where tenant_id = ${this.tenantId} and session_id = ${session.session_id}`
        await this.audit(db, 'identity.logout', 'succeeded', context.requestId, session.user_id)
        return { loggedOut: true as const }
      })
    }), token)
  }

  async listAudit(token: string | undefined, requestId: string): Promise<object[]> {
    return this.guarded('identity.audit.list', requestId, () => this.sql.begin(async db => {
      await this.lockTenant(db)
      await this.principal(db, token, true)
      return await db`select event_id, action, outcome, actor_user_id, target_id, reason, request_id, occurred_at
        from haas.audit_events where tenant_id = ${this.tenantId} order by sequence desc limit 200`
    }), token)
  }
}
