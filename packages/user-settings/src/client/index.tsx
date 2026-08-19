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
  DEFAULT_PAIMIND_PERSONALIZATION,
  PAIMIND_PERSONALITIES,
  renderPaimindPersonalizationContext,
  type PaimindPersonalization,
  type PaimindPersonalizationMutationRequest,
  type PaimindPersonalizationView,
} from '../preferences.js'
import TYPERT_REMOTE from '../remote.js'

const BASE_INJECT = ['slots', 'locale', 'remote'] as const
export const inject = [...BASE_INJECT]

interface UserSettingsRemoteNamespace {
  describe(): Promise<HarnessRemoteResult<PaimindPersonalizationView>>
  mutate(request: PaimindPersonalizationMutationRequest): Promise<HarnessRemoteResult<PaimindPersonalizationView>>
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
[data-paimind-user-settings-header]{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}
[data-paimind-user-settings-header-copy]{display:grid;gap:6px}
[data-paimind-user-settings-header] h2{margin:0;font-size:22px;line-height:30px}
[data-paimind-user-settings-header] p{margin:0;max-width:680px;color:var(--dsw-alias-label-secondary,#626872);font-size:13px;line-height:20px}
[data-paimind-personalization-scope]{display:inline-flex;align-items:center;gap:6px;margin:0 0 18px;padding:7px 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 9%,transparent);color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:16px}
[data-paimind-personalization-scope]::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4f7ff8)}
[data-paimind-user-settings-grid]{display:grid;gap:12px}
[data-paimind-user-setting-card]{display:grid;align-content:start;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:14px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.025))}
[data-paimind-user-setting-card] h3{margin:0;font-size:14px;line-height:20px}
[data-paimind-user-setting-card] p{margin:0;color:var(--dsw-alias-label-secondary,#626872);font-size:11px;line-height:17px}
[data-paimind-user-setting-card] label{display:grid;gap:6px;color:var(--dsw-alias-label-primary,#202124);font-size:12px;line-height:18px}
[data-paimind-user-setting-card] textarea{width:100%;min-height:96px;padding:10px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));border-radius:10px;color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-bg-layer-1,transparent);font:inherit;font-size:12px;line-height:18px;resize:vertical;outline:none}
[data-paimind-user-setting-card] textarea:focus{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 16%,transparent)}
[data-paimind-personality-options]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
[data-paimind-personality-option]{display:grid;gap:3px;min-height:62px;padding:10px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:11px;color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-bg-layer-1,transparent);font:inherit;text-align:left;cursor:pointer}
[data-paimind-personality-option][aria-pressed='true']{border-color:var(--dsw-alias-state-business-primary,#4f7ff8);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f7ff8) 9%,transparent)}
[data-paimind-personality-option] strong{font-size:12px;line-height:18px}
[data-paimind-personality-option] span{color:var(--dsw-alias-label-secondary,#626872);font-size:10px;line-height:15px}
[data-paimind-personality-option]:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-personalization-toggle]{position:relative;flex:0 0 auto;width:42px;height:24px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-fill-tertiary,rgba(128,128,128,.28));cursor:pointer;transition:background .16s ease}
[data-paimind-personalization-toggle]::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .16s ease}
[data-paimind-personalization-toggle][aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4f7ff8)}
[data-paimind-personalization-toggle][aria-checked='true']::after{transform:translateX(18px)}
[data-paimind-personalization-toggle]:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-user-settings-actions]{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
[data-paimind-user-settings-actions] button{min-height:34px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:9px;color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-bg-layer-1,transparent);font:inherit;font-size:12px;cursor:pointer}
[data-paimind-user-settings-actions] button[data-primary='true']{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary,#4f7ff8)}
[data-paimind-user-settings-actions] button:disabled{opacity:.5;cursor:not-allowed}
[data-paimind-user-settings-feedback]{font-size:11px;color:var(--dsw-alias-label-secondary,#626872)}
[data-paimind-personalization-preview]{overflow:auto;max-height:260px;margin:0;padding:12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.04));color:var(--dsw-alias-label-secondary,#626872);font:11px/17px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
[data-paimind-user-settings-state]{padding:28px 12px;color:var(--dsw-alias-label-secondary,#626872);text-align:center}
@media(max-width:760px){[data-paimind-user-settings]{padding:16px 12px}[data-paimind-user-settings-header]{gap:12px}[data-paimind-personality-options]{grid-template-columns:1fr}}
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
export class RemotePaimindSettingsScope implements PaimindSettingsScope<PaimindPersonalization> {
  private snapshot: PaimindSettingsScopeSnapshot<PaimindPersonalization> = Object.freeze({
    status: 'loading', value: undefined, base: undefined, user: undefined,
    revision: undefined, writable: false, mode: 'host',
  })
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private disposed = false

  constructor(private readonly remote: UserSettingsRemoteNamespace) { void this.load() }

  getSnapshot(): PaimindSettingsScopeSnapshot<PaimindPersonalization> { return this.snapshot }
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

  async set(field: keyof PaimindPersonalization & string, value: unknown): Promise<void> {
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

  async unset(field: keyof PaimindPersonalization & string): Promise<void> {
    await this.set(field, DEFAULT_PAIMIND_PERSONALIZATION[field])
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

  private accept(view: PaimindPersonalizationView): void {
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

const PERSONALITY_COPY = {
  none: {
    zh: { title: '无', description: '不额外指定沟通风格' },
    en: { title: 'None', description: 'No additional communication style' },
  },
  friendly: {
    zh: { title: '友好', description: '温和、协作，同时保持清晰' },
    en: { title: 'Friendly', description: 'Warm and collaborative, while clear' },
  },
  pragmatic: {
    zh: { title: '务实', description: '直接、结果导向、行动优先' },
    en: { title: 'Pragmatic', description: 'Direct, outcome and action oriented' },
  },
} as const

export function UserSettingsSection({ scope, zh }: { readonly scope: PaimindSettingsScope<PaimindPersonalization>; readonly zh: boolean }): React.JSX.Element {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const personalization = snapshot.value ?? DEFAULT_PAIMIND_PERSONALIZATION
  const [aboutMe, setAboutMe] = useState(personalization.aboutMe)
  const [customInstructions, setCustomInstructions] = useState(personalization.customInstructions)
  const [showPreview, setShowPreview] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => { setAboutMe(personalization.aboutMe) }, [personalization.aboutMe])
  useEffect(() => { setCustomInstructions(personalization.customInstructions) }, [personalization.customInstructions])

  if (snapshot.status === 'loading') return <div data-paimind-user-settings-state aria-busy="true">{zh ? '正在读取 Harness 设置…' : 'Reading Harness settings…'}</div>
  if (snapshot.status === 'unavailable') return <div data-paimind-user-settings-state data-settings-mode={snapshot.mode} role="status">{snapshot.mode === 'memory'
    ? (zh ? '当前远程连接按 Harness 规则仅允许进程内设置；不会伪造持久化。' : 'Harness keeps settings process-local for this remote connection. No persistence is simulated.')
    : (zh ? 'PAIMind 个性化命名空间当前未由主机提供；不会回退到浏览器临时存储。' : 'The PAIMind Personalization namespace is not exposed by this Host. No browser-storage fallback is used.')}</div>

  const setField = async <Key extends keyof PaimindPersonalization>(field: Key, value: PaimindPersonalization[Key]): Promise<void> => {
    setFeedback(zh ? '正在保存…' : 'Saving…')
    await scope.set(field, value)
    const committed = scope.getSnapshot().value?.[field] === value
    setFeedback(committed ? (zh ? '已保存，从下一次回复起生效' : 'Saved; applies from the next response') : (zh ? '未保存；已恢复主机值' : 'Not saved; restored Host value'))
  }

  const textChanged = aboutMe !== personalization.aboutMe || customInstructions !== personalization.customInstructions
  const saveText = async (): Promise<void> => {
    setFeedback(zh ? '正在保存…' : 'Saving…')
    if (aboutMe !== personalization.aboutMe) await scope.set('aboutMe', aboutMe)
    if (customInstructions !== personalization.customInstructions) await scope.set('customInstructions', customInstructions)
    const committed = scope.getSnapshot().value
    setFeedback(committed?.aboutMe === aboutMe && committed.customInstructions === customInstructions
      ? (zh ? '已保存，从下一次回复起生效' : 'Saved; applies from the next response')
      : (zh ? '未完整保存；已恢复主机值' : 'Not fully saved; restored Host values'))
  }

  const previewValue = renderPaimindPersonalizationContext({ ...personalization, aboutMe, customInstructions })

  return <section data-paimind-user-settings aria-label={zh ? '个性化' : 'Personalization'}>
    <header data-paimind-user-settings-header>
      <div data-paimind-user-settings-header-copy>
        <h2>{zh ? '个性化' : 'Personalization'}</h2>
        <p>{zh ? '设置 PAIMind 了解你的方式和默认沟通风格。个性化只改变协作方式，不改变智能体能力。' : 'Set what PAIMind knows about you and its default communication style. Personalization changes collaboration style, not Agent capabilities.'}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={zh ? '启用个性化' : 'Enable personalization'}
        aria-checked={personalization.enabled}
        data-paimind-personalization-toggle
        disabled={!snapshot.writable}
        onClick={() => { void setField('enabled', !personalization.enabled) }}
      />
    </header>
    <div data-paimind-personalization-scope>{zh ? '所有 PAIMind 智能体 · 从保存后的下一次回复起' : 'All PAIMind Agents · From the next response after saving'}</div>
    <div data-paimind-user-settings-grid>
      <article data-paimind-user-setting-card>
        <h3>{zh ? '个性' : 'Personality'}</h3>
        <p>{zh ? '参考 Codex：个性仅定义表达方式，不影响工具、模型、权限或任务能力。' : 'As in Codex, personality controls communication only—not tools, models, permissions, or task capabilities.'}</p>
        <div data-paimind-personality-options role="group" aria-label={zh ? '选择个性' : 'Choose personality'}>
          {PAIMIND_PERSONALITIES.map(value => {
            const copy = PERSONALITY_COPY[value][zh ? 'zh' : 'en']
            return <button key={value} type="button" data-paimind-personality-option aria-pressed={personalization.personality === value} disabled={!snapshot.writable} onClick={() => { void setField('personality', value) }}><strong>{copy.title}</strong><span>{copy.description}</span></button>
          })}
        </div>
      </article>
      <article data-paimind-user-setting-card>
        <h3>{zh ? '关于你' : 'About you'}</h3>
        <p>{zh ? '填写长期稳定、确实会帮助协作的信息。不要填写密码或敏感凭证。' : 'Add stable details that genuinely improve collaboration. Do not enter passwords or sensitive credentials.'}</p>
        <label>{zh ? 'PAIMind 应该了解什么？' : 'What should PAIMind know?'}<textarea maxLength={2_000} disabled={!snapshot.writable} value={aboutMe} placeholder={zh ? '例如：我是企业 AI 产品经理，偏好先看结论和可执行的下一步。' : 'For example: I am an enterprise AI product manager and prefer conclusions and actionable next steps first.'} onChange={event => { setAboutMe(event.currentTarget.value) }} /></label>
      </article>
      <article data-paimind-user-setting-card>
        <h3>{zh ? '自定义指令' : 'Custom instructions'}</h3>
        <p>{zh ? '补充你希望 PAIMind 默认遵循的协作要求；当前对话中的明确要求始终优先。' : 'Add collaboration defaults for PAIMind. Explicit instructions in the current conversation always take precedence.'}</p>
        <label>{zh ? '特别要求' : 'Additional instructions'}<textarea maxLength={3_000} disabled={!snapshot.writable} value={customInstructions} placeholder={zh ? '例如：涉及产品方案时，明确区分已实现、设计中和待验证。' : 'For example: In product proposals, distinguish implemented, designed, and unverified work.'} onChange={event => { setCustomInstructions(event.currentTarget.value) }} /></label>
        <div data-paimind-user-settings-actions>
          <button type="button" data-primary="true" disabled={!snapshot.writable || !textChanged} onClick={() => { void saveText() }}>{zh ? '保存个性化' : 'Save personalization'}</button>
          <button type="button" onClick={() => { setShowPreview(current => !current) }}>{showPreview ? (zh ? '收起注入预览' : 'Hide context preview') : (zh ? '查看注入预览' : 'Preview injected context')}</button>
          <span data-paimind-user-settings-feedback role="status">{feedback}</span>
        </div>
        {showPreview && <pre data-paimind-personalization-preview>{previewValue === '' ? (zh ? '当前不会注入任何个性化上下文。' : 'No personalization context will be injected.') : previewValue}</pre>}
      </article>
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
      nameZh: '个性化', nameEn: 'Personalization',
      descriptionZh: '参考 Codex 的个性、关于你和自定义指令，并注入可追踪的用户上下文。',
      descriptionEn: 'Codex-inspired personality, about-you details, and custom instructions as traceable user context.',
      surface: 'settings', maturity: 'technical-preview', order: 20,
    })
    scopeCtx.effect(() => () => { scope.dispose() }, 'paimind-user-settings: scope')
    scopeCtx.slots.inject('settings.section', () => scopeCtx.slots.register({
      name: 'settings.section', id: 'paimind-user-settings', order: 24,
      label: () => scopeCtx.locale.getLocale().active.startsWith('zh') ? '个性化' : 'Personalization',
    }, () => <UserSettingsSection scope={scope} zh={scopeCtx.locale.getLocale().active.startsWith('zh')} />))
  })
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
