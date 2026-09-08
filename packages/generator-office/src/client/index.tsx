import { contributePaimindExtension, type PaimindClientContext } from '@hansen/harness-compat'

export const inject = ['slots']

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:generator-office',
    packageName: '@hansen/generator-office',
    category: 'content-rendering',
    nameZh: 'Office 产物生成器',
    nameEn: 'Office Artifact Generator',
    descriptionZh: '通过 Harness Agent Tool 与原生沙箱命令生成 PPTX、PDF 和带公式 XLSX。',
    descriptionEn: 'Generates PPTX, PDF and formula-bearing XLSX through Harness Agent Tools and native sandboxed commands.',
    surface: 'conversation',
    maturity: 'technical-preview',
    order: 9,
  })
}
