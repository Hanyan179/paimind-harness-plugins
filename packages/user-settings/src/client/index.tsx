import { PAIMIND_UI_FOUNDATION_CSS } from '@hansen/ui-foundation'
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { getPersonalizationEditor, releasePersonalizationEditor } from './editor.js'
import {
  markHarnessClientStyle,
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type HarnessRemoteResult,
  type PaimindClientContext,
  type PaimindSettingsScope,
  type PaimindSettingsScopeSnapshot,
} from '@hansen/harness-compat'
import {
  DEFAULT_PAIMIND_PERSONALIZATION,
  PAIMIND_PERSONALITIES,
  type PaimindPersonalization,
  type PaimindPersonalizationMutationRequest,
  type PaimindPersonalizationTextRequest,
  type PaimindPersonalizationView,
} from '../preferences.js'
import TYPERT_REMOTE from '../remote.js'

const BASE_INJECT = ['slots', 'locale', 'remote'] as const
export const inject = [...BASE_INJECT]

interface UserSettingsRemoteNamespace {
  describe(): Promise<HarnessRemoteResult<PaimindPersonalizationView>>
  mutate(request: PaimindPersonalizationMutationRequest): Promise<HarnessRemoteResult<PaimindPersonalizationView>>
  saveText?(request: PaimindPersonalizationTextRequest): Promise<HarnessRemoteResult<PaimindPersonalizationView>>
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

const STYLE_ID = '@hansen/user-settings'
const STYLE = `${PAIMIND_UI_FOUNDATION_CSS}
[data-paimind-user-settings]{box-sizing:border-box;min-height:100%;padding:var(--paimind-ui-space-6);font:inherit}
[data-paimind-user-settings-header]{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--paimind-ui-space-4);margin-bottom:var(--paimind-ui-space-4)}
[data-paimind-user-settings-header-copy]{display:grid;gap:var(--paimind-ui-space-2)}
[data-paimind-user-settings-header] :is(h2,h3){margin:0;font-size:var(--paimind-ui-text-lg);line-height:1.4}
[data-paimind-user-settings-header] p{margin:0;max-width:680px;color:var(--paimind-ui-muted);font-size:var(--paimind-ui-text-sm);line-height:1.6}
[data-paimind-personalization-scope]{margin:0 0 var(--paimind-ui-space-4);padding:var(--paimind-ui-space-3);border-radius:var(--paimind-ui-radius-sm);background:var(--paimind-ui-subtle)}
[data-paimind-user-settings-grid]{display:grid;gap:var(--paimind-ui-space-4);min-width:0}
[data-paimind-user-setting-card]{display:grid;align-content:start;gap:var(--paimind-ui-space-3);padding:var(--paimind-ui-space-4);min-width:0}
[data-paimind-user-setting-card] h4{margin:0;font-size:var(--paimind-ui-text-md);line-height:1.5}
[data-paimind-user-setting-card] p{margin:0;color:var(--paimind-ui-muted);font-size:var(--paimind-ui-text-sm);line-height:1.6}
[data-paimind-text-label]{display:grid;gap:var(--paimind-ui-space-2);font-size:var(--paimind-ui-text-sm);line-height:1.5}
[data-paimind-user-setting-card] textarea{min-height:112px;resize:vertical;font-size:var(--paimind-ui-text-md)}
[data-paimind-field-count]{justify-self:end;color:var(--paimind-ui-muted);font-size:var(--paimind-ui-text-sm)}
[data-paimind-personality-options]{grid-template-columns:repeat(3,minmax(0,1fr))}
[data-paimind-user-settings-actions]{position:sticky;bottom:0;z-index:1;display:flex;flex-wrap:wrap;align-items:center;gap:var(--paimind-ui-space-2);padding:var(--paimind-ui-space-3);border:1px solid var(--paimind-ui-border);border-radius:var(--paimind-ui-radius-md);background:var(--paimind-ui-canvas)}
[data-paimind-user-settings-feedback]{flex:1 1 240px;line-height:1.6}
[data-paimind-user-settings-actions] button{min-height:44px}
[data-paimind-user-settings] button[aria-disabled='true']{opacity:.45;cursor:not-allowed}
[data-paimind-personality-options] label:has([aria-disabled='true']){opacity:.55;cursor:wait}
[data-paimind-saved-preview]{display:grid;gap:var(--paimind-ui-space-3);min-width:0}
[data-paimind-saved-preview] dl{display:grid;gap:var(--paimind-ui-space-2);margin:0;font-size:var(--paimind-ui-text-sm);line-height:1.6}
[data-paimind-saved-preview] dt{font-weight:600}
[data-paimind-saved-preview] dd{margin:0 0 var(--paimind-ui-space-2);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--paimind-ui-muted)}
[data-paimind-user-settings-state]{display:grid;justify-items:start;gap:var(--paimind-ui-space-3);padding:var(--paimind-ui-space-6);color:var(--paimind-ui-muted);font-size:var(--paimind-ui-text-md)}
[data-paimind-user-settings-state] p{margin:0;line-height:1.6}
@media(max-width:760px){[data-paimind-user-settings]{padding:var(--paimind-ui-space-4) var(--paimind-ui-space-3)}[data-paimind-personality-options]{grid-template-columns:1fr}[data-paimind-user-settings-feedback]{flex-basis:100%}}
`

function installStyle(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.paimindPlugin = STYLE_ID; markHarnessClientStyle(style, STYLE_ID)
  style.textContent = STYLE
  document.head.append(style)
  return () => { style.remove() }
}

/** Browser projection over the Host Remote; persistence stays native Settings. */
export class RemotePaimindSettingsScope implements PaimindSettingsScope<PaimindPersonalization> {
  private snapshot: PaimindSettingsScopeSnapshot<PaimindPersonalization> = Object.freeze({
    status: 'loading', value: undefined, base: undefined, user: undefined,
    revision: undefined, writable: false, mode: 'host',
  })
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private disposed = false
  private writing = false

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
    await this.write(revision => this.remote.mutate({ field, value, expectedRevision: revision }))
  }

