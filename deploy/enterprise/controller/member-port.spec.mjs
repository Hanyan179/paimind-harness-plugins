import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { reserveMemberPort } from './member-port.mjs'

async function bind(port) {
  const server = createServer(socket => socket.destroy())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  return () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
const assertFree = async origin => { const close = await bind(Number(new URL(origin).port)); await close() }

test('holds a real loopback port during the DB read and until explicit idempotent release', { timeout: 5000 }, async () => {
  const reserved = await reserveMemberPort({ isRetained: async origin => {
    await assert.rejects(bind(Number(new URL(origin).port)), { code: 'EADDRINUSE' })
    return false
  } })
  try { await assert.rejects(bind(reserved.port), { code: 'EADDRINUSE' }) }
  finally { await Promise.all([reserved.release(), reserved.release()]) }
  await assertFree(reserved.origin)
})
test('rejects retained origins, bounds allocation, and releases every rejected candidate', { timeout: 5000 }, async () => {
  const rejected = []
  await assert.rejects(reserveMemberPort({ maxAttempts: 3, isRetained: async origin => {
    rejected.push(origin); return true
  } }), /bounded allocation window/)
  assert.ok(rejected.length > 0 && rejected.length <= 3)
  for (const origin of rejected) await assertFree(origin)
  let first
  const reserved = await reserveMemberPort({ isRetained: async origin => {
    if (!first) { first = origin; return true }
    return false
  } })
  assert.notEqual(reserved.origin, first)
  await reserved.release(); await assertFree(first)
})
test('DB errors and malformed DB answers fail closed without leaking a listener', { timeout: 5000 }, async () => {
  for (const response of ['throw', undefined, 1, 'false']) {
    let candidate
    await assert.rejects(reserveMemberPort({ isRetained: async origin => {
      candidate = origin
      if (response === 'throw') throw Error('database unavailable')
      return response
    } }))
    await assertFree(candidate)
  }
})
test('abort before, during and after allocation releases the held port', { timeout: 5000 }, async () => {
  const before = new AbortController(); before.abort()
  await assert.rejects(reserveMemberPort({ signal: before.signal, isRetained: () => assert.fail('No DB read expected') }), { name: 'AbortError' })
  const during = new AbortController(); let candidate
  await assert.rejects(reserveMemberPort({ signal: during.signal, isRetained: async origin => {
    candidate = origin; during.abort(); return false
  } }), { name: 'AbortError' })
  await assertFree(candidate)
  const after = new AbortController()
  const reserved = await reserveMemberPort({ signal: after.signal, isRetained: async () => false })
  after.abort(); await reserved.release(); await assertFree(reserved.origin)
})
test('simultaneously held allocations are different and both remain reserved', { timeout: 5000 }, async () => {
  const reservations = await Promise.all(Array.from({ length: 2 }, () => reserveMemberPort({ isRetained: async () => false })))
  try {
    assert.equal(new Set(reservations.map(row => row.origin)).size, 2)
    for (const row of reservations) await assert.rejects(bind(row.port), { code: 'EADDRINUSE' })
  } finally { await Promise.all(reservations.map(row => row.release())) }
})
