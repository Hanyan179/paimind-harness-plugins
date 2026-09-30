// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { fileURLToPath } from 'node:url'
import { createManagedHarnessDirectoryPickerProvider } from '../src/managed-directory-picker.js'

// Real native service and subprocess lifecycle. Helper responses below are
// explicit transport fixtures, NOT filesystem or Linux confinement acceptance.
// The separate managed-directory-picker-container.mjs uses the actual helper.
const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose() })
async function provider(options: { mode?: 'read-only'; partial?: boolean; hang?: boolean; fail?: boolean } = {}) {
  const root = new Context(); roots.push(root)
  const handles: SubprocessHandle[] = []
  const policies: unknown[] = []
  const requests: SubprocessSpawnSpec[] = []
  class ObservedProcess extends LocalSubprocessRuntime {
    override spawn(spec: SubprocessSpawnSpec) {
      requests.push(spec)
      const program = options.hang ? 'setInterval(()=>{},1000)' : `let s='';process.stdin.setEncoding('utf8');
        for await(const b of process.stdin)s+=b;const r=JSON.parse(s);
        process.stdout.write(JSON.stringify(${options.fail ? "{ok:false,code:'directory-exists',message:'同名目录已存在'}" :
          "{ok:true,value:r.operation==='list'?{path:r.path,home:r.root,crumbs:[],entries:[],truncated:false}:r.path+'/'+r.name}"}));`
      const handle = super.spawn({ ...spec, argv: [process.execPath, '--input-type=module', '-e', program] })
      handles.push(handle); return handle
    }
  }
  root.provide('sandbox', { confine: (argv: string[], policy: unknown) => {
    policies.push(policy); return { argv, enforcement: options.partial ? 'partial' : 'full' }
  } })
  await root.plugin(ObservedProcess)
  await root.plugin(SandboxPolicyService, { mode: options.mode ?? 'workspace-write', workspaceRoot: process.cwd() })
  await root.plugin(createManagedHarnessDirectoryPickerProvider({ executionWorld: {
    nodeExecutable: process.execPath, moduleAnchor: fileURLToPath(new URL('../package.json', import.meta.url)), lookupCwd: process.cwd(),
  } }))
  const picker = root.directoryPicker.capability()
  expect(picker.kind).toBe('browse')
  if (picker.kind !== 'browse') throw Error('Missing native browse service')
  return { root, picker, policies, requests, handles }
}

describe('managed native directory-picker transport and admission', () => {
  it('retains the stable native capability, defaults to its owned root and narrows native execution policy', async () => {
    const { root, picker, policies, requests } = await provider()
    expect(root.directoryPicker.capability()).toBe(picker)
    expect(await picker.list()).toMatchObject({ home: process.cwd(), path: process.cwd() })
    expect(await picker.createDirectory(process.cwd(), 'Hansen 项目')).toBe(process.cwd() + '/Hansen 项目')
    expect(policies).toEqual([{ mode: 'read-only', workspaceRoot: process.cwd() }, { mode: 'workspace-write', workspaceRoot: process.cwd() }])
    expect(requests.every(request => request.cwd === process.cwd() && request.argv.includes('--input-type=module'))).toBe(true)
  })
  it('rejects absolute outside paths, prefix siblings, traversal and non-absolute paths before spawning', async () => {
    const { picker, handles } = await provider()
    for (const path of ['/', '/etc', process.cwd() + '-other', process.cwd() + '/../other', 'relative', '']) {
      await expect(picker.list(path)).rejects.toMatchObject({ code: 'directory-unreadable' })
      await expect(picker.createDirectory(path, 'bad')).rejects.toMatchObject({ code: 'directory-create-failed' })
    }
    expect(handles).toHaveLength(0)
  })
  it('respects read-only policy and refuses a partially enforcing sandbox', async () => {
    const readonly = await provider({ mode: 'read-only' })
    await expect(readonly.picker.createDirectory(process.cwd(), 'bad')).rejects.toMatchObject({ code: 'directory-create-failed' })
    expect(readonly.handles).toHaveLength(0)
    const partial = await provider({ partial: true })
    await expect(partial.picker.list()).rejects.toMatchObject({ code: 'directory-unreadable' })
    expect(partial.handles).toHaveLength(0)
  })
  it('preserves the native duplicate-directory error and joins the real helper process', async () => {
    const { picker, handles } = await provider({ fail: true })
    await expect(picker.createDirectory(process.cwd(), 'Alex')).rejects.toMatchObject({ code: 'directory-exists' })
    expect(await handles[0]!.waitForExit(AbortSignal.timeout(3000))).toBe(true)
  })
  it('cancels a live read, avoids spawning pre-aborted calls and joins the native process tree', async () => {
    const { picker, handles } = await provider({ hang: true })
    await expect(picker.list(undefined, AbortSignal.abort())).rejects.toThrow()
    expect(handles).toHaveLength(0)
    const abort = new AbortController()
    const call = picker.list(undefined, abort.signal)
    expect(handles).toHaveLength(1)
    const rejection = expect(call).rejects.toThrow(); abort.abort(); await rejection
    expect(await handles[0]!.waitForExit(AbortSignal.timeout(3000))).toBe(true)
  })
  it('withdraws retained native capabilities and disposes an in-flight helper', async () => {
    const { root, picker, handles } = await provider({ hang: true })
    const call = picker.list()
    const rejected = expect(call).rejects.toMatchObject({ code: 'directory-unreadable' })
    await root.fiber.dispose(); await rejected
    expect(await handles[0]!.waitForExit(AbortSignal.timeout(3000))).toBe(true)
    await expect(picker.list()).rejects.toMatchObject({ code: 'directory-unreadable' })
    expect(handles).toHaveLength(1)
  })
})
