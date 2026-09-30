import assert from 'node:assert/strict'
import { isAbsolute, normalize } from 'node:path'

// Candidate command placement only. No member is admitted until the complete
// filesystem, code execution, syscall, network and native interaction gates pass.
// There are intentionally no upstream/version-sensitive imports here.
export function createCandidateExecutionDomain(workspaceRoot) {
  assert.equal(process.platform, 'linux')
  const singleCell = workspaceRoot === '/var/lib/paimind/workspace'
  assert.ok(isAbsolute(workspaceRoot) && normalize(workspaceRoot) === workspaceRoot && (singleCell ||
    workspaceRoot.startsWith('/var/lib/paimind/workspaces/') && workspaceRoot.length > '/var/lib/paimind/workspaces/'.length))
  assert.ok(!workspaceRoot.includes('\0'))
  const nodeExecutable = '/usr/local/bin/node'
  const moduleAnchor = '/opt/paimind/node_modules/@paimind/harness-compat/package.json'
  // The operator provisions this private per-member directory with the cell.
  // It is not recreated per command: native file and process capabilities must
  // observe each other's temporary files for the lifetime of the same world.
  const temporaryRoot = singleCell ? '/var/lib/paimind/temporary' : workspaceRoot.replace('/var/lib/paimind/workspaces/', '/var/lib/paimind/temporary/')
  // Source-owned resources are separate from private controller state. The
  // operator places only this member's eligible resources here; no copy/registry
  // is maintained by command placement, and commands can never write this root.
  const resourceRoot = singleCell ? '/var/lib/paimind/resources' : workspaceRoot.replace('/var/lib/paimind/workspaces/', '/var/lib/paimind/resources/')
  return Object.freeze({ nodeExecutable, moduleAnchor, lookupCwd: workspaceRoot, temporaryRoot, resourceRoot,
    prepare(request) {
      assert.ok(request.kind === 'process' || request.kind === 'terminal')
      assert.ok(request.fileAccess === 'read-only' || request.fileAccess === 'workspace-write', 'Missing native file-effect projection')
      assert.ok(typeof request.workspaceRoot === 'string' && isAbsolute(request.workspaceRoot) &&
        normalize(request.workspaceRoot) === request.workspaceRoot && !request.workspaceRoot.includes('\0'))
      assert.ok(request.workspaceRoot === workspaceRoot || request.workspaceRoot.startsWith(workspaceRoot + '/'),
        'Native writable root is outside the member execution world')
      assert.ok(isAbsolute(request.cwd) && !request.cwd.includes('\0'))
      const cwd = normalize(request.cwd)
      assert.ok(cwd === workspaceRoot || cwd.startsWith(workspaceRoot + '/'), 'Command cwd is outside the member execution workspace')
      const directory = request.directoryTarget
      assert.ok(directory === undefined || request.kind === 'process' && typeof directory === 'string' &&
        normalize(directory) === directory && !directory.includes('\0') &&
        (directory === workspaceRoot || directory.startsWith(workspaceRoot + '/')) &&
        cwd === workspaceRoot && request.workspaceRoot === workspaceRoot, 'Invalid managed directory projection')
      assert.ok(request.argv.length && request.argv.every(value => typeof value === 'string' && !value.includes('\0')))
      const args = ['--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net', '--unshare-uts', '--die-with-parent']
      // A pipe job owns a fresh session. Native terminal allocation already owns
      // a dedicated PTY/session; a second setsid would detach its controlling tty.
      if (request.kind === 'process') args.push('--new-session')
      args.push('--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
        '--ro-bind', '/opt/paimind', '/opt/paimind', '--dev', '/dev',
        '--dir', '/home/member')
      const innerEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/member', ...request.env }
      const envArgs = []
      for (const [name, value] of Object.entries(innerEnv)) {
        assert.ok(/^[A-Za-z_][A-Za-z_0-9]*$/.test(name), 'Invalid execution environment key')
        if (value === undefined) continue
        assert.ok(typeof value === 'string' && !value.includes('\0'), 'Invalid execution environment value')
        envArgs.push('--setenv', name, value)
      }
      // Also scrub the trusted launcher, not only its eventual command. Explicit
      // member env is passed as argv only after bwrap has created the boundary.
      const launcherEnv = Object.fromEntries(Object.keys(process.env).map(name => [name, undefined]))
      launcherEnv.PATH = '/usr/bin:/bin'
      if (request.fileAccess === 'read-only') args.push('--remount-ro', '/tmp')
      args.push('--remount-ro', '/', '--chdir', cwd, '--clearenv', ...envArgs, '--')
      if (request.kind === 'terminal') args.push('/usr/local/libexec/paimind-execution-launch', '--terminal-command', '--')
      args.push(...request.argv)
      // The exec-only launcher opens directory components without following
      // symlinks, then transfers its OWN descriptors to bwrap's bind-fd API.
      // bwrap validates the mounted inode before it executes the command.
      // Native subprocess/PTY ownership is unchanged; there is no parent lease
      // or /proc/<runtime-pid>/fd path exposed to the child.
      return { argv: ['/usr/local/libexec/paimind-execution-launch', workspaceRoot,
        request.fileAccess === 'workspace-write' ? request.workspaceRoot : '-', temporaryRoot, resourceRoot,
        ...(directory === undefined ? [] : ['--directory-target', directory]), '--', ...args], cwd: '/', env: launcherEnv }
    },
  })
}

// Called only after the trusted bootstrap independently checks every actual
// mount against its private prepared source. Exact roots, not parent-prefix
// permission inheritance. The exec-only C launcher rechecks the opened inode
// so a rename/replacement after this JS projection cannot reuse an old grant.
export function createPreparedExecutionDomain(workspaceRoot, scopes) {
  const domain = createCandidateExecutionDomain(workspaceRoot)
  const identities = new Map()
  for (const scope of scopes) {
    assert.ok(scope.path === workspaceRoot || scope.path.startsWith(workspaceRoot + '/'))
    assert.ok(!identities.has(scope.path) && /^\d+:\d+$/.test(scope.identity))
    identities.set(scope.path, scope.identity)
  }
  assert.ok(identities.has(workspaceRoot), 'Prepared member world is missing')
  return Object.freeze({ ...domain,
    prepare(request) {
      const launch = domain.prepare(request)
      assert.ok(identities.has(request.workspaceRoot), 'Native policy root has not been prepared')
      const argv = [...launch.argv]
      assert.ok(argv[5] === '--' || argv[5] === '--directory-target')
      argv.splice(5, 0, '--scope-identities', identities.get(workspaceRoot),
        request.fileAccess === 'workspace-write' ? identities.get(request.workspaceRoot) : '-')
      return { ...launch, argv }
    },
  })
}
