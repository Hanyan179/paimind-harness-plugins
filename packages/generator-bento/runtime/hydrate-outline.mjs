import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import {
  canonicalJson,
  definePresentationFactSet,
  definePresentationOutline,
} from '@paimind/presentation-contracts'

const ROOT = process.cwd()
const BLUEPRINT_SCHEMA = 'paimind.presentation-outline-blueprint/v1'
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

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

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}
function array(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`)
  return value
}
function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}
function id(value, label) {
  const result = text(value, label)
  if (!ID.test(result)) throw new Error(`${label} must be a stable identifier`)
  return result
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`)
  return values
}
function optionalText(value, label) { return value === undefined ? undefined : text(value, label) }

function factFor(facts, value, label) {
  const factId = id(value, label)
  const fact = facts.get(factId)
  if (fact === undefined) throw new Error(`${label} references Fact ${factId}, which is absent from the exact Fact Set`)
  return fact
}

function numericValue(fact, label) {
  if (typeof fact.rawValue === 'number' && Number.isFinite(fact.rawValue)) return fact.rawValue
  const measure = fact.measures.find(candidate => Number.isFinite(candidate.value))
  if (measure !== undefined) return measure.value
  throw new Error(`${label} Fact ${fact.factId} cannot be plotted because it has no numeric value`)
}

function presentationOnlyElement(input, objectId, type, label) {
  if (input.factId !== undefined || input.points !== undefined || input.rows !== undefined) throw new Error(`${label} presentation-only element cannot reference Facts`)
  return {
    objectId, type,
    ...(optionalText(input.title, `${label}.title`) === undefined ? {} : { title: optionalText(input.title, `${label}.title`) }),
    ...(optionalText(input.text, `${label}.text`) === undefined ? {} : { text: optionalText(input.text, `${label}.text`) }),
    factIds: [], bindings: [], presentationOnly: true,
  }
}

function hydrateElement(value, facts, label) {
  const input = record(value, label)
  const objectId = id(input.objectId, `${label}.objectId`)
  const type = text(input.type, `${label}.type`)
  if (!['title', 'text', 'kpi', 'chart', 'table', 'list', 'decoration'].includes(type)) throw new Error(`${label}.type is unsupported`)
  if (input.presentationOnly === true || type === 'decoration' || type === 'list') return presentationOnlyElement(input, objectId, type, label)

  if (type === 'chart') {
    const kind = text(input.chartKind, `${label}.chartKind`)
    const points = array(input.points, `${label}.points`).map((value, index) => {
      const point = record(value, `${label}.points[${index}]`)
      const fact = factFor(facts, point.factId, `${label}.points[${index}].factId`)
      return {
        seriesKey: id(point.seriesKey, `${label}.points[${index}].seriesKey`),
        categoryKey: id(point.categoryKey, `${label}.points[${index}].categoryKey`),
        label: text(point.label, `${label}.points[${index}].label`),
        value: numericValue(fact, `${label}.points[${index}]`),
        displayValue: fact.displayValue,
        factId: fact.factId,
      }
    })
    const factIds = unique(points.map(point => point.factId), `${label}.points`)
    return {
      objectId, type,
      ...(optionalText(input.title, `${label}.title`) === undefined ? {} : { title: optionalText(input.title, `${label}.title`) }),
      factIds,
      bindings: points.map(point => ({ factId: point.factId, selector: { kind: 'chart-point', seriesKey: point.seriesKey, categoryKey: point.categoryKey } })),
      chart: { kind, points },
    }
  }

  if (type === 'table') {
    const columns = array(input.columns, `${label}.columns`).map((value, index) => {
      const column = record(value, `${label}.columns[${index}]`)
      return { columnKey: id(column.columnKey, `${label}.columns[${index}].columnKey`), label: text(column.label, `${label}.columns[${index}].label`) }
    })
    unique(columns.map(column => column.columnKey), `${label}.columns`)
    const columnKeys = new Set(columns.map(column => column.columnKey))
    const bindings = []
    const rows = array(input.rows, `${label}.rows`).map((value, rowIndex) => {
      const row = record(value, `${label}.rows[${rowIndex}]`)
      const rowKey = id(row.rowKey, `${label}.rows[${rowIndex}].rowKey`)
      const cells = array(row.cells, `${label}.rows[${rowIndex}].cells`).map((value, cellIndex) => {
        const cell = record(value, `${label}.rows[${rowIndex}].cells[${cellIndex}]`)
        const columnKey = id(cell.columnKey, `${label}.rows[${rowIndex}].cells[${cellIndex}].columnKey`)
        if (!columnKeys.has(columnKey)) throw new Error(`${label}.rows[${rowIndex}].cells[${cellIndex}] references an unknown column`)
        const fact = factFor(facts, cell.factId, `${label}.rows[${rowIndex}].cells[${cellIndex}].factId`)
        bindings.push({ factId: fact.factId, selector: { kind: 'table-cell', rowKey, columnKey } })
        return { rowKey, columnKey, displayValue: fact.displayValue, factId: fact.factId }
      })
      unique(cells.map(cell => cell.columnKey), `${label}.rows[${rowIndex}].cells`)
      return { rowKey, label: text(row.label, `${label}.rows[${rowIndex}].label`), cells }
    })
    unique(rows.map(row => row.rowKey), `${label}.rows`)
    return {
      objectId, type,
      ...(optionalText(input.title, `${label}.title`) === undefined ? {} : { title: optionalText(input.title, `${label}.title`) }),
      factIds: unique(bindings.map(binding => binding.factId), `${label}.facts`), bindings,
      table: { columns, rows },
    }
  }

  const fact = factFor(facts, input.factId, `${label}.factId`)
  return {
    objectId, type,
    ...(optionalText(input.title, `${label}.title`) === undefined ? {} : { title: optionalText(input.title, `${label}.title`) }),
    ...(optionalText(input.text, `${label}.text`) === undefined ? {} : { text: optionalText(input.text, `${label}.text`) }),
    ...(type === 'kpi' ? { displayValue: fact.displayValue } : {}),
    factIds: [fact.factId], bindings: [{ factId: fact.factId, selector: { kind: 'object' } }],
  }
}

