import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { collectExportTargets, loadWorkspacePackages, repositoryRoot } from './package-governance.mjs'

const packages = await loadWorkspacePackages()
const consumerRoot = mkdtempSync(join(tmpdir(), 'paimind-nodenext-consumer-'))

try {
  const scopeRoot = join(consumerRoot, 'node_modules/@hansen')
  mkdirSync(scopeRoot, { recursive: true })
  for (const pkg of packages) {
    symlinkSync(pkg.root, join(scopeRoot, basename(pkg.manifest.name)), 'dir')
  }

  const imports = []
  let index = 0
  for (const pkg of packages) {
    for (const key of Object.keys(pkg.manifest.exports ?? {})) {
      if (key === './package.json') continue
      const specifier = key === '.' ? pkg.manifest.name : `${pkg.manifest.name}/${key.slice(2)}`
      imports.push(`import * as module${index} from ${JSON.stringify(specifier)}`)
      imports.push(`void module${index}`)
      index += 1
    }
    for (const target of collectExportTargets(pkg.manifest.exports)) {
      if (target.endsWith('.d.ts') && !target.startsWith('./lib/types/')) {
        throw new Error(`${pkg.manifest.name} exposes an unexpected declaration layout: ${target}`)
      }
    }
  }

  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2))
  writeFileSync(join(consumerRoot, 'consumer.ts'), `${imports.join('\n')}\n`)
  writeFileSync(join(consumerRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    files: ['consumer.ts'],
  }, null, 2))

  execFileSync(join(repositoryRoot, 'node_modules/.bin/tsc'), ['-p', join(consumerRoot, 'tsconfig.json'), '--pretty', 'false'], {
    cwd: consumerRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  console.log(`NodeNext consumer passed: ${index} public JavaScript/type export(s) resolved from ${packages.length} external package links`)
} catch (error) {
  console.error(error.stdout || error.stderr || error.stack || error.message)
  process.exitCode = 1
} finally {
  rmSync(consumerRoot, { recursive: true, force: true })
}
