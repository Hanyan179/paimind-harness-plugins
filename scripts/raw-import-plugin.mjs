import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

/** Stable raw-module identity across worktrees; the underlying file is still
 * resolved normally. No hardcoded checkout path or relaxed API hashing. */
export function createRawImportPlugin(root) {
  const canonicalRoot = realpathSync(root)
  return {
    name: 'paimind-raw-import',
    setup(api) {
      api.onResolve({ filter: /\?raw$/ }, async args => {
        const resolved = await api.resolve(args.path.slice(0, -4), {
          importer: args.importer, resolveDir: args.resolveDir, kind: args.kind,
        })
        if (resolved.errors.length > 0) return resolved
        return { path: relative(canonicalRoot, realpathSync(resolved.path)).split(sep).join('/'), namespace: 'paimind-raw-file' }
      })
      api.onLoad({ filter: /.*/, namespace: 'paimind-raw-file' }, async args => ({
        contents: await readFile(resolve(canonicalRoot, args.path), 'utf8'), loader: 'text',
      }))
    },
  }
}
