import { randomUUID } from 'node:crypto'
import type { JSONValue, TransactionSql } from 'postgres'
import { ENTERPRISE_AGENT_PRESET_PREFIX, readAgentPublicationSnapshot, type AgentPublicationSnapshot } from '@paimind/agent-builder/publication'
import { adoptedPresetId, readAdoptionInput, readAdoptionReceipt, type AgentPublicationAdoption, type AgentPublicationAdoptionInput } from '@paimind/agent-builder/adoption'
import { validateNativeExecutionInput, type NativeExecutionInput, type NativeSkillPublicationReference } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import type { CommandContext, Identity, RuntimeIdentity } from './identity.js'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import { SkillPublications } from './skill-publications.js'

interface PublicationRow {
  publication_id: string; source_user_id: string; preset_id: string; config_version: string;
  content_digest: string; snapshot: unknown; status: 'pending' | 'published' | 'rejected' | 'withdrawn';
  revision: number; submission_reason: string; review_reason: string | null
}
interface AssignmentRow { subject_kind: 'user' | 'group' | 'all'; subject_user_id: string | null; subject_group_id: string | null;
  effect: 'allow' | 'deny'; active: boolean }
type MatchedAssignment = AssignmentRow & { publication_id: string }
const accessFor = (assignments: AssignmentRow[]) => {
  if (assignments.some(rule => rule.subject_kind === 'user' && rule.effect === 'deny')) return undefined
  return assignments.some(rule => rule.subject_kind === 'user' && rule.effect === 'allow') ? 'user-allow' as const
    : assignments.some(rule => rule.subject_kind === 'group' && rule.effect === 'allow') ? 'group-allow' as const
      : assignments.some(rule => rule.subject_kind === 'all' && rule.effect === 'allow') ? 'all-allow' as const : undefined
}
export interface PublicationSelection { presetId: string; expectedVersion: string }
export type PublicationSource = (token: string | undefined, requestId: string, principal: RuntimeIdentity,
  selection: PublicationSelection) => Promise<Readonly<AgentPublicationSnapshot>>
export type PublicationAdoption = (token: string | undefined, requestId: string, principal: RuntimeIdentity,
  input: AgentPublicationAdoptionInput, mode: 'adopt' | 'verify', skillPublications?: readonly NativeSkillPublicationReference[]) => Promise<Readonly<AgentPublicationAdoption>>
const missing = (): never => { throw new EnterpriseError(404, 'not-found', '对象不存在或不可访问') }
const revision = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_646) return invalid('发布版本无效')
  return value
}
const selected = (value: unknown) => {
  const id = text(value, 1, 160)
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) return invalid('智能体编号无效')
  return id
}
const view = (row: PublicationRow) => {
  const snapshot = readAgentPublicationSnapshot(row.snapshot)
  if (snapshot.digest !== row.content_digest || snapshot.content.presetId !== row.preset_id
    || snapshot.content.configVersion !== row.config_version) throw new Error('Publication identity integrity failure')
  return { publicationId: row.publication_id, sourceUserId: row.source_user_id, presetId: row.preset_id,
    configVersion: row.config_version, digest: row.content_digest, name: snapshot.content.profile.name,
    description: snapshot.content.profile.description, status: row.status, revision: row.revision,
    submissionReason: row.submission_reason, reviewReason: row.review_reason }
}

/** Governance records only. Never writes native Presets, sessions or Skill
 * registry state, and does not claim a grant has materialized a runtime Agent. */
export class Publications {
  constructor(private readonly identity: Identity, private readonly source: PublicationSource,
    private readonly adoption?: PublicationAdoption) {}

