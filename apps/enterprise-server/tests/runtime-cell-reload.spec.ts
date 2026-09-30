// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, linkSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Sql } from 'postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CellTransport } from '../src/cell-transport.js'
import { CellTransportDirectory, retainCellTransports, selectCellTransport } from '../src/cell-transport-directory.js'
import { RuntimeBindings, type PrivateRuntimeCell } from '../src/runtime-bindings.js'
import type { Identity } from '../src/identity.js'
import { openPinnedOriginAuthority, restorePinnedConnectors, readRuntimeCellConfiguration, readRuntimeReload } from '../src/runtime-cell-reload.js'

const disposers: (() => unknown)[] = []
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose() })
const publicOrigin = 'http://127.0.0.1:62167'
const cell = (origin = 'http://127.0.0.1:12001'): PrivateRuntimeCell => ({ cellId: randomUUID(), tenantId: 'synthetic',
  userId: randomUUID(), role: 'member', revision: randomUUID(), origin, containerId: randomBytes(32).toString('hex'),
  imageId: 'sha256:' + 'a'.repeat(64), volumeName: 'paimind-haas-member-' + randomUUID(), policyDigest: 'sha256:' + 'b'.repeat(64) })
const transport = (origin: string) => { const t = new CellTransport(origin, 'a'.repeat(64)); disposers.push(() => t.destroy()); return t }
const config = (pin = cell()) => ({ ...pin, transportKey: 'a'.repeat(64) })
function fixture() {
  // Explicit SQL result stub: binding/contention behavior only, not real DB admission.
  const query = vi.fn(async () => [{ accepted: true }]), pin = cell(), other = cell('http://127.0.0.1:12002')
  const bindings = new RuntimeBindings(query as unknown as Sql, {} as Identity, publicOrigin, [], [pin, other])
  const next = { ...pin, revision: randomUUID(), containerId: randomBytes(32).toString('hex'), origin: 'http://127.0.0.1:12003' }
  return { pin, other, next, bindings, query, signal: new AbortController().signal }
}
function privateFile() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'paimind-reload-config-')))
  disposers.push(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'gateway.json'), original = { publicOrigin, masterKey: 'explicit-synthetic-marker', tenantId: 'synthetic', nativePrivateCells: [config()] }
  writeFileSync(path, JSON.stringify(original), { mode: 0o600 })
  return { path, dir, original, write: (value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 }) }
}

