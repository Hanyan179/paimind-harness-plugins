import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  observeHarnessColorScheme, readHarnessColorScheme, installHarnessBrandAppearance, markHarnessClientStyle, contributePaimindExtension, installHarnessDocumentBranding, locateHarnessBrandSeats,
  resolveHarnessSettingsNamespace,
  type HarnessBrandSeats, type HarnessHeroBrandSeat, type PaimindClientContext,
  type PaimindSettingsScope, type PaimindSettingsScopeBinder,
} from '@hansen/harness-compat'
import {
  BRANDING_NAMESPACE, DEFAULT_BRANDING, MAX_LOGO_LENGTH,
  brandFallbackIcon, brandInitials, decodeBrandingSettings, isBrandImageUrl,
  type BrandingSettings,
} from '../settings.js'

export const inject = ['slots', 'locale', 'settingsScope']
const STYLE_ID = '@hansen/branding'
const EMPTY_SEATS: HarnessBrandSeats = Object.freeze({ wordmark: null, compact: null, hero: null })
type Scope = PaimindSettingsScope<BrandingSettings>
interface BrandingContext extends PaimindClientContext { readonly settingsScope: PaimindSettingsScopeBinder }
interface BrandProps { readonly scope: Scope }
const STYLE = `
[data-hansen-brand-nav]{display:flex;gap:4px;padding:4px;margin:0 0 24px;background:var(--dsw-alias-bg-l2,rgba(100,125,150,.08));border-radius:12px;flex-wrap:wrap}
[data-hansen-brand-nav] button{flex:1;white-space:nowrap;border:0!important;background:transparent!important;padding:11px 14px!important;color:inherit}
[data-hansen-brand-nav] button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1,#fff)!important;box-shadow:0 1px 5px #00000012;font-weight:650}
[data-hansen-brand-panel]{padding:24px;border:1px solid var(--dsw-alias-border-l1,#dfe4eb);border-radius:16px;background:var(--dsw-alias-bg-layer-1,transparent)}
[data-hansen-brand-panel] h3{font-size:18px;margin:0 0 8px}
[data-hansen-brand-grid=languages]{display:grid;grid-template-columns:1fr 1fr;gap:24px}
[data-hansen-brand-advanced]{border-top:1px solid var(--dsw-alias-border-l1,#dfe4eb);margin-top:12px;padding-top:18px}
[data-hansen-brand-advanced] summary{cursor:pointer;font-size:13px;font-weight:600}
@media(max-width:760px){[data-hansen-brand-grid=languages]{grid-template-columns:1fr;gap:0}[data-hansen-brand-panel]{padding:16px}[data-hansen-brand-nav] button{flex-basis:40%}}

[data-paimind-native-hero-brand]{display:none!important}
[data-hansen-brand-name]{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 17px/24px ui-sans-serif,system-ui,sans-serif}
[data-hansen-brand-mark]{display:inline-flex;flex:none;align-items:center;justify-content:center;overflow:hidden;border-radius:22%;vertical-align:middle}
[data-hansen-brand-mark] img{width:100%;height:100%;object-fit:contain}
[data-hansen-brand-initials]{display:flex;width:100%;height:100%;align-items:center;justify-content:center;background:var(--dsw-alias-bg-l2,rgba(100,125,150,.14));font:600 .44em/1 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;color:inherit}
[data-hansen-brand-hero-mark]{display:inline-flex;order:-2}
[data-hansen-brand-hero-headline]{order:-1;max-width:760px;font-size:38px;font-weight:660;line-height:1.18;letter-spacing:-.035em;text-align:center;text-wrap:balance}
@media(max-width:900px){[data-hansen-brand-hero-headline]{font-size:32px}}
@media(max-width:600px){[data-hansen-brand-hero-headline]{font-size:27px}}
[data-hansen-brand-settings]{padding:24px;max-width:1040px;width:100%;box-sizing:border-box;color:var(--dsw-alias-text-primary,inherit)}
[data-hansen-brand-settings] h2{font-size:22px;margin:0 0 8px}
[data-hansen-brand-settings] p{font-size:13px;line-height:1.65;opacity:.75;margin:6px 0 20px}
[data-hansen-brand-preview]{display:flex;gap:14px;align-items:center;padding:18px;border:1px solid var(--dsw-alias-border-l1,rgba(120,130,150,.25));border-radius:14px;margin-bottom:24px;min-width:0}
[data-hansen-brand-preview]>div{min-width:0;overflow-wrap:anywhere}
[data-hansen-brand-field]{display:block;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(120,130,150,.2))}
[data-hansen-brand-field] label{display:block;font-size:14px;font-weight:600;margin-bottom:8px}
[data-hansen-brand-field] input[type=text]{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l1,rgba(120,130,150,.3));border-radius:8px;background:var(--dsw-alias-bg-l1,transparent);color:inherit;padding:10px 12px;font:inherit;font-size:13px}
[data-hansen-brand-actions]{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;font-size:12px}
[data-hansen-brand-settings] button{border:1px solid var(--dsw-alias-border-l1,rgba(120,130,150,.3));border-radius:8px;padding:7px 12px;background:var(--dsw-alias-bg-l2,transparent);color:inherit;font:inherit;cursor:pointer}
[data-hansen-brand-settings] button:disabled{opacity:.45;cursor:default}
[data-hansen-brand-settings] input:focus-visible,[data-hansen-brand-settings] button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#447cbb);outline-offset:2px}
[data-hansen-brand-settings] input[type=file]{max-width:100%;font-size:12px}
[data-hansen-brand-settings] [role=alert]{color:var(--dsw-alias-status-error,#c44545);font-size:13px;margin-top:8px}
@media(max-width:600px){[data-hansen-brand-settings]{padding:16px}}
`

