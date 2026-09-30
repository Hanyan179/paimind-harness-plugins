import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Operator-only renewal of an EXISTING synthetic development binding. Never
// creates a user/cell, changes identity/role/origin, or renews a production cell.
if (process.argv.length !== 3) throw new Error('Expected the exact private test configuration')
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
if (execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim()
  !== 'codex/enterprise-haas-hybrid-refactor') throw new Error('Wrong enterprise fixture worktree')
const configPath = realpathSync(process.argv[2])
const evidence = dirname(configPath)
if (dirname(evidence) !== realpathSync(resolve(root, '../.paimind-goal-evidence'))
  || (statSync(configPath).mode & 0o077) !== 0) throw new Error('Private isolated fixture required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const receipt = JSON.parse(readFileSync(resolve(evidence, 'fixture-receipt.json'), 'utf8'))
const browser = JSON.parse(readFileSync(resolve(evidence, 'browser-server-config.json'), 'utf8'))
const credentials = JSON.parse(readFileSync(resolve(evidence, 'browser-credentials.json'), 'utf8'))
const binding = JSON.parse(readFileSync(resolve(evidence, 'native-browser-binding.json'), 'utf8'))
const ready = JSON.parse(readFileSync(resolve(credentials.nativeFixture, 'ready.json'), 'utf8'))
const target = new URL(binding.origin)
const database = new URL(config.ownerUrl)
if (receipt.sourceRoot !== root || binding.sourceRoot !== root || receipt.containerId !== config.containerId
  || browser.tenantId !== config.tenantId || binding.tenantId !== config.tenantId
  || browser.applicationUrl !== config.applicationUrl || browser.nativeDevelopmentOrigins?.length !== 1
  || browser.nativeDevelopmentOrigins[0] !== target.origin || binding.origin !== target.origin
  || target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.port === '3080'
  || database.hostname !== '127.0.0.1' || database.pathname !== '/haas_e2e'
  || !database.port || ['3080', '5432', '10012'].includes(database.port)) throw new Error('Unsafe fixture target')
const [container] = JSON.parse(execFileSync('docker', ['inspect', receipt.containerId], { encoding: 'utf8' }))
const ports = container.NetworkSettings.Ports['5432/tcp']
if (container.Id !== receipt.containerId || container.Config.Labels['paimind.goal'] !== 'enterprise-haas'
  || container.Config.Labels['paimind.role'] !== 'identity-e2e-only'
  || !container.State.Running || container.State.Paused || ports?.length !== 1
  || ports[0].HostIp !== database.hostname || ports[0].HostPort !== database.port) throw new Error('Database owner changed')
const pid = execFileSync('/usr/sbin/lsof', ['-t', `-iTCP:${target.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
if (!/^\d+$/u.test(pid) || Number(pid) !== binding.nativePid) throw new Error('Native process changed')
const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
const command = execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
if (!cwd.split('\n').includes(`n${realpathSync(credentials.nativeFixture)}`)
  || !command.includes(ready.patch) || !command.includes(`${root}/node_modules/@deepseek-ai/dsh/lib/bin.js`)) {
  throw new Error('Native fixture owner changed')
}
const require = createRequire(resolve(root, 'apps/enterprise-server/package.json'))
const sql = require('postgres')(config.ownerUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 5_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 10_000 } })
const renewalPath = resolve(evidence, `native-browser-renewal-${randomUUID()}.json`)
try {
  const result = await sql.begin(async db => {
    const rows = await db`select b.*, u.username, u.role, u.status as user_status from haas.runtime_bindings b
      join haas.users u using (tenant_id, user_id)
      where b.cell_id = ${binding.cell_id} and b.tenant_id = ${config.tenantId} and b.user_id = ${binding.user_id}
      for update of b, u`
    if (rows.length !== 1 || rows[0].username !== credentials.username || rows[0].role !== 'admin'
      || rows[0].user_status !== 'active' || rows[0].origin !== target.origin
      || rows[0].isolation_mode !== 'development-process' || rows[0].status !== 'ready') throw new Error('Existing fixture no longer matches')
    const before = rows[0]
    const [after] = await db`update haas.runtime_bindings set lease_expires_at = clock_timestamp() + interval '1 hour'
      where cell_id = ${binding.cell_id} and tenant_id = ${config.tenantId} and user_id = ${binding.user_id}
      returning cell_id, user_id, origin, revision, isolation_mode, status, lease_expires_at`
    return { before: { lease_expires_at: before.lease_expires_at, revision: before.revision }, after }
  })
  const [verified] = await sql`select cell_id, user_id, origin, revision, isolation_mode, status, lease_expires_at
    from haas.runtime_bindings where cell_id = ${binding.cell_id} and tenant_id = ${config.tenantId}`
  if (JSON.stringify(verified) !== JSON.stringify(result.after)) throw new Error('Renewal readback mismatch; inspect exact cell before retry')
  writeFileSync(renewalPath, JSON.stringify({ status: 'RENEWED_AND_READ_BACK', sourceRoot: root,
    recordedAt: new Date().toISOString(), containerId: container.Id, nativePid: Number(pid), ...result,
    scope: 'existing synthetic development binding only; not final isolation acceptance',
  }, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ status: 'RENEWED_AND_READ_BACK', renewalPath, cellId: verified.cell_id,
    origin: verified.origin, leaseExpiresAt: verified.lease_expires_at }))
} finally { await sql.end({ timeout: 5 }) }
