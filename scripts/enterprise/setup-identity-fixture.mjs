import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '../..'))
const require = createRequire(join(root, 'apps/enterprise-server/package.json'))
const postgres = require('postgres')
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim()

const resume = process.argv[2] === '--resume-setup'
if (process.argv.length !== (resume ? 4 : 3)) throw new Error('Usage: node setup-identity-fixture.mjs EXISTING_EXTERNAL_EVIDENCE_PARENT | --resume-setup OWN_INCOMPLETE_FIXTURE')
process.umask(0o077)
const parent = realpathSync(process.argv[resume ? 3 : 2])
const rel = relative(root, parent)
if (!rel.startsWith('../') && !isAbsolute(rel)) throw new Error('Test secrets must be outside the source worktree')
const evidence = resume ? parent : mkdtempSync(join(parent, 'haas-identity-e2e-'))
chmodSync(evidence, 0o700)
const suffix = randomBytes(5).toString('hex')
const receipt = resume ? JSON.parse(readFileSync(join(evidence, 'fixture-receipt.json'), 'utf8')) : null
if (resume && (receipt.sourceRoot !== root || receipt.status !== 'Starting' || existsSync(join(evidence, 'test-config.json')))) {
  throw new Error('Only this source worktree can finish its own incomplete setup')
}
const container = receipt?.container ?? `paimind-haas-identity-e2e-${suffix}`
const ownerPassword = resume
  ? readFileSync(join(evidence, 'postgres.env'), 'utf8').split('\n').find(line => line.startsWith('POSTGRES_PASSWORD='))?.slice('POSTGRES_PASSWORD='.length)
  : randomBytes(32).toString('base64url')
if (!ownerPassword || !/^[A-Za-z0-9_-]{43}$/u.test(ownerPassword)) throw new Error('Invalid private fixture credential')
const applicationPassword = randomBytes(32).toString('base64url')
const envFile = join(evidence, 'postgres.env')
if (!resume) writeFileSync(envFile, `POSTGRES_PASSWORD=${ownerPassword}\nPOSTGRES_USER=haas_owner\nPOSTGRES_DB=haas_e2e\n`, { mode: 0o600, flag: 'wx' })
// No reuse, stop, restart or removal of pre-existing containers. Ephemeral host
// port is explicitly loopback-only. Keep the created container as test evidence.
const image = receipt?.image ?? docker('image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}')
const containerId = receipt?.containerId ?? docker('run', '-d', '--name', container,
  '--label', 'paimind.goal=enterprise-haas', '--label', 'paimind.role=identity-e2e-only',
  '--env-file', envFile, '-p', '127.0.0.1::5432', image)
