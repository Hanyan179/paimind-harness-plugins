import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type PaimindClientContext,
  type PaimindSettingsScope,
  type PaimindSettingsScopeSnapshot,
} from '@paimind/harness-compat'
import {
  DEFAULT_PAIMIND_USER_PREFERENCES,
  PAIMIND_CITATION_POLICIES,
  PAIMIND_MOTION_POLICIES,
  PAIMIND_NOTIFICATION_POLICIES,
  PAIMIND_RESPONSE_LENGTHS,
  PAIMIND_RESPONSE_STRUCTURES,
  PAIMIND_RESPONSE_STYLES,
  type PaimindUserPreferences,
  type PaimindUserSettingsMutationRequest,
  type PaimindUserSettingsView,
} from '../preferences.js'
import TYPERT_REMOTE from '../remote.js'

const BASE_INJECT = ['slots', 'locale', 'remote'] as const
export const inject = [...BASE_INJECT]

interface UserSettingsRemoteNamespace {
  describe(): Promise<HarnessRemoteResult<PaimindUserSettingsView>>
  mutate(request: PaimindUserSettingsMutationRequest): Promise<HarnessRemoteResult<PaimindUserSettingsView>>
}

interface UserSettingsRemote extends HarnessRemoteMountService {
  readonly paimindUserSettings?: UserSettingsRemoteNamespace
}

export interface UserSettingsClientContext extends PaimindClientContext {
  readonly remote: UserSettingsRemote
  inject(
    dependencies: readonly string[],
    install: (ctx: UserSettingsClientContext) => void,
  ): PromiseLike<unknown> & { dispose(): Promise<void> }
}

