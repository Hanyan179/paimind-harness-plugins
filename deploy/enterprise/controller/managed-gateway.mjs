import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

async function privateConfig(path) {
  assert.equal(await realpath(path), path)
  const stat = await lstat(path)
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.size <= 262144)
  return JSON.parse(await readFile(path, 'utf8'))
}

/** Optional operator-owned child only. Never discovers, signals or restarts an
 * existing PID. The original private startup file changes by one exact cell;
 * the gateway independently verifies immutable admission before acknowledging.
 * A missing acknowledgement is unknown, not a rollback or automatic retry. */
export async function startManagedGateway({ entry, configPath, logPath, signal }) {
  signal.throwIfAborted()
  let current = await privateConfig(configPath)
  const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 })
  await new Promise((resolve, reject) => { log.once('open', resolve); log.once('error', reject) })
  const child = spawn(process.execPath, [entry, configPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  const messages = [], waiters = new Set()
  let fragment = '', ended = false, busy = false, unconfirmed = false
  const closed = new Promise(resolve => child.once('close', async (code, exitSignal) => {
    ended = true
    for (const waiter of [...waiters]) waiter.finish(Error('Owned gateway closed'))
    await new Promise(done => log.end(done))
    resolve({ pid: child.pid, code, signal: exitSignal })
  }))
  child.once('error', () => { ended = true; for (const waiter of [...waiters]) waiter.finish(Error('Owned gateway could not start')) })
  log.on('error', () => { unconfirmed = true; child.kill('SIGTERM') })
  child.stdout.on('data', bytes => {
    log.write(bytes); fragment += bytes.toString('utf8')
    if (fragment.length > 262144) { unconfirmed = true; child.kill('SIGTERM'); return }
    const lines = fragment.split('\n'); fragment = lines.pop()
    for (const line of lines) {
      let value
      try { value = JSON.parse(line) } catch { continue }
      if (!value || typeof value !== 'object') continue
      messages.push(value); if (messages.length > 32) messages.shift()
      for (const waiter of [...waiters]) if (waiter.predicate(value)) waiter.finish(undefined, value)
    }
  })
  child.stderr.on('data', bytes => log.write(bytes))
  const abort = () => child.kill('SIGTERM')
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const waitFor = (predicate, cancellation, timeoutMs = 10000) => new Promise((resolve, reject) => {
    if (ended || cancellation.aborted) { reject(Error('Owned gateway unavailable')); return }
    const found = messages.find(predicate)
    if (found) { resolve(found); return }
    const cancel = () => waiter.finish(Error('Owned gateway confirmation unavailable'))
    const timer = setTimeout(cancel, timeoutMs)
    const waiter = { predicate, finish(error, value) {
      clearTimeout(timer); cancellation.removeEventListener('abort', cancel); waiters.delete(waiter)
      if (error) reject(error); else resolve(value)
    } }
    waiters.add(waiter); cancellation.addEventListener('abort', cancel, { once: true })
    if (cancellation.aborted) cancel()
  })
  let stopping
  const stop = () => stopping ??= (async () => {
    signal.removeEventListener('abort', abort)
    if (!ended) child.kill('SIGTERM')
    const deadline = setTimeout(() => { if (!ended) child.kill('SIGKILL') }, 15000)
    try { return await closed } finally { clearTimeout(deadline) }
  })()
  try {
    const ready = await waitFor(value => value.status === 'listening' && value.pid === child.pid, signal)
    assert.equal(ready.publicOrigin, current.publicOrigin)
    return {
      pid: child.pid, ready, closed, stop,
      get available() { return !ended && !unconfirmed && !busy },
      async replaceCell(cell, cancellation) {
        assert.ok(!ended && !unconfirmed && !busy, 'Owned gateway recovery unavailable')
        cancellation.throwIfAborted(); signal.throwIfAborted()
        const previous = current.nativePrivateCells?.find(value => value.cellId === cell.cellId)
        assert.ok(previous && previous.revision !== cell.revision, 'One new existing cell revision required')
        for (const key of ['tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest', 'transportKey']) assert.equal(previous[key], cell[key])
        assert.ok(current.nativePrivateCells.filter(value => value.cellId === cell.cellId).length === 1)
        const lifetime = AbortSignal.any([signal, cancellation])
        busy = true
        let written = false
        try {
          assert.ok(isDeepStrictEqual(await privateConfig(configPath), current), 'Owned gateway configuration changed outside this operator')
          const next = { ...current, nativePrivateCells: current.nativePrivateCells.map(value => value.cellId === cell.cellId ? structuredClone(cell) : value) }
          const temporary = configPath + '.recovery-' + randomUUID()
          await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' })
          lifetime.throwIfAborted()
          await rename(temporary, configPath); written = true; current = next
          lifetime.throwIfAborted(); assert.ok(!ended)
          const confirmation = waitFor(value => value.event === 'runtime-cell-reload' && value.status === 'replaced'
            && value.cellId === cell.cellId && value.revision === cell.revision, lifetime)
          child.kill('SIGHUP')
          return await confirmation
        } catch (error) { if (written) unconfirmed = true; throw error }
        finally { busy = false }
      },
    }
  } catch (error) { await stop(); throw error }
}
