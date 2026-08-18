import { publint } from 'publint'
import { formatMessage } from 'publint/utils'
import { loadPackageRoles, loadWorkspacePackages } from './package-governance.mjs'

const failures = []
const packages = await loadWorkspacePackages()
const roles = await loadPackageRoles()
let harnessClientExceptions = 0

for (const pkg of packages) {
  try {
    const result = await publint({ pkgDir: pkg.root, pack: 'pnpm', strict: true })
    for (const message of result.messages) {
      const isHarnessClientFormat = roles.get(pkg.manifest.name)?.role === 'client-plugin'
        && message.code === 'FILE_INVALID_FORMAT'
        && message.args.actualFormat === 'CJS'
        && message.args.expectFormat === 'ESM'
        && message.args.actualFilePath === './lib/client.js'
        && message.path.join('/') === 'exports/./client/default'
      if (isHarnessClientFormat) {
        harnessClientExceptions += 1
      } else {
        failures.push(`${pkg.manifest.name}: ${message.code}: ${formatMessage(message, result.pkg, { color: false })}`)
      }
    }
  } catch (error) {
    failures.push(`${pkg.manifest.name}: ${error.stack || error.message}`)
  }
}

if (failures.length) {
  console.error(`publint failed for ${failures.length} package(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`publint passed in strict mode for ${packages.length} package(s); ${harnessClientExceptions} exact dsh.client CJS-loader format exception(s) were recognized by package role and export path`)
}
