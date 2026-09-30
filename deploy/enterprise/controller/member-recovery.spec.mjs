import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { maintainMemberLeases, runBoundedCommand } from './member-liveness.mjs'
import { MemberRecoveryRequests, readMemberRecoveryCommand, waitForAdministratorRecovery } from './member-recovery.mjs'

const cell = () => ({ pin: { cellId: randomUUID(), tenantId: 'contract-fixture', userId: randomUUID(), role: 'member',
  revision: randomUUID(), containerId: randomUUID(), imageId: 'immutable-fixture', volumeName: randomUUID(), policyDigest: 'fixture' } })
const nextCell = old => ({ pin: { ...old.pin, revision: randomUUID(), containerId: randomUUID() } })
const command = old => ({ requestId: randomUUID(), cellId: old.pin.cellId, expectedRevision: old.pin.revision })
test('administrator inbox hands a verified replacement to the original lane and joins its polling lifecycle', async () => {
  const inbox=new MemberRecoveryRequests(),abort=new AbortController(),old=cell(),next=nextCell(old)
  let reads=0,effects=0
  const result=await waitForAdministratorRecovery(inbox.wait(old,abort.signal),{signal:abort.signal,intervalMs:1,
    poll:async()=>{reads++;await inbox.recover(command(old),async()=>{effects++;return next});return false},onError:async()=>assert.fail('Unexpected inbox failure')})
  assert.equal(result,next);assert.equal(effects,1);assert.equal(reads,1)
  await delay(5);assert.equal(reads,1)
})
test('inbox dependency retries are read-only and emit once per outage; claimed actions are not automatically repeated',async()=>{
  const inbox=new MemberRecoveryRequests(),abort=new AbortController(),old=cell(),next=nextCell(old)
  let reads=0,errors=0,effects=0
  const result=await waitForAdministratorRecovery(inbox.wait(old,abort.signal),{signal:abort.signal,intervalMs:1,
    poll:async()=>{if(++reads<3)throw Error('Synthetic DB unavailable');await inbox.recover(command(old),async()=>{effects++;return next});return false},onError:async()=>{errors++}})
  assert.equal(result,next);assert.equal(reads,3);assert.equal(errors,1);assert.equal(effects,1)
})
test('terminal uncertainty stops inbox reads and shutdown joins the dormant lane without another mutation',async()=>{
  const inbox=new MemberRecoveryRequests(),abort=new AbortController(),old=cell();let reads=0
  const waiting=waitForAdministratorRecovery(inbox.wait(old,abort.signal),{signal:abort.signal,intervalMs:1,poll:async()=>{reads++;return false},onError:async()=>assert.fail()})
  const rejected=assert.rejects(waiting)
  await delay(5);assert.equal(reads,1);abort.abort();await rejected;assert.equal(inbox.snapshot().length,0)
})
async function until(predicate) {
  const stop = Date.now() + 2000
  while (!predicate()) { assert.ok(Date.now() < stop, 'Observation deadline'); await delay(2) }
}

test('explicit recovery resumes only the withdrawn lane while a real child operation leaves the healthy lane live', async () => {
  const inbox = new MemberRecoveryRequests(), abort = new AbortController(), a = cell(), h = cell(), next = nextCell(a)
  let healthy = 0, resumed = 0, withdrawals = 0
  const run = maintainMemberLeases([a, h], { signal: abort.signal, intervalMs: 1,
    cycle: async selected => {
      if (selected === a) throw Error('Explicit member failure')
      if (selected === next) resumed++
      else { assert.equal(selected, h); healthy++ }
    }, withdraw: async selected => { assert.equal(selected, a); withdrawals++ }, onTerminal: async () => {},
    waitForRecovery: (selected, signal) => inbox.wait(selected, signal) })
  try {
    await until(() => inbox.snapshot().length === 1)
    const before = healthy
    const result = await inbox.recover(command(a), async selected => {
      assert.equal(selected, a)
      await runBoundedCommand(process.execPath, ['-e', 'setTimeout(()=>{},100)'])
      assert.ok(healthy > before + 10)
      return next
    })
    assert.equal(result.revision, next.pin.revision)
    await until(() => resumed >= 3)
    assert.equal(withdrawals, 1); assert.equal(inbox.snapshot().length, 0)
  } finally { abort.abort(); await run }
})

