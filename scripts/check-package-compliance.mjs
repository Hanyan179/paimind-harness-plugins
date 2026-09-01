import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  loadCompatibilityMatrix,
  loadPackageRoles,
  loadRetiredPackages,
  loadWorkspacePackages,
  readJson,
  repositoryRoot,
} from './package-governance.mjs'

const failures = []
const fail = (kind, message) => failures.push(`[${kind}] ${message}`)
const packages = await loadWorkspacePackages()
const roles = await loadPackageRoles()
const matrix = await loadCompatibilityMatrix()
const retirement = await loadRetiredPackages()
const rootManifest = await readJson(join(repositoryRoot, 'package.json'))
const workspacePolicy = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
const byName = new Map()

const ignoredScanDirectories = new Set(['.git', 'node_modules', 'lib', 'coverage', '.tmp', '.dsh-home'])
const repositoryFiles = []
const collectRepositoryFiles = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredScanDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collectRepositoryFiles(path)
    else if (entry.isFile()) repositoryFiles.push(path)
  }
}
await collectRepositoryFiles(repositoryRoot)

for (const retired of retirement.rows) {
  if (existsSync(join(repositoryRoot, retired.path))) {
    fail('retirement', `${retired.path} still exists`)
  }
  for (const path of repositoryFiles) {
    if (path === retirement.path) continue
    let source
    try { source = await readFile(path, 'utf8') } catch { continue }
    for (let index = source.indexOf(retired.name); index !== -1; index = source.indexOf(retired.name, index + retired.name.length)) {
      const next = source[index + retired.name.length] ?? ''
      if (!/[A-Za-z0-9-]/.test(next)) {
        fail('retirement', `${retired.name} remains in ${relative(repositoryRoot, path)}`)
        break
      }
    }
  }
}

for (const pkg of packages) {
  const name = pkg.manifest.name
  if (!name) fail('identity', `${pkg.relativeRoot} has no package name`)
  else if (byName.has(name)) fail('identity', `${name} is declared more than once`)
  else byName.set(name, pkg)
}

for (const [name, role] of roles) {
  const pkg = byName.get(name)
  if (!pkg) {
    fail('role', `${name} is registered at ${role.path} but has no package`)
    continue
  }
  if (pkg.relativeRoot !== role.path) {
    fail('identity', `${name} is at ${pkg.relativeRoot}; registry says ${role.path}`)
  }
}

for (const pkg of packages) {
  const { manifest, relativeRoot, root } = pkg
  const name = manifest.name || relativeRoot
  const role = roles.get(manifest.name)
  if (!role) fail('role', `${name} has no package-role registration`)

  const readmePath = join(root, 'README.md')
  if (!existsSync(readmePath)) {
    fail('readme', `${name} has no README.md`)
  } else {
    const readme = await readFile(readmePath, 'utf8')
    for (const heading of [
      'Responsibility',
      'Public entry points',
      'Dependencies',
      'Lifecycle and failure',
      'Published files',
      'Verification',
    ]) {
      if (!readme.includes(`## ${heading}`)) {
        fail('readme', `${name} README is missing "## ${heading}"`)
      }
    }
    if (!readme.includes('docs/standards/plugin-authoring.md')) {
      fail('readme', `${name} README does not link the authoring standard`)
    }
  }

  if (!manifest.description) fail('manifest', `${name} has no description`)
  if (!manifest.license) fail('manifest', `${name} has no explicit license policy`)
  if (manifest.engines?.node !== matrix.toolchain.node) {
    fail('manifest', `${name} does not declare the selected Node.js engine`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('pack', `${name} has no publish allowlist`)
  } else if (manifest.files.includes('lib')) {
    fail('pack', `${name} publishes the entire lib tree, including .tsbuildinfo`)
  }

  const isBundle = manifest.dsh?.bundle?.patch !== undefined
  if (!isBundle) {
    if (manifest.type !== 'module') fail('manifest', `${name} is not ESM`)
    if (!manifest.main) fail('manifest', `${name} has no main entry`)
    if (!manifest.types) fail('manifest', `${name} has no types entry`)
    if (!manifest.exports) fail('manifest', `${name} has no exports map`)
  }

  const isClient = role?.role === 'client-plugin'
  if (isClient) {
    if (manifest.dsh?.client?.platform !== 'web') {
      fail('client', `${name} has no dsh.client web discovery metadata`)
    }
    if (!manifest.paimindBuild?.client) fail('client', `${name} has no client build entry`)
    if (!manifest.exports?.['./client']) fail('client', `${name} has no ./client export`)
    if (!manifest.exports?.['./package.json']) {
      fail('client', `${name} has no ./package.json discovery export`)
    }
  } else if (manifest.dsh?.client !== undefined || manifest.paimindBuild?.client !== undefined) {
    fail('client', `${name} is ${role?.role ?? 'unregistered'} but declares a client`)
  }

  for (const group of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
    'devDependencies',
  ]) {
    for (const [dependency, version] of Object.entries(manifest[group] ?? {})) {
      if (!dependency.startsWith('@paimind/')) continue
      if (!byName.has(dependency)) {
        fail('dependency', `${name} ${group} references missing ${dependency}`)
      }
      if (version !== 'workspace:^') {
        fail('dependency', `${name} ${group} must use workspace:^ for ${dependency}`)
      }
    }
  }
}

