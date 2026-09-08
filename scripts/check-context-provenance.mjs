import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const commit = 'b810d09f5358eeb4aeeef2acdde45aff54405277'
const root = resolve('packages/workspace-editors')
const editors = JSON.parse(await readFile(resolve(root, 'PROVENANCE.json'), 'utf8'))
const library = JSON.parse(await readFile('packages/context-library/PROVENANCE.json', 'utf8'))
for (const source of [editors, library]) {
  if (source.commit !== commit || source.license !== 'Apache-2.0' || source.repository !== 'https://github.com/cloudflare/cloudflare-os') throw new Error('Unreviewed reference baseline')
}
if (editors.files.length !== 9 || editors.archives.length !== 3 || library.references.length !== 3) throw new Error('Incomplete source inventory')
for (const file of editors.files) {
  if (!/^[a-f0-9]{64}$/.test(file.sha256) || !editors.archives.some(archive => archive.path === file.source)) throw new Error('Missing original source digest: ' + file.localPath)
  if (digest(await readFile(resolve(root, file.localPath))) !== file.adaptedSha256) throw new Error('Unrecorded adapted source change: ' + file.localPath)
}
if (digest(await readFile(resolve(root, 'LICENSE'))) !== editors.licenseSource.sha256) throw new Error('Reference license changed')
const records = [...editors.archives, ...library.references, editors.licenseSource]
for (const source of records) if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Missing pinned digest: ' + source.path)
const referenceIndex = process.argv.indexOf('--reference')
if (referenceIndex >= 0) {
  const checkout = process.argv[referenceIndex + 1]
  if (!checkout) throw new Error('--reference requires a checkout path')
  for (const source of records) {
    const bytes = execFileSync('git', ['-C', checkout, 'show', `${commit}:${source.path}`], { maxBuffer: 20 * 1024 * 1024 })
    if (digest(bytes) !== source.sha256) throw new Error('Pinned upstream source mismatch: ' + source.path)
  }
}
console.log(`Context provenance passed: 9 adapted files, 3 archive records, 3 design references, Apache-2.0 license${referenceIndex >= 0 ? ', pinned upstream bytes verified' : ''}`)
