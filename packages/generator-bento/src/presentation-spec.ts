import {
  DEFAULT_PRESENTATION_DESIGN,
  definePresentationDesign,
  type PresentationDesignV1,
  type PresentationStylePreset,
  type PresentationTemplateId,
} from '@hansen/presentation-contracts'

export const HTML_PRESENTATION_SCHEMA = 'paimind.html-presentation/v1' as const

export interface BentoTemplateDefinition {
  readonly id: PresentationTemplateId
  readonly name: string
  readonly source: string
  readonly supportedLayouts: readonly string[]
}

export interface BentoStyleTokens {
  readonly colorScheme: 'light' | 'dark'
  readonly stage: string
  readonly background: string
  readonly panel: string
  readonly ink: string
  readonly muted: string
  readonly accent: string
  readonly accent2: string
  readonly line: string
  readonly shadow: string
  readonly fontFamily: string
}

const ALL_LAYOUTS = Object.freeze([
  'cover', 'section', 'kpi', 'comparison', 'insight', 'recommendation', 'table',
  'horizontal-bar', 'lollipop', 'dot-plot', 'bullet', 'slope', 'line',
])

/**
 * Harness-native adaptation of the two HTML shells registered by
 * paimind python at 1f9fd80ea073a4ab4b5665b2300f7930f3f0520f.
 * Only semantic template identity is retained; Python runtimes and sample
 * document data are intentionally not embedded in the plugin.
 */
export const BENTO_TEMPLATE_REGISTRY: Readonly<Record<PresentationTemplateId, BentoTemplateDefinition>> = Object.freeze({
  'generic-dark': Object.freeze({
    id: 'generic-dark',
    name: 'Generic Bento',
    source: 'paimind-python:bento-ppt/assets/Bento_Slides.bento.html',
    supportedLayouts: ALL_LAYOUTS,
  }),
  'wmt-kids-mod': Object.freeze({
    id: 'wmt-kids-mod',
    name: 'Walmart Kids Modern',
    source: 'paimind-python:bento-ppt/templates/wmt-kids-mod-template.bento.html',
    supportedLayouts: ALL_LAYOUTS,
  }),
  'strategy-grid': Object.freeze({
    id: 'strategy-grid',
    name: 'Strategy Consulting Grid',
    source: 'paimind:proposal-assistant/templates/strategy-grid',
    supportedLayouts: ALL_LAYOUTS,
  }),
  'paramont-mountain': Object.freeze({
    id: 'paramont-mountain',
    name: 'Paramont Mountain Signature',
    source: 'paimind:proposal-assistant/templates/paramont-mountain',
    supportedLayouts: ALL_LAYOUTS,
  }),
  'storybook-cutpaper': Object.freeze({
    id: 'storybook-cutpaper',
    name: 'Playful Storybook Cut Paper',
    source: 'paimind:proposal-assistant/templates/storybook-cutpaper',
    supportedLayouts: ALL_LAYOUTS,
  }),
})

