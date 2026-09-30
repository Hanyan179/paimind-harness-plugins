import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { createNativeControlBroker } from './native-control.mjs'

// Native profile bootstrap only. Admission, identity and member RPC policy
// remain control-plane/worker-plugin responsibilities; a candidate image is
// never sufficient to grant a user runtime binding.
const runtime = '/opt/paimind'
const data = '/var/lib/paimind'
const home = join(data,'home')
const dshHome = join(data,'dsh-home')
const workspace = join(data,'workspace')
const prepareStorage = process.argv[2] === '--prepare-storage'
const runStorage = process.argv[2] === '--run-storage'
const activateFrom = process.argv[2] === '--prepare-storage-from-and-activate'
const prepareFrom = process.argv[2] === '--prepare-storage-from' || activateFrom
const runActive = process.argv[2] === '--run-active-storage'
const activate = process.argv[2] === '--activate-storage'
const storedMode = prepareStorage || runStorage || prepareFrom || runActive || activate
assert.ok(process.argv.length === 2 || process.argv.length === 3 && (prepareStorage || runActive)
  || process.argv.length === 4 && (runStorage || prepareFrom) || process.argv.length === 5 && activate)
assert.equal(process.platform,'linux'); assert.equal(process.arch,'arm64')
assert.equal(process.versions.node,'24.19.0'); assert.equal(process.getuid(),10001); assert.equal(process.getgid(),10001)
assert.equal(process.env.HOME,home); assert.equal(process.env.DSH_HOME,dshHome)
assert.equal(await realpath(runtime),runtime)
for (const dir of [home,dshHome,workspace,join(data,'cache'),join(data,'config'),join(data,'data'),
  ...(storedMode ? [join(data,'storage-generations')] : []),
  ...(storedMode && !prepareStorage ? [join(data,'temporary'),join(data,'resources')] : [])]) {
  await mkdir(dir,{recursive:true,mode:0o700})
  const stat = await lstat(dir)
  assert.equal(await realpath(dir),dir)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 10001 && (stat.mode & 0o077) === 0)
}
const env = {PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,DSH_HOME:dshHome,NODE_ENV:'production',
  XDG_CACHE_HOME:join(data,'cache'),XDG_CONFIG_HOME:join(data,'config'),XDG_DATA_HOME:join(data,'data'),
  TMPDIR:'/tmp',CI:'true',NO_COLOR:'1',DSH_TELEMETRY_MODE:'DISABLED'}
const ingressEnabled = process.env.PAIMIND_CELL_INGRESS === '1'
assert.ok(process.env.PAIMIND_CELL_INGRESS === undefined || ingressEnabled, 'Invalid private ingress switch')
assert.ok(!ingressEnabled || runStorage || runActive, 'Private ingress requires prepared native storage')
assert.ok(process.env.PAIMIND_CELL_POLICY === undefined || ['member-personal-v1', 'admin-authoring-v1'].includes(process.env.PAIMIND_CELL_POLICY), 'Invalid managed cell policy switch')
if (process.env.PAIMIND_CELL_POLICY !== undefined) {
  assert.ok(ingressEnabled && (runStorage || runActive), 'Member policy requires private ingress and prepared storage')
  const { readPrivateCellFile } = await import('./native-ingress.mjs')
  const { parseManagedCellPolicy } = await import('./member-tool-policy.mjs')
  const policy = await readPrivateCellFile('member-policy.json')
  assert.equal(parseManagedCellPolicy(policy).policy, process.env.PAIMIND_CELL_POLICY, 'Private role capsule and operator policy differ')
  // Only the non-secret policy capsule crosses into the prepared runtime.
  // The transport key and private operator volume never enter that namespace.
  env.PAIMIND_MANAGED_CELL_POLICY = policy
}
let ingress
const control = ingressEnabled ? await createNativeControlBroker('/tmp', (input, signal) => {
  if (!ingress) throw new Error('Origin authority unavailable')
  return ingress.checkOrigins(input, signal)
}, (input, signal) => {
  if (!ingress) throw new Error('Execution authority unavailable')
  return ingress.authorizeExecution(input, signal)
}, (input, signal) => {
  if (!ingress) throw new Error('Delegation authority unavailable')
  return ingress.deriveOrigins(input, signal)
}, (input, signal) => {
  if (!ingress) throw new Error('Job origin authority unavailable')
  return ingress.sealJobOrigins(input, signal)
}, (input, signal) => {
  if (!ingress) throw new Error('Skill eligibility authority unavailable')
  return ingress.readSkillEligibility(input, signal)
}, (input, signal) => {
  if (!ingress) throw new Error('Connector authority unavailable')
  return ingress.readConnectorApproval(input, signal)
}, (input, signal) => {
  if (!ingress) throw new Error('Connector authority unavailable')
  return ingress.authorizeConnectorExecution(input, signal)
}) : undefined
if (control) env.PAIMIND_NATIVE_CONTROL_DIRECTORY = control.directory
try { ingress = ingressEnabled ? await (await import('./native-ingress.mjs')).startPrivateNativeIngress((...args) => control.request(...args)) : undefined }
catch (error) { await control?.close(); throw error }
// The native bootstrap adapter reads only the image-owned composition, never
// rewrites a member's profile, and does not install configuration watchers.
// Explicit offline command only: the operator must keep the cell unbound and
// exclusively own its data. Normal startup remains sealed and never silently
// copies live workspaces or activates a newly prepared layout.
const child = spawn(process.execPath,[`/usr/local/lib/paimind/${prepareStorage ? 'prepare-native-storage' : storedMode ? 'run-prepared-runtime' : 'boot-native-runtime'}.mjs`,
  ...(activate ? ['--activate',process.argv[3],process.argv[4]] : runActive ? ['--active']
    : prepareFrom ? [activateFrom ? '--prepare-next-and-activate' : '--prepare-next',process.argv[3]] : runStorage ? [process.argv[3]] : [])],
  {cwd:workspace,env,stdio:'inherit'})
let stopping = false
let ingressFailed = false
ingress?.server.on('error', () => { ingressFailed = true; void ingress.close(); child.kill('SIGTERM') })
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{stopping=true;void ingress?.close();child.kill(signal)})
child.once('error',error=>{void ingress?.close();process.stderr.write(`Native runtime process error: ${error.message}\n`);process.exitCode=1})
child.once('close',async (code,signal)=>{
  await ingress?.close()
  await control?.close()
  process.stdout.write(`${JSON.stringify({event:'native-process-closed',code,signal,stopping})}\n`)
  process.exitCode = ingressFailed ? 1 : code ?? (stopping && ['SIGTERM','SIGINT'].includes(signal) ? 0 : 1)
})
