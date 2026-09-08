import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [directory, libraryDirectory] = process.argv.slice(2)
if (!directory || !libraryDirectory) {
  throw new Error('Usage: node scripts/verify-context-migration-evidence.mjs <private-export-directory> <running-library-directory>')
}
const root = resolve(directory)
const libraryRoot = resolve(libraryDirectory)
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const manifest = await json(join(root, 'manifest.json'))
const receipt = await json(join(root, 'import-receipt.json'))
assert.equal(manifest.schema, 'paimind.context-migration/v1')
const files = new Map()
let migratedFiles = 0
let migratedBytes = 0
for (const collection of manifest.collections) {
  const target = receipt.collections.find((entry) => entry.sourceId === collection.sourceId)
  assert.ok(target, 'Every exported collection must have a destination')
  assert.equal(target.files.length, collection.files.length)
  for (const file of collection.files) {
    assert.ok(!file.path.startsWith('/') && !file.path.split('/').some((part) => !part || part === '..' || part === '.'))
    const source = join(root, 'originals', collection.sourceId, file.path)
    const destination = join(libraryRoot, 'collections', target.collectionId, file.path)
    for (const path of [source, destination]) {
      const bytes = await readFile(path)
      assert.equal(bytes.length, file.bytes, 'File size must match the exported original')
      assert.equal(sha256(bytes), file.sha256, 'File bytes must match the exported original')
    }
    files.set(target.collectionId + '/' + file.path, { ...file, source })
    migratedFiles++
    migratedBytes += file.bytes
  }
}
const results = new Map()
const answersForTurn = (proof, turn) => proof.answers.filter((answer) => answer.turn === turn).flatMap((answer) => answer.content).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
const resultFor = (proof, call) => proof.results.find((result) => result.callId === call.callId)
const textResult = (result) => result.content.flatMap((part) => part.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
let verifiedModelReads = 0
for (const key of ['sku-browser', 'trend', 'skills', 'pdf', 'unconnected']) {
  const proof = await json(join(root, 'evidence', key + '.json'))
  assert.equal(proof.running, false, 'Capture only completed model turns')
  assert.ok(proof.turns.length > 0)
  assert.ok(proof.answers.some((answer) => answer.source?.kind === 'model' && answer.source.provider === 'deepseek-official'))
  assert.ok(proof.calls.every((call) => ['skill', 'paimind_context'].includes(call.name)), 'No file-system or network bypass in these scoped tests')
  assert.ok(proof.catalogs.every((catalog) => catalog.entries.every((entry) => !['synthesize-category-trends', 'build-trend-cards'].includes(entry.name))), 'Migrated SKILL.md files must not become registered skills')
  for (const call of proof.calls.filter((call) => call.name === 'paimind_context')) {
    const args = JSON.parse(call.arguments)
    const result = resultFor(proof, call)
    assert.ok(result, 'Each native call must have its correlated result')
    if (args.action !== 'read' || result.content.some((part) => part.isError)) continue
    const value = JSON.parse(textResult(result))
    if (!value.document) continue
    const doc = value.document
    const file = files.get(args.collectionId + '/' + args.path)
    assert.ok(file, 'Successful reads must belong to migrated source files')
    assert.equal(doc.entry.revision, 'sha256:' + file.sha256)
    assert.equal(doc.entry.bytes, file.bytes)
    const sourceBytes = await readFile(file.source)
    const returnedBytes = Buffer.from(doc.content, doc.encoding)
    assert.deepEqual(returnedBytes, sourceBytes.subarray(doc.offset, doc.offset + returnedBytes.length))
    assert.ok(proof.answers.some((answer) => answer.seq > result.seq), 'Model reply must follow the observed read')
    verifiedModelReads++
  }
  results.set(key, proof)
}
const sku = manifest.collections.find((collection) => collection.title === 'sku data')
const productFile = sku.files.find((file) => file.path.endsWith('/products/19beads-06/product.json'))
const catalogFile = sku.files.find((file) => file.path.endsWith('/raw/snapshots/wmt-d19-kids-2026-08-31/catalog.json'))
const artifactFile = sku.files.find((file) => file.path.endsWith('/pages/19beads-06/artifact.json'))
const product = await json(join(root, 'originals', sku.sourceId, productFile.path))
const catalog = await json(join(root, 'originals', sku.sourceId, catalogFile.path))
const artifact = await json(join(root, 'originals', sku.sourceId, artifactFile.path))
const skuProof = results.get('sku-browser')
const answer = answersForTurn(skuProof, 1)
for (const fact of [product.title, product.productInformation.suggestedRetail, String(artifact.provenance.sourceSlideNumber), String(catalog.counts.products), String(catalog.counts.subcategories), productFile.path, catalogFile.path, artifactFile.path]) {
  assert.ok(answer.includes(fact), 'Product answer must match actual source facts and cite the read files')
}
const restartRead = skuProof.calls.find((call) => call.turn === 3 && call.name === 'paimind_context' && JSON.parse(call.arguments).action === 'read' && JSON.parse(call.arguments).path === productFile.path)
assert.ok(restartRead, 'The post-restart turn must make a fresh native file read')
const restartState = await json(join(root, 'evidence/post-restart-state.json'))
const nativeStartedAt = Date.parse(restartState.nativeStartedAt)
assert.ok(skuProof.answers.filter((answer) => answer.turn === 2).every((answer) => answer.time < nativeStartedAt), 'The preceding turn must predate the new host process')
assert.ok(nativeStartedAt < restartRead.time, 'The new native read must follow the new host process start')
assert.ok(!resultFor(skuProof, restartRead).content.some((part) => part.isError))
for (const fact of [product.title, product.productInformation.suggestedRetail, productFile.path]) {
  assert.ok(answersForTurn(skuProof, 3).includes(fact), 'The post-restart answer must match the reread original')
}
const write = skuProof.calls.find((call) => call.name === 'paimind_context' && JSON.parse(call.arguments).action === 'write')
assert.ok(write)
assert.match(textResult(resultFor(skuProof, write)), /ACCESS_DENIED/)
const skuId = receipt.collections.find((collection) => collection.sourceId === sku.sourceId).collectionId
await assert.rejects(access(join(libraryRoot, 'collections', skuId, '__permission_probe.txt')), { code: 'ENOENT' })
const permissionProof = results.get('unconnected')
const listCall = permissionProof.calls.find((call) => call.turn === 1 && JSON.parse(call.arguments).action === 'collections')
assert.deepEqual(JSON.parse(textResult(resultFor(permissionProof, listCall))).collections, [])
const searchCall = permissionProof.calls.find((call) => call.turn === 1 && JSON.parse(call.arguments).action === 'search')
assert.deepEqual(JSON.parse(textResult(resultFor(permissionProof, searchCall))).hits, [])
assert.ok(answersForTurn(permissionProof, 2).includes(product.title))
const revokedRead = permissionProof.calls.find((call) => call.turn === 3 && call.name === 'paimind_context' && JSON.parse(call.arguments).action === 'read')
assert.ok(revokedRead)
assert.match(textResult(resultFor(permissionProof, revokedRead)), /ACCESS_DENIED/)
const pdfProof = results.get('pdf')
const pdfCall = pdfProof.calls.find((call) => call.name === 'paimind_context' && JSON.parse(call.arguments).path === 'raw/reports/mik_trends_2026.pdf' && JSON.parse(call.arguments).action === 'read')
const pdf = JSON.parse(textResult(resultFor(pdfProof, pdfCall))).document
assert.equal(pdf.encoding, 'base64')
assert.equal(Buffer.from(pdf.content, 'base64').subarray(0, 5).toString(), '%PDF-')
assert.match(answersForTurn(pdfProof, 1), /无法解析|不能.*列出/s)
const report = {
  verifiedAt: new Date().toISOString(),
  migratedCollections: manifest.collections.length,
  migratedFiles,
  migratedBytes,
  verifiedModelReads,
  sourceIntegrity: 'passed',
  productFactsAndCitations: 'passed',
  unconnectedDiscovery: 'passed',
  sessionGrantAndRevocation: 'passed',
  readonlyWriteDenied: 'passed',
  postRestartNativeReread: 'passed',
  migratedSkillsNotRegistered: 'passed',
  pdfBinaryAccess: 'passed',
  pdfBodyUnderstanding: 'not-supported: the context tool currently returns raw bytes, not parsed PDF text',
  sessions: [...results].map(([key, proof]) => ({ key, sessionId: proof.sessionId, turns: proof.turns.length, calls: proof.calls.length })),
}
await writeFile(join(root, 'evidence', 'verification.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
