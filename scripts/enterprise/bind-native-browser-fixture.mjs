import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Operator-only fixture admission after REAL browser administrator bootstrap.
// Does not create users, change their roles, start Workers, or store owner
// credentials in the running application. Not a production provisioner.
if (process.argv.length !== 3) throw new Error('Expected the exact private test configuration')
const path = process.argv[2]
if ((statSync(path).mode & 0o077) !== 0) throw new Error('Private configuration required')
const evidence = dirname(path)
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const config = JSON.parse(readFileSync(path, 'utf8'))
const browser = JSON.parse(readFileSync(resolve(evidence, 'browser-server-config.json'), 'utf8'))
const credentials = JSON.parse(readFileSync(resolve(evidence, 'browser-credentials.json'), 'utf8'))
const ready = JSON.parse(readFileSync(resolve(credentials.nativeFixture, 'ready.json'), 'utf8'))
const target = new URL(browser.nativeDevelopmentOrigins?.[0])
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.port === '3080'
  || browser.tenantId !== config.tenantId || browser.applicationUrl !== config.applicationUrl) throw new Error('Unsafe fixture target')
const pid = execFileSync('/usr/sbin/lsof', ['-t', `-iTCP:${target.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
if (!/^\d+$/u.test(pid)) throw new Error('Ambiguous fixture process')
const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
const command = execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
if (!cwd.split('\n').includes(`n${realpathSync(credentials.nativeFixture)}`) || !command.includes(ready.patch)
  || !command.includes(`${root}/node_modules/@deepseek-ai/dsh/lib/bin.js`)) throw new Error('Native fixture owner changed')
const database = new URL(config.ownerUrl)
if (database.hostname !== '127.0.0.1' || database.pathname !== '/haas_e2e' || ['3080', '5432', '10012'].includes(database.port)) throw new Error('Not the isolated database')
const require = createRequire(resolve(root, 'apps/enterprise-server/package.json'))
const sql = require('postgres')(config.ownerUrl, { max: 1, onnotice: () => {} })
try {
  const rows = await sql`select user_id from haas.users where tenant_id = ${config.tenantId} and username = ${credentials.username} and role = 'admin' and status = 'active'`
  if (rows.length !== 1) throw new Error('Complete the administrator bootstrap through the browser first')
  const [binding] = await sql`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at)
    values (${randomUUID()}, ${config.tenantId}, ${rows[0].user_id}, ${target.origin}, ${randomUUID()}, 'development-process', 'ready', clock_timestamp() + interval '1 hour')
    returning cell_id, user_id, origin, lease_expires_at`
  writeFileSync(resolve(evidence, 'native-browser-binding.json'), JSON.stringify({
    sourceRoot: root, tenantId: config.tenantId, nativePid: Number(pid), ...binding,
    scope: 'operator-bound-development-fixture-not-final-isolation', recordedAt: new Date().toISOString(),
  }, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ status: 'BOUND', evidence, cellId: binding.cell_id, origin: binding.origin, leaseExpiresAt: binding.lease_expires_at }))
} finally { await sql.end({ timeout: 5 }) }
