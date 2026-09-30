// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { request } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeControlBroker, createNativeControlPeer, deriveNativeOrigins, sealNativeJobOrigins, authorizeNativeExecution, authorizeNativeSkillUse, authorizeNativeConnectorUse, validateNativeExecutionInput, NATIVE_ORIGIN_PATH, type NativeExecutionInput, type NativeDelegationInput, type NativeOriginInput, type NativeJobOriginInput } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { CellTransport } from '../src/cell-transport.js'

const disposers: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
const input = { nativeSessionId: 'session-hansen', sources: ['paimind-origin-v1.e30.' + 's'.repeat(43)] }
async function fixture(check = vi.fn(async (_input: unknown, _signal: AbortSignal) => {}), attached = true,
  authorize?: (input: NativeExecutionInput, signal: AbortSignal) => Promise<void>,
  derive?: (input: NativeDelegationInput, signal: AbortSignal) => Promise<NativeOriginInput>,
  sealJob?: (input: NativeJobOriginInput, signal: AbortSignal) => Promise<NativeOriginInput>) {
  let ingress: ReturnType<typeof createNativeIngress>
  const broker = await createNativeControlBroker('/tmp', (input: unknown, signal: AbortSignal) => ingress.checkOrigins(input, signal),
    (input: unknown, signal: AbortSignal) => ingress.authorizeExecution(input, signal),
    (input: unknown, signal: AbortSignal) => ingress.deriveOrigins(input, signal),
    (input: unknown, signal: AbortSignal) => ingress.sealJobOrigins(input, signal))
  disposers.push(() => broker.close())
  const peer = createNativeControlPeer(createConnection(broker.path), { handle: async () => ({ snapshot: 'fixture-only' }) })
  disposers.push(() => peer.close())
  await vi.waitFor(() => expect(broker.ready).toBe(true))
  const token = randomBytes(32).toString('hex')
  ingress = createNativeIngress({ token, control: (op: string, value: object, signal: AbortSignal) => broker.request(op, value, signal) })
  disposers.push(() => ingress.close())
  await new Promise<void>(done => ingress.server.listen(0, '127.0.0.1', done))
  const address = ingress.server.address(); if (!address || typeof address === 'string') throw Error('Missing private port')
  const origin = `http://127.0.0.1:${address.port}`
  const transport = new CellTransport(origin, token); disposers.push(() => transport.destroy())
  if (attached) await transport.openOriginAuthority(check, authorize, derive, sealJob)
  return { peer, broker, ingress, transport, check, token, origin }
}
describe('private reverse origin channel, not a model or resource permission', () => {
  it('carries a native check to the gateway and preserves the opposite publication direction', async () => {
    const f = await fixture()
    await f.peer.checkOrigins(input)
    expect(f.check).toHaveBeenCalledOnce(); expect(f.check.mock.calls[0][0]).toEqual(input)
    expect(JSON.stringify(f.check.mock.calls)).not.toContain(f.token)
    expect(await f.transport.requestControl('publication.snapshot', { presetId: 'hansen', expectedVersion: 'v1' })).toEqual({ snapshot: 'fixture-only' })
    await f.peer.checkOrigins(input); expect(f.check).toHaveBeenCalledTimes(2) // no cached allow
  })
  it('propagates rejection and disconnection, and never borrows a prior successful check', async () => {
    const f = await fixture(); await f.peer.checkOrigins(input)
    f.check.mockRejectedValueOnce(Error('private policy failure'))
    await expect(f.peer.checkOrigins(input)).rejects.toThrow('unavailable')
    f.transport.destroy(); await vi.waitFor(async () => { await expect(f.peer.checkOrigins(input)).rejects.toThrow() })
    expect(f.peer.ready).toBe(true) // origin-provider loss does not forge a native restart
  })
  it('cancels gateway work through both links and does not accept its late response', async () => {
    const entered = Promise.withResolvers<AbortSignal>(), finish = Promise.withResolvers<void>()
    const check = vi.fn(async (_input: unknown, signal: AbortSignal) => { entered.resolve(signal); await finish.promise })
    const f = await fixture(check), abort = new AbortController()
    const pending = f.peer.checkOrigins(input, abort.signal), rejected = expect(pending).rejects.toThrow()
    const signal = await entered.promise; abort.abort(); await rejected
    await vi.waitFor(() => expect(signal.aborted).toBe(true)); finish.resolve()
    f.check.mockImplementation(async () => {})
    await f.peer.checkOrigins(input)
  })
  it('rejects malformed, duplicate and unbounded inputs before sending a reverse request', async () => {
    const f = await fixture()
    for (const value of [{ ...input, userId: 'forged' }, { ...input, sources: [] }, { ...input, sources: ['plain-browser-id'] },
      { ...input, sources: [input.sources[0], input.sources[0]] }, { ...input, nativeSessionId: 'x'.repeat(201) }]) {
      await expect(f.peer.checkOrigins(value)).rejects.toThrow()
    }
    expect(f.check).not.toHaveBeenCalled()
  })
  it('rejects a second authority attachment without replacing the established provider', async () => {
    const f = await fixture(), other = new CellTransport(f.origin, f.token); disposers.push(() => other.destroy())
    await expect(other.openOriginAuthority(async () => {})).rejects.toThrow()
    await f.peer.checkOrigins(input); expect(f.check).toHaveBeenCalledOnce()
  })
  it.each(['token', 'origin', 'cookie', 'query', 'upgrade'])('rejects %s confusion at the private HTTP upgrade', async mode => {
    const f = await fixture(undefined, false)
    const status = await new Promise<number>(resolve => {
      const req = request(f.origin + NATIVE_ORIGIN_PATH + (mode === 'query' ? '?x=1' : ''), { method: 'GET', headers: {
        'x-paimind-cell-token': mode === 'token' ? 'a'.repeat(64) : f.token, connection: 'Upgrade',
        upgrade: mode === 'upgrade' ? 'websocket' : 'paimind-native-origins',
        ...(mode === 'origin' ? { origin: f.origin } : {}), ...(mode === 'cookie' ? { cookie: 'browser-cookie' } : {}),
      } }, response => { response.resume(); resolve(response.statusCode!) })
      req.once('upgrade', (_response, socket) => { socket.destroy(); resolve(101) }); req.end()
    })
    expect(status).toBe(403)
    await f.transport.openOriginAuthority(f.check)
    await f.peer.checkOrigins(input)
  })
})

