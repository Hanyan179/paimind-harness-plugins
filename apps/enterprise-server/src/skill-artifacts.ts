import { createHash, randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import { readSkillPublicationExport, SKILL_PUBLICATION_CHUNK_BYTES, SKILL_PUBLICATION_EXPORT_TTL_MS,
  SKILL_PUBLICATION_MAX_ARCHIVE_BYTES, type SkillPublicationExport, type SkillPublicationSelection } from '@paimind/skill-market/publication'
import type { ResourcePreparationKey, RuntimeIdentity } from './identity.js'
import { EnterpriseError } from './errors.js'

export type SkillPublicationSource = (token: string | undefined, requestId: string, principal: RuntimeIdentity,
  selection: SkillPublicationSelection, sink: (bytes: Buffer, offset: number, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal) => Promise<Readonly<SkillPublicationExport>>
export interface SkillArtifact {
  tenant_id: string; artifact_id: string; source_user_id: string; submission_key: string; request_digest: string;
  skill_name: string; package_digest: string; capture_generation: string; status: 'staging' | 'sealed'; next_offset: number;
  archive_digest: string | null; archive_bytes: number | null; expanded_bytes: number | null; entry_count: number | null
}
const expired = () => new EnterpriseError(409, 'skill-capture-changed', '技能捕获已过期或被重试替换，请重试原请求', true)

/** Unpublished capture bytes and immutable governance archives, never a second
 * editable Skill repository. Only an exact unsealed generation is disposable. */
export class SkillArtifacts {
  constructor(private readonly sql: Sql) {}

  async reserve(db: TransactionSql, principal: RuntimeIdentity, selection: SkillPublicationSelection, key: ResourcePreparationKey): Promise<SkillArtifact> {
    const tenantId = principal.account.tenantId, userId = principal.account.userId
    const [existing] = await db<(SkillArtifact & { fresh: boolean })[]>`select *, capture_deadline > clock_timestamp() as fresh
      from haas.skill_artifacts where tenant_id = ${tenantId} and source_user_id = ${userId} and submission_key = ${key.key} for update`
    if (existing) {
      if (existing.request_digest !== key.requestDigest || existing.skill_name !== selection.skillId || existing.package_digest !== selection.expectedDigest) {
        throw new EnterpriseError(409, 'idempotency-conflict', '原捕获请求与重试内容不一致')
      }
      if (existing.status === 'sealed') return existing
      if (existing.fresh) throw new EnterpriseError(409, 'skill-capture-in-progress', '相同请求正在捕获，请稍后重试', true)
      // An explicit same-request retry fences the old writer, not a background
      // sweep. The parent row lock serializes this with every chunk and seal.
      await db`delete from haas.skill_artifact_chunks where tenant_id = ${tenantId} and artifact_id = ${existing.artifact_id}`
      const [renewed] = await db<SkillArtifact[]>`update haas.skill_artifacts set capture_generation = ${randomUUID()}, next_offset = 0,
        capture_deadline = clock_timestamp() + ${SKILL_PUBLICATION_EXPORT_TTL_MS} * interval '1 millisecond'
        where tenant_id = ${tenantId} and artifact_id = ${existing.artifact_id} returning *`
      if (!renewed) throw expired()
      return renewed
    }
    // prepareResourceCommand already holds the common tenant mutation lock.
    const [capacity] = await db<{ count: number; bytes: number }[]>`select count(*)::int as count,
      coalesce(sum(case when status = 'sealed' then archive_bytes else ${SKILL_PUBLICATION_MAX_ARCHIVE_BYTES} end), 0)::float8 as bytes
      from haas.skill_artifacts where tenant_id = ${tenantId}`
    if (!capacity || capacity.count >= 1000 || capacity.bytes + SKILL_PUBLICATION_MAX_ARCHIVE_BYTES > 2 * 1024 ** 3) {
      throw new EnterpriseError(409, 'skill-archive-capacity', '技能归档容量不足；未删除或截断历史')
    }
    const [row] = await db<SkillArtifact[]>`insert into haas.skill_artifacts
      (tenant_id, artifact_id, source_user_id, submission_key, request_digest, skill_name, package_digest, capture_generation, capture_deadline)
      values (${tenantId}, ${randomUUID()}, ${userId}, ${key.key}, ${key.requestDigest}, ${selection.skillId}, ${selection.expectedDigest},
        ${randomUUID()}, clock_timestamp() + ${SKILL_PUBLICATION_EXPORT_TTL_MS} * interval '1 millisecond') returning *`
    if (!row) throw new Error('Missing skill capture reservation')
    return row
  }

  private async active(db: TransactionSql, capture: SkillArtifact) {
    const [row] = await db<SkillArtifact[]>`select * from haas.skill_artifacts where tenant_id = ${capture.tenant_id}
      and artifact_id = ${capture.artifact_id} and capture_generation = ${capture.capture_generation}
      and status = 'staging' and capture_deadline > clock_timestamp() for update`
    if (!row) throw expired()
    return row
  }

  private async abandon(capture: SkillArtifact): Promise<void> {
    await this.sql.begin(async db => {
      const [row] = await db`select 1 from haas.skill_artifacts where tenant_id = ${capture.tenant_id}
        and artifact_id = ${capture.artifact_id} and capture_generation = ${capture.capture_generation} and status = 'staging' for update`
      if (!row) return // A sealed/committed or newer generation is not ours to delete.
      await db`delete from haas.skill_artifact_chunks where tenant_id = ${capture.tenant_id} and artifact_id = ${capture.artifact_id}`
      await db`update haas.skill_artifacts set next_offset = 0, capture_deadline = clock_timestamp()
        where tenant_id = ${capture.tenant_id} and artifact_id = ${capture.artifact_id}`
    })
  }

  async capture(capture: SkillArtifact, source: SkillPublicationSource, token: string | undefined,
    requestId: string, principal: RuntimeIdentity, outerSignal: AbortSignal): Promise<void> {
    if (capture.status === 'sealed') return
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(SKILL_PUBLICATION_EXPORT_TTL_MS)])
    const hash = createHash('sha256')
    let received = 0, writing = false
    try {
      signal.throwIfAborted()
      const descriptor = readSkillPublicationExport(await source(token, requestId, principal,
        { skillId: capture.skill_name, expectedDigest: capture.package_digest }, async (input, offset, sourceSignal) => {
          signal.throwIfAborted(); sourceSignal.throwIfAborted()
          if (writing || !Buffer.isBuffer(input) || input.length < 1 || input.length > SKILL_PUBLICATION_CHUNK_BYTES
            || offset !== received || offset % SKILL_PUBLICATION_CHUNK_BYTES !== 0
            || received + input.length > SKILL_PUBLICATION_MAX_ARCHIVE_BYTES) throw new Error('Invalid skill archive chunk order or size')
          writing = true
          const bytes = Buffer.from(input)
          try {
            await this.sql.begin(async db => {
              const row = await this.active(db, capture)
              signal.throwIfAborted(); sourceSignal.throwIfAborted()
              if (row.next_offset !== offset) throw expired()
              await db`insert into haas.skill_artifact_chunks (tenant_id, artifact_id, chunk_offset, data)
                values (${capture.tenant_id}, ${capture.artifact_id}, ${offset}, ${bytes})`
              await db`update haas.skill_artifacts set next_offset = ${offset + bytes.length}
                where tenant_id = ${capture.tenant_id} and artifact_id = ${capture.artifact_id}`
            })
            received += bytes.length; hash.update(bytes)
          } finally { writing = false }
          signal.throwIfAborted(); sourceSignal.throwIfAborted()
        }, signal))
      signal.throwIfAborted()
      if (writing || descriptor.name !== capture.skill_name || descriptor.packageDigest !== capture.package_digest
        || received !== descriptor.archiveBytes || `sha256:${hash.digest('hex')}` !== descriptor.archiveDigest) {
        throw new Error('Skill archive integrity mismatch')
      }
      await this.sql.begin(async db => {
        await this.active(db, capture); signal.throwIfAborted()
        // The DB trigger independently verifies the complete contiguous chunk
        // set. The sink hash binds those inserted bytes to the source envelope.
        await db`update haas.skill_artifacts set status = 'sealed', archive_digest = ${descriptor.archiveDigest},
          archive_bytes = ${descriptor.archiveBytes}, expanded_bytes = ${descriptor.expandedBytes}, entry_count = ${descriptor.entryCount}, sealed_at = clock_timestamp()
          where tenant_id = ${capture.tenant_id} and artifact_id = ${capture.artifact_id}`
      })
    } catch (error) {
      // If sealing committed but its reply was lost, this conditional cleanup
      // preserves it. If DB cleanup is unavailable, retain everything and deny.
      try { await this.abandon(capture) } catch {
        throw new EnterpriseError(503, 'skill-capture-cleanup-unconfirmed', '无法确认技能暂存清理；保留记录，请重试原请求', true)
      }
      throw error
    }
  }
}
