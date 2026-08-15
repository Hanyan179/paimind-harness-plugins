import {
  artifactToolMeta, presentArtifactToolResult,
  type PaimindArtifactGeneratorService, type PaimindGeneratorProvider,
} from '@paimind/artifact-runtime'
import { defineArtifactProducedEnvelope, type ArtifactProducedEnvelopeV1 } from '@paimind/contracts'
import { definePaimindHarnessTool, type PaimindHostSystemPrompt, type PaimindHostToolRegistry } from '@paimind/harness-compat/host'

export const name = 'paimind-generator-bento'
export const inject = ['paimindArtifactGenerators', 'tools', 'systemPrompt']
export const BENTO_GENERATOR_PROVIDER_ID = 'paimind.generator.bento-deck'
export const BENTO_GENERATOR_TOOL = 'generate_bento_artifact'

type JsonRecord = Record<string, unknown>
interface BentoSlide { readonly title: string; readonly body: string; readonly eyebrow?: string }

export interface GeneratorBentoHostContext {
  readonly paimindArtifactGenerators: PaimindArtifactGeneratorService
  readonly tools: PaimindHostToolRegistry
  readonly systemPrompt: PaimindHostSystemPrompt
  effect(install: () => void | (() => void), label?: string): void
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function args(input: Readonly<JsonRecord>): { readonly filePath: string; readonly title: string; readonly slides: readonly BentoSlide[] } {
  const filePath = text(input.file_path, 'file_path')
  if (filePath.startsWith('/') || filePath.startsWith('\\') || filePath.split(/[\\/]+/).includes('..') || !filePath.toLowerCase().endsWith('.html')) {
    throw new Error('file_path must be a Workspace-relative .html path')
  }
  if (!Array.isArray(input.slides) || input.slides.length < 1 || input.slides.length > 40) throw new Error('slides must contain 1-40 slides')
  return {
    filePath, title: text(input.title, 'title'),
    slides: input.slides.map((value, index) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`slides[${index}] must be an object`)
      const slide = value as JsonRecord
      return { title: text(slide.title, `slides[${index}].title`), body: text(slide.body, `slides[${index}].body`), ...(slide.eyebrow === undefined ? {} : { eyebrow: text(slide.eyebrow, `slides[${index}].eyebrow`) }) }
    }),
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** Self-contained, network-free Bento format consumed only by the isolated Bento renderer. */
export function renderBentoDocument(title: string, slides: readonly BentoSlide[]): string {
  const pages = slides.map((slide, index) => `<section class="slide${index === 0 ? ' active' : ''}" data-slide="${index + 1}"><div class="card"><p class="eyebrow">${escapeHtml(slide.eyebrow ?? `SLIDE ${index + 1}`)}</p><h1>${escapeHtml(slide.title)}</h1><p class="body">${escapeHtml(slide.body)}</p><p class="page">${index + 1} / ${slides.length}</p></div></section>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#071725;color:#f7fbff;font-family:Inter,"PingFang SC",system-ui,sans-serif}.deck{width:100%;height:100%;position:relative}.slide{display:none;width:100%;height:100%;padding:clamp(20px,5vw,64px);background:radial-gradient(circle at 80% 10%,#2459c455,transparent 32%),linear-gradient(135deg,#071725,#102f4b)}.slide.active{display:grid;place-items:center}.card{position:relative;width:min(900px,100%);min-height:70%;padding:clamp(28px,6vw,72px);border:1px solid #7fc8ff55;border-radius:28px;background:#0d2238cc;box-shadow:0 30px 80px #0007}.eyebrow{margin:0 0 22px;color:#7fc8ff;font-size:13px;letter-spacing:.18em}.card h1{margin:0;max-width:820px;font-size:clamp(34px,6vw,72px);line-height:1.05}.body{max-width:760px;margin:36px 0 0;color:#d7e8f8;font-size:clamp(18px,2.4vw,28px);line-height:1.55;white-space:pre-wrap}.page{position:absolute;right:36px;bottom:24px;color:#8eabc3;font-size:12px}.hint{position:fixed;left:20px;bottom:14px;color:#7290aa;font-size:11px}
</style></head><body><main class="deck" aria-label="${escapeHtml(title)}">${pages}</main><p class="hint">← / →</p><script>
(()=>{const slides=[...document.querySelectorAll('.slide')];let index=0;const emit=type=>parent.postMessage({type,mode:'present',slide:index+1},'*');const show=next=>{index=(next+slides.length)%slides.length;slides.forEach((slide,i)=>slide.classList.toggle('active',i===index));emit('paimind:bento-slide')};addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();show(index+1)}if(event.key==='ArrowLeft'){event.preventDefault();show(index-1)}if(event.key==='Escape')emit('paimind:bento-exit')});emit('paimind:bento-ready')})();
</script></body></html>`
}

export const bentoProvider: PaimindGeneratorProvider = {
  id: BENTO_GENERATOR_PROVIDER_ID, kind: 'bento', previewKind: 'bento-deck',
  describe(input) { const value = args(input); return { path: value.filePath, title: value.title } },
  async generate(input, context) {
    const value = args(input)
    if (context.signal.aborted) throw new Error('Bento generation cancelled')
    await context.writeText(value.filePath, renderBentoDocument(value.title, value.slides))
    return { path: value.filePath, title: value.title }
  },
}

function artifactFromValue(value: JsonRecord): Readonly<ArtifactProducedEnvelopeV1> {
  return defineArtifactProducedEnvelope(value.artifact as ArtifactProducedEnvelopeV1)
}

const ARTIFACT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  schema: { type: 'string', required: true }, artifactId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, path: { type: 'string', required: true }, title: { type: 'string', required: true }, kind: { type: 'string', required: true }, previewKind: { type: 'string', required: true }, revision: { type: 'number', required: true }, producerId: { type: 'string', required: true }, taskId: { type: 'string', required: true }, traceId: { type: 'string' }, state: { type: 'string', required: true }, producedAt: { type: 'number', required: true }, error: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } } },
} } as const

