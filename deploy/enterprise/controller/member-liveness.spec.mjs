import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { BoundedCommandError, maintainMemberLeases, readLeaseObservation, runBoundedCommand, runOwnedProbe } from './member-liveness.mjs'
const cells = [{ pin: { cellId: 'hansen' } }, { pin: { cellId: 'alex' } }]
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const deadline = promise => Promise.race([promise, delay(2000).then(() => { throw Error('Test observation deadline') })])

test('a blocked Hansen probe and then a blocked withdrawal do not block Alex renewals', async () => {
  const abort = new AbortController(), probe = deferred(), withdrawal = deferred(), observed = deferred()
  let alex = 0, phase = 'probe', terminal, withdrawing = false
  const run = maintainMemberLeases(cells, { signal: abort.signal, intervalMs: 1,
    cycle: async cell => {
      if (cell.pin.cellId === 'hansen') { await probe.promise; throw Error('Explicit one-member health timeout') }
      alex++; if (phase === 'probe' && alex === 3 || phase === 'withdrawal' && withdrawing && alex >= 6) observed.resolve()
    },
    withdraw: async cell => { assert.equal(cell.pin.cellId, 'hansen'); withdrawing = true; await withdrawal.promise },
    onTerminal: async (cell, value) => { terminal = { id: cell.pin.cellId, state: value.state } },
  })
  try {
    await deadline(observed.promise); assert.ok(alex >= 3)
    phase = 'withdrawal'; const before = alex; probe.resolve()
    await deadline((async () => { while (!withdrawing || alex < before + 3) await delay(1) })())
    assert.equal(terminal, undefined); withdrawal.resolve()
    await deadline((async () => { while (!terminal) await delay(1) })())
    assert.deepEqual(terminal, { id: 'hansen', state: 'withdrawn' })
  } finally { abort.abort(); probe.resolve(); withdrawal.resolve(); await run }
})

test('withdrawal failure is explicit and never renews that member or cancels the other lane', async () => {
  const abort = new AbortController(), observed = deferred(), counts = { hansen: 0, alex: 0 }, terminal = []
  const run = maintainMemberLeases(cells, { signal: abort.signal, intervalMs: 1,
    cycle: async cell => { counts[cell.pin.cellId]++; if (cell.pin.cellId === 'hansen') throw Error('One member denied'); if (counts.alex >= 5) observed.resolve() },
    withdraw: async () => { throw Error('Engine result unknown') }, onTerminal: async (cell, outcome) => terminal.push([cell.pin.cellId, outcome.state]) })
  try { await deadline(observed.promise); assert.equal(counts.hansen, 1); assert.deepEqual(terminal, [['hansen', 'withdrawal-unconfirmed']]) }
  finally { abort.abort(); await run }
})

test('each lane serializes its own work and global stop joins in-flight callbacks before returning', async () => {
  const abort = new AbortController(), started = deferred(), release = deferred(), active = new Set()
  let returned = false, withdrawals = 0
  const run = maintainMemberLeases(cells, { signal: abort.signal, intervalMs: 1,
    cycle: async cell => { assert.ok(!active.has(cell)); active.add(cell); if (active.size === 2) started.resolve(); await release.promise; active.delete(cell) },
    withdraw: async () => { withdrawals++ }, onTerminal: async () => {} }).then(result => { returned = true; return result })
  await deadline(started.promise); abort.abort(); await delay(10)
  assert.equal(returned, false); release.resolve(); const result = await run
  assert.equal(active.size, 0); assert.equal(withdrawals, 0)
  assert.deepEqual(result.map(row => row.value.state), ['stopped', 'stopped'])
})

test('already stopped controllers execute nothing and duplicate member lanes reject', async () => {
  const abort = new AbortController(); abort.abort()
  const never = async () => { throw Error('Must not run') }
  const options = { signal: abort.signal, cycle: never, withdraw: never, onTerminal: never }
  assert.deepEqual((await maintainMemberLeases(cells, options)).map(row => row.value.state), ['stopped', 'stopped'])
  await assert.rejects(maintainMemberLeases([cells[0], cells[0]], options))
})

