import { useMemo, useState } from 'react'
import {
  answerHarnessQuestion,
  contributePaimindExtension,
  selectHarnessNamespacedQuestion,
  type HarnessQuestionItem,
  type HarnessQuestionOption,
  type HarnessQuestionWait,
  type PaimindClientContext,
} from '@paimind/harness-compat'
import { PaimindCheckIcon } from '@paimind/harness-compat/client-icons'
import DOLLAR_GENERAL_MARK from '../../assets/dollar-general-mark.webp'
import WALMART_SPARK from '../../assets/walmart-spark.webp'
import BEAUTY_CARE_AVATAR from '../../assets/department-beauty-care-avatar.webp'
import STATIONERY_AVATAR from '../../assets/department-stationery-avatar.webp'
import HOLIDAY_EVENTS_AVATAR from '../../assets/department-holiday-events-avatar.webp'
import PARAMONT_SIGNATURE_STORYBOARD from '../../assets/paramont-signature-storyboard.webp'
import PLAYFUL_STORYBOOK_STORYBOARD from '../../assets/playful-storybook-storyboard.webp'
import STRATEGY_CONSULTING_STORYBOARD from '../../assets/strategy-consulting-storyboard.webp'
import { PROPOSAL_QUESTION_IDS, PROPOSAL_QUESTION_NAMESPACE } from '../index.js'

export const inject = ['slots']
const STYLE_ID = '@paimind/proposal-experience'

