import { contributePaimindExtension, type PaimindClientContext } from '@hansen/harness-compat'

export const inject = ['slots']

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:generator-web',
    packageName: '@hansen/generator-web',
    category: 'content-rendering',
    nameZh: '网页生成',
    nameEn: 'Web Artifact Generator',
    descriptionZh: '根据对话要求生成可打开和交付的网页文件。',
    descriptionEn: 'Generates HTML through a Harness Agent Tool, native Job and native write tool.',
    surface: 'conversation',
    maturity: 'technical-preview',
    order: 8,
  })
}
