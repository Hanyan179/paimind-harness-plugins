import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

describe('frozen PAIMind Python parity baseline', () => {
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
