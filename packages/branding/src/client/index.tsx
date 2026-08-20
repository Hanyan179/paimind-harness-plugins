import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  contributePaimindExtension,
  installHarnessDocumentBranding,
  locateHarnessBrandSeats,
  type HarnessBrandSeat,
  type HarnessBrandSeats,
  type HarnessHeroBrandSeat,
  type PaimindClientContext,
} from '@paimind/harness-compat'

export const inject = ['slots']

const PRODUCT_NAME = 'Paramont Harness'
const STYLE_ID = '@paimind/branding'
const EMPTY_SEATS: HarnessBrandSeats = Object.freeze({ wordmark: null, compact: null, hero: null })
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="70 0 465 175"><style>path{fill:#082e54}@media(prefers-color-scheme:dark){path{fill:#f9f7f2}}</style><path fill-rule="evenodd" d="M302.1 0 89.4 174.4h425.4L302.1 0Zm38.1 116.7 91.9 31.7-130.4-104-130.4 104 91.1-31.4-22.4 30.2 51-28.3 10.7 36 10.7-35.7 50.4 28-22.6-30.5Z" clip-rule="evenodd"/></svg>`
const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`
const MANIFEST_HREF = `data:application/manifest+json,${encodeURIComponent(JSON.stringify({
  name: PRODUCT_NAME,
  short_name: 'Paramont',
  display: 'standalone',
  start_url: '/',
}))}`

const STYLE = `
[data-paimind-native-brand-art]{display:none!important}
[data-paimind-native-hero-brand]{display:none!important}
[data-paimind-brand-seat]{position:relative}
[data-paimind-paramont-brand]{box-sizing:border-box;display:inline-flex;align-items:center;pointer-events:none;color:inherit}
[data-paimind-paramont-brand='wordmark']{width:182px;height:24px;gap:7px;white-space:nowrap}
[data-paimind-paramont-brand='name']{flex:0 1 158px;min-width:0;max-width:100%;height:24px;gap:6px;overflow:visible;white-space:nowrap}
[data-paimind-paramont-brand='name'] [data-paimind-paramont-wordmark]{flex:1 1 103px;min-width:92px}
[data-paimind-paramont-brand='compact']{width:24px;height:24px;justify-content:center}
[data-paimind-paramont-mark]{display:block;flex:none;width:24px;height:24px;color:inherit}
[data-paimind-paramont-slot-mark]{display:inline-flex;align-items:center;justify-content:center;overflow:visible;color:inherit}
[data-paimind-paramont-slot-mark] [data-paimind-paramont-mark]{width:100%;height:100%}
[data-paimind-paramont-wordmark]{display:block;flex:none;width:103px;height:14px;color:inherit}
[data-paimind-paramont-harness]{flex:none;margin-left:-3px;font:500 9px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.12em;opacity:.62}
[data-paimind-paramont-hero-mark]{display:inline-flex;align-items:center;justify-content:center;order:-2;width:42px;height:34px;color:inherit}
[data-paimind-paramont-hero-mark] [data-paimind-paramont-mark]{width:42px;height:24px}
[data-paimind-paramont-hero-headline]{order:-1}
`

function ParamontMark(): JSX.Element {
  return <svg data-paimind-paramont-mark aria-hidden="true" viewBox="70 0 464.8 174.4" fill="none">
    <path fill="currentColor" fillRule="evenodd" d="M302.1 0 89.4 174.4h425.4L302.1 0Zm38.1 116.7 91.9 31.7-130.4-104-130.4 104 91.1-31.4-22.4 30.2 51-28.3 10.7 36 10.7-35.7 50.4 28-22.6-30.5Z" clipRule="evenodd" />
  </svg>
}

function ParamontOfficialWordmark(): JSX.Element {
  return <svg data-paimind-paramont-wordmark aria-hidden="true" viewBox="0 218.8 628 46.7" fill="currentColor" preserveAspectRatio="xMidYMid meet">
    <g transform="translate(-6 -165.7)">
      <path d="M55,398.5c-1.5-8.2-7.5-13.3-16.8-13.3H6v45.2h9.7V418.2H38.2C50.5,418.2,57,409.8,55,398.5ZM38.2,408.8H15.7V394.9H38.2c4.1,0,6.8,2.1,7.5,5.7S43.6,408.8,38.2,408.8Z" />
      <path d="M108.7,387.6c-1.1-1.8-2.5-3.1-4.7-3.1s-3.5,1.3-4.6,3.1L73.7,430.4h11L91,419.7h25.4l6.4,10.7h11.6ZM95.4,412.2l8.3-14,8.3,14Z" />
      <path d="M202.5,416.8c6.7-2.7,10.4-9.1,8.9-18s-7.5-13.6-16.7-13.6H161.8v45.2h9.7V418.1h19.7l11,12.3H216Zm+-7.8-7H171.5V394.9h23.2c4,0,6.6,2,7.3,5.8C202.9,406.1,200.3,409.8,194.7,409.8Z" />
      <path d="M274.7,387.6c-1.2-1.8-2.6-3.1-4.7-3.1s-3.6,1.3-4.7,3.1l-25.7,42.8h11l6.3-10.7h25.5l6.4,10.7h11.6Zm+-13.3,24.6,8.2-14,8.3,14Z" />
      <path d="M383.6,430.4l-7.1-28.6L364,427.4c-1,2.3-2.5,3.7-4.8,3.7s-3.9-1.4-5-3.7l-11.7-25.6-7.6,28.6h-9.5l11.1-41.9c.6-2.6,2.2-3.9,4.7-3.9a5.6,5.6,0,0,1,4.9,3.2l13.1,28.8,13.7-28.8a5.1,5.1,0,0,1,4.6-3.2c2.4,0,3.9,1.3,4.7,3.9l11,41.9Z" />
      <path d="M439.5,430.4c-11.4,0-20.2-8.3-22.1-19.3-2.7-15.2,7.5-25.9,22-25.9h11.2c11.8,0,20.4,7.4,22.3,18.4,2.7,14.9-7.6,26.8-22.2,26.8Zm+11.2-9.7c8.4,0,14.1-6.5,12.6-15.1a12.5,12.5,0,0,0-12.6-10.7H439.5c-8.3,0-14.1,6.5-12.6,15a12.6,12.6,0,0,0,12.6,10.8Z" />
      <path d="M520.3,399.4v31h-9.3V390.3c0-3.5,1.8-5.7,4.8-5.7a5.1,5.1,0,0,1,4,1.8l29.4,29.3v-31h9.3v40.6c0,3.6-2.1,5.8-4.9,5.8a5.4,5.4,0,0,1-4-1.9Z" />
      <path d="M607.6,430.4V394.9H591v-9.7h43v9.7H617.4v35.5Z" />
    </g>
  </svg>
}

function ParamontWordmark(): JSX.Element {
  return <span data-paimind-paramont-brand="wordmark" aria-label={PRODUCT_NAME}>
    <ParamontMark />
    <ParamontOfficialWordmark />
    <span data-paimind-paramont-harness>HARNESS</span>
  </span>
}

function ParamontSidebarName(): JSX.Element {
  return <span data-paimind-paramont-brand="name" aria-label={PRODUCT_NAME}>
    <ParamontOfficialWordmark />
    <span data-paimind-paramont-harness>HARNESS</span>
  </span>
}

function ParamontBrandMark({ size = 24, className }: { readonly size?: number; readonly className?: string }): JSX.Element {
  return <span
    data-paimind-paramont-slot-mark
    className={className}
    aria-label={PRODUCT_NAME}
    style={{ width: size, height: size }}
  ><ParamontMark /></span>
}

function ParamontCompactMark(): JSX.Element {
  return <span data-paimind-paramont-brand="compact" aria-label={PRODUCT_NAME}><ParamontMark /></span>
}

function ParamontHero({ locale }: { readonly locale: HarnessHeroBrandSeat['locale'] }): JSX.Element {
  const headline = locale === 'zh' ? '共攀高山之巅' : 'Reach New Heights'
  return <>
    <span data-paimind-paramont-hero-mark aria-hidden="true"><ParamontMark /></span>
    <span data-paimind-paramont-hero-headline>{headline}</span>
  </>
}

function sameSeat(left: HarnessBrandSeat | null, right: HarnessBrandSeat | null): boolean {
  return left?.host === right?.host && left?.nativeArt === right?.nativeArt
}

function sameSeats(left: HarnessBrandSeats, right: HarnessBrandSeats): boolean {
  return left.hero?.host === right.hero?.host
    && left.hero?.nativeIcon === right.hero?.nativeIcon
    && left.hero?.nativeHeadline === right.hero?.nativeHeadline
    && left.hero?.nativePreview === right.hero?.nativePreview
    && left.hero?.locale === right.hero?.locale
}

function useHarnessBrandSeats(): HarnessBrandSeats {
  const [seats, setSeats] = useState<HarnessBrandSeats>(EMPTY_SEATS)
  useEffect(() => {
    const refresh = (): void => {
      const next = locateHarnessBrandSeats(document)
      setSeats(current => sameSeats(current, next) ? current : next)
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])
  return seats
}

function useSeatMarker(seat: HarnessBrandSeat | null, kind: 'wordmark' | 'compact'): void {
  useEffect(() => {
    if (seat === null) return
    seat.host.dataset.paimindBrandSeat = kind
    seat.nativeArt.dataset.paimindNativeBrandArt = kind
    return () => {
      delete seat.host.dataset.paimindBrandSeat
      delete seat.nativeArt.dataset.paimindNativeBrandArt
    }
  }, [seat, kind])
}

function useHeroSeatMarker(seat: HarnessHeroBrandSeat | null): void {
  useEffect(() => {
    if (seat === null) return
    seat.host.dataset.paimindHeroBrandSeat = 'hero'
    seat.nativeIcon.dataset.paimindNativeHeroBrand = 'icon'
    seat.nativeHeadline.dataset.paimindNativeHeroBrand = 'headline'
    seat.nativePreview.dataset.paimindNativeHeroPreview = 'preview'
    return () => {
      delete seat.host.dataset.paimindHeroBrandSeat
      delete seat.nativeIcon.dataset.paimindNativeHeroBrand
      delete seat.nativeHeadline.dataset.paimindNativeHeroBrand
      delete seat.nativePreview.dataset.paimindNativeHeroPreview
    }
  }, [seat])
}

export function BrandingPortal(): JSX.Element | null {
  const seats = useHarnessBrandSeats()
  useHeroSeatMarker(seats.hero)
  if (seats.hero === null) return null
  return <>
    {seats.hero === null ? null : createPortal(<ParamontHero locale={seats.hero.locale} />, seats.hero.host)}
  </>
}

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

export function apply(ctx: PaimindClientContext): void {
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:branding',
    packageName: '@paimind/branding',
    category: 'experience',
    nameZh: 'Paramont 品牌',
    nameEn: 'Paramont Branding',
    descriptionZh: '统一 Paramont Harness 名称与标识，不修改 Harness 原生主题。',
    descriptionEn: 'Applies Paramont Harness identity without changing the native Harness theme.',
    surface: 'shell',
    maturity: 'available',
    order: -90,
  })
  ctx.effect(installStyle, 'paimind-branding: style')
  ctx.effect(() => installHarnessDocumentBranding(document, {
    productName: PRODUCT_NAME,
    faviconHref: FAVICON_HREF,
    manifestHref: MANIFEST_HREF,
  }), 'paimind-branding: document identity')
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
    priority: -100,
  }, ParamontBrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -100,
  }, ParamontSidebarName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    priority: -100,
  }, ParamontBrandMark))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'paimind-branding',
    order: -100,
  }, BrandingPortal))
}