export const BENTO_STYLE_PRESETS: Readonly<Record<PresentationStylePreset, BentoStyleTokens>> = Object.freeze({
  'startup-pitch': Object.freeze({ colorScheme: 'dark', stage: '#05080d', background: '#0d1117', panel: '#161b22', ink: '#f9fafb', muted: '#9ca3af', accent: '#00c896', accent2: '#a7f3d0', line: '#ffffff24', shadow: '#00000066', fontFamily: 'Inter,"PingFang SC",system-ui,sans-serif' }),
  'data-intelligence': Object.freeze({ colorScheme: 'dark', stage: '#111624', background: '#1c2333', panel: '#252d3d', ink: '#f1f5f9', muted: '#94a3b8', accent: '#7c5cfc', accent2: '#c4b5fd', line: '#a78bfa30', shadow: '#05081670', fontFamily: 'Inter,"PingFang SC",system-ui,sans-serif' }),
  'storytelling-with-data': Object.freeze({ colorScheme: 'light', stage: '#e7e9ed', background: '#ffffff', panel: '#f9fafb', ink: '#404040', muted: '#6b7280', accent: '#4f81bd', accent2: '#c0504d', line: '#d1d5db', shadow: '#11182720', fontFamily: 'Arial,"PingFang SC",system-ui,sans-serif' }),
  'warm-editorial': Object.freeze({ colorScheme: 'light', stage: '#e9e2d9', background: '#faf8f5', panel: '#ffffff', ink: '#431407', muted: '#78716c', accent: '#c2410c', accent2: '#0d9488', line: '#d6d3d1', shadow: '#43140722', fontFamily: 'Georgia,"Songti SC",serif' }),
  'financial-elite': Object.freeze({ colorScheme: 'light', stage: '#dfe5ec', background: '#ffffff', panel: '#f8fafc', ink: '#0a2342', muted: '#4b5563', accent: '#c9a84c', accent2: '#1b3a6b', line: '#d9dee7', shadow: '#0a234226', fontFamily: 'Inter,"PingFang SC",system-ui,sans-serif' }),
  'wmt-retail': Object.freeze({ colorScheme: 'light', stage: '#e6eef5', background: '#ffffff', panel: '#f4f7fa', ink: '#17324d', muted: '#66788a', accent: '#0071ce', accent2: '#ffc220', line: '#d8e1e8', shadow: '#005a9c24', fontFamily: 'Arial,"PingFang SC",system-ui,sans-serif' }),
  'strategy-consulting': Object.freeze({ colorScheme: 'light', stage: '#e8eaed', background: '#fbfaf7', panel: '#ffffff', ink: '#1f2328', muted: '#687078', accent: '#0f6b78', accent2: '#d6a400', line: '#d7d9dc', shadow: '#11182720', fontFamily: 'Arial,"PingFang SC",system-ui,sans-serif' }),
  'paramont-signature': Object.freeze({ colorScheme: 'dark', stage: '#081524', background: '#0b1f35', panel: '#122b47', ink: '#f3f8fc', muted: '#a9bfd2', accent: '#78bdf2', accent2: '#d7b36a', line: '#9bcdf033', shadow: '#02091680', fontFamily: 'Inter,"PingFang SC",system-ui,sans-serif' }),
  'playful-storybook': Object.freeze({ colorScheme: 'light', stage: '#eee6d8', background: '#fff8eb', panel: '#fffdf7', ink: '#27334a', muted: '#6b7280', accent: '#f45b69', accent2: '#17a6a1', line: '#27334a24', shadow: '#7c4d2f2b', fontFamily: 'Avenir Next,"PingFang SC",system-ui,sans-serif' }),
})

export function resolvePresentationDesign(value: unknown): Readonly<PresentationDesignV1> {
  return value === undefined ? DEFAULT_PRESENTATION_DESIGN : definePresentationDesign(value)
}

