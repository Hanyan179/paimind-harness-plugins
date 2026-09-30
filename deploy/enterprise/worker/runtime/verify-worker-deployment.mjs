import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WORKER_BUILD_ROOT_CONTRACT } from './worker-build-root-contract.mjs'

const roots = WORKER_BUILD_ROOT_CONTRACT.roots
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
export function requireContainedDeploymentPath(root, path) {
  const rel = relative(root, path)
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Production dependency escapes its deployment root')
  return rel
}
export const FORBIDDEN_DEPLOYMENT_PACKAGES = Object.freeze([
  '@paimind/enterprise-server', 'postgres', '@paimind/testkit', 'typescript', 'vitest',
])

/** The native profile loader resolves bare plugin names from the profile's
 * module root. pnpm keeps a bundle's dependencies beside its real package,
 * not necessarily in the carrier's top-level node_modules. Project exactly
 * the existing bundle manifest's dependencies as contained immutable links;
 * do not maintain another package inventory or copy upstream package code. */
export async function projectBundleRuntimeDependencies(root) {
  assert.equal(await realpath(root), root)
  const carrier = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(carrier.name, '@paimind/enterprise-worker-runtime'); assert.equal(carrier.private, true)
  const modules = join(root, 'node_modules')
  const bundleRoot = await realpath(join(modules, '@paimind/harness-bundle'))
  requireContainedDeploymentPath(root, bundleRoot)
  const bundle = JSON.parse(await readFile(join(bundleRoot, 'package.json'), 'utf8'))
  assert.equal(bundle.name, '@paimind/harness-bundle')
  assert.ok(bundle.dependencies && typeof bundle.dependencies === 'object' && !Array.isArray(bundle.dependencies))
  const names = Object.keys(bundle.dependencies).sort()
  assert.ok(names.length > 0 && names.length <= 128)
  const plans = []
  // pnpm's scoped package layout: <virtual-package>/node_modules/@paimind/harness-bundle.
  const dependencyRoot = dirname(dirname(bundleRoot))
  assert.equal(dirname(bundleRoot).split('/').at(-1), '@paimind')
  assert.equal(dependencyRoot.split('/').at(-1), 'node_modules')
  for (const name of names) {
    assert.match(name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/)
    assert.ok(!FORBIDDEN_DEPLOYMENT_PACKAGES.includes(name), 'Forbidden bundle runtime dependency')
    const target = await realpath(join(dependencyRoot, name))
    requireContainedDeploymentPath(root, target)
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
    assert.equal(manifest.name, name, 'Bundle dependency identity mismatch')
    const destination = join(modules, name)
    const existing = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return; throw error })
    if (existing) assert.equal(await realpath(destination), target, 'Conflicting runtime module projection')
    // Validate existing scope directories before making any links. A scope
    // alias must never redirect generated writes outside this deployment.
    const scope = dirname(destination)
    const scopeStat = await lstat(scope).catch(error => { if (error.code === 'ENOENT') return; throw error })
    if (scopeStat) assert.ok(scopeStat.isDirectory() && !scopeStat.isSymbolicLink() && await realpath(scope) === scope,
      'Unsafe runtime module scope')
    plans.push({ name, destination, target, existing: Boolean(existing) })
  }
  for (const plan of plans) if (!plan.existing) {
    await mkdir(dirname(plan.destination), { recursive: true, mode: 0o755 })
    await symlink(relative(dirname(plan.destination), plan.target), plan.destination)
  }
  return { status: 'BUNDLE_RUNTIME_DEPENDENCIES_PROJECTED', source: '@paimind/harness-bundle/package.json',
    dependencies: plans.map(plan => ({ name: plan.name, target: relative(root, plan.target) })),
    createdLinks: plans.filter(plan => !plan.existing).length }
}

