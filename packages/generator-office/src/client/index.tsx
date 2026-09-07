import { contributePaimindExtension, type PaimindClientContext } from '@paimind/harness-compat'

export const inject = ['slots']

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:generator-office',
    packageName: '@paimind/generator-office',
    category: 'content-rendering',
    nameZh: '办公文档生成',
    nameEn: 'Office Artifact Generator',
    descriptionZh: '生成演示文稿、PDF 文档和带公式的电子表格。',
    descriptionEn: 'Generates PPTX, PDF and formula-bearing XLSX through Harness Agent Tools and native sandboxed commands.',
    surface: 'conversation',
    maturity: 'technical-preview',
    order: 9,
  })
}
