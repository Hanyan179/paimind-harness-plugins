import { PaimindHostService } from '@paimind/harness-compat/host'
import type { PaimindScheduleCreateInput, PaimindScheduleDefinition } from '@paimind/contracts'
import type { PaimindSchedulerServiceApi, PaimindSchedulerSnapshot } from '@paimind/platform-scheduler'
import type { PaimindHarnessScheduleAdapter } from '@paimind/scheduler-adapter-harness'
import { registerExampleHarnessAction } from './index.js'

export const name = 'paimind-platform-integration-examples'

export interface PaimindExampleHarnessPluginContext {
  readonly paimindHarnessScheduleAdapter: PaimindHarnessScheduleAdapter
  readonly paimindScheduler: PaimindSchedulerServiceApi & {
    create(input: PaimindScheduleCreateInput): Promise<Readonly<PaimindScheduleDefinition>>
    list(): Promise<PaimindSchedulerSnapshot>
  }
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export function installPaimindExampleHarnessPlugin(ctx: PaimindExampleHarnessPluginContext): void {
  const ready = registerExampleHarnessAction(ctx.paimindHarnessScheduleAdapter)
  if (process.env.PAIMIND_RQ103_E2E === '1') {
    void ready.then(async () => {
      const name = 'RQ-103 Automated Harness Run v5'
      if ((await ctx.paimindScheduler.list()).definitions.some(item => item.name === name)) return
      await ctx.paimindScheduler.create({
        name,
        actionId: 'example:weekly-project-brief',
        rule: { kind: 'once', at: new Date(Date.now() + 8_000).toISOString() },
        timeZone: 'Asia/Shanghai',
        enabled: true,
      })
    }).catch(error => { console.warn('[paimind-rq103-example] automatic acceptance task failed', error) })
  }
  ctx.effect(() => async () => {
    const dispose = await ready
    dispose()
  }, 'paimind-platform-integration-examples: action')
}

/**
 * Isolated QA plugin. It proves that a business package can register an action
 * without adding fields or execution logic to the platform Scheduler itself.
 * It is intentionally not part of the production PAIMind Bundle.
 */
export class PaimindExampleHarnessPlugin extends PaimindHostService {
  static inject = ['paimindHarnessScheduleAdapter', 'paimindScheduler']

  constructor(ctx: PaimindExampleHarnessPluginContext) {
    super(ctx, 'paimindExampleHarnessPlugin')
    installPaimindExampleHarnessPlugin(ctx)
  }
}

export default PaimindExampleHarnessPlugin