test('bounded real CLI runs without blocking another member and is joined on timeout', async () => {
  const abort = new AbortController(), healthy = deferred(); let failure, alex = 0
  const run = maintainMemberLeases(cells, { signal: abort.signal, intervalMs: 1,
    cycle: async cell => {
      if (cell.pin.cellId === 'hansen') await runBoundedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 200 })
      else { alex++; if (alex >= 5) healthy.resolve() }
    }, withdraw: async () => {}, onTerminal: async (_cell, outcome) => { failure = outcome.error } })
  try {
    await deadline(healthy.promise); assert.ok(alex >= 5)
    await deadline((async () => { while (!failure) await delay(5) })())
    assert.ok(Number.isInteger(failure.pid)); assert.equal(failure.signal, 'SIGKILL')
    assert.equal(failure.diagnostic.kind, 'timeout')
    assert.ok(failure.diagnostic.elapsedMs >= 150)
    assert.throws(() => process.kill(failure.pid, 0), { code: 'ESRCH' })
  } finally { abort.abort(); await run }
})

test('real CLI success, cancellation, output overflow and spawn failure settle without leaking child output', async () => {
  assert.equal(await runBoundedCommand(process.execPath, ['-e', 'console.log("owned")']), 'owned')
  const abort = new AbortController()
  const pending = runBoundedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal })
  abort.abort(Error('SENSITIVE_TEST_MARKER'))
  await assert.rejects(pending, error => {
    assert.ok(error instanceof BoundedCommandError); assert.equal(error.diagnostic.kind, 'aborted')
    assert.ok(!JSON.stringify(error).includes('SENSITIVE_TEST_MARKER'))
    assert.throws(() => process.kill(error.pid, 0), { code: 'ESRCH' }); return true
  })
  await assert.rejects(runBoundedCommand(process.execPath, ['-e', 'process.stdout.write("SENSITIVE_TEST_MARKER".repeat(300000));setInterval(()=>{},1000)']), error => {
    assert.ok(!error.message.includes('SENSITIVE_TEST_MARKER')); assert.throws(() => process.kill(error.pid, 0), { code: 'ESRCH' }); return true
  })
  await assert.rejects(runBoundedCommand('/no-such-owned-diagnostic-executable', []), error => {
    assert.ok(error instanceof BoundedCommandError)
    assert.deepEqual(error.diagnostic, { kind: 'spawn-error', exitCode: -2, signal: null, spawnCode: 'ENOENT',
      elapsedMs: error.diagnostic.elapsedMs, outputBytes: 0 })
    assert.ok(!JSON.stringify(error).includes('/no-such-owned-diagnostic-executable')); return true
  })
})

test('pre-aborted commands do not spawn or expose the caller abort reason', () => {
  const controller = new AbortController(); controller.abort(Error('SENSITIVE_TEST_MARKER'))
  assert.throws(() => runBoundedCommand(process.execPath, ['-e', 'process.exit(99)'], { signal: controller.signal }), error => {
    assert.ok(error instanceof BoundedCommandError)
    assert.deepEqual(error.diagnostic, { kind: 'aborted-before-start', exitCode: null, signal: null, elapsedMs: 0, outputBytes: 0 })
    assert.equal(error.pid, undefined); assert.ok(!JSON.stringify(error).includes('SENSITIVE_TEST_MARKER')); return true
  })
})

