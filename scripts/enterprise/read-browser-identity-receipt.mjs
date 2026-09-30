import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only database corroboration of the separately executed browser flow.
// Never creates accounts, logs in, replays commands or claims Browser E2E alone.
if (process.argv.length !== 3) throw new Error('Expected the exact private browser test configuration')
const path = process.argv[2]
if ((statSync(path).mode & 0o077) !== 0) throw new Error('Private configuration required')
const evidence = dirname(path)
const config = JSON.parse(readFileSync(path, 'utf8'))
const credentials = JSON.parse(readFileSync(resolve(evidence, 'browser-credentials.json'), 'utf8'))
const database = new URL(config.ownerUrl)
if (database.hostname !== '127.0.0.1' || database.pathname !== '/haas_e2e'
  || ['3080', '5432', '10012'].includes(database.port)) throw new Error('Not the isolated test database')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(root, 'apps/enterprise-server/package.json'))
const sql = require('postgres')(config.ownerUrl, { max: 1, onnotice: () => {} })
try {
  const users = await sql`select user_id, username, display_name, role, status from haas.users
    where tenant_id = ${config.tenantId} and username in (${credentials.username}, ${credentials.memberUsername}) order by username`
  assert.equal(users.length, 2)
  const admin = users.find(row => row.username === credentials.username)
  const member = users.find(row => row.username === credentials.memberUsername)
  assert.equal(admin?.role, 'admin'); assert.equal(member?.role, 'member')
  assert.equal(admin?.status, 'active'); assert.equal(member?.status, 'active')
  const audit = await sql`select event_id, actor_user_id, action, target_id, outcome, reason, occurred_at
    from haas.audit_events where tenant_id = ${config.tenantId} order by occurred_at`
  const successes = action => audit.filter(row => row.action === action && row.outcome === 'succeeded')
  assert.equal(successes('identity.bootstrap').length, 1)
  assert.equal(successes('identity.member.create').filter(row => row.target_id === member.user_id).length, 1)
  const statusChanges = successes('identity.member.status').filter(row => row.target_id === member.user_id)
  assert.equal(statusChanges.length, 2, 'Only confirmed disable and enable may mutate; Escape must not')
  assert(statusChanges.every(row => row.actor_user_id === admin.user_id && row.reason))
  assert.equal(successes('identity.logout').length, 1)
  const receipt = { status: 'PASS', scope: 'read-only corroboration, not standalone Browser E2E',
    recordedAt: new Date().toISOString(), sourceRoot: root, tenantId: config.tenantId, users, audit }
  const output = resolve(evidence, 'browser-identity-readback.json')
  writeFileSync(output, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ status: 'PASS', output, users: users.length, confirmedStatusChanges: statusChanges.length, auditEvents: audit.length }))
} finally { await sql.end({ timeout: 5 }) }
