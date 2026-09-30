import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuntimeMaintenance } from '../../apps/enterprise-server/lib/runtime-maintenance.js'
import { withOfflineStorageFence } from '../../deploy/enterprise/controller/offline-storage.mjs'

// Explicit operator command for the isolated delivery environment. No HTTP
// route, arbitrary shell command, automatic restart/admission or production DB.
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/enterprise-haas-hybrid-refactor')
assert.equal(process.argv.length, 3, 'One private operator configuration is required')
const privateJson = path => {
  const stat = lstatSync(path)
  assert.equal(realpathSync(path), path)
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && stat.nlink === 1
    && (stat.mode & 0o077) === 0 && stat.size <= 32 * 1024)
  return JSON.parse(readFileSync(path, 'utf8'))
}
const configuration = privateJson(process.argv[2])
assert.deepEqual(Object.keys(configuration).sort(), ['databaseConfigPath', 'oldContainerId', 'request', 'storage'])
const config = privateJson(configuration.databaseConfigPath), storage = configuration.storage
const url = new URL(config.ownerUrl)
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/haas_e2e')
assert.ok(url.port && !['3080', '5432', '10012'].includes(url.port))
const origin = new URL(configuration.request.expectedOrigin)
assert.equal(origin.origin, configuration.request.expectedOrigin); assert.equal(origin.hostname, '127.0.0.1')
assert.equal(origin.protocol, 'http:'); assert.ok(Number(origin.port) >= 1024 && origin.port !== '3080')
assert.equal(storage.ownerLabels['io.paimind.runtime-cell'], configuration.request.cellId)
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 ** 2 }).trim()
assert.match(config.containerId, /^[a-f0-9]{64}$/)
const [database] = JSON.parse(docker(['inspect', config.containerId]))
assert.equal(database.Config.Labels['paimind.role'], 'identity-e2e-only')
assert.ok(database.NetworkSettings.Ports['5432/tcp'].some(row => row.HostIp === '127.0.0.1' && row.HostPort === url.port))
const oldId = configuration.oldContainerId
assert.ok(oldId === null || typeof oldId === 'string' && /^[a-f0-9]{64}$/.test(oldId))
const inspectOld = () => {
  const [state] = JSON.parse(docker(['inspect', oldId]))
  assert.equal(state.Id, oldId); assert.equal(state.Image, storage.imageId)
  for (const [key, value] of Object.entries(storage.ownerLabels)) assert.equal(state.Config.Labels[key], value)
  assert.equal(state.Config.User, '10001:10001'); assert.equal(state.HostConfig.ReadonlyRootfs, true)
  assert.equal(state.HostConfig.Privileged, false); assert.equal(state.HostConfig.NetworkMode, 'none')
  assert.ok(!state.HostConfig.Binds?.length && !Object.keys(state.HostConfig.PortBindings ?? {}).length)
  assert.equal(state.Mounts.filter(row => row.Type === 'volume').length, 1)
  assert.ok(state.Mounts.some(row => row.Type === 'volume' && row.Name === storage.volume && row.Destination === '/var/lib/paimind'))
  return state
}
if (oldId) inspectOld()
process.umask(0o077)
const evidence = await mkdtemp(join(dirname(process.argv[2]), 'runtime-maintenance-'))
const events = []
const sql = createRequire(join(root, 'apps/enterprise-server/package.json'))('postgres')(config.ownerUrl,
  { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { statement_timeout: 5000, lock_timeout: 5000 } })
const maintenance = new RuntimeMaintenance(sql)
try {
  const result = await maintenance.whileSuspended(configuration.request, async fence => {
    events.push({ event: 'runtime-binding-suspended', fence })
    if (oldId) {
      await maintenance.requireSuspended(fence)
      if (inspectOld().State.Running) docker(['stop', '--time', '15', oldId])
      const stopped = inspectOld(); assert.equal(stopped.State.Running, false)
      events.push({ event: 'old-runtime-joined', id: oldId, state: stopped.State })
      docker(['rm', oldId]); events.push({ event: 'old-runtime-removed', id: oldId, userVolumeRemoved: false })
    }
    await maintenance.requireSuspended(fence)
    return withOfflineStorageFence({ ...storage, record: async event => { events.push(event) } }, async controller => {
      await maintenance.requireSuspended(fence)
      const before = await controller.inspect()
      if (before.lock) await controller.quarantine(before)
      const after = await controller.inspect()
      assert.equal(after.lock, null); assert.equal(after.activeGeneration, before.activeGeneration)
      await maintenance.requireSuspended(fence)
      return { operationId: fence.operationId, cellId: fence.cellId, activeGeneration: after.activeGeneration,
        bindingStatus: 'suspended', runtimeRestarted: false, memberAdmissionVerified: false }
    })
  })
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ status: 'STORAGE_MAINTAINED_BINDING_SUSPENDED', evidence, operationId: result.operationId }))
} finally {
  await writeFile(join(evidence, 'events.json'), JSON.stringify(events, null, 2), { flag: 'wx', mode: 0o600 })
  await sql.end({ timeout: 5 })
}
