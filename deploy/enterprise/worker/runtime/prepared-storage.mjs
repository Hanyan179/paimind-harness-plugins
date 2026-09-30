import assert from 'node:assert/strict'
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'

const identity = stat => `${stat.dev}:${stat.ino}`
function directory(path) {
  assert.equal(normalize(path), path)
  assert.equal(realpathSync.native(path), path, 'Prepared storage path is redirected')
  const stat = lstatSync(path, { bigint: true })
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Prepared storage path is not a direct directory')
  return stat
}
function privateDirectory(path) {
  const stat = directory(path)
  assert.equal(stat.uid, BigInt(process.getuid())); assert.equal(stat.mode & 0o077n, 0n)
}

/** Deployment-owned mount layout, not authority for native business objects. */
export function readPreparedStorageLayout(generation, memberRoot, storageRoot = '/var/lib/paimind/storage-generations') {
  assert.equal(normalize(memberRoot), memberRoot); assert.ok(!memberRoot.includes('\0'))
  assert.ok(memberRoot === '/var/lib/paimind/workspace' || memberRoot.startsWith('/var/lib/paimind/workspaces/')
    && memberRoot.length > '/var/lib/paimind/workspaces/'.length, 'Invalid prepared member root')
  privateDirectory(storageRoot)
  assert.equal(dirname(generation), storageRoot)
  assert.match(basename(generation), /^unpublished-[A-Za-z0-9]{6}$/)
  privateDirectory(generation); privateDirectory(join(generation, 'scopes'))
  const path = join(generation, 'layout.json')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let layout
  try {
    const stat = fstatSync(fd, { bigint: true })
    assert.ok(stat.isFile() && stat.nlink === 1n && stat.size > 0n && stat.size <= 2n * 1024n * 1024n)
    assert.equal(stat.uid, BigInt(process.getuid())); assert.equal(stat.mode & 0o077n, 0n)
    layout = JSON.parse(readFileSync(fd, 'utf8'))
  } finally { closeSync(fd) }
  const sourceFields = Object.hasOwn(layout, 'sourceGeneration') ? ['sourceGeneration'] : []
  assert.deepEqual(Object.keys(layout).sort(), ['memberRoot', 'schemaVersion', 'scopes', ...sourceFields, 'state'])
  if (sourceFields.length) {
    assert.equal(dirname(layout.sourceGeneration), storageRoot)
    assert.equal(normalize(layout.sourceGeneration), layout.sourceGeneration)
    assert.match(basename(layout.sourceGeneration), /^unpublished-[A-Za-z0-9]{6}$/)
    assert.notEqual(layout.sourceGeneration, generation, 'Prepared generation cannot derive from itself')
  }
  assert.equal(layout.schemaVersion, 1); assert.equal(layout.state, 'prepared-not-mounted')
  assert.equal(layout.memberRoot, memberRoot)
  assert.ok(Array.isArray(layout.scopes) && layout.scopes.length > 0)
  const seen = new Set()
  const scopes = layout.scopes.map((row, index) => {
    assert.deepEqual(Object.keys(row).sort(), ['availability', 'path', 'storagePath'])
    assert.equal(normalize(row.path), row.path); assert.ok(!row.path.includes('\0'))
    assert.ok(row.path === memberRoot || row.path.startsWith(memberRoot + '/'))
    assert.ok(!seen.has(row.path)); seen.add(row.path)
    assert.ok(['present', 'missing'].includes(row.availability))
    if (row.availability === 'present') {
      assert.equal(row.storagePath, join(generation, 'scopes', String(index)))
      directory(row.storagePath)
    } else assert.equal(row.storagePath, null)
    return Object.freeze({ ...row })
  })
  assert.equal(scopes[0].path, memberRoot); assert.equal(scopes[0].availability, 'present')
  assert.deepEqual(scopes.map(row => row.path), [...seen].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)))
  return Object.freeze({ ...layout, scopes: Object.freeze(scopes) })
}

export function parseMountPoints(text) {
  return text.trim().split('\n').map(line => {
    const parts = line.split(' ')
    assert.ok(parts.length >= 10 && parts.includes('-'), 'Invalid kernel mount record')
    // Kernel mountinfo escapes only these four characters, not arbitrary octal.
    const path = parts[4].replace(/\\(040|011|012|134)/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    return { path, writable: parts[5].split(',').includes('rw') }
  })
}

/** Inside the actual trusted runtime namespace, before loading native code. */
export function verifyPreparedStorageMounts(layout, { writable = true } = {}) {
  assert.equal(process.platform, 'linux')
  assert.equal(typeof writable, 'boolean')
  const mounts = parseMountPoints(readFileSync('/proc/self/mountinfo', 'utf8'))
  return Object.freeze(layout.scopes.filter(row => row.availability === 'present').map(row => {
    const matches = mounts.filter(mount => mount.path === row.path)
    assert.equal(matches.length, 1, 'Native scope must have exactly one prepared mount')
    assert.equal(matches[0].writable, writable, 'Prepared storage mount has the wrong write policy')
    const actual = identity(directory(row.path)); const expected = identity(directory(row.storagePath))
    assert.equal(actual, expected, 'Native scope mount does not match its prepared source')
    return Object.freeze({ path: row.path, identity: actual })
  }))
}

/** Open source descriptors before spawn; bwrap validates the inode it mounts.
 * The operator must own an offline/exclusive cell. Keep the storage lock for
 * the entire launched runtime, and close these parent descriptors after spawn.
 * This trusted runtime retains its container's network/PID/proc restrictions;
 * nested member commands still get their separate network/PID and no /proc.
 */
export function openPreparedStorageLaunch(layout, { readOnlyScopes = false, controlDirectory } = {}) {
  assert.equal(process.platform, 'linux')
  assert.equal(typeof readOnlyScopes, 'boolean')
  assert.ok(controlDirectory === undefined || !readOnlyScopes && /^\/tmp\/paimind-native-control-[A-Za-z0-9]{6}$/u.test(controlDirectory))
  if (controlDirectory !== undefined) privateDirectory(controlDirectory)
  const fds = []
  const bind = (path, target, readOnly = false) => {
    const expected = directory(path)
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    fds.push(fd)
    assert.equal(identity(fstatSync(fd, { bigint: true })), identity(expected))
    return [readOnly ? '--ro-bind-fd' : '--bind-fd', String(fds.length + 2), target]
  }
  try {
    const argv = ['/usr/local/bin/bwrap', '--unshare-user', '--unshare-ipc', '--unshare-uts',
      '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr',
      '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
      '--ro-bind', '/opt/paimind', '/opt/paimind', '--ro-bind', '/etc', '/etc',
      '--dev', '/dev', '--bind', '/proc', '/proc', ...bind('/var/lib/paimind', '/var/lib/paimind'),
      '--tmpfs', '/tmp',
      ...(controlDirectory === undefined ? [] : ['--dir', '/run', ...bind(controlDirectory, '/run/paimind-native-control', true)]),
      ...layout.scopes.filter(row => row.availability === 'present').flatMap(row => bind(row.storagePath, row.path, readOnlyScopes)),
      '--chdir', layout.memberRoot, '--']
    let closed = false
    return { argv, fds: Object.freeze([...fds]), close() {
      if (closed) return
      closed = true; for (const fd of fds) closeSync(fd)
    } }
  } catch (error) { for (const fd of fds) closeSync(fd); throw error }
}
