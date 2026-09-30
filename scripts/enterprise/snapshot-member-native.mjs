import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { build } from 'esbuild'
import { readNativeReadbackJson } from './native-readback-response.mjs'

// Operator-only independent native readback. No browser, login, model call,
// native business write, restart or user-volume removal. Full histories stay
// private. This does not stand in for authenticated gateway/Browser E2E tests.
const options = process.argv.slice(4)
const includeAgentAudit = options.at(-1) === '--with-agent-audit'
if (includeAgentAudit) options.pop()
assert.ok(process.argv.length >= 4 && options.length <= 1)
const baselinePath = options[0]
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/enterprise-haas-hybrid-refactor')
const evidenceRoot = await realpath(join(root, '../.paimind-goal-evidence'))
const runtime = await realpath(process.argv[2]), output = resolve(process.argv[3])
assert.equal(dirname(runtime), evidenceRoot)
assert.ok(runtime.startsWith(evidenceRoot + '/haas-member-browser-cells-'))
assert.equal(dirname(await realpath(dirname(output))), evidenceRoot)
async function privateJson(path) {
  const stat = await lstat(path)
  assert.equal(await realpath(path), path)
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && !(stat.mode & 0o077))
  return JSON.parse(await readFile(path, 'utf8'))
}
const operator = await privateJson(join(runtime, 'operator-state.json'))
const config = await privateJson(join(runtime, 'gateway-config.json'))
const compiled = await build({ entryPoints: [join(root, 'apps/enterprise-server/src/cell-transport.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false })
const transportBytes = compiled.outputFiles[0].contents
const transportSha256 = createHash('sha256').update(transportBytes).digest('hex')
const { CellTransport } = await import('data:text/javascript;base64,' + Buffer.from(transportBytes).toString('base64'))
assert.equal(operator.sourceRoot, root); assert.equal(config.publicOrigin, 'http://127.0.0.1:62167')
assert.deepEqual(operator.cells.map(cell => cell.member).sort(), ['alex', 'hansen'])
const snapshots = [], runtimeRows = []
for (const cell of operator.cells) {
  const [container] = JSON.parse(execFileSync('docker', ['inspect', cell.pin.containerId], { encoding: 'utf8' }))
  assert.equal(container.Image, cell.pin.imageId); assert.equal(container.State.Running, true)
  assert.equal(container.Config.User, '10001:10001'); assert.equal(container.HostConfig.ReadonlyRootfs, true)
  assert.ok(container.Mounts.some(mount => mount.Type === 'volume' && mount.Name === cell.pin.volumeName))
  const configured = config.nativePrivateCells.find(row => row.cellId === cell.pin.cellId)
  assert.ok(configured)
  for (const [key, value] of Object.entries(cell.pin)) assert.equal(configured[key], value)
  const origin = new URL(cell.pin.origin)
  assert.equal(origin.hostname, '127.0.0.1'); assert.equal(origin.protocol, 'http:')
  assert.ok(origin.port && !['3080', '62167', '51481'].includes(origin.port))
  const agent = new CellTransport(cell.pin.origin, configured.transportKey)
  const nativeOrigin = new URL(agent.nativeOrigin)
  const rpc = (method, payload = {}) => new Promise((done, reject) => {
    const rpcId = randomUUID()
    const body = JSON.stringify({ type: 'client-request', rpcId, method,
      payload: method.includes('/') ? { args: payload } : payload })
    const req = request(new URL('/api/' + method, nativeOrigin), { agent, method: 'POST', headers: {
      origin: nativeOrigin.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
    } }, async response => {
      try {
        assert.equal(response.statusCode, 200)
        const wire = await readNativeReadbackJson(response)
        assert.equal(wire.rpcId, rpcId); assert.equal(wire.result.ok, true)
        done(wire.result.value)
      } catch (error) { reject(error) }
    })
    req.setTimeout(10000, () => req.destroy(Error('Bounded native readback timed out')))
    req.once('error', reject); req.end(body)
  })
  try {
    const initial = await rpc('session.list'), histories = []
    // Original history reads activate only each existing Preset's read scope,
    // so cold list projections are compared after their native owner loads them.
    for (const session of initial.items) {
      histories.push({ sessionId: session.sessionId, history: await rpc('session.history', { sessionId: session.sessionId, maxMessages: 100 }) })
    }
    snapshots.push({ member: cell.member, profiles: await rpc('paimindAgentProfiles/listProfiles'),
      presets: await rpc('agentPreset.list'), workspaces: await rpc('workspace.list'),
      sessions: await rpc('session.list'), bindings: await rpc('paimindAgentProfiles/listSessionBindings'),
      ...(includeAgentAudit ? { agentAudit: await rpc('paimindAgentProfiles/listAudit') } : {}),
      histories: histories.sort((a, b) => a.sessionId.localeCompare(b.sessionId)) })
    runtimeRows.push({ member: cell.member, containerId: container.Id, imageId: container.Image,
      startedAt: container.State.StartedAt, cellId: cell.pin.cellId, volumeName: cell.pin.volumeName })
  } finally { agent.destroy() }
}
snapshots.sort((a, b) => a.member.localeCompare(b.member))
process.umask(0o077)
await writeFile(output, JSON.stringify({ at: new Date().toISOString(), runtime, runtimeRows, transportSha256, snapshots,
  browserE2EVerified: false, modelCallsMade: false }, null, 2), { mode: 0o600, flag: 'wx' })
if (baselinePath) {
  const before = await privateJson(await realpath(baselinePath))
  // Full private snapshots remain on disk; never dump history or signed sources
  // through assertion diffs into the operator's terminal or conversation.
  assert.ok(isDeepStrictEqual(snapshots, before.snapshots), 'Native state differs; preserve the snapshots and inspect before accepting recovery')
}
console.log(JSON.stringify({ status: 'NATIVE_MEMBER_READBACK_SAVED', output, matchesBaseline: Boolean(baselinePath), includeAgentAudit,
  members: snapshots.map(row => ({ member: row.member, agents: row.profiles.profiles.length,
    sessions: row.sessions.items.length, bindings: row.bindings.bindings.length, histories: row.histories.length })),
  browserE2EVerified: false, modelCallsMade: false }))
