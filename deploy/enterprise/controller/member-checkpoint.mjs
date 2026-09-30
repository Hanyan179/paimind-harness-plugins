import assert from 'node:assert/strict'

const columns = {
  cellId: 'cell_id', tenantId: 'tenant_id', userId: 'user_id', origin: 'origin',
  containerId: 'container_id', imageId: 'image_id', volumeName: 'volume_name', policyDigest: 'policy_digest',
}

// A replacement can commit for one member and fail for another. The database
// decides which generation to retain; neither invocation order nor a bare
// container ID proves ownership. This is a checkpoint, not a runtime registry.
export function selectMemberCheckpoint({ accounts, tenantId, bindings, knownCells, closed = false }) {
  assert.equal(new Set(accounts.map(account => account.userId)).size, accounts.length)
  return accounts.map(account => {
    const rows = bindings.filter(row => row.tenant_id === tenantId && row.user_id === account.userId)
    assert.equal(rows.length, 1, 'Exactly one current account binding required for checkpoint')
    const binding = rows[0]
    assert.equal(binding.isolation_mode, 'container-managed')
    assert.ok(['ready', 'suspended'].includes(binding.status))
    if (closed) assert.ok(binding.status === 'suspended' && binding.expired === true, 'Closed checkpoint requires expired suspended admission')
    const candidates = knownCells.filter(cell => cell.member === account.username && cell.pin.role === account.role
      && Object.entries(columns).every(([field, column]) => cell.pin[field] === binding[column]))
    assert.equal(candidates.length, 1, 'Current binding must match one exact known owned cell')
    const { agent, transportKey, ...cell } = candidates[0]
    // Suspension legitimately rotates the revision; live bindings may not.
    if (binding.status === 'ready') assert.equal(cell.pin.revision, binding.revision, 'Live binding revision changed')
    assert.equal(typeof binding.revision, 'string')
    return { ...cell, pin: { ...cell.pin, revision: binding.revision } }
  })
}

// A failed checkpoint or receipt write must not skip releasing the DB client.
// Do not turn an incomplete cleanup into a successful resume receipt.
export async function finalizeMemberCheckpoint({ cleanupComplete, persist, writeReceipt, closeDatabase }) {
  const failures = []
  let checkpointRecorded = false
  try {
    if (cleanupComplete) {
      try { await persist(); checkpointRecorded = true } catch { failures.push('checkpoint') }
    }
    try { await writeReceipt({ cleanupComplete, checkpointRecorded }) } catch { failures.push('closure-receipt') }
  } finally {
    try { await closeDatabase() } catch { failures.push('database-close') }
  }
  return { checkpointRecorded, failures }
}
