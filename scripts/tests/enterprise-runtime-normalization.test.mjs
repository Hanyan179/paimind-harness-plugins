import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { containsAbsoluteRootAlias, normalizeWorkerRuntimeTree, pruneNodePtyNativeBuildState } from '../../deploy/enterprise/worker/runtime/normalize-runtime-tree.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'paimind-runtime-normalize-')))
  t.after(()=>rm(root,{recursive:true}))
  await mkdir(join(root,'node_modules/.pnpm'),{recursive:true})
  return root
}
test('runtime root scan recognizes absolute and URL aliases without rejecting relative path text',()=>{
  for(const value of ['/source/file','file:///source/file','/placeholder/../source/file','\0/source\0']) {
    assert.equal(containsAbsoluteRootAlias(Buffer.from(value),['/source']),true)
  }
  for(const value of ['./source/file','../source/file','/source-other/file']) {
    assert.equal(containsAbsoluteRootAlias(Buffer.from(value),['/source']),false)
  }
})
test('runtime normalization removes exact generated state and relocates only verified command fields',async t=>{
  const root = await fixture(t)
  await mkdir(join(root,'node_modules/.bin'))
  await mkdir(join(root,'node_modules/native/lib'),{recursive:true})
  await writeFile(join(root,'node_modules/native/lib/bin.js'),'console.log("native")\n')
  await writeFile(join(root,'node_modules/native/lib/bin.js.map'),'{}')
  await writeFile(join(root,'node_modules/.modules.yaml'),JSON.stringify({packageManager:'pnpm@11.7.0',virtualStoreDir:'.pnpm'}))
  await writeFile(join(root,'node_modules/.bin/dsh'),`#!/bin/sh\nbasedir=$(dirname "$0")\nif [ -z "$NODE_PATH" ]; then\n  export NODE_PATH="${root}/node_modules"\nelse\n  export NODE_PATH="${root}/node_modules:$NODE_PATH"\nfi\n# cmd-shim-target=${root}/node_modules/native/lib/bin.js\n`,{mode:0o755})
  const receipt = await normalizeWorkerRuntimeTree(root)
  assert.equal(receipt.removedPnpmInstallStateFiles,1);assert.equal(receipt.normalizedPnpmCommandShims,1)
  assert.equal(receipt.removedGeneratedArtifacts,1)
  const shim = await readFile(join(root,'node_modules/.bin/dsh'),'utf8')
  assert.ok(shim.includes("exec node '/opt/paimind/node_modules/native/lib/bin.js'"));assert.ok(!shim.includes(root))
  await assert.rejects(readFile(join(root,'node_modules/native/lib/bin.js.map')),{code:'ENOENT'})
  assert.equal(await readFile(join(root,'node_modules/native/lib/bin.js'),'utf8'),'console.log("native")\n')
})
test('runtime normalization rejects escaped links, malformed state and retained source paths',async t=>{
  const root = await fixture(t)
  await writeFile(join(root,'node_modules/.modules.yaml'),'not-json')
  await assert.rejects(normalizeWorkerRuntimeTree(root),/install-state file is invalid/)
  await rm(join(root,'node_modules/.modules.yaml'))
  await writeFile(join(root,'leak.js'),JSON.stringify(root))
  await assert.rejects(normalizeWorkerRuntimeTree(root),/retains the mutable deploy root/)
  await rm(join(root,'leak.js'))
  await symlink('/usr',join(root,'outside'))
  await assert.rejects(normalizeWorkerRuntimeTree(root),/escapes/)
})
test('native terminal build pruning keeps only the verified Linux runtime binary',async t=>{
  const root=await fixture(t);const build=join(root,'node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/build')
  await mkdir(join(build,'Release/obj.target'),{recursive:true})
  await writeFile(join(build,'config.gypi'),'generated state')
  await writeFile(join(build,'Release/pty.node'),'synthetic test binary')
  await writeFile(join(build,'Release/obj.target/object'),'generated object')
  assert.equal(await pruneNodePtyNativeBuildState(root,'linux'),2)
  assert.equal(await readFile(join(build,'Release/pty.node'),'utf8'),'synthetic test binary')
  await assert.rejects(readFile(join(build,'config.gypi')),{code:'ENOENT'})
})
