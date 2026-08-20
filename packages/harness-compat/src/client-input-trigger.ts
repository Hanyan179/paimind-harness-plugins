/**
 * RC8-only bridge for PAIMind's reversible Composer trigger semantics.
 *
 * The frozen public InputTriggerService contract cannot enumerate or pause a
 * source, and InputBar's resident plus launcher is hard-wired to `command`.
 * This adapter therefore validates the exact RC8 live registry shape, keeps
 * the native `reference` source in place (so its codec remains authoritative),
 * temporarily replaces only its `candidates` method, delegates PAIMind Skill
 * discovery/picks to rc.8's resident native `skill` source, and registers
 * additive Agent / Skill / Context sources through the public registration API.
 */

export interface HarnessInputTriggerCandidate {
  readonly name: string
  readonly description?: string
  readonly icon?: string
  readonly hint?: string
  readonly section?: string
  readonly value?: string
}

export interface HarnessInputTriggerCandidateRequest {
  readonly query: string
  readonly quoted?: boolean
  readonly position: 'leading' | 'inline'
  readonly signal: AbortSignal
}

export interface HarnessInputTriggerSession {
  readonly sessionId: string
}

export interface HarnessInputTriggerSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface HarnessReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance?: 'session' | 'file' | 'folder'
  readonly clipboardText: string
}

export type HarnessInputTriggerOutcome =
  | { readonly claim: unknown }
  | { readonly insert: HarnessReferenceInsert }
  | { readonly text: string; readonly continue?: boolean }
  | 'handled'
  | undefined

export interface HarnessInputTriggerPick {
  readonly candidate: HarnessInputTriggerCandidate
  readonly session: HarnessInputTriggerSession
  readonly position: 'leading' | 'inline'
  readonly via: 'menu' | 'space' | 'enter'
  readonly span: HarnessInputTriggerSpan
}

export interface HarnessInputTriggerSource {
  readonly trigger: '/' | '@'
  readonly name: string
  readonly order?: number
  readonly showGroupTitle?: boolean
  candidates(
    session: HarnessInputTriggerSession,
    request: HarnessInputTriggerCandidateRequest,
  ): Promise<readonly HarnessInputTriggerCandidate[]>
  onPick(pick: HarnessInputTriggerPick): HarnessInputTriggerOutcome
  readonly codec?: unknown
}

export interface HarnessComposerInputSnapshot {
  readonly draft: string
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

interface SnapshotStoreLike<T> {
  getSnapshot(): T
}

interface ControllerLike {
  readonly launcher?: SnapshotStoreLike<string | null>
  readonly menu?: SnapshotStoreLike<{ readonly open?: boolean }>
  toggleSource(source: string, hit: {
    readonly trigger: '@'
    readonly query: string
    readonly quoted: false
    readonly position: 'leading' | 'inline'
    readonly span: HarnessInputTriggerSpan
  }): void
  dismiss(): void
}

interface InputTriggerLiveState {
  readonly sources: HarnessInputTriggerSource[]
  readonly controllers: Map<unknown, ControllerLike>
}

interface InputTriggerServiceLike {
  readonly live?: InputTriggerLiveState
  registerSource(source: HarnessInputTriggerSource): () => void
  sessionOf(scope: unknown): ControllerLike
}

interface SessionsLike {
  scope(sessionId: string): unknown
  binding?(sessionId: string): {
    readonly session?: { getSnapshot(): { readonly blank?: boolean } }
  } | undefined
}

const CONTEXT_SOURCE = 'paimind-context'

function inputTriggerService(value: unknown): InputTriggerServiceLike | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as InputTriggerServiceLike
  if (typeof candidate.registerSource !== 'function' || typeof candidate.sessionOf !== 'function') return null
  const live = candidate.live
  if (typeof live !== 'object' || live === null || !Array.isArray(live.sources)
    || !(live.controllers instanceof Map)) return null
  return candidate
}

function sessionsService(value: unknown): SessionsLike | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as SessionsLike
  return typeof candidate.scope === 'function' ? candidate : null
}

function isTextContinuation(outcome: HarnessInputTriggerOutcome): outcome is {
  readonly text: string
  readonly continue: true
} {
  return typeof outcome === 'object' && outcome !== null && 'text' in outcome
    && typeof outcome.text === 'string' && outcome.continue === true
}

function referenceQuery(text: string): string {
  return text.startsWith('@') ? text.slice(1) : text
}

/**
 * Reversible adapter over RC8's concrete InputTriggerService.
 * Failure is deliberately fail-open: Native behavior remains untouched when
 * the exact registry or reference-source shape cannot be proven.
 */
