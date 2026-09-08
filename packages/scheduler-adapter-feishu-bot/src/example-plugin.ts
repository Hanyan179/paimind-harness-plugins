import { PaimindHostService } from '@hansen/harness-compat/host'
import type { PaimindScheduleCreateInput, PaimindScheduleDefinition } from '@hansen/contracts'
import type { PaimindSchedulerServiceApi, PaimindSchedulerSnapshot } from '@hansen/platform-scheduler'
import type { PaimindFeishuBotScheduleAdapter } from './index.js'

export const name = 'paimind-scheduler-adapter-feishu-bot-example'

export interface PaimindFeishuBotExampleContext {
  readonly paimindFeishuBotScheduleAdapter: PaimindFeishuBotScheduleAdapter
  readonly paimindScheduler: PaimindSchedulerServiceApi & {
    create(input: PaimindScheduleCreateInput): Promise<Readonly<PaimindScheduleDefinition>>
    list(): Promise<PaimindSchedulerSnapshot>
  }
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export function installPaimindFeishuBotExample(ctx: PaimindFeishuBotExampleContext): void {
  const keyword = process.env.PAIMIND_FEISHU_BOT_KEYWORD?.trim() || '测试'
  const ready = ctx.paimindFeishuBotScheduleAdapter.registerAction({
    actionId: 'example:feishu-bot-keyword-test',
    source: { id: 'service:feishu-bot', nameZh: '飞书机器人', nameEn: 'Feishu bot' },
    nameZh: '飞书机器人关键词测试',
    nameEn: 'Feishu bot keyword test',
    descriptionZh: '由平台按时间向已登记飞书群机器人发送包含安全关键词的测试消息。',
    descriptionEn: 'Send a keyword-safe test message to a registered Feishu group bot on schedule.',
    credentialRef: 'credential:feishu-bot-rq103',
    keyword,
    message: request => [
      `【PAIMind 定时任务${keyword}】`,
      'PAIMind 已触发飞书机器人事项。',
      `Trigger: ${request.trigger}`,
      `Run: ${request.runId}`,
      `Scheduled for: ${request.scheduledFor}`,
      `Idempotency key: ${request.idempotencyKey}`,
    ].join('\n'),
  })
  if (process.env.PAIMIND_FEISHU_BOT_E2E === '1') {
    void ready.then(async () => {
      const taskName = 'RQ-103 飞书机器人端到端测试'
      if ((await ctx.paimindScheduler.list()).definitions.some(item => item.name === taskName)) return
      await ctx.paimindScheduler.create({
        name: taskName,
        actionId: 'example:feishu-bot-keyword-test',
        rule: { kind: 'once', at: new Date(Date.now() + 8_000).toISOString() },
        timeZone: 'Asia/Shanghai',
        enabled: true,
      })
    }).catch(error => { console.warn('[paimind-feishu-bot-example] automatic E2E task failed', error) })
  }
  ctx.effect(() => async () => { (await ready)() }, 'paimind-feishu-bot-example: action')
}

/** Optional acceptance action. Production profiles should register business-owned actions instead. */
export class PaimindFeishuBotExamplePlugin extends PaimindHostService {
  static inject = ['paimindFeishuBotScheduleAdapter', 'paimindScheduler']

  constructor(ctx: PaimindFeishuBotExampleContext) {
    super(ctx, 'paimindFeishuBotExamplePlugin')
    installPaimindFeishuBotExample(ctx)
  }
}

export default PaimindFeishuBotExamplePlugin
