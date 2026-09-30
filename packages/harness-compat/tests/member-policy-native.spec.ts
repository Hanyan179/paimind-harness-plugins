// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, type ToolDefinition, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { definePaimindHarnessTool } from '../src/host.js'
import { installManagedHarnessToolGuard } from '../src/managed-runtime.js'
import { createMemberToolGuard, parseMemberCellPolicy, createManagedToolGuard, parseManagedCellPolicy } from '../../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'

describe('member policy through the real native dispatcher, not Browser E2E', () => {
  it('executes an allowed scoped call, rejects privileged/unscoped calls before their body and denies after withdrawal', async () => {
    const root = new Context()
    try {
      const policy = parseMemberCellPolicy(JSON.stringify({ schemaVersion: 1, cellId: randomUUID(), userId: randomUUID(),
        tenantId: 'native-dispatch-test', role: 'member', policy: 'member-personal-v1' }))
      const guard = installManagedHarnessToolGuard(root, createMemberToolGuard(policy))
      await root.plugin(SystemPrompt, {})
      const provider = await root.plugin(ToolRuntime, { mode: 'native' })
      await vi.waitFor(() => guard.assertReady())
      const calls: string[] = []
      for (const name of ['read', 'cordis']) {
        root.tools.register(definePaimindHarnessTool({ name, description: 'Synthetic body for real native dispatch', parameters: {},
          output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
            render: () => [{ type: 'text', text: 'executed' }] },
          execute: async () => { calls.push(name); return { ok: true } },
        }) as ToolDefinition)
      }
      const agent = { id: 'native-owned-agent', session: { id: 'native-owned-session', events: [] } } as ToolExecutionInput['agent']
      const invoke = (name: string, scoped = true) => root.tools.execute({ name,
        callId: randomUUID() as ToolExecutionInput['callId'], arguments: {}, signal: new AbortController().signal,
        ...(scoped ? { agent } : {}) })
      expect((await invoke('read')).isError).not.toBe(true)
      expect(calls).toEqual(['read'])
      expect((await invoke('cordis')).isError).toBe(true)
      expect((await invoke('read', false)).isError).toBe(true)
      expect(calls).toEqual(['read'])
      const retained = root.tools
      await provider.dispose()
      await vi.waitFor(() => expect(() => guard.assertReady()).toThrow('not active'))
      expect((await retained.execute({ name: 'read', callId: randomUUID() as ToolExecutionInput['callId'], arguments: {},
        signal: new AbortController().signal, agent })).isError).toBe(true)
      expect(calls).toEqual(['read'])
    } finally { await root.fiber.dispose() }
  })
})

describe('administrator policy through the original native tool dispatcher', () => {
  it('permits scoped Skill authoring while rejecting platform tools and unscoped calls, including after provider disposal', async () => {
    const root = new Context()
    try {
      const policy = parseManagedCellPolicy(JSON.stringify({ schemaVersion: 1, cellId: randomUUID(), userId: randomUUID(),
        tenantId: 'native-admin-dispatch-test', role: 'admin', policy: 'admin-authoring-v1' }))
      const guard = installManagedHarnessToolGuard(root, createManagedToolGuard(policy))
      await root.plugin(SystemPrompt, {})
      const provider = await root.plugin(ToolRuntime, { mode: 'native' })
      await vi.waitFor(() => guard.assertReady())
      const calls: string[] = []
      for (const name of ['paimind_skill_prepare_create', 'paimind_skill_install', 'cordis', 'credentials.set']) {
        root.tools.register(definePaimindHarnessTool({ name, description: 'Synthetic body for real native policy dispatch', parameters: {},
          output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
            render: () => [{ type: 'text', text: 'executed' }] },
          execute: async () => { calls.push(name); return { ok: true } },
        }) as ToolDefinition)
      }
      const agent = { id: 'native-admin-agent', session: { id: 'native-admin-session', events: [] } } as ToolExecutionInput['agent']
      const invoke = (name: string, scoped = true) => root.tools.execute({ name, callId: randomUUID() as ToolExecutionInput['callId'],
        arguments: { role: 'admin' }, signal: new AbortController().signal, ...(scoped ? { agent } : {}) })
      expect((await invoke('paimind_skill_prepare_create')).isError).not.toBe(true)
      expect((await invoke('paimind_skill_install')).isError).not.toBe(true)
      expect((await invoke('paimind_skill_install', false)).isError).toBe(true)
      expect((await invoke('cordis')).isError).toBe(true); expect((await invoke('credentials.set')).isError).toBe(true)
      expect(calls).toEqual(['paimind_skill_prepare_create', 'paimind_skill_install'])
      const retained = root.tools
      await provider.dispose(); await vi.waitFor(() => expect(() => guard.assertReady()).toThrow('not active'))
      expect((await retained.execute({ name: 'paimind_skill_install', callId: randomUUID() as ToolExecutionInput['callId'],
        arguments: {}, signal: new AbortController().signal, agent })).isError).toBe(true)
      expect(calls).toHaveLength(2)
    } finally { await root.fiber.dispose() }
  })
})
