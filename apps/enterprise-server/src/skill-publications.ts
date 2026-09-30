import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import { readSkillPublicationSelection, readSkillPublicationAdoptionInput, readSkillPublicationAdoption, SKILL_PUBLICATION_CHUNK_BYTES,
  type SkillPublicationAdoptionInput, type SkillPublicationAdoption } from '@paimind/skill-market/publication'
import type { CommandContext, Identity, RuntimeIdentity } from './identity.js'
import { SkillArtifacts, type SkillPublicationSource } from './skill-artifacts.js'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import { readSkillContent, type SkillContentSelection } from './skill-content.js'
import { validateNativeSkillReferences, type NativeSkillPublicationReference } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

interface PublicationRow {
  publication_id: string; artifact_id: string; source_user_id: string; skill_name: string; package_digest: string;
  status: 'pending' | 'published' | 'rejected' | 'withdrawn'; revision: number; submission_reason: string; review_reason: string | null;
  archive_digest: string; archive_bytes: number; expanded_bytes: number; entry_count: number
}
interface AssignmentRow {
  publication_id: string; subject_kind: 'user' | 'group' | 'all'; subject_user_id: string | null; subject_group_id: string | null;
  effect: 'allow' | 'deny'; active: boolean
}
const missing = (): never => { throw new EnterpriseError(404, 'not-found', '对象不存在或不可访问') }
const revision = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_646) return invalid('发布版本无效')
  return value
}
const view = (row: PublicationRow) => ({ publicationId: row.publication_id, artifactId: row.artifact_id,
  sourceUserId: row.source_user_id, name: row.skill_name, digest: row.package_digest, status: row.status, revision: row.revision,
  submissionReason: row.submission_reason, reviewReason: row.review_reason, archiveDigest: row.archive_digest,
  archiveBytes: row.archive_bytes, expandedBytes: row.expanded_bytes, entryCount: row.entry_count, runtimeGrant: false as const })
type PublicationView = ReturnType<typeof view>
export type SkillPublicationAdoptionBridge = (token: string | undefined, requestId: string, principal: RuntimeIdentity,
  input: SkillPublicationAdoptionInput, readChunk: (offset: number, signal: AbortSignal) => Promise<Buffer>,
  mode: 'adopt' | 'verify', signal: AbortSignal) => Promise<Readonly<SkillPublicationAdoption>>
const accessFor = (rows: AssignmentRow[]) => {
  if (rows.some(row => row.subject_kind === 'user' && row.effect === 'deny')) return undefined
  return rows.some(row => row.subject_kind === 'user' && row.effect === 'allow') ? 'user-allow' as const
    : rows.some(row => row.subject_kind === 'group' && row.effect === 'allow') ? 'group-allow' as const
      : rows.some(row => row.subject_kind === 'all' && row.effect === 'allow') ? 'all-allow' as const : undefined
}

/** Separate governance domain from Agent publications. These records do not
 * install, enable or register a native Skill and never grant model execution. */
export class SkillPublications {
  private readonly artifacts: SkillArtifacts
  private readonly contentReads = new Map<string, number>()
  private totalContentReads = 0
  constructor(sql: Sql, private readonly identity: Identity, private readonly source: SkillPublicationSource,
    private readonly adoption?: SkillPublicationAdoptionBridge) {
    this.artifacts = new SkillArtifacts(sql)
  }

  /** Trusted same-tenant governance read. This is immutable version metadata,
   * not an assignment or execution decision; callers enforce those separately. */
  static async readPublicationVersion(db: TransactionSql, principal: Pick<RuntimeIdentity, 'account'>, publicationId: string) {
    const row = await SkillPublications.current(db, principal, uuid(publicationId))
    return Object.freeze({ status: row.status, reference: readSkillPublicationAdoptionInput({ tenantId: principal.account.tenantId,
      publicationId: row.publication_id, sourceUserId: row.source_user_id, name: row.skill_name, packageDigest: row.package_digest,
      archiveDigest: row.archive_digest, archiveBytes: row.archive_bytes, expandedBytes: row.expanded_bytes, entryCount: row.entry_count }) })
  }

