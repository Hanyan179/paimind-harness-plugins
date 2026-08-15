import { contributePaimindExtension, type PaimindClientContext } from '@paimind/harness-compat'

export const inject = ['slots']

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:generator-bento', packageName: '@paimind/generator-bento', category: 'content-rendering',
    nameZh: 'Bento 生成器', nameEn: 'Bento Generator',
    descriptionZh: '生成 PAIMind 自研 Bento 演示文件，并通过独立 Renderer Plugin 预览。',
    descriptionEn: 'Generates PAIMind Bento presentations for the independent Bento Renderer Plugin.',
    surface: 'conversation', maturity: 'technical-preview', order: 10,
  })
}
