import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { defineAnalysisDataResult, definePresentationFactSet } from '@hansen/presentation-contracts'

const ROOT = process.cwd()
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function workspacePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || isAbsolute(value) || value.split(/[\\/]+/).includes('..')) throw new Error(`${label} must be Workspace-relative`)
  const path = resolve(ROOT, value)
  if (path !== ROOT && !path.startsWith(`${ROOT}${sep}`)) throw new Error(`${label} escapes the Workspace`)
  return path
}
function values(argv) {
  const result = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument ${String(key)}`)
    result.set(key.slice(2), value)
  }
  return result
}
function mergeById(rows, field, label) {
  const merged = new Map()
  for (const row of rows) {
    const key = row[field]
    const prior = merged.get(key)
    if (prior !== undefined && canonical(prior) !== canonical(row)) throw new Error(`conflicting ${label} ${key}`)
    merged.set(key, row)
  }
  return [...merged.values()].sort((left, right) => String(left[field]).localeCompare(String(right[field])))
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!command || command === '--help') {
    process.stdout.write('Usage: runner.mjs build --artifact-ids JSON --paths JSON --output FILE\n')
    return
  }
  if (command !== 'build') throw new Error(`unsupported command ${command}`)
  const input = values(rest)
  const artifactIds = JSON.parse(input.get('artifact-ids'))
  const paths = JSON.parse(input.get('paths'))
  if (!Array.isArray(artifactIds) || !Array.isArray(paths) || artifactIds.length < 1 || artifactIds.length !== paths.length) throw new Error('artifact IDs and paths must be parallel non-empty arrays')
  const results = []
  for (const [index, pathValue] of paths.entries()) {
    const document = defineAnalysisDataResult(JSON.parse(await readFile(workspacePath(pathValue, `paths[${index}]`), 'utf8')))
    results.push(document)
  }
  const sources = mergeById(results.flatMap(result => result.sources), 'sourceId', 'source')
  const facts = mergeById(results.flatMap(result => result.facts), 'factId', 'Fact')
  const factSet = definePresentationFactSet({
    schema: 'paimind.fact-set/v1', analysisArtifactIds: artifactIds,
    sources, facts, factsSha256: createHash('sha256').update(canonical(facts)).digest('hex'),
  })
  const output = workspacePath(input.get('output'), 'output')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, canonical(factSet))
  process.stdout.write(canonical({ status: 'success', command, output: relative(ROOT, output), facts: facts.length, sources: sources.length }))
}

await main()