// Only a generated, contained deployment is passed here. Keep the host's
// frozen context private; explicitly prepare image code for non-root reads.
// Validate the whole inventory first, never follow a link when changing mode,
// and never chmod a shared inode or give group/other write permission.
export async function sealWorkerRuntimePermissions(root) {
  assert.equal(await realpath(root), root)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@paimind/enterprise-worker-runtime'); assert.equal(manifest.private, true)
  const entries = []
  let links = 0
  async function collect(path) {
    assert.ok(entries.length + links < 100_000, 'Runtime permissions exceed the reviewed entry bound')
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) {
      requireContainedDeploymentPath(root, await realpath(path)); links += 1; return
    }
    assert.ok(metadata.isDirectory() || (metadata.isFile() && metadata.nlink === 1), 'Unsafe runtime permissions target')
    entries.push({ path, metadata })
    if (metadata.isDirectory()) for (const name of (await readdir(path)).sort()) await collect(join(path, name))
  }
  await collect(root)
  let changed = 0
  for (const { path, metadata } of entries.reverse()) {
    const mode = metadata.isDirectory() ? 0o755 : (metadata.mode & 0o111) ? 0o555 : 0o444
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const current = await handle.stat()
      // Overlay copy-up of children can change a directory's link count (the
      // real image diagnostic observed 4 -> 1) without replacing its inode.
      // Link-count isolation applies to regular files, not directory metadata.
      assert.ok(current.ino === metadata.ino && current.dev === metadata.dev
        && current.isDirectory() === metadata.isDirectory() && (metadata.isDirectory() || current.nlink === metadata.nlink),
        `Runtime permissions target changed: ${relative(root, path)} ${JSON.stringify({ directory: metadata.isDirectory(),
          before: { ino: metadata.ino, dev: metadata.dev, links: metadata.nlink },
          current: { ino: current.ino, dev: current.dev, links: current.nlink } })}`)
      if ((current.mode & 0o7777) !== mode) { await handle.chmod(mode); changed += 1 }
    } finally { await handle.close() }
  }
  return { status: 'RUNTIME_PERMISSIONS_PREPARED', entries: entries.length, containedLinks: links, changed,
    directories: '0755', executableFiles: '0555', otherFiles: '0444', groupOrOtherWritable: false }
}

// pnpm may hard-link duplicate workspace peer projections even when its store
// import method is copy. Materialize fresh inodes in the generated deployment
// only, preserving bytes and mode. Never write through a shared inode or follow
// a link into source. This is not final-runtime relocation/normalization.
export async function detachGeneratedDeploymentLinks(root, sourceCarrier) {
  assert.equal(await realpath(root), root)
  const rootMetadata = await lstat(root)
  assert.ok(rootMetadata.isDirectory() && !rootMetadata.isSymbolicLink())
  const detached = []; let omittedSelfLinks = 0; let visited = 0; let copiedBytes = 0
  const selfLink = 'node_modules/.pnpm/node_modules/@paimind/enterprise-worker-runtime'
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      if (++visited > 100_000) throw new Error('Deployment materialization exceeds the reviewed entry bound')
      const path = join(dir,name); const rel = relative(root,path); const initial = await lstat(path)
      if (rel === selfLink) {
        assert.ok(initial.isSymbolicLink(), 'Generated carrier self-link must be a symbolic link')
        assert.ok(isAbsolute(sourceCarrier) && sourceCarrier !== root)
        assert.equal(await realpath(sourceCarrier),sourceCarrier)
        assert.equal(await realpath(path),sourceCarrier,'Generated carrier self-link has an unexpected target')
        const manifest = JSON.parse(await readFile(join(sourceCarrier,'package.json'),'utf8'))
        assert.equal(manifest.name,'@paimind/enterprise-worker-runtime'); assert.equal(manifest.private,true)
        await unlink(path); omittedSelfLinks += 1
      } else if (initial.isSymbolicLink()) {
        requireContainedDeploymentPath(root,await realpath(path))
      } else if (initial.isDirectory()) {
        await walk(path)
      } else {
        assert.ok(initial.isFile() && initial.nlink >= 1 && initial.size <= 128 * 1024 * 1024, `Unsafe generated entry: ${rel}`)
        if (initial.nlink === 1) continue
        let handle
        try {
          handle = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW)
          const before = await handle.stat()
          assert.ok(before.ino === initial.ino && before.dev === initial.dev && before.nlink === initial.nlink && before.size === initial.size)
          const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(path)
          assert.ok(after.ino === before.ino && current.ino === before.ino && current.dev === before.dev
            && after.size === bytes.length && current.size === before.size && after.mtimeMs === before.mtimeMs
            && after.ctimeMs === before.ctimeMs && current.ctimeMs === before.ctimeMs, 'Generated file changed during materialization')
          copiedBytes += bytes.length
          assert.ok(copiedBytes <= 3 * 1024 ** 3)
          const temporary = join(dir,`.paimind-detach-${process.pid}-${detached.length}`)
          await writeFile(temporary,bytes,{flag:'wx',mode:before.mode & 0o777})
          const copied = await lstat(temporary)
          assert.equal(copied.nlink,1)
          assert.ok(copied.ino !== before.ino || copied.dev !== before.dev)
          assert.equal(hash(await readFile(temporary)),hash(bytes))
          await rename(temporary,path)
          detached.push({path:rel,originalLinks:initial.nlink,bytes:bytes.length,digest:hash(bytes)})
        } finally { await handle?.close() }
      }
    }
  }
  await walk(root)
  return {schemaVersion:1,status:'GENERATED_DEPLOYMENT_LINKS_DETACHED',detachedFiles:detached.length,
    copiedBytes,omittedSelfLinks,detachedDigest:hash(JSON.stringify(detached)),samples:detached.slice(0,3),
    finalWorkerImageAccepted:false,runtimeRelocationVerified:false}
}

