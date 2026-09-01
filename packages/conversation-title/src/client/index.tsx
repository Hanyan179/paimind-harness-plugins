import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
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
[data-paimind-model-services]{display:grid;align-content:start;gap:20px;min-height:720px;padding:28px 30px;box-sizing:border-box;color:var(--dsw-alias-label-primary,#17223a);font:inherit}
[data-paimind-model-services] *{box-sizing:border-box}
[data-paimind-model-services] h2{margin:0;font-size:24px;line-height:32px;font-weight:600}
[data-paimind-model-service-card]{overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.16));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-paimind-model-service-head]{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 20px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(110,128,154,.14))}
[data-paimind-model-service-head] strong{display:block;font-size:15px;line-height:22px;font-weight:600}
[data-paimind-model-service-head] small{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary,#78849a);font-size:11px;line-height:17px}
[data-paimind-model-service-row]{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,420px);gap:24px;align-items:center;padding:18px 20px}
[data-paimind-model-service-row] label{display:grid;gap:3px;font-size:13px;line-height:20px;font-weight:600}
[data-paimind-model-service-row] label span{color:var(--dsw-alias-label-tertiary,#78849a);font-size:10px;line-height:16px;font-weight:400}
[data-paimind-model-service-row] select{width:100%;min-height:40px;padding:8px 34px 8px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(110,128,154,.24));border-radius:11px;color:var(--dsw-alias-label-primary,#17223a);background:var(--dsw-alias-bg-layer-2,#fff);font:inherit;font-size:12px;outline:none}
[data-paimind-model-service-row] select:focus-visible{border-color:var(--dsw-alias-state-business-primary,#3471f5);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3471f5) 16%,transparent)}
[data-paimind-model-service-switch]{position:relative;width:42px;height:24px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-fill-tertiary,rgba(128,128,128,.28));cursor:pointer;transition:background .16s ease}
[data-paimind-model-service-switch]::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .16s ease}
[data-paimind-model-service-switch][aria-checked='true']{background:var(--dsw-alias-state-business-primary,#3471f5)}
[data-paimind-model-service-switch][aria-checked='true']::after{transform:translateX(18px)}
[data-paimind-model-service-switch]:disabled,[data-paimind-model-service-row] select:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-model-services-state]{padding:32px 12px;color:var(--dsw-alias-label-tertiary,#78849a);text-align:center}
@media(max-width:680px){[data-paimind-model-services]{min-height:100%;padding:18px}[data-paimind-model-service-row]{grid-template-columns:1fr;gap:10px}}
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
  }, [props.api])

  const route = decodePaimindConversationTitleModelRoute(settings.modelRoute)
  const choices = useMemo(() => groups.flatMap(group => group.models.map(model => ({
    value: encodePaimindConversationTitleModelRoute({ provider: group.id, model: model.id }),
    label: `${model.name} · ${group.name}`,
  }))), [groups])
  const selectedKnown = settings.modelRoute === '' || choices.some(choice => choice.value === settings.modelRoute)
  const writable = snapshot.status === 'ready' && snapshot.writable && !busy

  const setField = async (field: keyof PaimindConversationTitleSettings, value: unknown): Promise<void> => {
    if (!writable) return
    setBusy(true)
    try { await props.scope.set(field, value) } finally { setBusy(false) }
  }

  if (snapshot.status === 'loading') return <div data-paimind-model-services-state aria-busy="true">{props.zh ? '正在读取设置…' : 'Reading settings…'}</div>
  if (snapshot.status === 'unavailable') return <div data-paimind-model-services-state role="status">{props.zh ? '模型服务设置当前不可用' : 'Model service settings are unavailable'}</div>

  return <section data-paimind-model-services aria-label={props.zh ? '模型服务' : 'Model services'}>
    <h2>{props.zh ? '模型服务' : 'Model services'}</h2>
    <article data-paimind-model-service-card>
      <header data-paimind-model-service-head>
        <span><strong>{props.zh ? '对话自动命名' : 'Conversation auto-naming'}</strong><small>{props.zh ? '首条有效消息生成简洁标题' : 'Generate a concise title from the first eligible message'}</small></span>
        <button type="button" role="switch" data-paimind-model-service-switch aria-label={props.zh ? '启用对话自动命名' : 'Enable conversation auto-naming'} aria-checked={settings.enabled} disabled={!writable} onClick={() => { void setField('enabled', !settings.enabled) }} />
      </header>
      <div data-paimind-model-service-row>
        <label>{props.zh ? '模型' : 'Model'}<span>{props.zh ? '仅用于生成对话标题' : 'Used only for conversation titles'}</span></label>
        <select aria-label={props.zh ? '对话自动命名模型' : 'Conversation auto-naming model'} value={settings.modelRoute} disabled={!writable || !settings.enabled} onChange={event => { void setField('modelRoute', event.currentTarget.value) }}>
          <option value="">{props.zh ? '跟随当前对话模型' : 'Follow the current conversation model'}</option>
          {!selectedKnown && route !== undefined ? <option value={settings.modelRoute}>{`${route.model} · ${route.provider}`}</option> : null}
          {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </div>
      {catalogStatus === 'error' ? <span hidden>{props.zh ? '模型列表暂不可用' : 'Model catalog unavailable'}</span> : null}
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
    label: () => ctx.locale.getLocale().active.startsWith('zh') ? '模型服务' : 'Model services',
  }, () => <ConversationTitleModelService scope={scope} api={api} zh={ctx.locale.getLocale().active.startsWith('zh')} />))
}
