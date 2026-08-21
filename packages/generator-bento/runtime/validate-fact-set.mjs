import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import {
  canonicalJson,
  definePresentationFactSet,
  definePresentationOutline,
} from '@paimind/presentation-contracts'

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

function rowsById(rows, key) {
  return new Map(rows.map(row => [row[key], row]))
}

function assertBoundToFactSet(outline, factSet, expectedArtifactId) {
  if (outline.factSetArtifactId !== expectedArtifactId) throw new Error('outline Fact Set Artifact ID does not match the exact current-Session Artifact')
  if (outline.factSetFactsSha256 !== factSet.factsSha256) throw new Error('outline Fact Set hash does not match')
  const sources = rowsById(factSet.sources, 'sourceId')
  for (const source of outline.sources) {
    const verified = sources.get(source.sourceId)
    if (verified === undefined || canonicalJson(verified) !== canonicalJson(source)) throw new Error(`outline source ${source.sourceId} does not match the Fact Set`)
  }
  const facts = rowsById(factSet.facts, 'factId')
  for (const fact of outline.facts) {
    const verified = facts.get(fact.factId)
    if (verified === undefined || canonicalJson(verified) !== canonicalJson(fact)) throw new Error(`outline Fact ${fact.factId} does not match the Fact Set`)
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!['validate', 'read'].includes(command)) throw new Error('Usage: validate-fact-set.mjs validate|read --outline FILE [--fact-set FILE --fact-set-artifact-id ID]')
  const input = args(rest)
  const outline = definePresentationOutline(JSON.parse(await readFile(workspacePath(input.get('outline'), 'outline'), 'utf8')))
  const factSetPath = input.get('fact-set')
  const factSetArtifactId = input.get('fact-set-artifact-id')
  if ((factSetPath === undefined) !== (factSetArtifactId === undefined)) throw new Error('Fact Set path and Artifact ID must be provided together')
  if (factSetPath !== undefined) {
    const factSet = definePresentationFactSet(JSON.parse(await readFile(workspacePath(factSetPath, 'fact-set'), 'utf8')))
    assertBoundToFactSet(outline, factSet, factSetArtifactId)
  } else if (outline.factSetArtifactId !== undefined) {
    throw new Error('a Fact Set-bound outline requires exact Fact Set Artifact resolution')
  }
  process.stdout.write(command === 'read' ? canonicalJson(outline) : JSON.stringify({ status: 'success', facts: outline.facts.length, sources: outline.sources.length, factSetArtifactId: outline.factSetArtifactId ?? null }))
}

await main()