  /** Called inside the existing exact-login/cell transaction, not a cached
   * permission or public metadata read. Native ownership verifies the bytes. */
  static async authorizeExecution(db: TransactionSql, principal: RuntimeIdentity, references: readonly NativeSkillPublicationReference[]): Promise<void> {
    const eligible = await SkillPublications.readEligibility(db, principal, references)
    if (eligible.length !== references.length) return missing()
  }

  /** Current assignment projection only. The caller pins the active account
   * and cell; this does not create a RuntimeIdentity or authorize execution. */
  static async readEligibility(db: TransactionSql, principal: Pick<RuntimeIdentity, 'account'>,
    references: readonly NativeSkillPublicationReference[]): Promise<readonly string[]> {
    validateNativeSkillReferences(references)
    const eligible: string[] = []
    for (const reference of references) {
      const selected = readSkillPublicationAdoptionInput(reference)
      if (selected.tenantId !== principal.account.tenantId) continue
      let row: PublicationRow
      try { row = await SkillPublications.current(db, principal, selected.publicationId) }
      catch (error) {
        if (error instanceof EnterpriseError && error.code === 'not-found') continue
        throw error
      }
      if (row.status !== 'published' || !accessFor(await SkillPublications.matched(db, principal, row.publication_id))) continue
      const expected = readSkillPublicationAdoptionInput({ tenantId: principal.account.tenantId,
        publicationId: row.publication_id, sourceUserId: row.source_user_id, name: row.skill_name, packageDigest: row.package_digest,
        archiveDigest: row.archive_digest, archiveBytes: row.archive_bytes, expandedBytes: row.expanded_bytes, entryCount: row.entry_count })
      if (JSON.stringify(selected) === JSON.stringify(expected)) eligible.push(selected.publicationId)
    }
    return Object.freeze(eligible.sort())
  }

