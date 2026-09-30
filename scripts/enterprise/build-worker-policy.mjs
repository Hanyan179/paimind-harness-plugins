import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { constants, createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requirePnpmEffectivePolicyReceipt } from '../../deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs'
import { composePnpmOfflineStorePolicyEvidence } from '../../deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs'
import { requirePnpmProducerFetchReceipt } from '../../deploy/enterprise/worker/runtime/run-pnpm-offline-store-fetch.mjs'
import { buildAndCheckRuntimeCandidate } from './runtime-candidate.mjs'

// Build only the real Linux policy stage from a bounded frozen context. The
// same files and receipt are intended inputs of the subsequent Worker image
// graph. This does not start a Worker, grant a runtime binding, publish an
// image, copy a dirty legacy tree, or claim final-image acceptance.
const sourceRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const policyInputs = Object.freeze([
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'deploy/enterprise/worker/Dockerfile', 'deploy/enterprise/worker/Dockerfile.dockerignore',
  'deploy/enterprise/worker/runtime/worker-build-root-contract.mjs',
  'deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs',
  'deploy/enterprise/worker/runtime/normalize-pnpm-project-registry.mjs',
  'deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs',
  'deploy/enterprise/worker/runtime/run-pnpm-offline-store-fetch.mjs',
])
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim()
// This explicit artifact-only mode never substitutes for the existing native
// bootstrap or browser gates. It permits building while page access is blocked.
const imageBuildOnly = process.argv.length === 3 && process.argv[2] === '--runtime-image-build-only'
const runtimeImage = imageBuildOnly || process.argv.length === 3 && process.argv[2] === '--runtime-image'
const deploymentBuild = runtimeImage || (process.argv.length === 3 && process.argv[2] === '--deployment')
const sourceBuild = deploymentBuild || (process.argv.length === 3 && process.argv[2] === '--source-build')
if ((!sourceBuild && process.argv.length !== 2) || git('rev-parse', '--show-toplevel') !== sourceRoot
  || git('branch', '--show-current') !== 'codex/enterprise-haas-hybrid-refactor') throw new Error('Expected the isolated enterprise source worktree; use no argument, --source-build, --deployment, --runtime-image or --runtime-image-build-only')
const sourceBuildRun = sourceBuild ? randomUUID() : undefined
const inputs = [...policyInputs]
if (sourceBuild) {
  inputs.push('tsconfig.json', 'tsconfig.base.json',
    // The gateway bundles this runtime module and needs its declaration in
    // every source build, not only when assembling a runnable Worker image.
    'deploy/enterprise/worker/runtime/native-control.mjs',
    'deploy/enterprise/worker/runtime/native-control.d.mts',
    'deploy/enterprise/worker/runtime/verify-node-gyp-local-headers.mjs',
    'deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs',
    'deploy/enterprise/worker/runtime/verify-worker-source-build.mjs')
  if (deploymentBuild) inputs.push('deploy/enterprise/worker/runtime/verify-worker-deployment.mjs')
  if (runtimeImage) inputs.push('deploy/enterprise/worker/runtime/normalize-runtime-tree.mjs',
    'deploy/enterprise/worker/runtime/prepare-worker-runtime.mjs','deploy/enterprise/worker/runtime/start-native-runtime.mjs',
    'deploy/enterprise/worker/runtime/boot-native-runtime.mjs',
    'deploy/enterprise/worker/runtime/native-ingress.mjs',
    'deploy/enterprise/worker/runtime/member-tool-policy.mjs',
    'deploy/enterprise/worker/runtime/prepare-native-storage.mjs',
    'deploy/enterprise/worker/runtime/prepared-storage.mjs',
    'deploy/enterprise/worker/runtime/active-storage.mjs',
    'deploy/enterprise/worker/runtime/storage-lock.mjs',
    'deploy/enterprise/worker/runtime/recover-native-storage.mjs',
    'deploy/enterprise/worker/runtime/run-prepared-runtime.mjs',
    'deploy/enterprise/worker/runtime/confine-execution.mjs',
    'deploy/enterprise/worker/runtime/execution-launch.c',
    'deploy/enterprise/worker/runtime/managed-profile/package.json',
    'deploy/enterprise/worker/runtime/managed-profile/cordis.yml',
    'deploy/enterprise/worker/runtime/managed-profile/cordis.patch.yml')
  const sourcePaths = git('ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z', '--',
    'packages', 'apps', 'examples', 'scripts').split('\0').filter(Boolean)
  for (const path of sourcePaths) {
    if (path.split('/').some(part => ['node_modules', 'lib', 'coverage', '.DS_Store'].includes(part)) || path.endsWith('.tsbuildinfo')) continue
    if (path.split('/').some(part => (part.startsWith('.') && part !== '.gitkeep') || part === '..')
      || /\.(?:pem|key|p12)$/i.test(path) || !/^(packages|apps|examples|scripts)\//.test(path)) {
      throw new Error('Unexpected private configuration or path in source build input; review explicitly')
    }
    inputs.push(path)
  }
  inputs.sort()
  if (new Set(inputs).size !== inputs.length || inputs.length > 5000) throw new Error('Invalid source build inventory')
}
const parent = await realpath(resolve(sourceRoot, '../.paimind-goal-evidence'))
process.umask(0o077)
const evidence = await mkdtemp(join(parent, runtimeImage ? 'haas-worker-runtime-' : deploymentBuild ? 'haas-worker-deployment-' : sourceBuild ? 'haas-worker-source-build-' : 'haas-worker-policy-'))
const contextRoot = join(evidence, 'context')
await mkdir(contextRoot, { mode: 0o700 })

