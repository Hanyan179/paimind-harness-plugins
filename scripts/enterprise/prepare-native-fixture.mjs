import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A fresh, synthetic native composition. Never clone the main runtime home or
// its credentials. This prepares a profile only; it does not expose a Worker.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.argv.length > 3) throw new Error('Use no argument, or the exact incomplete fixture directory')
const resumed = process.argv[2]
const evidence = resumed ? resolve(resumed) : await mkdtemp(resolve(root, '../.paimind-goal-evidence/haas-native-'))
const dshHome = resolve(evidence, 'dsh-home')
if (resumed) {
  const receipt = JSON.parse(await readFile(resolve(evidence, 'fixture.json'), 'utf8'))
  if (receipt.schema !== 'paimind.native-fixture/v1' || receipt.root !== root || receipt.dshHome !== dshHome
    || receipt.state !== 'preparing' || receipt.exposure !== 'none') throw new Error('Not this goal\'s incomplete unexposed native fixture')
} else await mkdir(dshHome, { mode: 0o700 })
const dsh = resolve(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  DSH_HOME: dshHome, CI: '1', NO_COLOR: '1' }
if (!resumed) await writeFile(resolve(evidence, 'fixture.json'), JSON.stringify({ schema: 'paimind.native-fixture/v1',
  state: 'preparing', dshHome, root, nativeVersion: '0.1.1-rc.2', exposure: 'none',
  acceptance: 'Native composition preparation only; no enterprise E2E claim',
}, null, 2), { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ state: 'preparing', evidence, dshHome }))
async function command(args, label) {
  const child = spawn(process.execPath, [dsh, ...args], { cwd: evidence, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
  await writeFile(resolve(evidence, `${label}.log`), output, { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ label, code, evidence }))
  if (code !== 0) throw new Error(`${label} failed; inspect its private log`)
  return output
}
if (!resumed) {
  await command(['--profile', 'web', '--dump-config'], 'initialize')
  await command(['plugin', '--profile', 'web', 'add', '--offline', resolve(root, 'packages/enterprise-admin')], 'install-enterprise-plugin')
}
const profile = JSON.parse(await readFile(resolve(dshHome, 'profiles/web/package.json'), 'utf8'))
if (!profile.dependencies?.['@paimind/enterprise-admin']?.includes(resolve(root, 'packages/enterprise-admin'))) {
  throw new Error('The exact local enterprise plugin was not installed in this fixture')
}
const patch = resolve(evidence, 'enterprise-native.patch.yml')
await writeFile(patch, "- insert:\n    - id: paimind-enterprise-admin\n      name: '@paimind/enterprise-admin'\n", { mode: 0o600, flag: 'wx' })
const composed = await command(['--profile', 'web', '--patch', patch, '--dump-config'], 'composition-with-plugin')
if (!composed.includes('@paimind/enterprise-admin')) throw new Error('Native composition omitted the installed enterprise plugin')
await writeFile(resolve(evidence, 'ready.json'), JSON.stringify({ state: 'profile-prepared', dshHome, evidence,
  patch, plugin: '@paimind/enterprise-admin', exposure: 'none', browserAcceptance: 'pending' }, null, 2), { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ state: 'profile-prepared', evidence, dshHome }))
