import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const application = resolve(root, 'apps/enterprise-server')
await build({ entryPoints: ['cli', 'runtime-maintenance', 'runtime-admission', 'runtime-resources', 'runtime-recovery'].map(name => resolve(application, `src/${name}.ts`)), outdir: resolve(application, 'lib'),
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', sourcemap: true })
console.log('Enterprise control-plane API built. Native UI ships as a Harness plugin; no independent workbench is built.')
