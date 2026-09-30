import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { normalizeWorkerRuntimeTree } from './normalize-runtime-tree.mjs'
import { inspectWorkerDeployment, projectBundleRuntimeDependencies, sealWorkerRuntimePermissions } from './verify-worker-deployment.mjs'
import { WORKER_BUILD_ROOT_CONTRACT } from './worker-build-root-contract.mjs'
import { prepareManagedHarnessModuleRoot } from '../../../../packages/harness-compat/lib/managed-runtime.js'

const roots = WORKER_BUILD_ROOT_CONTRACT.roots
assert.equal(process.argv.length,2)
assert.equal(process.platform,'linux'); assert.equal(process.arch,'arm64')
assert.equal(process.versions.node,'24.19.0')
assert.equal(await realpath(process.cwd()),roots.source.path)
const forbidden = [roots.source.path,
  ...['install','deploy'].flatMap(phase => ['home','tmp','node-gyp'].map(kind => `/tmp/paimind-source-${phase}-${kind}`))]
prepareManagedHarnessModuleRoot(roots.deploy.path)
const normalization = await normalizeWorkerRuntimeTree(roots.deploy.path,{scanOnlyRootAliases:forbidden})
process.stderr.write(`${JSON.stringify(normalization)}\n`)
const moduleProjection = await projectBundleRuntimeDependencies(roots.deploy.path)
const permissions = await sealWorkerRuntimePermissions(roots.deploy.path)
const tree = await inspectWorkerDeployment(roots.deploy.path)
process.stdout.write(`${JSON.stringify({schemaVersion:1,status:'RUNTIME_RELOCATION_PREPARED',normalization,moduleProjection,permissions,tree,
  destination:roots.final.path,runtimeBootVerified:false,finalWorkerImageAccepted:false})}\n`)