function hydrateBlueprint(blueprintCandidate, factSet, factSetArtifactId) {
  const blueprint = record(blueprintCandidate, 'blueprint')
  if (blueprint.schema !== BLUEPRINT_SCHEMA) throw new Error(`blueprint.schema must be ${BLUEPRINT_SCHEMA}`)
  const facts = new Map(factSet.facts.map(fact => [fact.factId, fact]))
  const selectedFactIds = []
  const slides = array(blueprint.slides, 'blueprint.slides').map((value, slideIndex) => {
    const slide = record(value, `blueprint.slides[${slideIndex}]`)
    const slideId = id(slide.slideId, `blueprint.slides[${slideIndex}].slideId`)
    const elements = array(slide.elements, `blueprint.slides[${slideIndex}].elements`).map((value, elementIndex) => hydrateElement(value, facts, `blueprint.slides[${slideIndex}].elements[${elementIndex}]`))
    unique(elements.map(element => element.objectId), `blueprint.slides[${slideIndex}].elements`)
    const slideFactIds = unique(elements.flatMap(element => element.factIds), `blueprint.slides[${slideIndex}].facts`)
    selectedFactIds.push(...slideFactIds)
    const title = text(slide.title, `blueprint.slides[${slideIndex}].title`)
    const narrative = text(slide.narrative, `blueprint.slides[${slideIndex}].narrative`)
    const blockId = `${slideId}:facts`
    return {
      slideId,
      layout: text(slide.layout, `blueprint.slides[${slideIndex}].layout`),
      ...(optionalText(slide.eyebrow, `blueprint.slides[${slideIndex}].eyebrow`) === undefined ? {} : { eyebrow: optionalText(slide.eyebrow, `blueprint.slides[${slideIndex}].eyebrow`) }),
      title, narrative, elements,
      ...(slideFactIds.length === 0 ? {} : { trace: {
        businessBlocks: [{ blockId, label: title, description: narrative }],
        metrics: [{ metricId: `${slideId}:verified-facts`, label: 'Verified facts on this slide', businessBlockId: blockId, factIds: slideFactIds }],
      } }),
    }
  })
  unique(slides.map(slide => slide.slideId), 'blueprint.slides')
  const selected = [...new Set(selectedFactIds)]
  if (selected.length === 0) throw new Error('blueprint must bind at least one Fact')
  const selectedFacts = selected.map(factId => facts.get(factId))
  const selectedSourceIds = new Set(selectedFacts.flatMap(fact => fact.sourceIds))
  const sources = factSet.sources.filter(source => selectedSourceIds.has(source.sourceId))
  const outline = {
    schema: 'paimind.presentation-outline/v1',
    title: text(blueprint.title, 'blueprint.title'),
    ...(optionalText(blueprint.subtitle, 'blueprint.subtitle') === undefined ? {} : { subtitle: optionalText(blueprint.subtitle, 'blueprint.subtitle') }),
    factSetArtifactId,
    factSetFactsSha256: factSet.factsSha256,
    design: record(blueprint.design, 'blueprint.design'),
    sources, facts: selectedFacts, slides,
  }
  return definePresentationOutline(outline)
}

async function main() {
  const input = args(process.argv.slice(2))
  const blueprintPath = workspacePath(input.get('blueprint'), 'blueprint')
  const factSetPath = workspacePath(input.get('fact-set'), 'fact-set')
  const outputPath = workspacePath(input.get('output'), 'output')
  const factSetArtifactId = id(input.get('fact-set-artifact-id'), 'fact-set-artifact-id')
  const blueprint = JSON.parse(await readFile(blueprintPath, 'utf8'))
  const factSet = definePresentationFactSet(JSON.parse(await readFile(factSetPath, 'utf8')))
  const outline = hydrateBlueprint(blueprint, factSet, factSetArtifactId)
  if (dirname(outputPath) !== ROOT && !dirname(outputPath).startsWith(`${ROOT}${sep}`)) throw new Error('output directory escapes the Workspace')
  await writeFile(outputPath, canonicalJson(outline))
  process.stdout.write(JSON.stringify({ status: 'success', output: input.get('output'), facts: outline.facts.length, sources: outline.sources.length, slides: outline.slides.length }))
}

await main()