  async saveText(value: Pick<PaimindPersonalization, 'aboutMe' | 'customInstructions'>): Promise<void> {
    if (!this.remote.saveText) throw new Error('Atomic personalization save is unavailable')
    await this.write(revision => this.remote.saveText!({ ...value, expectedRevision: revision }))
  }

  private async write(mutate: (revision: number) => Promise<HarnessRemoteResult<PaimindPersonalizationView>>): Promise<void> {
    const current = this.snapshot
    if (current.status !== 'ready' || current.revision === undefined || !current.writable || this.disposed || this.writing) return
    this.writing = true
    const generation = ++this.generation
    try {
      const response = await mutate(current.revision)
      if (this.disposed || generation !== this.generation) return
      if (!response.ok) { await this.load(); return }
      this.accept(response.value)
    } catch { if (!this.disposed && generation === this.generation) await this.load() }
    finally { this.writing = false }
  }

  async unset(field: keyof PaimindPersonalization & string): Promise<void> {
    await this.set(field, DEFAULT_PAIMIND_PERSONALIZATION[field])
  }

  dispose(): void { this.disposed = true; this.generation += 1; releasePersonalizationEditor(this); this.listeners.clear() }

  private rejectInitialLoad(): void {
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
    zh: { title: '默认', description: '沿用助手原有的表达方式' },
    en: { title: 'Default', description: 'Use the assistant’s usual style' },
  },
  friendly: {
    zh: { title: '友好', description: '语气亲切，表达清晰' },
    en: { title: 'Friendly', description: 'Warm tone and clear wording' },
  },
  pragmatic: {
    zh: { title: '务实', description: '突出结论和下一步行动' },
    en: { title: 'Practical', description: 'Focus on conclusions and next steps' },
  },
} as const

