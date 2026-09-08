// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { PaimindMcpCenterService, type McpCenterHostContext } from '../../mcp-center/src/index.js'
import * as feishu from '../../feishu-cli-mcp/src/index.js'

it('runs a generic Center without adapters and disposes only source-owned templates across provider reloads', async () => {
  const ctx = new Context()
  ctx.provide('agents', { list: () => [] })
  ctx.provide('tools', { guard: () => () => {} })
  let service!: PaimindMcpCenterService
  const probe = vi.fn(async () => [{ name: 'query', description: 'Generic data query' }])
  try {
    await ctx.plugin({ name: 'template-test-center', apply: (scope: Context) => {
      service = new PaimindMcpCenterService(scope as unknown as McpCenterHostContext, {
        owner: { currentOwner: () => 'test' }, repository: { load: async () => [], replace: async () => {} },
        runtime: { probe, mount: async () => { throw new Error('No Agent was bound') }, preset: () => undefined, credential: async () => '' },
      })
    } })
    expect((await service.templates()).items).toEqual([])
    const removeGeneric = service.registerTemplate({ id: 'generic-http', name: '数据库', description: 'Generic server', configuration: { transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: {}, category: 'data', enabled: true, timeoutMs: 5000 } })
    const template = (await service.templates()).items[0]!
    expect(() => service.registerTemplate(template)).toThrow('already registered')
    template.name = 'Mutated caller copy'
    expect((await service.templates()).items[0]!.name).toBe('数据库')
    for (let cycle = 0; cycle < 2; cycle++) {
      const provider = ctx.plugin(feishu)
      await provider
      expect((await service.templates()).items.map(item => item.id)).toEqual(['generic-http', 'feishu-cli'])
      await provider.dispose()
      expect((await service.templates()).items.map(item => item.id)).toEqual(['generic-http'])
    }
    const saved = await service.save({ expectedRevision: 0, configuration: { ...template.configuration, id: 'a'.repeat(32), name: 'Independent generic connection' } })
    expect((await service.probe({ id: saved.connection.configuration.id, expectedRevision: 1 })).probe?.status).toBe('passed')
    expect(probe).toHaveBeenCalledOnce()
    removeGeneric(); removeGeneric()
    expect((await service.templates()).items).toEqual([])
    expect((await service.list()).items).toHaveLength(1)
  } finally { await ctx.fiber.dispose() }
})
