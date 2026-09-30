import assert from 'node:assert/strict'
import { createServer } from 'node:net'

// The database keeps origins after a cell stops. An OS-free port is therefore
// not necessarily admissible. Hold each candidate until the database read has
// completed, then let the caller release it immediately before Docker starts.
// Docker's bind and the database's unique constraint remain the final guards
// against another process winning the unavoidable release/start race.
export async function reserveMemberPort({ isRetained, excludedOrigins = [], maxAttempts = 32, signal }) {
  assert.equal(typeof isRetained, 'function')
  assert.ok(Number.isInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= 128)
  const excluded = new Set(excludedOrigins)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal?.throwIfAborted()
    const server = createServer(socket => socket.destroy())
    let closing
    const release = () => {
      signal?.removeEventListener('abort', abort)
      return closing ??= new Promise((resolve, reject) => server.close(error => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else resolve()
      }))
    }
    const abort = () => { void release().catch(() => {}) }
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve)
      })
      signal?.addEventListener('abort', abort, { once: true })
      signal?.throwIfAborted()
      const port = server.address().port, origin = `http://127.0.0.1:${port}`
      const retained = excluded.has(origin) || await isRetained(origin)
      signal?.throwIfAborted()
      assert.equal(typeof retained, 'boolean', 'Database origin read must return a boolean')
      if (!retained) return { origin, port, release }
      excluded.add(origin)
    } catch (error) {
      await release()
      throw error
    }
    await release()
  }
  throw Error('No unreserved loopback member port found within the bounded allocation window')
}