async function readInput(relative) {
  const path = join(sourceRoot, relative)
  const lexical = await lstat(path)
  if (await realpath(path) !== path || !lexical.isFile() || lexical.isSymbolicLink()
    || lexical.nlink !== 1 || (!sourceBuild && lexical.size === 0) || lexical.size > 32 * 1024 * 1024) throw new Error(`Unsafe build input: ${relative}`)
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const metadata = await file.stat()
    if (metadata.ino !== lexical.ino || metadata.dev !== lexical.dev || metadata.size !== lexical.size
      || metadata.nlink !== 1) throw new Error(`Build input changed during capture: ${relative}`)
    const bytes = await file.readFile()
    if (bytes.length !== metadata.size) throw new Error(`Build input size drift: ${relative}`)
    return bytes
  } finally { await file.close() }
}

// Do not silently omit a source config that could change effective policy or
// transmit credentials. Add a separately reviewed config contract if needed.
for (const path of ['.npmrc', '.pnpmfile.cjs', 'pnpmfile.cjs']) {
  if (await lstat(join(sourceRoot, path)).then(() => true, error => {
    if (error.code === 'ENOENT') return false
    throw error
  })) throw new Error(`Additional package configuration requires review: ${path}`)
}
const files = []
for (const path of inputs) {
  const bytes = await readInput(path)
  const target = join(contextRoot, path)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, bytes, { mode: 0o444, flag: 'wx' })
  files.push({ path, bytes: bytes.length, digest: digest(bytes) })
}
if (files.reduce((total, file) => total + file.bytes, 0) > 256 * 1024 * 1024) throw new Error('Source build context exceeds reviewed size bound')
const sourceDigest = digest(Buffer.from(JSON.stringify(files)))
const sourceHead = git('rev-parse', 'HEAD')
await writeFile(join(evidence, 'input-manifest.json'), JSON.stringify({ sourceRoot, sourceHead,
  sourceDigest, files, scope: runtimeImage ? 'frozen-native-runtime-candidate-not-admitted-worker' : deploymentBuild ? 'frozen-current-source-production-dependency-deployment-not-final-image' : sourceBuild ? 'frozen-current-source-install-and-build-not-final-worker-closure' : 'frozen-policy-build-inputs-not-final-worker-closure' }, null, 2), { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ state: 'BUILDING', evidence, sourceDigest, platform: 'linux/arm64' }))
const log = createWriteStream(join(evidence, 'build.log'), { flags: 'wx', mode: 0o600 })
const args = ['buildx', 'build', '--platform', 'linux/arm64', '--progress=plain',
  // A source/deployment acceptance run must not combine an older policy
  // report with a differently sealed producer snapshot. Keep toolchain caches;
  // force only these two evidence-producing stages to execute together.
  ...(sourceBuild ? ['--no-cache-filter', 'pnpm-store-producer,pnpm-effective-policy-diagnostic'] : []),
  ...(sourceBuild ? ['--build-arg', `PAIMIND_SOURCE_BUILD_RUN=${sourceBuildRun}`] : []),
  '--target', runtimeImage ? 'worker-runtime-report' : deploymentBuild ? 'worker-deployment-report' : sourceBuild ? 'worker-source-build-report' : 'pnpm-effective-policy-report', '--output', `type=local,dest=${join(evidence, 'report')}`,
  '--metadata-file', join(evidence, 'build-metadata.json'),
  '--file', join(contextRoot, 'deploy/enterprise/worker/Dockerfile'), contextRoot]
