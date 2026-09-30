import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Bounded, data-preserving failure injection ONLY for our synthetic Docker DB.
// The 40-second table lock produces real application lock_timeout failures.
// No credential, cookie, token digest, database row, role or service is changed.
if (process.argv.length !== 4) throw new Error('Expected private fixture config and a new external evidence directory')
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const configPath = realpathSync(process.argv[2])
const evidence = realpathSync(process.argv[3])
const evidenceParent = realpathSync(resolve(root, '../.paimind-goal-evidence'))
if ((statSync(configPath).mode & 0o077) !== 0 || dirname(evidence) !== evidenceParent) throw new Error('Private isolated evidence required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const receipt = JSON.parse(readFileSync(resolve(dirname(configPath), 'fixture-receipt.json'), 'utf8'))
const credentials = JSON.parse(readFileSync(resolve(dirname(configPath), 'browser-credentials.json'), 'utf8'))
const database = new URL(config.ownerUrl)
if (receipt.sourceRoot !== root || receipt.containerId !== config.containerId
  || database.hostname !== '127.0.0.1' || database.pathname !== '/haas_e2e'
  || ['3080', '5432', '10012'].includes(database.port)) throw new Error('Not the owned synthetic database')
const [container] = JSON.parse(execFileSync('docker', ['inspect', receipt.containerId], { encoding: 'utf8' }))
const binding = container.NetworkSettings.Ports['5432/tcp']
if (container.Config.Labels['paimind.goal'] !== 'enterprise-haas' || container.Config.Labels['paimind.role'] !== 'identity-e2e-only'
  || !container.State.Running || container.State.Paused || binding.length !== 1
  || binding[0].HostIp !== database.hostname || binding[0].HostPort !== database.port) throw new Error('Fixture exposure or ownership changed')
const require = createRequire(resolve(root, 'apps/enterprise-server/package.json'))
const sql = require('postgres')(config.ownerUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 5_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 50_000 } })
const capture = async () => {
  const rows = await sql`select u.user_id, s.session_id, s.expires_at, s.revoked_at
    from haas.users u join haas.login_sessions s using (tenant_id, user_id)
    where u.tenant_id = ${config.tenantId} and u.username = ${credentials.username}
    order by s.created_at`
  const audit = await sql`select action, count(*)::integer as count from haas.audit_events
    where tenant_id = ${config.tenantId} group by action order by action`
  return { rows, audit }
}
try {
  const before = await capture()
  if (!before.rows.some(row => row.revoked_at === null && new Date(row.expires_at).getTime() > Date.now())) throw new Error('A real browser login is required first')
  const startedAt = new Date().toISOString()
  writeFileSync(resolve(evidence, 'identity-lock-before.json'), JSON.stringify({ startedAt, before, containerId: container.Id }, null, 2), { flag: 'wx', mode: 0o600 })
  await sql.begin(async db => {
    await db`LOCK TABLE haas.users IN ACCESS EXCLUSIVE MODE`
    console.log(JSON.stringify({ state: 'LOCK_HELD', startedAt, durationMs: 40_000, evidence }))
    await new Promise(done => setTimeout(done, 40_000))
  })
  const after = await capture()
  // Read-denial audit is expected during the injected failure. Compare login
  // state and identity-changing commands, not the complete append-only audit.
  const mutations = audit => audit.filter(row => !['identity.me', 'runtime.admission'].includes(row.action))
  const unchanged = JSON.stringify(before.rows) === JSON.stringify(after.rows)
    && JSON.stringify(mutations(before.audit)) === JSON.stringify(mutations(after.audit))
  writeFileSync(resolve(evidence, 'identity-lock-receipt.json'), JSON.stringify({
    state: unchanged ? 'RELEASED_IDENTITY_UNCHANGED' : 'RELEASED_REVIEW_REQUIRED', startedAt,
    releasedAt: new Date().toISOString(), containerId: container.Id, before, after,
    comparison: 'login records and identity-changing audit counts unchanged; read-denial audit retained',
    scope: 'synthetic-database-lock-fault-injection; browser evidence must be verified separately',
  }, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ state: unchanged ? 'RELEASED_IDENTITY_UNCHANGED' : 'RELEASED_REVIEW_REQUIRED', evidence }))
  if (!unchanged) process.exitCode = 1
} finally { await sql.end({ timeout: 5 }) }
