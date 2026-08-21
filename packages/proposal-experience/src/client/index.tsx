import { useMemo, useState } from 'react'
import {
  answerHarnessQuestion,
  cancelHarnessQuestion,
  contributePaimindExtension,
  selectHarnessNamespacedQuestion,
  type HarnessQuestionItem,
  type HarnessQuestionOption,
  type HarnessQuestionWait,
  type HarnessSessionService,
  type PaimindClientContext,
} from '@paimind/harness-compat'
import { PaimindCheckIcon } from '@paimind/harness-compat/client-icons'
import DOLLAR_GENERAL_MARK from '../../assets/dollar-general-mark.webp'
import WALMART_SPARK from '../../assets/walmart-spark.webp'
import EXECUTIVE_STORYBOARD from '../../assets/paramont-executive-editorial-storyboard.webp'
import { PROPOSAL_QUESTION_IDS, PROPOSAL_QUESTION_NAMESPACE } from '../index.js'

export const inject = ['slots', 'sessions']
const STYLE_ID = '@paimind/proposal-experience'

const STYLE = `
[data-paimind-proposal-frame]{display:flex;justify-content:center;padding:8px calc(var(--dsh-composer-side-clearance,0px) + 16px) 12px}
[data-paimind-proposal-thread]{display:grid;width:min(900px,100%);max-height:min(72vh,720px);gap:10px;overflow:auto;scrollbar-gutter:stable;padding:2px 6px 8px;color:var(--dsw-alias-label-primary,#172033)}
[data-paimind-proposal-speaker]{display:flex;align-items:center;gap:10px;padding:0 2px}
[data-paimind-proposal-avatar]{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;border-radius:11px;background:linear-gradient(145deg,#102b4b,#356fa8);color:#fff;font-size:11px;font-weight:780;letter-spacing:.04em;box-shadow:0 7px 18px rgba(22,55,89,.2)}
[data-paimind-proposal-speaker] strong{display:block;font-size:12px;line-height:17px;font-weight:680}
[data-paimind-proposal-speaker] small{display:block;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:9px;line-height:13px}
[data-paimind-proposal-card],[data-paimind-proposal-card] *{box-sizing:border-box}
[data-paimind-proposal-card]{width:calc(100% - 42px);margin-left:42px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(110,120,135,.24));border-radius:18px 18px 18px 7px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#172033);box-shadow:0 10px 32px rgba(12,31,55,.09)}
[data-paimind-proposal-head]{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:17px 18px 13px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.14))}
[data-paimind-proposal-heading]{min-width:0}
[data-paimind-proposal-kicker-row]{display:flex;align-items:center;gap:8px;margin-bottom:5px}
[data-paimind-proposal-kicker]{margin:0;color:var(--dsw-alias-brand-primary,#356fa8);font-size:10px;font-weight:780;letter-spacing:.17em;text-transform:uppercase}
[data-paimind-proposal-step-count]{color:var(--dsw-alias-label-tertiary,#7b8796);font-size:10px;font-weight:650}
[data-paimind-proposal-title]{margin:0;font-size:19px;line-height:25px;font-weight:670;letter-spacing:-.018em}
[data-paimind-proposal-detail]{max-width:680px;margin:6px 0 0;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:18px}
[data-paimind-proposal-progress]{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:4px 0 0;padding:0;list-style:none}
[data-paimind-proposal-progress] li{position:relative;min-width:0;padding-top:8px;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:9px;font-weight:650;line-height:13px}
[data-paimind-proposal-progress] li::before{content:'';position:absolute;inset:0 0 auto;height:2px;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(110,120,135,.18))}
[data-paimind-proposal-progress] li[data-state='complete'],[data-paimind-proposal-progress] li[data-state='current']{color:var(--dsw-alias-label-primary,#172033)}
[data-paimind-proposal-progress] li[data-state='complete']::before{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 62%,#8fa7bf)}
[data-paimind-proposal-progress] li[data-state='current']::before{height:3px;background:var(--dsw-alias-brand-primary,#356fa8);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 11%,transparent)}
[data-paimind-proposal-body]{display:grid;grid-template-columns:minmax(300px,1fr);min-height:0}
[data-paimind-proposal-body][data-preview='true']{grid-template-columns:minmax(260px,.96fr) minmax(280px,1.04fr)}
[data-paimind-proposal-options]{display:grid;grid-template-columns:1fr;align-content:start;gap:9px;min-width:0;padding:17px 18px 19px}
[data-paimind-proposal-options][data-stage='customer']{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
[data-paimind-proposal-options][data-stage='departments']{grid-template-columns:repeat(2,minmax(0,1fr))}
[data-paimind-proposal-options][data-stage='time-horizon']{grid-template-columns:repeat(3,minmax(0,1fr))}
[data-paimind-proposal-options][data-stage='confirm']{grid-template-columns:repeat(2,minmax(0,1fr))}
[data-paimind-proposal-options][data-stage='deck-type']{grid-template-columns:1fr}
[data-paimind-proposal-option]{display:flex;align-items:center;gap:11px;width:100%;min-height:58px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.18));border-radius:15px;background:transparent;color:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,border-color .14s ease,background-color .14s ease,box-shadow .14s ease}
[data-paimind-proposal-option]:hover,[data-paimind-proposal-option]:focus-visible,[data-paimind-proposal-option][data-focused='true']{outline:none;border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 58%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 7%,transparent);box-shadow:0 10px 28px rgba(29,66,101,.11);transform:translateY(-1px)}
[data-paimind-proposal-option][aria-checked='true']{border-color:var(--dsw-alias-brand-primary,#356fa8);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 11%,transparent)}
[data-paimind-proposal-options][data-stage='customer'] [data-paimind-proposal-option]{min-height:84px;padding:13px}
[data-paimind-proposal-options][data-stage='time-horizon'] [data-paimind-proposal-option]{min-height:105px;align-items:flex-start;flex-direction:column;justify-content:space-between}
[data-paimind-proposal-options][data-stage='confirm'] [data-paimind-proposal-option]{min-height:94px}
[data-paimind-proposal-indicator]{display:grid;place-items:center;flex:0 0 23px;width:23px;height:23px;border:1px solid var(--dsw-alias-border-l3,rgba(110,120,135,.34));border-radius:7px;color:var(--dsw-alias-label-secondary,#667085);font-size:10px;font-weight:740}
[data-paimind-proposal-indicator] svg{width:13px;height:13px}
[data-paimind-proposal-option][aria-checked='true'] [data-paimind-proposal-indicator]{border-color:var(--dsw-alias-brand-primary,#356fa8);background:var(--dsw-alias-brand-primary,#356fa8);color:#fff}
[data-paimind-brand-logo-shell]{display:flex;flex:0 0 48px;align-items:center;justify-content:center;width:48px;height:48px;padding:7px;border:1px solid rgba(31,43,62,.12);border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 6px 16px rgba(26,42,61,.08)}
[data-paimind-brand-logo-shell][data-brand='dollar-general']{padding:0;border-radius:999px;background:#ffef00}
[data-paimind-brand-logo-shell][data-brand='walmart']{background:#0b63ce}
[data-paimind-brand-logo]{display:block;width:100%;height:100%;object-fit:contain}
[data-paimind-proposal-option-copy]{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}
[data-paimind-proposal-option-line]{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
[data-paimind-proposal-option-line] strong{font-size:13px;line-height:19px;font-weight:660}
[data-paimind-proposal-option-copy] small{color:var(--dsw-alias-label-secondary,#667085);font-size:11px;line-height:16px}
[data-paimind-proposal-recommended]{padding:2px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 14%,transparent);color:var(--dsw-alias-brand-primary,#356fa8);font-size:8px;font-style:normal;font-weight:780;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-proposal-custom]{display:flex;align-items:center;gap:9px;grid-column:1/-1;margin-top:1px;padding:9px 11px;border:1px dashed var(--dsw-alias-border-l2,rgba(110,120,135,.26));border-radius:13px}
[data-paimind-proposal-custom] input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12px}
[data-paimind-proposal-actions]{display:flex;align-items:center;justify-content:space-between;grid-column:1/-1;gap:12px;margin-top:2px;padding-top:2px}
[data-paimind-proposal-actions] span{color:var(--dsw-alias-label-tertiary,#7b8796);font-size:10px}
[data-paimind-proposal-submit]{min-height:34px;padding:8px 14px;border:0;border-radius:10px;background:var(--dsw-alias-label-primary,#172033);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:11px;font-weight:670;cursor:pointer}
[data-paimind-proposal-submit]:disabled{opacity:.45;cursor:default}
[data-paimind-proposal-utility]{display:flex;justify-content:flex-end;padding:0 18px 12px}
[data-paimind-proposal-utility] button{padding:4px 0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:9px;cursor:pointer}
[data-paimind-proposal-utility] button:hover{color:var(--dsw-alias-label-primary,#172033);text-decoration:underline;text-underline-offset:3px}
[data-paimind-proposal-error]{grid-column:1/-1;margin:0;color:#c64242;font-size:11px;line-height:17px}
[data-paimind-deck-preview]{display:flex;flex-direction:column;min-width:0;padding:17px 18px 16px;border-left:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));background:linear-gradient(155deg,color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 8%,transparent),transparent 55%)}
[data-paimind-deck-preview] > small{color:var(--dsw-alias-brand-primary,#356fa8);font-size:9px;font-weight:780;letter-spacing:.15em;text-transform:uppercase}
[data-paimind-deck-preview] > h3{margin:5px 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:23px;font-weight:650}
[data-paimind-deck-preview] > p{margin:0;color:var(--dsw-alias-label-secondary,#667085);font-size:11px;line-height:16px}
[data-paimind-storyboard-frame]{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;margin-top:12px;padding:10px;border:1px solid rgba(29,51,78,.13);border-radius:14px;background:#081b30;box-shadow:0 14px 30px rgba(12,31,55,.16);overflow:hidden}
[data-paimind-storyboard]{display:block;width:auto;max-width:100%;height:268px;object-fit:contain}
[data-paimind-storyboard-caption]{position:absolute;right:16px;bottom:15px;padding:4px 7px;border-radius:999px;background:rgba(7,20,35,.76);color:#fff;font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;backdrop-filter:blur(8px)}
[data-paimind-preview-meta]{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px}
[data-paimind-preview-meta] div{padding:8px 9px;border:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));border-radius:10px;background:color-mix(in srgb,var(--dsw-specific-input-major,#fff) 82%,transparent)}
[data-paimind-preview-meta] span{display:block;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:8px;font-weight:760;letter-spacing:.09em;text-transform:uppercase}
[data-paimind-preview-meta] strong{display:block;margin-top:3px;font-size:10px;line-height:14px;font-weight:620}
[data-paimind-preview-hint]{margin-top:9px!important;font-size:9px!important}
[data-paimind-proposal-summaries]{display:grid;width:calc(100% - 42px);margin-left:42px;gap:7px}
[data-paimind-proposal-summary]{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;min-height:48px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 20%,transparent);border-radius:13px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 6%,var(--dsw-specific-input-major,#fff));box-shadow:0 4px 14px rgba(12,31,55,.04)}
[data-paimind-proposal-summary-check]{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 13%,transparent);color:var(--dsw-alias-brand-primary,#356fa8)}
[data-paimind-proposal-summary-check] svg{width:13px;height:13px}
[data-paimind-proposal-summary-copy]{min-width:0}
[data-paimind-proposal-summary-copy] span{display:block;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:8px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
[data-paimind-proposal-summary-copy] strong{display:block;overflow:hidden;margin-top:2px;font-size:11px;line-height:16px;font-weight:640;text-overflow:ellipsis;white-space:nowrap}
[data-paimind-proposal-summary-edit]{min-height:28px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.18));border-radius:8px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-secondary,#667085);font-size:9px;font-weight:650;cursor:pointer}
[data-paimind-proposal-summary-edit]:hover,[data-paimind-proposal-summary-edit]:focus-visible{outline:none;border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 48%,transparent);color:var(--dsw-alias-brand-primary,#356fa8)}
[data-paimind-proposal-summary] [data-paimind-brand-logo-shell]{width:28px;height:28px;flex-basis:28px;padding:4px;border-radius:8px;box-shadow:none}
[data-paimind-proposal-summary] [data-paimind-brand-logo-shell][data-brand='dollar-general']{padding:0;border-radius:999px}
[data-paimind-proposal-ready]{padding:19px}
[data-paimind-proposal-ready-hero]{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:13px;padding:15px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 24%,transparent);border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 7%,transparent)}
[data-paimind-proposal-ready-icon]{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:var(--dsw-alias-brand-primary,#356fa8);color:#fff;box-shadow:0 10px 22px color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 28%,transparent)}
[data-paimind-proposal-ready-icon] svg{width:19px;height:19px}
[data-paimind-proposal-ready-hero] strong{display:block;font-size:14px;line-height:20px}
[data-paimind-proposal-ready-hero] p{margin:3px 0 0;color:var(--dsw-alias-label-secondary,#667085);font-size:11px;line-height:17px}
[data-paimind-proposal-brief-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}
[data-paimind-proposal-brief-grid] div{padding:11px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));border-radius:12px;background:color-mix(in srgb,var(--dsw-specific-input-major,#fff) 90%,transparent)}
[data-paimind-proposal-brief-grid] span{display:block;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:8px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
[data-paimind-proposal-brief-grid] strong{display:block;margin-top:4px;font-size:11px;line-height:16px;font-weight:630}
[data-paimind-proposal-ready-actions]{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px}
[data-paimind-proposal-ready-actions] small{color:var(--dsw-alias-label-tertiary,#7b8796);font-size:9px;line-height:14px}
[data-ds-dark-theme] [data-paimind-proposal-card]{background:#151e2c;color:#edf3fb}
[data-ds-dark-theme] [data-paimind-proposal-summary]{background:color-mix(in srgb,#356fa8 13%,#151e2c)}
[data-ds-dark-theme] [data-paimind-proposal-summary-edit]{background:#151e2c;color:#c5d0dd}
[data-ds-dark-theme] [data-paimind-brand-logo-shell]{border-color:rgba(255,255,255,.18)}
@media(max-width:840px){[data-paimind-proposal-body][data-preview='true']{grid-template-columns:1fr}[data-paimind-deck-preview]{border-top:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));border-left:0}[data-paimind-storyboard]{height:230px}}
@media(max-width:620px){[data-paimind-proposal-frame]{padding-right:10px;padding-left:10px}[data-paimind-proposal-thread]{padding-right:0;padding-left:0}[data-paimind-proposal-card],[data-paimind-proposal-summaries]{width:100%;margin-left:0}[data-paimind-proposal-head]{padding:16px 15px 13px}[data-paimind-proposal-progress] li{font-size:0}[data-paimind-proposal-progress] li::after{content:attr(data-step);font-size:9px}[data-paimind-proposal-options]{padding:12px}[data-paimind-proposal-options][data-stage='customer'],[data-paimind-proposal-options][data-stage='departments'],[data-paimind-proposal-options][data-stage='confirm'],[data-paimind-proposal-brief-grid]{grid-template-columns:1fr}[data-paimind-proposal-options][data-stage='time-horizon']{grid-template-columns:1fr}[data-paimind-proposal-options][data-stage='time-horizon'] [data-paimind-proposal-option]{min-height:60px;flex-direction:row;align-items:center}[data-paimind-proposal-ready-actions]{align-items:flex-start;flex-direction:column}}
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

const OPTION_DETAILS: Readonly<Record<string, string>> = Object.freeze({
  'Dollar General': 'Value retail · U.S. mass-market footprint',
  Walmart: 'Omnichannel retail · enterprise scale',
  Merchandising: 'Assortment, pricing and item strategy',
  'Category Management': 'Category performance and growth priorities',
  Sales: 'Commercial story and customer commitments',
  'Executive Leadership': 'Decision, investment and risk framing',
  Marketing: 'Shopper story and activation plan',
  'Next Quarter': 'Immediate commercial priorities',
  'Next 6 Months': 'Near-term growth program',
  'Next 12 Months': 'Annual strategic plan',
  'Executive Proposal': 'Decision-ready narrative for senior leaders',
  'Category Growth Strategy': 'Growth thesis, evidence and roadmap',
  'Line Review & Assortment': 'Merchant-ready assortment recommendation',
  'Confirm and create brief': 'Lock the intake and prepare the proposal brief',
  'Review from the beginning': 'Return to the customer step without leaving the conversation',
})

function brandLogo(label: string): React.JSX.Element | null {
  const normalized = optionPresentation(label).label
  if (normalized === 'Dollar General') {
    return <span data-paimind-brand-logo-shell data-brand="dollar-general"><img data-paimind-brand-logo src={DOLLAR_GENERAL_MARK} alt="" /></span>
  }
  if (normalized === 'Walmart') {
    return <span data-paimind-brand-logo-shell data-brand="walmart"><img data-paimind-brand-logo src={WALMART_SPARK} alt="" /></span>
  }
  return null
}

interface DeckPreviewSpec {
  readonly title: string
  readonly bestFor: string
  readonly story: string
  readonly description: string
}

const DECK_PREVIEWS: Readonly<Record<string, DeckPreviewSpec>> = Object.freeze({
  'Executive Proposal': Object.freeze({
    title: 'Paramont Executive Editorial',
    bestFor: 'Senior buyer and leadership decisions',
    story: 'Decision · Evidence · Action',
    description: 'A premium navy, warm ivory and brushed-gold system with restrained data storytelling.',
  }),
  'Category Growth Strategy': Object.freeze({
    title: 'Paramont Category Intelligence',
    bestFor: 'Category planning and growth workshops',
    story: 'Market shift · White space · Roadmap',
    description: 'An insight-led editorial system that makes growth spaces, priorities and sequencing easy to scan.',
  }),
  'Line Review & Assortment': Object.freeze({
    title: 'Paramont Assortment Studio',
    bestFor: 'Merchant reviews and assortment decisions',
    story: 'Current line · Gaps · Recommendation',
    description: 'A merchant-ready visual system for comparing the current line, gaps and recommended moves.',
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
    <p>{preview.description}</p>
    <div data-paimind-storyboard-frame>
      <img data-paimind-storyboard src={EXECUTIVE_STORYBOARD} alt="Three representative navy, ivory and gold proposal slides" />
      <span data-paimind-storyboard-caption>3-slide system</span>
    </div>
    <div data-paimind-preview-meta>
      <div><span>Best for</span><strong>{preview.bestFor}</strong></div>
      <div><span>Story rhythm</span><strong>{preview.story}</strong></div>
    </div>
    <p data-paimind-preview-hint>Preview by hover or focus. Select a style, then confirm it explicitly.</p>
  </aside>
}

const PROPOSAL_STEPS = Object.freeze([
  { id: PROPOSAL_QUESTION_IDS.customer, label: 'Customer', stage: 'customer' },
  { id: PROPOSAL_QUESTION_IDS.departments, label: 'Audience', stage: 'departments' },
  { id: PROPOSAL_QUESTION_IDS.timeHorizon, label: 'Horizon', stage: 'time-horizon' },
  { id: PROPOSAL_QUESTION_IDS.deckType, label: 'Deck style', stage: 'deck-type' },
  { id: PROPOSAL_QUESTION_IDS.confirm, label: 'Confirm', stage: 'confirm' },
] as const)

interface ProposalDemoMatch {
  readonly kind: 'proposal-demo'
  readonly key: string
  readonly sessionId: string
}

interface ProposalDemoSelections {
  readonly customer?: string
  readonly departments: readonly string[]
  readonly timeHorizon?: string
  readonly deckType?: string
}

const EMPTY_DEMO_SELECTIONS: ProposalDemoSelections = Object.freeze({ departments: [] })

function ProposalSpeaker(): React.JSX.Element {
  return <div data-paimind-proposal-speaker>
    <span data-paimind-proposal-avatar aria-hidden="true">PA</span>
    <span><strong>Proposal Assistant</strong><small>Guided proposal intake · answers stay editable in this conversation</small></span>
  </div>
}

function selectionSummary(step: number, selections: ProposalDemoSelections): string | undefined {
  if (step === 0) return selections.customer
  if (step === 1) return selections.departments.length === 0 ? undefined : selections.departments.join(', ')
  if (step === 2) return selections.timeHorizon
  if (step === 3) return selections.deckType
  return undefined
}

function completedSelectionSteps(selections: ProposalDemoSelections, confirmed: boolean): readonly number[] {
  const steps = PROPOSAL_STEPS
    .slice(0, 4)
    .map((_, index) => index)
    .filter(index => selectionSummary(index, selections) !== undefined)
  return confirmed ? [...steps, 4] : steps
}

function AnswerSummaries(props: {
  readonly selections: ProposalDemoSelections
  readonly activeStep: number
  readonly visibleThrough: number
  readonly onEdit: (step: number) => void
}): React.JSX.Element | null {
  const summaries = PROPOSAL_STEPS.slice(0, 4).flatMap((step, index) => {
    const value = selectionSummary(index, props.selections)
    if (value === undefined || index === props.activeStep || index >= props.visibleThrough) return []
    return [{ step, index, value }]
  })
  if (summaries.length === 0) return null
  return <div data-paimind-proposal-summaries aria-label="Proposal answers">
    {summaries.map(summary => <div data-paimind-proposal-summary key={summary.step.id}>
      {summary.index === 0 ? brandLogo(summary.value) : <span data-paimind-proposal-summary-check aria-hidden="true"><PaimindCheckIcon /></span>}
      <span data-paimind-proposal-summary-copy><span>{summary.step.label}</span><strong>{summary.value}</strong></span>
      <button type="button" data-paimind-proposal-summary-edit aria-label={`Edit ${summary.step.label}`} onClick={() => { props.onEdit(summary.index) }}>Edit</button>
    </div>)}
  </div>
}

function questionForDemoStep(step: number, selections: ProposalDemoSelections): HarnessQuestionItem {
  const customer = selections.customer ?? 'the selected customer'
  switch (step) {
    case 0: return {
      id: PROPOSAL_QUESTION_IDS.customer,
      question: 'Which company are you preparing this proposal for?',
      detail: 'Choose the customer account so Proposal Assistant can shape the audience, time horizon and narrative style.',
      options: [{ label: 'Dollar General (Recommended)' }, { label: 'Walmart' }],
    }
    case 1: return {
      id: PROPOSAL_QUESTION_IDS.departments,
      question: 'Which departments should this proposal speak to?',
      detail: `Account context loaded for ${customer}. The brief will emphasize practical growth, shopper relevance and an executable path. Select every team that should see the final story.`,
      multiSelect: true,
      options: [
        { label: 'Merchandising' }, { label: 'Category Management' },
        { label: 'Sales' }, { label: 'Executive Leadership' },
        { label: 'Marketing' }, { label: 'Sourcing & Procurement' },
      ],
    }
    case 2: return {
      id: PROPOSAL_QUESTION_IDS.timeHorizon,
      question: 'What planning horizon should the proposal cover?',
      detail: `The selected audience spans ${selections.departments.length || 'multiple'} team${selections.departments.length === 1 ? '' : 's'}. Choose the horizon that best matches the decision window.`,
      options: [{ label: 'Next Quarter' }, { label: 'Next 6 Months' }, { label: 'Next 12 Months (Recommended)' }],
    }
    case 3: return {
      id: PROPOSAL_QUESTION_IDS.deckType,
      question: 'What type of deck would you like to create?',
      detail: 'Hover or focus a style to inspect its visual system. Selection is staged until you confirm it.',
      options: [
        { label: 'Executive Proposal (Recommended)' },
        { label: 'Category Growth Strategy' },
        { label: 'Line Review & Assortment' },
      ],
    }
    default: return {
      id: PROPOSAL_QUESTION_IDS.confirm,
      question: 'Ready to create the proposal brief?',
      detail: `${customer} · ${selections.departments.join(', ')} · ${selections.timeHorizon ?? 'Planning horizon'} · ${selections.deckType ?? 'Deck style'}`,
      options: [{ label: 'Confirm and create brief' }, { label: 'Review from the beginning' }],
    }
  }
}

function selectionValue(answer: { readonly selected: readonly string[]; readonly custom?: string }): string {
  return answer.custom?.trim() || optionPresentation(answer.selected[0] ?? '').label
}

function ProposalBriefReady(props: {
  readonly selections: ProposalDemoSelections
  readonly onRestart: () => void
}): React.JSX.Element {
  return <section data-paimind-proposal-card data-stage="ready" aria-labelledby="proposal-brief-ready-title">
    <header data-paimind-proposal-head>
      <div data-paimind-proposal-heading>
        <div data-paimind-proposal-kicker-row><p data-paimind-proposal-kicker>Proposal setup · Complete</p><span data-paimind-proposal-step-count>5 of 5 decisions captured</span></div>
        <h2 data-paimind-proposal-title id="proposal-brief-ready-title">Proposal brief ready for deck generation</h2>
        <p data-paimind-proposal-detail>Proposal Assistant has structured the intake. Slide content and PPTX generation remain intentionally deferred to the next delivery phase.</p>
      </div>
      <ProgressRail current={PROPOSAL_STEPS.length} />
    </header>
    <div data-paimind-proposal-ready>
      <div data-paimind-proposal-ready-hero><span data-paimind-proposal-ready-icon><PaimindCheckIcon /></span><div><strong>Decision-ready intake captured</strong><p>The answers above remain editable. The next run can turn this brief into an outline, evidence plan and editable deck.</p></div></div>
      <div data-paimind-proposal-ready-actions><small>Demo scope: intake and visual interaction only. No PPTX has been generated.</small><button type="button" data-paimind-proposal-submit onClick={props.onRestart}>Start another proposal</button></div>
    </div>
  </section>
}

function ProposalGuidedDemo({ matched }: { readonly matched: ProposalDemoMatch }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [resumeStep, setResumeStep] = useState<number | null>(null)
  const [selections, setSelections] = useState<ProposalDemoSelections>(EMPTY_DEMO_SELECTIONS)
  const question = useMemo(() => questionForDemoStep(step, selections), [selections, step])
  const initialAnswer = useMemo(() => {
    const values = step === 1 ? selections.departments : [selectionSummary(step, selections)].filter((value): value is string => value !== undefined)
    const selected = (question.options ?? []).filter(option => values.includes(optionPresentation(option.label).label)).map(option => option.label)
    const custom = values.find(value => !(question.options ?? []).some(option => optionPresentation(option.label).label === value)) ?? ''
    return { selected, custom }
  }, [question, selections, step])
  const wait = useMemo<HarnessQuestionWait>(() => ({
    kind: 'question', key: `${matched.key}:${String(step)}`, sessionId: matched.sessionId,
    payload: { questions: [question] },
    respond: async response => {
      if (!response.ok) {
        setSelections(EMPTY_DEMO_SELECTIONS); setResumeStep(null); setStep(0)
        return { accepted: true }
      }
      const answer = response.value.answer.answers[0]
      if (answer === undefined) return { accepted: false, reason: 'Proposal answer missing' }
      if (answer.id === PROPOSAL_QUESTION_IDS.confirm && selectionValue(answer) === 'Review from the beginning') {
        setResumeStep(null); setStep(0)
        return { accepted: true }
      }
      setSelections(current => {
        if (answer.id === PROPOSAL_QUESTION_IDS.customer) return { ...current, customer: selectionValue(answer) }
        if (answer.id === PROPOSAL_QUESTION_IDS.departments) return { ...current, departments: answer.custom?.trim() ? [answer.custom.trim()] : answer.selected.map(label => optionPresentation(label).label) }
        if (answer.id === PROPOSAL_QUESTION_IDS.timeHorizon) return { ...current, timeHorizon: selectionValue(answer) }
        if (answer.id === PROPOSAL_QUESTION_IDS.deckType) return { ...current, deckType: selectionValue(answer) }
        return current
      })
      setStep(current => resumeStep ?? Math.min(PROPOSAL_STEPS.length, current + 1))
      setResumeStep(null)
      return { accepted: true }
    },
  }), [matched.key, matched.sessionId, question, resumeStep, step])

  const edit = (targetStep: number): void => {
    setResumeStep(step)
    setStep(targetStep)
  }

  return <div data-paimind-proposal-frame>
    <div data-paimind-proposal-thread data-mode="guided-demo">
      <ProposalSpeaker />
      <AnswerSummaries
        selections={selections}
        activeStep={step}
        visibleThrough={resumeStep === null ? step : PROPOSAL_STEPS.length}
        onEdit={edit}
      />
      {step >= PROPOSAL_STEPS.length
        ? <ProposalBriefReady selections={selections} onRestart={() => { setSelections(EMPTY_DEMO_SELECTIONS); setResumeStep(null); setStep(0) }} />
        : <ProposalQuestionCard
            key={wait.key}
            matched={wait}
            inline
            initialSelected={initialAnswer.selected}
            initialCustom={initialAnswer.custom}
            completedSteps={completedSelectionSteps(selections, false)}
          />}
    </div>
  </div>
}

function questionStep(question: HarnessQuestionItem): number {
  const index = PROPOSAL_STEPS.findIndex(step => step.id === question.id)
  return index < 0 ? 0 : index
}

function questionStage(question: HarnessQuestionItem): string {
  return PROPOSAL_STEPS[questionStep(question)]?.label ?? question.header ?? 'Proposal setup'
}

function stageKey(question: HarnessQuestionItem): string {
  return PROPOSAL_STEPS[questionStep(question)]?.stage ?? 'generic'
}

function optionDetail(option: HarnessQuestionOption): string | undefined {
  return option.description ?? OPTION_DETAILS[optionPresentation(option.label).label]
}

function ProgressRail(props: { readonly current: number; readonly completedSteps?: readonly number[] }): React.JSX.Element {
  return <ol data-paimind-proposal-progress aria-label="Proposal setup progress">
    {PROPOSAL_STEPS.map((step, index) => <li
      key={step.id}
      data-step={index + 1}
      data-state={index < props.current || props.completedSteps?.includes(index) === true ? 'complete' : index === props.current ? 'current' : 'upcoming'}
      aria-current={index === props.current ? 'step' : undefined}
    >{step.label}</li>)}
  </ol>
}

interface ProposalQuestionComposerProps {
  readonly matched: HarnessQuestionWait
  readonly inline?: boolean
  readonly initialSelected?: readonly string[]
  readonly initialCustom?: string
  readonly completedSteps?: readonly number[]
}

function ProposalQuestionCard(props: ProposalQuestionComposerProps): React.JSX.Element {
  const { matched } = props
  const question = matched.payload.questions[0]!
  const options = question.options ?? []
  const [selected, setSelected] = useState<readonly string[]>(props.initialSelected ?? [])
  const [custom, setCustom] = useState(props.initialCustom ?? '')
  const [focused, setFocused] = useState(options[0]?.label ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const step = questionStep(question)
  const stage = stageKey(question)
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
    setCustom('')
    setFocused(label)
    setSelected([label])
  }

  const cancel = (): void => {
    setBusy(true); setError(null)
    void cancelHarnessQuestion(matched).catch(cause => {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const actionLabel = hasPreview ? 'Use this deck style' : 'Continue'
  const actionStatus = hasPreview
    ? selected.length === 0 ? 'Preview and select one style' : `${optionPresentation(selected[0]!).label} selected`
    : selected.length === 0 && custom.trim() === '' ? 'Select an option to continue' : `${selected.length || 1} selected`

  const card = <section data-paimind-proposal-card data-stage={stage} aria-labelledby={`proposal-question-${matched.key}`}>
      <header data-paimind-proposal-head>
        <div data-paimind-proposal-heading>
          <div data-paimind-proposal-kicker-row>
            <p data-paimind-proposal-kicker>Proposal setup · {questionStage(question)}</p>
            <span data-paimind-proposal-step-count>Step {step + 1} of {PROPOSAL_STEPS.length}</span>
          </div>
          <h2 data-paimind-proposal-title id={`proposal-question-${matched.key}`}>{question.question}</h2>
          {question.detail === undefined ? null : <p data-paimind-proposal-detail>{question.detail}</p>}
        </div>
        <ProgressRail current={step} {...(props.completedSteps === undefined ? {} : { completedSteps: props.completedSteps })} />
      </header>
      <div data-paimind-proposal-body data-preview={hasPreview}>
        <div data-paimind-proposal-options data-stage={stage} role={question.multiSelect === true ? 'group' : 'radiogroup'}>
          {options.map((option, index) => {
            const active = selected.includes(option.label)
            const display = optionPresentation(option.label)
            const logo = stage === 'customer' ? brandLogo(option.label) : null
            const detail = optionDetail(option)
            return <button
              type="button"
              key={`${option.label}-${String(index)}`}
              data-paimind-proposal-option
              data-focused={hasPreview && focused === option.label}
              role={question.multiSelect === true ? 'checkbox' : 'radio'}
              aria-checked={active}
              aria-label={display.label}
              disabled={busy}
              onMouseEnter={() => { setFocused(option.label) }}
              onFocus={() => { setFocused(option.label) }}
              onClick={() => { choose(option.label) }}
            >
              {logo ?? <span data-paimind-proposal-indicator aria-hidden="true">{active ? <PaimindCheckIcon /> : index + 1}</span>}
              <span data-paimind-proposal-option-copy>
                <span data-paimind-proposal-option-line><strong>{display.label}</strong>{display.recommended ? <em data-paimind-proposal-recommended>Recommended</em> : null}</span>
                {detail === undefined ? null : <small>{detail}</small>}
              </span>
            </button>
          })}
          <label data-paimind-proposal-custom>
            <span data-paimind-proposal-indicator aria-hidden="true">+</span>
            <input
              type="text"
              value={custom}
              placeholder="Enter another option"
              disabled={busy}
              onChange={event => { setSelected([]); setCustom(event.currentTarget.value); setError(null) }}
              onKeyDown={event => { if (event.key === 'Enter' && custom.trim() !== '') { event.preventDefault(); void answer([], custom.trim()) } }}
            />
          </label>
          <div data-paimind-proposal-actions data-kind={hasPreview ? 'deck' : question.multiSelect === true ? 'multi-select' : 'single-select'}>
            <span>{actionStatus}</span>
            <button type="button" data-paimind-proposal-submit disabled={busy || (selected.length === 0 && custom.trim() === '')} onClick={() => { void answer(selected, custom.trim()) }}>{actionLabel}</button>
          </div>
          {error === null ? null : <p data-paimind-proposal-error role="status">{error}</p>}
        </div>
        {hasPreview ? <DeckPreview option={focusedOption} /> : null}
      </div>
      <footer data-paimind-proposal-utility><button type="button" aria-label="Cancel proposal question" disabled={busy} onClick={cancel}>Cancel intake</button></footer>
    </section>

  if (props.inline === true) return card
  return <div data-paimind-proposal-frame data-question-key={matched.key}>
    <div data-paimind-proposal-thread data-mode="native-question"><ProposalSpeaker />{card}</div>
  </div>
}

export function ProposalQuestionComposer({ matched }: { readonly matched: HarnessQuestionWait }): React.JSX.Element {
  return <ProposalQuestionCard matched={matched} />
}

interface ProposalExperienceClientContext extends PaimindClientContext {
  readonly sessions: HarnessSessionService
}

interface ProposalComposerOwner extends ComposerOwner {
  readonly session?: { readonly sessionId: string; readonly running: boolean; readonly removed?: boolean }
}

export function apply(ctx: ProposalExperienceClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:proposal-experience', packageName: '@paimind/proposal-experience', category: 'agents',
    nameZh: '提案助手交互', nameEn: 'Proposal Assistant Experience',
    descriptionZh: '在 Harness 原生提问链路中提供客户品牌、Deck Type 与风格预览。',
    descriptionEn: 'Adds customer brands, deck types and style previews to native Harness proposal questions.',
    surface: 'conversation', maturity: 'technical-preview', order: 30,
  })
  ctx.effect(installStyle, 'paimind-proposal-experience: style')
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: -20,
    select: selectProposalQuestion,
  }, ProposalQuestionComposer))
  const demoMatches = new Map<string, ProposalDemoMatch>()
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: -19,
    select: (owner: ProposalComposerOwner): ProposalDemoMatch | null => {
      if (owner.interactions.some(interaction => (interaction as { readonly kind?: string }).kind === 'question')) return null
      const session = owner.session
      if (session === undefined || session.running || session.removed === true) return null
      const presetId = ctx.sessions.list.getSnapshot().byId[session.sessionId]?.agentPreset
      if (presetId !== 'proposal-assistant') return null
      let match = demoMatches.get(session.sessionId)
      if (match === undefined) {
        match = Object.freeze({ kind: 'proposal-demo', key: `proposal-demo:${session.sessionId}`, sessionId: session.sessionId })
        demoMatches.set(session.sessionId, match)
      }
      return match
    },
  }, ProposalGuidedDemo))
}
