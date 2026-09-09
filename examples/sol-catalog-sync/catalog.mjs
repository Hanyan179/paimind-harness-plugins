import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { buildInfoFields, compactText, scalarText, planInfoBox, planTitleLayout } from './reference/catalog_fields.mjs'
import { resolveCountLayout, aspectPlace } from './reference/composition_renderer.mjs'

export const SOL_FIELDS = ['ITEM#', 'Item Status', 'Item Description', 'Retail', 'New DO IMU', 'Inner Qty', 'Product Spec', 'Item Packaging Spec', 'Packaging Type']
export const TRACKER_FIELDS = ['ITEM#', 'PRD Render Image']
export const RULE_VERSION = 'sol-active-html/v1'
export const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const revision = bytes => 'sha256:' + sha(bytes)
const token = /^[A-Za-z0-9_-]{10,200}$/
export function imuColor(raw) {
  const text = compactText(raw), n = Number(text.replace(/[% ,]/g, ''))
  if (!text || !Number.isFinite(n)) return null
  const percent = text.includes('%') || Math.abs(n) > 1 ? n : n * 100
  return percent < 60 ? '#C00000' : '#008000'
}
function snapshot(value, source, tableId, fields) {
  if (value?.schema !== 'paimind.feishu-base-snapshot/v1' || value.source?.baseToken !== source.baseToken || value.source?.tableId !== tableId || !Array.isArray(value.records) || !fields.every(f => value.source.fields.includes(f))) throw new Error('SOURCE_INVALID: complete, projected source snapshot required')
  const seen = new Set()
  for (const r of value.records) {
    if (!/^rec[A-Za-z0-9]{5,100}$/.test(r.record_id) || seen.has(r.record_id) || !fields.every(f => Object.hasOwn(r, f))) throw new Error('SOURCE_INVALID: missing fields or duplicate record identity')
    seen.add(r.record_id)
  }
  return value.records
}
/** Only explicit SOL facts and exact trimmed keys determine selection and joins. */
export function prepareCatalog(sol, tracker, source) {
  const records = snapshot(sol, source, source.solTableId, SOL_FIELDS)
  const images = snapshot(tracker, source, source.trackerTableId, TRACKER_FIELDS)
  const byItem = new Map()
  for (const r of images) {
    const key = scalarText(r['ITEM#']).trim()
    if (key) byItem.set(key, [...(byItem.get(key) ?? []), r])
  }
  const requests = new Map()
  const products = records.filter(r => compactText(r['Item Status']) === 'ACTIVE').map((r, index) => {
    const itemNo = scalarText(r['ITEM#']).trim(), title = scalarText(r['Item Description'])
    const matches = itemNo ? byItem.get(itemNo) ?? [] : []
    if (matches.length > 1) throw new Error('AMBIGUOUS_IMAGE_JOIN: ' + r.record_id)
    const attachmentValue = matches[0]?.['PRD Render Image']
    if (attachmentValue && !Array.isArray(attachmentValue)) throw new Error('SOURCE_INVALID: attachment field must be an array')
    const attachments = (attachmentValue || []).map(a => {
      if (!a || !token.test(a.file_token) || typeof a.name !== 'string' || !Number.isSafeInteger(a.size) || a.size <= 0) throw new Error('SOURCE_INVALID: invalid attachment declaration')
      const request = { baseToken: source.baseToken, tableId: source.trackerTableId, recordId: matches[0].record_id, fileToken: a.file_token }
      const key = sha(JSON.stringify(request))
      const path = 'originals/' + key + '.bin'
      requests.set(key, { ...request, path })
      return { path, name: a.name, size: a.size, recordId: matches[0].record_id, fileToken: a.file_token }
    })
    if (attachments.length > 4) throw new Error('IMAGE_COUNT_UNSUPPORTED: ' + r.record_id + ' has more than four product renders')
    const fields = buildInfoFields({ source_fields: r }).map(f => ({ ...f, displayed: true, rendered_value: f.rendered_value || '未填写', value_color: f.key === 'imu' ? imuColor(r['New DO IMU']) : null }))
    fields.unshift({ key: 'item_no', source_field: 'ITEM#', label: 'ITEM#', raw_value: itemNo, rendered_value: itemNo || '未填写', displayed: true, value_color: null })
    return { recordId: r.record_id, page: index + 1, itemNo, title: title || '商品名称未填写', status: 'ACTIVE', fields, sourceFields: Object.fromEntries(SOL_FIELDS.map(f => [f, scalarText(r[f])])), attachments, warnings: [...(!itemNo ? ['MISSING_ITEM_NUMBER'] : []), ...(!title ? ['MISSING_DESCRIPTION'] : []), ...(!attachments.length ? ['NO_PRODUCT_RENDER'] : [])] }
  })
  const data = { schema: RULE_VERSION, source, products }
  return { ...data, fingerprint: sha(JSON.stringify(data)), manifest: { schema: 'paimind.feishu-attachment-requests/v1', requests: [...requests.values()] } }
}

