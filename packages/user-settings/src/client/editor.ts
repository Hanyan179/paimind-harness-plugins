import type { PaimindSettingsScope } from '@paimind/harness-compat'
import { DEFAULT_PAIMIND_PERSONALIZATION, type PaimindPersonalization } from '../preferences.js'

type TextFields = Pick<PaimindPersonalization, 'aboutMe' | 'customInstructions'>
type Feedback = 'idle' | 'saving' | 'saved' | 'failed' | 'partial' | 'conflict'
type EditorScope = PaimindSettingsScope<PaimindPersonalization> & {
  saveText?(value: TextFields): Promise<void>
  load?(): Promise<void>
}

/** Unsaved UI state belongs to this mounted plugin scope, never browser storage. */
class PersonalizationEditor {
  private baseline: Readonly<PaimindPersonalization>
  private state: { readonly draft: TextFields; readonly busy: boolean; readonly feedback: Feedback }
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private disposed = false
  private readonly guardUnload = (event: BeforeUnloadEvent): void => {
    if (this.dirty) { event.preventDefault(); event.returnValue = '' }
  }

  constructor(readonly scope: EditorScope) {
    this.baseline = scope.getSnapshot().value ?? DEFAULT_PAIMIND_PERSONALIZATION
    this.state = { draft: this.textOf(this.baseline), busy: false, feedback: 'idle' }
    this.unsubscribe = scope.subscribe(() => this.reconcile())
  }

  getSnapshot = (): typeof this.state => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get dirty(): boolean { return !this.matches(this.state.draft, this.baseline) }
  get canRetry(): boolean { return this.scope.load !== undefined }

  edit(field: keyof TextFields, value: string): void {
    if (this.state.busy || this.disposed) return
    this.update({ draft: { ...this.state.draft, [field]: value }, feedback: 'idle' })
  }

  discard(): void {
    if (!this.state.busy) this.update({ draft: this.textOf(this.baseline), feedback: 'idle' })
  }

  async setField(field: 'enabled' | 'personality', value: boolean | PaimindPersonalization['personality']): Promise<void> {
    await this.write(async () => { await this.scope.set(field, value) }, () => this.scope.getSnapshot().value?.[field] === value)
  }

  async save(): Promise<void> {
    const draft = this.state.draft
    await this.write(async () => {
      if (this.scope.saveText) { await this.scope.saveText(draft); return }
      // Preserve the published generic Scope consumer contract. The live Remote uses one atomic write.
      for (const field of ['aboutMe', 'customInstructions'] as const) {
        if (this.scope.getSnapshot().value?.[field] === draft[field]) continue
        await this.scope.set(field, draft[field])
        if (this.scope.getSnapshot().value?.[field] !== draft[field]) break
      }
    }, () => this.matches(draft, this.scope.getSnapshot().value))
  }

  async retry(): Promise<void> {
    if (this.state.busy || !this.scope.load || this.disposed) return
    this.update({ busy: true })
    try { await this.scope.load() } catch { /* unavailable state remains visible */ }
    finally { if (!this.disposed) this.update({ busy: false }) }
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.listeners.clear()
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.guardUnload)
  }

  private async write(action: () => Promise<void>, committed: () => boolean): Promise<void> {
    if (this.disposed || this.state.busy || !this.scope.getSnapshot().writable) return
    const previous = this.scope.getSnapshot().value
    this.update({ busy: true, feedback: 'saving' })
    try { await action() } catch { /* readback and draft determine the visible result */ }
    if (this.disposed) return
    const current = this.scope.getSnapshot().value
    this.update({ busy: false, feedback: committed() ? 'saved'
      : current && previous && !this.matches(current, previous) ? 'partial' : 'failed' })
  }

  private reconcile(): void {
    const next = this.scope.getSnapshot().value
    if (!next || this.disposed) return
    const draft = { ...this.state.draft }
    let conflict = false
    for (const field of ['aboutMe', 'customInstructions'] as const) {
      if (draft[field] === this.baseline[field]) draft[field] = next[field]
      else if (next[field] !== this.baseline[field] && next[field] !== draft[field]) conflict = true
    }
    this.baseline = next
    this.update({ draft, ...(conflict && !this.state.busy ? { feedback: 'conflict' as const } : {}) })
  }

  private textOf(value: Readonly<PaimindPersonalization>): TextFields { return { aboutMe: value.aboutMe, customInstructions: value.customInstructions } }
  private matches(a: TextFields, b: TextFields | undefined): boolean { return a.aboutMe === b?.aboutMe && a.customInstructions === b?.customInstructions }
  private update(patch: Partial<typeof this.state>): void {
    this.state = { ...this.state, ...patch }
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.guardUnload)
      if (this.dirty) window.addEventListener('beforeunload', this.guardUnload)
    }
    for (const listener of this.listeners) listener()
  }
}

const editors = new WeakMap<PaimindSettingsScope<PaimindPersonalization>, PersonalizationEditor>()
export function getPersonalizationEditor(scope: PaimindSettingsScope<PaimindPersonalization>): PersonalizationEditor {
  let editor = editors.get(scope)
  if (!editor) { editor = new PersonalizationEditor(scope); editors.set(scope, editor) }
  return editor
}
export function releasePersonalizationEditor(scope: PaimindSettingsScope<PaimindPersonalization>): void {
  editors.get(scope)?.dispose()
  editors.delete(scope)
}