test('exact request identity coalesces; stale, unknown and concurrent different requests cannot invoke recovery', async () => {
  const inbox = new MemberRecoveryRequests(), abort = new AbortController(), a = cell(), h = cell()
  const aWaiting = inbox.wait(a, abort.signal), hWaiting = inbox.wait(h, abort.signal)
  const hRejected = assert.rejects(hWaiting)
  const release = Promise.withResolvers(), request = command(a)
  let calls = 0
  const operation = async () => { calls++; await release.promise; return nextCell(a) }
  try {
    assert.throws(() => inbox.recover({ ...request, expectedRevision: randomUUID() }, operation), /exact withdrawn/)
    const pending = inbox.recover(request, operation)
    assert.equal(inbox.recover(request, operation), pending)
    assert.throws(() => inbox.recover({ ...request, expectedRevision: randomUUID() }, operation), /different input/)
    assert.throws(() => inbox.recover(command(h), operation), /in progress/)
    release.resolve(); const result = await pending
    assert.equal((await aWaiting).pin.revision, result.revision); assert.equal(calls, 1)
    assert.deepEqual(await inbox.recover(request, operation), result)
    assert.throws(() => inbox.recover(command(a), operation), /exact withdrawn/)
  } finally { release.resolve(); abort.abort(); await hRejected }
})

test('a failed or invalid replacement remains unconfirmed and cannot automatically retry or wake the lane', async () => {
  for (const failure of ['engine-unknown', 'wrong-member']) {
    const inbox = new MemberRecoveryRequests(), abort = new AbortController(), a = cell()
    const waiting = inbox.wait(a, abort.signal), rejected = assert.rejects(waiting)
    const request = command(a)
    let calls = 0
    try {
      await assert.rejects(inbox.recover(request, async () => {
        calls++
        if (failure === 'engine-unknown') throw Error('Unconfirmed owned engine effect')
        return { pin: { ...nextCell(a).pin, userId: randomUUID() } }
      }))
      assert.equal(inbox.snapshot()[0].state, 'recovery-unconfirmed')
      await assert.rejects(inbox.recover(request, async () => { calls++; return nextCell(a) }))
      assert.throws(() => inbox.recover(command(a), async () => { calls++; return nextCell(a) }), /exact withdrawn/)
      assert.equal(calls, 1)
    } finally { abort.abort(); await rejected }
  }
})

test('global stop cancels waiting and discards a late recovered cell before any new renewal', async () => {
  const inbox = new MemberRecoveryRequests(), abort = new AbortController(), a = cell(), entered = Promise.withResolvers(), release = Promise.withResolvers()
  let resumed = 0
  const run = maintainMemberLeases([a], { signal: abort.signal,
    cycle: async selected => { if (selected !== a) resumed++; throw Error('Withdraw this exact fixture') },
    withdraw: async () => {}, onTerminal: async () => {}, waitForRecovery: (selected, signal) => inbox.wait(selected, signal) })
  await until(() => inbox.snapshot().length === 1)
  const pending = inbox.recover(command(a), async () => { entered.resolve(); await release.promise; return nextCell(a) })
  const rejected = assert.rejects(pending)
  await entered.promise; abort.abort(); release.resolve()
  await rejected; await run
  assert.equal(resumed, 0); assert.equal(inbox.snapshot().length, 0)
})

test('operator command accepts exactly three canonical UUID fields, never paths, roles or addresses', () => {
  const value = command(cell())
  assert.deepEqual(readMemberRecoveryCommand(value), value)
  for (const candidate of [null, [], { ...value, role: 'admin' }, { ...value, origin: 'http://127.0.0.1:3080' },
    { ...value, path: '/outside' }, { ...value, requestId: 'invalid' }, { cellId: value.cellId }]) {
    assert.throws(() => readMemberRecoveryCommand(candidate))
  }
})
