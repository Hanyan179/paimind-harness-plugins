import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const jsonFile = async path => JSON.parse(await readFile(path,'utf8'))
const runDocker = args => {
  const result = spawnSync('docker',args,{encoding:'utf8',timeout:180_000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']})
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`Docker ${args[0]} failed: ${result.error?.message ?? result.signal ?? result.status}\n${result.stderr ?? ''}`)
  }
  return result
}
const docker = args => runDocker(args).stdout.trim()
// Docker logs may put the container's stderr on its own stderr. Both streams
// are evidence; omitting stderr can falsely classify a failed boot as clean.
const dockerLogs = id => { const result = runDocker(['logs',id]); return result.stdout + result.stderr }
const save = (root,name,value) => writeFile(join(root,name),JSON.stringify(value,null,2),{flag:'wx',mode:0o600})
export function validateCandidateContainer(value,{imageId,name,run}) {
  assert.equal(value.Name,`/${name}`); assert.equal(value.Image,imageId)
  assert.equal(value.Config.Labels['io.paimind.goal'],'enterprise-haas-native-runtime')
  assert.equal(value.Config.Labels['io.paimind.run'],run)
  assert.equal(value.Config.User,'10001:10001')
  assert.equal(value.HostConfig.ReadonlyRootfs,true); assert.equal(value.HostConfig.NetworkMode,'none')
  assert.equal(value.HostConfig.Privileged,false)
  assert.ok(!value.HostConfig.VolumesFrom?.length && !value.HostConfig.Devices?.length)
  assert.ok(!value.HostConfig.DeviceRequests?.length)
  assert.ok(!value.HostConfig.Binds?.length && !Object.keys(value.HostConfig.PortBindings ?? {}).length)
  assert.deepEqual(value.HostConfig.CapDrop,['ALL'])
  assert.ok(value.HostConfig.SecurityOpt.includes('no-new-privileges:true'))
  assert.equal(value.HostConfig.PidsLimit,256); assert.equal(value.HostConfig.Memory,1024**3)
  assert.equal(value.HostConfig.NanoCpus,1_000_000_000)
  assert.deepEqual(Object.keys(value.HostConfig.Tmpfs).sort(),['/tmp','/var/lib/paimind'])
  assert.equal(value.HostConfig.Tmpfs['/var/lib/paimind'],'rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=268435456')
  assert.equal(value.HostConfig.Tmpfs['/tmp'],'rw,nosuid,nodev,mode=1777,size=134217728')
  assert.ok((value.Mounts ?? []).every(m=>m.Type==='tmpfs' && ['/tmp','/var/lib/paimind'].includes(m.Destination)))
  return true
}

