import assert from 'node:assert/strict'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import { symbols, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session-persistence'

/** Read-only references to native owners, not a second workspace registry. */
export interface ManagedHarnessStorageScope {
  readonly path: string
  readonly availability: 'present' | 'missing'
  readonly workspaceIds: readonly string[]
  readonly sessionIds: readonly string[]
}
export interface ManagedHarnessStorageSnapshot {
  readonly memberRoot: string
  readonly scopes: readonly ManagedHarnessStorageScope[]
}

const within = (path: string, root: string) => path === root || path.startsWith(root + '/')

/** Match the native policy's realpath-before-normalization for existing paths.
 * A missing native directory remains missing; discovery never creates it.
 * Unlike a runtime policy fallback, IO errors cannot mean an empty inventory. */
function directory(path: string, memberRoot: string) {
  assert.ok(typeof path === 'string' && isAbsolute(path) && !path.includes('\0'), 'Invalid native storage directory')
  let canonical: string
  let availability: 'present' | 'missing' = 'present'
  try {
    canonical = resolve(realpathSync.native(path))
    assert.ok(lstatSync(canonical).isDirectory(), 'Native storage scope is not a directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // For absent paths, preserve the native spelling only when no existing
    // ancestor redirects it. A dangling symlink must not become a new root.
    assert.equal(normalize(path), path, 'Missing native storage scope must be canonical')
    let ancestor = path
    for (;;) {
      try {
        const stat = lstatSync(ancestor)
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Missing native scope has an unsafe ancestor')
        assert.equal(realpathSync.native(ancestor), ancestor, 'Missing native scope has a redirected ancestor')
        break
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure
        const parent = dirname(ancestor); assert.notEqual(parent, ancestor)
        ancestor = parent
      }
    }
    canonical = path; availability = 'missing'
  }
  assert.ok(within(canonical, memberRoot), 'Native storage directory is outside the member world')
  return { path: canonical, availability }
}

/**
 * Cold-start/recovery discovery over the actual native Workspace registry,
 * live Session headers and durable Session headers. Call only while the
 * deployment keeps external creation/execution fenced; this function is NOT
 * a writer lease, a quiescence protocol, a mount plan or member admission.
 * Observed native-owner/inventory changes reject rather than publish a stale
 * snapshot. The deployment must keep its fence through storage preparation.
 */
export async function readManagedHarnessStorageScopes(root: Context, memberRoot: string,
  signal?: AbortSignal): Promise<ManagedHarnessStorageSnapshot> {
  assert.ok(root === root.root, 'Storage discovery must use the native application root')
  assert.ok(isAbsolute(memberRoot) && normalize(memberRoot) === memberRoot && memberRoot !== '/')
  assert.equal(realpathSync.native(memberRoot), memberRoot, 'Member storage root must be canonical')
  assert.ok(lstatSync(memberRoot).isDirectory())
  signal?.throwIfAborted()
  const registry = root.get('workspaceRegistry')
  const sessions = root.get('sessions')
  const persistence = root.get('sessionPersistence')
  const policy = root.get('sandboxPolicy')
  assert.ok(registry && sessions && persistence && policy, 'Native storage discovery dependencies are unavailable')
  assert.equal(directory(policy.workspaceRoot, memberRoot).path, memberRoot, 'Native fallback policy differs from the member root')
  const identity = (value: object) => Reflect.get(value, symbols.original) ?? value
  const owners = [registry, sessions, persistence, policy].map(identity)
  const workspaces = () => registry.list().map(row => ({ id: row.id, path: row.path })).sort((a, b) => a.id.localeCompare(b.id))
  const headers = () => sessions.list().map(row => ({ id: row.header.id, cwd: row.header.cwd,
    createdAt: row.header.createdAt })).sort((a, b) => a.id.localeCompare(b.id))
  const nativeWorkspaces = workspaces(); const live = headers()
  const durable = await persistence.list(signal)
  signal?.throwIfAborted()
  for (const [index, name] of ['workspaceRegistry', 'sessions', 'sessionPersistence', 'sandboxPolicy'].entries()) {
    const current = root.get(name)
    assert.ok(current && identity(current) === owners[index], 'Native storage discovery owner changed')
  }
  assert.deepEqual(workspaces(), nativeWorkspaces, 'Native workspace inventory changed during discovery')
  assert.deepEqual(headers(), live, 'Native session inventory changed during discovery')
  assert.equal(directory(policy.workspaceRoot, memberRoot).path, memberRoot, 'Native fallback policy changed during discovery')
  const roots = new Map<string, { path: string; availability: 'present' | 'missing'; workspaceIds: string[]; sessionIds: string[] }>()
  const scope = (path: string) => {
    const value = directory(path, memberRoot)
    let row = roots.get(value.path)
    if (!row) { row = { ...value, workspaceIds: [], sessionIds: [] }; roots.set(value.path, row) }
    assert.equal(row.availability, value.availability, 'Native storage directory changed during discovery')
    return row
  }
  scope(memberRoot)
  const workspaceIds = new Set<string>()
  for (const workspace of nativeWorkspaces) {
    assert.ok(typeof workspace.id === 'string' && workspace.id.length > 0 && !workspaceIds.has(workspace.id), 'Invalid or duplicate native workspace identity')
    workspaceIds.add(workspace.id); scope(workspace.path).workspaceIds.push(workspace.id)
  }
  const seen = new Map<string, { cwd: string | undefined; createdAt: number }>()
  for (const header of [...durable, ...live]) {
    assert.ok(typeof header.id === 'string' && header.id.length > 0)
    const previous = seen.get(header.id)
    if (previous) {
      assert.deepEqual({ cwd: header.cwd, createdAt: header.createdAt }, previous, 'Native durable/live session identity disagrees')
      continue
    }
    seen.set(header.id, { cwd: header.cwd, createdAt: header.createdAt })
    scope(header.cwd ?? memberRoot).sessionIds.push(header.id)
  }
  signal?.throwIfAborted()
  return Object.freeze({ memberRoot, scopes: Object.freeze([...roots.values()]
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    .map(row => Object.freeze({ ...row, workspaceIds: Object.freeze(row.workspaceIds.sort()), sessionIds: Object.freeze(row.sessionIds.sort()) }))) })
}