describe('private delegation provenance, not a child invocation API', () => {
  const parent = { ...input, presetId: 'hansen-personal', publication: null, skills: [], targetSessionId: 'native-child' }
  const child = { nativeSessionId: parent.targetSessionId, sources: ['paimind-origin-v1.e30.' + 'c'.repeat(43)] }
  it('does not derive from login-only or execution-only authority', async () => {
    const f = await fixture(undefined, true, async () => {})
    await f.peer.checkOrigins(input)
    await expect(f.peer.deriveOrigins(parent)).rejects.toThrow()
    expect(f.peer.ready).toBe(true)
  })
  it('carries the exact parent and target through both protected links without exposing the transport key', async () => {
    const derive = vi.fn(async () => child), f = await fixture(undefined, true, undefined, derive)
    expect(await f.peer.deriveOrigins(parent)).toEqual(child)
    expect(derive.mock.calls[0]?.[0]).toEqual(parent)
    expect(JSON.stringify(derive.mock.calls)).not.toContain(f.token)
    expect(f.check).not.toHaveBeenCalled()
    derive.mockRejectedValueOnce(Error('parent revoked'))
    await expect(f.peer.deriveOrigins(parent)).rejects.toThrow()
    expect(await f.peer.deriveOrigins(parent)).toEqual(child)
    expect(derive).toHaveBeenCalledTimes(3)
  })
  it('rejects a widened, self-targeted or malformed request before the authority is called', async () => {
    const derive = vi.fn(async () => child), f = await fixture(undefined, true, undefined, derive)
    for (const value of [{ ...parent, targetSessionId: input.nativeSessionId }, { ...parent, targetSessionId: '' },
      { ...parent, targetSessionId: 'x'.repeat(201) }, { ...parent, role: 'admin' }, { ...parent, sources: [] },
      { ...parent, sources: [input.sources[0], input.sources[0]] }, { ...parent, publication: {} }]) {
      await expect(f.peer.deriveOrigins(value as NativeDelegationInput)).rejects.toThrow()
    }
    expect(derive).not.toHaveBeenCalled()
  })
  it.each(['target', 'empty', 'echo', 'duplicates', 'extra', 'unbounded', 'allow'])('rejects malformed %s derivation replies', async mode => {
    const invalid = mode === 'target' ? { ...child, nativeSessionId: 'other-child' }
      : mode === 'empty' ? { ...child, sources: [] } : mode === 'echo' ? { ...child, sources: input.sources }
      : mode === 'duplicates' ? { ...child, sources: [child.sources[0], child.sources[0]] }
      : mode === 'extra' ? { ...child, token: 'must-not-cross' }
      : mode === 'unbounded' ? { ...child, sources: ['paimind-origin-v1.' + 'a'.repeat(8192) + '.' + 'b'.repeat(43)] }
      : { executionAuthorized: true }
    const f = await fixture(undefined, true, undefined, async () => invalid as NativeOriginInput)
    await expect(f.peer.deriveOrigins(parent)).rejects.toThrow()
    expect(f.peer.ready).toBe(true)
  })
  it('joins cancellation and does not use a late derived source after the caller aborts', async () => {
    const entered = Promise.withResolvers<AbortSignal>(), finish = Promise.withResolvers<void>()
    const derive = vi.fn(async (_input: unknown, signal: AbortSignal) => { entered.resolve(signal); await finish.promise; return child })
    const f = await fixture(undefined, true, undefined, derive), abort = new AbortController()
    const pending = f.peer.deriveOrigins(parent, abort.signal), rejected = expect(pending).rejects.toThrow()
    const signal = await entered.promise; abort.abort(); await rejected
    await vi.waitFor(() => expect(signal.aborted).toBe(true)); finish.resolve()
    derive.mockRejectedValue(Error('revoked'))
    await expect(f.peer.deriveOrigins(parent)).rejects.toThrow()
    f.transport.destroy()
    await expect(f.peer.deriveOrigins(parent)).rejects.toThrow()
  })
  it('uses the original immutable receipt owner before deriving enterprise provenance', async () => {
    const publicationId = '12345678-1234-1234-1234-123456789abc'
    const presetId = 'paimind-enterprise-' + publicationId.replaceAll('-', '')
    const getAdoptedPublication = vi.fn(async () => ({ tenantId: 'fixture', publicationId,
      sourceUserId: '12345678-1234-1234-1234-123456789def', snapshot: { digest: 'sha256:' + 'a'.repeat(64) } }))
    const context = { get: vi.fn((name: string) => name === 'paimindAgentProfiles' ? { getAdoptedPublication } : undefined) }
    const deriveOrigins = vi.fn(async () => child), peer = { ready: true, deriveOrigins }
    const selected = { ...input, presetId, targetSessionId: parent.targetSessionId }
    expect(await deriveNativeOrigins(context, peer, selected, new AbortController().signal)).toEqual(child)
    expect(getAdoptedPublication).toHaveBeenCalledWith({ presetId })
    expect(deriveOrigins.mock.calls[0]?.[0]).toEqual({ ...selected, skills: [], publication: { tenantId: 'fixture', publicationId,
      sourceUserId: '12345678-1234-1234-1234-123456789def', contentDigest: 'sha256:' + 'a'.repeat(64) } })
    getAdoptedPublication.mockRejectedValueOnce(Error('immutable bytes changed'))
    await expect(deriveNativeOrigins(context, peer, selected, new AbortController().signal)).rejects.toThrow()
    expect(deriveOrigins).toHaveBeenCalledOnce()
    await expect(deriveNativeOrigins(context, peer, selected, AbortSignal.abort())).rejects.toThrow()
    expect(deriveOrigins).toHaveBeenCalledOnce()
  })
})