const STYLE = `
[data-paimind-proposal-frame]{display:flex;justify-content:center;padding:12px calc(var(--dsh-composer-side-clearance,0px) + 20px) 18px}
[data-paimind-proposal-thread]{display:grid;width:min(980px,100%);max-height:min(78vh,780px);gap:12px;overflow:auto;scrollbar-gutter:stable;padding:3px 8px 12px;color:var(--dsw-alias-label-primary,#172033)}
[data-paimind-proposal-speaker]{display:flex;align-items:center;gap:12px;padding:0 3px}
[data-paimind-proposal-avatar-seat]{position:relative;display:grid;place-items:center;flex:0 0 40px;width:40px;height:40px;border:1px solid rgba(37,76,112,.16);border-radius:50%;background:#e8f0f7;overflow:hidden;box-shadow:0 7px 18px rgba(22,55,89,.16)}
[data-paimind-proposal-avatar-seat]>img[data-paimind-agent-avatar]{display:block;width:100%;height:100%;border:0;border-radius:50%;object-fit:cover;box-shadow:none}
[data-paimind-proposal-avatar-fallback]{display:grid;place-items:center;width:100%;height:100%;background:#174a76;color:#fff;font-size:11px;font-weight:780;letter-spacing:.04em}
[data-paimind-proposal-avatar-seat][data-paimind-agent-avatar-ready='true']>[data-paimind-proposal-avatar-fallback],[data-paimind-proposal-avatar-seat]:has(>img[data-paimind-agent-avatar])>[data-paimind-proposal-avatar-fallback]{display:none}
[data-paimind-proposal-speaker] strong{display:block;font-size:14px;line-height:19px;font-weight:700}
[data-paimind-proposal-speaker] small{display:block;color:var(--dsw-alias-label-tertiary,#7b8796);font-size:10px;line-height:15px}
[data-paimind-proposal-card],[data-paimind-proposal-card] *{box-sizing:border-box}
[data-paimind-proposal-card]{container-type:inline-size;width:calc(100% - 52px);margin-left:52px;overflow:hidden;border:1px solid rgba(133,159,190,.26);border-radius:22px 22px 22px 8px;background:#101925;color:#eef3f9;box-shadow:0 24px 60px rgba(4,10,18,.34)}
[data-paimind-proposal-head]{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;padding:23px 26px 18px;border-bottom:1px solid rgba(133,159,190,.18);background:#131e2c}
[data-paimind-proposal-heading]{min-width:0}
[data-paimind-proposal-kicker-row]{display:flex;align-items:center;gap:8px;margin-bottom:5px}
[data-paimind-proposal-kicker]{margin:0;color:#86b6e4;font-size:11px;font-weight:800;letter-spacing:.17em;text-transform:uppercase}
[data-paimind-proposal-step-count]{color:#8796a9;font-size:11px;font-weight:680}
[data-paimind-proposal-title]{margin:0;font-size:24px;line-height:31px;font-weight:700;letter-spacing:-.025em}
[data-paimind-proposal-detail]{max-width:740px;margin:8px 0 0;color:#9ba9bb;font-size:13px;line-height:20px}
[data-paimind-proposal-progress]{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:5px 0 0;padding:0;list-style:none}
[data-paimind-proposal-progress] li{position:relative;min-width:0;padding-top:10px;color:#758397;font-size:10px;font-weight:680;line-height:14px}
[data-paimind-proposal-progress] li::before{content:'';position:absolute;inset:0 0 auto;height:2px;border-radius:999px;background:#29384a}
[data-paimind-proposal-progress] li[data-state='complete'],[data-paimind-proposal-progress] li[data-state='current']{color:#dfe8f3}
[data-paimind-proposal-progress] li[data-state='complete']::before{background:#527da7}
[data-paimind-proposal-progress] li[data-state='current']::before{height:3px;background:#82b7e9;box-shadow:0 0 0 3px rgba(89,151,207,.16)}
[data-paimind-proposal-body]{display:grid;grid-template-columns:minmax(300px,1fr);min-height:0}
[data-paimind-proposal-body][data-preview='true']{grid-template-columns:minmax(300px,.9fr) minmax(390px,1.1fr)}
[data-paimind-proposal-options]{display:grid;grid-template-columns:1fr;align-content:start;gap:11px;min-width:0;padding:22px 24px 24px}
[data-paimind-proposal-options][data-stage='customer']{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
[data-paimind-proposal-options][data-stage='department']{grid-template-columns:repeat(2,minmax(0,1fr))}
[data-paimind-proposal-options][data-stage='deck-type']{grid-template-columns:1fr}
[data-paimind-proposal-options][data-stage='deck-style']{grid-template-columns:1fr}
[data-paimind-proposal-option]{display:flex;align-items:center;gap:13px;width:100%;min-height:68px;padding:13px 15px;border:1px solid #2b3a4d;border-radius:17px;background:#151f2e;color:inherit;text-align:left;cursor:pointer;transition:transform .16s ease,border-color .16s ease,background-color .16s ease,box-shadow .16s ease}
[data-paimind-proposal-option]:hover,[data-paimind-proposal-option]:focus-visible{outline:none;border-color:#5e8fb9;background:#19283a;box-shadow:0 12px 30px rgba(2,8,16,.28);transform:translateY(-1px)}
[data-paimind-proposal-option][data-focused='true']:not(:hover):not(:focus-visible):not([aria-checked='true']){border-color:#3d5066;background:#172334}
[data-paimind-proposal-option][aria-checked='true']{border-color:#7aafe0;background:#1b3148;box-shadow:0 0 0 1px rgba(122,175,224,.14),0 12px 30px rgba(2,8,16,.3)}
[data-paimind-proposal-options][data-stage='customer'] [data-paimind-proposal-option]{min-height:104px;padding:16px}
[data-paimind-proposal-indicator]{display:grid;place-items:center;flex:0 0 27px;width:27px;height:27px;border:1px solid #46566a;border-radius:8px;color:#a8b5c5;font-size:11px;font-weight:760}
[data-paimind-proposal-indicator] svg{width:13px;height:13px}
[data-paimind-proposal-option][aria-checked='true'] [data-paimind-proposal-indicator]{border-color:#82b7e9;background:#5d91c0;color:#fff}
[data-paimind-department-avatar]{position:relative;display:grid;place-items:center;flex:0 0 52px;width:52px;height:52px;padding:3px;border:1px solid #3b4b60;border-radius:50%;background:#091423;overflow:visible;box-shadow:0 8px 20px rgba(2,8,16,.28)}
[data-paimind-department-avatar][data-selected='true']{border-color:#91c0ea;box-shadow:0 0 0 3px rgba(99,158,211,.16),0 10px 24px rgba(2,8,16,.36)}
[data-paimind-department-avatar]>img{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover}
[data-paimind-department-meta]{display:inline-flex;align-items:center;min-height:18px;padding:1px 6px;border:1px solid #405167;border-radius:999px;color:#91a2b6;font-size:8px;font-weight:760;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-department-check]{position:absolute;right:-3px;bottom:-3px;display:grid;place-items:center;width:18px;height:18px;border:2px solid #151f2e;border-radius:999px;background:#82b7e9;color:#0b1724;box-shadow:0 3px 9px rgba(2,8,16,.34)}
[data-paimind-department-check] svg{width:10px;height:10px}
[data-paimind-deck-style-thumb-shell]{position:relative;display:block;flex:0 0 72px;width:72px;height:48px;border:1px solid rgba(31,43,62,.13);border-radius:10px;background:#fff;overflow:hidden;box-shadow:0 5px 14px rgba(26,42,61,.09)}
[data-paimind-deck-style-thumb]{display:block;width:100%;height:100%;object-fit:cover}
[data-paimind-deck-style-check]{position:absolute;right:4px;bottom:4px;display:grid;place-items:center;width:18px;height:18px;border-radius:6px;background:#174a76;color:#fff;box-shadow:0 3px 8px rgba(12,31,55,.2)}
[data-paimind-deck-style-check] svg{width:10px;height:10px}
[data-paimind-brand-logo-shell]{display:flex;flex:0 0 58px;align-items:center;justify-content:center;width:58px;height:58px;padding:8px;border:1px solid rgba(31,43,62,.12);border-radius:17px;background:#fff;overflow:hidden;box-shadow:0 8px 20px rgba(26,42,61,.1)}
[data-paimind-brand-logo-shell][data-brand='dollar-general']{padding:0;border-radius:999px;background:#ffef00}
[data-paimind-brand-logo-shell][data-brand='walmart']{background:#0b63ce}
[data-paimind-brand-logo]{display:block;width:100%;height:100%;object-fit:contain}
[data-paimind-proposal-option-copy]{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}
[data-paimind-proposal-option-line]{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
[data-paimind-proposal-option-line] strong{font-size:14px;line-height:20px;font-weight:690}
[data-paimind-proposal-option-copy] small{color:#9caabd;font-size:12px;line-height:17px}
[data-paimind-proposal-recommended]{padding:2px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#356fa8) 14%,transparent);color:var(--dsw-alias-brand-primary,#356fa8);font-size:8px;font-style:normal;font-weight:780;letter-spacing:.08em;text-transform:uppercase}
[data-paimind-proposal-custom]{display:flex;align-items:center;gap:9px;grid-column:1/-1;margin-top:1px;padding:9px 11px;border:1px dashed #3a4b60;border-radius:13px;background:#121c2a}
[data-paimind-proposal-custom] input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12px}
[data-paimind-proposal-actions]{display:flex;align-items:center;justify-content:space-between;grid-column:1/-1;gap:12px;margin-top:2px;padding-top:2px}
[data-paimind-proposal-action-leading]{display:flex;align-items:center;gap:10px;min-width:0}
[data-paimind-proposal-action-leading]>span{color:#8391a4;font-size:10px}
[data-paimind-proposal-back]{min-height:34px;padding:7px 10px;border:1px solid #35465b;border-radius:10px;background:#141f2e;color:#a8b5c5;font-size:10px;font-weight:680;white-space:nowrap;cursor:pointer}
[data-paimind-proposal-back]:hover,[data-paimind-proposal-back]:focus-visible{outline:none;border-color:#6698c3;color:#c7def3}
[data-paimind-proposal-submit]{min-height:40px;padding:10px 17px;border:1px solid rgba(150,198,240,.28);border-radius:11px;background:#356b9d;color:#fff;font-size:12px;font-weight:700;white-space:nowrap;cursor:pointer;box-shadow:0 9px 22px rgba(4,12,22,.3)}
[data-paimind-proposal-submit]:disabled{opacity:.45;cursor:default}
[data-paimind-proposal-utility]{display:flex;justify-content:flex-end;padding:0 18px 12px}
[data-paimind-proposal-utility] button{padding:4px 0;border:0;background:transparent;color:#78879a;font-size:9px;cursor:pointer}
[data-paimind-proposal-utility] button:hover{color:#c6d4e3;text-decoration:underline;text-underline-offset:3px}
[data-paimind-proposal-error]{grid-column:1/-1;margin:0;color:#c64242;font-size:11px;line-height:17px}
[data-paimind-deck-preview]{display:flex;flex-direction:column;min-width:0;padding:24px 26px 22px;border-left:1px solid rgba(133,159,190,.18);background:#121d2b}
[data-paimind-deck-preview][data-tone='consulting']{background:#171e27}
[data-paimind-deck-preview][data-tone='paramont']{background:#102033}
[data-paimind-deck-preview][data-tone='playful']{background:#282215}
[data-paimind-deck-preview] > small{color:#86b6e4;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
[data-paimind-deck-preview] > h3{margin:7px 0 5px;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:30px;font-weight:650;letter-spacing:-.02em}
[data-paimind-deck-preview] > p{margin:0;color:#9caabd;font-size:12px;line-height:18px}
[data-paimind-storyboard-frame]{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1672/941;min-height:0;margin-top:16px;padding:9px;border:1px solid #34465b;border-radius:18px;background:#081321;box-shadow:0 18px 38px rgba(2,8,16,.3);overflow:hidden}
[data-paimind-storyboard]{display:block;width:100%;height:100%;border-radius:11px;object-fit:contain}
[data-paimind-storyboard-caption]{position:absolute;right:16px;bottom:15px;padding:4px 7px;border-radius:999px;background:rgba(7,20,35,.76);color:#fff;font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;backdrop-filter:blur(8px)}
[data-paimind-preview-meta]{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px}
[data-paimind-preview-meta] div{padding:10px 11px;border:1px solid #304156;border-radius:12px;background:#152131}
[data-paimind-preview-meta] span{display:block;color:#8291a5;font-size:9px;font-weight:760;letter-spacing:.09em;text-transform:uppercase}
[data-paimind-preview-meta] strong{display:block;margin-top:4px;font-size:11px;line-height:15px;font-weight:650}
[data-paimind-preview-hint]{margin-top:9px!important;font-size:9px!important}
[data-paimind-deck-type-preview]{display:flex;flex-direction:column;min-width:0;padding:24px 26px 22px;border-left:1px solid rgba(133,159,190,.18);background:#121d2b}
[data-paimind-deck-type-preview]>small{color:#86b6e4;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
[data-paimind-deck-type-preview]>h3{margin:7px 0 5px;font-size:25px;line-height:30px;font-weight:720;letter-spacing:-.025em}
[data-paimind-deck-type-preview]>p{margin:0;color:#9caabd;font-size:12px;line-height:18px}
[data-paimind-deck-type-application]{display:grid;gap:10px;margin-top:18px}
[data-paimind-deck-type-application] div{padding:12px 13px;border:1px solid #304156;border-radius:13px;background:#152131}
[data-paimind-deck-type-application] span{display:block;color:#8291a5;font-size:9px;font-weight:760;letter-spacing:.09em;text-transform:uppercase}
[data-paimind-deck-type-application] strong{display:block;margin-top:4px;font-size:12px;line-height:17px;font-weight:650}
[data-paimind-deck-type-next]{margin-top:auto!important;padding-top:14px;color:#8291a5!important;font-size:9px!important}
[data-ds-dark-theme] [data-paimind-brand-logo-shell]{border-color:rgba(255,255,255,.18)}
@container (max-width:760px){[data-paimind-proposal-body][data-preview='true']{grid-template-columns:1fr}[data-paimind-deck-preview],[data-paimind-deck-type-preview]{border-top:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));border-left:0}}
@media(max-width:900px){[data-paimind-proposal-body][data-preview='true']{grid-template-columns:1fr}[data-paimind-deck-preview],[data-paimind-deck-type-preview]{border-top:1px solid var(--dsw-alias-border-l1,rgba(110,120,135,.16));border-left:0}}
@media(max-width:620px){[data-paimind-proposal-frame]{padding-right:10px;padding-left:10px}[data-paimind-proposal-thread]{padding-right:0;padding-left:0}[data-paimind-proposal-card]{width:100%;margin-left:0}[data-paimind-proposal-head]{padding:16px 15px 13px}[data-paimind-proposal-progress] li{font-size:0}[data-paimind-proposal-progress] li::after{content:attr(data-step);font-size:9px}[data-paimind-proposal-options]{padding:12px}[data-paimind-proposal-options][data-stage='customer'],[data-paimind-proposal-options][data-stage='department']{grid-template-columns:1fr}}
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
  '102 · Beauty Care': 'Cosmetics & Cosmetic Tools',
  '140 · Stationery': 'Stickers & Creative Crafts',
  '410 · Holiday Events': 'Party Favors & Balloons',
  'Category Analysis': 'Performance data, opportunity gaps and annual direction',
  'Internal Kick Off': 'Internal alignment for Sales, Category and Product Development',
  'Line Review Proposal': 'Formal category and line recommendation for customer buyers',
  'Strategy Consulting': 'Answer-first logic, sharp charts and executive clarity',
  'Paramont Signature': 'Official mountain identity with a confident enterprise system',
  'Playful Storybook': 'Colorful illustrated storytelling for family and youth audiences',
})

interface DepartmentOptionPresentation {
  readonly code: string
  readonly name: string
  readonly avatar: string
}

function departmentOptionPresentation(label: string): DepartmentOptionPresentation | null {
  const match = /^(\d{3})\s*[·—-]\s*([^—]+?)(?:\s+—\s+.+)?$/.exec(label.trim())
  if (match === null) return null
  const avatar = ({
    '102': BEAUTY_CARE_AVATAR,
    '140': STATIONERY_AVATAR,
    '410': HOLIDAY_EVENTS_AVATAR,
  } as const)[match[1] as '102' | '140' | '410']
  return avatar === undefined ? null : { code: match[1]!, name: match[2]!.trim(), avatar }
}

interface DeckTypePreviewSpec {
  readonly title: string
  readonly application: string
  readonly description: string
  readonly audience: string
  readonly structure: string
}

const DECK_TYPE_PREVIEWS: Readonly<Record<string, DeckTypePreviewSpec>> = Object.freeze({
  'Category Analysis': Object.freeze({
    title: 'Category Analysis',
    application: 'Performance analysis',
    description: 'Use performance data to clarify annual development direction, category gaps and priority opportunities.',
    audience: 'Category, development and leadership teams',
    structure: 'Performance baseline · Opportunity gaps · Annual direction',
  }),
  'Internal Kick Off': Object.freeze({
    title: 'Internal Kick Off',
    application: 'Internal alignment',
    description: 'Align Sales, Category and Product Development on targeted strategic metrics and the work ahead.',
    audience: 'Sales, Category and Product Development teams',
    structure: 'Why now · Strategic metrics · Workstreams · Owners',
  }),
  'Line Review Proposal': Object.freeze({
    title: 'Line Review Proposal',
    application: 'Buyer presentation',
    description: 'Present the category case, recommended line and commercial rationale to customer procurement teams.',
    audience: 'Customer buyers and procurement stakeholders',
    structure: 'Category opportunity · Line recommendation · Commercial case',
  }),
})

function deckTypePreviewFor(option: HarnessQuestionOption | undefined): DeckTypePreviewSpec {
  const label = option === undefined ? 'Category Analysis' : optionPresentation(option.label).label
  return DECK_TYPE_PREVIEWS[label] ?? DECK_TYPE_PREVIEWS['Category Analysis']!
}

function DeckTypePreview({ option }: { readonly option: HarnessQuestionOption | undefined }): React.JSX.Element {
  const preview = deckTypePreviewFor(option)
  return <aside data-paimind-deck-type-preview aria-live="polite">
    <small>Application preview</small>
    <h3>{preview.title}</h3>
    <p>{preview.description}</p>
    <div data-paimind-deck-type-application>
      <div><span>Application</span><strong>{preview.application}</strong></div>
      <div><span>Primary audience</span><strong>{preview.audience}</strong></div>
      <div><span>Core story</span><strong>{preview.structure}</strong></div>
    </div>
    <p data-paimind-deck-type-next>Visual style is selected in the next AI-requested step.</p>
  </aside>
}

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
  readonly image: string
  readonly imageAlt: string
  readonly tone: 'consulting' | 'paramont' | 'playful'
}

const DECK_PREVIEWS: Readonly<Record<string, DeckPreviewSpec>> = Object.freeze({
  'Strategy Consulting': Object.freeze({
    title: 'Strategy Consulting',
    bestFor: 'Board reviews and executive decisions',
    story: 'Answer first · Proof · Action',
    description: 'A disciplined white-space system with sharp analysis, cobalt charts and restrained red emphasis.',
    image: STRATEGY_CONSULTING_STORYBOARD,
    imageAlt: 'Strategy consulting storyboard with answer-first headlines and analytical charts',
    tone: 'consulting',
  }),
  'Paramont Signature': Object.freeze({
    title: 'Paramont Signature',
    bestFor: 'Paramont-owned client and leadership stories',
    story: 'Altitude · Opportunity · Decision',
    description: 'The official mountain identity translated into an ice-blue, midnight and white presentation system.',
    image: PARAMONT_SIGNATURE_STORYBOARD,
    imageAlt: 'Paramont Signature storyboard with official mountain identity and enterprise slides',
    tone: 'paramont',
  }),
  'Playful Storybook': Object.freeze({
    title: 'Playful Storybook',
    bestFor: 'Family, children and youth-facing concepts',
    story: 'World · Wonder · Possibility',
    description: 'A bright cut-paper illustration system with warm characters, rounded forms and joyful color.',
    image: PLAYFUL_STORYBOOK_STORYBOARD,
    imageAlt: 'Playful storybook storyboard with colorful cut-paper illustrations and children',
    tone: 'playful',
  }),
})

function deckPreviewFor(option: HarnessQuestionOption | undefined): DeckPreviewSpec {
  const label = option === undefined ? 'Paramont Signature' : optionPresentation(option.label).label
  return DECK_PREVIEWS[label] ?? DECK_PREVIEWS['Paramont Signature']!
}

function DeckPreview({ option }: { readonly option: HarnessQuestionOption | undefined }): React.JSX.Element {
  const preview = deckPreviewFor(option)
  return <aside data-paimind-deck-preview data-tone={preview.tone} aria-live="polite">
    <small>Deck style preview</small>
    <h3>{preview.title}</h3>
    <p>{preview.description}</p>
    <div data-paimind-storyboard-frame>
      <img data-paimind-storyboard src={preview.image} alt={preview.imageAlt} />
      <span data-paimind-storyboard-caption>3-slide style system</span>
    </div>
    <div data-paimind-preview-meta>
      <div><span>Best for</span><strong>{preview.bestFor}</strong></div>
      <div><span>Story rhythm</span><strong>{preview.story}</strong></div>
    </div>
    <p data-paimind-preview-hint>Preview by hover or focus. Select a style, then use it to finish the intake.</p>
  </aside>
}

const PROPOSAL_STEPS = Object.freeze([
  { id: PROPOSAL_QUESTION_IDS.customer, label: 'Customer', stage: 'customer' },
  { id: PROPOSAL_QUESTION_IDS.department, label: 'Department', stage: 'department' },
  { id: PROPOSAL_QUESTION_IDS.deckType, label: 'Deck type', stage: 'deck-type' },
  { id: PROPOSAL_QUESTION_IDS.deckStyle, label: 'Deck style', stage: 'deck-style' },
] as const)

const PROPOSAL_CANCEL_INTENT = 'PAIMIND_PROPOSAL_NAVIGATION:CANCEL'

function ProposalSpeaker(): React.JSX.Element {
  return <div data-paimind-proposal-speaker>
    <span data-paimind-proposal-avatar-seat data-paimind-agent-avatar-seat="" data-paimind-agent-id="proposal-assistant" aria-hidden="true">
      <span data-paimind-proposal-avatar-fallback>PA</span>
    </span>
    <span><strong>Proposal Assistant</strong><small>AI-requested decision · your answer returns to the agent</small></span>
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
  const label = optionPresentation(option.label).label
  const department = departmentOptionPresentation(label)
  return option.description ?? OPTION_DETAILS[department === null ? label : `${department.code} · ${department.name}`]
}

function ProgressRail(props: { readonly current: number }): React.JSX.Element {
  return <ol data-paimind-proposal-progress aria-label="Proposal setup progress">
    {PROPOSAL_STEPS.map((step, index) => <li
      key={step.id}
      data-step={index + 1}
      data-state={index < props.current ? 'complete' : index === props.current ? 'current' : 'upcoming'}
      aria-current={index === props.current ? 'step' : undefined}
    >{step.label}</li>)}
  </ol>
}

interface ProposalQuestionComposerProps {
  readonly matched: HarnessQuestionWait
}

function ProposalQuestionCard(props: ProposalQuestionComposerProps): React.JSX.Element {
  const { matched } = props
  const question = matched.payload.questions[0]!
  const options = question.options ?? []
  const [selected, setSelected] = useState<readonly string[]>([])
  const [custom, setCustom] = useState('')
  const [focused, setFocused] = useState(() => options.find(option => optionPresentation(option.label).recommended)?.label ?? options[0]?.label ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const step = questionStep(question)
  const stage = stageKey(question)
  const previousStep = step > 0 ? PROPOSAL_STEPS[step - 1] : undefined
  const hasDeckTypePreview = question.id === PROPOSAL_QUESTION_IDS.deckType
  const hasDeckStylePreview = question.id === PROPOSAL_QUESTION_IDS.deckStyle
  const hasPreview = hasDeckTypePreview || hasDeckStylePreview
  const focusedOption = useMemo(() => options.find(option => option.label === focused) ?? options[0], [focused, options])

  const answer = async (labels: readonly string[], customAnswer = '', action = 'Sending your answer to Proposal Assistant…'): Promise<void> => {
    setBusy(true); setError(null); setPendingAction(action)
    try {
      await answerHarnessQuestion(matched, [{
        id: question.id,
        selected: customAnswer === '' || question.multiSelect === true ? labels : [],
        ...(customAnswer === '' ? {} : { custom: customAnswer }),
      }])
    } catch (cause) {
      setBusy(false)
      setPendingAction(null)
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
    if (busy) return
    void answer([], PROPOSAL_CANCEL_INTENT, 'Proposal Assistant is pausing this intake…')
  }

  const navigateBack = (): void => {
    if (previousStep === undefined || busy) return
    void answer([], `PAIMIND_PROPOSAL_NAVIGATION:BACK:${previousStep.id}`, `Proposal Assistant is returning to ${previousStep.label}…`)
  }

  const actionLabel = hasDeckStylePreview ? 'Use this deck style' : hasDeckTypePreview ? 'Use this deck type' : 'Continue'
  const actionStatus = hasDeckStylePreview
    ? selected.length === 0 ? 'Preview and select one style' : `${optionPresentation(selected[0]!).label} selected`
    : hasDeckTypePreview
      ? selected.length === 0 ? 'Preview and select one deck type' : `${optionPresentation(selected[0]!).label} selected`
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
        <ProgressRail current={step} />
      </header>
      <div data-paimind-proposal-body data-preview={hasPreview}>
        <div data-paimind-proposal-options data-stage={stage} role={question.multiSelect === true ? 'group' : 'radiogroup'}>
          {options.map((option, index) => {
            const active = selected.includes(option.label)
            const display = optionPresentation(option.label)
            const logo = stage === 'customer' ? brandLogo(option.label) : null
            const department = stage === 'department' ? departmentOptionPresentation(display.label) : null
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
              {logo ?? (department !== null
                ? <span data-paimind-department-avatar data-selected={active} aria-hidden="true">
                    <img src={department.avatar} alt="" />
                    {active ? <span data-paimind-department-check><PaimindCheckIcon /></span> : null}
                  </span>
                : hasDeckStylePreview
                ? <span data-paimind-deck-style-thumb-shell aria-hidden="true">
                    <img data-paimind-deck-style-thumb src={deckPreviewFor(option).image} alt="" />
                    {active ? <span data-paimind-deck-style-check><PaimindCheckIcon /></span> : null}
                  </span>
                : <span data-paimind-proposal-indicator aria-hidden="true">{active ? <PaimindCheckIcon /> : index + 1}</span>)}
              <span data-paimind-proposal-option-copy>
                <span data-paimind-proposal-option-line><strong>{department?.name ?? display.label}</strong>{department === null ? null : <span data-paimind-department-meta>DG {department.code}</span>}{display.recommended ? <em data-paimind-proposal-recommended>Recommended</em> : null}</span>
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
            <div data-paimind-proposal-action-leading>
              {previousStep === undefined ? null : <button type="button" data-paimind-proposal-back data-navigation="ai-request" disabled={busy} onClick={navigateBack}>Back to {previousStep.label}</button>}
              <span aria-live="polite">{pendingAction ?? actionStatus}</span>
            </div>
            <button type="button" data-paimind-proposal-submit disabled={busy || (selected.length === 0 && custom.trim() === '')} onClick={() => { void answer(selected, custom.trim()) }}>{actionLabel}</button>
          </div>
          {error === null ? null : <p data-paimind-proposal-error role="status">{error}</p>}
        </div>
        {hasDeckTypePreview ? <DeckTypePreview option={focusedOption} /> : hasDeckStylePreview ? <DeckPreview option={focusedOption} /> : null}
      </div>
      <footer data-paimind-proposal-utility><button type="button" aria-label="Cancel proposal question" disabled={busy} onClick={cancel}>Cancel intake</button></footer>
    </section>

  return <div data-paimind-proposal-frame data-question-key={matched.key}>
    <div data-paimind-proposal-thread data-mode="ai-tool-question" data-trigger="ask-user-question"><ProposalSpeaker />{card}</div>
  </div>
}

export function ProposalQuestionComposer({ matched }: { readonly matched: HarnessQuestionWait }): React.JSX.Element {
  return <ProposalQuestionCard matched={matched} />
}

export function apply(ctx: PaimindClientContext): void {
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
}
