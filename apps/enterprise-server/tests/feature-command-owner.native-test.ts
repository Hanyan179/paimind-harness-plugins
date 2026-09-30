import { fork, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeControlBroker } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { createNativeIngress } from '../../../deploy/enterprise/worker/runtime/native-ingress.mjs'
import { CellTransport } from '../src/cell-transport.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const children: ChildProcess[] = []
const dispose: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exit
  }
  for (const close of dispose.splice(0).reverse()) await close()
})
async function start(directory: string) {
  const child = fork(resolve(repo, 'apps/enterprise-server/tests/fixtures/feature-command-owner.mjs'), [], {
    cwd: directory, env: { PATH: process.env.PATH, PAIMIND_FEATURE_OWNER_TEST: '1', DSH_TELEMETRY_MODE: 'DISABLED' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.push(child)
  let output = ''; child.stdout!.on('data', bytes => { output += bytes }); child.stderr!.on('data', bytes => { output += bytes })
  const pending = new Map<string, { resolve(value: any): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>()
  child.on('message', (message: any) => {
    const entry = pending.get(message.id); if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.value)
  })
  child.on('exit', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Native owner exited: ' + output.slice(-6000))) }; pending.clear() })
  const request = (operation: string, input?: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('Native owner timeout: ' + output.slice(-6000))) }, 10_000)
    pending.set(id, { resolve, reject, timer }); child.send({ id, operation, input })
  })
  const boot = await request('boot')
  return { child, request, boot, async stop() {
    const exit = new Promise(resolve => child.once('exit', resolve)); const result = await request('stop'); await exit
    expect(result.live).toEqual([]); expect(child.exitCode).toBe(0)
    await writeFile(resolve(directory, `process-${child.pid}.log`), output, { mode: 0o600, flag: 'wx' })
  } }
}
async function directory() { return mkdtemp(resolve(dirname(repo), '.paimind-goal-evidence/haas-feature-owner-')) }
async function record(name: string, path: string, snapshots: unknown[]) {
  const evidence = process.env.PAIMIND_FEATURE_OWNER_EVIDENCE, tag = process.env.PAIMIND_FEATURE_OWNER_TAG
  if (!evidence || !tag) return
  expect(evidence.startsWith(resolve(dirname(repo), '.paimind-goal-evidence') + '/')).toBe(true)
  expect(tag).toMatch(/^[a-z0-9-]+$/u)
  const bytes = await readFile(resolve(path, 'settings.json'))
  await writeFile(resolve(evidence, `${tag}-${name}-processes.json`), JSON.stringify({ path, snapshots,
    finalSettingsSha256: createHash('sha256').update(bytes).digest('hex'), fixtureBodies: true,
    realFileSettings: true, realLoaderGroups: true, browserE2E: false }, null, 2), { flag: 'wx', mode: 0o600 })
}
async function command(worker: Awaited<ReturnType<typeof start>>, enabled: boolean) {
  const state = await worker.request('snapshot')
  const selection = { id: 'paimind:pack:operations', enabled, expectedRevision: state.view.revision }
  const plan = await worker.request('plan', selection)
  return { commandId: randomUUID(), requestDigest: 'sha256:' + 'd'.repeat(64), planDigest: plan.planDigest,
    selection, approvedPackIds: plan.reconciledPackIds }
}