  async adopt(token: string | undefined, publicationId: string, input: unknown, context: CommandContext, signal: AbortSignal) {
    const normalize = () => {
      const body = record(input, ['expectedRevision', 'expectedDigest'])
      const expectedDigest = text(body.expectedDigest, 71, 71)
      if (!/^sha256:[a-f0-9]{64}$/u.test(expectedDigest)) return invalid('技能发布摘要无效')
      return { publicationId: uuid(publicationId), expectedRevision: revision(body.expectedRevision), expectedDigest }
    }
    const current = async (db: TransactionSql, principal: RuntimeIdentity, data: ReturnType<typeof normalize>) => {
      const row = await SkillPublications.current(db, principal, data.publicationId)
      if (row.status !== 'published' || !accessFor(await SkillPublications.matched(db, principal, data.publicationId))) return missing()
      if (row.revision !== data.expectedRevision || row.package_digest !== data.expectedDigest) {
        throw new EnterpriseError(409, 'publication-changed', '技能版本或分配已变化，请刷新后确认')
      }
      return { row, selected: readSkillPublicationAdoptionInput({ tenantId: principal.account.tenantId,
        publicationId: row.publication_id, sourceUserId: row.source_user_id, name: row.skill_name, packageDigest: row.package_digest,
        archiveDigest: row.archive_digest, archiveBytes: row.archive_bytes, expandedBytes: row.expanded_bytes, entryCount: row.entry_count }) }
    }
    type Result = Readonly<SkillPublicationAdoption> & { runtimeGrant: false }
    const preparation = await this.identity.prepareResourceCommand<ReturnType<typeof normalize>, Result, Awaited<ReturnType<typeof current>>>(
      token, 'resource.skill.adopt', normalize, context, false, (db, principal, data) => current(db, principal, data),
      async (db, principal, data) => { await current(db, principal, data) })
    const data = preparation.input, principal = preparation.principal
    const prepared = preparation.kind === 'prepared' ? preparation.prepared
      : await this.identity.resourceRead(token, context.requestId, false, (db, actor) => current(db, actor, data))
    const selected = prepared.selected
    const receipt = await this.identity.resourceTransfer(token, context.requestId, async () => {
      if (!this.adoption) throw new EnterpriseError(503, 'skill-adoption-unavailable', '原生技能采用尚未接入', true)
      const result = readSkillPublicationAdoption(await this.adoption(token, context.requestId, principal, selected,
        async (offset, abort) => this.identity.resourceRead(token, context.requestId, false, async (db, actor) => {
          signal.throwIfAborted(); abort.throwIfAborted()
          if (actor.sessionId !== principal.sessionId) return missing()
          const latest = await current(db, actor, data)
          if (JSON.stringify(latest.selected) !== JSON.stringify(selected) || !Number.isSafeInteger(offset)
            || offset < 0 || offset >= selected.archiveBytes || offset % SKILL_PUBLICATION_CHUNK_BYTES !== 0) return missing()
          const [chunk] = await db<{ data: Buffer }[]>`select data from haas.skill_artifact_chunks where tenant_id = ${actor.account.tenantId}
            and artifact_id = ${latest.row.artifact_id} and chunk_offset = ${offset}`
          if (!chunk) throw new EnterpriseError(503, 'skill-archive-incomplete', '无法读取完整技能归档，未确认采用', true)
          return chunk.data
        }), preparation.kind === 'replay' ? 'verify' : 'adopt', signal))
      const { schema: _schema, adoptedAt: _at, ...origin } = result
      if (JSON.stringify(origin) !== JSON.stringify(selected)) throw new Error('Native Skill adoption provenance mismatch')
      return result
    }, 'resource.skill.adoption.transfer')
    const result: Result = { ...receipt, runtimeGrant: false }
    return this.identity.resourceCommand(token, 'resource.skill.adopt', () => data, context, false, async (db, actor) => {
      signal.throwIfAborted()
      if (actor.sessionId !== principal.sessionId) return missing()
      await current(db, actor, data)
      return { data: result, targetId: data.publicationId, reason: '采用明确分配的固定技能版本；不授予启用或运行权' }
    }, async (db, actor, data, previous) => {
      signal.throwIfAborted(); await current(db, actor, data)
      if (JSON.stringify(previous) !== JSON.stringify(result)) {
        // JSONB does not preserve property order, so compare the canonical
        // native receipt and the explicit non-grant flag independently.
        const { runtimeGrant, ...oldReceipt } = previous
        if (runtimeGrant !== false || JSON.stringify(readSkillPublicationAdoption(oldReceipt)) !== JSON.stringify(receipt)) {
          throw new EnterpriseError(409, 'skill-adoption-changed', '技能采用回执已变化，不能重放旧结果')
        }
      }
    })
  }

  async submit(token: string | undefined, input: unknown, context: CommandContext, signal: AbortSignal) {
    const normalize = () => {
      const body = record(input, ['skillId', 'expectedDigest', 'reason'])
      let selection: ReturnType<typeof readSkillPublicationSelection>
      try { selection = readSkillPublicationSelection({ skillId: body.skillId, expectedDigest: body.expectedDigest }) }
      catch { return invalid('技能编号或目录版本摘要无效') }
      return { ...selection, reason: text(body.reason, 3, 500) }
    }
    const preparation = await this.identity.prepareResourceCommand<ReturnType<typeof normalize>, PublicationView,
      Awaited<ReturnType<SkillArtifacts['reserve']>>>(token, 'resource.skill.submit', normalize, context, true,
      (db, principal, selection, key) => this.artifacts.reserve(db, principal, selection, key))
    if (preparation.kind === 'replay') return preparation.result
    const capture = preparation.prepared
    await this.identity.resourceTransfer(token, context.requestId, () =>
      this.artifacts.capture(capture, this.source, token, context.requestId, preparation.principal, signal))
    return this.identity.resourceCommand(token, 'resource.skill.submit', () => preparation.input, context, true, async (db, principal, data) => {
      signal.throwIfAborted()
      if (principal.sessionId !== preparation.principal.sessionId || principal.account.userId !== capture.source_user_id
        || principal.account.tenantId !== capture.tenant_id) return missing()
      const [artifact] = await db`select 1 from haas.skill_artifacts where tenant_id = ${principal.account.tenantId}
        and artifact_id = ${capture.artifact_id} and capture_generation = ${capture.capture_generation} and status = 'sealed'
        and source_user_id = ${principal.account.userId} and skill_name = ${data.skillId} and package_digest = ${data.expectedDigest}`
      if (!artifact) throw new EnterpriseError(409, 'skill-capture-unsealed', '技能版本未完整封存，请重试原请求', true)
      const publicationId = randomUUID()
      await db`insert into haas.skill_publications
        (tenant_id, publication_id, source_user_id, artifact_id, skill_name, package_digest, submission_reason)
        values (${principal.account.tenantId}, ${publicationId}, ${principal.account.userId}, ${capture.artifact_id},
          ${data.skillId}, ${data.expectedDigest}, ${data.reason})`
      return { data: view(await SkillPublications.current(db, principal, publicationId)), targetId: publicationId, reason: data.reason }
    })
  }

