import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// Real published native composition, but NOT a browser or member acceptance.
// This runs only in a disposable, offline, unbound container. Tools deny all;
// no model, business record, identity database or existing volume is accessed.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const runtimeRoot = '/opt/paimind', profileHome = '/usr/share/paimind/managed'
const workspace = '/var/lib/paimind/workspace'
for (const path of [workspace, '/var/lib/paimind/home', '/var/lib/paimind/dsh-home']) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}
process.chdir(workspace)
const modulePath = await realpath(runtimeRoot + '/node_modules/@paimind/harness-compat/lib/managed-runtime.js')
assert.ok(modulePath.startsWith(runtimeRoot + '/node_modules/'))
const { bootManagedHarnessProfile } = await import(pathToFileURL(modulePath).href)
const { harnessDocumentContentPolicy } = await import(pathToFileURL(
  await realpath(runtimeRoot + '/node_modules/@paimind/harness-compat/lib/gateway-transport.js')).href)
const management = [
  ['cordis-client-runner', '@deepseek-ai/dsh-cordis-client-runner'],
  ['ui-cordis', '@deepseek-ai/dsh-client-ui-cordis'],
  ['ui-settings-models', '@deepseek-ai/dsh-client-ui-settings-models'],
  ['ui-settings-plugins', '@deepseek-ai/dsh-client-ui-settings-plugins'],
  ['ui-settings-plugin-inventory', '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'],
]
const excluded = new Set(management.map(([, name]) => name))
const cycles = []
let baseline
for (const clientAudience of [undefined, 'member', undefined]) {
  let root
  try {
    root = await bootManagedHarnessProfile({ runtimeRoot, profileHome, profileName: 'web',
      installationManifest: runtimeRoot + '/node_modules/@deepseek-ai/dsh/package.json',
      args: ['--host', '127.0.0.1', '--port', '3210', '--no-open'],
      environment: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
      toolGuard: () => 'offline-client-roster-diagnostic-denies-all', clientAudience,
      requestExit: () => { throw Error('Unexpected native exit') }, prepare: value => { root = value },
    })
    // The original Feature Pack owner reconciles asynchronously after native
    // boot. Observe its real status before treating a transient graph as final.
    let settled = false
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const view = await root.get('paimindFeaturePacks').describe()
      assert.equal(view.status, 'ready')
      assert.ok(view.packs.every(pack => pack.failure === undefined), 'Native product pack failed to activate')
      if (view.packs.every(pack => !(pack.desiredEnabled ?? pack.defaultEnabled) || pack.enabled)) { settled = true; break }
      await delay(50)
    }
    assert.ok(settled, 'Native product pack owner did not finish its startup reconciliation')
    await root.loader.await()
    const entries = [...root.loader.entries()]
    for (const [id, name] of management) {
      const rows = entries.filter(row => row.options.id === id)
      assert.equal(rows.length, 1); assert.equal(rows[0].options.name, name)
      assert.equal(rows[0].disabled, clientAudience === 'member')
    }
    const graph = root.get('clientModules').graph()
    const packages = graph.entries.map(row => row.id).sort()
    if (!baseline) baseline = packages
    assert.deepEqual(packages, clientAudience === 'member' ? baseline.filter(name => !excluded.has(name)) : baseline)
    for (const name of ['@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-workspace',
      '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-settings-general', '@deepseek-ai/dsh-client-ui-theme',
      '@paimind/agent-market', '@paimind/skill-market', '@paimind/extension-center', '@paimind/enterprise-admin']) {
      assert.ok(packages.includes(name), 'Required native/product client missing: ' + name)
    }
    for (const name of ['agents', 'agentPresets', 'workspaceRegistry', 'paimindAgentProfiles', 'paimindSkillInstaller', 'paimindFeaturePacks']) {
      assert.ok(root.get(name), 'Native/product owner missing: ' + name)
    }
    const response = await fetch('http://127.0.0.1:3210/', { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.ok(Buffer.byteLength(html) < 256 * 1024)
    const wire = html.match(/globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/u)
    assert.ok(wire, 'Native document bootstrap is missing')
    const served = JSON.parse(wire[1].trim().replace(/;$/u, ''))
    assert.deepEqual(served, graph, 'Served document must contain the original native graph')
    const audienceWires = [...html.matchAll(/globalThis\["__PAIMIND_CLIENT_AUDIENCE__"\] = ([\s\S]*?)<\/script>/gu)]
    assert.equal(audienceWires.length, clientAudience === 'member' ? 1 : 0)
    if (clientAudience === 'member') {
      assert.deepEqual(JSON.parse(audienceWires[0][1].trim().replace(/;$/u, '')), { schemaVersion: 1, audience: 'member' })
      assert.ok(audienceWires[0].index < html.indexOf('<script type="module"'), 'Member presentation must precede the browser module entry')
    }
    const policy = harnessDocumentContentPolicy(html, 'http://127.0.0.1:3210')
    assert.ok(!policy.includes("script-src 'unsafe-inline'"))
    let inlineScriptCount = 0
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
      if (/\bsrc\s*=/iu.test(script[1])) continue
      inlineScriptCount++
      const hash = createHash('sha256').update(script[2].replace(/\r\n?/gu, '\n')).digest('base64')
      assert.ok(policy.includes(`'sha256-${hash}'`), 'Native inline script is missing its exact CSP hash')
    }
    cycles.push({ audience: clientAudience ?? 'default', packages, managementClientCount: packages.filter(name => excluded.has(name)).length,
      nativeDocumentMatchesOwnerGraph: true, nativeAndProductOwnersRetained: true,
      presentationMarkers: audienceWires.length, audiencePrecedesBrowserEntry: true, inlineScriptCount, exactNativeCspHashesVerified: true })
  } finally { await root?.fiber.dispose() }
}
console.log(JSON.stringify({ status: 'NATIVE_MEMBER_CLIENT_ROSTER_PASSED', cycles,
  browserE2EVerified: false, memberAuthorizationVerified: false, finalWorkerImageAccepted: false }))
