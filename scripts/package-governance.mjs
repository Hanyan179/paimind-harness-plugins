import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const sha256 = value => createHash('sha256').update(value).digest('hex')

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function loadWorkspacePackages() {
  const packagesRoot = join(repositoryRoot, 'packages')
  const directories = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  const packages = []
  for (const directory of directories) {
    const root = join(packagesRoot, directory)
    const manifestPath = join(root, 'package.json')
    if (!existsSync(manifestPath)) continue
    packages.push({
      root,
      relativeRoot: relative(repositoryRoot, root),
      manifestPath,
      manifest: await readJson(manifestPath),
    })
  }
  return packages
}

export async function loadPackageRoles() {
  const path = join(repositoryRoot, 'docs/standards/package-roles.json')
  const registry = await readJson(path)
  return new Map(registry.packages.map(entry => [entry.name, entry]))
}

export async function loadCompatibilityMatrix() {
  const path = join(repositoryRoot, 'docs/compatibility/matrix.md')
  const source = await readFile(path, 'utf8')
  const match = source.match(
    /<!-- compatibility-data:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- compatibility-data:end -->/,
  )
  if (!match) throw new Error('compatibility matrix has no machine-readable JSON block')
  return JSON.parse(match[1])
}

export async function loadRetiredPackages() {
  const path = join(repositoryRoot, 'docs/migration/package-retirement-ledger.md')
  const source = await readFile(path, 'utf8')
  const rows = source.split('\n')
    .filter(line => /^\| `@paimind\//.test(line))
    .map(line => {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
      return {
        name: cells[0]?.replaceAll('`', ''),
        path: cells[1]?.replaceAll('`', ''),
      }
    })
  if (rows.length === 0 || rows.some(row => !row.name || !row.path)) {
    throw new Error('package retirement ledger has no parseable identity rows')
  }
  return { path, rows }
}

export function collectExportTargets(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectExportTargets)
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectExportTargets)
  }
  return []
}

async function walkFiles(root, predicate) {
  if (!existsSync(root)) return []
  const result = []
  const visit = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && predicate(path)) result.push(path)
    }
  }
  await visit(root)
  return result.sort()
}

async function fileSetHash(packageRoot, files) {
  let aggregate = ''
  for (const file of files) {
    aggregate += `${relative(packageRoot, file)}\0${sha256(await readFile(file))}\0`
  }
  return sha256(aggregate)
}

export async function createPackageApiSnapshot(packages) {
  const snapshot = {}
  for (const pkg of packages) {
    const { manifest, root, relativeRoot } = pkg
    const targets = [...new Set(collectExportTargets(manifest.exports))]
    const runtimeFiles = targets
      .filter(target => target.startsWith('./') && target.endsWith('.js'))
      .map(target => join(root, target))
      .filter(existsSync)
      .sort()
    const declarationFiles = await walkFiles(
      join(root, 'lib'),
      path => path.endsWith('.d.ts'),
    )
    const bundleFiles = manifest.dsh?.bundle?.patch
      ? [join(root, manifest.dsh.bundle.patch)].filter(existsSync)
      : []
    const contract = {
      main: manifest.main ?? null,
      types: manifest.types ?? null,
      exports: manifest.exports ?? null,
      dsh: manifest.dsh ?? null,
      paimindBuild: manifest.paimindBuild ?? null,
    }

    snapshot[manifest.name] = {
      path: relativeRoot,
      contractSha256: sha256(JSON.stringify(contract)),
      runtimeExportCount: runtimeFiles.length,
      runtimeExportSha256: await fileSetHash(root, runtimeFiles),
      declarationCount: declarationFiles.length,
      declarationSha256: await fileSetHash(root, declarationFiles),
      bundleFileSha256: await fileSetHash(root, bundleFiles),
    }
  }
  return snapshot
}
