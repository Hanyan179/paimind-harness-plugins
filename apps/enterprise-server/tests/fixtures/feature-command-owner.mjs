// Isolated native Settings/Loader lifecycle probe, not a complete web profile,
// private production control transport, approved enterprise operation or E2E.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConnection } from 'node:net'
import { createNativeControlPeer, handleNativeControl } from '../../../../deploy/enterprise/worker/runtime/native-control.mjs'

assert.equal(process.env.PAIMIND_FEATURE_OWNER_TEST, '1'); assert.ok(process.send)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const directory = process.cwd()
assert.ok(directory.startsWith(dirname(repo) + '/.paimind-goal-evidence/haas-feature-owner-'))
const local = createRequire(join(repo, 'package.json')), native = createRequire(local.resolve('@deepseek-ai/dsh/package.json'))
const { Context } = native('@deepseek-ai/cordis')
const { Loader, Group } = native('@deepseek-ai/cordis-plugin-loader')
const { FileSettingsProvider } = native('@deepseek-ai/dsh-settings-file')
const { PaimindFeaturePackService, PAIMIND_FEATURE_PACKS } = await import(pathToFileURL(join(repo, 'packages/extension-center/lib/index.js')))
const namespace = 'paimind-feature-packs', filename = join(directory, 'settings.json')
let root, owner, peer, failPhase, releaseGate, held, tail = Promise.resolve()
const live = new Set(), transitions = []
async function settle() {
  // An observer only: no owner private queue mutation or synthetic lifecycle.
  const deadline = performance.now() + 5000
  for (;;) {
    await root.loader.await()
    if (owner && owner.bootSettled) { await owner.reconciliation; return }
    if (performance.now() >= deadline) throw Error('Original owner boot did not settle')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
async function snapshot() {
  return { pid: process.pid, ...(await owner.describeGovernedFeatures()), live: [...live].sort(), transitions: [...transitions],
    document: JSON.parse(await readFile(filename, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error })) }
}
const commands = {
  async boot() {
    assert.ok(!root); root = new Context()
    await root.plugin(FileSettingsProvider, { path: filename, watch: false })
    await root.plugin(Loader, { baseUrl: pathToFileURL(repo + '/').href })
    root.loader.builtins.group = Group
    root.loader.builtins['feature-command-canary'] = (ctx, config) => {
      ctx.effect(() => {
        assert.ok(!live.has(config.id)); live.add(config.id); transitions.push({ id: config.id, active: true })
        return async () => {
          live.delete(config.id); transitions.push({ id: config.id, active: false })
          if (config.id === 'paimind-pack-operations' && held) await held
        }
      })
    }
    const entries = PAIMIND_FEATURE_PACKS.flatMap(pack => [pack.loaderEntryId, ...pack.capabilities.map(cap => cap.loaderEntryId)])
    for (const id of entries) await root.loader.root.create({ id, name: 'cordis:group', group: true, disabled: true,
      config: [{ id: id + '-canary', name: 'cordis:feature-command-canary', config: { id } }] })
    // No WebServer is needed by the service constructor; the package's browser
    // watchdog and HTTP routes are deliberately outside this component probe.
    owner = new PaimindFeaturePackService(root)
    await settle(); return snapshot()
  },
  async plan(selection) { return owner.previewGovernedChange(selection) },
  async apply(command) { return owner.applyGovernedChange(command) },
  async snapshot() { await settle(); return snapshot() },
  async connect({ path }) {
    assert.ok(!peer && typeof path === 'string' && resolve(directory, path).startsWith(repo + '/paimind-native-control-'))
    assert.ok(path.endsWith('/control.sock'))
    peer = createNativeControlPeer(createConnection(path), { handle: (operation, input, signal) => handleNativeControl(root, operation, input, signal) })
    return { connected: true }
  },
  async holdDisable() { assert.ok(!held); held = new Promise(resolve => { releaseGate = resolve }); return { armed: true } },
  async releaseDisable() { releaseGate?.(); releaseGate = undefined; held = undefined; await settle(); return snapshot() },
  async failReceipt({ phase }) {
    assert.ok(['applying', 'applied', 'rolling-back', 'rolled-back'].includes(phase)); assert.equal(failPhase, undefined)
    failPhase = phase
    const settings = root.settings, original = settings.mutate.bind(settings)
    // Fault injection intercepts one completion write only. Intent persistence,
    // namespace validation, atomic document writes and all Loader work are real.
    settings.mutate = async (ns, ops, revision) => {
      const journal = ops.find(op => op.op === 'set' && op.path[0] === 'governance')
      if (ns === namespace && journal && JSON.parse(journal.value).phase === failPhase) throw Error('Injected lost completion write')
      return original(ns, ops, revision)
    }
    return { armed: true }
  },
  async stop() { releaseGate?.(); held = undefined; peer?.close(); await root?.fiber.dispose(); return { live: [...live], stopped: true } },
}
process.on('message', message => {
  tail = tail.then(async () => {
    try {
      assert.ok(message && typeof message.id === 'string' && Object.hasOwn(commands, message.operation))
      const value = await commands[message.operation](message.input)
      process.send({ id: message.id, value })
      if (message.operation === 'stop') process.disconnect()
    } catch (error) { process.send({ id: message.id, error: { name: error.name, message: error.message } }) }
  })
})
