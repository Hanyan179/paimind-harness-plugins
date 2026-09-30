import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { createRawImportPlugin } from '../raw-import-plugin.mjs'

test('raw import bundles and source maps are identical across relocated worktrees', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'paimind-build-relocation-'))
  try {
    const outputs = []
    for (const name of ['first-checkout', 'different-checkout']) {
      const root = join(temporary, name)
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src/entry.js'), 'import value from "./text.txt?raw"; export {value};\n')
      await writeFile(join(root, 'src/text.txt'), '真实内容保持不变\n')
      const result = await build({ absWorkingDir: root, entryPoints: ['src/entry.js'], outfile: 'lib/entry.js',
        bundle: true, format: 'esm', sourcemap: true, write: false, plugins: [createRawImportPlugin(root)] })
      outputs.push(result.outputFiles.map(file => file.text))
      for (const file of result.outputFiles) assert.ok(!file.text.includes(root))
    }
    assert.deepEqual(outputs[0], outputs[1])
    assert.ok(outputs[0][1].includes('paimind-raw-file:src/text.txt'))
  } finally { await rm(temporary, { recursive: true, force: true }) }
})
