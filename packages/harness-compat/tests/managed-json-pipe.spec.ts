import { PassThrough, Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { managedJsonBytes, managedJsonWriter, readManagedJson, snapshotManagedJson } from '../src/managed-json-pipe.js'

async function roundtrip(value: unknown) {
  const pipe = new PassThrough({ highWaterMark: 97 })
  const values = Array.fromAsync(readManagedJson(pipe))
  await managedJsonWriter(pipe)(value); pipe.end()
  return (await values)[0]
}

describe('managed lossless process transport', () => {
  it('preserves deep data, aliases, negative zero, Unicode and hostile property names', async () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 12_000; i++) deep = { next: deep }
    const shared = { hello: '汉森😀\ud800'.repeat(3000) }
    const value = { deep, one: shared, two: shared, negative: -0, ...JSON.parse('{"__proto__":{"admin":true},"constructor":"literal"}') }
    const result = await roundtrip(value) as typeof value
    expect(result.one).toEqual(shared); expect(result.two).toEqual(shared)
    expect(result.one).not.toBe(result.two); expect(Object.is(result.negative, -0)).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    let cursor = result.deep as { next: unknown }
    for (let i = 0; i < 12_000; i++) cursor = cursor.next as typeof cursor
    expect(cursor).toBe('leaf')
  })

  it('accepts plain foreign-realm and null-prototype JSON but never invokes accessors', async () => {
    expect(await roundtrip(runInNewContext('({array:[1,{ok:true}]})'))).toEqual({ array: [1, { ok: true }] })
    expect(await roundtrip(Object.assign(Object.create(null), { ok: 1 }))).toEqual({ ok: 1 })
    let invoked = false
    expect(() => snapshotManagedJson({ get secret() { invoked = true; return 1 } })).toThrow()
    expect(invoked).toBe(false)
  })

  it('rejects lossy values before corrupting a reusable output stream', async () => {
    const cycle: unknown[] = []; cycle.push(cycle)
    const extra = [1]; Object.assign(extra, { other: 2 })
    for (const value of [undefined, NaN, Infinity, 1n, () => {}, new Date(), new Map(), cycle, [undefined], [, 1], extra,
      { [Symbol('lost')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })]) {
      expect(() => snapshotManagedJson(value)).toThrow()
    }
    const pipe = new PassThrough(); const output = Array.fromAsync(readManagedJson(pipe))
    const send = managedJsonWriter(pipe)
    expect(() => send([undefined])).toThrow()
    await Promise.all([send({ ok: 1 }), send({ ok: 2 })]); pipe.end()
    expect(await output).toEqual([{ ok: 1 }, { ok: 2 }])
  })

  it.each(['["finish"]\n', '["array"]\n', '["number","NaN"]\n', '["literal",null,1]\n',
    '["object"]\n["array"]\n', 'x'.repeat(65_537), '["text","bad"]\n'])('rejects malformed or truncated frames', async input => {
    await expect(Array.fromAsync(readManagedJson(Readable.from([input])))).rejects.toThrow()
  })

  it('counts the exact JSON payload bytes and stops at a configured ceiling', () => {
    for (const value of [null, true, false, -0, 1e22, [1, '汉森😀\ud800\n\u0001'], { 'a\\"': ['ok', { b: 2 }] }]) {
      expect(managedJsonBytes(value, Infinity)).toBe(Buffer.byteLength(JSON.stringify(value)))
    }
    expect(managedJsonBytes('x'.repeat(100_000), 4)).toBeGreaterThan(4)
  })
})
