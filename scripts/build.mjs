import { readFile, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

const root = resolve('.')
const packagesRoot = resolve(root, 'packages')
const buildPackages = []
const clientPlatformExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]
const rawImportPlugin = {
  name: 'paimind-raw-import',
  setup(api) {
    api.onResolve({ filter: /\?raw$/ }, async args => {
      const resolved = await api.resolve(args.path.slice(0, -4), {
        importer: args.importer,
        resolveDir: args.resolveDir,
        kind: args.kind,
      })
      if (resolved.errors.length > 0) return resolved
      return { path: resolved.path, namespace: 'paimind-raw-file' }
    })
    api.onLoad({ filter: /.*/, namespace: 'paimind-raw-file' }, async args => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }))
  },
}

for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageRoot = resolve(packagesRoot, entry.name)
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  const spec = manifest.paimindBuild
  if (spec === undefined) continue
  await rm(resolve(packageRoot, 'lib'), { recursive: true, force: true })
  buildPackages.push({ packageRoot, manifest, spec })
}

const types = spawnSync('pnpm', ['exec', 'tsc', '-b', '--force', '--pretty', 'false'], {
  cwd: root,
  encoding: 'utf8',
})
if (types.status !== 0) {
  throw new Error(`declaration build failed\n${types.stdout}\n${types.stderr}`)
}

// Build every package's node-facing exports first. Client bundles may consume
// runtime values from another workspace package (for example the Extension
// Center contribution helper in harness-compat), so directory enumeration is
// not a valid dependency order.
for (const { packageRoot, spec } of buildPackages) {
  for (const source of spec.node ?? []) {
    const name = source.replace(/^src\//, '').replace(/\.tsx?$/, '')
    await build({
      entryPoints: [resolve(packageRoot, source)],
      outfile: resolve(packageRoot, 'lib', `${name}.js`),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      sourcemap: true,
      packages: 'external',
      plugins: [rawImportPlugin],
      logLevel: 'info',
    })
  }
}

// Once all workspace exports exist, bundle each browser contribution.
for (const { packageRoot, manifest, spec } of buildPackages) {
  if (spec.client !== undefined) {
    const id = manifest.name
    await build({
      entryPoints: [resolve(packageRoot, spec.client)],
      outfile: resolve(packageRoot, 'lib/client.js'),
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      plugins: [rawImportPlugin],
      // Harness seeds these shared browser modules into its client module
      // table. Keeping the official primitive/icon package external avoids a
      // duplicate React/UI runtime and lets hot unload retain one icon system.
      external: clientPlatformExternals,
      sourcemap: true,
      logLevel: 'info',
      banner: {
        js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
      },
      footer: { js: 'return module.exports; } });' },
    })
  }
}