  /** Projection of ids supplied by the original native owner. Personal and
   * shipped presets retain native ownership; reserved enterprise ids require
   * current assignment and every governed Skill dependency. No persistence,
   * authorship/admin shortcut or cached use permission is introduced. */
  static async readPresetEligibility(db: TransactionSql, principal: RuntimeIdentity, presetIds: readonly string[]): Promise<readonly string[]> {
    if (!Array.isArray(presetIds) || presetIds.length > 4096 || new Set(presetIds).size !== presetIds.length
      || presetIds.some(id => typeof id !== 'string' || !id.length || id.length > 200 || /[\u0000-\u001f\u007f]/u.test(id))) return invalid('原生智能体列表无效')
    const eligible: string[] = []
    for (const presetId of presetIds) {
      if (!presetId.startsWith(ENTERPRISE_AGENT_PRESET_PREFIX)) { eligible.push(presetId); continue }
      const compact = presetId.slice(ENTERPRISE_AGENT_PRESET_PREFIX.length)
      if (!/^[a-f0-9]{32}$/u.test(compact)) continue
      const publicationId = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
      // The adoption owner's canonical conversion is the only accepted form.
      try { if (adoptedPresetId(publicationId) !== presetId) continue } catch { continue }
      try {
        await Publications.assignedContent(db, principal, await Publications.current(db, principal, publicationId))
        eligible.push(presetId)
      } catch (error) {
        if (error instanceof EnterpriseError && error.code === 'not-found') continue
        throw error // Database/integrity failure is unavailable, never an empty roster.
      }
    }
    return Object.freeze(eligible)
  }

  /** Read-only execution decision inside the caller's existing identity and
   * revocation transaction. The native owner has verified its adopted bytes;
   * this owner checks current publication and effective assignment. Neither
   * an author/reviewer copy nor an earlier adoption grants execution. */
  static async authorizeExecution(db: TransactionSql, principal: RuntimeIdentity, input: NativeExecutionInput): Promise<void> {
    validateNativeExecutionInput(input)
    await SkillPublications.authorizeExecution(db, principal, input.skills)
    const proof = input.publication
    if (!proof) return // Personal presets still require exact login/cell checks.
    if (proof.tenantId !== principal.account.tenantId || input.presetId !== adoptedPresetId(proof.publicationId)) return missing()
    const assigned = await Publications.assignedContent(db, principal, await Publications.current(db, principal, proof.publicationId))
    if (assigned.sourceUserId !== proof.sourceUserId || assigned.digest !== proof.contentDigest) return missing()
    // The Agent governance owner fixes publication ids; native Skill proofs
    // must match those ids, not merely an identical name or package digest.
    for (const required of assigned.skillPublications) {
      if (!input.skills.some(reference => reference.publicationId === required.publicationId
        && reference.name === required.name && reference.packageDigest === required.packageDigest)) return missing()
    }
  }

  submit(token: string | undefined, input: unknown, context: CommandContext) {
    return this.identity.resourceCommand(token, 'resource.submit', () => {
      const body = record(input, ['presetId', 'expectedVersion', 'reason'])
      return { presetId: selected(body.presetId), expectedVersion: text(body.expectedVersion, 1, 160), reason: text(body.reason, 3, 500) }
    }, context, false, async (db, principal, data) => {
      // The source runs inside the bounded identity transaction. Replay does
      // not re-read a changed/deleted draft, but always rechecks current identity.
      const selection: PublicationSelection = { presetId: data.presetId, expectedVersion: data.expectedVersion }
      const snapshot = readAgentPublicationSnapshot(await this.source(token, context.requestId, principal, selection))
      if (snapshot.content.presetId !== data.presetId || snapshot.content.configVersion !== data.expectedVersion) {
        throw new EnterpriseError(409, 'source-changed', '智能体来源或版本已变化，请重新提交')
      }
      const [capacity] = await db<{ count: number }[]>`select count(*)::int as count from haas.agent_publications where tenant_id = ${principal.account.tenantId}`
      if (!capacity || capacity.count >= 1000) throw new EnterpriseError(409, 'publication-capacity', '当前最多保留 1000 个发布版本，未截断历史')
      const [row] = await db<PublicationRow[]>`insert into haas.agent_publications
        (tenant_id, publication_id, source_user_id, preset_id, config_version, content_digest, snapshot, submission_reason)
        values (${principal.account.tenantId}, ${randomUUID()}, ${principal.account.userId}, ${data.presetId}, ${data.expectedVersion},
          ${snapshot.digest}, ${db.json(snapshot as unknown as JSONValue)}, ${data.reason}) returning *`
      if (!row) throw new Error('Missing publication')
      return { data: view(row), targetId: row.publication_id, reason: data.reason }
    })
  }

