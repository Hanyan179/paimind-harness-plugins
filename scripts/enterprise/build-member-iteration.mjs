import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Fast immutable deployment-file iteration over the recorded full native base.
// --managed-compat additionally compiles the explicit managed compatibility
// entries from frozen source. --member-client also includes the exact already
// built enterprise, extension-center and agent-center browser artifacts. None is full-source/
// final acceptance.
const memberClient = process.argv[2] === '--member-client'
const managedCompat = process.argv[2] === '--managed-compat' || memberClient
assert.ok(process.argv.length === 2 || process.argv.length === 3 && managedCompat)
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const baseTag = 'paimind-enterprise-runtime-candidate:f111bebd2330-b5353970'
const baseId = 'sha256:e5b1eae8406bedc771c70368e804ae5a26c80913b7ba3d726fc003bfb7455ac7'
assert.equal(JSON.parse(execFileSync('docker', ['image', 'inspect', baseTag], { encoding: 'utf8' }))[0].Id, baseId)
process.umask(0o077)
const evidence = await mkdtemp(join(await realpath(join(root, '../.paimind-goal-evidence')), 'haas-member-image-'))
const context = join(evidence, 'context'); await mkdir(context); await mkdir(join(context, 'managed-profile'))
const names = ['start-native-runtime.mjs', 'native-ingress.mjs', 'boot-native-runtime.mjs', 'member-tool-policy.mjs',
  'native-control.mjs', 'run-prepared-runtime.mjs', 'prepared-storage.mjs',
  'managed-profile/package.json', 'managed-profile/cordis.yml', 'managed-profile/cordis.patch.yml']
