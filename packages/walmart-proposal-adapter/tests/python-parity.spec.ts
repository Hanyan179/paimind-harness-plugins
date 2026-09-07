import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

describe('frozen PAIMind Python parity baseline', () => {
  it('runs the synthetic Walmart data-to-analysis-to-outline demo chain', async () => {
    const root = process.cwd()
    const temp = await mkdtemp(resolve(root, '.tmp-walmart-demo-chain-'))
    const workspacePath = relative(root, temp)
    const runtime = resolve(root, 'packages/walmart-proposal-adapter/runtime')
    const runner = resolve(runtime, 'runner.py')
    const invoke = async (args: string[]) => await run('uv', ['run', '--project', runtime, '--locked', '--python', '3.12', 'python', runner, ...args], { cwd: root, timeout: 120_000 })
    try {
      await invoke(['prepare', '--output-dir', `${workspacePath}/frozen`])
      await invoke(['fineline', '--manifest', `${workspacePath}/frozen/source-manifest.json`, '--output', `${workspacePath}/analysis/walmart.fineline.data-result.json`, '--category', 'KIDS CRAFTS'])
      await invoke(['white-space', '--manifest', `${workspacePath}/frozen/source-manifest.json`, '--output', `${workspacePath}/analysis/walmart.white-space.data-result.json`, '--category', 'KIDS CRAFTS'])
      const outlineArgs = ['outline', '--fineline', `${workspacePath}/analysis/walmart.fineline.data-result.json`, '--white-space', `${workspacePath}/analysis/walmart.white-space.data-result.json`, '--fineline-artifact-id', 'artifact:demo-fineline', '--white-space-artifact-id', 'artifact:demo-white-space', '--output', `${workspacePath}/deck/walmart-demo.outline.json`, '--title', '零售机会演示']
      await invoke(outlineArgs)

      const manifest = JSON.parse(await readFile(resolve(temp, 'frozen/source-manifest.json'), 'utf8'))
      const fineline = JSON.parse(await readFile(resolve(temp, 'analysis/walmart.fineline.data-result.json'), 'utf8'))
      const whiteSpace = JSON.parse(await readFile(resolve(temp, 'analysis/walmart.white-space.data-result.json'), 'utf8'))
      const outline = JSON.parse(await readFile(resolve(temp, 'deck/walmart-demo.outline.json'), 'utf8'))
      expect(manifest).toMatchObject({ schema: 'paimind.analysis-source-manifest/v1', synthetic: true })
      expect(manifest.sources).toHaveLength(5)
      expect(fineline).toMatchObject({ schema: 'paimind.data-result/v1', analysisKind: 'fineline-investment-analysis' })
      expect(whiteSpace).toMatchObject({ schema: 'paimind.data-result/v1', analysisKind: 'white-space-analysis' })
      expect(outline).toMatchObject({ schema: 'paimind.presentation-outline/v1' })
      expect(outline.slides).toHaveLength(25)
      expect(outline.facts.length).toBeGreaterThan(0)
      expect(outline.title).toBe('零售机会演示')
      expect(outline.slides[0].title).toBe('零售机会演示')
      expect(outline.slides.every((slide: { eyebrow: string }) => slide.eyebrow.includes('演示数据 · 非真实经营数据'))).toBe(true)

      // A changed manifest cannot silently remove the disclosure from a frozen
      // analysis. A separately hash-bound non-demo fixture must not gain one.
      const businessManifest = JSON.stringify({ ...manifest, synthetic: false })
      await writeFile(resolve(temp, 'frozen/source-manifest.json'), businessManifest)
      await expect(invoke(outlineArgs)).rejects.toThrow(/source manifest hash mismatch/)
      const businessHash = createHash('sha256').update(businessManifest).digest('hex')
      for (const [filename, document] of [['walmart.fineline.data-result.json', fineline], ['walmart.white-space.data-result.json', whiteSpace]] as const) {
        const path = resolve(temp, 'analysis', filename)
        const original = await readFile(path, 'utf8')
        await writeFile(path, original.replace(document.sourceManifestSha256, businessHash))
      }
      await invoke(outlineArgs)
      const businessOutline = JSON.parse(await readFile(resolve(temp, 'deck/walmart-demo.outline.json'), 'utf8'))
      expect(businessOutline.slides.every((slide: { eyebrow: string }) => !slide.eyebrow.includes('演示数据'))).toBe(true)
      expect(businessOutline.facts).toEqual(outline.facts)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }, 120_000)

  it('preserves upstream metrics, classifications, ordering and evidence fields', async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'paimind-python-parity-'))
    try {
      const rows: Record<string, unknown>[] = []
      for (const year of [2024, 2025]) for (let week = 1; week <= 52; week += 1) for (const [line, sku, multiplier] of [['PONY BEADS', '1001', 1], ['KIDS PAINT', '2001', 2], ['KIDS PAINT', '2002', 1.2]] as const) rows.push({ upc: sku, sales_value: (year === 2025 ? 120 : 100) * multiplier + week, sales_units: 20 * multiplier + week / 10, category: 'KIDS CRAFTS', reviewed_fineline: line, source_fineline: line, fiscal_year: year, fiscal_week: week })
      const input = resolve(temp, 'input.json'); const output = resolve(temp, 'output')
      await writeFile(input, JSON.stringify(rows))
      const runtime = resolve(process.cwd(), 'packages/walmart-proposal-adapter/runtime')
      await run('uv', ['run', '--project', runtime, '--locked', '--python', '3.12', 'python', resolve(runtime, 'fineline/scripts/run_fineline_investment_analysis.py'), '--input-path', input, '--output-dir', output, '--category-profile', resolve(runtime, 'fineline/references/category-profiles/kids-crafts.yaml'), '--path-base', 'cwd', '--category', 'KIDS CRAFTS'], { cwd: process.cwd(), env: { ...process.env, UV_PROJECT_ENVIRONMENT: resolve(temp, 'venv') }, timeout: 120_000 })
      const result = JSON.parse(await readFile(resolve(output, 'fineline_investment_analysis.json'), 'utf8'))
      expect(result.summary).toEqual({ category: 'KIDS CRAFTS', fineline_count: 2, primary_yoy_mode: 'launch_week_aligned', primary_yoy_label: 'WK31 anchored YoY', current_period_start: 202531, current_period_end: 202552, prior_period_start: 202431, prior_period_end: 202452, current_period_start_date: null, current_period_end_date: null, prior_period_start_date: null, prior_period_end_date: null })
      expect(result.finelines.map((row: any) => ({ final_fineline: row.final_fineline, quadrant: row.quadrant, opportunity_type: row.opportunity_type, primary_yoy_growth_pct: row.primary_yoy_growth_pct }))).toEqual([
        { final_fineline: 'KIDS PAINT', quadrant: '高体量 + 高增长', opportunity_type: 'supplier_validation_required', primary_yoy_growth_pct: 0.15880893300248133 },
        { final_fineline: 'PONY BEADS', quadrant: '低体量 + 高增长', opportunity_type: 'supplier_validation_required', primary_yoy_growth_pct: 0.14134275618374548 },
      ])
      expect(result.standardized_analysis_result.facts.map((row: any) => row.entity_key)).toEqual(['KIDS PAINT', 'PONY BEADS'])
      expect(result.standardized_analysis_result.facts[0].metrics).toMatchObject({ primary_current_sales_value: 10274, primary_prior_sales_value: 8866, primary_current_active_sku_count: 2 })
      expect(result.standardized_analysis_result.signals[0]).toMatchObject({ entity_key: 'KIDS PAINT', labels: { scale_label: 'high_scale', growth_label: 'meaningful_growth', concentration_label: 'hit_driven' } })
      expect(result.standardized_analysis_result.candidate_insights[0].evidence_metrics).toContain('primary_yoy_growth_pct')
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }, 120_000)
})
