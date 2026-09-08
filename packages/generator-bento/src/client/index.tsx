import { contributePaimindExtension, type PaimindClientContext } from '@hansen/harness-compat'

export const inject = ['slots']

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:generator-bento', packageName: '@hansen/generator-bento', category: 'content-rendering',
    nameZh: 'Bento 生成器', nameEn: 'Bento Generator',
    descriptionZh: '生成 独立 Bento 演示文件，并通过独立 Renderer Plugin 预览。',
    descriptionEn: 'Generates Bento presentations for the independent Bento Renderer Plugin.',
    surface: 'conversation', maturity: 'technical-preview', order: 10,
  })
}