const incoming = new Map(packages.map(pkg => [pkg.manifest.name, []]))
for (const pkg of packages) {
  for (const group of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
    'devDependencies',
  ]) {
    for (const dependency of Object.keys(pkg.manifest[group] ?? {})) {
      if (incoming.has(dependency)) incoming.get(dependency).push(`${pkg.manifest.name}:${group}`)
    }
  }
}

for (const pkg of packages) {
  if (pkg.manifest.name === '@paimind/harness-bundle') continue
  if ((incoming.get(pkg.manifest.name) ?? []).length === 0) {
    fail('orphan', `${pkg.manifest.name} has no package consumer`)
  }
}

const productionEdges = new Map()
for (const pkg of packages) {
  productionEdges.set(
    pkg.manifest.name,
    ['dependencies', 'peerDependencies', 'optionalDependencies']
      .flatMap(group => Object.keys(pkg.manifest[group] ?? {}))
      .filter(dependency => byName.has(dependency)),
  )
}
const reachable = new Set()
const visit = name => {
  if (reachable.has(name)) return
  reachable.add(name)
  for (const dependency of productionEdges.get(name) ?? []) visit(dependency)
}
visit('@paimind/harness-bundle')
for (const [name, role] of roles) {
  if ((role.role === 'client-plugin' || role.role === 'headless-plugin') && !reachable.has(name)) {
    fail('reachability', `${name} is not reachable from @paimind/harness-bundle`)
  }
}

const bundle = byName.get('@paimind/harness-bundle')?.manifest
for (const provider of matrix.providers) {
  if (provider.owner === 'external' || provider.owner === '@paimind/better-sidebar-adapter') {
    const selected = bundle?.dependencies?.[provider.package]
    if (selected !== provider.version) {
      fail('version', `bundle must pin ${provider.package}@${provider.version}; found ${selected ?? 'missing'}`)
    }
  }
}
const sidebarProvider = matrix.providers.find(provider => provider.package === 'dsh-better-sidebar')
const sidebarAdapterSource = await readFile(join(
  repositoryRoot,
  'packages/better-sidebar-adapter/src/index.ts',
), 'utf8')
const sidebarAdapterVersion = /VERIFIED_BETTER_SIDEBAR_VERSION = '([^']+)'/.exec(sidebarAdapterSource)?.[1]
if (sidebarProvider === undefined || sidebarAdapterVersion !== sidebarProvider.version) {
  fail(
    'version',
    `better-sidebar adapter contract must report the selected provider version ${sidebarProvider?.version ?? 'missing'}; found ${sidebarAdapterVersion ?? 'missing'}`,
  )
}
if (rootManifest.engines?.node !== matrix.toolchain.node) {
  fail('version', 'root Node.js engine differs from the compatibility matrix')
}
if (rootManifest.packageManager !== `pnpm@${matrix.toolchain.pnpm}`) {
  fail('version', 'root pnpm version differs from the compatibility matrix')
}
if (!/^minimumReleaseAge:\s*1440\s*$/mu.test(workspacePolicy)) {
  fail('supply-chain', 'pnpm-workspace.yaml must enforce minimumReleaseAge: 1440')
}
if (/^minimumReleaseAgeExclude:/mu.test(workspacePolicy)) {
  fail('supply-chain', 'pnpm-workspace.yaml must not bypass package-age checks')
}

if (failures.length) {
  console.error(`package compliance failed with ${failures.length} issue(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  const roleCounts = [...roles.values()].reduce((counts, role) => {
    counts[role.role] = (counts[role.role] ?? 0) + 1
    return counts
  }, {})
  console.log(`package compliance passed: ${packages.length} package(s), ${JSON.stringify(roleCounts)}, unique identities, real consumers, reachable runtime graph, clean manifests, exact compatibility pins and a 24-hour package-age gate`)
}