describe('same-session job provenance over both private channel segments', () => {
  const job = { ...input, presetId: 'hansen-personal', publication: null, skills: [], nativeJobId: 'bash-1' }
  const sealed = (overrides = {}) => ({ nativeSessionId: job.nativeSessionId, sources: ['paimind-origin-v1.' +
    Buffer.from(JSON.stringify({ nativeJobId: job.nativeJobId, nativeSessionId: job.nativeSessionId,
      delegatedPresetId: job.presetId, ...overrides })).toString('base64url') + '.' + 'j'.repeat(43)] })
  it('requires its own signing authority, never an execution or child-delegation allow', async () => {
    const f = await fixture(undefined, true, async () => {}, async () => sealed())
    await f.peer.authorizeExecution({ ...input, presetId: job.presetId, publication: null, skills: [] })
    await expect(f.peer.sealJobOrigins(job)).rejects.toThrow()
  })
  it('carries the exact native job and narrows returned provenance without exposing the transport key', async () => {
    const seal = vi.fn(async () => sealed()), f = await fixture(undefined, true, undefined, undefined, seal)
    expect(await f.peer.sealJobOrigins(job)).toEqual(sealed())
    expect(seal.mock.calls[0]?.[0]).toEqual(job); expect(JSON.stringify(seal.mock.calls)).not.toContain(f.token)
    seal.mockRejectedValueOnce(Error('original permission withdrawn'))
    await expect(f.peer.sealJobOrigins(job)).rejects.toThrow()
    expect(await f.peer.sealJobOrigins(job)).toEqual(sealed())
  })
  it.each(['job', 'preset', 'session', 'echo', 'grant', 'empty'])('rejects an invalid %s completion proof', async mode => {
    const reply = mode === 'job' ? sealed({ nativeJobId: 'bash-2' })
      : mode === 'preset' ? sealed({ delegatedPresetId: 'other' }) : mode === 'session' ? sealed({ nativeSessionId: 'alex' })
      : mode === 'echo' ? input : mode === 'grant' ? { executionAuthorized: true } : { nativeSessionId: job.nativeSessionId, sources: [] }
    const f = await fixture(undefined, true, undefined, undefined, async () => reply as NativeOriginInput)
    await expect(f.peer.sealJobOrigins(job)).rejects.toThrow()
  })
  it('rejects public-role, target, malformed job, duplicate-source and invalid publication additions before signing', async () => {
    const seal = vi.fn(async () => sealed()), f = await fixture(undefined, true, undefined, undefined, seal)
    for (const value of [{ ...job, role: 'admin' }, { ...job, targetSessionId: 'alex' }, { ...job, nativeJobId: '' },
      { ...job, nativeJobId: 'x'.repeat(201) }, { ...job, publication: {} }, { ...job, sources: [input.sources[0], input.sources[0]] }]) {
      await expect(f.peer.sealJobOrigins(value as NativeJobOriginInput)).rejects.toThrow()
    }
    expect(seal).not.toHaveBeenCalled()
  })
  it('joins the exact signing cancellation and rejects after channel withdrawal', async () => {
    const entered = Promise.withResolvers<AbortSignal>(), finish = Promise.withResolvers<void>()
    const f = await fixture(undefined, true, undefined, undefined, async (_input, signal) => {
      entered.resolve(signal); await finish.promise; return sealed()
    }), abort = new AbortController()
    const pending = f.peer.sealJobOrigins(job, abort.signal), rejection = expect(pending).rejects.toThrow()
    const signal = await entered.promise; abort.abort(); await rejection
    await vi.waitFor(() => expect(signal.aborted).toBe(true)); finish.resolve()
    f.transport.destroy(); await expect(f.peer.sealJobOrigins(job)).rejects.toThrow()
  })
  it('reuses the immutable receipt owner and refuses changed bytes before signing', async () => {
    const publicationId = '12345678-1234-1234-1234-123456789abc', presetId = 'paimind-enterprise-' + publicationId.replaceAll('-', '')
    const getAdoptedPublication = vi.fn(async () => ({ tenantId: 'fixture', publicationId,
      sourceUserId: '12345678-1234-1234-1234-123456789def', snapshot: { digest: 'sha256:' + 'a'.repeat(64) } }))
    const sealJobOrigins = vi.fn(async () => sealed({ delegatedPresetId: presetId }))
    const selected = { ...input, presetId, nativeJobId: job.nativeJobId }, context = { get: (name: string) => name === 'paimindAgentProfiles' ? { getAdoptedPublication } : undefined }
    await sealNativeJobOrigins(context, { ready: true, sealJobOrigins }, selected, new AbortController().signal)
    expect(getAdoptedPublication).toHaveBeenCalledWith({ presetId })
    expect(sealJobOrigins.mock.calls[0]?.[0]).toMatchObject({ ...selected, publication: { publicationId, contentDigest: 'sha256:' + 'a'.repeat(64) } })
    getAdoptedPublication.mockRejectedValueOnce(Error('modified immutable receipt'))
    await expect(sealNativeJobOrigins(context, { ready: true, sealJobOrigins }, selected, new AbortController().signal)).rejects.toThrow()
    expect(sealJobOrigins).toHaveBeenCalledOnce()
  })
})

