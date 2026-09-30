import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectMemberCheckpoint, finalizeMemberCheckpoint } from './member-checkpoint.mjs'

const columns = { cellId: 'cell_id', tenantId: 'tenant_id', userId: 'user_id', origin: 'origin',
  containerId: 'container_id', imageId: 'image_id', volumeName: 'volume_name', policyDigest: 'policy_digest', revision: 'revision' }
const fixture = () => {
  const accounts = ['alex', 'hansen'].map(username => ({ username, userId: username + '-user', role: 'member' }))
  const generation = (account, suffix) => ({ member: account.username, controlVolume: account.username + '-control',
    labels: { owned: account.username }, transportKey: 'PRIVATE_TEST_KEY', agent: { private: true },
    pin: { cellId: account.username + '-cell', tenantId: 'owned-tenant', userId: account.userId, role: account.role,
      origin: 'http://127.0.0.1:' + (50000 + (suffix === 'old' ? 0 : 2) + accounts.indexOf(account)),
      containerId: account.username + '-' + suffix, imageId: suffix + '-image', volumeName: account.username + '-data',
      policyDigest: account.username + '-policy', revision: suffix + '-revision' } })
  const old = accounts.map(account => generation(account, 'old')), fresh = accounts.map(account => generation(account, 'fresh'))
  const row = (cell, status = 'suspended') => ({ ...Object.fromEntries(Object.entries(columns).map(([field, column]) => [column, cell.pin[field]])),
    isolation_mode: 'container-managed', status, expired: status === 'suspended', revision: status === 'ready' ? cell.pin.revision : 'suspended-revision' })
  return { accounts, tenantId: 'owned-tenant', knownCells: [...fresh, ...old], old, fresh, row,
    bindings: [row(fresh[0]), row(old[1])], closed: true }
}
test('partial replacement selects the committed new Alex and untouched prior Hansen, without credentials or mutation', () => {
  const f = fixture(), before = structuredClone({ knownCells: f.knownCells, bindings: f.bindings })
  const selected = selectMemberCheckpoint(f)
  assert.deepEqual(selected.map(cell => cell.pin.containerId), ['alex-fresh', 'hansen-old'])
  assert.ok(selected.every(cell => cell.pin.revision === 'suspended-revision' && !('agent' in cell) && !('transportKey' in cell)))
  assert.deepEqual({ knownCells: f.knownCells, bindings: f.bindings }, before)
})
test('failure before any replacement retains both exact old generations', () => {
  const f = fixture(); f.bindings = f.old.map(cell => f.row(cell))
  assert.deepEqual(selectMemberCheckpoint(f).map(cell => cell.pin.containerId), ['alex-old', 'hansen-old'])
})
test('normal live checkpoint requires the current revision, while closure requires suspended expired leases', () => {
  const f = fixture(); f.bindings = f.fresh.map(cell => f.row(cell, 'ready')); f.closed = false
  assert.deepEqual(selectMemberCheckpoint(f).map(cell => cell.pin.containerId), ['alex-fresh', 'hansen-fresh'])
  f.closed = true; assert.throws(() => selectMemberCheckpoint(f), /expired suspended/)
  f.closed = false; f.bindings[0].revision = 'foreign-revision'
  assert.throws(() => selectMemberCheckpoint(f), /Live binding revision changed/)
  const suspended = fixture(); suspended.bindings[0].expired = false
  assert.throws(() => selectMemberCheckpoint(suspended), /expired suspended/)
})
test('foreign/missing/duplicate identities and every non-revision pin drift are rejected', () => {
  for (const column of Object.values(columns).filter(column => column !== 'revision')) {
    const f = fixture(); f.bindings[0][column] = 'FOREIGN'
    assert.throws(() => selectMemberCheckpoint(f), undefined, column)
  }
  for (const change of [f => { f.knownCells[0].pin.role = 'admin' }, f => { f.knownCells[0].member = 'different' },
    f => { f.knownCells.push(f.knownCells[0]) }, f => { f.bindings.push(f.bindings[0]) },
    f => { f.bindings.shift() }, f => { f.accounts.push(f.accounts[0]) },
    f => { f.bindings[0].isolation_mode = 'loopback-development' }, f => { f.bindings[0].status = 'unknown' }]) {
    const f = fixture(); change(f); assert.throws(() => selectMemberCheckpoint(f))
  }
})
test('failed checkpoint still writes an explicitly incomplete closure and ends the DB client', async () => {
  const calls = [], result = await finalizeMemberCheckpoint({ cleanupComplete: true,
    persist: async () => { calls.push('persist'); throw Error('unmatched binding') },
    writeReceipt: async receipt => { calls.push(receipt) }, closeDatabase: async () => { calls.push('close') } })
  assert.deepEqual(calls, ['persist', { cleanupComplete: true, checkpointRecorded: false }, 'close'])
  assert.deepEqual(result, { checkpointRecorded: false, failures: ['checkpoint'] })
})
test('unconfirmed cleanup never blesses a checkpoint; receipt failures still close the DB', async () => {
  const calls = [], result = await finalizeMemberCheckpoint({ cleanupComplete: false,
    persist: async () => assert.fail('Unconfirmed cleanup cannot authorize resume'),
    writeReceipt: async receipt => { calls.push(receipt); throw Error('disk unavailable') },
    closeDatabase: async () => { calls.push('close'); throw Error('DB close failed') } })
  assert.deepEqual(calls, [{ cleanupComplete: false, checkpointRecorded: false }, 'close'])
  assert.deepEqual(result, { checkpointRecorded: false, failures: ['closure-receipt', 'database-close'] })
})
test('successful closure records the checkpoint and closes the database exactly once', async () => {
  const calls = [], result = await finalizeMemberCheckpoint({ cleanupComplete: true,
    persist: async () => { calls.push('persist') }, writeReceipt: async receipt => { calls.push(receipt) },
    closeDatabase: async () => { calls.push('close') } })
  assert.deepEqual(calls, ['persist', { cleanupComplete: true, checkpointRecorded: true }, 'close'])
  assert.deepEqual(result, { checkpointRecorded: true, failures: [] })
})
