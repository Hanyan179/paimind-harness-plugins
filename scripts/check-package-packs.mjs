import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectExportTargets, loadWorkspacePackages } from './package-governance.mjs'
import { auditPackedDeclarations, declaredTypeEntries, isDeclaration } from './declaration-reachability.mjs'

const failures = []
const packages = await loadWorkspacePackages()
const forbidden = [
  /(^|\/)\.tsbuildinfo$/,
  /(^|\/)tsconfig\.tsbuildinfo$/,
  /(^|\/)(tests?|coverage|\.dsh-home|node_modules)(\/|$)/,
  /(^|\/)(\.env|credentials?)(\.|$)/i,
  /(^|\/)src\//,
]

for (const pkg of packages) {
  let report
  try {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkg.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    report = JSON.parse(output)[0]
  } catch (error) {
    failures.push(`${pkg.manifest.name}: npm pack --dry-run failed: ${error.stderr || error.message}`)
    continue
  }
  const packed = new Set(report.files.map(file => file.path))
  const declaredRuntime = new Set(
    collectExportTargets(pkg.manifest.exports)
      .filter(target => target.startsWith('./') && target.endsWith('.js'))
      .map(target => target.slice(2)),
  )
  for (const source of pkg.manifest.paimindBuild?.node ?? []) {
    declaredRuntime.add(`lib/${source.replace(/^src\//, '').replace(/\.tsx?$/, '.js')}`)
  }
  if (pkg.manifest.paimindBuild?.client) declaredRuntime.add('lib/client.js')
  for (const path of packed) {
    if (forbidden.some(pattern => pattern.test(path))) {
      failures.push(`${pkg.manifest.name}: forbidden packed file ${path}`)
    }
    if (path.startsWith('lib/') && path.endsWith('.js') && !declaredRuntime.has(path)) {
      failures.push(`${pkg.manifest.name}: packed JavaScript has no export, client or declared runtime entry: ${path}`)
    }
    if (path.endsWith('.map') && !packed.has(path.slice(0, -4))) {
      failures.push(`${pkg.manifest.name}: packed source map has no packed artifact: ${path}`)
    }
  }
  const declarations = new Map([...packed].filter(isDeclaration)
    .map(path => [path, readFileSync(join(pkg.root, path), 'utf8')]))
  const declarationAudit = auditPackedDeclarations(declarations,
    declaredTypeEntries(pkg.manifest, collectExportTargets(pkg.manifest.exports)))
  for (const path of declarationAudit.orphaned) {
    failures.push(`${pkg.manifest.name}: packed declaration has no public or declared runtime consumer: ${path}`)
  }
  for (const error of declarationAudit.missing) failures.push(`${pkg.manifest.name}: ${error}`)
  for (const target of collectExportTargets(pkg.manifest.exports)) {
    if (!target.startsWith('./') || target === './package.json') continue
    const path = target.slice(2)
    if (!existsSync(join(pkg.root, path))) {
      failures.push(`${pkg.manifest.name}: exported target is missing before pack: ${target}`)
    } else if (!packed.has(path)) {
      failures.push(`${pkg.manifest.name}: exported target is absent from tarball: ${target}`)
    }
  }
}

if (failures.length) {
  console.error(`package pack audit failed with ${failures.length} issue(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`package pack audit passed: ${packages.length} tarball dry run(s), zero build metadata, source, test, local-runtime or credential pollution, every export and local type dependency packed, all JavaScript/declarations reachable from public or declared runtime entries, and no orphan source maps`)
}
