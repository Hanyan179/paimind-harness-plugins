// Operator evidence transport only; not a runtime, API, or business owner.
// Buffer network bytes before decoding: an arbitrary chunk can split a UTF-8
// code point. Reject malformed data without echoing private response content.
export async function readNativeReadbackJson(response, limit = 4 * 1024 * 1024) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid native readback byte limit')
  const chunks = []; let size = 0
  for await (const chunk of response) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Native readback requires byte chunks')
    size += chunk.byteLength
    if (size >= limit) throw new Error('Native readback response exceeds byte limit')
    chunks.push(chunk)
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
  catch { throw new Error('Native readback response is not valid UTF-8 JSON') }
}
