// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it, vi } from 'vitest'
import { readNativeConnectorInventory } from '../src/connector-inventory.js'

const provider = '@deepseek-ai/dsh-mcp-client'
const row = (id = 'mcp-sales', config: unknown = { serverName: 'sales', transport: 'streamable-http' }) => ({ id,
  options: { id, name: provider, config, disabled: false }, disabled: false, fiber: undefined as undefined | { state: number; config?: unknown } })
const read = (entries: unknown[], signal = new AbortController().signal) => readNativeConnectorInventory({ get: () => ({ entries: () => entries.values() }) }, signal)
describe('private original MCP Loader inventory, never a connection or grant', () => {
  it('projects only reviewed metadata and keeps raw settings, locations, credentials and errors private', () => {
    const source = row('parent:mcp-sales', { serverName: 'sales', transport: 'streamable-http', url: 'https://PRIVATE.invalid/?key=PRIVATE',
      headers: { Authorization: 'PRIVATE' }, env: { SECRET: 'PRIVATE' }, command: 'PRIVATE', args: ['PRIVATE'], cwd: '/PRIVATE' })
    const original = JSON.stringify(source)
    const result = read([source, { options: { name: '@other/plugin' }, get id() { throw Error('Do not inspect foreign entry') } }])
    expect(result).toEqual({ schema: 'paimind.native-connectors/v1', scope: 'loader-tree', connection: 'not-probed', entries: [
      { entryId: 'parent:mcp-sales', serverName: 'sales', transport: 'streamable-http', enabled: true, phase: null, configuration: 'recognized' }] })
    expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(JSON.stringify(source)).toBe(original)
    expect(Object.isFrozen(result.entries[0])).toBe(true); expect(Object.isFrozen(result.entries)).toBe(true)
  })
  it('uses effective parent-aware disabledness and original resolved active config without claiming a healthy connection', () => {
    const source = row('mcp-sales', { serverName: { expr: 'DO_NOT_EXECUTE' }, transport: 'private' })
    source.fiber = { state: 2, config: { serverName: 'resolved-sales', transport: 'stdio', env: { SECRET: 'PRIVATE' } } }
    source.disabled = true
    expect(read([source]).entries[0]).toEqual({ entryId: 'mcp-sales', serverName: 'resolved-sales', transport: 'stdio',
      enabled: false, phase: 'active', configuration: 'recognized' })
    expect(read([source]).connection).toBe('not-probed')
  })
  it('does not evaluate expressions or fall back to stale fiber configuration', () => {
    const source = row('mcp-sales', { serverName: { expr: 'PRIVATE' }, transport: 'streamable-http' })
    source.fiber = { state: 3, config: { serverName: 'stale', transport: 'stdio' } }
    expect(read([source]).entries[0]).toEqual({ entryId: 'mcp-sales', serverName: null, transport: 'streamable-http',
      enabled: true, phase: 'failed', configuration: 'unresolved' })
    expect(read([row('other', null)]).entries[0]).toMatchObject({ serverName: null, transport: null, configuration: 'unresolved' })
  })
  it('maps every actual native fiber state without inference and sorts stable native entry ids', () => {
    const phases = ['pending','loading','active','failed','disposed','unloading']
    const sources = phases.map((_, state) => ({ ...row('c' + state), fiber: { state, config: { serverName: 's' + state, transport: 'stdio' } } }))
    expect(read(sources.reverse()).entries.map(e => e.phase)).toEqual(phases)
  })
  it('fails closed for missing source, invalid identities, unknown lifecycle and duplicate runtime ids', () => {
    expect(() => readNativeConnectorInventory({ get: () => undefined }, new AbortController().signal)).toThrow('Native connector inventory unavailable')
    for (const sources of [[row('bad/id')], [row('one'),row('one')], [{ ...row(), disabled: 'false' }],
      [{ ...row(), fiber: { state: 999 } }]]) expect(() => read(sources)).toThrow('Native connector inventory unavailable')
    expect(read([row('one'),row('two')]).entries).toHaveLength(2) // Same namespace is observable, not silently coalesced.
  })
  it('bounds traversal and connector output rather than silently truncating a management inventory', () => {
    expect(read(Array.from({ length: 128 }, (_, i) => row('m' + i))).entries).toHaveLength(128)
    expect(() => read(Array.from({ length: 129 }, (_, i) => row('m' + i)))).toThrow()
    expect(() => read(Array.from({ length: 4097 }, () => ({ options: { name: '@unrelated' } })))).toThrow()
  })
  it('bounds source errors and cancels without accessing a missing source or returning partial data', () => {
    const signal = AbortSignal.abort(), get = vi.fn()
    expect(() => readNativeConnectorInventory({ get }, signal)).toThrow(); expect(get).not.toHaveBeenCalled()
    const source = { ...row(), get disabled() { throw Error('PRIVATE-CREDENTIAL') } }
    expect(() => read([source])).toThrow('Native connector inventory unavailable')
    try { read([source]) } catch (error) { expect(String(error)).not.toContain('PRIVATE-CREDENTIAL') }
    const stop = new AbortController()
    const loader = { *entries() { yield row('first'); stop.abort(); yield row('second') } }
    expect(() => readNativeConnectorInventory({ get: () => loader }, stop.signal)).toThrow()
  })
  it('reads the real selected Cordis Loader and parent state without importing, connecting or changing entries', async () => {
    const root = new Context()
    try {
      await root.plugin(Loader)
      root.loader.builtins.group = Group
      const parent = await root.loader.create({ name: 'cordis:group', group: true, config: [] })
      const id = await root.loader.create({ name: provider, disabled: true, config: { serverName: 'local', transport: 'stdio', command: 'DO_NOT_EXECUTE' } }, parent)
      const entry = root.loader.resolve(id), options = JSON.stringify(entry.options), write = vi.spyOn(root.loader, 'write')
      const first = readNativeConnectorInventory(root as never, new AbortController().signal)
      expect(first.entries).toEqual([{ entryId: id, serverName: 'local', transport: 'stdio', enabled: false, phase: null, configuration: 'recognized' }])
      expect(JSON.stringify(entry.options)).toBe(options); expect(write).not.toHaveBeenCalled(); expect(entry.fiber).toBeUndefined()
      const parentEntry = root.loader.resolve(parent)
      // Change only native options for this non-running test entry. Native
      // Entry.disabled must account for the disabled ancestor itself.
      parentEntry.options.disabled = true; entry.options.disabled = false
      expect(readNativeConnectorInventory(root as never, new AbortController().signal).entries[0]?.enabled).toBe(false)
      expect(write).not.toHaveBeenCalled(); expect(entry.fiber).toBeUndefined()
    } finally { await root.fiber.dispose() }
  })
})
