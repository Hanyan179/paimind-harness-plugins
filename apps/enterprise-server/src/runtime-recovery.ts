import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Sql, TransactionSql } from 'postgres'
import { EnterpriseError, uuid } from './errors.js'
import type { PrivateRuntimeCell } from './runtime-bindings.js'
import { readRuntimeResources, type RuntimeResources } from './runtime-resources.js'

interface RecoveryRow {
  tenant_id: string; request_id: string; actor_user_id: string; login_session_id: string;
  target_user_id: string; target_pin: PrivateRuntimeCell; resource_policy: RuntimeResources;
  reason: string; outcome: 'queued' | 'executing' | 'applied' | 'rejected' | 'unconfirmed';
  claim_id: string | null; result: object | null
}
export interface RecoveryClaim { tenantId: string; requestId: string; claimId: string; pin: PrivateRuntimeCell; resources: RuntimeResources }
const conflict = () => new EnterpriseError(409, 'runtime-recovery-changed', '恢复请求身份、配额或准确运行版本已变化')
const ownershipKeys = ['cellId','tenantId','userId','role','origin','containerId','imageId','volumeName','policyDigest'] as const

/** No Docker client or execution here. Durable single-claim boundary consumed
 * exclusively by the existing operator's stopped-member recovery lane. */