export async function inspectWorkerDeployment(root) {
  assert.equal(await realpath(root), root)
  const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(rootManifest.name, '@paimind/enterprise-worker-runtime')
  assert.equal(rootManifest.private, true)
  const entries = []; const packages = []
  let bytesTotal = 0
  async function walk(dir) {
    const names = (await readdir(dir)).sort()
    for (const name of names) {
      const path = join(dir, name); const rel = relative(root, path)
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) {
        const target = await realpath(path)
        requireContainedDeploymentPath(root, target)
        entries.push({path:rel,kind:'symlink',target:await readlink(path)})
      } else if (stat.isDirectory()) {
        entries.push({path:rel,kind:'directory',mode:stat.mode & 0o7777,uid:stat.uid,gid:stat.gid})
        await walk(path)
      } else {
        assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 128 * 1024 * 1024,
          `Unexpected deployment entry: ${rel} (regular=${stat.isFile()},links=${stat.nlink},bytes=${stat.size})`)
        const bytes = await readFile(path)
        assert.equal(bytes.length, stat.size)
        bytesTotal += bytes.length
        if (bytesTotal > 3 * 1024 ** 3 || entries.length > 100_000) throw new Error('Deployment tree exceeds the reviewed scan bounds')
        entries.push({path:rel,kind:'file',mode:stat.mode & 0o7777,uid:stat.uid,gid:stat.gid,bytes:bytes.length,digest:hash(bytes)})
        if (name === 'package.json') {
          const manifest = JSON.parse(bytes)
          if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
            assert.ok(!FORBIDDEN_DEPLOYMENT_PACKAGES.includes(manifest.name), `Control-plane or development package leaked: ${manifest.name}`)
            packages.push({name:manifest.name,version:manifest.version,path:rel})
          }
        }
      }
    }
  }
  await walk(root)
  const required = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@paimind/harness-bundle', '@paimind/enterprise-admin']
  for (const name of required) assert.ok(packages.some(pkg => pkg.name === name), `Missing runtime package: ${name}`)
  return {schemaVersion:1,status:'PRODUCTION_DEPENDENCY_TREE_VERIFIED',entries:entries.length,
    files:entries.filter(e=>e.kind==='file').length,symlinks:entries.filter(e=>e.kind==='symlink').length,
    bytes:bytesTotal,treeDigest:hash(JSON.stringify(entries)),packages,
    finalWorkerImageAccepted:false,runtimeBootVerified:false}
}