const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const boxStyle = box => `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`
/** No network or publication authority: input bytes come from verified local MCP downloads. */
export async function renderCatalog(plan, readOriginal, generatedAt) {
  const media = new Map(), pages = [], facts = []
  for (const p of plan.products) {
    const title = planTitleLayout(p.title.toUpperCase())
    const info = planInfoBox(p.fields, { top: title.info_top })
    const layout = resolveCountLayout({ imageCount: p.attachments.length, infoBox: info })
    const placements = []
    for (const [i, a] of p.attachments.entries()) {
      if (!media.has(a.path)) {
        const original = await readOriginal(a)
        if (original.length !== a.size) throw new Error('ATTACHMENT_SIZE_MISMATCH: ' + a.name)
        const { data, info: size } = await sharp(original, { limitInputPixels: 80_000_000, failOn: 'warning' }).rotate().resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true })
        media.set(a.path, { data, width: size.width, height: size.height, sourceHash: sha(original), previewHash: sha(data) })
      }
      const image = media.get(a.path)
      placements.push({ ...a, bbox: aspectPlace(image, layout.slots[i].box, { padding: 12 }), image })
    }
    facts.push({ recordId: p.recordId, page: p.page, itemNo: p.itemNo, title: p.title, status: p.status, sourceFields: p.sourceFields, fields: p.fields.map(f => ({ source: f.source_field, label: f.label, value: f.rendered_value, color: f.value_color })), imageCount: placements.length, images: placements.map(a => ({ name: a.name, trackerRecordId: a.recordId, sourceSha256: a.image.sourceHash, previewSha256: a.image.previewHash })), warnings: p.warnings })
    pages.push(`<section class="sheet-wrap" id="page-${p.page}"><article class="sheet" data-record="${escape(p.recordId)}"><h2 style="${boxStyle(title.box)}">${escape(p.title.toUpperCase())}</h2><div class="information" style="${boxStyle(info)}"><h3>PRODUCT INFORMATION:</h3>${p.fields.map(f => `<p data-field="${escape(f.source_field)}"><b>${escape(f.label)}:</b> <span${f.value_color ? ` style="color:${f.value_color};font-weight:700"` : ''}>${escape(f.rendered_value)}</span></p>`).join('')}</div>${placements.map(a => `<img alt="${escape(a.name)}" style="${boxStyle(a.bbox)}" src="data:image/webp;base64,${a.image.data.toString('base64')}">`).join('')}<footer><span>${escape(generatedAt)} · SOL ACTIVE · ${escape(p.itemNo || '商品编号未填写')}</span><span>${p.page} / ${plan.products.length}</span></footer></article></section>`)
  }
  const catalog = { schema: RULE_VERSION, fingerprint: plan.fingerprint, generatedAt, count: facts.length, source: plan.source, rule: 'SOL Item Status = ACTIVE; exact trimmed ITEM# join; PRD Render Image only; IMU <60% red, >=60% green; missing fields/images retained.', products: facts }
  // Complete searchable facts precede images, making ranged context reads useful.
  const serialized = JSON.stringify(catalog, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>SOL 有效商品目录</title><script id="catalog-facts" type="application/json">${serialized}</script><style>
  *{box-sizing:border-box}body{margin:0;background:#edf0f3;color:#1c2530;font-family:"Avenir Next",Arial,sans-serif}header{max-width:1280px;margin:32px auto 24px;padding:0 24px}h1{font-size:25px;margin:0 0 8px}header p{font-size:14px;color:#526273}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}nav a{background:white;color:#32485e;border:1px solid #d7dee5;text-decoration:none;border-radius:5px;padding:5px 9px;font-size:12px}.sheet-wrap{container-type:inline-size;max-width:1280px;margin:24px auto;aspect-ratio:16/9;overflow:hidden;background:white;box-shadow:0 5px 25px #10204012}.sheet{position:relative;width:1280px;height:720px;transform-origin:top left;transform:scale(calc(100cqw / 1280px));background:white}h2{position:absolute;margin:0;font-size:24px;line-height:27px;text-align:right;overflow-wrap:anywhere}.information{position:absolute;text-align:right;padding:0 4px;overflow-wrap:anywhere}.information h3{font-size:14.667px;text-decoration:underline;line-height:20px;margin:0 0 3px}.information p{font-size:13.333px;line-height:15px;margin:0}.information b{font-weight:400}.sheet img{position:absolute;object-fit:contain}.sheet footer{position:absolute;bottom:0;width:100%;height:38px;border-top:3px solid #304c62;background:#f5f7f8;display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-size:12px;color:#53606b}.empty{padding:80px;text-align:center;background:white}
  @media print{@page{size:13.333in 7.5in;margin:0}body{background:white}header{display:none}.sheet-wrap{margin:0;max-width:none;width:1280px;height:720px;box-shadow:none;break-after:page}.sheet{transform:none}}
  </style></head><body><header><h1>SOL 有效商品目录</h1><p>${facts.length} 件有效商品 · 更新于 ${escape(generatedAt)} · 图片未填写的商品保留空白图片区 · IMU 低于 60% 为红色，达到 60% 为绿色</p><nav>${facts.map(p => `<a href="#page-${p.page}">${p.page}. ${escape(p.itemNo || '编号未填写')}</a>`).join('')}</nav></header>${pages.join('\n') || '<div class="empty">当前没有 ACTIVE 商品</div>'}</body></html>`
  const bytes = Buffer.from(html)
  if (bytes.length > 64 * 1024 * 1024) throw new Error('CATALOG_TOO_LARGE: candidate exceeds Context Library limit; nothing published')
  return { bytes, catalog, revision: revision(bytes) }
}