test('engine nonzero and external signal exits remain distinguishable and redact stderr and argv', async () => {
  for (const [script, kind, exitCode, signal] of [
    ['process.stderr.write("SENSITIVE_TEST_MARKER");process.exit(23)', 'nonzero-exit', 23, null],
    ['process.kill(process.pid,"SIGTERM")', 'signal-exit', null, 'SIGTERM'],
  ]) await assert.rejects(runBoundedCommand(process.execPath, ['-e', script]), error => {
    assert.ok(error instanceof BoundedCommandError)
    assert.equal(error.diagnostic.kind, kind); assert.equal(error.exitCode, exitCode); assert.equal(error.signal, signal)
    assert.ok(Object.isFrozen(error.diagnostic)); assert.ok(error.diagnostic.elapsedMs >= 0)
    assert.ok(!JSON.stringify(error).includes('SENSITIVE_TEST_MARKER'))
    assert.ok(!error.message.includes(script)); assert.throws(() => process.kill(error.pid, 0), { code: 'ESRCH' }); return true
  })
})

test('combined stdout and stderr overflow reports its first cause after joining the exact child', async () => {
  await assert.rejects(runBoundedCommand(process.execPath, ['-e',
    'process.stdout.write("a".repeat(3*1024**2),()=>process.stderr.write("b".repeat(3*1024**2)));setInterval(()=>{},1000)']), error => {
    assert.equal(error.diagnostic.kind, 'output-overflow'); assert.ok(error.diagnostic.outputBytes > 4 * 1024 ** 2)
    assert.equal(error.signal, 'SIGKILL'); assert.throws(() => process.kill(error.pid, 0), { code: 'ESRCH' }); return true
  })
})

