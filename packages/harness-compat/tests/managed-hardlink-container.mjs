import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile, link, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createCandidateExecutionDomain } from '/usr/local/lib/paimind/confine-execution.mjs'

// Adversarial inode-alias seed in a disposable image only. No member data.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 10001)
const require = createRequire(await realpath('/opt/paimind/node_modules/@paimind/harness-compat/package.json'))
const base = createRequire(await realpath('/opt/paimind/node_modules/@deepseek-ai/dsh-base/package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { LocalSandboxProvider } = await import(pathToFileURL(base.resolve('@deepseek-ai/dsh-sandbox-local')).href)
const { createManagedHarnessSubprocessProvider } = await import(pathToFileURL(require.resolve('@paimind/harness-compat/managed-subprocess')).href)
const workspace = '/var/lib/paimind/workspaces/hansen'
const project = workspace + '/client-project'; const neighbor = workspace + '/internal-project'
const domain = createCandidateExecutionDomain(workspace)
for (const path of [project, neighbor, domain.resourceRoot, domain.temporaryRoot]) await mkdir(path, { recursive: true, mode: 0o700 })
const original = neighbor + '/original'; const alias = project + '/linked'
await writeFile(original, 'neighbor-original', { mode: 0o600, flag: 'wx' }); await link(original, alias)
assert.equal((await stat(original)).ino, (await stat(alias)).ino)
const root = new Context()
try {
  await root.plugin(LocalSandboxProvider)
  await root.plugin(createManagedHarnessSubprocessProvider(domain, root.sandbox))
  const code = `import{writeFile,chmod}from'node:fs/promises';const results={};
    for(const[name,operation]of Object.entries({write:()=>writeFile(${JSON.stringify(alias)},'alias-write'),chmod:()=>chmod(${JSON.stringify(alias)},0o777)})){
      try{await operation();results[name]='ALLOWED'}catch(error){results[name]=error.code}}
    console.log(JSON.stringify(results));`
  const command = root.sandbox.confine(['/usr/local/bin/node', '--input-type=module', '-e', code],
    { mode: 'workspace-write', workspaceRoot: project })
  const handle = root.subprocess.spawn({ argv: command.argv, cwd: project, graceMs: 200,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
  try {
    assert.equal((await handle.done).exitCode, 0, handle.collected.stderr.readFrom(0).text)
    await handle.waitForExit()
    const observed = { command: JSON.parse(handle.collected.stdout.readFrom(0).text),
      peerContentChanged: await readFile(original, 'utf8') !== 'neighbor-original', peerMode: (await stat(original)).mode & 0o777,
      memberAdmissionVerified: false }
    console.log(JSON.stringify({ nativeExistingHardlinkReadback: observed }))
    assert.equal(observed.peerContentChanged, false, 'A narrowed write must not mutate its read-only neighboring project through an existing inode alias')
    assert.equal(observed.peerMode, 0o600, 'A narrowed write must not alter neighboring inode metadata through an existing alias')
  } finally { handle.terminate(); await handle.waitForExit() }
} finally { await root.fiber.dispose() }
