import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Readable, Writable } from 'node:stream'

// Internal process transport only. It carries complete lossless JSON values,
// not executable objects, capability handles, or a second runtime protocol.
// Flat bounded frames avoid JS/JSON/structured-clone nesting limits. Complete
// binding values deliberately have no byte cap; the execution cell's memory
// quota remains the acquisition bound, as in the native Code Runtime contract.
export type JsonData = null | boolean | number | string | JsonData[] | { [key: string]: JsonData }
const frameBytes = 64 * 1024
const stringUnits = 4096

function intrinsicPrototype(prototype: object, kind: 'Object' | 'Array') {
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
  return typeof constructor === 'function' && constructor.name === kind
    && constructor.prototype === prototype
    && Function.prototype.toString.call(constructor) === `function ${kind}() { [native code] }`
}

/** Validate before emitting anything, and snapshot against mutation while the
 * writable pipe is backpressured. Repeated references are legal; cycles aren't. */
export function snapshotManagedJson(input: unknown): JsonData {
  let result: JsonData | undefined
  const active = new Set<object>()
  type Visit = { value: unknown; put(value: JsonData): void } | { leave: object }
  const todo: Visit[] = [{ value: input, put: value => { result = value } }]
  while (todo.length) {
    const visit = todo.pop()!
    if ('leave' in visit) { active.delete(visit.leave); continue }
    const value = visit.value
    if (value === null || typeof value === 'string' || typeof value === 'boolean') { visit.put(value); continue }
    if (typeof value === 'number' && Number.isFinite(value)) { visit.put(value); continue }
    assert.ok(typeof value === 'object' && value !== null, 'Value must be lossless JSON')
    assert.ok(!active.has(value), 'JSON cannot contain cycles')
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    assert.ok(array
      ? Array.isArray(prototype) && intrinsicPrototype(prototype, 'Array')
      : prototype === null || Object.getPrototypeOf(prototype) === null && intrinsicPrototype(prototype, 'Object'),
    'JSON containers must have plain intrinsic or null prototypes')
    const keys = Reflect.ownKeys(value)
    const length = array ? value.length : keys.length
    if (array) assert.equal(keys.length, length + 1, 'JSON arrays must be dense without extra properties')
    const copy: JsonData[] | { [key: string]: JsonData } = array ? new Array(length) : {}
    visit.put(copy); active.add(value); todo.push({ leave: value })
    for (let index = length - 1; index >= 0; index--) {
      const key = array ? String(index) : keys[index]
      assert.equal(typeof key, 'string', 'JSON cannot contain symbol properties')
      const descriptor = Object.getOwnPropertyDescriptor(value, key!)
      assert.ok(descriptor && 'value' in descriptor && descriptor.enumerable, 'JSON requires enumerable data properties')
      todo.push({ value: descriptor.value, put: item => {
        Object.defineProperty(copy, key!, { value: item, enumerable: true, writable: true, configurable: true })
      } })
    }
  }
  return result!
}

type Token = readonly JsonData[]
function *tokens(value: JsonData): Generator<Token> {
  const close = Symbol('close')
  const todo: Array<JsonData | typeof close> = [value]
  while (todo.length) {
    const item = todo.pop()!
    if (item === close) { yield ['close']; continue }
    if (typeof item === 'string') {
      yield ['string']
      for (let i = 0; i < item.length; i += stringUnits) yield ['text', item.slice(i, i + stringUnits)]
      yield ['end-string']
    } else if (typeof item === 'number') yield ['number', Object.is(item, -0) ? '-0' : String(item)]
    else if (item === null || typeof item === 'boolean') yield ['literal', item]
    else {
      const array = Array.isArray(item)
      yield [array ? 'array' : 'object']; todo.push(close)
      if (array) for (let i = item.length - 1; i >= 0; i--) todo.push(item[i]!)
      else {
        const keys = Object.keys(item)
        for (let i = keys.length - 1; i >= 0; i--) { const key = keys[i]!; todo.push(item[key]!, key) }
      }
    }
  }
  yield ['finish']
}