const child = spawn('docker', args, { cwd: contextRoot, stdio: ['ignore', 'pipe', 'pipe'] })
const forward = bytes => { log.write(bytes); process.stdout.write(bytes) }
child.stdout.on('data', forward); child.stderr.on('data', forward)
let exitCode
try {
  exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
} finally { await new Promise(done => log.end(done)) }
await writeFile(join(evidence, 'execution.json'), JSON.stringify({ exitCode, args,
  finishedAt: new Date().toISOString(), sourceDigest }, null, 2), { mode: 0o600, flag: 'wx' })
if (exitCode !== 0) throw new Error(`Policy build failed; evidence retained at ${evidence}`)
const policyBytes = await readFile(join(evidence, 'report/pnpm-effective-policy.json'))
const policy = requirePnpmEffectivePolicyReceipt(JSON.parse(policyBytes))
const fetchReceiptBytes = await readFile(join(evidence, 'report/offline-store-fetch-retry.json'))
const producerFetch = requirePnpmProducerFetchReceipt(JSON.parse(fetchReceiptBytes))
const producerPreflight = JSON.parse(await readFile(join(evidence, 'report/pnpm-producer-policy-preflight.json'), 'utf8'))
if (JSON.stringify(producerPreflight) !== JSON.stringify(policy.sourcePolicies.producer)) {
  throw new Error('Producer preflight does not match the final source policy readback')
}
const storeReceipts = {}
for (const [key, file] of [
  ['normalization', 'pnpm-project-registry-normalization.json'],
  ['seal', 'pnpm-offline-store-seal.json'],
  ['policyBefore', 'pnpm-offline-store-policy-before.json'],
  ['policyAfter', 'pnpm-offline-store-policy-after.json'],
]) storeReceipts[key] = JSON.parse(await readFile(join(evidence, 'report', file), 'utf8'))
const policyStore = composePnpmOfflineStorePolicyEvidence(storeReceipts)
for (const [path, key] of [['pnpm-lock.yaml', 'lockfileDigest'], ['pnpm-workspace.yaml', 'workspacePolicyDigest']]) {
  if (files.find(file => file.path === path).digest !== policy[key]) throw new Error(`Policy receipt does not bind the frozen ${path}`)
}
for (const file of files) {
  if (digest(await readInput(file.path)) !== file.digest) throw new Error(`Live source changed after freezing: ${file.path}; frozen result is not current acceptance`)
}
await writeFile(join(evidence, 'verified-policy-build.json'), JSON.stringify({
  status: 'POLICY_STAGE_VERIFIED', sourceHead, sourceDigest, policyDigest: digest(policyBytes),
  policySchemaVersion: policy.schemaVersion, platform: policy.platform, policyFields: policy.policyFields,
  sourcePolicies: policy.sourcePolicies, scenarios: policy.scenarios,
  policyStore,
  producerFetch, producerFetchDigest: digest(fetchReceiptBytes),
  finalWorkerImageAccepted: false, artifact: 'report/pnpm-effective-policy.json',
  verifiedAt: new Date().toISOString(),
}, null, 2), { mode: 0o600, flag: 'wx' })
if (sourceBuild) {
  const read = async file => JSON.parse(await readFile(join(evidence, 'report', file), 'utf8'))
  if (JSON.stringify(await read('source-consumed-store-seal.json')) !== JSON.stringify(storeReceipts.seal)
    || JSON.stringify(await read('source-policy-store-receipt.json')) !== JSON.stringify(storeReceipts.policyAfter)) {
    throw new Error('Exported policy and actual source-consumed Store snapshots differ')
  }
  const pairs = {}
  for (const category of ['store', 'environment', 'headers']) {
    const before = await read(`source-install-${category}-before.json`)
    const after = await read(`source-install-${category}-after.json`)
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Source install ${category} changed`)
    pairs[category] = before
  }
  const environment = pairs.environment
  if (environment.status !== 'PASS' || environment.externalNetworkDisabled !== true
    || environment.storeReadOnly !== true || environment.headersReadOnly !== true || environment.nodeGypCacheEmpty !== true
    || JSON.stringify(environment.policy) !== JSON.stringify(policy.sourcePolicies.consumer)
    || environment.lockfileDigest !== policy.lockfileDigest || environment.workspacePolicyDigest !== policy.workspacePolicyDigest) {
    throw new Error('Actual source installer environment does not bind the verified policy')
  }
  if (pairs.store.status !== 'PASS' || pairs.store.readOnlyMount !== true
    || pairs.store.contentDigest !== storeReceipts.seal.contentDigest
    || pairs.headers.status !== 'PASS' || pairs.headers.nodeVersion !== '24.19.0'
    || pairs.headers.platform !== 'linux' || pairs.headers.architecture !== 'arm64' || pairs.headers.nodeAbi !== '137') {
    throw new Error('Actual source installer store or headers do not match the sealed inputs')
  }
  const built = await read('worker-source-build.json')
  if (built.status !== 'SOURCE_BUILD_VERIFIED' || built.platform !== 'linux/arm64' || built.nodeVersion !== '24.19.0'
    || built.lockfileDigest !== policy.lockfileDigest || built.finalWorkerImageAccepted !== false
    || built.runtimeAssemblyVerified !== false || !Array.isArray(built.artifacts) || built.artifacts.length === 0
    || built.artifactDigest !== digest(JSON.stringify(built.artifacts))) throw new Error('Actual source build artifact receipt is invalid')
  await writeFile(join(evidence, 'verified-source-build.json'), JSON.stringify({
    status: 'SOURCE_INSTALL_BUILD_VERIFIED', sourceHead, sourceDigest, sourceBuildRun,
    policyDigest: digest(policyBytes), install: pairs, built,
    finalWorkerImageAccepted: false, runtimeAssemblyVerified: false, verifiedAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ state: 'SOURCE_INSTALL_BUILD_VERIFIED', evidence, sourceDigest, finalWorkerImageAccepted: false }))
  if (deploymentBuild) {
    const deployedPairs = {}
    for (const category of ['store', 'environment', 'headers']) {
      const before = await read(`source-deploy-${category}-before.json`)
      const after = await read(`source-deploy-${category}-after.json`)
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Production deployment ${category} changed`)
      deployedPairs[category] = before
    }
    if (JSON.stringify(deployedPairs.store) !== JSON.stringify(pairs.store)
      || JSON.stringify(deployedPairs.headers) !== JSON.stringify(pairs.headers)
      || deployedPairs.environment.phase !== 'deploy' || deployedPairs.environment.externalNetworkDisabled !== true
      || deployedPairs.environment.storeReadOnly !== true || deployedPairs.environment.headersReadOnly !== true
      || deployedPairs.environment.nodeGypCacheEmpty !== true
      || JSON.stringify(deployedPairs.environment.policy) !== JSON.stringify(environment.policy)
      || deployedPairs.environment.lockfileDigest !== policy.lockfileDigest
      || deployedPairs.environment.workspacePolicyDigest !== policy.workspacePolicyDigest) {
      throw new Error('Production dependency deployment does not bind the same isolated consumer policy')
    }
    const deployed = await read('worker-deployment.json')
    if (deployed.status !== 'PRODUCTION_DEPLOYMENT_VERIFIED'
      || deployed.deployment?.status !== 'PRODUCTION_DEPENDENCY_TREE_VERIFIED'
      || deployed.composition?.status !== 'NATIVE_DEPLOYED_COMPOSITION_RESOLVED'
      || deployed.composition.nativeVersion !== '0.1.1-rc.2'
      || deployed.composition.runtimeBootVerified !== false || deployed.finalWorkerImageAccepted !== false) {
      throw new Error('Production dependency deployment or native composition receipt is invalid')
    }
    await writeFile(join(evidence, 'verified-deployment.json'), JSON.stringify({
      status:'PRODUCTION_DEPLOYMENT_VERIFIED',sourceHead,sourceDigest,sourceBuildRun,
      policyDigest:digest(policyBytes),consumer:deployedPairs,deployed,finalWorkerImageAccepted:false,
      verifiedAt:new Date().toISOString(),
    }, null, 2), {mode:0o600,flag:'wx'})
    console.log(JSON.stringify({state:'PRODUCTION_DEPLOYMENT_VERIFIED',evidence,sourceDigest,finalWorkerImageAccepted:false}))
  }
}
console.log(JSON.stringify({ state: 'POLICY_STAGE_VERIFIED', evidence, sourceDigest, finalWorkerImageAccepted: false }))
if (runtimeImage) {
  await buildAndCheckRuntimeCandidate({evidence,contextRoot,sourceDigest,sourceBuildRun,policyDigest:digest(policyBytes),checkNativeBootstrap:!imageBuildOnly})
  for (const file of files) {
    if (digest(await readInput(file.path)) !== file.digest) throw new Error(`Live source changed during runtime verification: ${file.path}`)
  }
  console.log(JSON.stringify({state:imageBuildOnly?'RUNTIME_CANDIDATE_IMAGE_ONLY_VERIFIED':'RUNTIME_CANDIDATE_VERIFIED',
    evidence,sourceDigest,nativeBootstrapVerified:!imageBuildOnly,finalWorkerImageAccepted:false}))
}
