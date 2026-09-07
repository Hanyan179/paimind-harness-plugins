import { contributePaimindExtension, type PaimindClientContext } from '@paimind/harness-compat'

export const inject = ['slots']

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:generator-bento', packageName: '@paimind/generator-bento', category: 'content-rendering',
    nameZh: '演示生成', nameEn: 'Bento Generator',
    descriptionZh: '根据内容要求生成网页演示，完成后可直接预览。',
    descriptionEn: 'Generates PAIMind Bento presentations for the independent Bento Renderer Plugin.',
    surface: 'conversation', maturity: 'technical-preview', order: 10,
  })
}
