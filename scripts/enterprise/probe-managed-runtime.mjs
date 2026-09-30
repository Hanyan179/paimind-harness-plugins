import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

// This diagnostic is copied only to its labelled, disposable image, never to
// the production carrier. It controls only the two children it creates here.
assert.equal(process.getuid(), 10001); assert.equal(process.platform, 'linux')
assert.equal(process.versions.node, '24.19.0')
assert.equal(process.argv.length, 2)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const controlled = '/usr/share/paimind/managed/profiles/web'
const configBefore = hash(await readFile(`${controlled}/cordis.yml`))
await assert.rejects(access(`${controlled}/cordis.yml`, constants.W_OK), error => ['EACCES', 'EROFS'].includes(error.code))
await assert.rejects(writeFile(`${controlled}/cordis.patch.yml`, 'untrusted'), error => ['EACCES', 'EROFS'].includes(error.code))
const member = '/var/lib/paimind/dsh-home'
const workspace = '/var/lib/paimind/workspace'
for (const path of [member, workspace, `${member}/profiles/web`]) await mkdir(path, { recursive: true, mode: 0o700 })
const poison = async () => {
  await writeFile(`${member}/cordis.patch.yml`, 'not: a valid patch list\n')
  await writeFile(`${member}/profiles/web/cordis.yml`, '- name: invalid-member-module\n')
  await writeFile(`${member}/profiles/web/package.json`, '{"dsh":{"profile":{"bundles":["invalid-member-bundle"]}}}\n')
  await writeFile(`${member}/profiles/web/cordis.patch.yml`, '- id: paimind-enterprise-admin\n  disabled: true\n')
  // The interactive CLI rejects these bootstrap-only variables in .env.
  // A managed bootstrap must not even import this member-owned layer.
  await writeFile(`${member}/.env`, 'DSH_HOME=/invalid-member-home\n')
  await writeFile(`${workspace}/.env`, 'DSH_HOME=/invalid-member-workspace\n')
}
await poison()
const cycles = []
for (let cycle = 0; cycle < 2; cycle += 1) {
  const child = spawn(process.execPath, ['/usr/local/lib/paimind/start-native-runtime.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; let closed = false
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    log += bytes.toString(); assert.ok(log.length < 1_048_576, 'Native diagnostic log exceeded its bound')
  })
  const end = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { closed = true; resolve({ code, signal }) })
  })
  const checks = []
  try {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && checks.length < 2) {
      assert.equal(closed, false, `Native child exited: ${log}`)
      try {
        const response = await fetch('http://127.0.0.1:3210/', { signal: AbortSignal.timeout(1500) })
        const html = await response.text()
        assert.equal(response.status, 200)
        for (const marker of ['__DSH_BOOT__', '@paimind/enterprise-admin', '@paimind/extension-center']) assert.ok(html.includes(marker))
        checks.push({ status: response.status, bytes: Buffer.byteLength(html) })
      } catch { checks.length = 0 }
      if (checks.length < 2) await delay(1000)
    }
    assert.equal(checks.length, 2, `Managed native readiness failed: ${log}`)
    await poison()
    await delay(1500)
    assert.equal(closed, false, 'Member file changes must not reload the managed native tree')
    const ready = log.split('\n').map(line => { try { return JSON.parse(line) } catch { return undefined } })
      .find(row => row?.event === 'managed-native-profile-ready')
    assert.deepEqual(ready, { event: 'managed-native-profile-ready', nativeToolGuardActive: true,
      toolPolicy: 'candidate-not-admitted', memberAdmissionVerified: false })
    assert.ok(!/Error \[|Error:|plugin tree failed to load|bootstrap failed/.test(log), log)
    assert.equal(hash(await readFile(`${controlled}/cordis.yml`)), configBefore)
  } finally {
    if (!closed) child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
    const result = await end
    clearTimeout(timeout)
    process.stderr.write(log)
    assert.deepEqual(result, { code: 0, signal: null }, 'Owned native process must stop cleanly')
  }
  cycles.push({ cycle, checks, nativeToolGuardActive: true, toolPolicy: 'candidate-not-admitted',
    userPatchIgnored: true, userEnvironmentIgnored: true, controlledConfigUnchanged: true })
}
console.log(JSON.stringify({ status: 'MANAGED_NATIVE_COMPOSITION_BOUNDARY_PASSED', cycles,
  immutableProfileWriteRejected: true, sameContainerDataRetainedAcrossNativeRestart: true,
  memberAuthorizationVerified: false, browserE2EVerified: false, finalWorkerImageAccepted: false }))