export class NativeHarnessInputTriggerBridge {
  private readonly inputTriggers: InputTriggerServiceLike | null
  private readonly sessions: SessionsLike | null
  private nativeReference: HarnessInputTriggerSource | null = null
  private nativeCandidatesDescriptor: PropertyDescriptor | null = null
  private nativeCandidates: HarnessInputTriggerSource['candidates'] | null = null
  private nativeSkill: HarnessInputTriggerSource | null = null
  private nativeSkillCandidatesDescriptor: PropertyDescriptor | null = null
  private nativeSkillCandidatesOwner: HarnessInputTriggerSource['candidates'] | null = null
  private registeredDisposers: Array<() => void> = []
  private readonly pendingContextQuery = new Map<string, string>()
  private active = false
  private disposed = false

  constructor(inputTriggers: unknown, sessions: unknown) {
    this.inputTriggers = inputTriggerService(inputTriggers)
    this.sessions = sessionsService(sessions)
  }

  /** Whether the exact RC8 bridge prerequisites are present. */
  isAvailable(): boolean {
    return this.resolveNativeReference() !== null && this.resolveNativeSkill() !== null
      && this.sessions !== null
  }

  /** The canonical blank-Session gate required by native Agent Preset staging. */
  isBlankSession(sessionId: string): boolean {
    return this.sessions?.binding?.(sessionId)?.session?.getSnapshot().blank === true
  }

  /**
   * Reuse rc.8's native Skill catalog owner instead of opening a second
   * `skill.list` cache. The native source retains Session prewarm, Preset and
   * connection invalidation, subagent policy, and failure semantics.
   */
  nativeSkillCandidates(
    session: HarnessInputTriggerSession,
    request: HarnessInputTriggerCandidateRequest,
  ): Promise<readonly HarnessInputTriggerCandidate[]> {
    const source = this.nativeSkill ?? this.resolveNativeSkill()
    const candidates = this.nativeSkillCandidatesOwner ?? source?.candidates
    return source === null || candidates === undefined
      ? Promise.resolve([])
      : candidates.call(source, session, request)
  }

  /** Route an @ Skill pick through the native `/name ` outcome owner. */
  pickNativeSkill(pick: HarnessInputTriggerPick): HarnessInputTriggerOutcome {
    const source = this.nativeSkill ?? this.resolveNativeSkill()
    return source?.onPick.call(source, pick)
  }

  /**
   * Enter PAIMind semantics. The native reference object stays in the roster
   * at the same index with the same codec; only discovery is paused.
   */
  activate(sources: readonly HarnessInputTriggerSource[]): boolean {
    if (this.disposed || this.active || this.inputTriggers === null || this.sessions === null) return this.active
    const nativeReference = this.resolveNativeReference()
    const nativeSkill = this.resolveNativeSkill()
    if (nativeReference === null || nativeSkill === null) return false
    const descriptor = Object.getOwnPropertyDescriptor(nativeReference, 'candidates')
    const skillDescriptor = Object.getOwnPropertyDescriptor(nativeSkill, 'candidates')
    if (descriptor === undefined || skillDescriptor === undefined
      || typeof descriptor.value !== 'function' || typeof skillDescriptor.value !== 'function'
      || descriptor.configurable !== true || descriptor.writable !== true
      || skillDescriptor.configurable !== true || skillDescriptor.writable !== true) return false

    this.nativeReference = nativeReference
    this.nativeCandidatesDescriptor = descriptor
    this.nativeCandidates = descriptor.value as HarnessInputTriggerSource['candidates']
    this.nativeSkill = nativeSkill
    this.nativeSkillCandidatesDescriptor = skillDescriptor
    this.nativeSkillCandidatesOwner = skillDescriptor.value as HarnessInputTriggerSource['candidates']
    const pausedCandidates: HarnessInputTriggerSource['candidates'] = async () => []
    Object.defineProperty(nativeReference, 'candidates', { ...descriptor, value: pausedCandidates })
    // `@` is the single Agent / Skill chooser in PAIMind mode. Keep the native
    // Skill source and pick owner intact, but hide its discovery rows from `/`.
    Object.defineProperty(nativeSkill, 'candidates', { ...skillDescriptor, value: pausedCandidates })

    const contextSource: HarnessInputTriggerSource = {
      trigger: '@',
      name: CONTEXT_SOURCE,
      order: -5,
      showGroupTitle: false,
      candidates: async (session, request) => {
        const query = this.pendingContextQuery.get(session.sessionId)
        if (query === undefined || this.nativeCandidates === null || this.nativeReference === null) return []
        this.pendingContextQuery.delete(session.sessionId)
        return this.nativeCandidates.call(this.nativeReference, session, { ...request, query })
      },
      onPick: pick => {
        if (this.nativeReference === null) return undefined
        const outcome = this.nativeReference.onPick.call(this.nativeReference, pick)
        if (isTextContinuation(outcome)) {
          const query = referenceQuery(outcome.text)
          queueMicrotask(() => {
            this.openContextAt(pick.session.sessionId, pick.span, query)
          })
          return 'handled'
        }
        return outcome
      },
    }

    try {
      this.registeredDisposers = [...sources, contextSource]
        .map(source => this.inputTriggers!.registerSource(source))
      this.active = true
      this.dismissLiveMenus()
      return true
    } catch (error) {
      for (const dispose of this.registeredDisposers.reverse()) dispose()
      this.registeredDisposers = []
      Object.defineProperty(nativeReference, 'candidates', descriptor)
      Object.defineProperty(nativeSkill, 'candidates', skillDescriptor)
      this.nativeReference = null
      this.nativeCandidatesDescriptor = null
      this.nativeCandidates = null
      this.nativeSkill = null
      this.nativeSkillCandidatesDescriptor = null
      this.nativeSkillCandidatesOwner = null
      throw error
    }
  }

