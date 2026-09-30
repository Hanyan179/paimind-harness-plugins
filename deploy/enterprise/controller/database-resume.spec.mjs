import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyResumedDatabaseConfig } from './database-resume.mjs'

const fixture = () => {
  const previous = { applicationUrl: 'postgres://haas_app:SYNTHETIC_APP@127.0.0.1:49100/haas_e2e',
    ownerUrl: 'postgres://haas_owner:SYNTHETIC_OWNER@127.0.0.1:49100/haas_e2e', containerId: 'a'.repeat(64),
    tenantId: 'owned-test', evidence: '/private/original-evidence', masterKey: 'SYNTHETIC_MASTER', bootstrapSecret: 'SYNTHETIC_BOOTSTRAP' }
  const current = { ...previous, applicationUrl: previous.applicationUrl.replace(':49100/', ':49101/'),
    ownerUrl: previous.ownerUrl.replace(':49100/', ':49101/') }
  const observed = { Id: current.containerId, State: { Running: true }, Config: { Labels: { 'paimind.role': 'identity-e2e-only' } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '49101' }] } } }
  return { previous, current, observed }
}
test('accepts only a matching observed port relocation and leaves private objects unchanged', () => {
  const f = fixture(), before = structuredClone(f)
  assert.deepEqual(verifyResumedDatabaseConfig(f.previous, f.current, f.observed), {
    databaseId: 'a'.repeat(64), previousPort: '49100', currentPort: '49101', portChanged: true })
  assert.deepEqual(f, before)
  assert.equal(verifyResumedDatabaseConfig(f.current, f.current, f.observed).portChanged, false)
})
test('rejects every non-port private configuration change with no credential disclosure', () => {
  for (const key of ['containerId', 'tenantId', 'evidence', 'masterKey', 'bootstrapSecret']) {
    const f = fixture(); f.current[key] = key === 'containerId' ? 'b'.repeat(64) : 'CHANGED_SECRET'
    assert.throws(() => verifyResumedDatabaseConfig(f.previous, f.current, f.observed), error =>
      error.message === 'Resumed database identity or observed loopback endpoint changed')
  }
  for (const key of ['ownerUrl', 'applicationUrl']) for (const alter of [
    url => url.replace('SYNTHETIC_', 'DIFFERENT_'), url => url.replace('haas_', 'other_'),
    url => url.replace('127.0.0.1', '127.0.0.2'), url => url.replace('127.0.0.1', 'example.test'),
    url => url.replace('/haas_e2e', '/another'), url => url+'?sslmode=disable', url => url+'#fragment',
    url => url.replace('postgres:', 'postgresql:'), url => url.replace(':49101', ':3080'),
    url => url.replace(':49101', ':5432'), url => url.replace(':49101', ':10012'),
    url => url.replace(':49101', ':80'), url => url.replace(':49101', ':49102'),
  ]) {
    const f = fixture(); f.current[key] = alter(f.current[key])
    assert.throws(() => verifyResumedDatabaseConfig(f.previous, f.current, f.observed), /Resumed database identity/)
  }
  for (const change of [f => { f.current.extra = 'UNKNOWN' }, f => { delete f.current.masterKey },
    f => { f.previous.extra = 'UNKNOWN' }, f => { f.current = null }]) {
    const f = fixture(); change(f); assert.throws(() => verifyResumedDatabaseConfig(f.previous,f.current,f.observed))
  }
})
test('requires exact running database identity and a unique actual loopback publication', () => {
  for (const change of [f => { f.observed.Id = 'b'.repeat(64) }, f => { f.observed.State.Running = false },
    f => { f.observed.Config.Labels['paimind.role'] = 'other' }, f => { delete f.observed.NetworkSettings },
    f => { f.observed.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0' },
    f => { f.observed.NetworkSettings.Ports['5432/tcp'][0].HostPort = '49102' },
    f => { f.observed.NetworkSettings.Ports['5432/tcp'].push({ HostIp: '::', HostPort: '49101' }) }]) {
    const f=fixture();change(f);assert.throws(()=>verifyResumedDatabaseConfig(f.previous,f.current,f.observed))
  }
})