export function apply(ctx: GeneratorBentoHostContext): void {
  ctx.effect(() => ctx.paimindArtifactGenerators.register(bentoProvider), 'paimind-generator-bento: provider')
  ctx.systemPrompt.section({
    name: 'tool:generate-bento-artifact', order: 114,
    text: 'Use generate_bento_artifact for a PAIMind Bento presentation. Supply a Workspace-relative .html path, a title and complete ordered slides. The provider creates a self-contained network-free document for the isolated Bento renderer; do not use bash or write it yourself.',
  })
  ctx.tools.register(definePaimindHarnessTool({
    name: BENTO_GENERATOR_TOOL, description: 'Generate and publish one isolated PAIMind Bento presentation artifact.',
    parameters: {
      file_path: { type: 'string', required: true }, title: { type: 'string', required: true },
      slides: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        eyebrow: { type: 'string' }, title: { type: 'string', required: true }, body: { type: 'string', required: true },
      } } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { artifact: { ...ARTIFACT_SCHEMA, required: true } } },
      render(_args, value) { const artifact = artifactFromValue(value); return [{ type: 'text', text: artifact.state === 'available' ? `<artifact path="${artifact.path}" id="${artifact.artifactId}" revision="${artifact.revision}">Generated Bento artifact</artifact>` : `<artifact-error code="${artifact.error?.code ?? 'generation_failed'}">${artifact.error?.message ?? 'Generation failed'}</artifact-error>` }] },
      presentationMeta(_args, value) { return artifactToolMeta(artifactFromValue(value)) },
    },
    async execute(toolArgs, exec) { return await ctx.paimindArtifactGenerators.execute(BENTO_GENERATOR_PROVIDER_ID, toolArgs, exec) },
    presentCall(toolArgs) { const path = typeof toolArgs.file_path === 'string' ? toolArgs.file_path : undefined; return { card: 'generic', title: typeof toolArgs.title === 'string' ? toolArgs.title : 'Generate Bento', kind: 'edit', rawInput: path, ...(path === undefined ? {} : { locations: [{ path }] }) } },
    presentResult(_args, result) { return presentArtifactToolResult(result) },
  }))
}
