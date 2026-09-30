import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import postgres from 'postgres'
import { afterAll, expect, it } from 'vitest'
import { Identity } from '../src/identity.js'
import { RuntimeBindings } from '../src/runtime-bindings.js'
import { probePersistentStorage } from '../../../scripts/enterprise/probe-persistent-storage.mjs'

const root = process.cwd(), configPath = process.env.PAIMIND_HAAS_TEST_CONFIG
const imageEvidence = process.env.PAIMIND_HAAS_STORAGE_IMAGE_EVIDENCE
if (!configPath || !imageEvidence || (statSync(configPath).mode & 0o077) !== 0) throw new Error('Explicit private database and real storage image evidence required')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
for (const value of [config.ownerUrl, config.applicationUrl]) {
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/haas_e2e' || !url.port || ['3080', '5432', '10012'].includes(url.port)) throw new Error('Not the isolated fixture')
}
const prior = JSON.parse(readFileSync(join(imageEvidence, 'persistent-result.json'), 'utf8'))
assert.equal(prior.realCrashRecovered, true)
const policy = realpathSync(join(imageEvidence, 'diagnostic-seccomp.json'))
assert.equal(execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', prior.imageId], { encoding: 'utf8' }).trim(), prior.imageId)
const owner = postgres(config.ownerUrl, { max: 2, onnotice: () => {}, connect_timeout: 5 })
const application = postgres(config.applicationUrl, { max: 2, onnotice: () => {}, connect_timeout: 5 })
afterAll(async () => { await application.end({ timeout: 5 }); await owner.end({ timeout: 5 }) })

it('runs the actual operator CLI: durable binding suspension precedes native container termination and offline storage maintenance', async () => {
  const evidence = await mkdtemp(join(realpathSync(join(root, '../.paimind-goal-evidence')), 'haas-bound-maintenance-'))
  const run = randomUUID(), tenantId = `maintenance-lifecycle-${run}`
  const context = () => ({ key: randomUUID(), requestId: randomUUID() })
  await owner`insert into haas.tenants (tenant_id) values (${tenantId})`
  const identity = new Identity(application, tenantId, Buffer.from(config.masterKey, 'base64url'), config.bootstrapSecret)
  const credentials = { username: 'taylor', displayName: 'Taylor', password: 'Synthetic lifecycle administrator password 2026' }
  const admin = (await identity.bootstrap({ ...credentials, bootstrapSecret: config.bootstrapSecret }, context())).data
  const token = (await identity.login({ username: credentials.username, password: credentials.password }, context())).token
  // A control-plane routing fixture, deliberately NOT native/browser admission.
  // The real native runtime in this test has no exposed port and no model wire.
  const originFixture = createServer((_request, response) => response.end('maintenance routing fixture'))
  await new Promise<void>(resolve => originFixture.listen(0, '127.0.0.1', resolve))
  const address = originFixture.address(); assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const hostSources = ['scripts/enterprise/probe-persistent-storage.mjs', 'scripts/enterprise/maintain-bound-storage.mjs',
    'deploy/enterprise/controller/offline-storage.mjs', 'apps/enterprise-server/src/runtime-maintenance.ts',
    'apps/enterprise-server/lib/runtime-maintenance.js', 'apps/enterprise-server/src/native-gateway.ts',
    'apps/enterprise-server/migrations/0003-runtime-maintenance.sql']
  await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ imageId: prior.imageId, imageEvidence,
    policySha256: createHash('sha256').update(readFileSync(policy)).digest('hex'),
    hostInputs: hostSources.map(source => ({ source, sha256: createHash('sha256').update(readFileSync(join(root, source))).digest('hex') })),
    syntheticRoutingBinding: true, browserAcceptanceClaimed: false }, null, 2), { flag: 'wx', mode: 0o600 })
  try {
    await probePersistentStorage({ evidence, imageId: prior.imageId, policy, run,
      boundMaintenance: async (storage: { containerId: string; cellId: string; volume: string; imageId: string; policy: string; ownerLabels: Record<string, string> }) => {
        const revision = randomUUID(), operationId = randomUUID()
        await owner`insert into haas.runtime_bindings (cell_id, tenant_id, user_id, origin, revision, isolation_mode, status, lease_expires_at)
          values (${storage.cellId}, ${tenantId}, ${admin.userId}, ${origin}, ${revision}, 'development-process', 'ready', clock_timestamp() + interval '10 minutes')`
        const operatorConfig = join(evidence, 'operator-config.json')
        await writeFile(operatorConfig, JSON.stringify({ databaseConfigPath: configPath, oldContainerId: storage.containerId,
          request: { operationId, requestId: randomUUID(), tenantId, userId: admin.userId, cellId: storage.cellId,
            expectedRevision: revision, expectedOrigin: origin, reason: 'storage-recovery' },
          storage: { volume: storage.volume, imageId: storage.imageId, policy: storage.policy, ownerLabels: storage.ownerLabels } }, null, 2),
        { flag: 'wx', mode: 0o600 })
        const output = await promisify(execFile)(process.execPath, ['scripts/enterprise/maintain-bound-storage.mjs', operatorConfig],
          { cwd: root, timeout: 60_000, maxBuffer: 4 * 1024 ** 2 })
        await writeFile(join(evidence, 'operator-command.log'), output.stdout + output.stderr, { flag: 'wx', mode: 0o600 })
        const receipt = JSON.parse(output.stdout.trim())
        expect(receipt.status).toBe('STORAGE_MAINTAINED_BINDING_SUSPENDED')
        const result = JSON.parse(readFileSync(join(receipt.evidence, 'result.json'), 'utf8'))
        const events = JSON.parse(readFileSync(join(receipt.evidence, 'events.json'), 'utf8')) as { event: string; state?: { ExitCode: number; Running: boolean } }[]
        expect(events[0]!.event).toBe('runtime-binding-suspended')
        const closed = events.find(row => row.event === 'old-runtime-joined')!
        expect(closed.state).toMatchObject({ ExitCode: 0, Running: false })
        expect(events.findIndex(row => row.event === 'old-runtime-removed'))
          .toBeLessThan(events.findIndex(row => row.event === 'storage-maintenance-fence-acquired'))
        expect(result).toMatchObject({ operationId, bindingStatus: 'suspended', runtimeRestarted: false, memberAdmissionVerified: false })
        const bindings = new RuntimeBindings(application, identity, address.port === 62001 ? 'http://127.0.0.1:62002' : 'http://127.0.0.1:62001', [origin])
        await expect(bindings.resolve(token, randomUUID())).rejects.toMatchObject({ status: 503 })
        const [current] = await owner`select status, revision, lease_expires_at <= clock_timestamp() as expired
          from haas.runtime_bindings where cell_id = ${storage.cellId}`
        expect(current).toMatchObject({ status: 'suspended', expired: true }); expect(current!.revision).not.toBe(revision)
        const audits = await owner`select action, outcome, target_id from haas.audit_events
          where tenant_id = ${tenantId} and action = 'runtime.maintenance.suspend'`
        expect(audits).toEqual([{ action: 'runtime.maintenance.suspend', outcome: 'succeeded', target_id: storage.cellId }])
        const readback = { operatorEvidence: receipt.evidence, operationId, bindingStatus: current!.status,
          closedState: closed.state, auditCount: audits.length, syntheticRoutingBinding: true, browserAcceptanceClaimed: false }
        await writeFile(join(evidence, 'binding-readback.json'), JSON.stringify(readback, null, 2), { flag: 'wx', mode: 0o600 })
        return readback
      } })
    console.log(JSON.stringify({ evidence, actualOperatorCommandPassed: true, browserAcceptanceClaimed: false }))
  } finally { originFixture.closeAllConnections(); await new Promise<void>(resolve => originFixture.close(() => resolve())) }
})
