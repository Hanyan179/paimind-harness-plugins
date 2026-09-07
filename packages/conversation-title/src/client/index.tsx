import { PAIMIND_UI_FOUNDATION_CSS } from '@paimind/ui-foundation'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  markHarnessClientStyle,
  contributePaimindExtension,
  resolveHarnessSettingsNamespace,
  type PaimindClientContext,
  type PaimindSettingsScope,
  type PaimindSettingsScopeBinder,
} from '@paimind/harness-compat'
import {
  decodePaimindConversationTitleModelRoute,
  decodePaimindConversationTitleSettings,
  DEFAULT_PAIMIND_CONVERSATION_TITLE_SETTINGS,
  encodePaimindConversationTitleModelRoute,
  PAIMIND_CONVERSATION_TITLE_NAMESPACE,
  type PaimindConversationTitleSettings,
} from '../settings.js'

const PACKAGE_NAME = '@paimind/conversation-title'
const STYLE_ID = PACKAGE_NAME
const BASE_INJECT = ['slots', 'locale', 'connection', 'settingsScope'] as const
export const inject = [...BASE_INJECT]

interface ModelCatalogEntry {
  readonly id: string
  readonly name: string
}

interface ModelCatalogGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogEntry[]
}

interface ModelCatalogApi {
  llm: {
    models(request: object): Promise<{
      readonly result:
        | { readonly ok: true; readonly value: { readonly groups: readonly ModelCatalogGroup[] } }
        | { readonly ok: false; readonly error: { readonly message: string } }
    }>
  }
}

interface ConversationTitleClientContext extends PaimindClientContext {
  readonly settingsScope: PaimindSettingsScopeBinder
  get(name: 'connection'): { readonly api: ModelCatalogApi }
}