describe('actual native file Settings and Loader processes; diagnostic group bodies, not Browser E2E', () => {
  it('carries exact commands through real private HTTP and Unix sockets, then confirms an accepted timed-out change', async () => {
    const path = await directory(), worker = await start(path)
    // Relative socket paths keep Darwin sun_path bounded while all temporary
    // resources remain inside this isolated worktree and are removed on close.
    const broker = await createNativeControlBroker('.'); dispose.push(() => broker.close())
    await worker.request('connect', { path: relative(path, resolve(broker.path)) })
    await vi.waitFor(() => expect(broker.ready).toBe(true))
    const token = randomBytes(32).toString('hex')
    const ingress = createNativeIngress({ token, control: (operation, input, signal) => broker.request(operation, input, signal) })
    dispose.push(() => ingress.close())
    await new Promise<void>(resolve => ingress.server.listen(0, '127.0.0.1', resolve))
    const address = ingress.server.address(); if (!address || typeof address === 'string') throw Error('Missing private fixture port')
    const transport = new CellTransport(`http://127.0.0.1:${address.port}`, token); dispose.push(() => transport.destroy())
    const read = () => transport.requestControl('feature.describe', {}) as Promise<any>
    const initial = await read(), selection = { id: 'paimind:pack:operations', enabled: false, expectedRevision: initial.view.revision }
    const plan = await transport.requestControl('feature.plan', selection) as any
    const c = { commandId: randomUUID(), requestDigest: 'sha256:' + 'c'.repeat(64), planDigest: plan.planDigest,
      selection, approvedPackIds: plan.reconciledPackIds }
    await expect(transport.requestControl('feature.apply', { ...c, approvedPackIds: [] })).rejects.toThrow()
    expect((await read()).command).toBeNull()
    await expect(transport.requestControl('feature.plan', { ...selection, id: 'paimind:pack:unregistered' })).rejects.toThrow()
    await worker.request('holdDisable')
    const pending = transport.requestControl('feature.apply', c, undefined, 1000)
    const denied = expect(pending).rejects.toThrow()
    let accepted: any
    await vi.waitFor(async () => { accepted = await read(); expect(accepted.command?.phase).toBe('applying') })
    await denied
    // Timeout/cancel does not roll back already accepted Settings/Loader work.
    const settled = await worker.request('releaseDisable')
    expect(settled.command.phase).toBe('applied'); expect(settled.live).not.toContain('paimind-pack-operations')
    const final = await read(); expect(final.command.commandId).toBe(c.commandId)
    expect(JSON.stringify(final)).not.toContain(token)
    expect((await transport.requestControl('feature.apply', c) as any).replayed).toBe(true)
    expect((await worker.request('snapshot')).transitions).toEqual(settled.transitions)
    await worker.stop()
    await record('private-control', path, [worker.boot, { privateRead: accepted, pid: worker.child.pid }, settled])
  })

  it('persists one owner journal with overrides, confirms actual group disposal and retains outcome after a new process', async () => {
    const path = await directory(), first = await start(path), c = await command(first, false)
    expect(first.boot.live).toContain('paimind-pack-operations')
    expect((await first.request('apply', c)).command.phase).toBe('applied')
    const final = await first.request('snapshot')
    expect(final.live).not.toContain('paimind-pack-operations')
    const section = final.document['paimind-feature-packs']
    expect(JSON.parse(section.overrides)['paimind:pack:operations']).toBe(false)
    expect(JSON.parse(section.governance).commandId).toBe(c.commandId)
    const bytes = await readFile(resolve(path, 'settings.json'), 'utf8')
    await first.stop()
    const cold = await start(path); expect(cold.child.pid).not.toBe(first.child.pid)
    expect(cold.boot.live).not.toContain('paimind-pack-operations')
    expect(cold.boot.command.phase).toBe('applied')
    const before = (await cold.request('snapshot')).transitions
    expect((await cold.request('apply', c)).replayed).toBe(true)
    expect((await cold.request('snapshot')).transitions).toEqual(before)
    expect(await readFile(resolve(path, 'settings.json'), 'utf8')).toBe(bytes)
    const restored = await cold.request('snapshot')
    await cold.stop()
    await record('completed', path, [first.boot, final, cold.boot, restored])
  })

  it('retains accepted intent after a lost completion, cold-boots prior configuration and requires approved recovery', async () => {
    const path = await directory(), first = await start(path), c = await command(first, false)
    await first.request('failReceipt', { phase: 'applied' })
    await expect(first.request('apply', c)).rejects.toThrow('Injected lost completion write')
    const pending = await first.request('snapshot')
    expect(pending.command.phase).toBe('applying'); expect(pending.live).not.toContain('paimind-pack-operations')
    const intent = await readFile(resolve(path, 'settings.json'), 'utf8')
    await first.stop()
    const cold = await start(path); expect(cold.child.pid).not.toBe(first.child.pid)
    expect(cold.boot.command.phase).toBe('applying')
    expect(cold.boot.live).toContain('paimind-pack-operations')
    expect(await readFile(resolve(path, 'settings.json'), 'utf8')).toBe(intent)
    await expect(cold.request('apply', { ...c, approvedPackIds: [] })).rejects.toThrow('Approval must cover every Product Pack')
    expect((await cold.request('snapshot')).live).toContain('paimind-pack-operations')
    expect((await cold.request('apply', c)).command.phase).toBe('applied')
    const recovered = await cold.request('snapshot')
    expect(recovered.live).not.toContain('paimind-pack-operations')
    await cold.stop()
    await record('recovered', path, [first.boot, pending, cold.boot, recovered])
  })
})