describe('explicit transport directory and bounded private configuration', () => {
  it('does not let a stale admitted revision use a replacement at the same address', () => {
    const pin = cell(), old = transport(pin.origin), next = transport(pin.origin)
    const nextPin = { ...pin, revision: randomUUID(), containerId: randomBytes(32).toString('hex') }
    const directory = new CellTransportDirectory(new Map([[pin.origin, old]]), [pin])
    expect(selectCellTransport(directory, pin)).toBe(old)
    expect(() => directory.replace(old, next)).toThrow('conflicts')
    directory.replace(old, next, nextPin)
    // A bare URL lookup would incorrectly return the new transport here.
    expect(directory.get(pin.origin)).toBe(next)
    expect(() => selectCellTransport(directory, pin)).toThrow('固定修订')
    expect(selectCellTransport(directory, nextPin)).toBe(next)
  })
  it('rejects an old member grant when another member later reuses its retired address', () => {
    const a = cell(), h = cell('http://127.0.0.1:12002'), aOld = transport(a.origin), hOld = transport(h.origin)
    const aNew = transport('http://127.0.0.1:12003'), hNew = transport(a.origin)
    const directory = new CellTransportDirectory(new Map([[a.origin, aOld], [h.origin, hOld]]), [a, h])
    const aNext = { ...a, origin: aNew.ingressOrigin, revision: randomUUID() }, hNext = { ...h, origin: hNew.ingressOrigin, revision: randomUUID() }
    directory.replace(aOld, aNew, aNext); directory.replace(hOld, hNew, hNext)
    expect(() => selectCellTransport(directory, a)).toThrow('固定修订')
    expect(selectCellTransport(directory, aNext)).toBe(aNew)
    expect(selectCellTransport(directory, hNext)).toBe(hNew)
  })
  it('never downgrades a missing private transport to a direct development connection', () => {
    const pin = cell(), empty = new CellTransportDirectory(new Map())
    expect(() => selectCellTransport(empty, { ...pin, transport: 'private-cell' })).toThrow('固定修订')
    expect(() => selectCellTransport(new Map(), { ...pin, transport: 'private-cell' })).toThrow('固定修订')
    expect(selectCellTransport(empty, pin)).toBeUndefined()
    const ordinary = transport(pin.origin)
    expect(selectCellTransport(new Map([[pin.origin, ordinary]]), pin)).toBe(ordinary)
    expect(() => selectCellTransport(new CellTransportDirectory(new Map([[pin.origin, ordinary]])), pin)).toThrow('固定修订')
  })
  it('retains the live directory, while ordinary maps keep their snapshot contract', () => {
    const a = transport('http://127.0.0.1:12001'), h = transport('http://127.0.0.1:12002'), next = transport('http://127.0.0.1:12003')
    const input = new Map([[a.ingressOrigin, a], [h.ingressOrigin, h]]), snapshot = retainCellTransports(input)
    const directory = new CellTransportDirectory(input), view = retainCellTransports(directory)
    input.clear(); expect(snapshot.size).toBe(2); expect(view).toBe(directory)
    directory.replace(a, next)
    expect(view.has(a.ingressOrigin)).toBe(false); expect(view.get(next.ingressOrigin)).toBe(next)
    expect(view.get(h.ingressOrigin)).toBe(h); expect(snapshot.get(a.ingressOrigin)).toBe(a)
    expect(() => directory.replace(a, next)).toThrow('conflicts')
    expect(() => directory.replace(next, h)).toThrow('conflicts')
  })
  it('requires exact cell fields and never carries an extra caller identity', () => {
    const input = config(); expect(readRuntimeCellConfiguration(input, publicOrigin)).toEqual(input)
    expect(Object.isFrozen(readRuntimeCellConfiguration(input, publicOrigin))).toBe(true)
    for (const key of Object.keys(input)) { const missing = { ...input } as Record<string, unknown>; delete missing[key]; expect(() => readRuntimeCellConfiguration(missing, publicOrigin)).toThrow() }
    for (const value of [{ ...input, actor: 'admin' }, { ...input, transportKey: '' }, { ...input, origin: 'http://127.0.0.1:3080' }, null, []])
      expect(() => readRuntimeCellConfiguration(value, publicOrigin)).toThrow()
  })
  it('reads only a cell inventory change and refuses all other startup changes', () => {
    const f = privateFile(), next = { ...f.original, nativePrivateCells: [config()] }; f.write(next)
    expect(readRuntimeReload(f.path, f.original)).toEqual(next.nativePrivateCells)
    for (const change of [{ masterKey: 'changed' }, { tenantId: 'other' }, { nativeDevelopmentOrigins: ['http://127.0.0.1:12099'] }, { nativeResourceDiagnostics: true }]) {
      f.write({ ...next, ...change }); expect(() => readRuntimeReload(f.path, f.original)).toThrow('other startup')
    }
  })
  it('rejects public permissions, symlinks, hard links, oversized and invalid files', () => {
    const f = privateFile(); chmodSync(f.path, 0o644); expect(() => readRuntimeReload(f.path, f.original)).toThrow('Unsafe')
    chmodSync(f.path, 0o600)
    const linked = join(f.dir, 'linked'); symlinkSync(f.path, linked); expect(() => readRuntimeReload(linked, f.original)).toThrow('Unsafe')
    const hard = join(f.dir, 'hard'); linkSync(f.path, hard); expect(() => readRuntimeReload(f.path, f.original)).toThrow('Unsafe'); rmSync(hard)
    writeFileSync(f.path, 'x'.repeat(262145)); expect(() => readRuntimeReload(f.path, f.original)).toThrow('Unsafe')
    writeFileSync(f.path, '{'); expect(() => readRuntimeReload(f.path, f.original)).toThrow()
  })
})