function CollaborationSettings({ scope, zh }: { readonly scope: PaimindSettingsScope<PaimindPersonalization>; readonly zh: boolean }): React.JSX.Element {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const editor = getPersonalizationEditor(scope)
  const edit = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot)
  const personalization = snapshot.value ?? DEFAULT_PAIMIND_PERSONALIZATION
  const [showPreview, setShowPreview] = useState(false)
  const formId = useId()
  const aboutField = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { void editor.retry() }, [editor])
  const t = (chinese: string, english: string): string => zh ? chinese : english

  if (snapshot.status === 'loading') return <div data-paimind-user-settings-state aria-busy="true" role="status">{t('正在读取助手偏好…', 'Loading assistant preferences…')}</div>
  if (snapshot.status === 'unavailable') return <div data-paimind-user-settings-state>
    <strong>{t('暂时无法读取助手偏好', 'Assistant preferences are unavailable')}</strong>
    <p role="status">{t('请检查连接后重试。已保存的设置不会改变，未保存的内容仍保留在当前页面。', 'Check the connection and retry. Saved settings are unchanged; unsaved content remains in this page.')}</p>
    {editor.canRetry && <button type="button" data-paimind-ui-button disabled={edit.busy} onClick={() => { void editor.retry() }}>{t('重试', 'Retry')}</button>}
  </div>

  const disabled = !snapshot.writable || edit.busy
  const failed = ['failed', 'partial', 'conflict'].includes(edit.feedback)
  const feedback = edit.feedback === 'saving' ? t('正在保存，请稍候…', 'Saving, please wait…')
    : failed ? t('未能完成保存，或设置已在其他位置更新。你的输入已保留，请查看已保存内容后重试。', 'Could not complete saving, or settings changed elsewhere. Your input is kept; review saved settings and retry.')
    : editor.dirty ? t('工作背景或回复要求有未保存的修改', 'Your work background or response requirements have unsaved changes')
    : edit.feedback === 'saved' ? (personalization.enabled ? t('已保存，从下一次回复起生效', 'Saved; applies from the next response') : t('已保存。助手偏好当前关闭，开启后生效。', 'Saved. Assistant preferences are off; enable them to apply.'))
    : t('工作背景和回复要求需点击保存；开关与沟通风格自动保存。', 'Save changes to your work background and response requirements. The switch and communication style save automatically.')

  return <section aria-label={t('助手偏好', 'Assistant preferences')} aria-busy={edit.busy}>
    <header data-paimind-user-settings-header>
      <div data-paimind-user-settings-header-copy>
        <h3>{t('助手偏好', 'Assistant preferences')}</h3>
        <p>{t('设置沟通风格、工作背景和回复要求，让助手更贴合你的工作。对话中提出的新要求会优先采用。', 'Set a communication style, work background, and response requirements to help assistants support your work. Requests in the current conversation take precedence.')}</p>
      </div>
      <button type="button" role="switch" aria-label={t('使用助手偏好', 'Use assistant preferences')} aria-checked={personalization.enabled} data-paimind-ui-switch data-paimind-personalization-toggle disabled={!snapshot.writable} aria-disabled={edit.busy} onClick={() => { void editor.setField('enabled', !personalization.enabled) }} />
    </header>
    <p data-paimind-personalization-scope data-paimind-ui-state>{!snapshot.writable
      ? t('当前只能查看，暂时无法修改。', 'You can view these settings, but changes are currently unavailable.')
      : personalization.enabled ? t('已开启 · 适用于所有助手，从保存后的下一次回复起生效。', 'On · Applies to all assistants from the next response after saving.')
      : t('已关闭 · 已保存的内容会保留；你仍可编辑，开启后才会用于回复。界面设置不受影响。', 'Off · Saved details are kept. You can edit them now; they will be used in responses when enabled. Display settings are unaffected.')}</p>
    <div data-paimind-user-settings-grid>
      <article data-paimind-user-setting-card data-paimind-ui-card>
        <h4>{t('沟通风格', 'Communication style')}</h4>
        <p>{t('选择默认的表达方式，选择后自动保存。', 'Choose a default communication style. Your choice saves automatically.')}</p>
        <div data-paimind-personality-options data-paimind-ui-choices role="radiogroup" aria-label={t('选择沟通风格', 'Choose communication style')}>
          {PAIMIND_PERSONALITIES.map(value => {
            const copy = PERSONALITY_COPY[value][zh ? 'zh' : 'en']
            return <label key={value} data-paimind-ui-choice>
              <input type="radio" name={`${formId}-personality`} value={value} checked={personalization.personality === value} disabled={!snapshot.writable} aria-disabled={edit.busy} onChange={() => { void editor.setField('personality', value) }} />
              <span><strong>{copy.title}</strong><small>{copy.description}</small></span>
            </label>
          })}
        </div>
      </article>
      <article data-paimind-user-setting-card data-paimind-ui-card>
        <h4>{t('工作背景', 'Work background')}</h4>
        <p>{t('填写岗位、负责的业务和日常任务，帮助助手理解你的工作。请勿填写密码等敏感信息。', 'Describe your role, business responsibilities, and day-to-day tasks so assistants understand your work. Do not include passwords or other sensitive information.')}</p>
        <label data-paimind-text-label>{t('岗位与职责', 'Role and responsibilities')}
          <textarea data-paimind-ui-field maxLength={2_000} disabled={!snapshot.writable} readOnly={edit.busy} ref={aboutField} aria-describedby={`${formId}-about-count`} value={edit.draft.aboutMe} placeholder={t('例如：我负责区域销售，日常需要跟进客户、分析销售数据和制定拜访计划。', 'For example: I manage regional sales, follow up with customers, analyze sales data, and plan customer visits.')} onChange={event => { editor.edit('aboutMe', event.currentTarget.value) }} />
        </label>
        <span id={`${formId}-about-count`} data-paimind-field-count>{edit.draft.aboutMe.length} / 2000</span>
      </article>
      <article data-paimind-user-setting-card data-paimind-ui-card>
        <h4>{t('回复要求', 'Response requirements')}</h4>
        <p>{t('说明回复需要包含哪些内容，以及期望的格式和表达方式。', 'Describe what responses should include and your preferred format and wording.')}</p>
        <label data-paimind-text-label>{t('内容与格式要求', 'Content and format requirements')}
          <textarea data-paimind-ui-field maxLength={3_000} disabled={!snapshot.writable} readOnly={edit.busy} aria-describedby={`${formId}-instructions-count`} value={edit.draft.customInstructions} placeholder={t('例如：先给结论和建议，再补充依据；涉及数据时注明来源，用表格对比不同方案。', 'For example: Start with conclusions and recommendations, then supporting evidence. Cite data sources and use a table to compare options.')} onChange={event => { editor.edit('customInstructions', event.currentTarget.value) }} />
        </label>
        <span id={`${formId}-instructions-count`} data-paimind-field-count>{edit.draft.customInstructions.length} / 3000</span>
      </article>
      {showPreview && <article data-paimind-user-setting-card data-paimind-ui-card data-paimind-saved-preview>
        <h4>{t('已保存的助手偏好', 'Saved assistant preferences')}</h4>
        <p>{editor.dirty ? t('以下只显示已保存内容，未保存的文字不会生效。', 'Only saved details appear below. Unsaved text does not apply.') : t('这里展示当前保存的内容。', 'These are your currently saved details.')}</p>
        {!personalization.enabled && <p>{t('助手偏好已关闭，以下内容暂不用于回复。', 'Assistant preferences are off. These details are not currently used in responses.')}</p>}
        <dl><dt>{t('沟通风格', 'Communication style')}</dt><dd>{PERSONALITY_COPY[personalization.personality][zh ? 'zh' : 'en'].title}</dd>
          <dt>{t('工作背景', 'Work background')}</dt><dd>{personalization.aboutMe || t('尚未填写', 'Not set')}</dd>
          <dt>{t('回复要求', 'Response requirements')}</dt><dd>{personalization.customInstructions || t('尚未填写', 'Not set')}</dd></dl>
      </article>}
      <footer data-paimind-user-settings-actions>
        <span data-paimind-user-settings-feedback data-paimind-ui-state={failed ? 'error' : edit.feedback === 'saved' && !editor.dirty ? 'success' : 'neutral'} role={failed ? 'alert' : 'status'}>{feedback}</span>
        <button type="button" data-paimind-ui-button data-variant="quiet" aria-expanded={showPreview} onClick={() => { setShowPreview(current => !current) }}>{showPreview ? t('收起已保存内容', 'Hide saved settings') : t('查看已保存内容', 'View saved settings')}</button>
        {editor.dirty && <button type="button" data-paimind-ui-button disabled={disabled} onClick={() => { editor.discard(); aboutField.current?.focus() }}>{t('撤销未保存内容', 'Discard unsaved content')}</button>}
        <button type="button" data-paimind-ui-button data-variant="primary" disabled={!snapshot.writable} aria-disabled={edit.busy || !editor.dirty} onClick={() => { if (editor.dirty) void editor.save() }}>{edit.busy ? t('正在保存…', 'Saving…') : t('保存修改', 'Save changes')}</button>
      </footer>
    </div>
  </section>
}