describe('distinct execution decision over the existing bounded private channel', () => {
  const skill = { tenantId: 'enterprise-fixture', publicationId: randomUUID(), sourceUserId: randomUUID(), name: 'client-notes',
    packageDigest: 'sha256:' + 'c'.repeat(64), archiveDigest: 'sha256:' + 'd'.repeat(64), archiveBytes: 100, expandedBytes: 80, entryCount: 1 }
  it.each(['valid','changed-selection','authority-denied','cancel'] as const)('connector use composes original exact publication selection before and after the authority call: %s',async mode=>{
    let checked=false
    const selected=vi.fn(async()=>checked&&mode==='changed-selection'?[]:[skill]),abort=new AbortController()
    const context={get:(name:string)=>name==='paimindSkillInstaller'?{getSelectedPublicationReferences:selected}:undefined}
    const peer={ready:true,authorizeConnectorExecution:vi.fn(async()=>{checked=true;if(mode==='authority-denied')throw Error('Denied');if(mode==='cancel')abort.abort()})}
    const reference={entryId:'sales',configurationVersion:'a'.repeat(64),serverName:'sales',transport:'stdio' as const}
    const pending=authorizeNativeConnectorUse(context,peer,{...input,presetId:'standard'},reference,7,abort.signal)
    if(mode==='valid')await expect(pending).resolves.toBeUndefined();else await expect(pending).rejects.toThrow()
    expect(peer.authorizeConnectorExecution.mock.calls[0]?.[0]).toEqual({reference,approvalRevision:7,execution:{...input,presetId:'standard',publication:null,skills:[skill]}})
  })
  it.each(['valid', 'missing-proof', 'body-drift', 'authority-denied', 'cancel', 'missing-owner-method'] as const)(
    'keeps loaded Skill body in process and checks exact authority before/after: %s', async mode => {
      const controller = new AbortController(), value = { name: skill.name, provider: 'paimind-session-business-skills', content: 'Private body only' }
      let checked = false
      const loaded = vi.fn(async () => { if (checked && mode === 'body-drift') throw Error('Body changed'); return skill })
      const selected = vi.fn(async () => mode === 'missing-proof' ? [] : [skill])
      const context = { get: (name: string) => name === 'paimindSkillInstaller' ? { getSelectedPublicationReferences: selected,
        ...(mode === 'missing-owner-method' ? {} : { getLoadedPublicationReference: loaded }) } : undefined }
      const peer = { ready: true, authorizeExecution: vi.fn(async () => {
        checked = true; if (mode === 'authority-denied') throw Error('Current assignment denied'); if (mode === 'cancel') controller.abort()
      }) }
      const pending = authorizeNativeSkillUse(context, peer, { ...input, presetId: 'standard' }, value, controller.signal)
      if (mode === 'valid') expect(await pending).toEqual({ name: skill.name, publicationId: skill.publicationId, packageDigest: skill.packageDigest })
      else await expect(pending).rejects.toThrow()
      expect(peer.authorizeExecution).toHaveBeenCalledTimes(['missing-proof', 'missing-owner-method'].includes(mode) ? 0 : 1)
      expect(JSON.stringify(peer.authorizeExecution.mock.calls)).not.toContain('Private body only')
      if (mode === 'valid') expect(loaded).toHaveBeenCalledTimes(2)
    })

  it('keeps the captured selector local and cannot omit signed inherited dependencies or accept surplus proofs', async () => {
    const selected = vi.fn(async (request: any) => request.requiredPublicationIds.map(() => skill))
    const context = { get: (name: string) => name === 'paimindSkillInstaller' ? { getSelectedPublicationReferences: selected } : undefined }
    const peer = { ready: true, authorizeExecution: vi.fn(async () => {}) }
    const source = 'paimind-origin-v1.' + Buffer.from(JSON.stringify({ requiredSkillIds: [skill.publicationId] })).toString('base64url') + '.' + 's'.repeat(43)
    const captured = { ...input, sources: [source], presetId: 'standard', requirements: [], skillSelection: 'captured' as const }
    expect(await authorizeNativeExecution(context, peer, captured, new AbortController().signal)).toEqual([skill.publicationId])
    expect(selected.mock.calls[0]?.[0]).toEqual({ nativeSessionId: input.nativeSessionId, presetId: 'standard',
      requiredPublicationIds: [skill.publicationId], skillSelection: 'captured' })
    expect(peer.authorizeExecution.mock.calls[0]?.[0]).toEqual({ nativeSessionId: input.nativeSessionId, presetId: 'standard', sources: [source], publication: null, skills: [skill] })
    selected.mockResolvedValueOnce([])
    await expect(authorizeNativeExecution(context, peer, captured, new AbortController().signal)).rejects.toThrow()
    selected.mockResolvedValueOnce([skill, { ...skill, publicationId: randomUUID(), name: 'surplus-skill' }])
    await expect(authorizeNativeExecution(context, peer, captured, new AbortController().signal)).rejects.toThrow()
    expect(peer.authorizeExecution).toHaveBeenCalledOnce()
  })
  it.each([undefined, null, 'current', false])('rejects malformed captured selector %s before contacting the authority', async skillSelection => {
    const peer = { ready: true, authorizeExecution: vi.fn(async () => {}) }, context = { get: () => undefined }
    await expect(authorizeNativeExecution(context, peer, { ...input, presetId: 'standard', requirements: [], skillSelection } as never, new AbortController().signal)).rejects.toThrow()
    await expect(authorizeNativeExecution(context, peer, { ...input, presetId: 'standard', skillSelection: 'captured' } as never, new AbortController().signal)).rejects.toThrow()
    expect(peer.authorizeExecution).not.toHaveBeenCalled()
  })
  it('requires an explicit bounded unambiguous Skill proof list instead of treating old frames as empty', async () => {
    const authorize = vi.fn(async () => {}), f = await fixture(undefined, true, authorize)
    expect(() => validateNativeExecutionInput({ ...input, presetId: 'standard', publication: null })).toThrow()
    for (const skills of [null, [skill, skill], [skill, { ...skill, publicationId: randomUUID() }],
      [skill, { ...skill, name: 'different-name' }], [{ ...skill, directory: '/not-allowed' }],
      [{ ...skill, archiveBytes: 0 }], [{ ...skill, sourceUserId: 'unknown' }], Array.from({ length: 129 }, () => skill)]) {
      await expect(f.peer.authorizeExecution({ ...input, presetId: 'standard', publication: null, skills } as NativeExecutionInput)).rejects.toThrow()
    }
    expect(authorize).not.toHaveBeenCalled()
    await f.peer.authorizeExecution({ ...input, presetId: 'standard', publication: null, skills: [skill] })
    expect(authorize).toHaveBeenCalledOnce()
  })

  it.each(['selection', 'content', 'cancel'] as const)('revalidates local Skill %s after the private execution authority replies', async mode => {
    let changed = false
    const controller = new AbortController(), selected = vi.fn(async () => {
      if (changed && mode === 'content') throw Error('Changed complete Skill directory')
      return changed && mode === 'selection' ? [] : [skill]
    })
    const peer = { ready: true, authorizeExecution: vi.fn(async () => { changed = true; if (mode === 'cancel') controller.abort() }) }
    await expect(authorizeNativeExecution({ get: (name: string) => name === 'paimindSkillInstaller' ? { getSelectedPublicationReferences: selected } : undefined },
      peer, { ...input, presetId: 'standard' }, controller.signal)).rejects.toThrow()
    expect(peer.authorizeExecution).toHaveBeenCalledOnce()
  })

  it('refuses an installed but incompatible Skill owner before contacting the authority', async () => {
    const peer = { ready: true, authorizeExecution: vi.fn(async () => {}) }
    await expect(authorizeNativeExecution({ get: (name: string) => name === 'paimindSkillInstaller' ? {} : undefined },
      peer, { ...input, presetId: 'standard' }, new AbortController().signal)).rejects.toThrow()
    expect(peer.authorizeExecution).not.toHaveBeenCalled()
  })

  const execution = { ...input, presetId: 'hansen-personal', publication: null, skills: [] }
  const publication = { tenantId: 'enterprise-fixture', publicationId: '12345678-1234-1234-1234-123456789abc',
    sourceUserId: '12345678-1234-1234-1234-123456789def', contentDigest: 'sha256:' + 'a'.repeat(64) }
  const enterprise = { ...input, presetId: 'paimind-enterprise-12345678123412341234123456789abc', publication, skills: [] }
  it('never upgrades a successful login-only response into execution authority', async () => {
    const f = await fixture(); await f.peer.checkOrigins(input)
    await expect(f.peer.authorizeExecution(execution)).rejects.toThrow()
    expect(f.check).toHaveBeenCalledOnce(); expect(f.peer.ready).toBe(true)
  })
  it('carries the exact native adoption proof, rechecks, and propagates resource revocation', async () => {
    const authorize = vi.fn(async () => {}), f = await fixture(undefined, true, authorize)
    await f.peer.authorizeExecution(enterprise)
    expect(authorize.mock.calls[0]?.[0]).toEqual(enterprise); expect(f.check).not.toHaveBeenCalled()
    authorize.mockRejectedValueOnce(Error('withdrawn'))
    await expect(f.peer.authorizeExecution(enterprise)).rejects.toThrow()
    await f.peer.authorizeExecution(execution); expect(authorize).toHaveBeenCalledTimes(3)
  })
  it('refuses omitted, forged or mismatched adoption proof before authority receives it', async () => {
    const authorize = vi.fn(async () => {}), f = await fixture(undefined, true, authorize)
    for (const value of [{ ...enterprise, publication: null, skills: [] }, { ...execution, publication },
      { ...enterprise, publication: { ...publication, contentDigest: 'unknown' } },
      { ...enterprise, publication: { ...publication, tenantId: '' } },
      { ...enterprise, publication: { ...publication, publicationId: publication.sourceUserId } },
      { ...enterprise, publication: { ...publication, snapshot: {} } }, { ...enterprise, role: 'admin' }]) {
      await expect(f.peer.authorizeExecution(value as NativeExecutionInput)).rejects.toThrow()
    }
    expect(authorize).not.toHaveBeenCalled(); expect(f.check).not.toHaveBeenCalled()
  })
  it('aborts a pending execution authorization and never reuses its late allow', async () => {
    const entered = Promise.withResolvers<AbortSignal>(), finish = Promise.withResolvers<void>()
    const authorize = vi.fn(async (_input: unknown, signal: AbortSignal) => { entered.resolve(signal); await finish.promise })
    const f = await fixture(undefined, true, authorize), abort = new AbortController()
    const pending = f.peer.authorizeExecution(enterprise, abort.signal), rejected = expect(pending).rejects.toThrow()
    const signal = await entered.promise; abort.abort(); await rejected
    await vi.waitFor(() => expect(signal.aborted).toBe(true)); finish.resolve()
    authorize.mockRejectedValue(Error('revoked'))
    await expect(f.peer.authorizeExecution(enterprise)).rejects.toThrow()
  })
})