export async function buildAndCheckRuntimeCandidate({evidence,contextRoot,sourceDigest,sourceBuildRun,policyDigest,checkNativeBootstrap = true}) {
  assert.equal(typeof checkNativeBootstrap,'boolean')
  const expected = await jsonFile(join(evidence,'report/worker-runtime.json'))
  assert.equal(expected.status,'RUNTIME_RELOCATION_PREPARED')
  assert.equal(expected.finalWorkerImageAccepted,false)
  assert.equal(expected.normalization.residualDeployRootHits,0)
  assert.equal(expected.permissions?.status,'RUNTIME_PERMISSIONS_PREPARED')
  assert.equal(expected.permissions.groupOrOtherWritable,false)
  assert.equal(expected.moduleProjection?.status,'BUNDLE_RUNTIME_DEPENDENCIES_PROJECTED')
  const tag = `paimind-enterprise-runtime-candidate:${sourceDigest.slice(7,19)}-${sourceBuildRun.slice(0,8)}`
  const args = ['buildx','build','--platform','linux/arm64','--progress=plain','--load','--tag',tag,
    '--build-arg',`PAIMIND_SOURCE_BUILD_RUN=${sourceBuildRun}`,
    '--build-arg',`PAIMIND_CANDIDATE_SOURCE_DIGEST=${sourceDigest}`,
    '--build-arg',`PAIMIND_CANDIDATE_POLICY_DIGEST=${policyDigest}`,
    '--build-arg',`PAIMIND_CANDIDATE_TREE_DIGEST=${expected.tree.treeDigest}`,
    '--target','worker-runtime-candidate','--iidfile',join(evidence,'image-iid.txt'),
    '--metadata-file',join(evidence,'candidate-build-metadata.json'),
    '--file',join(contextRoot,'deploy/enterprise/worker/Dockerfile'),contextRoot]
  const log = createWriteStream(join(evidence,'candidate-build.log'),{flags:'wx',mode:0o600})
  const child = spawn('docker',args,{cwd:contextRoot,stdio:['ignore','pipe','pipe']})
  const forward = bytes => {log.write(bytes);process.stdout.write(bytes)}
  child.stdout.on('data',forward);child.stderr.on('data',forward)
  let code
  try { code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done)}) }
  finally {await new Promise(done=>log.end(done))}
  await save(evidence,'candidate-build-execution.json',{code,args,at:new Date().toISOString()})
  assert.equal(code,0,'Runtime candidate image build failed')
  const imageId = (await readFile(join(evidence,'image-iid.txt'),'utf8')).trim()
  assert.match(imageId,/^sha256:[a-f0-9]{64}$/)
  const [info] = JSON.parse(docker(['image','inspect',imageId]))
  assert.equal(info.Id,imageId);assert.equal(info.Architecture,'arm64');assert.equal(info.Os,'linux')
  assert.equal(info.Config.User,'10001:10001')
  assert.deepEqual(info.Config.Entrypoint,['/usr/local/bin/node','/usr/local/lib/paimind/start-native-runtime.mjs'])
  for(const [key,value] of Object.entries({'io.paimind.source-digest':sourceDigest,'io.paimind.policy-digest':policyDigest,
    'io.paimind.runtime-tree-digest':expected.tree.treeDigest,'io.paimind.acceptance':'native-runtime-candidate-not-admitted'})) {
    assert.equal(info.Config.Labels[key],value)
  }
  // Read and hash the actual final image tree as its non-root user. No host
  // bind mounts, package store, network, secrets, or application data are used.
  const supportInputs = [
    ['native-ingress.mjs','/usr/local/lib/paimind/native-ingress.mjs'],
    ['native-control.mjs','/usr/local/lib/paimind/native-control.mjs'],
    ['member-tool-policy.mjs','/usr/local/lib/paimind/member-tool-policy.mjs'],
    ['boot-native-runtime.mjs','/usr/local/lib/paimind/boot-native-runtime.mjs'],
    ['prepare-native-storage.mjs','/usr/local/lib/paimind/prepare-native-storage.mjs'],
    ['prepared-storage.mjs','/usr/local/lib/paimind/prepared-storage.mjs'],
    ['active-storage.mjs','/usr/local/lib/paimind/active-storage.mjs'],
    ['storage-lock.mjs','/usr/local/lib/paimind/storage-lock.mjs'],
    ['recover-native-storage.mjs','/usr/local/lib/paimind/recover-native-storage.mjs'],
    ['run-prepared-runtime.mjs','/usr/local/lib/paimind/run-prepared-runtime.mjs'],
    ['confine-execution.mjs','/usr/local/lib/paimind/confine-execution.mjs'],
    ...['package.json','cordis.yml','cordis.patch.yml'].map(name=>[
      'managed-profile/'+name,'/usr/share/paimind/managed/profiles/web/'+name]),
  ]
  const reader = `import{readFileSync,lstatSync,accessSync,constants,realpathSync}from'node:fs';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
import{inspectWorkerDeployment}from'/usr/local/lib/paimind/verify-worker-deployment.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const tree=await inspectWorkerDeployment('/opt/paimind');
assert.equal(realpathSync('/usr/share/paimind/managed/profiles/node_modules'),'/opt/paimind/profiles/node_modules');
assert.equal(execFileSync('/usr/local/bin/bwrap',['--version'],{encoding:'utf8'}).trim(),'bubblewrap 0.11.2');
for(const path of ['/usr/local/bin/bwrap','/usr/local/libexec/paimind-execution-launch']){const s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);assert.equal(s.uid,0);assert.equal(s.gid,0);assert.equal(s.mode&0o7777,0o555);assert.throws(()=>accessSync(path,constants.W_OK),e=>['EACCES','EROFS'].includes(e.code))}
const support=${JSON.stringify(supportInputs)}.map(([source,path])=>{const s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);assert.equal(s.uid,0);assert.equal(s.gid,0);assert.equal(s.mode&0o777,0o444);assert.throws(()=>accessSync(path,constants.W_OK),e=>['EACCES','EROFS'].includes(e.code));return{source,digest:hash(readFileSync(path))}});
const version=execFileSync('/opt/paimind/node_modules/.bin/dsh',['--version'],{encoding:'utf8',timeout:30000}).trim();
console.log(JSON.stringify({tree,support,runtime:JSON.parse(readFileSync('/usr/share/paimind/worker-runtime.json')),
policyDigest:hash(readFileSync('/usr/share/paimind/pnpm-effective-policy.json')),
entrypointDigest:hash(readFileSync('/usr/local/lib/paimind/start-native-runtime.mjs')),version}));`
  const readerName = `paimind-native-readback-${sourceBuildRun}`
  const readerId = docker(['create','--name',readerName,'--network','none','--read-only','--cap-drop','ALL',
    '--security-opt','no-new-privileges:true','--memory','512m','--pids-limit','64',
    '--label','io.paimind.goal=enterprise-haas-native-runtime','--label',`io.paimind.run=${sourceBuildRun}`,
    '--entrypoint','/usr/local/bin/node',imageId,'--input-type=module','-e',reader])
  assert.match(readerId,/^[a-f0-9]{64}$/)
  const inspectReader = () => {
    const [state] = JSON.parse(docker(['inspect',readerId]))
    assert.equal(state.Id,readerId); assert.equal(state.Name,`/${readerName}`); assert.equal(state.Image,imageId)
    assert.equal(state.Config.Labels['io.paimind.goal'],'enterprise-haas-native-runtime')
    assert.equal(state.Config.Labels['io.paimind.run'],sourceBuildRun)
    assert.equal(state.Config.User,'10001:10001')
    assert.equal(state.HostConfig.ReadonlyRootfs,true); assert.equal(state.HostConfig.NetworkMode,'none')
    assert.equal(state.HostConfig.Privileged,false); assert.equal(state.Mounts.length,0)
    assert.ok(!state.HostConfig.Binds?.length && !state.HostConfig.VolumesFrom?.length)
    assert.ok(!Object.keys(state.HostConfig.PortBindings ?? {}).length)
    return state
  }
  let actual
  try {
    await save(evidence,'candidate-reader-container.json',inspectReader())
    actual = JSON.parse(docker(['start','--attach',readerId]))
    const readbackState = inspectReader()
    assert.equal(readbackState.State.Running,false); assert.equal(readbackState.State.ExitCode,0)
  } finally {
    const before = inspectReader()
    if (before.State.Running) docker(['stop','--time','10',readerId])
    const stopped = inspectReader(); assert.equal(stopped.State.Running,false)
    await writeFile(join(evidence,'candidate-reader.log'),dockerLogs(readerId),{flag:'wx',mode:0o600})
    docker(['rm',readerId])
    await save(evidence,'candidate-reader-removed.json',{removedContainer:readerId,state:stopped.State,userVolumesRemoved:false})
  }
  assert.equal(actual.tree.treeDigest,expected.tree.treeDigest)
  assert.deepEqual(actual.runtime,expected)
  assert.equal(actual.policyDigest,policyDigest)
  assert.equal(actual.version,'0.1.1-rc.2')
  assert.equal(actual.entrypointDigest,digest(await readFile(join(contextRoot,'deploy/enterprise/worker/runtime/start-native-runtime.mjs'))))
  assert.equal(actual.support.length,supportInputs.length)
  for(const [index,[source]] of supportInputs.entries()) {
    assert.deepEqual(actual.support[index],{source,digest:digest(await readFile(join(contextRoot,'deploy/enterprise/worker/runtime',source)))})
  }
  await save(evidence,'candidate-image.json',{status:'RUNTIME_CANDIDATE_IMAGE_READBACK_PASSED',imageId,tag,sourceDigest,
    policyDigest,actual,finalWorkerImageAccepted:false,at:new Date().toISOString()})
  console.log(JSON.stringify({state:'RUNTIME_CANDIDATE_IMAGE_READBACK_PASSED',imageId,evidence}))
  if(checkNativeBootstrap) await smokeNativeRuntime({evidence,imageId,run:sourceBuildRun})
  else await save(evidence,'native-bootstrap-pending.json',{
    status:'NATIVE_BOOTSTRAP_NOT_CHECKED',imageId,sourceDigest,
    reason:'Explicit image-build-only scope; original bootstrap and browser gates remain pending',
    nativeBootstrapVerified:false,browserE2EVerified:false,finalWorkerImageAccepted:false,at:new Date().toISOString(),
  })
}