describe('immutable replacement gate with explicit SQL stub', () => {
  it('reports restoration as observed only after an exact private reply and unchanged complete pin',async()=>{
    const f=fixture(),requestControl=vi.fn(async()=>({restored:['sales'],pending:[]})),transport={requestControl} as unknown as CellTransport
    expect(await restorePinnedConnectors(f.bindings,f.pin,transport,f.signal)).toEqual({status:'observed',restored:['sales'],pending:[]})
    expect(requestControl).toHaveBeenCalledExactlyOnceWith('connector.restore',{},f.signal)
    requestControl.mockResolvedValueOnce({enabled:true} as any)
    expect(await restorePinnedConnectors(f.bindings,f.pin,transport,f.signal)).toEqual({status:'unconfirmed'})
    requestControl.mockImplementationOnce(async()=>{await f.bindings.replacePrivateCell(f.pin,f.next,()=>{},f.signal);return {restored:['sales'],pending:[]}})
    expect(await restorePinnedConnectors(f.bindings,f.pin,transport,f.signal)).toEqual({status:'unconfirmed'})
    requestControl.mockClear();expect(await restorePinnedConnectors(f.bindings,f.pin,transport,f.signal)).toEqual({status:'unconfirmed'})
    expect(requestControl).not.toHaveBeenCalled()
  })
  it.each(['cellId', 'tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest'] as const)('does not change %s in a recovery', async key => {
    const f = fixture(), wrong = { ...f.next, [key]: key === 'role' ? 'admin' : f.other[key] }
    if (wrong[key] === f.pin[key]) (wrong as Record<string, unknown>)[key] = key.endsWith('Digest') || key === 'imageId' ? 'sha256:' + 'f'.repeat(64) : 'other'
    await expect(f.bindings.replacePrivateCell(f.pin, wrong, vi.fn(), f.signal)).rejects.toThrow()
    expect(f.query).not.toHaveBeenCalled(); f.bindings.assertPrivateCell(f.pin)
  })
  it('publishes only after current admission and preserves the other pin', async () => {
    const f = fixture(), publish = vi.fn()
    f.query.mockResolvedValueOnce([])
    await expect(f.bindings.replacePrivateCell(f.pin, f.next, publish, f.signal)).rejects.toThrow('准入')
    expect(publish).not.toHaveBeenCalled(); f.bindings.assertPrivateCell(f.pin)
    await f.bindings.replacePrivateCell(f.pin, f.next, publish, f.signal)
    expect(publish).toHaveBeenCalledOnce(); f.bindings.assertPrivateCell(f.next); f.bindings.assertPrivateCell(f.other)
    expect(() => f.bindings.assertPrivateCell(f.pin)).toThrow('修订')
    await expect(f.bindings.replacePrivateCell(f.pin, f.next, publish, f.signal)).rejects.toThrow()
  })
  it('rejects aliasing another member and cancellation before publication', async () => {
    const f = fixture(), publish = vi.fn()
    await expect(f.bindings.replacePrivateCell(f.pin, { ...f.next, origin: f.other.origin }, publish, f.signal)).rejects.toThrow('conflicts')
    const abort = new AbortController(); f.query.mockImplementationOnce(async () => { abort.abort(); return [{ accepted: true }] })
    await expect(f.bindings.replacePrivateCell(f.pin, f.next, publish, abort.signal)).rejects.toThrow()
    expect(publish).not.toHaveBeenCalled(); f.bindings.assertPrivateCell(f.pin)
  })
  it('binds every reverse callback to the old full pin, including late results', async () => {
    const f = fixture(), handlers: Array<(input: unknown, signal: AbortSignal) => Promise<unknown>> = []
    const owner = { openOriginAuthority: vi.fn(async (...callbacks: typeof handlers) => { handlers.push(...callbacks) }) } as unknown as CellTransport
    const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>()
    const check = vi.spyOn(f.bindings, 'checkInteractiveOrigins').mockImplementation(async () => { entered.resolve(); await finish.promise })
    const otherMethods = ['authorizeInteractiveExecution', 'deriveInteractiveOrigins', 'sealJobOrigins', 'readSkillEligibility', 'readConnectorApproval', 'authorizeConnectorExecution'] as const
    const calls = otherMethods.map(method => vi.spyOn(f.bindings, method))
    await openPinnedOriginAuthority(f.bindings, f.pin, owner); expect(handlers.length).toBe(7)
    const pending = handlers[0]!({}, f.signal), rejected = expect(pending).rejects.toThrow('修订'); await entered.promise
    await f.bindings.replacePrivateCell(f.pin, f.next, () => {}, f.signal); finish.resolve(); await rejected
    for (const handler of handlers) await expect(handler({}, f.signal)).rejects.toThrow('修订')
    expect(check).toHaveBeenCalledOnce(); for (const spy of calls) expect(spy).not.toHaveBeenCalled()
  })
})