export function UserSettingsSection({ scope, zh, appearance }: {
  readonly scope: PaimindSettingsScope<PaimindPersonalization>
  readonly zh: boolean
  readonly appearance?: ReactNode
}): React.JSX.Element {
  return <section data-paimind-user-settings data-paimind-ui-scope aria-label={zh ? '个性化' : 'Personalization'}>
    <header data-paimind-user-settings-header><div data-paimind-user-settings-header-copy>
      <h2>{zh ? '个性化' : 'Personalization'}</h2>
      <p>{zh ? '设置界面显示和助手回复，让日常工作更顺手。' : 'Customize your display and assistant responses to suit your daily work.'}</p>
    </div></header>
    <div data-paimind-user-settings-grid>
      {appearance}
      <CollaborationSettings scope={scope} zh={zh} />
    </div>
  </section>
}

export async function apply(ctx: UserSettingsClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const mounted = ctx.inject([...BASE_INJECT, 'remote.paimindUserSettings'], scopeCtx => {
    const remote = scopeCtx.remote.paimindUserSettings
    if (remote === undefined) throw new Error('User Settings Remote did not mount')
    const scope = new RemotePaimindSettingsScope(remote)
    scopeCtx.effect(installStyle, 'paimind-user-settings: style')
    contributePaimindExtension(scopeCtx.slots, {
      id: 'paimind:user-settings', packageName: '@hansen/user-settings', category: 'experience',
      nameZh: '个性化', nameEn: 'Personalization',
      descriptionZh: '设置沟通风格、工作背景和回复要求，控制是否用于后续回复。',
      descriptionEn: 'Set communication style, work background, and response requirements for future responses.',
      surface: 'settings', maturity: 'technical-preview', order: 20,
    })
    scopeCtx.effect(() => () => { scope.dispose() }, 'paimind-user-settings: scope')
    scopeCtx.slots.inject('settings.section', () => scopeCtx.slots.register({
      name: 'settings.section', id: 'paimind-user-settings', order: 24,
      label: () => scopeCtx.locale.getLocale().active.startsWith('zh') ? '个性化' : 'Personalization',
      children: { 'paimind.personalization.appearance': { kind: 'list', scope: 'root' } },
    }, (props: { readonly renderSlot: (name: 'paimind.personalization.appearance', owner: object) => ReactNode }) => <UserSettingsSection scope={scope} zh={scopeCtx.locale.getLocale().active.startsWith('zh')} appearance={props.renderSlot('paimind.personalization.appearance', {})} />))
  })
  try { await mounted } catch (error) { await disposeRemote(); throw error }
  return async () => { await mounted.dispose(); await disposeRemote() }
}