export async function smokeNativeRuntime({evidence,imageId,run}) {
  const name = `paimind-native-smoke-${run.slice(0,8)}`
  const args = ['run','--detach','--init','--name',name,
    '--label','io.paimind.goal=enterprise-haas-native-runtime','--label',`io.paimind.run=${run}`,
    '--read-only','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--memory','1g','--cpus','1','--pids-limit','256',
    '--tmpfs','/var/lib/paimind:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=268435456',
    '--tmpfs','/tmp:rw,nosuid,nodev,mode=1777,size=134217728',imageId]
  const id = docker(args)
  assert.match(id,/^[a-f0-9]{64}$/)
  await save(evidence,'smoke-container.json',{id,name,imageId,run,args,at:new Date().toISOString()})
  const inspect = () => {
    const [state]=JSON.parse(docker(['inspect',id]));validateCandidateContainer(state,{imageId,name,run});return state
  }
  const probe = `const r=await fetch('http://127.0.0.1:3210/',{signal:AbortSignal.timeout(2000)});const h=await r.text();
if(r.status!==200||!r.headers.get('content-type')?.includes('text/html')||!h.includes('__DSH_BOOT__')
||!h.includes('@paimind/enterprise-admin')||!h.includes('@paimind/extension-center'))throw Error('Native bootstrap document is not ready');
console.log(JSON.stringify({status:r.status,bytes:Buffer.byteLength(h),nativeDocument:true,enterprisePlugin:true,extensionCenter:true}));`
  const checks = []; let failure
  try {
    const initial=inspect();assert.equal(initial.State.Running,true)
    await save(evidence,'smoke-isolation.json',initial)
    const deadline=Date.now()+120_000
    while(Date.now()<deadline && checks.length<2) {
      const state=inspect();assert.equal(state.State.Running,true,'Native runtime exited before readiness')
      try {checks.push(JSON.parse(docker(['exec',id,'/usr/local/bin/node','--input-type=module','-e',probe])))}
      catch {checks.length=0}
      if(checks.length<2) await delay(2000)
    }
    assert.equal(checks.length,2,'Native runtime did not produce its real bootstrap document')
    const logs=dockerLogs(id)
    assert.ok(!/Error \[|Error:|did not activate|plugin tree failed to load/.test(logs),'Native startup contains a failure')
    await save(evidence,'native-boot-smoke.json',{status:'NATIVE_RUNTIME_BOOT_SMOKE_PASSED',imageId,run,checks,
      isolation:'non-root-read-only-network-none-no-host-mounts',browserE2EVerified:false,finalWorkerImageAccepted:false,
      at:new Date().toISOString()})
    console.log(JSON.stringify({state:'NATIVE_RUNTIME_BOOT_SMOKE_PASSED',evidence,imageId,finalWorkerImageAccepted:false}))
  } catch(error) {failure=error}
  finally {
    // Destructive scope is the exact disposable container created above, after
    // revalidating its image, labels and isolation. Never remove a user volume.
    const before=inspect()
    if(before.State.Running) docker(['stop','--time','10',id])
    const stopped=inspect()
    assert.equal(stopped.State.Running,false)
    await writeFile(join(evidence,'native-runtime.log'),dockerLogs(id),{flag:'wx',mode:0o600})
    docker(['rm',id])
    await save(evidence,'smoke-stopped.json',{state:stopped.State,removedContainer:id,userVolumesRemoved:false})
    assert.equal(stopped.State.ExitCode,0,'Native runtime must stop cleanly, not be forcibly killed')
  }
  if(failure) throw failure
}
