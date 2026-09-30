import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Capture source only. Runtime homes, databases, Docker resources and ignored
// files are deliberately outside this archive and must be preserved separately.
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (root, ...args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 })

export function captureLegacySource(sourcePath, productPath, evidenceParent) {
  const source = realpathSync(sourcePath)
  const product = realpathSync(productPath)
  const parent = realpathSync(evidenceParent)
  for (const root of [source, product]) {
    const rel = relative(root, parent)
    if (!rel.startsWith('..' + '/') && !isAbsolute(rel)) throw new Error('Evidence must be outside both worktrees')
  }
  const status = git(source, 'status', '--porcelain=v1', '-z', '-uall')
  const productStatus = git(product, 'status', '--porcelain=v1', '-z', '-uall')
  const head = git(source, 'rev-parse', 'HEAD').toString().trim()
  const productHead = git(product, 'rev-parse', 'HEAD').toString().trim()
  const mergeBase = git(source, 'merge-base', head, productHead).toString().trim()
  const productChanges = new Set(git(product, 'diff', '--name-only', '-z', mergeBase, productHead).toString().split('\0').filter(Boolean))
  const rows = status.toString().split('\0').filter(Boolean).map(row => {
    const state = row.slice(0, 2)
    const path = row.slice(3)
    if (/[RC]/.test(state)) throw new Error('Rename/copy status needs explicit migration review')
    if (isAbsolute(path) || path.split('/').includes('..')) throw new Error('Invalid Git path')
    return { state, path }
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const inspect = row => {
    const path = join(source, row.path)
    let stat
    try { stat = lstatSync(path) } catch (error) {
      if (error.code === 'ENOENT' && row.state.includes('D')) return { ...row, kind: 'deleted' }
      throw error
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Unsupported source kind: ' + row.path)
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path)
    return { ...row, kind: stat.isSymbolicLink() ? 'symlink' : 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: hash(bytes) }
  }
  const entries = rows.map(inspect)
  const output = mkdtempSync(join(parent, 'haas-legacy-source-'))
  chmodSync(output, 0o700)
  const baseArchive = join(output, 'legacy-head.tar')
  const dirtyArchive = join(output, 'legacy-dirty.tar.gz')
  git(source, 'archive', '--format=tar', '--output=' + baseArchive, head)
  const present = entries.filter(entry => entry.kind !== 'deleted').map(entry => entry.path)
  if (present.length === 0) throw new Error('No legacy changes to archive')
  execFileSync('tar', ['-czf', dirtyArchive, '--', ...present], { cwd: source, maxBuffer: 1024 * 1024 })
  for (const path of [baseArchive, dirtyArchive]) chmodSync(path, 0o600)
  if (!status.equals(git(source, 'status', '--porcelain=v1', '-z', '-uall'))
    || !productStatus.equals(git(product, 'status', '--porcelain=v1', '-z', '-uall'))
    || head !== git(source, 'rev-parse', 'HEAD').toString().trim()
    || productHead !== git(product, 'rev-parse', 'HEAD').toString().trim()
    || JSON.stringify(entries) !== JSON.stringify(rows.map(inspect))) {
    throw new Error('Sources changed during capture; incomplete evidence retained at ' + output)
  }
  const manifest = {
    schemaVersion: 1, evidenceRole: 'legacy-source-snapshot-not-acceptance', capturedAt: new Date().toISOString(),
    source: { root: source, branch: git(source, 'branch', '--show-current').toString().trim(), head, statusSha256: hash(status) },
    product: { root: product, head: productHead, statusSha256: hash(productStatus) },
    mergeBase,
    counts: { total: entries.length, trackedDirty: rows.filter(row => row.state !== '??').length, untracked: rows.filter(row => row.state === '??').length },
    overlappingProductPaths: entries.filter(entry => productChanges.has(entry.path)).map(entry => entry.path),
    entries,
    archives: [baseArchive, dirtyArchive].map(path => ({ file: basename(path), sha256: hash(readFileSync(path)), bytes: lstatSync(path).size })),
    restoration: 'In a NEW disposable directory extract legacy-head.tar, overlay legacy-dirty.tar.gz, and remove only paths explicitly marked deleted. Never extract over a live worktree. Verify every entry digest before use.',
    excluded: ['ignored files', '.dsh-home', 'credentials outside tracked source', 'runtime data', 'Docker resources'],
  }
  const manifestPath = join(output, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return { output, manifestSha256: hash(readFileSync(manifestPath)), counts: manifest.counts, overlap: manifest.overlappingProductPaths.length, sourceHead: head, productHead }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error('Usage: node capture-legacy-source.mjs LEGACY_ROOT PRODUCT_ROOT EXISTING_EVIDENCE_PARENT')
  process.umask(0o077)
  console.log(JSON.stringify(captureLegacySource(...process.argv.slice(2)), null, 2))
}
