import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import {
  canonicalJson,
  definePresentationFactSet,
  definePresentationOutline,
  traceFromPresentationOutline,
  validatePresentationTraceability,
} from '@paimind/presentation-contracts'
import { renderTraceableBentoDocument } from '../lib/index.js'

const ROOT = process.cwd()

function args(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument ${String(key)}`)
    values.set(key.slice(2), value)
  }
  return values
}

function workspacePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || isAbsolute(value) || value.split(/[\\/]+/).includes('..')) throw new Error(`${label} must be Workspace-relative`)
  const path = resolve(ROOT, value)
  if (path !== ROOT && !path.startsWith(`${ROOT}${sep}`)) throw new Error(`${label} escapes the Workspace`)
  return path
}

function sidecarPath(htmlPath, suffix) {
  return htmlPath.toLowerCase().endsWith('.bento.html') ? `${htmlPath.slice(0, -'.bento.html'.length)}${suffix}` : `${htmlPath.slice(0, -'.html'.length)}${suffix}`
}

function rowsById(rows, key) { return new Map(rows.map(row => [row[key], row])) }

function assertBoundToFactSet(outline, factSet, expectedArtifactId) {
  if (outline.factSetArtifactId !== expectedArtifactId) throw new Error('outline Fact Set Artifact ID does not match the exact current-Session Artifact')
  if (outline.factSetFactsSha256 !== factSet.factsSha256) throw new Error('outline Fact Set hash does not match')
  const sources = rowsById(factSet.sources, 'sourceId')
  for (const source of outline.sources) if (canonicalJson(sources.get(source.sourceId)) !== canonicalJson(source)) throw new Error(`outline source ${source.sourceId} does not match the Fact Set`)
  const facts = rowsById(factSet.facts, 'factId')
  for (const fact of outline.facts) if (canonicalJson(facts.get(fact.factId)) !== canonicalJson(fact)) throw new Error(`outline Fact ${fact.factId} does not match the Fact Set`)
}

async function verifySourceHashes(outline) {
  for (const source of outline.sources) {
    const actual = createHash('sha256').update(await readFile(workspacePath(source.path, `source ${source.sourceId}`))).digest('hex')
    if (actual !== source.sha256) throw new Error(`source hash mismatch for ${source.sourceId}`)
  }
}

async function main() {
  const input = args(process.argv.slice(2))
  const outlinePath = workspacePath(input.get('outline'), 'outline')
  const factSetPath = workspacePath(input.get('fact-set'), 'fact-set')
  const outputPath = workspacePath(input.get('output'), 'output')
  const factSetArtifactId = input.get('fact-set-artifact-id')
  const outlineArtifactId = input.get('outline-artifact-id')
  const outline = definePresentationOutline(JSON.parse(await readFile(outlinePath, 'utf8')))
  const factSet = definePresentationFactSet(JSON.parse(await readFile(factSetPath, 'utf8')))
  assertBoundToFactSet(outline, factSet, factSetArtifactId)
  await verifySourceHashes(outline)
  const trace = traceFromPresentationOutline(outline)
  const validation = validatePresentationTraceability(outline, true)
  if (!validation.valid || validation.resolutionRate !== 1 || validation.factValuesChanged) throw new Error('presentation trace validation failed')
  const traceJson = canonicalJson(trace)
  const validationJson = canonicalJson({ ...validation, outlineArtifactId, factSetArtifactId: outline.factSetArtifactId, factSetFactsSha256: outline.factSetFactsSha256 })
  const tracePath = sidecarPath(input.get('output'), '.trace.json')
  const validationPath = sidecarPath(input.get('output'), '.validation.json')
  await writeFile(workspacePath(tracePath, 'trace output'), traceJson)
  await writeFile(workspacePath(validationPath, 'validation output'), validationJson)
  await writeFile(outputPath, renderTraceableBentoDocument(outline))
  process.stdout.write(JSON.stringify({
    status: 'success', title: outline.title, tracePath, validationPath,
    traceSchema: trace.schemaVersion,
    traceSha256: createHash('sha256').update(traceJson).digest('hex'),
    traceBytes: Buffer.byteLength(traceJson),
  }))
}

await main()