  /** Restore the exact native source method and remove every additive source. */
  restore(): void {
    if (!this.active) return
    this.dismissLiveMenus()
    for (const dispose of this.registeredDisposers.reverse()) dispose()
    this.registeredDisposers = []
    if (this.nativeReference !== null && this.nativeCandidatesDescriptor !== null) {
      Object.defineProperty(this.nativeReference, 'candidates', this.nativeCandidatesDescriptor)
    }
    if (this.nativeSkill !== null && this.nativeSkillCandidatesDescriptor !== null) {
      Object.defineProperty(this.nativeSkill, 'candidates', this.nativeSkillCandidatesDescriptor)
    }
    this.pendingContextQuery.clear()
    this.nativeReference = null
    this.nativeCandidatesDescriptor = null
    this.nativeCandidates = null
    this.nativeSkill = null
    this.nativeSkillCandidatesDescriptor = null
    this.nativeSkillCandidatesOwner = null
    this.active = false
  }

  /**
   * Launch the canonical reference provider through the resident controller.
   * Its pick path therefore retains the native draftRev CAS and input undo log.
   */
  toggleContext(sessionId: string, input: HarnessComposerInputSnapshot): boolean {
    if (!this.active || input.phase !== 'plain') return false
    const controller = this.controller(sessionId)
    if (controller === null) return false
    const open = controller.launcher?.getSnapshot() === CONTEXT_SOURCE
      && controller.menu?.getSnapshot().open === true
    if (open) {
      this.pendingContextQuery.delete(sessionId)
      controller.dismiss()
      return true
    }
    const at = input.draft.length
    return this.openContextAt(sessionId, { start: at, end: at, draftRev: input.draftRev }, '')
  }

  dispose(): void {
    if (this.disposed) return
    this.restore()
    this.disposed = true
  }

  private resolveNativeReference(): HarnessInputTriggerSource | null {
    const sources = this.inputTriggers?.live?.sources
    if (sources === undefined) return null
    const matches = sources.filter(source => source.trigger === '@' && source.name === 'reference')
    const source = matches.length === 1 ? matches[0] : undefined
    return source !== undefined && typeof source.candidates === 'function'
      && typeof source.onPick === 'function' && source.codec !== undefined ? source : null
  }

  private resolveNativeSkill(): HarnessInputTriggerSource | null {
    const sources = this.inputTriggers?.live?.sources
    if (sources === undefined) return null
    const matches = sources.filter(source => source.trigger === '/' && source.name === 'skill')
    const source = matches.length === 1 ? matches[0] : undefined
    return source !== undefined && typeof source.candidates === 'function'
      && typeof source.onPick === 'function' ? source : null
  }

  private controller(sessionId: string): ControllerLike | null {
    const scope = this.sessions?.scope(sessionId)
    if (scope === undefined || this.inputTriggers === null) return null
    try {
      const controller = this.inputTriggers.sessionOf(scope)
      return typeof controller?.toggleSource === 'function' && typeof controller.dismiss === 'function'
        ? controller : null
    } catch {
      return null
    }
  }

  private openContextAt(sessionId: string, span: HarnessInputTriggerSpan, query: string): boolean {
    if (!this.active) return false
    const controller = this.controller(sessionId)
    if (controller === null) return false
    // The pointer-owned Context browser must replace an open keyboard trigger
    // menu instead of sharing its stale `/` or `@` state.
    controller.dismiss()
    this.pendingContextQuery.set(sessionId, query)
    controller.toggleSource(CONTEXT_SOURCE, {
      trigger: '@', query, quoted: false,
      position: span.start === 0 ? 'leading' : 'inline', span,
    })
    return true
  }

  private dismissLiveMenus(): void {
    for (const controller of this.inputTriggers?.live?.controllers.values() ?? []) controller.dismiss()
  }
}