  list(token: string | undefined, requestId: string, admin: boolean) {
    return this.identity.resourceRead(token, requestId, admin, async (db, principal) => {
      const rows = await db<PublicationRow[]>`select * from haas.agent_publications where tenant_id = ${principal.account.tenantId}
        and (${admin} or source_user_id = ${principal.account.userId}) order by created_at, publication_id limit 1001`
      if (rows.length > 1000) throw new EnterpriseError(409, 'publication-capacity', '发布列表超出读取上限，未返回不完整结果')
      return rows.map(view)
    })
  }

  /** Published content available for adoption, not proof of a runtime grant.
   * Authorship and administrator authority alone never populate this catalog. */
  available(token: string | undefined, requestId: string) {
    return this.identity.resourceRead(token, requestId, false, async (db, principal) => {
      const assignments = await Publications.matchedAssignments(db, principal)
      const grouped = new Map<string, AssignmentRow[]>()
      for (const rule of assignments) {
        const rules = grouped.get(rule.publication_id) ?? []
        rules.push(rule); grouped.set(rule.publication_id, rules)
      }
      const allowed = new Map([...grouped].flatMap(([id, rules]) => {
        const access = accessFor(rules)
        return access ? [[id, access] as const] : []
      }))
      if (!allowed.size) return []
      const rows = await db<PublicationRow[]>`select * from haas.agent_publications
        where tenant_id = ${principal.account.tenantId} and status = 'published'
          and publication_id in ${db([...allowed.keys()])} order by created_at, publication_id limit 1001`
      if (rows.length > 1000) throw new EnterpriseError(409, 'publication-capacity', '可用发布列表超出读取上限，未返回不完整结果')
      return rows.map(row => ({ ...view(row), access: allowed.get(row.publication_id)! }))
    })
  }

  assignments(token: string | undefined, publicationId: string, requestId: string) {
    return this.identity.resourceRead(token, requestId, true, async (db, principal) => {
      const publication = view(await Publications.current(db, principal, uuid(publicationId)))
      const rows = await db<AssignmentRow[]>`select * from haas.resource_assignments
        where tenant_id = ${principal.account.tenantId} and publication_id = ${publication.publicationId}
        order by subject_kind, subject_user_id, subject_group_id`
      return { publication, assignments: rows.map(row => ({ subjectKind: row.subject_kind,
        subjectId: row.subject_user_id ?? row.subject_group_id, effect: row.effect, active: row.active })) }
    })
  }