const STYLE_ID = '@paimind/user-settings'
const STYLE = `
[data-paimind-user-settings]{box-sizing:border-box;min-height:100%;padding:24px;color:var(--dsw-alias-label-primary,#202124);font:inherit}
[data-paimind-user-settings] *{box-sizing:border-box}
[data-paimind-user-settings-header]{display:grid;gap:6px;margin-bottom:18px}
[data-paimind-user-settings-header] h2{margin:0;font-size:22px;line-height:30px}
[data-paimind-user-settings-header] p{margin:0;max-width:720px;color:var(--dsw-alias-label-secondary,#626872);font-size:13px;line-height:20px}
[data-paimind-user-settings-note]{margin:0 0 16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:18px}
[data-paimind-user-settings-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
[data-paimind-user-setting-card]{display:grid;align-content:start;gap:9px;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:13px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025))}
[data-paimind-user-setting-card][data-wide='true']{grid-column:1/-1}
[data-paimind-user-setting-card] h3{margin:0;font-size:14px;line-height:20px}
[data-paimind-user-setting-card] p{margin:0;color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:17px}
[data-paimind-user-setting-card] label{display:grid;gap:5px;color:var(--dsw-alias-label-secondary,#626872);font-size:11px}
[data-paimind-user-setting-card] select,[data-paimind-user-setting-card] textarea{width:100%;min-height:38px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));border-radius:9px;color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-bg-layer-1,transparent);font:inherit;font-size:12px;outline:none}
[data-paimind-user-setting-card] textarea{min-height:104px;resize:vertical;line-height:18px}
[data-paimind-user-setting-card] select:focus,[data-paimind-user-setting-card] textarea:focus{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 16%,transparent)}
[data-paimind-user-settings-actions]{display:flex;align-items:center;gap:10px}
[data-paimind-user-settings-actions] button{min-height:34px;padding:6px 12px;border:0;border-radius:9px;color:#fff;background:var(--dsw-alias-state-business-primary,#4f7ff8);font:inherit;font-size:12px;cursor:pointer}
[data-paimind-user-settings-actions] button:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-user-settings-state]{padding:28px 12px;color:var(--dsw-alias-label-secondary,#626872);text-align:center}
[data-paimind-user-settings-feedback]{font-size:11px;color:var(--dsw-alias-label-secondary,#626872)}
@media(max-width:760px){[data-paimind-user-settings]{padding:16px 12px}[data-paimind-user-settings-grid]{grid-template-columns:1fr}[data-paimind-user-setting-card][data-wide='true']{grid-column:auto}}
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

/** Browser projection over the PAIMind-owned Host Remote; persistence stays native Settings. */
export class RemotePaimindSettingsScope implements PaimindSettingsScope<PaimindUserPreferences> {
  private snapshot: PaimindSettingsScopeSnapshot<PaimindUserPreferences> = Object.freeze({
    status: 'loading', value: undefined, base: undefined, user: undefined,
    revision: undefined, writable: false, mode: 'host',
  })
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private disposed = false

  constructor(private readonly remote: UserSettingsRemoteNamespace) { void this.load() }

  getSnapshot(): PaimindSettingsScopeSnapshot<PaimindUserPreferences> { return this.snapshot }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  async load(): Promise<void> {
    const generation = ++this.generation
    try {
      const response = await this.remote.describe()
      if (this.disposed || generation !== this.generation) return
      if (!response.ok) { this.rejectInitialLoad(); return }
      this.accept(response.value)
    } catch { if (!this.disposed && generation === this.generation) this.rejectInitialLoad() }
  }

  async set(field: keyof PaimindUserPreferences & string, value: unknown): Promise<void> {
    const current = this.snapshot
    if (current.status !== 'ready' || current.revision === undefined || !current.writable || this.disposed) return
    const generation = ++this.generation
    try {
      const response = await this.remote.mutate({ field, value, expectedRevision: current.revision })
      if (this.disposed || generation !== this.generation) return
      if (!response.ok) { await this.load(); return }
      this.accept(response.value)
    } catch { if (!this.disposed && generation === this.generation) await this.load() }
  }

  async unset(field: keyof PaimindUserPreferences & string): Promise<void> {
    await this.set(field, DEFAULT_PAIMIND_USER_PREFERENCES[field])
  }

  dispose(): void { this.disposed = true; this.generation += 1; this.listeners.clear() }

  private rejectInitialLoad(): void {
    if (this.snapshot.status !== 'loading') return
    this.snapshot = Object.freeze({
      status: 'unavailable', value: undefined, base: undefined, user: undefined,
      revision: undefined, writable: false, mode: 'host',
    })
    for (const listener of [...this.listeners]) listener()
  }

  private accept(view: PaimindUserSettingsView): void {
    this.snapshot = view.status === 'ready'
      ? Object.freeze({
          status: 'ready', value: view.value, base: undefined, user: undefined,
          revision: view.revision, writable: view.writable, mode: 'host',
        })
      : Object.freeze({
          status: 'unavailable', value: undefined, base: undefined, user: undefined,
          revision: undefined, writable: false, mode: 'host',
        })
    for (const listener of [...this.listeners]) listener()
  }
}

export function projectMotion(scope: PaimindSettingsScope<PaimindUserPreferences>): () => void {
  const refresh = (): void => {
    const snapshot = scope.getSnapshot()
    if (snapshot.status === 'ready' && snapshot.value?.motion === 'reduce') {
      document.documentElement.dataset.paimindMotion = 'reduce'
    } else {
      delete document.documentElement.dataset.paimindMotion
    }
  }
  refresh()
  const off = scope.subscribe(refresh)
  return () => { off(); delete document.documentElement.dataset.paimindMotion }
}

const COPY = {
  responseStyle: { zh: '表达风格', en: 'Response style' },
  responseLength: { zh: '回答长度', en: 'Response length' },
  responseStructure: { zh: '内容结构', en: 'Response structure' },
  citations: { zh: '引用偏好', en: 'Citation preference' },
} as const

const NOTIFICATION_POLICY_COPY = {
  all: { zh: '接收全部通知', en: 'Receive all notifications' },
  attention: { zh: '仅接收重要通知', en: 'Important notifications only' },
  off: { zh: '暂停接收通知', en: 'Pause notifications' },
} as const

export function UserSettingsSection({ scope, zh }: { readonly scope: PaimindSettingsScope<PaimindUserPreferences>; readonly zh: boolean }): React.JSX.Element {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const preferences = snapshot.value ?? DEFAULT_PAIMIND_USER_PREFERENCES
  const [instructions, setInstructions] = useState(preferences.personalInstructions)
  const [feedback, setFeedback] = useState('')

  useEffect(() => { setInstructions(preferences.personalInstructions) }, [preferences.personalInstructions])

  if (snapshot.status === 'loading') return <div data-paimind-user-settings-state aria-busy="true">{zh ? '正在读取 Harness 设置…' : 'Reading Harness settings…'}</div>
  if (snapshot.status === 'unavailable') return <div data-paimind-user-settings-state data-settings-mode={snapshot.mode} role="status">{snapshot.mode === 'memory'
    ? (zh ? '当前远程连接按 Harness 规则仅允许进程内偏好；不会伪造持久化设置。' : 'Harness keeps preferences process-local for this remote connection. No persistence is simulated.')
    : (zh ? 'PAIMind 设置命名空间当前未由主机提供；不会回退到浏览器临时存储。' : 'The PAIMind settings namespace is not exposed by this Host. No browser-storage fallback is used.')}</div>

  const setField = async <Key extends keyof PaimindUserPreferences>(field: Key, value: PaimindUserPreferences[Key]): Promise<void> => {
    setFeedback(zh ? '正在保存…' : 'Saving…')
    await scope.set(field, value)
    const committed = scope.getSnapshot().value?.[field] === value
    setFeedback(committed ? (zh ? '已保存到 Harness 设置' : 'Saved to Harness settings') : (zh ? '未保存；已恢复主机值' : 'Not saved; restored Host value'))
  }

  const options = [
    ['responseStyle', PAIMIND_RESPONSE_STYLES],
    ['responseLength', PAIMIND_RESPONSE_LENGTHS],
    ['responseStructure', PAIMIND_RESPONSE_STRUCTURES],
    ['citations', PAIMIND_CITATION_POLICIES],
  ] as const

  return <section data-paimind-user-settings aria-label={zh ? 'PAIMind 偏好' : 'PAIMind Preferences'}>
    <header data-paimind-user-settings-header><h2>{zh ? 'PAIMind 偏好' : 'PAIMind Preferences'}</h2><p>{zh ? '只管理 PAIMind 拥有且会真实生效的偏好；语言、主题、模型、权限和 Agent Preset 继续由 Harness 原生页面负责。' : 'Only PAIMind-owned preferences with real consumers live here. Language, theme, model, permission, and Agent Preset remain native Harness settings.'}</p></header>
    <p data-paimind-user-settings-note>{zh ? '所有更改写入 Harness 用户设置文档，并使用原生 Revision/CAS 冲突保护；没有 localStorage 或 sessionStorage 回退。' : 'All changes use the Harness user settings document and native revision/CAS conflict protection. There is no localStorage or sessionStorage fallback.'}</p>
    <div data-paimind-user-settings-grid>
      <article data-paimind-user-setting-card data-wide="true"><h3>{zh ? '回答偏好' : 'Response preferences'}</h3><p>{zh ? '非默认值会进入真实 Harness System Prompt，并在后续 Agent 回合生效。' : 'Non-default choices enter the real Harness System Prompt for later Agent turns.'}</p>{options.map(([field, values]) => <label key={field}>{COPY[field][zh ? 'zh' : 'en']}<select value={preferences[field]} disabled={!snapshot.writable} onChange={event => { void setField(field, event.currentTarget.value as never) }}>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}<label>{zh ? '个人指令' : 'Personal instructions'}<textarea maxLength={3_000} disabled={!snapshot.writable} value={instructions} onChange={event => { setInstructions(event.currentTarget.value) }} /></label><div data-paimind-user-settings-actions><button type="button" disabled={!snapshot.writable || instructions === preferences.personalInstructions} onClick={() => { void setField('personalInstructions', instructions) }}>{zh ? '保存个人指令' : 'Save instructions'}</button><span data-paimind-user-settings-feedback role="status">{feedback}</span></div></article>
      <article data-paimind-user-setting-card><h3>{zh ? '减少动画' : 'Reduced motion'}</h3><p>{zh ? 'System 跟随操作系统；Reduce 只会进一步暂停 PAIMind 动画，绝不强制开启系统已关闭的动画。' : 'System follows the OS. Reduce only pauses PAIMind animation and never forces motion against the OS.'}</p><label>{zh ? '动画策略' : 'Motion policy'}<select value={preferences.motion} disabled={!snapshot.writable} onChange={event => { void setField('motion', event.currentTarget.value as PaimindUserPreferences['motion']) }}>{PAIMIND_MOTION_POLICIES.map(value => <option key={value} value={value}>{value}</option>)}</select></label></article>
      <article data-paimind-user-setting-card><h3>{zh ? '通知设置' : 'Notification settings'}</h3><p>{zh ? '选择希望在通知中心接收哪些消息；各业务应用只负责发送，平台按你的偏好统一处理。' : 'Choose which messages reach your Notification Center. Business applications send messages; the platform applies your preference.'}</p><label>{zh ? '接收范围' : 'Receive'}<select value={preferences.notifications} disabled={!snapshot.writable} onChange={event => { void setField('notifications', event.currentTarget.value as PaimindUserPreferences['notifications']) }}>{PAIMIND_NOTIFICATION_POLICIES.map(value => <option key={value} value={value}>{NOTIFICATION_POLICY_COPY[value][zh ? 'zh' : 'en']}</option>)}</select></label></article>
    </div>
  </section>
}

export async function apply(ctx: UserSettingsClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindUserSettings'], scopeCtx => {
    const remote = scopeCtx.remote.paimindUserSettings
    if (remote === undefined) throw new Error('PAIMind User Settings Remote did not mount')
    const scope = new RemotePaimindSettingsScope(remote)
    scopeCtx.effect(installStyle, 'paimind-user-settings: style')
    contributePaimindExtension(scopeCtx.slots, {
      id: 'paimind:user-settings', packageName: '@paimind/user-settings', category: 'experience',
      nameZh: 'PAIMind 偏好', nameEn: 'PAIMind Preferences',
      descriptionZh: '复用 Harness 设置文档的个性化提示、减少动画和通知策略。',
      descriptionEn: 'Personal prompt, reduced-motion, and notification policies in the Harness settings document.',
      surface: 'settings', maturity: 'technical-preview', order: 20,
    })
    scopeCtx.effect(() => { const off = projectMotion(scope); return () => { off(); scope.dispose() } }, 'paimind-user-settings: motion projection')
    scopeCtx.slots.inject('settings.section', () => scopeCtx.slots.register({
      name: 'settings.section', id: 'paimind-user-settings', order: 24,
      label: () => scopeCtx.locale.getLocale().active.startsWith('zh') ? 'PAIMind 偏好' : 'PAIMind Preferences',
    }, () => <UserSettingsSection scope={scope} zh={scopeCtx.locale.getLocale().active.startsWith('zh')} />))
  })
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
