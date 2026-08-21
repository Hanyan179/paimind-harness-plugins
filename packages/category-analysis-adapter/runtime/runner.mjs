import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const RUNTIME = dirname(fileURLToPath(import.meta.url))
const DEMO = resolve(RUNTIME, 'demo-data')
const SCHEMA_MANIFEST = 'paimind.analysis-source-manifest/v1'
const SCHEMA_RESULT = 'paimind.data-result/v2'
const PERIOD = '13 weeks through August 14, 2026'
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const SHA = /^[a-f0-9]{64}$/

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function shaText(value) { return createHash('sha256').update(value).digest('hex') }
async function shaFile(path) { return shaText(await readFile(path)) }
function workspacePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || isAbsolute(value) || value.split(/[\\/]+/).includes('..')) throw new Error(`${label} must be a Workspace-relative path`)
  const path = resolve(ROOT, value)
  if (path !== ROOT && !path.startsWith(`${ROOT}${sep}`)) throw new Error(`${label} escapes the Workspace`)
  return path
}
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
function csv(text) {
  const lines = text.trim().split(/\r?\n/)
  const headers = lines.shift().split(',')
  return lines.map(line => Object.fromEntries(line.split(',').map((value, index) => [headers[index], value])))
}
function number(value, label) {
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`${label} must be numeric`)
  return result
}
function pct(value) { return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` }
function money(value) { return value >= 1 ? `$${value.toFixed(2).replace(/\.00$/, '')}M` : `$${Math.round(value * 1000)}K` }
function source(manifest, sourceId) {
  const row = manifest.sources.find(item => item.sourceId === sourceId)
  if (!row) throw new Error(`manifest lacks ${sourceId}`)
  return row
}
function sourceProjection(row) {
  return {
    sourceId: row.sourceId,
    name: basename(row.path),
    path: row.path,
    sha256: row.sha256,
    format: row.format,
    role: row.purpose,
    period: row.period,
    summary: row.summary,
    redaction: row.redaction,
  }
}
function fact({ factId, sourceId, rawValue, displayValue, valueType = 'source_value', fieldPath, formula, method, definition, period = PERIOD, filters = [], businessExplanation, dimensions = [], measures = [], calculation, aggregation = 'none', sourceFields = [], lineage = [] }) {
  return {
    factId, sourceIds: [sourceId], rawValue, displayValue, valueType, fieldPath,
    ...(formula ? { formula } : {}), method, definition, period, filters,
    ...(businessExplanation ? { businessExplanation } : {}), dimensions, measures,
    technical: {
      definition, ...(calculation ? { calculation } : {}), aggregation, sourceFields, filters,
      codeFile: 'packages/category-analysis-adapter/runtime/runner.mjs',
      lineage: lineage.length ? lineage : [{ stepId: `${factId}:read`, label: 'Read frozen source', operation: `Read ${fieldPath} from the hash-verified synthetic fixture.` }],
    },
    factValuesChanged: false,
  }
}

async function prepare(values) {
  const outputDirValue = values.get('output-dir')
  const outputDir = workspacePath(outputDirValue, 'output-dir')
  await mkdir(outputDir, { recursive: true })
  const definitions = [
    ['dg-department-performance', 'dg-department-performance.csv', 'Department performance and inventory baseline', 'Synthetic values rebuilt from the supplied DG buyer-story example.'],
    ['dg-weekly-sales', 'dg-weekly-sales.csv', 'Current and prior weekly POS trend', 'Synthetic weekly detail calibrated to the reference-deck headline totals.'],
    ['dg-category-opportunity', 'dg-category-opportunity.csv', 'Category opportunity and recommendation inputs', 'Synthetic category opportunity assumptions for demonstration only.'],
  ]
  const sources = []
  for (const [sourceId, fileName, purpose, summary] of definitions) {
    const target = resolve(outputDir, fileName)
    await copyFile(resolve(DEMO, fileName), target)
    sources.push({
      sourceId, path: relative(ROOT, target), sha256: await shaFile(target), bytes: (await stat(target)).size,
      period: PERIOD, format: 'csv', purpose, summary,
      redaction: 'Synthetic demo data; contains no real customer transactions and must not be presented as external market truth.',
    })
  }
  const manifest = { schema: SCHEMA_MANIFEST, scenario: 'Dollar General Kids Creative & Celebration', synthetic: true, referenceDeckSha256: '4e321943851ca1c1b70358d1200eb7d754a164f069d43a8678268c445374af30', sources }
  const manifestPath = resolve(outputDir, 'source-manifest.json')
  await writeFile(manifestPath, canonical(manifest))
  return relative(ROOT, manifestPath)
}

async function loadManifest(pathValue) {
  const path = workspacePath(pathValue, 'manifest')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest.schema !== SCHEMA_MANIFEST || manifest.synthetic !== true || !Array.isArray(manifest.sources) || manifest.sources.length < 1) throw new Error('invalid synthetic analysis manifest')
  for (const row of manifest.sources) {
    if (!ID.test(row.sourceId) || !SHA.test(row.sha256)) throw new Error('manifest contains an invalid source identity')
    const sourcePath = workspacePath(row.path, `source ${row.sourceId}`)
    if (await shaFile(sourcePath) !== row.sha256) throw new Error(`source hash mismatch: ${row.sourceId}`)
    if ((await stat(sourcePath)).size !== row.bytes) throw new Error(`source byte count mismatch: ${row.sourceId}`)
  }
  return { path, manifest }
}

async function writeResult({ analysisKind, manifestPath, manifest, sources, facts, payload, output }) {
  const payloadText = canonical(payload)
  const document = {
    schema: SCHEMA_RESULT, analysisKind,
    sourceManifest: relative(ROOT, manifestPath), sourceManifestSha256: await shaFile(manifestPath),
    sources: sources.map(sourceProjection), facts,
    payloadSha256: shaText(payloadText), payload,
  }
  const outputPath = workspacePath(output, 'output')
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, canonical(document))
  return relative(ROOT, outputPath)
}

async function performance(values) {
  const { path: manifestPath, manifest } = await loadManifest(values.get('manifest'))
  const departmentsSource = source(manifest, 'dg-department-performance')
  const weeklySource = source(manifest, 'dg-weekly-sales')
  const departments = csv(await readFile(workspacePath(departmentsSource.path, 'department source'), 'utf8')).map(row => ({
    ...row,
    current_sales_m: number(row.current_sales_m, 'current sales'), current_units_m: number(row.current_units_m, 'current units'),
    prior_sales_m: number(row.prior_sales_m, 'prior sales'), prior_units_m: number(row.prior_units_m, 'prior units'),
    stores: number(row.stores, 'stores'), wos: number(row.wos, 'wos'),
  }))
  const weekly = csv(await readFile(workspacePath(weeklySource.path, 'weekly source'), 'utf8')).map(row => ({ week: row.week, current_sales_m: number(row.current_sales_m, 'current weekly sales'), prior_sales_m: number(row.prior_sales_m, 'prior weekly sales') }))
  const totalSales = departments.reduce((sum, row) => sum + row.current_sales_m, 0)
  const priorSales = departments.reduce((sum, row) => sum + row.prior_sales_m, 0)
  const totalUnits = departments.reduce((sum, row) => sum + row.current_units_m, 0)
  const priorUnits = departments.reduce((sum, row) => sum + row.prior_units_m, 0)
  const salesYoy = (totalSales / priorSales - 1) * 100
  const unitsYoy = (totalUnits / priorUnits - 1) * 100
  const averagePrice = totalSales / totalUnits
  const facts = [
    fact({ factId: 'performance.total-sales', sourceId: departmentsSource.sourceId, rawValue: totalSales, displayValue: '$15.2M', valueType: 'derived_metric', fieldPath: '$.rows[*].current_sales_m', formula: 'SUM(current_sales_m)', method: 'Sum current 13-week department sales.', definition: 'Total 13-week POS sales', businessExplanation: 'The category has a meaningful current sales base.', measures: [{ key: 'sales', label: 'Sales', value: totalSales, displayValue: '$15.2M' }], calculation: 'SUM(current_sales_m)', aggregation: 'sum', sourceFields: ['current_sales_m'] }),
    fact({ factId: 'performance.total-units', sourceId: departmentsSource.sourceId, rawValue: totalUnits, displayValue: '7.5M', valueType: 'derived_metric', fieldPath: '$.rows[*].current_units_m', formula: 'SUM(current_units_m)', method: 'Sum current 13-week department units.', definition: 'Total 13-week POS units', businessExplanation: 'Unit growth is the primary demand signal.', measures: [{ key: 'units', label: 'Units', value: totalUnits, displayValue: '7.5M' }], calculation: 'SUM(current_units_m)', aggregation: 'sum', sourceFields: ['current_units_m'] }),
    fact({ factId: 'performance.average-price', sourceId: departmentsSource.sourceId, rawValue: averagePrice, displayValue: '$2.03', valueType: 'derived_metric', fieldPath: '$.rows[*].[current_sales_m,current_units_m]', formula: 'SUM(current_sales_m) / SUM(current_units_m)', method: 'Divide total sales by total units.', definition: 'Average selling price', businessExplanation: 'A stable low price supports a volume-led value-retail proposition.', measures: [{ key: 'average_price', label: 'Average price', value: averagePrice, displayValue: '$2.03' }], calculation: 'SUM(sales) / SUM(units)', aggregation: 'ratio-of-sums', sourceFields: ['current_sales_m', 'current_units_m'] }),
    fact({ factId: 'performance.sales-yoy', sourceId: departmentsSource.sourceId, rawValue: salesYoy, displayValue: pct(salesYoy), valueType: 'derived_metric', fieldPath: '$.rows[*].[current_sales_m,prior_sales_m]', formula: 'SUM(current_sales_m) / SUM(prior_sales_m) - 1', method: 'Compare current and prior 13-week sales.', definition: '13-week sales growth', businessExplanation: 'Broad-based sales momentum provides the base for growth investment.', measures: [{ key: 'sales_yoy', label: 'Sales YoY', value: salesYoy, displayValue: pct(salesYoy) }], calculation: 'current / prior - 1', aggregation: 'ratio-of-sums', sourceFields: ['current_sales_m', 'prior_sales_m'] }),
    fact({ factId: 'performance.units-yoy', sourceId: departmentsSource.sourceId, rawValue: unitsYoy, displayValue: pct(unitsYoy), valueType: 'derived_metric', fieldPath: '$.rows[*].[current_units_m,prior_units_m]', formula: 'SUM(current_units_m) / SUM(prior_units_m) - 1', method: 'Compare current and prior 13-week units.', definition: '13-week unit growth', businessExplanation: 'Units are growing faster than sales, confirming a volume-led story.', measures: [{ key: 'units_yoy', label: 'Units YoY', value: unitsYoy, displayValue: pct(unitsYoy) }], calculation: 'current / prior - 1', aggregation: 'ratio-of-sums', sourceFields: ['current_units_m', 'prior_units_m'] }),
  ]
  for (const row of departments) {
    const key = `dept-${row.department_id}`
    const share = row.current_sales_m / totalSales * 100
    const salesGrowth = row.prior_sales_m === 0 ? null : (row.current_sales_m / row.prior_sales_m - 1) * 100
    const unitsGrowth = row.prior_units_m === 0 ? null : (row.current_units_m / row.prior_units_m - 1) * 100
    const dimensions = [{ key: 'department', label: 'Department', value: row.department_id }, { key: 'category', label: 'Category', value: row.category_name }]
    const base = { sourceId: departmentsSource.sourceId, period: PERIOD, filters: [`department_id=${row.department_id}`], dimensions }
    facts.push(
      fact({ ...base, factId: `${key}.sales`, rawValue: row.current_sales_m, displayValue: money(row.current_sales_m), fieldPath: `row[department_id=${row.department_id}].current_sales_m`, method: 'Read current department sales.', definition: `${row.category_name} current sales`, businessExplanation: `${row.category_name} contributes ${share.toFixed(1)}% of the current sales base.`, measures: [{ key: 'sales', label: 'Sales', value: row.current_sales_m, displayValue: money(row.current_sales_m) }], sourceFields: ['department_id', 'current_sales_m'] }),
      fact({ ...base, factId: `${key}.share`, rawValue: share, displayValue: `${share.toFixed(1)}%`, valueType: 'derived_metric', fieldPath: `row[department_id=${row.department_id}].current_sales_m`, formula: 'department current sales / total current sales', method: 'Divide department sales by total sales.', definition: `${row.category_name} sales share`, measures: [{ key: 'share', label: 'Sales share', value: share, displayValue: `${share.toFixed(1)}%` }], calculation: 'department_sales / total_sales', aggregation: 'ratio', sourceFields: ['current_sales_m'] }),
      fact({ ...base, factId: `${key}.sales-yoy`, rawValue: salesGrowth ?? 'New', displayValue: salesGrowth === null ? 'New' : pct(salesGrowth), valueType: salesGrowth === null ? 'narrative' : 'derived_metric', fieldPath: `row[department_id=${row.department_id}].[current_sales_m,prior_sales_m]`, ...(salesGrowth === null ? {} : { formula: 'current_sales_m / prior_sales_m - 1' }), method: salesGrowth === null ? 'Classify a zero-prior-sales department as new.' : 'Compare current and prior department sales.', definition: `${row.category_name} sales growth`, ...(salesGrowth === null ? {} : { measures: [{ key: 'sales_yoy', label: 'Sales YoY', value: salesGrowth, displayValue: pct(salesGrowth) }], calculation: 'current / prior - 1' }), sourceFields: ['current_sales_m', 'prior_sales_m'] }),
      fact({ ...base, factId: `${key}.units-yoy`, rawValue: unitsGrowth ?? 'New', displayValue: unitsGrowth === null ? 'New' : pct(unitsGrowth), valueType: unitsGrowth === null ? 'narrative' : 'derived_metric', fieldPath: `row[department_id=${row.department_id}].[current_units_m,prior_units_m]`, ...(unitsGrowth === null ? {} : { formula: 'current_units_m / prior_units_m - 1' }), method: unitsGrowth === null ? 'Classify a zero-prior-units department as new.' : 'Compare current and prior department units.', definition: `${row.category_name} unit growth`, ...(unitsGrowth === null ? {} : { measures: [{ key: 'units_yoy', label: 'Units YoY', value: unitsGrowth, displayValue: pct(unitsGrowth) }], calculation: 'current / prior - 1' }), sourceFields: ['current_units_m', 'prior_units_m'] }),
      fact({ ...base, factId: `${key}.stores`, rawValue: row.stores, displayValue: row.stores.toLocaleString('en-US'), fieldPath: `row[department_id=${row.department_id}].stores`, method: 'Read active store count.', definition: `${row.category_name} active stores`, measures: [{ key: 'stores', label: 'Stores', value: row.stores, displayValue: row.stores.toLocaleString('en-US') }], sourceFields: ['stores'] }),
      fact({ ...base, factId: `${key}.wos`, rawValue: row.wos, displayValue: row.wos.toFixed(1), fieldPath: `row[department_id=${row.department_id}].wos`, method: 'Read current weeks of supply.', definition: `${row.category_name} weeks of supply`, measures: [{ key: 'wos', label: 'Weeks of supply', value: row.wos, displayValue: row.wos.toFixed(1) }], sourceFields: ['wos'] }),
      fact({ ...base, factId: `${key}.growth-role`, rawValue: row.growth_role, displayValue: row.growth_role, valueType: 'narrative', fieldPath: `row[department_id=${row.department_id}].growth_role`, method: 'Read the deterministic growth-role classification.', definition: `${row.category_name} growth role`, businessExplanation: row.growth_role, sourceFields: ['growth_role'] }),
    )
  }
  for (const row of weekly) for (const series of ['current', 'prior']) {
    const value = row[`${series}_sales_m`]
    facts.push(fact({ factId: `weekly.${series}.${row.week}`, sourceId: weeklySource.sourceId, rawValue: value, displayValue: money(value), fieldPath: `row[week=${row.week}].${series}_sales_m`, method: `Read ${series} weekly POS sales.`, definition: `${series === 'current' ? 'Current' : 'Prior'} weekly POS sales`, filters: [`week=${row.week}`], dimensions: [{ key: 'week', label: 'Week', value: row.week }, { key: 'series', label: 'Series', value: series }], measures: [{ key: 'sales', label: 'Sales', value, displayValue: money(value) }], sourceFields: ['week', `${series}_sales_m`] }))
  }
  return writeResult({ analysisKind: 'category-performance-analysis', manifestPath, manifest, sources: [departmentsSource, weeklySource], facts, payload: { synthetic: true, summary: { totalSales, totalUnits, averagePrice, salesYoy, unitsYoy }, departments, weekly }, output: values.get('output') })
}

async function opportunity(values) {
  const { path: manifestPath, manifest } = await loadManifest(values.get('manifest'))
  const opportunitySource = source(manifest, 'dg-category-opportunity')
  const categories = csv(await readFile(workspacePath(opportunitySource.path, 'opportunity source'), 'utf8')).map(row => ({ ...row, gross_margin_pct: number(row.gross_margin_pct, 'gross margin'), avg_price: number(row.avg_price, 'average price'), distribution_gap_pct: number(row.distribution_gap_pct, 'distribution gap'), velocity_index: number(row.velocity_index, 'velocity index'), opportunity_score: number(row.opportunity_score, 'opportunity score') }))
  const facts = []
  for (const row of categories) {
    const key = `category-${row.department_id}`
    const dimensions = [{ key: 'department', label: 'Department', value: row.department_id }, { key: 'category', label: 'Category', value: row.category_name }]
    const base = { sourceId: opportunitySource.sourceId, filters: [`department_id=${row.department_id}`], dimensions }
    for (const [suffix, field, label, display, definition] of [
      ['gross-margin', 'gross_margin_pct', 'Gross margin', `${row.gross_margin_pct.toFixed(1)}%`, 'Gross margin rate'],
      ['average-price', 'avg_price', 'Average price', `$${row.avg_price.toFixed(2)}`, 'Average selling price'],
      ['distribution-gap', 'distribution_gap_pct', 'Distribution gap', `${row.distribution_gap_pct.toFixed(1)}%`, 'Unserved distribution opportunity'],
      ['velocity-index', 'velocity_index', 'Velocity index', row.velocity_index.toFixed(0), 'Indexed store-level velocity'],
      ['opportunity-score', 'opportunity_score', 'Opportunity score', row.opportunity_score.toFixed(0), 'Composite opportunity score'],
    ]) facts.push(fact({ ...base, factId: `${key}.${suffix}`, rawValue: row[field], displayValue: display, fieldPath: `row[department_id=${row.department_id}].${field}`, method: `Read ${label.toLowerCase()} from the frozen opportunity fixture.`, definition: `${row.category_name} ${definition.toLowerCase()}`, businessExplanation: `${row.category_name} has a ${display} ${label.toLowerCase()}.`, measures: [{ key: field, label, value: row[field], displayValue: display }], sourceFields: [field] }))
    facts.push(fact({ ...base, factId: `${key}.recommended-action`, rawValue: row.recommended_action, displayValue: row.recommended_action, valueType: 'narrative', fieldPath: `row[department_id=${row.department_id}].recommended_action`, method: 'Read the deterministic action classification.', definition: `${row.category_name} recommended action`, businessExplanation: `${row.recommended_action} ${row.category_name}.`, sourceFields: ['recommended_action'] }))
  }
  return writeResult({ analysisKind: 'category-opportunity-analysis', manifestPath, manifest, sources: [opportunitySource], facts, payload: { synthetic: true, categories }, output: values.get('output') })
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!command || command === '--help') {
    process.stdout.write('Usage: runner.mjs prepare --output-dir DIR | performance|opportunity --manifest FILE --output FILE\n')
    return
  }
  const values = args(rest)
  const output = command === 'prepare' ? await prepare(values) : command === 'performance' ? await performance(values) : command === 'opportunity' ? await opportunity(values) : (() => { throw new Error(`unsupported command ${command}`) })()
  process.stdout.write(canonical({ status: 'success', command, output }))
}

await main()
