import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readNativeReadbackJson } from '../enterprise/native-readback-response.mjs'

test('preserves Chinese, emoji and escaped text at every network byte boundary', async () => {
  const value = { text: '目标与权限隔离🌍，测试恢复；\\n', nested: ['智能体', 123, null] }
  const bytes = Buffer.from(JSON.stringify(value))
  for (let cut = 0; cut <= bytes.length; cut++) {
    assert.deepEqual(await readNativeReadbackJson([bytes.subarray(0, cut), bytes.subarray(cut)]), value)
  }
  assert.deepEqual(await readNativeReadbackJson(Array.from(bytes, byte => Uint8Array.of(byte))), value)
})
test('rejects truncated and invalid UTF-8 or JSON without echoing private contents', async () => {
  for (const bytes of [Buffer.from('{"text":"私人数据'), Buffer.from([123, 34, 120, 34, 58, 34, 0xe4, 34, 125]), Buffer.from([0xff])]) {
    await assert.rejects(readNativeReadbackJson([bytes]), { message: 'Native readback response is not valid UTF-8 JSON' })
  }
})
test('applies the strict original byte limit, counts bytes rather than characters, and bounds consumption', async () => {
  const bytes = Buffer.from('"中文"')
  assert.equal(await readNativeReadbackJson([bytes], bytes.length + 1), '中文')
  await assert.rejects(readNativeReadbackJson([bytes], bytes.length), /exceeds byte limit/)
  let consumed = 0
  async function* oversized() { for (let i = 0; i < 10; i++) { consumed++; yield Buffer.alloc(4) } }
  await assert.rejects(readNativeReadbackJson(oversized(), 8), /exceeds byte limit/)
  assert.equal(consumed, 2)
})
test('rejects pre-decoded strings and invalid limits and propagates transport failures', async () => {
  await assert.rejects(readNativeReadbackJson(['{}']), /byte chunks/)
  for (const limit of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(readNativeReadbackJson([], limit), /byte limit/)
  async function* failed() { yield Buffer.from('{'); throw Error('transport closed') }
  await assert.rejects(readNativeReadbackJson(failed()), /transport closed/)
})
