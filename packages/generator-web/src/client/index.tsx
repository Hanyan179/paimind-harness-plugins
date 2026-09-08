import { contributePaimindExtension, type PaimindClientContext } from '@hansen/harness-compat'

export const inject = ['slots']

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:generator-web',
    packageName: '@hansen/generator-web',
    category: 'content-rendering',
    nameZh: '网页产物生成器',
    nameEn: 'Web Artifact Generator',
    descriptionZh: '由 Harness Agent Tool 触发，通过原生 Job 与写入工具生成 HTML 产物。',
    descriptionEn: 'Generates HTML through a Harness Agent Tool, native Job and native write tool.',
    surface: 'conversation',
    maturity: 'technical-preview',
    order: 8,
  })
}
