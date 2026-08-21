import { useMemo, useState } from 'react'
import {
  answerHarnessQuestion,
  cancelHarnessQuestion,
  contributePaimindExtension,
  selectHarnessNamespacedQuestion,
  type HarnessQuestionItem,
  type HarnessQuestionOption,
  type HarnessQuestionWait,
  type PaimindClientContext,
} from '@paimind/harness-compat'
import { PROPOSAL_QUESTION_IDS, PROPOSAL_QUESTION_NAMESPACE } from '../index.js'

export const inject = ['slots']
const STYLE_ID = '@paimind/proposal-experience'

const STYLE = `
[data-paimind-proposal-frame]{display:flex;justify-content:center;padding:8px calc(var(--dsh-composer-side-clearance,0px) + 16px) 12px}
[data-paimind-proposal-card],[data-paimind-proposal-card] *{box-sizing:border-box}
[data-paimind-proposal-card]{width:min(940px,100%);max-height:min(72vh,620px);overflow:hidden;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(110,120,135,.28));border-radius:22px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#172033);box-shadow:0 22px 64px rgba(12,31,55,.18)}
[data-paimind-proposal-head]{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:20px 22px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16))}
[data-paimind-proposal-kicker]{margin:0 0 5px;color:var(--dsw-alias-brand-primary,#356fa8);font-size:10px;font-weight:760;letter-spacing:.18em;text-transform:uppercase}
[data-paimind-proposal-title]{margin:0;font-size:18px;line-height:24px;font-weight:650;letter-spacing:-.015em}
[data-paimind-proposal-detail]{max-width:620px;margin:7px 0 0;color:var(--dsw-alias-label-secondary,#667085);font-size:13px;line-height:19px}
[data-paimind-proposal-close]{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:20px;line-height:1;cursor:pointer}
[data-paimind-proposal-close]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(120,130,145,.12));color:var(--dsw-alias-label-primary,#172033)}
[data-paimind-proposal-body]{display:grid;grid-template-columns:minmax(300px,1fr);min-height:0;max-height:520px;overflow:auto}
[data-paimind-proposal-body][data-preview='true']{grid-template-columns:minmax(320px,1fr) minmax(300px,.92fr)}
[data-paimind-proposal-options]{display:flex;flex-direction:column;gap:8px;min-width:0;padding:16px 18px 18px}
[data-paimind-proposal-option]{display:flex;align-items:center;gap:11px;width:100%;min-height:52px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.18));border-radius:14px;background:transparent;color:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,border-color .14s ease,background-color .14s ease,box-shadow .14s ease}
[data-paimind-proposal-option]:hover,[data-paimind-proposal-option]:focus-visible,[data-paimind-proposal-option][data-focused='true']{outline:none;border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 58%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 8%,transparent);box-shadow:0 10px 28px rgba(29,66,101,.10);transform:translateY(-1px)}
[data-paimind-proposal-option][aria-checked='true']{border-color:var(--dsw-alias-brand-primary,#356fa8);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 11%,transparent)}
[data-paimind-proposal-indicator]{display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border:1px solid var(--dsw-alias-border-l3,rgba(110,120,135,.34));border-radius:7px;color:var(--dsw-alias-label-secondary,#667085);font-size:11px;font-weight:700}
[data-paimind-proposal-option][aria-checked='true'] [data-paimind-proposal-indicator]{border-color:var(--dsw-alias-brand-primary,#356fa8);background:var(--dsw-alias-brand-primary,#356fa8);color:#fff}
[data-paimind-brand-badge]{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:10px;background:#eef2f6;color:#203047;font-size:11px;font-weight:850;letter-spacing:-.04em;overflow:hidden}
[data-paimind-brand-badge='dollar-general']{border:2px solid #111;background:#ffe100;color:#111}
[data-paimind-brand-badge='walmart']{background:#0b63ce;color:#fff;font-size:19px;font-weight:500}
[data-paimind-proposal-option-copy]{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}
[data-paimind-proposal-option-line]{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
[data-paimind-proposal-option-line] strong{font-size:14px;line-height:20px;font-weight:650}
[data-paimind-proposal-option-copy] small{color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:17px}
[data-paimind-proposal-recommended]{padding:2px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 14%,transparent);color:var(--dsw-alias-brand-primary,#356fa8);font-size:9px;font-style:normal;font-weight:760;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-proposal-custom]{display:flex;align-items:center;gap:9px;margin-top:2px;padding:9px 11px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,120,135,.26));border-radius:13px}
[data-paimind-proposal-custom] input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:13px}
[data-paimind-proposal-actions]{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:4px}
[data-paimind-proposal-actions] span{color:var(--dsw-alias-label-tertiary,#7b8796);font-size:11px}
[data-paimind-proposal-submit]{padding:8px 14px;border:0;border-radius:10px;background:var(--dsw-alias-label-primary,#172033);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:12px;font-weight:650;cursor:pointer}
[data-paimind-proposal-submit]:disabled{opacity:.45;cursor:default}
[data-paimind-proposal-error]{margin:0;color:#c64242;font-size:12px;line-height:18px}
[data-paimind-deck-preview]{display:flex;flex-direction:column;min-width:0;padding:18px;border-left:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));background:linear-gradient(155deg,color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 8%,transparent),transparent 55%)}
[data-paimind-deck-preview] > small{color:var(--dsw-alias-brand-primary,#356fa8);font-size:9px;font-weight:760;letter-spacing:.15em;text-transform:uppercase}
[data-paimind-deck-preview] > h3{margin:6px 0 5px;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:23px;font-weight:650}
[data-paimind-deck-preview] > p{margin:0;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:17px}
[data-paimind-preview-slides]{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}
[data-paimind-preview-slide]{position:relative;aspect-ratio:16/9;overflow:hidden;border:1px solid rgba(29,51,78,.14);border-radius:8px;background:#f8f3e8;color:#172638;box-shadow:0 8px 22px rgba(24,44,70,.13)}
[data-paimind-preview-slide]:first-child{grid-column:1/-1;background:linear-gradient(125deg,#102e4d 0 58%,#d5ae64 58% 62%,#f8f3e8 62%);color:#fff}
[data-paimind-preview-slide]::before{content:attr(data-label);position:absolute;left:9px;top:8px;font-size:5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;opacity:.72}
[data-paimind-preview-slide]::after{content:'';position:absolute;left:9px;right:9px;bottom:9px;height:32%;background:linear-gradient(90deg,currentColor 0 42%,transparent 42% 48%,currentColor 48% 72%,transparent 72% 78%,currentColor 78%);opacity:.18}
[data-paimind-preview-slide]:first-child::after{left:12px;right:auto;bottom:13px;width:44%;height:8px;background:#fff;opacity:.82}
[data-paimind-preview-meta]{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px}
[data-paimind-preview-meta] div{padding:9px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));border-radius:10px;background:color-mix(in srgb,var(--dsw-specific-input-major,#fff) 82%,transparent)}
[data-paimind-preview-meta] span{display:block;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:8px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
[data-paimind-preview-meta] strong{display:block;margin-top:4px;font-size:11px;line-height:15px;font-weight:620}
[data-paimind-preview-hint]{margin-top:auto!important;padding-top:12px;font-size:10px!important}
[data-ds-dark-theme] [data-paimind-proposal-card]{background:#151e2c;color:#edf3fb}
[data-ds-dark-theme] [data-paimind-preview-slide]{filter:brightness(.88) saturate(.92)}
@media(max-width:820px){[data-paimind-proposal-card]{max-height:min(78vh,680px)}[data-paimind-proposal-body][data-preview='true']{grid-template-columns:1fr}[data-paimind-deck-preview]{border-top:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));border-left:0}[data-paimind-preview-slides]{grid-template-columns:repeat(3,1fr)}[data-paimind-preview-slide]:first-child{grid-column:auto}}
@media(max-width:520px){[data-paimind-proposal-frame]{padding-right:10px;padding-left:10px}[data-paimind-proposal-head]{padding:16px 15px 13px}[data-paimind-proposal-options]{padding:12px}[data-paimind-proposal-body]{max-height:560px}[data-paimind-preview-slides]{grid-template-columns:1fr 1fr}[data-paimind-preview-slide]:first-child{grid-column:1/-1}}
@media(prefers-reduced-motion:reduce){[data-paimind-proposal-option]{transition:none}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

interface ComposerOwner { readonly interactions: readonly unknown[] }

export function selectProposalQuestion(owner: ComposerOwner): HarnessQuestionWait | null {
  return selectHarnessNamespacedQuestion(owner.interactions, PROPOSAL_QUESTION_NAMESPACE)
}

function optionPresentation(label: string): { readonly label: string; readonly recommended: boolean } {
  const suffix = /\s*\((?:recommended)\)\s*$/i
  return { label: label.replace(suffix, ''), recommended: suffix.test(label) }
}

function customerBadge(label: string): React.JSX.Element | null {
  const normalized = optionPresentation(label).label.toLowerCase()
  if (normalized === 'dollar general') return <span data-paimind-brand-badge="dollar-general" aria-hidden="true">DG</span>
  if (normalized === 'walmart') return <span data-paimind-brand-badge="walmart" aria-hidden="true">✳</span>
  return null
}

interface DeckPreviewSpec {
  readonly title: string
  readonly bestFor: string
  readonly story: string
  readonly slides: readonly [string, string, string]
}

const DECK_PREVIEWS: Readonly<Record<string, DeckPreviewSpec>> = Object.freeze({
  'Executive Proposal': Object.freeze({
    title: 'Paramont Executive Editorial',
    bestFor: 'Senior buyer and leadership decisions',
    story: 'Decision first · Evidence second · Action last',
    slides: ['Executive cover', 'Opportunity', 'Recommendation'] as const,
  }),
  'Category Growth Strategy': Object.freeze({
    title: 'Paramont Executive Editorial',
    bestFor: 'Category planning and growth workshops',
    story: 'Market shift · White space · Growth roadmap',
    slides: ['Growth thesis', 'Category map', 'Roadmap'] as const,
  }),
  'Line Review & Assortment': Object.freeze({
    title: 'Paramont Executive Editorial',
    bestFor: 'Merchant reviews and assortment decisions',
    story: 'Current line · Gaps · Recommended assortment',
    slides: ['Line review', 'Assortment gap', 'Next line'] as const,
  }),
})

function deckPreviewFor(option: HarnessQuestionOption | undefined): DeckPreviewSpec {
  const label = option === undefined ? 'Executive Proposal' : optionPresentation(option.label).label
  return DECK_PREVIEWS[label] ?? DECK_PREVIEWS['Executive Proposal']!
}

function DeckPreview({ option }: { readonly option: HarnessQuestionOption | undefined }): React.JSX.Element {
  const preview = deckPreviewFor(option)
  return <aside data-paimind-deck-preview aria-live="polite">
    <small>Deck style preview</small>
    <h3>{preview.title}</h3>
    <p>A polished navy, warm ivory and brushed-gold system with editorial typography and restrained data storytelling.</p>
    <div data-paimind-preview-slides aria-label="Three representative slide miniatures">
      {preview.slides.map(label => <div key={label} data-paimind-preview-slide data-label={label} />)}
    </div>
    <div data-paimind-preview-meta>
      <div><span>Best for</span><strong>{preview.bestFor}</strong></div>
      <div><span>Story rhythm</span><strong>{preview.story}</strong></div>
    </div>
    <p data-paimind-preview-hint>Hover or focus another deck type to preview it. Click to select.</p>
  </aside>
}

function questionStage(question: HarnessQuestionItem): string {
  if (question.id === PROPOSAL_QUESTION_IDS.customer) return 'Customer selection'
  if (question.id === PROPOSAL_QUESTION_IDS.departments) return 'Audience and departments'
  if (question.id === PROPOSAL_QUESTION_IDS.timeHorizon) return 'Time horizon'
  if (question.id === PROPOSAL_QUESTION_IDS.deckType) return 'Deck type'
  if (question.id === PROPOSAL_QUESTION_IDS.confirm) return 'Proposal brief'
  return question.header ?? 'Proposal setup'
}

export function ProposalQuestionComposer({ matched }: { readonly matched: HarnessQuestionWait }): React.JSX.Element {
  const question = matched.payload.questions[0]!
  const options = question.options ?? []
  const [selected, setSelected] = useState<readonly string[]>([])
  const [custom, setCustom] = useState('')
  const [focused, setFocused] = useState(options[0]?.label ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasPreview = question.id === PROPOSAL_QUESTION_IDS.deckType
  const focusedOption = useMemo(() => options.find(option => option.label === focused) ?? options[0], [focused, options])

  const answer = async (labels: readonly string[], customAnswer = ''): Promise<void> => {
    setBusy(true); setError(null)
    try {
      await answerHarnessQuestion(matched, [{
        id: question.id,
        selected: customAnswer === '' || question.multiSelect === true ? labels : [],
        ...(customAnswer === '' ? {} : { custom: customAnswer }),
      }])
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const choose = (label: string): void => {
    if (busy) return
    if (question.multiSelect === true) {
      setCustom('')
      setSelected(current => current.includes(label) ? current.filter(value => value !== label) : [...current, label])
      return
    }
    void answer([label])
  }

  const cancel = (): void => {
    setBusy(true); setError(null)
    void cancelHarnessQuestion(matched).catch(cause => {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  return <div data-paimind-proposal-frame data-question-key={matched.key}>
    <section data-paimind-proposal-card aria-labelledby={`proposal-question-${matched.key}`}>
      <header data-paimind-proposal-head>
        <div>
          <p data-paimind-proposal-kicker>{questionStage(question)}</p>
          <h2 data-paimind-proposal-title id={`proposal-question-${matched.key}`}>{question.question}</h2>
          {question.detail === undefined ? null : <p data-paimind-proposal-detail>{question.detail}</p>}
        </div>
        <button type="button" data-paimind-proposal-close aria-label="Cancel proposal question" disabled={busy} onClick={cancel}>×</button>
      </header>
      <div data-paimind-proposal-body data-preview={hasPreview}>
        <div data-paimind-proposal-options role={question.multiSelect === true ? 'group' : 'radiogroup'}>
          {options.map((option, index) => {
            const active = selected.includes(option.label)
            const display = optionPresentation(option.label)
            return <button
              type="button"
              key={`${option.label}-${String(index)}`}
              data-paimind-proposal-option
              data-focused={focused === option.label}
              role={question.multiSelect === true ? 'checkbox' : 'radio'}
              aria-checked={active}
              disabled={busy}
              onMouseEnter={() => { setFocused(option.label) }}
              onFocus={() => { setFocused(option.label) }}
              onClick={() => { choose(option.label) }}
            >
              {customerBadge(option.label) ?? <span data-paimind-proposal-indicator aria-hidden="true">{active ? '✓' : index + 1}</span>}
              <span data-paimind-proposal-option-copy>
                <span data-paimind-proposal-option-line><strong>{display.label}</strong>{display.recommended ? <em data-paimind-proposal-recommended>Recommended</em> : null}</span>
                {option.description === undefined ? null : <small>{option.description}</small>}
              </span>
            </button>
          })}
          <label data-paimind-proposal-custom>
            <span data-paimind-proposal-indicator aria-hidden="true">＋</span>
            <input
              type="text"
              value={custom}
              placeholder="Enter another option"
              disabled={busy}
              onChange={event => { setSelected([]); setCustom(event.currentTarget.value); setError(null) }}
              onKeyDown={event => { if (event.key === 'Enter' && custom.trim() !== '') { event.preventDefault(); void answer([], custom.trim()) } }}
            />
          </label>
          {question.multiSelect === true && <div data-paimind-proposal-actions>
            <span>{selected.length} selected</span>
            <button type="button" data-paimind-proposal-submit disabled={busy || (selected.length === 0 && custom.trim() === '')} onClick={() => { void answer(selected, custom.trim()) }}>Continue</button>
          </div>}
          {error === null ? null : <p data-paimind-proposal-error role="status">{error}</p>}
        </div>
        {hasPreview ? <DeckPreview option={focusedOption} /> : null}
      </div>
    </section>
  </div>
}

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:proposal-experience', packageName: '@paimind/proposal-experience', category: 'agents',
    nameZh: '提案助手交互', nameEn: 'Proposal Assistant Experience',
    descriptionZh: '在 Harness 原生提问链路中提供客户徽标、Deck Type 与风格预览。',
    descriptionEn: 'Adds customer badges, deck types and style previews to native Harness proposal questions.',
    surface: 'conversation', maturity: 'technical-preview', order: 30,
  })
  ctx.effect(installStyle, 'paimind-proposal-experience: style')
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: -20,
    select: selectProposalQuestion,
  }, ProposalQuestionComposer))
}
