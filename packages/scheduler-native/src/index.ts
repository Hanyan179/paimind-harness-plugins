import {
  PaimindHostRemoteService,
  listPaimindNativeSchedules,
  markPaimindHostRemoteMethods,
  type PaimindHostScheduleSessionStore,
  type PaimindNativeScheduleView,
} from '@paimind/harness-compat/host'

export const name = 'paimind-scheduler'

export interface PaimindNativeScheduleListRequest {
  readonly sessionId: string
}

export interface PaimindNativeScheduleListValue {
  readonly sessionId: string
  readonly items: readonly Readonly<PaimindNativeScheduleView>[]
}

export interface PaimindNativeScheduleHostContext {
  readonly sessions: PaimindHostScheduleSessionStore
}

/** Read-only Remote over the canonical Harness Session event log. */
export class PaimindNativeScheduleService extends PaimindHostRemoteService {
  static inject = ['sessions']
  private readonly sessions: PaimindHostScheduleSessionStore

  constructor(ctx: PaimindNativeScheduleHostContext) {
    super(ctx, 'paimindSchedule')
    this.sessions = ctx.sessions
    markPaimindHostRemoteMethods(this, ['list'])
  }

  async list(request: PaimindNativeScheduleListRequest): Promise<PaimindNativeScheduleListValue> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(request.sessionId)) {
      throw new Error('Invalid Harness Session id')
    }
    return Object.freeze({
      sessionId: request.sessionId,
      items: listPaimindNativeSchedules(this.sessions, request.sessionId),
    })
  }
}

export default PaimindNativeScheduleService