const inputs = []
for (const name of names) {
  const source = `deploy/enterprise/worker/runtime/${name}`
  await copyFile(join(root, source), join(context, name))
  inputs.push({ source, sha256: createHash('sha256').update(await readFile(join(context, name))).digest('hex') })
}
const compiledEntries = []
if (memberClient) {
  for (const [packageName, folder, marker] of [
    ['enterprise-admin', 'enterprise-client', 'authenticated native Settings navigation'],
    ['extension-center', 'extension-client', 'member extension presentation, not management readiness'],
    ['agent-market', 'agent-client', 'Invalid Agent Center presentation metadata'],
  ]) {
    await mkdir(join(context, folder))
    for (const name of ['client.js', 'client.js.map']) {
      const source = `packages/${packageName}/lib/${name}`
      const bytes = await readFile(join(root, source))
      if (name === 'client.js') assert.ok(bytes.includes(Buffer.from(marker)),
        `Build the current ${packageName} client before assembling the iteration image`)
      await writeFile(join(context, folder, name), bytes)
      inputs.push({ source, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    await writeFile(join(context, `install-${folder}.mjs`), `import assert from'node:assert/strict';
import{copyFileSync,readFileSync,realpathSync,chmodSync}from'node:fs';
const root='/opt/paimind',dest=realpathSync(root+'/node_modules/@paimind/${packageName}');assert.ok(dest.startsWith(root+'/'));
assert.equal(JSON.parse(readFileSync(dest+'/package.json')).name,'@paimind/${packageName}');
for(const name of ['client.js','client.js.map']){const path=dest+'/lib/'+name;copyFileSync('/usr/local/lib/paimind/${folder}/'+name,path);chmodSync(path,0o444)}
`)
  }
}
let compilerPrefix = ''
if (managedCompat) {
  const sources = join(context, 'compat-source'); await mkdir(sources)
  const compiled = join(context, 'compat-lib'); await mkdir(compiled)
  const entries = ['managed-runtime', 'managed-subprocess', 'managed-filesystem', 'managed-directory-picker', 'managed-code-runtime', 'managed-workflow']
  for (const name of [...entries, 'managed-storage', 'managed-json-pipe', 'client-audience']) {
    const source = `packages/harness-compat/src/${name}.ts`
    await copyFile(join(root, source), join(sources, name + '.ts'))
    inputs.push({ source, sha256: createHash('sha256').update(await readFile(join(sources, name + '.ts'))).digest('hex') })
  }
  const source = 'packages/harness-compat/package.json'
  await copyFile(join(root, source), join(context, 'compat-package.json'))
  inputs.push({ source, sha256: createHash('sha256').update(await readFile(join(context, 'compat-package.json'))).digest('hex') })
  for (const name of ['execution-launch.c', 'confine-execution.mjs']) {
    const source = `deploy/enterprise/worker/runtime/${name}`
    await copyFile(join(root, source), join(context, name))
    inputs.push({ source, sha256: createHash('sha256').update(await readFile(join(context, name))).digest('hex') })
  }
  const dockerfile = await readFile(join(root, 'deploy/enterprise/worker/Dockerfile'), 'utf8')
  inputs.push({ source: 'deploy/enterprise/worker/Dockerfile', sha256: createHash('sha256').update(dockerfile).digest('hex') })
  // Reuse the pinned OS and already required native C toolchain, without
  // fetching an unrelated JS package manager for a C-only iteration. Compiler
  // provisioning alone has network; compilation/final assembly do not.
  const pinnedBase = dockerfile.match(/^FROM (node:[^ ]+@sha256:[a-f0-9]{64}) AS build-base$/m)?.[1]
  assert.ok(pinnedBase)
  compilerPrefix = `# syntax=docker/dockerfile:1.7
FROM ${pinnedBase} AS directory-tools
RUN --network=default apt-get update && apt-get install --yes --no-install-recommends gcc libc6-dev
WORKDIR /build
COPY --chown=0:0 --chmod=0444 execution-launch.c /build/execution-launch.c
RUN --network=none gcc -std=c11 -Wall -Wextra -Werror -Wformat=2 -Wconversion -Wshadow -O2 -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wl,-z,relro,-z,now -o /build/execution-launch /build/execution-launch.c
`
  for (const entry of entries) {
    await build({ entryPoints: [join(sources, entry + '.ts')], outfile: join(compiled, entry + '.js'),
      bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external' })
    compiledEntries.push({ entry, sha256: createHash('sha256').update(await readFile(join(compiled, entry + '.js'))).digest('hex') })
  }
  // Both native picker packages are already in the fixed upstream web bundle.
  // Reuse their exact existing instances; no vendor code is copied or fetched.
  await writeFile(join(context, 'install-compat.mjs'), `import assert from'node:assert/strict';import{createRequire}from'node:module';
import{copyFileSync,readFileSync,realpathSync,symlinkSync,chmodSync}from'node:fs';import{dirname,join,relative}from'node:path';
const root='/opt/paimind',compat=realpathSync(root+'/node_modules/@paimind/harness-compat');assert.ok(compat.startsWith(root+'/'));
const web=createRequire(realpathSync(root+'/node_modules/@deepseek-ai/dsh-web-app/package.json'));
const auto=createRequire(web.resolve('@deepseek-ai/dsh-host-directory-picker-auto/package.json'));
for(const name of ['@deepseek-ai/dsh-host-directory-picker','@deepseek-ai/dsh-host-directory-picker-browse']){
 const manifest=auto.resolve(name+'/package.json'),source=dirname(manifest),info=JSON.parse(readFileSync(manifest));
 assert.equal(info.name,name);assert.equal(info.version,'0.1.1-rc.2');assert.ok(source.startsWith(root+'/'));
 const dest=join(dirname(dirname(compat)),name);try{symlinkSync(relative(dirname(dest),source),dest)}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(realpathSync(dest),source)}
}
copyFileSync('/usr/local/lib/paimind/compat-package.json',compat+'/package.json');chmodSync(compat+'/package.json',0o444);
for(const entry of ${JSON.stringify(entries)}){const dest=compat+'/lib/'+entry+'.js';copyFileSync('/usr/local/lib/paimind/compat-lib/'+entry+'.js',dest);chmodSync(dest,0o444)}
`)
}
const tag = `paimind-member-iteration:${randomUUID().slice(0, 8)}`
await writeFile(join(context, 'Dockerfile'), `${compilerPrefix}FROM ${baseTag}
USER 0:0
COPY --chown=0:0 --chmod=0444 *.mjs /usr/local/lib/paimind/
COPY --chown=0:0 --chmod=0444 managed-profile/ /usr/share/paimind/managed/profiles/web/
${managedCompat ? 'COPY --chown=0:0 --chmod=0444 compat-package.json /usr/local/lib/paimind/\nCOPY --chown=0:0 --chmod=0444 compat-lib/ /usr/local/lib/paimind/compat-lib/\nRUN --network=none node /usr/local/lib/paimind/install-compat.mjs\n' : ''}
${managedCompat ? 'COPY --from=directory-tools --chown=0:0 --chmod=0555 /build/execution-launch /usr/local/libexec/paimind-execution-launch\n' : ''}
${memberClient ? 'COPY --chown=0:0 --chmod=0444 enterprise-client/ /usr/local/lib/paimind/enterprise-client/\nRUN --network=none node /usr/local/lib/paimind/install-enterprise-client.mjs\n' : ''}
${memberClient ? 'COPY --chown=0:0 --chmod=0444 extension-client/ /usr/local/lib/paimind/extension-client/\nRUN --network=none node /usr/local/lib/paimind/install-extension-client.mjs\n' : ''}
${memberClient ? 'COPY --chown=0:0 --chmod=0444 agent-client/ /usr/local/lib/paimind/agent-client/\nRUN --network=none node /usr/local/lib/paimind/install-agent-client.mjs\n' : ''}
RUN --network=none chmod 0555 /usr/local/lib/paimind /usr/share/paimind/managed/profiles/web
LABEL io.paimind.acceptance="isolated-member-iteration-not-final"
USER 10001:10001
`)
console.log(JSON.stringify({ status: 'BUILDING_MEMBER_ITERATION', evidence }))
const child = spawn('docker', ['buildx', 'build', '--platform', 'linux/arm64', ...(managedCompat ? [] : ['--network=none']), '--load', '--progress=plain',
  '--tag', tag, '--iidfile', join(evidence, 'image-id.txt'), context], { stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes; process.stdout.write(bytes) })
const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
await writeFile(join(evidence, 'build.log'), log); assert.equal(code, 0)
for (const item of inputs) assert.equal(createHash('sha256').update(await readFile(join(root, item.source))).digest('hex'), item.sha256)
const imageId = (await readFile(join(evidence, 'image-id.txt'), 'utf8')).trim()
assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
await writeFile(join(evidence, 'result.json'), JSON.stringify({ imageId, baseId, tag, inputs, compiledEntries, packageSourceRebuilt: false,
  managedCompatSourceRebuilt: managedCompat,
  enterpriseClientArtifactIncluded: memberClient,
  extensionClientArtifactIncluded: memberClient,
  agentClientArtifactIncluded: memberClient,
  fullSourceBuildEvidence: 'haas-worker-runtime-rfh4Mz', finalWorkerImageAccepted: false }, null, 2))
console.log(JSON.stringify({ status: 'MEMBER_ITERATION_IMAGE_BUILT', evidence, imageId, finalWorkerImageAccepted: false }))