function useSnapshot(scope: Scope) {
  return useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
}
function useBrand(scope: Scope): BrandingSettings { const value = useSnapshot(scope).value ?? DEFAULT_BRANDING; return value.brandName ? value : { ...value, brandName: DEFAULT_BRANDING.brandName } }
function useChinese(locale: PaimindClientContext['locale']): boolean {
  return useSyncExternalStore(locale.subscribe.bind(locale), () => locale.getLocale().active.startsWith('zh'))
}
function useDark(): boolean {
  const [dark, setDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
    const refresh = () => {
      const themed = readHarnessColorScheme(document)
      setDark(themed === undefined ? (media?.matches ?? false) : themed === 'dark')
    }
    refresh()
    const disposeTheme = observeHarnessColorScheme(document, refresh)
    media?.addEventListener('change', refresh)
    return () => { disposeTheme(); media?.removeEventListener('change', refresh) }
  }, [])
  return dark
}

function BrandMark({ brand, size = 24, className }: {
  readonly brand: BrandingSettings; readonly size?: number; readonly className?: string
}): JSX.Element {
  const dark = useDark()
  const source = (dark && brand.darkLogoUrl) || brand.logoUrl
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return <span data-hansen-brand-mark className={className} aria-label={brand.brandName} style={{ width: size, height: size, fontSize: size }}>
    {source && source !== failedSource
      ? <img src={source} alt="" referrerPolicy="no-referrer" onError={() => { setFailedSource(source) }} />
      : <span data-hansen-brand-initials aria-hidden="true">{brandInitials(brand.brandName)}</span>}
  </span>
}