  list(token: string | undefined, requestId: string) {
    return this.identity.resourceRead(token, requestId, true, async (db, principal) => {
      const rows = await db<PublicationRow[]>`select p.*, a.archive_digest, a.archive_bytes, a.expanded_bytes, a.entry_count
        from haas.skill_publications p join haas.skill_artifacts a using (tenant_id, artifact_id)
        where p.tenant_id = ${principal.account.tenantId} and a.status = 'sealed' order by p.created_at, p.publication_id limit 1001`
      if (rows.length > 1000) throw new EnterpriseError(409, 'skill-archive-capacity', '发布列表超出读取上限，未返回不完整结果')
      return rows.map(view)
    })
  }

  read(token: string | undefined, publicationId: string, requestId: string, admin: boolean) {
    return this.identity.resourceRead(token, requestId, admin, async (db, principal) => {
      const row = await SkillPublications.current(db, principal, uuid(publicationId))
      if (admin) return { ...view(row), access: 'review-copy' as const }
      const access = row.status === 'published' ? accessFor(await SkillPublications.matched(db, principal, row.publication_id)) : undefined
      if (!access) return missing()
      return { ...view(row), access }
    })
  }

  async content(token: string | undefined, publicationId: string, expectedRevision: number, archiveDigest: string,
    selection: SkillContentSelection, requestId: string, admin: boolean, outerSignal: AbortSignal) {
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(30_000)])
    const current = (db: TransactionSql, actor: RuntimeIdentity) => (async () => {
      signal.throwIfAborted()
      const row = await SkillPublications.current(db, actor, uuid(publicationId))
      if (!admin && (row.status !== 'published' || !accessFor(await SkillPublications.matched(db, actor, row.publication_id)))) return missing()
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 2_147_483_647) return invalid('技能读取修订无效')
      if (row.revision !== expectedRevision || row.archive_digest !== archiveDigest) {
        throw new EnterpriseError(409, 'publication-changed', '技能版本或分配已变化，请重新读取内容')
      }
      return { row, actor }
    })()
    const prepared = await this.identity.resourceRead(token, requestId, admin, current)
    const key = `${prepared.actor.account.tenantId}:${prepared.actor.account.userId}`
    if ((this.contentReads.get(key) ?? 0) >= 2 || this.totalContentReads >= 8) {
      throw new EnterpriseError(429, 'skill-content-busy', '技能内容正在读取，请稍后重试', true)
    }
    this.contentReads.set(key, (this.contentReads.get(key) ?? 0) + 1); this.totalContentReads += 1
    try {
      const row = prepared.row
      const content = await readSkillContent({ archiveBytes: row.archive_bytes, expandedBytes: row.expanded_bytes, entryCount: row.entry_count }, selection,
        offset => this.identity.resourceRead(token, requestId, admin, async (db, actor) => {
          const latest = await current(db, actor)
          if (actor.sessionId !== prepared.actor.sessionId || latest.row.artifact_id !== row.artifact_id) return missing()
          const [part] = await db<{ data: Buffer }[]>`select data from haas.skill_artifact_chunks where tenant_id = ${actor.account.tenantId}
            and artifact_id = ${row.artifact_id} and chunk_offset = ${offset}`
          if (!part) throw new EnterpriseError(503, 'skill-archive-incomplete', '封存技能分块不可读取', true)
          return part.data
        }), signal)
      return await this.identity.resourceRead(token, requestId, admin, async (db, actor) => {
        const latest = await current(db, actor)
        if (actor.sessionId !== prepared.actor.sessionId || latest.row.artifact_id !== row.artifact_id) return missing()
        return { publicationId: row.publication_id, revision: row.revision, archiveDigest: row.archive_digest,
          runtimeGrant: false as const, content }
      })
    } finally {
      const count = this.contentReads.get(key)! - 1
      if (count) this.contentReads.set(key, count); else this.contentReads.delete(key)
      this.totalContentReads -= 1
    }
  }

  available(token: string | undefined, requestId: string) {
    return this.identity.resourceRead(token, requestId, false, async (db, principal) => {
      const matched = await SkillPublications.matched(db, principal)
      const allowed = new Map([...new Set(matched.map(row => row.publication_id))]
        .map(id => [id, accessFor(matched.filter(row => row.publication_id === id))] as const).filter(([, access]) => access))
      if (!allowed.size) return []
      const rows = await db<PublicationRow[]>`select p.*, a.archive_digest, a.archive_bytes, a.expanded_bytes, a.entry_count
        from haas.skill_publications p join haas.skill_artifacts a using (tenant_id, artifact_id)
        where p.tenant_id = ${principal.account.tenantId} and p.status = 'published' and a.status = 'sealed'
          and p.publication_id in ${db([...allowed.keys()])} order by p.created_at, p.publication_id limit 1001`
      if (rows.length > 1000) throw new EnterpriseError(409, 'skill-archive-capacity', '可用发布列表超出读取上限，未返回不完整结果')
      return rows.map(row => ({ ...view(row), access: allowed.get(row.publication_id)! }))
    })
  }

  review(token: string | undefined, publicationId: string, input: unknown, context: CommandContext) {
    return this.identity.resourceCommand(token, 'resource.skill.review', () => {
      const body = record(input, ['decision', 'expectedRevision', 'reason'])
      if (!['publish', 'reject', 'withdraw'].includes(body.decision as string)) return invalid('审核操作无效')
      return { publicationId: uuid(publicationId), decision: body.decision as 'publish' | 'reject' | 'withdraw',
        expectedRevision: revision(body.expectedRevision), reason: text(body.reason, 3, 500) }
    }, context, true, async (db, principal, data) => {
      const row = await SkillPublications.current(db, principal, data.publicationId)
      if (row.revision !== data.expectedRevision) throw new EnterpriseError(409, 'publication-changed', '发布状态已变化，请刷新后重试')
      if (row.status !== (data.decision === 'withdraw' ? 'published' : 'pending')) throw new EnterpriseError(409, 'invalid-review-transition', '当前状态不支持此审核操作')
      const status = data.decision === 'publish' ? 'published' : data.decision === 'reject' ? 'rejected' : 'withdrawn'
      await db`update haas.skill_publications set status = ${status}, revision = revision + 1, review_reason = ${data.reason},
        reviewed_by = ${principal.account.userId}, reviewed_at = clock_timestamp()
        where tenant_id = ${principal.account.tenantId} and publication_id = ${data.publicationId}`
      return { data: view(await SkillPublications.current(db, principal, data.publicationId)), targetId: data.publicationId, reason: data.reason }
    })
  }

  assignments(token: string | undefined, publicationId: string, requestId: string) {
    return this.identity.resourceRead(token, requestId, true, async (db, principal) => {
      const publication = view(await SkillPublications.current(db, principal, uuid(publicationId)))
      const rows = await db<AssignmentRow[]>`select * from haas.skill_assignments where tenant_id = ${principal.account.tenantId}
        and publication_id = ${publication.publicationId} order by subject_kind, subject_user_id, subject_group_id`
      return { publication, assignments: rows.map(row => ({ subjectKind: row.subject_kind,
        subjectId: row.subject_user_id ?? row.subject_group_id, effect: row.effect, active: row.active })) }
    })
  }

  assign(token: string | undefined, publicationId: string, input: unknown, context: CommandContext) {
    return this.identity.resourceCommand(token, 'resource.skill.assignment', () => {
      const all = input !== null && typeof input === 'object' && 'subjectKind' in input && input.subjectKind === 'all'
      const body = record(input, ['subjectKind', ...(all ? [] : ['subjectId']), 'effect', 'active', 'expectedRevision', 'reason'])
      if (!['user', 'group', 'all'].includes(body.subjectKind as string) || !['allow', 'deny'].includes(body.effect as string)
        || typeof body.active !== 'boolean' || body.effect === 'deny' && body.subjectKind !== 'user') return invalid('分配规则无效；显式拒绝仅支持具体用户')
      return { publicationId: uuid(publicationId), subjectKind: body.subjectKind as AssignmentRow['subject_kind'],
        subjectId: all ? null : uuid(body.subjectId), effect: body.effect as AssignmentRow['effect'], active: body.active,
        expectedRevision: revision(body.expectedRevision), reason: text(body.reason, 3, 500) }
    }, context, true, async (db, principal, data) => {
      const row = await SkillPublications.current(db, principal, data.publicationId)
      if (row.status !== 'published') throw new EnterpriseError(409, 'publication-not-published', '仅已发布版本可管理分配')
      if (row.revision !== data.expectedRevision) throw new EnterpriseError(409, 'publication-changed', '发布分配已变化，请刷新后重试')
      if (data.subjectKind === 'user') {
        const [target] = await db`select 1 from haas.users where tenant_id = ${principal.account.tenantId} and user_id = ${data.subjectId}`
        if (!target) return missing()
      } else if (data.subjectKind === 'group') {
        const [target] = await db`select 1 from haas.member_groups where tenant_id = ${principal.account.tenantId}
          and group_id = ${data.subjectId} and (status = 'active' or ${!data.active})`
        if (!target) return missing()
      }
      await db`insert into haas.skill_assignments (tenant_id, publication_id, subject_kind, subject_user_id, subject_group_id, effect, active)
        values (${principal.account.tenantId}, ${data.publicationId}, ${data.subjectKind}, ${data.subjectKind === 'user' ? data.subjectId : null},
          ${data.subjectKind === 'group' ? data.subjectId : null}, ${data.effect}, ${data.active})
        on conflict (tenant_id, publication_id, subject_kind, subject_user_id, subject_group_id) do update set effect = excluded.effect, active = excluded.active`
      await db`update haas.skill_publications set revision = revision + 1
        where tenant_id = ${principal.account.tenantId} and publication_id = ${data.publicationId}`
      return { data: { ...view(await SkillPublications.current(db, principal, data.publicationId)),
        assignment: { subjectKind: data.subjectKind, subjectId: data.subjectId, effect: data.effect, active: data.active } },
      targetId: data.publicationId, reason: JSON.stringify({ reason: data.reason, subjectKind: data.subjectKind,
        subjectId: data.subjectId, effect: data.effect, active: data.active }) }
    })
  }

  private static matched(db: TransactionSql, principal: Pick<RuntimeIdentity, 'account'>, publicationId?: string) {
    return db<AssignmentRow[]>`select a.* from haas.skill_assignments a
      left join haas.member_groups g on g.tenant_id = a.tenant_id and g.group_id = a.subject_group_id
      left join haas.group_members m on m.tenant_id = a.tenant_id and m.group_id = a.subject_group_id and m.user_id = ${principal.account.userId}
      where a.tenant_id = ${principal.account.tenantId} and (${publicationId ?? null}::uuid is null or a.publication_id = ${publicationId ?? null}) and a.active
        and (a.subject_kind = 'all' or a.subject_kind = 'user' and a.subject_user_id = ${principal.account.userId}
          or a.subject_kind = 'group' and g.status = 'active' and m.user_id is not null)`
  }

  private static async current(db: TransactionSql, principal: Pick<RuntimeIdentity, 'account'>, publicationId: string): Promise<PublicationRow> {
    const [row] = await db<PublicationRow[]>`select p.*, a.archive_digest, a.archive_bytes, a.expanded_bytes, a.entry_count
      from haas.skill_publications p join haas.skill_artifacts a using (tenant_id, artifact_id)
      where p.tenant_id = ${principal.account.tenantId} and p.publication_id = ${publicationId} and a.status = 'sealed'`
    return row ?? missing()
  }
}