export class RuntimeRecoveryOperator {
  constructor(private readonly sql: Sql) {}
  private async lock(db: TransactionSql, tenantId: string) {
    await db`select pg_advisory_xact_lock(hashtextextended(${`haas:identity:${tenantId}`},0))`
  }
  private async authority(db: TransactionSql, row: RecoveryRow): Promise<void> {
    const [actor] = await db`select 1 from haas.users u join haas.tenants t using (tenant_id)
      join haas.login_sessions s using (tenant_id,user_id)
      where u.tenant_id=${row.tenant_id} and u.user_id=${row.actor_user_id} and u.role='admin' and u.status='active'
        and t.status='active' and s.session_id=${row.login_session_id} and s.revoked_at is null and s.expires_at>clock_timestamp()`
    const [target] = await db`select 1 from haas.users where tenant_id=${row.tenant_id} and user_id=${row.target_user_id}
      and status='active' and role=${row.target_pin.role}`
    const policy = await readRuntimeResources(db,row.tenant_id,row.target_user_id)
    if (!actor || !target || policy.desiredState!=='running' || !isDeepStrictEqual(policy,row.resource_policy)) throw conflict()
  }
  private async binding(db: TransactionSql, pin: PrivateRuntimeCell, ready: boolean) {
    const [row] = await db`select 1 from haas.runtime_bindings where tenant_id=${pin.tenantId} and user_id=${pin.userId}
      and cell_id=${pin.cellId} and revision=${pin.revision} and origin=${pin.origin} and container_id=${pin.containerId}
      and image_id=${pin.imageId} and volume_name=${pin.volumeName} and policy_digest=${pin.policyDigest}
      and isolation_mode='container-managed' and status=${ready?'ready':'suspended'}
      and (lease_expires_at>clock_timestamp())=${ready}`
    if (!row) throw conflict()
  }
  private async audit(db: TransactionSql,row: RecoveryRow,action: string,outcome: 'succeeded'|'denied'|'failed',reason: string) {
    await db`insert into haas.audit_events (event_id,tenant_id,actor_user_id,action,outcome,request_id,target_id,reason)
      values (${randomUUID()},${row.tenant_id},${row.actor_user_id},${action},${outcome},${row.request_id},${row.target_user_id},${reason})`
  }
  async claim(stopped: PrivateRuntimeCell): Promise<RecoveryClaim | null> {
    return this.sql.begin(async db => {
      await this.lock(db,stopped.tenantId)
      const [row] = await db<RecoveryRow[]>`select * from haas.runtime_recovery_requests
        where tenant_id=${stopped.tenantId} and target_user_id=${stopped.userId} and outcome='queued' for update`
      if (!row) return null
      // Database revision is the stopped/fenced revision; the controller still
      // holds the exact original pin. All other identities must be unchanged.
      if (ownershipKeys.some(key=>row.target_pin[key]!==stopped[key])) throw conflict()
      try { await this.authority(db,row); await this.binding(db,row.target_pin,false) }
      catch (error) {
        if (!(error instanceof EnterpriseError)) throw error
        await db`update haas.runtime_recovery_requests set outcome='rejected',result=${db.json({code:'precondition-changed',effect:'not-started'})},
          finished_at=clock_timestamp() where tenant_id=${row.tenant_id} and request_id=${row.request_id}`
        await this.audit(db,row,'runtime.recovery.rejected','denied','precondition-changed')
        return null
      }
      const claimId=randomUUID()
      await db`update haas.runtime_recovery_requests set outcome='executing',claim_id=${claimId},claimed_at=clock_timestamp()
        where tenant_id=${row.tenant_id} and request_id=${row.request_id}`
      await this.audit(db,row,'runtime.recovery.claimed','succeeded','exact-stopped-cell')
      return {tenantId:row.tenant_id,requestId:row.request_id,claimId,pin:row.target_pin,resources:row.resource_policy}
    })
  }
  /** Called inside RuntimeAdmission's tenant transaction immediately before
   * replacement commit; current login/policy cannot race that commit. */
  async verifyInTransaction(db: TransactionSql, claim: RecoveryClaim, next?: PrivateRuntimeCell): Promise<void> {
    const [row] = await db<RecoveryRow[]>`select * from haas.runtime_recovery_requests
      where tenant_id=${claim.tenantId} and request_id=${uuid(claim.requestId)} and outcome='executing' and claim_id=${uuid(claim.claimId)}`
    if (!row || !isDeepStrictEqual(row.target_pin,claim.pin) || !isDeepStrictEqual(row.resource_policy,claim.resources)) throw conflict()
    await this.authority(db,row)
    if (next) {
      for (const key of ['cellId','tenantId','userId','role','volumeName','imageId','policyDigest'] as const) if (next[key]!==claim.pin[key]) throw conflict()
      if (next.containerId===claim.pin.containerId || next.revision===claim.pin.revision) throw conflict()
    }
    await this.binding(db,next??row.target_pin,Boolean(next))
    if (next) {
      const [observed] = await db`select 1 from haas.admitted_runtime_bindings
        where cell_id=${next.cellId} and resource_observation=${db.json({...claim.resources})}`
      if (!observed) throw conflict()
    }
  }
  async verify(claim: RecoveryClaim): Promise<void> {
    await this.sql.begin(async db=>{await this.lock(db,claim.tenantId);await this.verifyInTransaction(db,claim)})
  }
  async complete(claim: RecoveryClaim,next: PrivateRuntimeCell): Promise<void> {
    await this.sql.begin(async db=>{
      await this.lock(db,claim.tenantId);await this.verifyInTransaction(db,claim,next)
      await db`update haas.runtime_recovery_requests set outcome='applied',result=${db.json({cellRevision:next.revision,resourceRevision:claim.resources.revision,effect:'verified-replacement'})},
        finished_at=clock_timestamp() where tenant_id=${claim.tenantId} and request_id=${claim.requestId} and claim_id=${claim.claimId}`
      const [row]=await db<RecoveryRow[]>`select * from haas.runtime_recovery_requests where tenant_id=${claim.tenantId} and request_id=${claim.requestId}`
      await this.audit(db,row!,'runtime.recovery.confirmed','succeeded','verified-replacement-and-gateway-acknowledgement')
    })
  }
  async unconfirmed(claim: RecoveryClaim): Promise<void> {
    await this.sql.begin(async db=>{
      await this.lock(db,claim.tenantId)
      const [row]=await db<RecoveryRow[]>`update haas.runtime_recovery_requests set outcome='unconfirmed',
        result=${db.json({effect:'unknown',retry:'operator-inspection-required'})},finished_at=clock_timestamp()
        where tenant_id=${claim.tenantId} and request_id=${claim.requestId} and claim_id=${claim.claimId} and outcome='executing' returning *`
      if(row)await this.audit(db,row,'runtime.recovery.unconfirmed','failed','effect-unknown-no-automatic-retry')
    })
  }
}