class ValueDecoder {
  private root: JsonData | undefined
  private readonly containers: Array<{ value: JsonData[] | { [key: string]: JsonData }; key?: string }> = []
  private string: string[] | undefined
  private put(value: JsonData) {
    const parent = this.containers.at(-1)
    if (!parent) { assert.equal(this.root, undefined, 'Duplicate message value'); this.root = value }
    else if (Array.isArray(parent.value)) parent.value.push(value)
    else if (parent.key === undefined) { assert.equal(typeof value, 'string', 'Invalid object key'); parent.key = value as string }
    else {
      assert.ok(!Object.hasOwn(parent.value, parent.key), 'Duplicate object key')
      Object.defineProperty(parent.value, parent.key, { value, enumerable: true, writable: true, configurable: true })
      delete parent.key
    }
  }
  accept(raw: unknown): { value: JsonData } | undefined {
    assert.ok(Array.isArray(raw) && typeof raw[0] === 'string', 'Invalid transport token')
    const [kind, value] = raw
    assert.equal(raw.length, ['text', 'number', 'literal'].includes(kind) ? 2 : 1, 'Invalid transport token fields')
    if (this.string !== undefined) {
      if (kind === 'text') { assert.ok(typeof value === 'string' && value.length <= stringUnits); this.string.push(value); return }
      assert.equal(kind, 'end-string', 'Unterminated transport string')
      const text = this.string.join(''); this.string = undefined; this.put(text); return
    }
    if (kind === 'string') { this.string = []; return }
    if (kind === 'array' || kind === 'object') {
      const container = kind === 'array' ? [] : {}
      this.put(container); this.containers.push({ value: container }); return
    }
    if (kind === 'close') {
      const container = this.containers.pop()
      assert.ok(container && container.key === undefined, 'Incomplete transport container'); return
    }
    if (kind === 'literal') { assert.ok(value === null || typeof value === 'boolean'); this.put(value); return }
    if (kind === 'number') {
      assert.ok(typeof value === 'string' && Number.isFinite(Number(value))
        && (value === '-0' || String(Number(value)) === value), 'Invalid finite number')
      this.put(Number(value)); return
    }
    assert.equal(kind, 'finish', 'Unknown transport token')
    assert.ok(this.root !== undefined && this.containers.length === 0, 'Incomplete transport message')
    const result = { value: this.root }; this.root = undefined; return result
  }
  assertEmpty() { assert.ok(this.root === undefined && !this.containers.length && this.string === undefined, 'Truncated transport message') }
}

export async function *readManagedJson(input: Readable): AsyncGenerator<JsonData> {
  let pending = Buffer.alloc(0)
  const decoder = new ValueDecoder()
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  for await (const data of input) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as string)
    let from = 0
    while (from < chunk.length) {
      const newline = chunk.indexOf(10, from)
      const end = newline === -1 ? chunk.length : newline
      assert.ok(pending.length + end - from <= frameBytes, 'Transport frame too large')
      const line = Buffer.concat([pending, chunk.subarray(from, end)])
      if (newline === -1) { pending = line; break }
      pending = Buffer.alloc(0); from = newline + 1
      const result = decoder.accept(JSON.parse(utf8.decode(line)))
      if (result) yield result.value
    }
  }
  assert.equal(pending.length, 0, 'Truncated transport frame'); decoder.assertEmpty()
}

export function managedJsonWriter(output: Writable) {
  let tail = Promise.resolve()
  return (value: unknown): Promise<void> => {
    const snapshot = snapshotManagedJson(value)
    const write = async () => {
      for (const token of tokens(snapshot)) {
        assert.ok(!output.destroyed, 'Transport has closed')
        const line = JSON.stringify(token) + '\n'
        assert.ok(Buffer.byteLength(line) <= frameBytes)
        if (!output.write(line)) await once(output, 'drain')
      }
    }
    const operation = tail.then(write)
    // A partially written message cannot be recovered/reinterpreted as another.
    tail = operation.catch(error => { output.destroy(error as Error); throw error })
    void tail.catch(() => undefined)
    return operation
  }
}

/** Native outer-result accounting, without recursion or giant JSON.stringify
 * allocation. Stops as soon as the allowed variable payload is exceeded. */
export function managedJsonBytes(value: JsonData, ceiling: number): number {
  let bytes = 0
  function string(text: string) {
    bytes += 2
    for (const char of text) {
      const code = char.codePointAt(0)!
      bytes += char === '"' || char === '\\' || ['\b', '\f', '\n', '\r', '\t'].includes(char) ? 2
        : code < 32 || code >= 0xd800 && code <= 0xdfff ? 6
          : code < 128 ? 1 : code < 2048 ? 2 : code <= 0xffff ? 3 : 4
      if (bytes > ceiling) break
    }
  }
  const todo = [value]
  while (todo.length && bytes <= ceiling) {
    const item = todo.pop()!
    if (typeof item === 'string') string(item)
    else if (item === null) bytes += 4
    else if (typeof item === 'boolean') bytes += item ? 4 : 5
    else if (typeof item === 'number') bytes += String(item).length
    else if (Array.isArray(item)) { bytes += 2 + Math.max(0, item.length - 1); for (const child of item) todo.push(child) }
    else {
      const keys = Object.keys(item); bytes += 2 + Math.max(0, keys.length - 1)
      for (const key of keys) { string(key); bytes++; todo.push(item[key]!); if (bytes > ceiling) break }
    }
  }
  return bytes
}
