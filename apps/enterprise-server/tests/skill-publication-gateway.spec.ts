// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { PaimindSkillInstallerService } from '../../../packages/skill-market/src/installer.js'
import { PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS } from '@paimind/skill-market/remote'
import { createNativeControlBroker, createNativeControlPeer, handleNativeControl, validateNativeControlInput,
  NATIVE_CONTROL_LIMIT } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { NativeGateway } from '../src/native-gateway.js'
import { CellTransport } from '../src/cell-transport.js'
import { authorizeNativeOperation } from '../src/native-operation-policy.js'
import type { RuntimeGrant } from '../src/runtime-bindings.js'
import type { RuntimeIdentity } from '../src/identity.js'

const disposers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); vi.useRealTimers() })
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'paimind-skill-gateway-')))
  disposers.push(() => rm(directory, { recursive: true, force: true }))
  const effects: Array<() => void | Promise<void>> = []
  const context = { reflect: { provide() {} }, webServer: { register: () => () => {} },
    effect(install: () => void | (() => void | Promise<void>)) { const dispose = install(); if (dispose) effects.push(dispose) } }
  const source = new PaimindSkillInstallerService(context as never, { skillRoot: join(directory, 'skills'), stateRoot: join(directory, 'state') })
  disposers.push(async () => { for (const effect of effects.reverse()) await effect() })
  await source.saveSkillSource({ name: 'customer-notes', description: 'Morgan approved-source candidate', instructions: 'Use only provided customer notes.' })
  await mkdir(join(directory, 'skills', 'customer-notes', 'assets'))
  await writeFile(join(directory, 'skills', 'customer-notes', 'assets', 'sample.bin'), randomBytes(320000))
  const current = await source.getSkillPackage({ skillId: 'customer-notes' })
  const selection = { skillId: current.skillId, expectedDigest: current.digest }
  const broker = await createNativeControlBroker(); disposers.push(() => broker.close())
  // The production connection requires a Linux Worker; local protocol tests use
  // its exact dispatcher with a real socket, not a platform/UID override.
  const peer = createNativeControlPeer(createConnection(broker.path), { handle: (operation, input, signal) =>
    handleNativeControl({ get: name => name === 'paimindSkillInstaller' ? source : undefined }, operation, input, signal) })
  disposers.push(() => peer.close())
  await vi.waitFor(() => expect(broker.ready).toBe(true))
  const calls: Array<{ operation: string; input: object }> = [], token = randomBytes(32).toString('hex')
  const ingress = createNativeIngress({ token, control: async (operation: string, input: object, signal: AbortSignal) => {
    calls.push({ operation, input }); return broker.request(operation, input, signal)
  } })
  disposers.push(() => ingress.close())
  await new Promise<void>(done => ingress.server.listen(0, '127.0.0.1', done))
  const address = ingress.server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`, transport = new CellTransport(origin, token)
  disposers.push(() => transport.destroy())
  const principal: RuntimeIdentity = { sessionId: randomUUID(), account: { tenantId: 'skill-publication-fixture',
    userId: randomUUID(), username: 'morgan', displayName: 'Morgan', role: 'admin', status: 'active' } }
  let grant: RuntimeGrant = { cellId: randomUUID(), tenantId: principal.account.tenantId, userId: principal.account.userId,
    role: 'admin', revision: randomUUID(), origin, validForMs: 10000, transport: 'private-cell' }
  const authorize = vi.fn(async (_token, _requestId, selected, request, verify) => {
    authorizeNativeOperation(selected.role, request); await verify()
  })
  const gateway = new NativeGateway({ publicOrigin: 'http://127.0.0.1:62345', resolve: async () => grant,
    authorize, transports: new Map([[origin, transport]]), revalidateMs: 20 })
  disposers.push(() => gateway.close())
  return { gateway, source, principal, selection, directory, calls, token, transport, authorize,
    swap: (change: Partial<RuntimeGrant>) => { grant = { ...grant, ...change } } }
}

describe('real private HTTP/socket and Skill owner transfer; identity grant fixture, no DB/Browser E2E', () => {
  it('streams a complete multi-frame capture from the admin owner and releases it, with no credential or authority in the native payload', async () => {
    const f = await fixture(), chunks: Buffer[] = []
    const descriptor = await f.gateway.exportSkillPublication('private-login-fixture', randomUUID(), f.principal, f.selection,
      async bytes => { chunks.push(Buffer.from(bytes)) }, new AbortController().signal)
    expect(descriptor.archiveBytes).toBe(Buffer.concat(chunks).length); expect(chunks.length).toBeGreaterThan(3)
    expect(descriptor.packageDigest).toBe(f.selection.expectedDigest)
    expect(f.calls[0]).toEqual({ operation: 'skill.export.begin', input: f.selection })
    expect(f.calls.at(-1)).toEqual({ operation: 'skill.export.release', input: { exportId: descriptor.exportId } })
    const wire = JSON.stringify(f.calls)
    for (const secret of ['private-login-fixture', f.token, f.principal.account.userId]) expect(wire).not.toContain(secret)
    expect(f.authorize).toHaveBeenCalledOnce()
    expect(f.authorize.mock.calls[0]![3].target).toBe('/api/paimindSkillInstaller/getSkillPackage')
    expect(await readdir(join(f.directory, 'state', 'publication-exports'))).toEqual([])
    const methods = PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS.map(row => row.method)
    expect(methods).not.toContain('beginPublicationExport'); expect(methods).not.toContain('readPublicationExport')
    expect(methods).not.toContain('releasePublicationExport'); expect(NATIVE_CONTROL_LIMIT).toBe(262144)
  })
  it.each(['member', 'foreign-principal', 'changed-selection'])('denies %s before beginning a private export', async mode => {
    const f = await fixture()
    if (mode === 'member') f.swap({ role: 'member' })
    const principal = mode === 'foreign-principal' ? { ...f.principal, account: { ...f.principal.account, userId: randomUUID() } }
      : mode === 'member' ? { ...f.principal, account: { ...f.principal.account, role: 'member' as const } } : f.principal
    await expect(f.gateway.exportSkillPublication('token', randomUUID(), principal,
      mode === 'changed-selection' ? { ...f.selection, origin: 'http://outside.invalid' } as never : f.selection,
      async () => {}, new AbortController().signal)).rejects.toThrow()
    expect(f.calls).toEqual([])
  })
  it.each(['revocation', 'cancel', 'sink-failure'])('fails %s during staged transfer and still releases the exact source handle', async mode => {
    const f = await fixture(), controller = new AbortController(); let sinkCalls = 0
    const before = await readFile(join(f.directory, 'skills', 'customer-notes', 'SKILL.md'))
    await expect(f.gateway.exportSkillPublication('token', randomUUID(), f.principal, f.selection, async () => {
      sinkCalls += 1
      if (mode === 'revocation') { f.swap({ revision: randomUUID() }); await new Promise(done => setTimeout(done, 70)) }
      if (mode === 'cancel') controller.abort()
      if (mode === 'sink-failure') throw Error('private staging unavailable')
    }, controller.signal)).rejects.toThrow()
    expect(sinkCalls).toBe(1)
    expect(f.calls.at(-1)?.operation).toBe('skill.export.release')
    expect(await readdir(join(f.directory, 'state', 'publication-exports'))).toEqual([])
    expect(await readFile(join(f.directory, 'skills', 'customer-notes', 'SKILL.md'))).toEqual(before)
  })
  it('does not reconnect a closed gateway for cleanup; the owner expires the unreachable handle', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await expect(f.gateway.exportSkillPublication('token', randomUUID(), f.principal, f.selection, async () => {
      f.gateway.close()
    }, new AbortController().signal)).rejects.toThrow()
    expect(f.calls.at(-1)?.operation).toBe('skill.export.read')
    expect(await readdir(join(f.directory, 'state', 'publication-exports'))).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    await vi.waitFor(async () => expect(await readdir(join(f.directory, 'state', 'publication-exports'))).toEqual([]))
    expect(f.calls.at(-1)?.operation).toBe('skill.export.read')
  })
  it('rejects a binding change after the last staged chunk instead of confirming a stale source capture', async () => {
    const f = await fixture(); let bytes = 0
    await expect(f.gateway.exportSkillPublication('token', randomUUID(), f.principal, f.selection, async chunk => {
      bytes += chunk.length
      if (chunk.length < 96 * 1024) f.swap({ revision: randomUUID() })
    }, new AbortController().signal)).rejects.toThrow()
    expect(bytes).toBeGreaterThan(320000)
    expect(f.calls.at(-1)?.operation).toBe('skill.export.release')
    expect(await readdir(join(f.directory, 'state', 'publication-exports'))).toEqual([])
  })
  it('validates private operation shapes without widening the frame or accepting a browser native method', async () => {
    const f = await fixture()
    for (const [operation, input] of [
      ['skill.export.begin', { ...f.selection, path: '/outside' }],
      ['skill.export.read', { exportId: randomUUID(), offset: 1 }],
      ['skill.export.release', { exportId: randomUUID(), userId: randomUUID() }],
    ] as const) {
      expect(() => validateNativeControlInput(operation, input)).toThrow()
      await expect(f.transport.requestControl(operation, input)).rejects.toThrow()
    }
    expect(f.calls).toEqual([])
    for (const method of ['beginPublicationExport', 'readPublicationExport', 'releasePublicationExport']) {
      expect(() => authorizeNativeOperation('member', { method: 'POST', target: '/api/paimindSkillInstaller/' + method,
        contentType: 'application/json', body: Buffer.from('{}') })).toThrow()
    }
  })
})
