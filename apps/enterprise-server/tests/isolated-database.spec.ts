// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { isolatedDatabase } from './fixtures/isolated-database.js'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const owned: string[] = []
afterEach(() => { vi.resetAllMocks(); for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture(port = '60810') {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'paimind-owned-db-'))); owned.push(parent)
  const root = join(parent, 'source'), evidence = join(parent, 'evidence')
  mkdirSync(root, { mode: 0o700 }); mkdirSync(evidence, { mode: 0o700 })
  const config = { ownerUrl: `postgres://haas_owner:TEST_OWNER@127.0.0.1:${port}/haas_e2e`,
    applicationUrl: `postgres://haas_app:TEST_APP@127.0.0.1:${port}/haas_e2e`,
    masterKey: 'TEST_MASTER', bootstrapSecret: 'TEST_BOOTSTRAP', tenantId: 'synthetic', containerId: 'a'.repeat(64), evidence }
  const receipt = { sourceRoot: root, containerId: config.containerId, container: 'paimind-haas-identity-e2e-test',
    image: 'sha256:' + 'b'.repeat(64), role: 'isolated-identity-backend-not-final-worker-acceptance', status: 'Starting' }
  const observed = { Id: config.containerId, Image: receipt.image, Name: '/' + receipt.container, State: { Running: true },
    Config: { Labels: { 'paimind.goal': 'enterprise-haas', 'paimind.role': 'identity-e2e-only' } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] } } }
  const path = join(evidence, 'test-config.json'), receiptPath = join(evidence, 'fixture-receipt.json')
  const save = () => {
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
    writeFileSync(receiptPath, JSON.stringify(receipt), { mode: 0o600 })
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([observed]))
  }
  save(); return { root, evidence, path, receiptPath, config, receipt, observed, save }
}
it.each(['60810', '49152'])('accepts the exact owned live fixture at assigned port %s without a database connection', port => {
  const f = fixture(port)
  expect(isolatedDatabase(f.path, f.root)).toEqual(f.config)
  expect(execFileSync).toHaveBeenCalledWith('docker', ['inspect', f.config.containerId], expect.objectContaining({ timeout: 15000 }))
})
it.each(['3080', '5432', '10012', '80'])('rejects protected or privileged port %s even with matching observation', port => {
  const f = fixture(port)
  expect(() => isolatedDatabase(f.path, f.root)).toThrow('Private owned isolated database configuration required')
})
it('rejects mismatched ownership, live identity, image, endpoint and unsafe configuration', () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.receipt.sourceRoot += '/other' }, f => { f.receipt.containerId = 'c'.repeat(64) },
    f => { f.observed.Id = 'c'.repeat(64) }, f => { f.observed.Image = 'sha256:' + 'c'.repeat(64) },
    f => { f.observed.Name += '-other' }, f => { f.observed.State.Running = false },
    f => { f.observed.Config.Labels['paimind.role'] = 'live' }, f => { f.observed.Config.Labels['paimind.goal'] = 'other' },
    f => { f.observed.NetworkSettings.Ports['5432/tcp'][0]!.HostIp = '0.0.0.0' },
    f => { f.observed.NetworkSettings.Ports['5432/tcp'][0]!.HostPort = '60811' },
    f => { f.observed.NetworkSettings.Ports['5432/tcp'].push({ HostIp: '::', HostPort: '60810' }) },
    f => { f.config.applicationUrl = f.config.applicationUrl.replace('127.0.0.1', 'example.test') },
    f => { f.config.applicationUrl = f.config.applicationUrl.replace(':60810/', ':60811/') },
    f => { f.config.applicationUrl += '?sslmode=disable' },
    f => { f.config.ownerUrl = f.config.ownerUrl.replace('/haas_e2e', '/live') },
    f => { Object.assign(f.config, { unexpected: 'TEST_SECRET' }) },
  ]
  for (const change of mutations) {
    const f = fixture(); change(f); f.save()
    expect(() => isolatedDatabase(f.path, f.root)).toThrow('Private owned isolated database configuration required')
  }
})
it('rejects public private files, symlinks and evidence inside the source tree', () => {
  for (const which of ['path', 'receiptPath', 'evidence'] as const) {
    const f = fixture(); chmodSync(f[which], which === 'evidence' ? 0o755 : 0o644)
    expect(() => isolatedDatabase(f.path, f.root)).toThrow('Private owned isolated database configuration required')
  }
  const f = fixture(), link = join(f.evidence, 'linked.json'); symlinkSync(f.path, link)
  expect(() => isolatedDatabase(link, f.root)).toThrow('Private owned isolated database configuration required')
  f.receipt.sourceRoot = f.evidence; f.save()
  expect(() => isolatedDatabase(f.path, f.evidence)).toThrow('Private owned isolated database configuration required')
})
it('does not expose private file contents or raw engine failures', () => {
  const f = fixture()
  vi.mocked(execFileSync).mockImplementation(() => { throw Error('TEST_SECRET from engine') })
  expect(() => isolatedDatabase(f.path, f.root)).toThrow(/^Private owned isolated database configuration required$/)
  writeFileSync(f.path, '{TEST_SECRET')
  expect(() => isolatedDatabase(f.path, f.root)).toThrow(/^Private owned isolated database configuration required$/)
  expect(() => isolatedDatabase(undefined, f.root)).toThrow(/^Private owned isolated database configuration required$/)
})