if (docker('inspect', containerId, '--format', '{{index .Config.Labels "paimind.role"}}') !== 'identity-e2e-only') throw new Error('Fixture ownership label mismatch')
if (!resume) writeFileSync(join(evidence, 'fixture-receipt.json'), JSON.stringify({
  status: 'Starting', container, containerId, image, sourceRoot: root, createdAt: new Date().toISOString(),
  role: 'isolated-identity-backend-not-final-worker-acceptance',
}, null, 2), { mode: 0o600, flag: 'wx' })
const portBinding = docker('port', containerId, '5432/tcp')
if (!/^127\.0\.0\.1:\d+$/u.test(portBinding)) throw new Error('Unexpected database exposure; inspect the newly created fixture')
const port = Number(portBinding.split(':')[1])
const ownerUrl = `postgres://haas_owner:${ownerPassword}@127.0.0.1:${port}/haas_e2e`
const applicationUrl = `postgres://haas_app:${applicationPassword}@127.0.0.1:${port}/haas_e2e`
const sql = postgres(ownerUrl, { max: 1, connect_timeout: 1, onnotice: () => {} })
try {
  let ready = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    // pg_isready via the container's Unix socket also sees PostgreSQL's
    // temporary initialization server; only the actual TCP route proves ready.
    try { await sql`select 1`; ready = true; break } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  if (!ready) throw new Error('Database TCP route unavailable')
  const [existing] = await sql`select to_regnamespace('haas') is not null as present`
  if (existing.present) throw new Error('Refusing to overwrite existing identity schema')
  await sql.begin(async db => {
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0001-identity.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0002-runtime-bindings.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0003-runtime-maintenance.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0004-managed-runtime-cells.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0005-member-groups.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0006-agent-publications.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0007-skill-publications.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0008-agent-skill-dependencies.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0009-feature-governance.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0010-model-commands.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0011-connector-commands.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0012-connector-approvals.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0013-connector-activation-commands.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0014-runtime-resource-policies.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0015-runtime-recovery-requests.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0016-session-create-commands.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0017-runtime-replacement-lineage.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0018-session-turn-commands.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0019-session-approval-commands.sql'), 'utf8'))
    await db.unsafe(readFileSync(join(root, 'apps/enterprise-server/migrations/0020-instruction-commands.sql'), 'utf8'))
    // Generated base64url password has no SQL quote characters. The role has no
    // DDL, audit mutation or superuser privileges; runtime never gets owner URL.
    await db.unsafe(`create role haas_app login password '${applicationPassword}'`)
    await db.unsafe(`grant usage on schema haas to haas_app;
      grant select on all tables in schema haas to haas_app;
      grant insert, update on haas.users, haas.login_sessions, haas.auth_buckets to haas_app;
      grant insert on haas.command_receipts, haas.audit_events to haas_app;
      grant insert on haas.instruction_commands to haas_app;
      grant update (outcome,confirmation,confirmed_at) on haas.instruction_commands to haas_app;
      grant insert on haas.session_create_commands to haas_app;
      grant update (outcome,confirmed_at) on haas.session_create_commands to haas_app;
      grant insert on haas.session_turn_commands to haas_app;
      grant update (outcome,confirmed_at,native_message_id,native_seq) on haas.session_turn_commands to haas_app;
      grant insert on haas.session_approval_commands to haas_app;
      grant update (carrier_accepted,acknowledged_at) on haas.session_approval_commands to haas_app;
      grant insert, update on haas.member_groups to haas_app;
      grant insert, delete on haas.group_members to haas_app;
      grant insert on haas.agent_publications to haas_app;
      grant update (status, revision, review_reason, reviewed_by, reviewed_at) on haas.agent_publications to haas_app;
      grant insert, update on haas.resource_assignments to haas_app;
      grant insert on haas.agent_skill_dependencies to haas_app;
      grant insert on haas.skill_artifacts, haas.skill_publications to haas_app;
      grant update (capture_generation, capture_deadline, next_offset, status, archive_digest, archive_bytes, expanded_bytes, entry_count, sealed_at) on haas.skill_artifacts to haas_app;
      grant insert, delete on haas.skill_artifact_chunks to haas_app;
      grant update (status, revision, review_reason, reviewed_by, reviewed_at) on haas.skill_publications to haas_app;
      grant insert, update on haas.skill_assignments to haas_app;
      grant insert, update on haas.feature_approvals to haas_app;
      grant insert on haas.feature_commands to haas_app;
      grant update (outcome,confirmation,confirmed_at) on haas.feature_commands to haas_app;
      grant insert on haas.model_commands to haas_app;
      grant update (outcome,confirmation,confirmed_at) on haas.model_commands to haas_app;
      grant insert on haas.connector_commands to haas_app;
      grant update (outcome,confirmation,confirmed_at) on haas.connector_commands to haas_app;
      grant insert on haas.connector_approvals to haas_app;
      grant insert on haas.runtime_resource_policies to haas_app;
      grant insert (tenant_id,request_id,actor_user_id,login_session_id,target_user_id,target_pin,resource_policy,reason) on haas.runtime_recovery_requests to haas_app;
      grant update (revision,desired_state,cpu_millis,memory_mib,pids_limit,reason,updated_by,updated_at) on haas.runtime_resource_policies to haas_app;
      grant insert on haas.connector_activation_commands to haas_app;
      grant update (outcome,confirmation,confirmed_at) on haas.connector_activation_commands to haas_app;
      grant update (configuration_version,server_name,transport,cell_id,volume_name,image_id,policy_digest,decision,revision,reason,updated_by,updated_at) on haas.connector_approvals to haas_app;
      grant usage, select on all sequences in schema haas to haas_app;`)
  })
  const testConfig = { ownerUrl, applicationUrl, masterKey: randomBytes(32).toString('base64url'),
    bootstrapSecret: randomBytes(32).toString('base64url'), tenantId: `haas-test-${suffix}`, containerId, evidence }
  await sql`insert into haas.tenants (tenant_id) values (${testConfig.tenantId})`
  const configPath = join(evidence, 'test-config.json')
  writeFileSync(configPath, JSON.stringify(testConfig, null, 2), { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ status: 'READY', configPath, evidence, container, containerId, database: portBinding, image }, null, 2))
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : 'SETUP_FAILED'
  throw new Error(`Isolated fixture setup failed (${code}); private evidence preserved at ${evidence}`)
} finally { await sql.end({ timeout: 5 }) }