test('opt-in engine diagnostics classify bounded stderr without exposing its contents', async () => {
  for (const [output, expected] of [
    ['Error response from daemon: No such object: SENSITIVE_TEST_MARKER', 'object-missing'],
    ['permission denied opening SENSITIVE_TEST_MARKER', 'permission-denied'],
    ['too many open files: SENSITIVE_TEST_MARKER', 'resource-exhausted'],
    ['context deadline exceeded SENSITIVE_TEST_MARKER', 'transport-timeout'],
    ['Cannot connect to the Docker daemon SENSITIVE_TEST_MARKER', 'engine-unavailable'],
    ['failed to connect to the docker API at unix:///SENSITIVE_TEST_MARKER; check if the path is correct and if the daemon is running: dial unix /SENSITIVE_TEST_MARKER: connect: no such file or directory', 'engine-unavailable'],
    ['Failed to initialize: unix socket path "SENSITIVE_TEST_MARKER" is too long', 'unclassified'],
    ['Internal Server Error SENSITIVE_TEST_MARKER', 'engine-api-error'],
    ['SENSITIVE_TEST_MARKER unknown failure', 'unclassified'],
    ['x'.repeat(4096) + 'Cannot connect to the Docker daemon SENSITIVE_TEST_MARKER', 'unclassified'],
  ]) {
    await assert.rejects(runBoundedCommand(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(output)});process.exit(1)`], {diagnosticProfile:'docker'}), error => {
      assert.equal(error.diagnostic.stderrCategory, expected); assert.equal(error.diagnostic.kind, 'nonzero-exit')
      assert.ok(!JSON.stringify(error).includes('SENSITIVE_TEST_MARKER')); assert.equal(error.cause, undefined)
      assert.throws(() => process.kill(error.pid, 0), {code:'ESRCH'}); return true
    })
  }
})

test('engine classification spans stream chunks and never enables a retry', async () => {
  await assert.rejects(runBoundedCommand(process.execPath, ['-e', 'process.stderr.write("No such ");setTimeout(()=>{process.stderr.write("object: SENSITIVE_TEST_MARKER");process.exit(1)},10)'], {diagnosticProfile:'docker'}), error => {
    assert.equal(error.diagnostic.stderrCategory,'object-missing'); assert.equal(error.diagnostic.exitCode,1); return true
  })
  assert.throws(()=>runBoundedCommand(process.execPath,[],{diagnosticProfile:'SENSITIVE_TEST_MARKER'}))
})

test('owned probes retain only fixed stage, exact targets and allowlisted command metadata', async () => {
  const target='a'.repeat(64), originalTargets=[target], seen=[]
  await assert.rejects(runOwnedProbe('runtime-container',originalTargets,async()=>{
    seen.push('once')
    throw Object.assign(Error('SENSITIVE_TEST_MARKER'),{commandDiagnostic:{kind:'nonzero-exit',pid:42,exitCode:1,signal:null,elapsedMs:18,outputBytes:118,stderrCategory:'engine-api-error',raw:'SENSITIVE_TEST_MARKER'},secret:'SENSITIVE_TEST_MARKER'})
  }), error=>{
    assert.deepEqual(error.ownedProbe,{stage:'runtime-container',targetIds:[target]});originalTargets[0]='b'.repeat(64)
    assert.equal(error.ownedProbe.targetIds[0],target);assert.ok(Object.isFrozen(error.ownedProbe.targetIds))
    assert.equal(error.commandDiagnostic.stderrCategory,'engine-api-error');assert.equal(error.commandDiagnostic.outputBytes,118)
    assert.ok(!JSON.stringify(error).includes('SENSITIVE_TEST_MARKER'));assert.equal(error.cause,undefined);return true
  })
  assert.deepEqual(seen,['once'])
  assert.equal(await runOwnedProbe('storage-fence',target,async()=>123),123)
  await assert.rejects(runOwnedProbe('SENSITIVE_TEST_MARKER',target,()=>{throw Error('must not run')}))
  await assert.rejects(runOwnedProbe('runtime-container','credential://SENSITIVE_TEST_MARKER',()=>{throw Error('must not run')}))
})

test('a diagnosed probe failure still withdraws only that lane and never renews it again', async () => {
  const abort=new AbortController(), done=deferred(), counts={hansen:0,alex:0};let terminal, withdrawals=0
  const running=maintainMemberLeases(cells,{signal:abort.signal,intervalMs:1,
    cycle:async cell=>{
      counts[cell.pin.cellId]++
      if(cell.pin.cellId==='hansen')await runOwnedProbe('runtime-container','a'.repeat(64),()=>runBoundedCommand(process.execPath,['-e','process.stderr.write("Internal Server Error");process.exit(1)'],{diagnosticProfile:'docker'}))
      if(counts.alex>20&&terminal)done.resolve()
    },withdraw:async cell=>{assert.equal(cell.pin.cellId,'hansen');withdrawals++},onTerminal:async(_cell,outcome)=>{terminal=outcome}})
  try{await deadline(done.promise);assert.equal(counts.hansen,1);assert.equal(withdrawals,1);assert.equal(terminal.state,'withdrawn');assert.equal(terminal.error.ownedProbe.stage,'runtime-container');assert.equal(terminal.error.commandDiagnostic.stderrCategory,'engine-api-error')}
  finally{abort.abort();await running}
})

const engineFailure = (category = 'engine-unavailable', kind = 'nonzero-exit') =>
  runOwnedProbe('storage-fence', 'a'.repeat(64), async () => {
    throw new BoundedCommandError(kind, { exitCode: 1, elapsedMs: 21, outputBytes: 118, stderrCategory: category })
  })

test('lease observation returns a complete first result without retrying', async () => {
  const controller = new AbortController(); let reads = 0
  const value = { resources: 'complete-readback' }
  assert.deepEqual(await readLeaseObservation(async signal => {
    assert.equal(signal, controller.signal); reads++; return value
  }, { signal: controller.signal, onRetry: () => assert.fail('No transient failure') }), { value, attempts: 1 })
  assert.equal(reads, 1)
})

test('one transient engine read failure reruns the whole observation before any renewal', async () => {
  const controller = new AbortController(), order = [], events = []; let attempts = 0, renewed = 0
  const result = await readLeaseObservation(async signal => {
    assert.equal(signal, controller.signal); attempts++
    for (const step of ['container', 'volumes', 'references', 'native-health', 'storage-fence']) {
      order.push(`${attempts}:${step}`)
      if (attempts === 1 && step === 'storage-fence') await engineFailure()
    }
    assert.equal(renewed, 0); return { observation: attempts }
  }, { signal: controller.signal, onRetry: event => { events.push(event); assert.equal(renewed, 0) } })
  renewed++
  assert.deepEqual(result, { value: { observation: 2 }, attempts: 2 })
  assert.equal(order.length, 10); assert.equal(events.length, 1)
  assert.equal(events[0].ownedProbe.stage, 'storage-fence')
  assert.equal(events[0].commandDiagnostic.stderrCategory, 'engine-unavailable')
})

test('semantic, permission, missing-object, unclassified and timeout errors never retry', async () => {
  for (const failure of [
    () => { throw Error('Ownership changed') },
    () => engineFailure('permission-denied'), () => engineFailure('object-missing'),
    () => engineFailure('resource-exhausted'), () => engineFailure('engine-api-error'),
    () => engineFailure('transport-timeout'), () => engineFailure('unclassified'),
    () => engineFailure('engine-unavailable', 'timeout'),
    () => { throw Object.assign(Error('untrusted lookalike'), { ownedProbe: { stage: 'storage-fence' },
      commandDiagnostic: { kind: 'nonzero-exit', exitCode: 1, signal: null, stderrCategory: 'engine-unavailable' } }) },
  ]) {
    let reads = 0
    await assert.rejects(readLeaseObservation(async () => { reads++; return failure() }, {
      signal: new AbortController().signal, onRetry: () => assert.fail('Not an eligible transport failure'),
    }))
    assert.equal(reads, 1)
  }
})

test('a second engine failure exhausts the observation and still withdraws just that member', async () => {
  const controller = new AbortController(), done = deferred(); let reads = 0, alex = 0, retries = 0, withdrawals = 0
  const run = maintainMemberLeases(cells, { signal: controller.signal, intervalMs: 1,
    cycle: async (cell, signal) => {
      if (cell.pin.cellId === 'hansen') await readLeaseObservation(async () => { reads++; return engineFailure() }, {
        signal, onRetry: () => { retries++ },
      })
      else alex++
    },
    withdraw: async cell => { assert.equal(cell.pin.cellId, 'hansen'); withdrawals++ },
    onTerminal: async (_cell, outcome) => { assert.equal(outcome.state, 'withdrawn'); done.resolve() },
  })
  try { await deadline(done.promise); assert.equal(reads, 2); assert.equal(retries, 1); assert.equal(withdrawals, 1); assert.ok(alex > 2) }
  finally { controller.abort(); await run }
})

test('cancellation during the bounded retry delay stops without another observation', async () => {
  const controller = new AbortController(); let reads = 0
  await assert.rejects(readLeaseObservation(async () => { reads++; return engineFailure() }, {
    signal: controller.signal, onRetry: () => controller.abort(),
  }), { name: 'AbortError' })
  assert.equal(reads, 1)
})

test('aborted, late-success and failed diagnostic writes cannot produce renewable evidence', async () => {
  const before = new AbortController(); before.abort(); let reads = 0
  await assert.rejects(readLeaseObservation(async () => { reads++; return 'must not read' }, { signal: before.signal, onRetry: () => {} }))
  assert.equal(reads, 0)
  const during = new AbortController()
  await assert.rejects(readLeaseObservation(async () => { during.abort(); return 'late success' }, { signal: during.signal, onRetry: () => {} }))
  await assert.rejects(readLeaseObservation(async () => { reads++; return engineFailure() }, {
    signal: new AbortController().signal, onRetry: () => { throw Error('Evidence writer unavailable') },
  }), /Evidence writer unavailable/)
  assert.equal(reads, 1)
})

test('a fresh semantic rejection after transport recovery is not retried or replaced by stale evidence', async () => {
  let reads = 0
  await assert.rejects(readLeaseObservation(async () => {
    reads++; if (reads === 1) return engineFailure(); throw Error('Fresh container policy mismatch')
  }, { signal: new AbortController().signal, onRetry: () => {} }), /Fresh container policy mismatch/)
  assert.equal(reads, 2)
})
