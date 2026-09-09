// @vitest-environment node
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
// Business workflow is executable JavaScript, independent of the model runtime.
// @ts-expect-error executable example
import { prepareCatalog, renderCatalog, imuColor, SOL_FIELDS, TRACKER_FIELDS } from './catalog.mjs'
const source = { baseToken: 'Base123456789', solTableId: 'tblSol12345678', trackerTableId: 'tblArt12345678', collectionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
const snapshot = (tableId: string, fields: string[], records: unknown[]) => ({ schema: 'paimind.feishu-base-snapshot/v1', source: { ...source, tableId, fields, revision: 1 }, records })
const row = (record_id: string, extra = {}) => ({ record_id, ...Object.fromEntries(SOL_FIELDS.map((f: string) => [f, ''])), 'Item Status': ['ACTIVE'], ...extra })
const make = (rows: unknown[], images: unknown[] = []) => prepareCatalog(snapshot(source.solTableId, SOL_FIELDS, rows), snapshot(source.trackerTableId, TRACKER_FIELDS, images), source)
describe('SOL business rules independent of model choices', () => {
  it('retains missing identifiers, names and images, using source record identity', async () => {
    const plan = make([row('recEmpty123'), row('recActive12', { 'ITEM#': 'SKU-A', 'Item Description': 'Product' }), row('recHold1234', { 'Item Status': ['HOLD'] })])
    expect(plan.products.map((p: any) => p.recordId)).toEqual(['recEmpty123', 'recActive12'])
    expect(plan.products[0]).toMatchObject({ itemNo: '', title: '商品名称未填写', attachments: [] })
    const output = await renderCatalog(plan, () => { throw new Error('No images should be requested') }, '2026-09-09')
    expect(output.catalog.count).toBe(2)
    expect(output.bytes.toString()).toContain('商品编号未填写')
    expect(output.bytes.toString()).not.toMatch(/undefinedpx|NaNpx/)
  })
  it('compares unrounded IMU and treats blank/unparseable as missing, never zero', () => {
    expect(imuColor('')).toBe(null); expect(imuColor('unknown')).toBe(null)
    for (const x of [0, 0.59, 0.5999, '59.99%', 59.99]) expect(imuColor(x)).toBe('#C00000')
    for (const x of [0.60, 0.61, '60%', 60, 61]) expect(imuColor(x)).toBe('#008000')
  })
  it('joins only trimmed case-sensitive keys and PRD Render Image; rejects ambiguity', () => {
    const attachment = { file_token: 'Token1234567890', name: 'a.png', size: 50 }
    const plan = make([row('recProduct12', { 'ITEM#': ' SKU-A ' })], [{ record_id: 'recTracker12', 'ITEM#': 'SKU-A', 'PRD Render Image': [attachment], 'Reference Images': [attachment] }])
    expect(plan.manifest.requests).toHaveLength(1)
    expect(make([row('recProduct12', { 'ITEM#': 'sku-a' })], [{ record_id: 'recTracker12', 'ITEM#': 'SKU-A', 'PRD Render Image': [attachment] }]).manifest.requests).toHaveLength(0)
    expect(() => make([row('recProduct12', { 'ITEM#': 'SKU-A' })], [1, 2].map(i => ({ record_id: 'recTracker1' + i, 'ITEM#': 'SKU-A', 'PRD Render Image': [] })))).toThrow('AMBIGUOUS')
  })
  it('escapes hostile source markup, keeps image bytes local, and preserves contain geometry', async () => {
    const bytes = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#90aec2' } }).png().toBuffer()
    const p = make([row('recProduct12', { 'ITEM#': 'A', 'Item Description': '</script><img src=x onerror=alert(1)>', Retail: 3.97, 'New DO IMU': 0.59 })], [{ record_id: 'recTracker12', 'ITEM#': 'A', 'PRD Render Image': [{ file_token: 'Token1234567890', name: 'source.png', size: bytes.length }] }])
    const out = await renderCatalog(p, async () => bytes, '2026-09-09')
    const html = out.bytes.toString()
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('data:image/webp;base64,'); expect(html).toContain('object-fit:contain')
    expect(html.indexOf('catalog-facts')).toBeLessThan(html.indexOf('data:image/webp'))
    expect(out.catalog.products[0]).toMatchObject({ imageCount: 1, fields: expect.arrayContaining([expect.objectContaining({ label: 'IMU', value: '59%', color: '#C00000' })]) })
    await expect(renderCatalog(p, async () => Buffer.from('bad'), '2026-09-09')).rejects.toThrow('SIZE_MISMATCH')
  })
  it('handles no active products and detects additions, changes and exits without timestamp churn', () => {
    const a = row('recProduct12', { 'ITEM#': 'A' }), b = row('recProduct13', { 'ITEM#': 'B' })
    expect(make([a]).fingerprint).toBe(make([a]).fingerprint)
    expect(make([a, b]).fingerprint).not.toBe(make([a]).fingerprint)
    expect(make([{ ...a, Retail: 4 }]).fingerprint).not.toBe(make([a]).fingerprint)
    expect(make([{ ...a, 'Item Status': ['PASS'] }]).products).toEqual([])
    expect(() => make([{ record_id: 'recIncomplete' }])).toThrow('SOURCE_INVALID')
  })
})