export async function verifyNativeDeploymentComposition(root) {
  // Synthetic, unexposed acceptance profile only. No application-user home is
  // read or modified, and the native CLI is consumed in place, never copied.
  const home = await mkdtemp('/tmp/paimind-deployed-native-')
  const profile = join(home, 'profiles/web')
  await mkdir(profile, {recursive:true,mode:0o700})
  await writeFile(join(profile, 'package.json'), JSON.stringify({name:'dsh-profile-web',private:true,
    dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@paimind/harness-bundle']}}}), {flag:'wx',mode:0o600})
  await symlink(join(root,'node_modules'), join(profile,'node_modules'))
  await writeFile(join(profile,'cordis.patch.yml'), '- id: paimind-enterprise-admin\n  disabled: false\n', {flag:'wx',mode:0o600})
  const cli = await realpath(join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
  requireContainedDeploymentPath(root, cli)
  const env = {PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,DSH_HOME:home,TMPDIR:home,CI:'true',NO_COLOR:'1',DSH_TELEMETRY_DISABLED:'1'}
  const run = args => {
    const result = spawnSync(process.execPath,[cli,...args], {cwd:home,env,encoding:'utf8',timeout:30_000,maxBuffer:8*1024*1024})
    if (result.status !== 0 || result.signal !== null || result.error) throw new Error(`Native deployed command failed: ${args.join(' ')}\n${result.stderr.slice(-2000)}`)
    return result
  }
  assert.equal(run(['--version']).stdout.trim(),'0.1.1-rc.2')
  const composed = run(['--profile','web','--dump-config'])
  const nativeRequire = createRequire(cli)
  // Native !!js scalars are expression nodes, not generic YAML and not code
  // to execute here. Use the host's exported, inert entry-list dialect.
  const schemaModule = await realpath(nativeRequire.resolve('@deepseek-ai/cordis-plugin-include'))
  requireContainedDeploymentPath(root,schemaModule)
  const { entryListSchema } = await import(pathToFileURL(schemaModule).href)
  assert.ok(entryListSchema)
  const tree = nativeRequire('js-yaml').load(composed.stdout,{schema:entryListSchema})
  assert.ok(Array.isArray(tree))
  const ids = new Map()
  const collect = nodes => {
    for (const node of nodes) {
      if (typeof node.id === 'string') { assert.ok(!ids.has(node.id), `Duplicate native id: ${node.id}`); ids.set(node.id,node) }
      if (node.group === true && Array.isArray(node.config)) collect(node.config)
    }
  }
  collect(tree)
  assert.equal(ids.get('paimind-enterprise-admin')?.name,'@paimind/enterprise-admin')
  assert.notEqual(ids.get('paimind-enterprise-admin')?.disabled,true)
  assert.equal(ids.get('paimind-extension-center')?.name,'@paimind/extension-center')
  assert.ok(ids.size > 10)
  return {schemaVersion:1,status:'NATIVE_DEPLOYED_COMPOSITION_RESOLVED',nativeVersion:'0.1.1-rc.2',
    composedRows:ids.size,compositionDigest:hash(composed.stdout),stderrBytes:Buffer.byteLength(composed.stderr),
    profile:'synthetic-private-unexposed',runtimeBootVerified:false,finalWorkerImageAccepted:false}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length,2)
  assert.equal(process.platform,'linux'); assert.equal(process.arch,'arm64')
  assert.equal(process.versions.node,'24.19.0')
  assert.equal(await realpath(process.cwd()), roots.source.path)
  const materialization = await detachGeneratedDeploymentLinks(roots.deploy.path,join(roots.source.path,'apps/enterprise-worker-runtime'))
  process.stderr.write(`${JSON.stringify(materialization)}\n`)
  const deployment = await inspectWorkerDeployment(roots.deploy.path)
  const composition = await verifyNativeDeploymentComposition(roots.deploy.path)
  process.stdout.write(`${JSON.stringify({schemaVersion:1,status:'PRODUCTION_DEPLOYMENT_VERIFIED',materialization,deployment,composition,finalWorkerImageAccepted:false})}\n`)
}
