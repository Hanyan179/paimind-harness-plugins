import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('.')
const packagesRoot = resolve(root, 'packages')
const policy = JSON.parse(await readFile(resolve(root, 'docs/compatibility/bundle-budget.json'), 'utf8'))
const rows = []
const dependencyConsumers = new Map()
const multipleVersions = []

function dependencySource(source) {
  const match = source.match(/node_modules\/.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  return match === null ? undefined : { install: match[1], name: match[2] }
}

for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageRoot = resolve(packagesRoot, entry.name)
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  if (manifest.hansenBuild?.client === undefined) continue
  const clientPath = resolve(packageRoot, 'lib/client.js')
  const mapPath = `${clientPath}.map`
  const bytes = (await stat(clientPath)).size
  const limit = policy.overrides[manifest.name] ?? policy.defaultClientLimitBytes
  rows.push({ package: manifest.name, bytes, limit, status: bytes <= limit ? 'PASS' : 'FAIL' })

  const sourceMap = JSON.parse(await readFile(mapPath, 'utf8'))
  const installsByName = new Map()
  for (const source of sourceMap.sources ?? []) {
    const dependency = dependencySource(source)
    if (dependency === undefined) continue
    const installs = installsByName.get(dependency.name) ?? new Set()
    installs.add(dependency.install)
    installsByName.set(dependency.name, installs)
    const consumers = dependencyConsumers.get(dependency.name) ?? new Set()
    consumers.add(manifest.name)
    dependencyConsumers.set(dependency.name, consumers)
  }
  for (const [name, installs] of installsByName) {
    if (installs.size > 1) multipleVersions.push({ package: manifest.name, dependency: name, installs: [...installs].sort() })
  }
}

rows.sort((left, right) => right.bytes - left.bytes)
console.log('Client bundle budget (bytes)')
for (const row of rows) console.log(`${row.status}\t${row.bytes}\t${row.limit}\t${row.package}`)

const shared = [...dependencyConsumers]
  .filter(([, consumers]) => consumers.size > 1)
  .map(([dependency, consumers]) => ({ dependency, consumers: [...consumers].sort() }))
  .sort((left, right) => right.consumers.length - left.consumers.length || left.dependency.localeCompare(right.dependency))
console.log('\nEmbedded dependency reuse report')
for (const row of shared) console.log(`${row.dependency}\t${row.consumers.length}\t${row.consumers.join(', ')}`)

if (multipleVersions.length > 0) {
  console.error('\nDuplicate versions embedded in a single client bundle')
  for (const row of multipleVersions) console.error(`${row.package}\t${row.dependency}\t${row.installs.join(', ')}`)
}

const failures = rows.filter(row => row.status === 'FAIL')
if (failures.length > 0 || multipleVersions.length > 0) {
  process.exitCode = 1
} else {
  console.log(`\nBundle budget verified for ${rows.length} client packages; no bundle embeds multiple versions of one dependency.`)
}