const STYLE = `
[data-paimind-model-services]{display:grid;align-content:start;gap:20px;min-height:0;padding:28px 30px;box-sizing:border-box;color:var(--dsw-alias-label-primary,#17223a);font:inherit}
[data-paimind-model-services] *{box-sizing:border-box}
[data-paimind-model-services] h2{margin:0;font-size:24px;line-height:32px;font-weight:600}
[data-paimind-model-service-card]{overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.16));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-model-service-head]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14))}
[data-paimind-model-service-head] strong{display:block;font-size:15px;line-height:22px;font-weight:600}
[data-paimind-model-service-head] small{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary,#78849a);font-size:12px;line-height:17px}
[data-paimind-model-service-row]{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,420px);gap:24px;align-items:center;padding:18px 20px}
[data-paimind-model-service-row] label{display:grid;gap:3px;font-size:13px;line-height:20px;font-weight:600}
[data-paimind-model-service-row] label span{color:var(--dsw-alias-label-tertiary,#78849a);font-size:12px;line-height:16px;font-weight:400}
[data-paimind-model-service-row] select{width:100%;min-height:40px;padding:8px 34px 8px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.24));border-radius:11px;color:var(--dsw-alias-label-primary,#17223a);background:var(--dsw-alias-bg-layer-2,#fff);font:inherit;font-size:12px;outline:none}
[data-paimind-model-service-row] select:focus-visible{border-color:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 16%,transparent)}
[data-paimind-model-services-state]{padding:32px 12px;color:var(--dsw-alias-label-tertiary,#78849a);text-align:center}
[data-paimind-model-service-feedback]{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0;padding:12px 20px;font-size:12px;line-height:1.6}
@media(max-width:680px){[data-paimind-model-services]{min-height:100%;padding:18px}[data-paimind-model-service-row]{grid-template-columns:1fr;gap:10px}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = STYLE_ID; markHarnessClientStyle(style, STYLE_ID)
  style.textContent = `${PAIMIND_UI_FOUNDATION_CSS}\n${STYLE}`
  document.head.append(style)
  return () => { style.remove() }
}

export function ConversationTitleModelService(props: {
  readonly scope: PaimindSettingsScope<PaimindConversationTitleSettings>
  readonly api: ModelCatalogApi
  readonly zh: boolean
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(props.scope.subscribe.bind(props.scope), props.scope.getSnapshot.bind(props.scope), props.scope.getSnapshot.bind(props.scope))
  const settings = snapshot.value ?? DEFAULT_PAIMIND_CONVERSATION_TITLE_SETTINGS
  const [groups, setGroups] = useState<readonly ModelCatalogGroup[]>([])
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const writing = useRef(false)
  const [saveError, setSaveError] = useState(false)
  const [catalogRevision, setCatalogRevision] = useState(0)

  useEffect(() => {
    let active = true
    setCatalogStatus('loading')
    void props.api.llm.models({}).then(response => {
      if (!active) return
      if (!response.result.ok) {
        setCatalogStatus('error')
        return
      }
      setGroups(response.result.value.groups)
      setCatalogStatus('ready')
    }, () => { if (active) setCatalogStatus('error') })
    return () => { active = false }
  }, [props.api, catalogRevision])

  const route = decodePaimindConversationTitleModelRoute(settings.modelRoute)
  const choices = useMemo(() => groups.flatMap(group => group.models.map(model => ({
    value: encodePaimindConversationTitleModelRoute({ provider: group.id, model: model.id }),
    label: `${model.name} · ${group.name}`,
  }))), [groups])
  const selectedKnown = settings.modelRoute === '' || choices.some(choice => choice.value === settings.modelRoute)
  const writable = snapshot.status === 'ready' && snapshot.writable && !busy

  const setField = async (field: keyof PaimindConversationTitleSettings, value: unknown): Promise<void> => {
    if (!writable || writing.current) return
    writing.current = true
    setBusy(true)
    setSaveError(false)
    try { await props.scope.set(field, value) } catch { setSaveError(true) } finally { writing.current = false; setBusy(false) }
  }

  if (snapshot.status === 'loading') return <div data-paimind-model-services-state aria-busy="true">{props.zh ? '正在读取设置…' : 'Reading settings…'}</div>
  if (snapshot.status === 'unavailable') return <div data-paimind-model-services-state role="status">{props.zh ? '对话命名设置暂不可用，请稍后重新打开此页' : 'Conversation naming settings are unavailable. Reopen this page to retry.'}</div>

  return <section data-paimind-ui-scope="conversation-title" data-paimind-model-services aria-label={props.zh ? '对话命名' : 'Conversation naming'}>
    <h2>{props.zh ? '对话命名' : 'Conversation naming'}</h2>
    <article data-paimind-model-service-card>
      <header data-paimind-model-service-head>
        <span><strong>{props.zh ? '对话自动命名' : 'Conversation auto-naming'}</strong><small>{props.zh ? '根据第一条消息自动生成标题，方便查找对话' : 'Generate a title from the first message to make conversations easier to find'}</small></span>
        <button type="button" role="switch" data-paimind-ui-switch data-paimind-model-service-switch aria-label={props.zh ? '启用对话自动命名' : 'Enable conversation auto-naming'} aria-checked={settings.enabled} aria-disabled={!writable} onClick={() => { void setField('enabled', !settings.enabled) }} />
      </header>
      <div data-paimind-model-service-row>
        <label>{props.zh ? '模型' : 'Model'}<span>{props.zh ? '仅用于生成对话标题' : 'Used only for conversation titles'}</span></label>
        <select aria-label={props.zh ? '对话自动命名模型' : 'Conversation auto-naming model'} value={settings.modelRoute} disabled={!writable || !settings.enabled} onChange={event => { void setField('modelRoute', event.currentTarget.value) }}>
          <option value="">{props.zh ? '跟随当前对话模型' : 'Follow the current conversation model'}</option>
          {!selectedKnown && route !== undefined ? <option value={settings.modelRoute}>{`${route.model} · ${route.provider}`}</option> : null}
          {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </div>
      {catalogStatus === 'loading' ? <p data-paimind-model-service-feedback role="status">{props.zh ? '正在加载可选模型…' : 'Loading available models…'}</p> : null}
      {catalogStatus === 'error' ? <div data-paimind-model-service-feedback role="alert"><span>{props.zh ? '模型列表加载失败，已保存的选择保持不变。' : 'Could not load models. Your saved selection is unchanged.'}</span><button type="button" data-paimind-ui-button onClick={() => { setCatalogRevision(value => value + 1) }}>{props.zh ? '重新加载模型' : 'Reload models'}</button></div> : null}
      {saveError ? <p data-paimind-model-service-feedback data-paimind-ui-state="error" role="alert">{props.zh ? '保存失败，设置尚未更改。请重新操作以重试。' : 'Could not save. Settings are unchanged. Try your change again.'}</p> : null}
      {busy ? <p data-paimind-model-service-feedback role="status">{props.zh ? '正在保存…' : 'Saving…'}</p> : null}
      {!snapshot.writable ? <p data-paimind-model-service-feedback role="status">{props.zh ? '当前设置为只读。' : 'These settings are read-only.'}</p> : null}
    </article>
  </section>
}

export function apply(ctx: ConversationTitleClientContext): void {
  const scope = ctx.settingsScope.bind<PaimindConversationTitleSettings>({
    namespace: resolveHarnessSettingsNamespace(PAIMIND_CONVERSATION_TITLE_NAMESPACE),
    decode: decodePaimindConversationTitleSettings,
  })
  const api = ctx.get('connection').api
  ctx.effect(installStyle, 'paimind-conversation-title: style')
  contributePaimindExtension(ctx.slots, {
    id: 'paimind:conversation-title', packageName: PACKAGE_NAME, category: 'experience',
    nameZh: '对话自动命名', nameEn: 'Conversation Auto-naming',
    descriptionZh: '以首条有效消息生成并保存对话标题。',
    descriptionEn: 'Generates and persists a conversation title from the first eligible message.',
    surface: 'settings', maturity: 'available', order: -40,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'paimind-model-services', order: 12,
    label: () => ctx.locale.getLocale().active.startsWith('zh') ? '对话命名' : 'Conversation naming',
  }, () => <ConversationTitleModelService scope={scope} api={api} zh={ctx.locale.getLocale().active.startsWith('zh')} />))
}
