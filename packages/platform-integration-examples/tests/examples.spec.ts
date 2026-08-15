import { describe, expect, it, vi } from 'vitest'
import { PaimindReplayGuard, signPaimindRequest } from '@paimind/platform-sdk'
import {
  acceptExampleHttpAction,
  createExampleCustomAdapter,
  registerExampleHarnessAction,
  sendExampleNotification,
} from '../src/index.ts'
import { installPaimindExampleHarnessPlugin } from '../src/harness-plugin.ts'

const request = {
  contractVersion: '1.0' as const, runId: 'run:one', scheduleId: 'schedule:one', actionId: 'action:one', trigger: 'schedule' as const,
  scheduledFor: '2026-08-15T01:00:00.000Z', idempotencyKey: 'key:one',
  callbackUrl: 'https://platform.example.test/callback',
}

describe('executable platform integration examples', () => {
  it('exposes an isolated Harness QA plugin that registers and unloads its action', async () => {
    const dispose = vi.fn()
    const registerAction = vi.fn(async () => dispose)
    let cleanup: undefined | (() => void | Promise<void>)
    const ctx = {
      paimindHarnessScheduleAdapter: { registerAction },
      paimindScheduler: { list: vi.fn(), create: vi.fn() },
      effect: (install: () => void | (() => void | Promise<void>)) => { cleanup = install() || undefined },
    }
    installPaimindExampleHarnessPlugin(ctx)
    await vi.waitFor(() => { expect(registerAction).toHaveBeenCalledTimes(1) })
    await cleanup?.()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('registers Harness action code and executes custom translation', async () => {
    const registerAction = vi.fn(async () => () => {})
    await registerExampleHarnessAction({ registerAction }, {
      cwd: '/srv/example-project', provider: 'provider:test', model: 'model:test',
    })
    expect(registerAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'example:weekly-project-brief', cwd: '/srv/example-project',
      provider: 'provider:test', model: 'model:test',
    }))
    const executor = createExampleCustomAdapter({
      createTask: async input => ({ url: `https://business.example.test/tasks/${input.idempotencyKey}` }),
    })
    expect(await executor(request, new AbortController().signal)).toMatchObject({
      status: 'succeeded', action: { kind: 'external' },
    })
  })

  it('runs the standard 202/callback and notification examples', async () => {
    const reportRun = vi.fn(async () => ({}))
    const send = vi.fn(async () => ({}))
    const client = { schedules: { registerAction: vi.fn(), deactivateAction: vi.fn(), reportRun }, notifications: { send } }
    const secret = 'example-secret-that-is-longer-than-thirty-two-characters'
    const signature = { method: 'POST', path: '/action', timestamp: '1000', requestId: 'request:one', body: JSON.stringify(request) }
    const accepted = acceptExampleHttpAction({
      signature, receivedSignature: signPaimindRequest(signature, secret), secret, request,
      client, replay: new PaimindReplayGuard(500), now: 1_000,
    })
    expect(accepted.status).toBe(202)
    await accepted.completion
    expect(reportRun).toHaveBeenCalledTimes(2)
    await sendExampleNotification(client)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['user:example'] }))
  })
})
