import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

// Only copied to a disposable diagnostic image, not a runtime entry point.
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'arm64'); assert.equal(process.getuid(), 10001)
const workspace = '/var/lib/paimind/workspace'; const privateRoot = '/var/lib/paimind/dsh-home'
await mkdir(workspace, { mode: 0o700 }); await mkdir(privateRoot, { mode: 0o700 })
const secret = randomUUID()
await writeFile(`${privateRoot}/private-canary`, secret, { mode: 0o600, flag: 'wx' })
const parentNamespaces = Object.fromEntries(await Promise.all(['mnt', 'net', 'pid', 'user'].map(async kind => [kind, await readlink(`/proc/self/ns/${kind}`)])))
const server = createServer((_req, res) => res.end(secret))
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
const port = server.address().port
const childProgram = `
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,symlink} from 'node:fs/promises';
await new Promise(done=>process.stdin.once('data',done));
assert.equal(process.env.PAIMIND_PRIVATE_CANARY,undefined);
assert.equal(process.env.HOME,'/home/member');
assert.equal(process.getuid(),10001);
await assert.rejects(readFile('${privateRoot}/private-canary'),e=>e.code==='ENOENT');
await assert.rejects(writeFile('/usr/local/bin/paimind-probe-write','blocked'),e=>['EROFS','EACCES'].includes(e.code));
await symlink('${privateRoot}/private-canary','/workspace/escape-link');
await assert.rejects(readFile('/workspace/escape-link'),e=>e.code==='ENOENT');
await assert.rejects(fetch('http://127.0.0.1:${port}/',{signal:AbortSignal.timeout(1000)}));
await writeFile('/workspace/member-result.txt','member-workspace-write-succeeded');
await assert.rejects(readdir('/proc'),e=>e.code==='ENOENT');
console.log(JSON.stringify({status:'EXECUTION_DOMAIN_FEASIBILITY_PASSED',privateFileHidden:true,loopbackServiceUnreachable:true,
  parentProcessHidden:true,workspaceWrite:true,rootWriteRejected:true,parentEnvironmentScrubbed:true,symlinkEscapeRejected:true,
  procFilesystemExposed:false,
  nestedNamespacePolicyVerified:false,nativeSubprocessIntegrationVerified:false,memberAdmissionVerified:false}));
`
const args = ['--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net', '--unshare-uts', '--die-with-parent', '--new-session',
  '--info-fd', '3',
  '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
  '--dev', '/dev', '--size', '16777216', '--tmpfs', '/tmp', '--dir', '/home/member',
  '--bind', workspace, '/workspace', '--chdir', '/workspace', '--clearenv', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
  '--setenv', 'HOME', '/home/member', '--', '/usr/local/bin/node', '--input-type=module', '-e', childProgram]
const child = spawn('/usr/local/bin/bwrap', args, { env: { PATH: '/usr/bin:/bin', PAIMIND_PRIVATE_CANARY: secret }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
let stdout = ''; let stderr = ''; let namespaceInfo = ''
child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
const namespaceReadback = new Promise((done, reject) => {
  let reading = false
  child.stdio[3].on('data', bytes => {
    namespaceInfo += bytes
    let info; try { info = JSON.parse(namespaceInfo) } catch { return }
    if (reading) return
    reading = true
    void (async () => {
      assert.ok(Number.isInteger(info['child-pid']) && info['child-pid'] > 0)
      const uidMap = await readFile(`/proc/${info['child-pid']}/uid_map`, 'utf8')
      // The /dev setup namespace maps only outer uid 10001 to its uid 0;
      // bwrap's final nested namespace returns the command to uid 10001.
      assert.deepEqual(uidMap.trim().split(/\s+/).map(Number), [0, 10001, 1])
      done({ info, uidMap }); child.stdin.end('continue\n')
    })().catch(error => { child.kill('SIGKILL'); reject(error) })
  })
  child.stdio[3].once('end', () => { if (!reading) reject(Error(`Missing namespace readback: ${stderr}`)) })
})
const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
try {
  const [exit, { info, uidMap }] = await Promise.all([
    new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })) }),
    namespaceReadback,
  ])
  assert.deepEqual(exit, { code: 0, signal: null }, stderr)
  assert.equal(stderr, '')
  const receipt = JSON.parse(stdout.trim())
  for (const kind of ['mnt', 'net', 'pid']) {
    assert.ok(Number.isInteger(info[kind + '-namespace']))
    assert.notEqual(String(info[kind + '-namespace']), parentNamespaces[kind].match(/\[(\d+)\]/)[1])
  }
  assert.equal(await readFile(`${workspace}/member-result.txt`, 'utf8'), 'member-workspace-write-succeeded')
  assert.equal(await readFile(`${privateRoot}/private-canary`, 'utf8'), secret)
  console.log(JSON.stringify({ ...receipt, parentNamespaces, namespaceInfo: info, childUidMap: uidMap, parentPrivateFileUnchanged: true }))
} finally {
  clearTimeout(timeout)
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
}
