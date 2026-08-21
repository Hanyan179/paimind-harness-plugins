import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { canonicalJson, definePresentationOutline } from '../../presentation-contracts/src/index.js'

const run = promisify(execFile)

const fact = (factId: string, value: number, displayValue: string) => ({
  factId, sourceIds: ['source-1'], rawValue: value, displayValue, valueType: 'source_value',
  fieldPath: `row.${factId}`, method: 'Read the frozen value.', definition: `${factId} definition`,
  period: 'Test period', filters: [], dimensions: [{ key: 'category', label: 'Category', value: factId }],
  measures: [{ key: 'value', label: 'Value', value, displayValue }],
  technical: { definition: 'Frozen value', aggregation: 'none', sourceFields: [factId], filters: [], lineage: [{ stepId: `${factId}:read`, label: 'Read', operation: 'Read frozen value.' }] },
  factValuesChanged: false,
})

describe('Fact-bound presentation blueprint hydration', () => {
  it('copies canonical Facts and Sources while deriving values, bindings and complete trace groups', async () => {
    const temp = await mkdtemp(resolve(process.cwd(), '.tmp-bento-hydrate-'))
    const relative = temp.slice(process.cwd().length + 1)
    const frozenData = 'category,value\nTotal,15.2\n'
    const source = {
      sourceId: 'source-1', name: 'frozen.csv', path: `${relative}/frozen.csv`,
      sha256: createHash('sha256').update(frozenData).digest('hex'),
      format: 'csv', role: 'Frozen test input', period: 'Test period', summary: 'Synthetic test source.',
    }
    const first = fact('fact.sales', 15.2, '$15.2M')
    const second = fact('fact.growth', 16.1, '+16.1%')
    const factSet = { schema: 'paimind.fact-set/v1', analysisArtifactIds: ['artifact:analysis'], sources: [source], facts: [first, second], factsSha256: 'a'.repeat(64) }
    const blueprint = {
      schema: 'paimind.presentation-outline-blueprint/v1', title: 'Hydrated deck',
      design: { schema: 'paimind.presentation-design/v1', templateId: 'paramont-mountain', stylePreset: 'paramont-signature', aspectRatio: '16:9', canvas: { width: 1280, height: 720 }, density: 'balanced' },
      slides: [
        { slideId: 'momentum', layout: 'cover', title: 'Momentum', narrative: 'Verified sales momentum.', elements: [
          { objectId: 'sales-kpi', type: 'kpi', title: 'Sales', factId: 'fact.sales' },
          { objectId: 'hero-copy', type: 'text', text: 'Dollar General synthetic demo', presentationOnly: true },
        ] },
        { slideId: 'evidence', layout: 'comparison', title: 'Evidence', narrative: 'Trace every visual object.', elements: [
          { objectId: 'growth-chart', type: 'chart', title: 'Growth', chartKind: 'horizontal-bar', points: [{ factId: 'fact.sales', seriesKey: 'sales', categoryKey: 'total', label: 'Sales' }] },
          { objectId: 'growth-table', type: 'table', title: 'Growth table', columns: [{ columnKey: 'growth', label: 'Growth' }], rows: [{ rowKey: 'total', label: 'Total', cells: [{ columnKey: 'growth', factId: 'fact.growth' }] }] },
        ] },
      ],
    }
    try {
      await writeFile(resolve(temp, 'fact-set.json'), canonicalJson(factSet))
      await writeFile(resolve(temp, 'blueprint.json'), canonicalJson(blueprint))
      await writeFile(resolve(temp, 'frozen.csv'), frozenData)
      const runtime = resolve(process.cwd(), 'packages/generator-bento/runtime/hydrate-outline.mjs')
      await run(process.execPath, [runtime, '--blueprint', `${relative}/blueprint.json`, '--fact-set', `${relative}/fact-set.json`, '--fact-set-artifact-id', 'artifact:fact-set', '--output', `${relative}/deck.outline.json`], { cwd: process.cwd() })
      const outline = definePresentationOutline(JSON.parse(await readFile(resolve(temp, 'deck.outline.json'), 'utf8')))
      expect(outline).toMatchObject({ factSetArtifactId: 'artifact:fact-set', factSetFactsSha256: 'a'.repeat(64), sources: [source], facts: [first, second] })
      expect(outline.slides[0]?.elements[0]).toMatchObject({ displayValue: '$15.2M', factIds: ['fact.sales'], bindings: [{ factId: 'fact.sales', selector: { kind: 'object' } }] })
      expect(outline.slides[1]?.elements[0]?.chart?.points[0]).toMatchObject({ value: 15.2, displayValue: '$15.2M', factId: 'fact.sales' })
      expect(outline.slides[1]?.elements[1]?.table?.rows[0]?.cells[0]).toMatchObject({ displayValue: '+16.1%', factId: 'fact.growth' })
      expect(outline.slides[1]?.trace?.metrics[0]?.factIds).toEqual(['fact.sales', 'fact.growth'])
      const validator = resolve(process.cwd(), 'packages/generator-bento/runtime/validate-fact-set.mjs')
      await expect(run(process.execPath, [validator, 'validate', '--outline', `${relative}/deck.outline.json`, '--fact-set', `${relative}/fact-set.json`, '--fact-set-artifact-id', 'artifact:fact-set'], { cwd: process.cwd() })).resolves.toBeDefined()
      const renderer = resolve(process.cwd(), 'packages/generator-bento/runtime/render-exact-outline.mjs')
      const rendered = await run(process.execPath, [renderer, '--outline', `${relative}/deck.outline.json`, '--outline-artifact-id', 'artifact:outline', '--fact-set', `${relative}/fact-set.json`, '--fact-set-artifact-id', 'artifact:fact-set', '--output', `${relative}/deck.bento.html`], { cwd: process.cwd() })
      expect(JSON.parse(rendered.stdout)).toMatchObject({ status: 'success', title: 'Hydrated deck', traceSchema: 'paimind.presentation-trace/v3' })
      expect(await readFile(resolve(temp, 'deck.bento.html'), 'utf8')).toContain('paimind:bento-ready')
      expect(JSON.parse(await readFile(resolve(temp, 'deck.validation.json'), 'utf8'))).toMatchObject({ valid: true, resolutionRate: 1, factValuesChanged: false, outlineArtifactId: 'artifact:outline', factSetArtifactId: 'artifact:fact-set' })
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})
