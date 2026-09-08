import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadRetiredPackages, repositoryRoot } from './package-governance.mjs'

const root = join(repositoryRoot, 'examples/platform-integration')
const required = ['README.md', 'index.ts', 'harness-plugin.ts', 'examples.spec.ts', 'tsconfig.json']
const failures = []

for (const file of required) {
  if (!existsSync(join(root, file))) failures.push(`missing examples/platform-integration/${file}`)
}
if (existsSync(join(root, 'package.json'))) {
  failures.push('platform integration examples must not become a workspace package')
}

const source = (await Promise.all(
  required.filter(file => file.endsWith('.ts')).map(file => readFile(join(root, file), 'utf8')),
)).join('\n')
for (const dependency of [
  '@hansen/contracts',
  '@hansen/harness-compat/host',
  '@hansen/platform-sdk',
  '@hansen/platform-scheduler',
  '@hansen/scheduler-adapter-harness',
]) {
  if (!source.includes(dependency)) failures.push(`example does not exercise ${dependency}`)
}
if (!source.includes('ctx.effect(')) failures.push('Harness example has no scoped unload effect')

const retirement = await loadRetiredPackages()
for (const retired of retirement.rows) {
  const pattern = new RegExp(`${retired.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`)
  if (pattern.test(source)) failures.push(`example still references retired identity ${retired.name}`)
}

const rootTsconfig = await readFile(join(repositoryRoot, 'tsconfig.json'), 'utf8')
if (!rootTsconfig.includes('examples/platform-integration')) {
  failures.push('root TypeScript project graph does not include the migrated example')
}

if (failures.length) {
  console.error(`example compliance failed with ${failures.length} issue(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('example compliance passed: migrated code, test and project reference are present; retained public packages are exercised; lifecycle cleanup is scoped; no workspace or retired-package identity was reintroduced')
}