export function presentationThemeCss(designValue: unknown): string {
  const design = resolvePresentationDesign(designValue)
  const tokens = BENTO_STYLE_PRESETS[design.stylePreset]
  const density = design.density === 'airy'
    ? { slidePad: 'clamp(30px,5.3vw,76px)', gap: 'clamp(20px,3.4vh,38px)', elementPad: 'clamp(18px,2.3vw,30px)' }
    : design.density === 'dense'
      ? { slidePad: 'clamp(18px,3.4vw,48px)', gap: 'clamp(12px,2vh,22px)', elementPad: 'clamp(12px,1.5vw,20px)' }
      : { slidePad: 'clamp(22px,4.2vw,60px)', gap: 'clamp(16px,2.7vh,30px)', elementPad: 'clamp(15px,1.9vw,25px)' }
  return `:root{color-scheme:${tokens.colorScheme};--stage:${tokens.stage};--bg:${tokens.background};--panel:${tokens.panel};--ink:${tokens.ink};--muted:${tokens.muted};--accent:${tokens.accent};--accent2:${tokens.accent2};--line:${tokens.line};--deck-shadow:${tokens.shadow};--deck-font:${tokens.fontFamily};--slide-pad:${density.slidePad};--slide-gap:${density.gap};--element-pad:${density.elementPad}}
body[data-template-id="wmt-kids-mod"] .slide{background:linear-gradient(180deg,var(--bg),var(--panel))}
body[data-template-id="wmt-kids-mod"] .slide:not(.layout-cover):not(.layout-section){border-top:6px solid var(--accent);box-shadow:inset 0 6px 0 var(--accent2)}
body[data-template-id="wmt-kids-mod"] .layout-cover{border-left:10px solid var(--accent2);border-bottom:28px solid var(--accent)}
body[data-template-id="wmt-kids-mod"] .layout-section{background:linear-gradient(135deg,var(--accent),#005a9c);color:#fff}
body[data-template-id="wmt-kids-mod"] .layout-section .eyebrow,body[data-template-id="wmt-kids-mod"] .layout-section .narrative{color:#d9ecfa}
body[data-template-id="generic-dark"] .layout-cover,body[data-template-id="generic-dark"] .layout-section{background:radial-gradient(circle at 86% 9%,color-mix(in srgb,var(--accent) 30%,transparent),transparent 34%),linear-gradient(145deg,var(--bg),var(--panel))}
body[data-template-id="strategy-grid"] .slide{background:linear-gradient(90deg,var(--accent) 0 10px,var(--bg) 10px);border-radius:0}
body[data-template-id="strategy-grid"] .slide::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent 24.9%,var(--line) 25%,transparent 25.1%,transparent 49.9%,var(--line) 50%,transparent 50.1%,transparent 74.9%,var(--line) 75%,transparent 75.1%);pointer-events:none;opacity:.28}
body[data-template-id="strategy-grid"] .layout-cover{background:linear-gradient(90deg,var(--accent) 0 12px,var(--bg) 12px 66%,#171c22 66%)}
body[data-template-id="strategy-grid"] .layout-section{background:linear-gradient(115deg,#171c22 0 72%,var(--accent) 72%);color:#fff}
body[data-template-id="paramont-mountain"] .slide{background:radial-gradient(circle at 82% 13%,#78bdf228,transparent 32%),linear-gradient(145deg,var(--bg),var(--panel));border:1px solid #78bdf233}
body[data-template-id="paramont-mountain"] .slide::after{content:"";position:absolute;right:-4%;bottom:-10%;width:58%;height:48%;background:linear-gradient(145deg,transparent 0 42%,#78bdf21f 42% 43%,transparent 43% 52%,#d7b36a24 52% 53%,transparent 53%);clip-path:polygon(0 100%,35% 28%,52% 62%,70% 12%,100% 100%);pointer-events:none}
body[data-template-id="paramont-mountain"] .layout-cover,body[data-template-id="paramont-mountain"] .layout-section{background:radial-gradient(circle at 22% 15%,#78bdf233,transparent 34%),linear-gradient(145deg,#071523,#133657)}
body[data-template-id="storybook-cutpaper"] .slide{background:radial-gradient(circle at 91% 8%,#ffd84d 0 8%,transparent 8.2%),radial-gradient(circle at 8% 92%,#17a6a120 0 17%,transparent 17.2%),var(--bg);border:3px solid #27334a12;border-radius:28px}
body[data-template-id="storybook-cutpaper"] .slide::after{content:"";position:absolute;right:4%;bottom:4%;width:120px;height:76px;background:linear-gradient(145deg,#f45b69 0 48%,#17a6a1 48% 72%,#ffd84d 72%);clip-path:polygon(0 100%,22% 42%,41% 70%,63% 10%,100% 100%);filter:drop-shadow(0 8px 5px #27334a24);pointer-events:none}
body[data-template-id="storybook-cutpaper"] .element{border-radius:24px;transform:rotate(-.25deg)}
body[data-template-id="storybook-cutpaper"] .element:nth-child(even){transform:rotate(.35deg)}
body[data-template-id="storybook-cutpaper"] .layout-cover,body[data-template-id="storybook-cutpaper"] .layout-section{background:linear-gradient(135deg,#fff8eb 0 68%,#ffd84d 68%);color:#27334a}`
}

export function htmlPresentationMetadata(designValue: unknown): Readonly<{
  readonly schema: typeof HTML_PRESENTATION_SCHEMA
  readonly design: PresentationDesignV1
  readonly templateSource: string
}> {
  const design = resolvePresentationDesign(designValue)
  return Object.freeze({ schema: HTML_PRESENTATION_SCHEMA, design, templateSource: BENTO_TEMPLATE_REGISTRY[design.templateId].source })
}