  review(token: string | undefined, publicationId: string, input: unknown, context: CommandContext) {
    return this.identity.resourceCommand(token, 'resource.review', () => {
      const hasSkills = input !== null && typeof input === 'object' && 'skillPublications' in input
      const body = record(input, ['decision', 'expectedRevision', 'reason', ...(hasSkills ? ['skillPublications'] : [])])
      if (!['publish', 'reject', 'withdraw'].includes(body.decision as string)) return invalid('审核操作无效')
      let skillPublications: { name: string; publicationId: string }[] | undefined
      if (hasSkills) {
        if (body.decision !== 'publish' || !Array.isArray(body.skillPublications) || body.skillPublications.length > 40) return invalid('技能依赖选择无效')
        skillPublications = body.skillPublications.map(value => {
          const row = record(value, ['name', 'publicationId']), name = text(row.name, 1, 255)
          if (!/^[a-z0-9][a-z0-9-]*$/u.test(name)) return invalid('技能依赖名称无效')
          return { name, publicationId: uuid(row.publicationId) }
        }).sort((a, b) => a.name.localeCompare(b.name))
        if (new Set(skillPublications.map(row => row.name)).size !== skillPublications.length
          || new Set(skillPublications.map(row => row.publicationId)).size !== skillPublications.length) return invalid('技能依赖不能重复')
      }
      return { publicationId: uuid(publicationId), decision: body.decision as 'publish' | 'reject' | 'withdraw',
        expectedRevision: revision(body.expectedRevision), reason: text(body.reason, 3, 500),
        ...(skillPublications === undefined ? {} : { skillPublications }) }
    }, context, true, async (db, principal, data) => {
      const row = await Publications.current(db, principal, data.publicationId)
      if (row.revision !== data.expectedRevision) throw new EnterpriseError(409, 'publication-changed', '发布状态已变化，请刷新后重试')
      if (row.status !== (data.decision === 'withdraw' ? 'published' : 'pending')) throw new EnterpriseError(409, 'invalid-review-transition', '当前状态不支持此审核操作')
      const snapshot = readAgentPublicationSnapshot(row.snapshot); view(row)
      if (data.decision === 'publish') {
        const selected = data.skillPublications ?? []
        if (selected.length !== snapshot.content.dependencies.length
          || selected.some(row => !snapshot.content.dependencies.some(dependency => dependency.name === row.name))) {
          throw new EnterpriseError(409, 'skill-publication-required', '请为每个依赖明确选择对应的已发布技能版本')
        }
        for (const selection of selected) {
          const version = await SkillPublications.readPublicationVersion(db, principal, selection.publicationId)
          const dependency = snapshot.content.dependencies.find(row => row.name === selection.name)!
          if (version.status !== 'published' || version.reference.name !== dependency.name || version.reference.packageDigest !== dependency.digest) {
            throw new EnterpriseError(409, 'skill-publication-required', '所选技能未发布或不是智能体引用的准确版本')
          }
          await db`insert into haas.agent_skill_dependencies (tenant_id, publication_id, skill_name, skill_publication_id)
            values (${principal.account.tenantId}, ${data.publicationId}, ${selection.name}, ${selection.publicationId})`
        }
      }
      const status = data.decision === 'publish' ? 'published' : data.decision === 'reject' ? 'rejected' : 'withdrawn'
      const [updated] = await db<PublicationRow[]>`update haas.agent_publications set status = ${status}, revision = revision + 1,
        review_reason = ${data.reason}, reviewed_by = ${principal.account.userId}, reviewed_at = clock_timestamp()
        where tenant_id = ${principal.account.tenantId} and publication_id = ${data.publicationId} returning *`
      if (!updated) throw new Error('Missing reviewed publication')
      return { data: view(updated), targetId: data.publicationId, reason: data.reason }
    })
  }

  assign(token: string | undefined, publicationId: string, input: unknown, context: CommandContext) {
    return this.identity.resourceCommand(token, 'resource.assignment', () => {
      const all = input !== null && typeof input === 'object' && 'subjectKind' in input && input.subjectKind === 'all'
      const body = record(input, ['subjectKind', ...(all ? [] : ['subjectId']), 'effect', 'active', 'expectedRevision', 'reason'])
      if (!['user', 'group', 'all'].includes(body.subjectKind as string) || !['allow', 'deny'].includes(body.effect as string)
        || typeof body.active !== 'boolean' || body.effect === 'deny' && body.subjectKind !== 'user') return invalid('分配规则无效；显式拒绝仅支持具体用户')
      return { publicationId: uuid(publicationId), subjectKind: body.subjectKind as AssignmentRow['subject_kind'],
        subjectId: all ? null : uuid(body.subjectId), effect: body.effect as AssignmentRow['effect'],
        active: body.active, expectedRevision: revision(body.expectedRevision), reason: text(body.reason, 3, 500) }
    }, context, true, async (db, principal, data) => {
      const row = await Publications.current(db, principal, data.publicationId)
      view(row)
      if (row.status !== 'published') throw new EnterpriseError(409, 'publication-not-published', '仅已发布版本可管理分配')
      if (row.revision !== data.expectedRevision) throw new EnterpriseError(409, 'publication-changed', '发布分配已变化，请刷新后重试')
      if (data.subjectKind === 'user') {
        const [target] = await db`select 1 from haas.users where tenant_id = ${principal.account.tenantId} and user_id = ${data.subjectId}`
        if (!target) return missing()
      } else if (data.subjectKind === 'group') {
        const [target] = await db`select 1 from haas.member_groups where tenant_id = ${principal.account.tenantId} and group_id = ${data.subjectId}
          and (status = 'active' or ${!data.active})`
        if (!target) return missing()
      }
      await db`insert into haas.resource_assignments (tenant_id, publication_id, subject_kind, subject_user_id, subject_group_id, effect, active)
        values (${principal.account.tenantId}, ${data.publicationId}, ${data.subjectKind}, ${data.subjectKind === 'user' ? data.subjectId : null},
          ${data.subjectKind === 'group' ? data.subjectId : null}, ${data.effect}, ${data.active})
        on conflict (tenant_id, publication_id, subject_kind, subject_user_id, subject_group_id) do update set effect = excluded.effect, active = excluded.active`
      const [updated] = await db<PublicationRow[]>`update haas.agent_publications set revision = revision + 1
        where tenant_id = ${principal.account.tenantId} and publication_id = ${data.publicationId} returning *`
      if (!updated) throw new Error('Missing assignment revision')
      return { data: { ...view(updated), assignment: { subjectKind: data.subjectKind, subjectId: data.subjectId, effect: data.effect, active: data.active } },
        targetId: data.publicationId, reason: JSON.stringify({ reason: data.reason, subjectKind: data.subjectKind, subjectId: data.subjectId, effect: data.effect, active: data.active }) }
    })
  }

