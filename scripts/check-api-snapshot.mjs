import { join } from 'node:path'
import {
  createPackageApiSnapshot,
  loadPackageRoles,
  loadWorkspacePackages,
  readJson,
  repositoryRoot,
} from './package-governance.mjs'

const snapshotPath = join(
  repositoryRoot,
  'docs/acceptance/baseline-remediation/api-snapshot.json',
)
const expected = await readJson(snapshotPath)
const roles = await loadPackageRoles()
const packages = (await loadWorkspacePackages()).filter(pkg => roles.has(pkg.manifest.name))
const actual = await createPackageApiSnapshot(packages)
const failures = []

for (const name of new Set([...Object.keys(expected.packages), ...Object.keys(actual)])) {
  if (!expected.packages[name]) failures.push(`${name}: missing from protected baseline`)
  else if (!actual[name]) failures.push(`${name}: package missing from current workspace`)
  else if (JSON.stringify(expected.packages[name]) !== JSON.stringify(actual[name])) {
    for (const key of Object.keys(expected.packages[name])) {
      if (expected.packages[name][key] !== actual[name][key]) {
        failures.push(`${name}: ${key} expected ${expected.packages[name][key]} but found ${actual[name][key]}`)
      }
    }
  }
}

if (failures.length) {
  console.error(`API snapshot check failed with ${failures.length} unexpected difference(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`API snapshot passed: ${packages.length} package contract(s), exported runtime entries, generated declarations and bundle patch match the protected baseline`)
}
