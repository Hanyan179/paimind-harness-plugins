// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readManagedHarnessStorageScopes } from '../src/managed-storage.js'

const disposals: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose() })
function fixture() {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'haas-native-storage-unit-')))
  const member = join(temp, 'hansen'); const project = join(member, 'project'); const nested = join(project, 'nested')
  mkdirSync(nested, { recursive: true }); mkdirSync(join(temp, 'alex'))
  const root = new Context()
  const workspaces: { id: string; path: string }[] = []
  const live: { header: { id: string; cwd?: string; createdAt: number } }[] = []
  const durable: { id: string; cwd?: string; createdAt: number }[] = []
  const read = vi.fn(async (_signal?: AbortSignal) => durable)
  // Unit fixtures only. Real registry/persistence recovery is tested separately
  // in the published native Linux profile, not inferred from these objects.
  root.provide('workspaceRegistry', { list: () => workspaces })
  root.provide('sessions', { list: () => live })
  root.provide('sessionPersistence', { list: read })
  root.provide('sandboxPolicy', { workspaceRoot: member })
  disposals.push(async () => { await root.fiber.dispose(); rmSync(temp, { recursive: true, force: true }) })
  return { root, temp, member, project, nested, workspaces, live, durable, read }
}

describe('native-owned storage scope recovery projection', () => {
  it('joins native workspace, cold/live session references and fallback without copying entities', async () => {
    const f = fixture()
    f.workspaces.push({ id: 'workspace-project', path: f.project }, { id: 'workspace-nested', path: f.nested })
    f.durable.push({ id: 'cold', cwd: f.project, createdAt: 1 }, { id: 'both', cwd: f.nested, createdAt: 2 })
    f.live.push({ header: { id: 'both', cwd: f.nested, createdAt: 2 } }, { header: { id: 'fallback', createdAt: 3 } })
    const before = JSON.stringify([f.workspaces, f.durable, f.live])
    const snapshot = await readManagedHarnessStorageScopes(f.root, f.member)
    expect(snapshot).toEqual({ memberRoot: f.member, scopes: [
      { path: f.member, availability: 'present', workspaceIds: [], sessionIds: ['fallback'] },
      { path: f.project, availability: 'present', workspaceIds: ['workspace-project'], sessionIds: ['cold'] },
      { path: f.nested, availability: 'present', workspaceIds: ['workspace-nested'], sessionIds: ['both'] },
    ] })
    expect(JSON.stringify([f.workspaces, f.durable, f.live])).toBe(before)
    expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.scopes)).toBe(true)
    for (const row of snapshot.scopes) expect(Object.isFrozen(row) && Object.isFrozen(row.workspaceIds) && Object.isFrozen(row.sessionIds)).toBe(true)
  })
  it('retains cold history whose workspace registration was deleted and does not create absent directories', async () => {
    const f = fixture(); const missing = join(f.project, 'removed', 'nested')
    f.durable.push({ id: 'history-only', cwd: missing, createdAt: 1 })
    const snapshot = await readManagedHarnessStorageScopes(f.root, f.member)
    expect(snapshot.scopes.at(-1)).toEqual({ path: missing, availability: 'missing', workspaceIds: [], sessionIds: ['history-only'] })
    expect(existsSync(join(f.project, 'removed'))).toBe(false)
  })
  it('uses the native realpath-before-normalization meaning without rewriting a header', async () => {
    const f = fixture(); const alias = join(f.member, 'alias'); symlinkSync(f.nested, alias)
    f.durable.push({ id: 'native-alias', cwd: alias, createdAt: 1 })
    const snapshot = await readManagedHarnessStorageScopes(f.root, f.member)
    expect(snapshot.scopes.at(-1)?.path).toBe(f.nested)
    expect(f.durable[0]?.cwd).toBe(alias)
  })
  it.each(['live', 'durable', 'workspace'] as const)('rejects another member directory supplied by %s', async source => {
    const f = fixture(); const path = join(f.temp, 'alex')
    if (source === 'workspace') f.workspaces.push({ id: 'other', path })
    else if (source === 'live') f.live.push({ header: { id: 'other', cwd: path, createdAt: 1 } })
    else f.durable.push({ id: 'other', cwd: path, createdAt: 1 })
    await expect(readManagedHarnessStorageScopes(f.root, f.member)).rejects.toThrow('outside the member world')
  })
  it.each(['external', 'dangling', 'missing-under-alias'] as const)('rejects unsafe %s path recovery', async kind => {
    const f = fixture(); const alias = join(f.member, 'alias')
    symlinkSync(kind === 'external' ? join(f.temp, 'alex') : kind === 'dangling' ? join(f.temp, 'absent') : f.project, alias)
    f.durable.push({ id: 'unsafe', cwd: kind === 'missing-under-alias' ? join(alias, 'absent') : alias, createdAt: 1 })
    await expect(readManagedHarnessStorageScopes(f.root, f.member)).rejects.toThrow()
  })
  it('propagates persistence faults instead of returning an empty or partial inventory', async () => {
    const f = fixture(); f.workspaces.push({ id: 'own', path: f.project })
    const error = new Error('native storage unavailable'); f.read.mockRejectedValueOnce(error)
    await expect(readManagedHarnessStorageScopes(f.root, f.member)).rejects.toBe(error)
  })
  it('honors cancellation before reading and passes cancellation to the native persistence owner', async () => {
    const f = fixture(); const before = AbortSignal.abort(new Error('cancel-before'))
    await expect(readManagedHarnessStorageScopes(f.root, f.member, before)).rejects.toThrow('cancel-before')
    expect(f.read).not.toHaveBeenCalled()
    const control = new AbortController()
    f.read.mockImplementationOnce(async signal => { expect(signal).toBe(control.signal); control.abort(new Error('cancel-during')); return [] })
    await expect(readManagedHarnessStorageScopes(f.root, f.member, control.signal)).rejects.toThrow('cancel-during')
  })
  it.each(['workspace', 'session'] as const)('rejects observed %s creation while native persistence is being read', async kind => {
    const f = fixture()
    f.read.mockImplementationOnce(async () => {
      if (kind === 'workspace') f.workspaces.push({ id: 'racing', path: f.project })
      else f.live.push({ header: { id: 'racing', cwd: f.project, createdAt: 1 } })
      return []
    })
    await expect(readManagedHarnessStorageScopes(f.root, f.member)).rejects.toThrow('inventory changed during discovery')
  })
  it.each(['cwd', 'createdAt'] as const)('rejects conflicting native live and durable %s for one identity', async field => {
    const f = fixture(); f.durable.push({ id: 'same', cwd: f.project, createdAt: 1 })
    f.live.push({ header: { id: 'same', cwd: field === 'cwd' ? f.nested : f.project, createdAt: field === 'createdAt' ? 2 : 1 } })
    await expect(readManagedHarnessStorageScopes(f.root, f.member)).rejects.toThrow('identity disagrees')
  })
  it('refuses a non-directory native scope instead of treating it as an absent workspace', async () => {
    const f = fixture(); const file = join(f.member, 'not-a-directory'); writeFileSync(file, 'preserve')
    f.durable.push({ id: 'file', cwd: file, createdAt: 1 })
    await expect(readManagedHarnessStorageScopes(f.root, f.member)).rejects.toThrow('not a directory')
  })
  it('refuses duplicate native workspace identity instead of merging different owners', async () => {
    const f = fixture(); f.workspaces.push({ id: 'same', path: f.project }, { id: 'same', path: f.nested })
    await expect(readManagedHarnessStorageScopes(f.root, f.member)).rejects.toThrow('duplicate native workspace identity')
  })
})