  read(token: string | undefined, publicationId: string, requestId: string) {
    return this.identity.resourceRead(token, requestId, false, async (db, principal) => {
      const row = await Publications.current(db, principal, uuid(publicationId))
      const summary = view(row)
      if (principal.account.role === 'admin' || row.source_user_id === principal.account.userId) {
        return { ...summary, snapshot: readAgentPublicationSnapshot(row.snapshot),
          skillPublications: await Publications.skillDependencies(db, principal, row), access: 'review-copy' as const }
      }
      return Publications.assignedContent(db, principal, row)
    })
  }

  /** Current assigned content, including for administrators and authors. One
   * identity/revocation transaction owns both the decision and exact snapshot;
   * this response is never a transferable or cached execution permission. */
  readAssigned(token: string | undefined, publicationId: string, requestId: string) {
    return this.identity.resourceRead(token, requestId, false, async (db, principal) =>
      Publications.assignedContent(db, principal, await Publications.current(db, principal, uuid(publicationId))))
  }

  /** Existing publication id is the versioned API's releaseId; no new release
   * catalogue. Admin and author still need an explicit current assignment. */
  static async sessionRelease(db: TransactionSql, principal: RuntimeIdentity, input: { releaseId: string; agentId: string; configVersion: string }) {
    const current = await Publications.assignedContent(db, principal, await Publications.current(db, principal, input.releaseId))
    if (current.snapshot.content.agentId !== input.agentId || current.configVersion !== input.configVersion) {
      throw new EnterpriseError(409, 'session-release-changed', '智能体或发布配置版本不匹配，请重新读取授权目录')
    }
    return current
  }

  /** Explicit use preparation, not publication authority or an execution
   * grant. Native bytes remain owned by the selected member's original owner.
   * DB failure cannot roll those bytes back: a retry reauthorizes and asks that
   * same owner to confirm its immutable target instead of copying/deleting it. */
  adopt(token: string | undefined, publicationId: string, input: unknown, context: CommandContext) {
    const normalize = () => {
      const body = record(input, ['expectedRevision', 'expectedDigest'])
      const expectedDigest = text(body.expectedDigest, 71, 71)
      if (!/^sha256:[a-f0-9]{64}$/u.test(expectedDigest)) return invalid('发布内容摘要无效')
      return { publicationId: uuid(publicationId), expectedRevision: revision(body.expectedRevision), expectedDigest }
    }
    const prepare = async (db: TransactionSql, principal: RuntimeIdentity, data: ReturnType<typeof normalize>, mode: 'adopt' | 'verify') => {
      const current = await Publications.assignedContent(db, principal, await Publications.current(db, principal, data.publicationId))
      if (current.revision !== data.expectedRevision || current.digest !== data.expectedDigest) {
        throw new EnterpriseError(409, 'publication-changed', '发布内容或分配已变化，请刷新后重试')
      }
      if (!this.adoption) throw new EnterpriseError(503, 'publication-adoption-unavailable', '原生采用尚未接入', true)
      const selected = readAdoptionInput({ tenantId: principal.account.tenantId, publicationId: current.publicationId,
        sourceUserId: current.sourceUserId, snapshot: current.snapshot })
      const required = current.skillPublications.map(({ status: _status, ...reference }) => reference)
      const receipt = readAdoptionReceipt(await this.adoption(token, context.requestId, principal, selected, mode, required))
      if (receipt.tenantId !== selected.tenantId || receipt.publicationId !== selected.publicationId
        || receipt.sourceUserId !== selected.sourceUserId || receipt.snapshot.digest !== selected.snapshot.digest) {
        throw new EnterpriseError(502, 'publication-adoption-unconfirmed', '无法确认准确采用结果；保留原资源，请刷新后重试', true)
      }
      // Minimal command evidence, never a second preset or permission record.
      return { publicationId: receipt.publicationId, presetId: receipt.presetId, configVersion: receipt.configVersion,
        digest: receipt.snapshot.digest, nativeCompositionDigest: receipt.nativeCompositionDigest,
        adopted: true as const, runtimeGrant: false as const }
    }
    return this.identity.resourceCommand(token, 'resource.adopt', normalize, context, false,
      async (db, principal, data) => ({ data: await prepare(db, principal, data, 'adopt'),
        targetId: data.publicationId, reason: '采用明确分配的不可变智能体版本；不授予运行权限' }),
      async (db, principal, data, previous) => {
        const current = await prepare(db, principal, data, 'verify')
        if (Object.keys(previous).sort().join(',') !== Object.keys(current).sort().join(',')
          || Object.keys(current).some(key => current[key as keyof typeof current] !== previous[key as keyof typeof current])) {
          throw new EnterpriseError(409, 'publication-adoption-changed', '原生采用回执已变化，不能重放旧结果；请重新确认', true)
        }
      })
  }