function useHarnessBrandSeats(): HarnessBrandSeats {
  const [seats, setSeats] = useState<HarnessBrandSeats>(EMPTY_SEATS)
  useEffect(() => {
    const refresh = (): void => {
      const next = locateHarnessBrandSeats(document)
      setSeats(current => current.hero?.host === next.hero?.host
        && current.hero?.nativeIcon === next.hero?.nativeIcon
        && current.hero?.nativeHeadline === next.hero?.nativeHeadline
        && current.hero?.nativePreview === next.hero?.nativePreview
        && current.hero?.locale === next.hero?.locale ? current : next)
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])
  return seats
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

export function BrandingPortal({ scope }: BrandProps): JSX.Element | null {
  const brand = useBrand(scope)
  const dark = useDark()
  useEffect(() => installHarnessBrandAppearance(document, {
    background: (dark && brand.darkBackgroundUrl) || brand.backgroundUrl,
    primaryColor: (dark && brand.darkPrimaryColor) || brand.primaryColor,
  }), [brand.backgroundUrl, brand.darkBackgroundUrl, brand.primaryColor, brand.darkPrimaryColor, dark])
  const seats = useHarnessBrandSeats()
  useHeroSeatMarker(seats.hero)
  useEffect(() => installHarnessDocumentBranding(document, {
    productName: brand.browserTitle || brand.brandName,
    faviconHref: brand.faviconUrl || brand.logoUrl || brandFallbackIcon(brand.brandName),
    manifestHref: `data:application/manifest+json,${encodeURIComponent(JSON.stringify({
      name: brand.brandName, short_name: brand.appShortName || brand.brandName, icons: [{ src: new URL(brand.faviconUrl || brand.logoUrl || brandFallbackIcon(brand.brandName), document.baseURI).href, sizes: 'any', purpose: 'any' }], display: 'standalone', start_url: new URL('/', document.baseURI).href,
    }))}`,
  }), [brand.brandName, brand.browserTitle, brand.appShortName, brand.faviconUrl, brand.logoUrl])
  if (seats.hero === null) return null
  return createPortal(<>
    <span data-hansen-brand-hero-mark aria-hidden="true"><BrandMark brand={brand} size={40} /></span>
    <span data-hansen-brand-hero-headline hidden={!(seats.hero.locale === 'zh' ? brand.welcomeZh : brand.welcomeEn)} role="heading" aria-level={1}>{seats.hero.locale === 'zh' ? brand.welcomeZh : brand.welcomeEn}</span>
  </>, seats.hero.host)
}

const LABELS: Record<keyof BrandingSettings, readonly [string, string]> = {
  browserTitle: ['浏览器标题（可选）', 'Browser title (optional)'],
  appShortName: ['安装后的应用简称（可选）', 'Installed app short name (optional)'],
  backgroundUrl: ['首页背景图（可选）', 'Home background (optional)'],
  darkBackgroundUrl: ['深色首页背景图（可选）', 'Dark home background (optional)'],
  primaryColor: ['品牌主色（可选）', 'Brand color (optional)'],
  darkPrimaryColor: ['深色品牌主色（可选）', 'Dark brand color (optional)'],
  brandName: ['品牌名称', 'Brand name'], logoUrl: ['品牌标志', 'Brand logo'],
  darkLogoUrl: ['深色模式标志（可选）', 'Dark-mode logo (optional)'],
  faviconUrl: ['浏览器图标（可选）', 'Browser icon (optional)'],
  welcomeZh: ['简体中文', 'Simplified Chinese'], welcomeEn: ['English（英文）', 'English'],
}
function BrandField({ field, scope, zh, saving, onSaving }: BrandProps & {
  readonly field: keyof BrandingSettings; readonly zh: boolean
  readonly saving: boolean; readonly onSaving: (saving: boolean) => void
}): JSX.Element {
  const snapshot = useSnapshot(scope)
  const saved = (snapshot.value ?? DEFAULT_BRANDING)[field]
  const [draft, setDraft] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { setDraft(saved) }, [saved])
  const image = field.endsWith('Url')
  const color = field.endsWith('Color')
  const uploaded = image && draft.startsWith('data:')
  const label = LABELS[field][zh ? 0 : 1]
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const save = async (next = draft): Promise<void> => {
    if (!writable || saving) return
    setError(''); setMessage('')
    const value = next.trim()
    if (value === saved) return
    if (((image && !isBrandImageUrl(value)) || (color && value !== '' && !/^#[0-9a-f]{6}$/iu.test(value)) || (!image && /[\u0000-\u001f\u007f]/u.test(value)))) {
      setError(zh ? (color ? '请输入六位颜色值，例如 #245B87，或留空使用默认颜色。' : image ? '请输入有效的图片地址，或上传图片。' : '请输入有效的品牌名称或欢迎语。') : 'Enter a valid name, message or image URL.'); return
    }
    setBusy(true); onSaving(true)
    try {
      await scope.set(field, value)
      // Native Settings recovers failed writes without rejecting the promise.
      // Read back the committed value before showing success.
      const committed = scope.getSnapshot()
      const expected = value
      if (committed.status !== 'ready' || committed.value?.[field] !== expected) {
        throw new Error(zh ? '未保存，请检查连接后重试。' : 'Not saved. Check the connection and retry.')
      }
      setDraft(committed.value[field])
      setMessage(zh ? '已保存' : 'Saved')
    } catch (cause) { setError(cause instanceof Error ? cause.message : (zh ? '保存失败，请重试。' : 'Save failed. Please retry.')) }
    finally { setBusy(false); onSaving(false) }
  }
  const flush = useRef<() => void>(() => {})
  flush.current = () => { void save() }
  useEffect(() => () => { flush.current() }, [])
  useEffect(() => {
    if (draft === saved || saving) return
    const timer = setTimeout(() => { flush.current() }, 500)
    return () => clearTimeout(timer)
  }, [draft, saved, saving])
  const upload = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    setError(''); setMessage('')
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(file.type) || file.size > 250_000) {
      setError(zh ? '请选择不超过 250 KB 的 PNG、JPEG、WebP、GIF 或 ICO 图片。' : 'Choose a PNG, JPEG, WebP, GIF or ICO image up to 250 KB.'); return
    }
    try {
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => { resolve(String(reader.result)) }
        reader.onerror = () => { reject(new Error(zh ? '无法读取图片。' : 'Cannot read image.')) }
        reader.readAsDataURL(file)
      })
      setDraft(source)
      await save(source)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <form data-hansen-brand-field onSubmit={event => { event.preventDefault(); void save() }}>
    <label htmlFor={`hansen-brand-${field}`}>{label}</label>
    <input id={`hansen-brand-${field}`} type="text" value={uploaded ? '' : draft} disabled={!writable || saving}
      maxLength={image ? MAX_LOGO_LENGTH : field === 'brandName' ? 80 : 160}
      placeholder={uploaded
        ? (zh ? '已选择上传的图片；输入地址可替换' : 'Uploaded image selected; enter a URL to replace')
        : image ? (zh ? '图片地址，或在下方上传图片' : 'Image URL, or upload below') : color ? '#245B87' : ''}
      onBlur={() => { void save() }}
      onChange={event => { setDraft(event.currentTarget.value); setError(''); setMessage('') }} />
    <div data-hansen-brand-actions>
      {color ? <input type="color" aria-label={zh ? `选择${label}` : `Choose ${label}`} value={/^#[0-9a-f]{6}$/iu.test(draft) ? draft : '#245B87'} disabled={!writable || saving} onBlur={() => { void save() }} onChange={event => { setDraft(event.currentTarget.value); setError(''); setMessage('') }} /> : null}
      {image ? <input type="file" aria-label={zh ? `上传${label}` : `Upload ${label}`} accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon" disabled={!writable || saving} onChange={event => { void upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /> : null}
      {uploaded ? <button type="button" onClick={() => { setDraft(''); void save('') }} disabled={!writable || saving}>{zh ? '移除图片' : 'Remove image'}</button> : null}
      <span role="status">{busy ? (zh ? '正在自动保存…' : 'Saving…') : message}</span>
    </div>
    {error ? <div role="alert">{error}</div> : null}
  </form>
}

export function BrandingSettingsSection({ scope, locale }: BrandProps & { readonly locale: PaimindClientContext['locale'] }): JSX.Element {
  const snapshot = useSnapshot(scope)
  const brand = snapshot.value ?? DEFAULT_BRANDING
  const zh = useChinese(locale)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState(0)
  return <section data-hansen-brand-settings>
    <h2>{zh ? '品牌设置' : 'Brand settings'}</h2>
    <p>{zh ? '编辑后自动保存，完成后直接关闭。留空名称使用默认品牌；留空标语隐藏，其他空项沿用默认外观。' : 'Customize your name, logo and welcome messages. Each saved change applies immediately and persists. Empty logos use initials; dark-mode and browser icons inherit the main logo.'}</p>
    <div data-hansen-brand-preview><BrandMark brand={brand} size={44} /><div><strong>{brand.brandName}</strong><div>{zh ? brand.welcomeZh : brand.welcomeEn}</div></div></div>
    {snapshot.status !== 'ready' || !snapshot.writable || snapshot.mode !== 'host' ? <p role="status">{snapshot.status === 'loading' ? (zh ? '正在加载品牌设置…' : 'Loading brand settings…') : (zh ? '品牌设置当前不可写，请检查主机连接。' : 'Brand settings are read-only. Check the host connection.')}</p> : null}
    <nav data-hansen-brand-nav aria-label={zh ? '品牌配置分类' : 'Brand categories'}>
      {(zh ? ['品牌标识', '首页表达', '浏览器与应用', '视觉风格'] : ['Identity', 'Home', 'Browser & app', 'Appearance']).map((label, index) => <button key={label} type="button" aria-pressed={category === index} onClick={() => setCategory(index)}>{label}</button>)}
    </nav>
    {([
      [zh ? '品牌标识' : 'Identity', zh ? '统一用于侧栏、首页与启动画面。上传一张标志即可覆盖常用场景。' : 'Shared across sidebar, home and startup.', ['brandName', 'logoUrl'], ['darkLogoUrl']],
      [zh ? '首页标语' : 'Home tagline', zh ? '用一句话传达产品价值。系统会按界面语言显示对应文案，留空则不显示。' : 'A concise statement of your product value, matched to the interface language.', ['welcomeZh', 'welcomeEn'], []],
      [zh ? '浏览器与应用' : 'Browser & app', zh ? '默认沿用品牌名称与标志。只有需要不同展示时，才填写独立配置。' : 'Inherits your brand identity unless you provide an override.', ['browserTitle', 'faviconUrl', 'appShortName'], []],
      [zh ? '视觉风格' : 'Appearance', zh ? '设置首页背景与操作强调色。未配置时沿用当前外观。' : 'Customize home artwork and accent colors.', ['backgroundUrl', 'primaryColor'], ['darkBackgroundUrl', 'darkPrimaryColor']],
    ] as const).map(([title, description, fields, advanced], index) => <div key={title} hidden={category !== index} data-hansen-brand-panel>
      <h3>{title}</h3><p>{description}</p>
      <div data-hansen-brand-grid={index === 1 ? 'languages' : undefined}>{fields.map(field => <BrandField key={field} field={field} scope={scope} zh={zh} saving={saving} onSaving={setSaving} />)}</div>
      {advanced.length ? <details data-hansen-brand-advanced><summary>{zh ? '深色模式 · 可选配置' : 'Dark mode · optional overrides'}</summary><p>{zh ? '留空时自动沿用上方配置。' : 'Empty fields inherit the settings above.'}</p>{advanced.map(field => <BrandField key={field} field={field} scope={scope} zh={zh} saving={saving} onSaving={setSaving} />)}</details> : null}
    </div>)}
  </section>
}
function installStyle(): () => void {
  const style = document.createElement('style')
  style.id = STYLE_ID
  markHarnessClientStyle(style, STYLE_ID)
  style.dataset.paimindPlugin = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}
export function apply(ctx: BrandingContext): void {
  const scope = ctx.settingsScope.bind<BrandingSettings>({ namespace: resolveHarnessSettingsNamespace(BRANDING_NAMESPACE), decode: decodeBrandingSettings })
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:branding', packageName: '@hansen/branding', category: 'experience',
    nameZh: '品牌设置', nameEn: 'Branding',
    descriptionZh: '自定义品牌名称、标志、浏览器图标与欢迎语。',
    descriptionEn: 'Customize the brand name, logo, browser icon and welcome messages.',
    surface: 'shell', maturity: 'available', order: -90,
  })
  ctx.effect(installStyle, 'hansen-branding: style')
  function Mark(props: { readonly size?: number; readonly className?: string }): JSX.Element {
    return <BrandMark brand={useBrand(scope)} {...props} />
  }
  function Name(): JSX.Element {
    const brand = useBrand(scope)
    return <span data-hansen-brand-name aria-label={brand.brandName} title={brand.brandName}>{brand.brandName}</span>
  }
  for (const name of ['sidebar.brand.mark', 'conversation.hero.brand.mark']) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, priority: -100 }, Mark))
  }
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, Name))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'paimind-branding', order: -100 }, () => <BrandingPortal scope={scope} />))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'hansen-branding', order: 18,
    label: () => ctx.locale.getLocale().active.startsWith('zh') ? '品牌设置' : 'Branding',
  }, () => <BrandingSettingsSection scope={scope} locale={ctx.locale} />))
}
