import type { TransactionSql } from 'postgres'
import type { CommandContext, Identity } from './identity.js'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import { parseRuntimeResources, readRuntimeResources } from './runtime-resources.js'
import type { PrivateRuntimeCell } from './runtime-bindings.js'

/** Administrative intent and audited state only. No Docker authority, native
 * object store, scheduler or second runtime. Saving never claims enforcement. */
export class RuntimeManagement {
  constructor(private readonly identity: Identity) {}
  async requestRecovery(token: string | undefined, input: unknown, context: CommandContext) {
    return this.identity.resourceCommand(token, 'runtime.recovery.request', () => {
      const body=record(input,['targetUserId','expectedCellRevision','expectedResourceRevision','reason','confirmed'])
      if(body.confirmed!==true)return invalid('请确认以准确当前配额恢复已停止单元；将保留原用户数据')
      if(!Number.isSafeInteger(body.expectedResourceRevision)||Number(body.expectedResourceRevision)<0||Number(body.expectedResourceRevision)>2147483647)return invalid('资源策略版本无效')
      return {targetUserId:uuid(body.targetUserId),expectedCellRevision:uuid(body.expectedCellRevision),
        expectedResourceRevision:Number(body.expectedResourceRevision),reason:text(body.reason,3,500),confirmed:true}
    },context,true,async(db,actor,body)=>{
      const tenantId=actor.account.tenantId
      await this.target(db,tenantId,body.targetUserId)
      const [target]=await db`select role from haas.users where tenant_id=${tenantId} and user_id=${body.targetUserId} and status='active'`
      const policy=await readRuntimeResources(db,tenantId,body.targetUserId)
      const [binding]=await db`select * from haas.runtime_bindings where tenant_id=${tenantId} and user_id=${body.targetUserId}
        and revision=${body.expectedCellRevision} and isolation_mode='container-managed' and status='suspended' and lease_expires_at<=clock_timestamp()`
      if(!target||!binding||policy.desiredState!=='running'||policy.revision!==body.expectedResourceRevision)
        throw new EnterpriseError(409,'runtime-recovery-precondition','须回读准确的已撤回运行版本与运行配额，不能重启活动单元')
      const [capacity]=await db`select count(*)::int as count from haas.runtime_recovery_requests where tenant_id=${tenantId}`
      if(capacity!.count>=10000)throw new EnterpriseError(409,'runtime-recovery-capacity','恢复记录达到当前容量上限，须由操作者处理')
      if((await db`select 1 from haas.runtime_recovery_requests where tenant_id=${tenantId} and target_user_id=${body.targetUserId}
        and outcome in ('queued','executing','unconfirmed')`).length)throw new EnterpriseError(409,'runtime-recovery-pending','已有未完成或结果未知的恢复请求，请回读，不可另建重试')
      const pin:PrivateRuntimeCell={cellId:binding.cell_id,tenantId,userId:body.targetUserId,role:target.role,revision:binding.revision,
        origin:binding.origin,containerId:binding.container_id,imageId:binding.image_id,volumeName:binding.volume_name,policyDigest:binding.policy_digest}
      await db`insert into haas.runtime_recovery_requests (tenant_id,request_id,actor_user_id,login_session_id,target_user_id,target_pin,resource_policy,reason)
        values (${tenantId},${context.requestId},${actor.account.userId},${actor.sessionId},${body.targetUserId},${db.json({...pin})},${db.json({...policy})},${body.reason})`
      return {data:{requestId:context.requestId,targetUserId:body.targetUserId,outcome:'queued' as const,result:null,
        acceptedResourceRevision:policy.revision,physicalStop:'operator-must-verify' as const},targetId:body.targetUserId,reason:body.reason}
    })
  }
  async recoveryState(token: string | undefined,input:unknown,requestId:string) {
    return this.identity.runtimeManagementRead(token,requestId,async(db,actor)=>{
      const body=record(input,['targetUserId','reason','confirmed'])
      if(body.confirmed!==true)return invalid('请确认恢复请求状态读取及审计提示')
      const userId=uuid(body.targetUserId),reason=text(body.reason,3,500)
      await this.target(db,actor.account.tenantId,userId)
      const [row]=await db`select request_id,target_user_id,outcome,result,resource_policy from haas.runtime_recovery_requests
        where tenant_id=${actor.account.tenantId} and target_user_id=${userId}
        order by (outcome in ('queued','executing','unconfirmed')) desc,created_at desc,request_id desc limit 1`
      return {data:{targetUserId:userId,request:row?{requestId:String(row.request_id),targetUserId:userId,outcome:String(row.outcome),
        result:row.result,acceptedResourceRevision:row.resource_policy.revision,physicalStop:'operator-must-verify' as const}:null},targetId:userId,reason}
    })
  }
  async recoveryReceipt(token:string|undefined,id:string,requestId:string) {
    return this.identity.runtimeManagementRead(token,requestId,async(db,actor)=>{
      const [row]=await db`select request_id,target_user_id,outcome,result,resource_policy from haas.runtime_recovery_requests
        where tenant_id=${actor.account.tenantId} and request_id=${uuid(id)}`
      if(!row)throw new EnterpriseError(404,'not-found','对象不存在或不可访问')
      return {data:{requestId:String(row.request_id),targetUserId:String(row.target_user_id),outcome:String(row.outcome),result:row.result,
        acceptedResourceRevision:row.resource_policy.revision,physicalStop:'operator-must-verify' as const},targetId:String(row.target_user_id),reason:'读取恢复历史回执，不作为当前运行状态'}
    })
  }
  private async target(db: TransactionSql, tenantId: string, userId: string) {
    const [row] = await db`select display_name from haas.users where tenant_id=${tenantId} and user_id=${userId}`
    if (!row) throw new EnterpriseError(404, 'not-found', '对象不存在或不可访问')
    return String(row.display_name)
  }
  async read(token: string | undefined, input: unknown, requestId: string) {
    return this.identity.runtimeManagementRead(token, requestId, async (db, actor) => {
      const body = record(input, ['targetUserId', 'reason', 'confirmed'])
      if (body.confirmed !== true) return invalid('请确认运行状态读取及审计提示')
      const userId = uuid(body.targetUserId), reason = text(body.reason, 3, 500)
      const targetName = await this.target(db, actor.account.tenantId, userId)
      const desired = await readRuntimeResources(db, actor.account.tenantId, userId)
      const [binding] = await db`select cell_id, revision, status, lease_expires_at > clock_timestamp() as lease_valid,
        resource_observation, resources_observed_at,
        exists(select 1 from haas.admitted_runtime_bindings a where a.cell_id=b.cell_id) as policy_matches
        from haas.runtime_bindings b where tenant_id=${actor.account.tenantId} and user_id=${userId}`
      const runtime = binding ? { cellId: String(binding.cell_id), cellRevision: String(binding.revision),
        bindingState: String(binding.status), leaseValid: Boolean(binding.lease_valid),
        policyMatches: Boolean(binding.policy_matches), observed: binding.resource_observation,
        observedAt: binding.resources_observed_at,
        // A DB fence proves ingress withdrawal, not that an old writer died.
        physicalStop: 'not-observed' as const } : null
      return { data: { targetUserId: userId, targetName, desired, runtime,
        enforcement: runtime?.observed && runtime.policyMatches && runtime.leaseValid && runtime.bindingState === 'ready'
          ? 'operator-observed' as const : 'unconfirmed' as const,
        persistentStorageQuota: 'not-enforced' as const }, targetId: userId, reason }
    })
  }
  async configure(token: string | undefined, input: unknown, context: CommandContext) {
    return this.identity.resourceCommand(token, 'runtime.resources.configure', () => {
      const body = record(input, ['targetUserId', 'expectedRevision', 'desiredState', 'cpuMillis', 'memoryMiB', 'pidsLimit', 'reason', 'confirmed'])
      if (body.confirmed !== true) return invalid('请确认变更将撤回旧运行单元准入；恢复须重新准入，不自动重启')
      return { targetUserId: uuid(body.targetUserId), policy: parseRuntimeResources({ revision: body.expectedRevision,
        desiredState: body.desiredState, cpuMillis: body.cpuMillis, memoryMiB: body.memoryMiB, pidsLimit: body.pidsLimit }),
        reason: text(body.reason, 3, 500), confirmed: true }
    }, context, true, async (db, actor, body) => {
      const tenantId = actor.account.tenantId, userId = body.targetUserId
      await this.target(db, tenantId, userId)
      const current = await readRuntimeResources(db, tenantId, userId)
      if (current.revision !== body.policy.revision || current.revision === 2147483647) throw new EnterpriseError(409, 'runtime-policy-conflict', '运行策略已变化或版本已达上限，请重新读取')
      const policy = { ...body.policy, revision: current.revision + 1 }
      await db`insert into haas.runtime_resource_policies
        (tenant_id,user_id,revision,desired_state,cpu_millis,memory_mib,pids_limit,reason,updated_by)
        values (${tenantId},${userId},${policy.revision},${policy.desiredState},${policy.cpuMillis},${policy.memoryMiB},${policy.pidsLimit},${body.reason},${actor.account.userId})
        on conflict (tenant_id,user_id) do update set revision=excluded.revision,desired_state=excluded.desired_state,
          cpu_millis=excluded.cpu_millis,memory_mib=excluded.memory_mib,pids_limit=excluded.pids_limit,
          reason=excluded.reason,updated_by=excluded.updated_by,updated_at=clock_timestamp()`
      return { data: { targetUserId: userId, policy, outcome: 'intent-recorded' as const,
        enforcement: 'unconfirmed' as const, automaticRestart: false, persistentStorageQuota: 'not-enforced' as const }, targetId: userId, reason: body.reason }
    })
  }
}