  private static async assignedContent(db: TransactionSql, principal: RuntimeIdentity, row: PublicationRow) {
    if (row.status !== 'published') return missing()
    const access = accessFor(await Publications.matchedAssignments(db, principal, row.publication_id))
    if (!access) return missing()
    const skillPublications = await Publications.skillDependencies(db, principal, row)
    await SkillPublications.authorizeExecution(db, principal, skillPublications.map(({ status: _status, ...reference }) => reference))
    return { ...view(row), snapshot: readAgentPublicationSnapshot(row.snapshot), skillPublications, access }
  }

  private static async skillDependencies(db: TransactionSql, principal: RuntimeIdentity, row: PublicationRow) {
    const snapshot = readAgentPublicationSnapshot(row.snapshot)
    const edges = await db<{ skill_name: string; skill_publication_id: string }[]>`select skill_name, skill_publication_id
      from haas.agent_skill_dependencies where tenant_id = ${principal.account.tenantId} and publication_id = ${row.publication_id}
      order by skill_name`
    if ((row.status === 'pending' || row.status === 'rejected') && !edges.length) return []
    if (edges.length !== snapshot.content.dependencies.length) return missing()
    const required = []
    for (const edge of edges) {
      const version = await SkillPublications.readPublicationVersion(db, principal, edge.skill_publication_id)
      const dependency = snapshot.content.dependencies.find(value => value.name === edge.skill_name)
      if (!dependency || version.reference.name !== dependency.name || version.reference.packageDigest !== dependency.digest) return missing()
      required.push(Object.freeze({ ...version.reference, status: version.status }))
    }
    return Object.freeze(required)
  }

  private static matchedAssignments(db: TransactionSql, principal: RuntimeIdentity, publicationId?: string) {
    return db<MatchedAssignment[]>`select a.* from haas.resource_assignments a
      left join haas.member_groups g on g.tenant_id = a.tenant_id and g.group_id = a.subject_group_id
      left join haas.group_members m on m.tenant_id = a.tenant_id and m.group_id = a.subject_group_id and m.user_id = ${principal.account.userId}
      where a.tenant_id = ${principal.account.tenantId} and (${publicationId ?? null}::uuid is null or a.publication_id = ${publicationId ?? null}) and a.active
        and (a.subject_kind = 'all' or a.subject_kind = 'user' and a.subject_user_id = ${principal.account.userId}
          or a.subject_kind = 'group' and g.status = 'active' and m.user_id is not null)`
  }

  private static async current(db: TransactionSql, principal: RuntimeIdentity, publicationId: string): Promise<PublicationRow> {
    const [row] = await db<PublicationRow[]>`select * from haas.agent_publications where tenant_id = ${principal.account.tenantId}
      and publication_id = ${publicationId}`
    return row ?? missing()
  }
}
