import { readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const packagesRoot = resolve('packages')
for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  await rm(resolve(packagesRoot, entry.name, 'lib'), { recursive: true, force: true })
}

