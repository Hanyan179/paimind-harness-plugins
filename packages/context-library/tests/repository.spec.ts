import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  symlink,
  readFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextLibraryRepository } from '../src/repository.js'
import type {
  ContextIdentity,
  ContextIdentityProvider,
  ContextInput,
  ContextTarget,
} from '../src/contract.js'
import { randomUUID } from 'node:crypto'
let root: string,
  repo: ContextLibraryRepository,
  collectionId: string,
  workspaceRoot: string
const live = new Set(['session:s1', 'session:s2', 'workspace:w1', 'agent:a1'])
const identities: ContextIdentityProvider = {
  owner: () => 'local:test',
  validateTarget: async (t) => live.has(`${t.kind}:${t.id}`),
  forSession: async (id) => identity(id),
}
const identity = (id = 's1'): ContextIdentity => ({
  owner: 'local:test',
  sessionId: id,
  targets: [
    { kind: 'session', id },
    ...(id === 's1'
      ? [
          { kind: 'workspace' as const, id: 'w1' },
          { kind: 'agent' as const, id: 'a1' },
        ]
      : []),
  ],
  workspaceRoot,
  assertWrite: async () => {},
})
const req = (
  input: Partial<ContextInput> & Pick<ContextInput, 'action'>,
  model?: ContextIdentity,
) => repo.request({ collectionId, operationId: randomUUID(), ...input }, model)
const mount = async (
  target: ContextTarget = { kind: 'session', id: 's1' },
  mode: 'read' | 'write' = 'read',
) =>
  (await req({ action: 'setMount', target, mode, expectedRevision: null }))
    .mount!
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'context-repo-'))
  workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot)
  repo = new ContextLibraryRepository(join(root, 'library'), identities)
  collectionId = (await req({ action: 'createCollection', title: '产品资料' }))
    .collection!.id
  await req({
    action: 'write',
    path: '信息.md',
    content: '中文资料与产品说明',
    expectedRevision: null,
  })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
describe('single source mounts and scope', () => {
  it('does not discover or search unconnected content', async () => {
    expect(
      (await req({ action: 'collections' }, identity())).collections,
    ).toEqual([])
    expect(
      (await req({ action: 'search', query: '产品' }, identity())).hits,
    ).toEqual([])
    await expect(
      req({ action: 'read', path: '信息.md' }, identity()),
    ).rejects.toThrow('ACCESS_DENIED')
  })
  it('unions grants and sources without duplicating a directory', async () => {
    await mount()
    const write = await mount({ kind: 'agent', id: 'a1' }, 'write')
    const effective = (await req({ action: 'effective', sessionId: 's1' }))
      .effective!
    expect(effective).toHaveLength(1)
    expect(effective[0]!.sources).toHaveLength(2)
    expect(effective[0]!.mode).toBe('write')
    await req(
      {
        action: 'write',
        path: '创建.md',
        content: '新资料',
        expectedRevision: null,
      },
      identity(),
    )
    await req({
      action: 'removeMount',
      mountId: write.id,
      expectedRevision: write.revision,
    })
    await expect(
      req(
        { action: 'write', path: '拒绝.md', expectedRevision: null },
        identity(),
      ),
    ).rejects.toThrow('ACCESS_DENIED')
  })
  it('rejects all model mutations under read-only, including imports and directory operations', async () => {
    await mount()
    for (const action of ['write', 'mkdir', 'move', 'trash', 'import'] as const)
      await expect(
        req({ action, path: '信息.md', expectedRevision: null }, identity()),
      ).rejects.toThrow('ACCESS_DENIED')
  })
  it('rejects management actions from model interfaces', async () => {
    await mount(undefined, 'write')
    for (const action of [
      'createCollection',
      'setMount',
      'removeMount',
      'recycle',
      'restore',
    ] as const)
      await expect(req({ action }, identity())).rejects.toThrow('模型不能')
  })
  it('keeps grants for independent sessions and native workspaces after repository restart', async () => {
    await mount({ kind: 'workspace', id: 'w1' }, 'write')
    await mount({ kind: 'session', id: 's2' })
    repo = new ContextLibraryRepository(join(root, 'library'), identities)
    expect(
      (await req({ action: 'read', path: '信息.md' }, identity('s2'))).document!
        .content,
    ).toContain('中文')
    await expect(
      req(
        { action: 'write', path: '不能.md', expectedRevision: null },
        identity('s2'),
      ),
    ).rejects.toThrow('ACCESS_DENIED')
    await req(
      { action: 'write', path: '可以.md', expectedRevision: null },
      identity(),
    )
  })
  it('maintains stable identity on rename and rejects stale mount revisions', async () => {
    await mount()
    await req({
      action: 'updateCollection',
      title: '新名称',
      expectedRevision: 1,
    })
    expect(
      (await req({ action: 'collections' }, identity())).collections![0]!.id,
    ).toBe(collectionId)
    await expect(mount()).rejects.toThrow('VERSION_CONFLICT')
  })
  it('rechecks revoked grants before operation replay', async () => {
    const m = await mount(undefined, 'write')
    const input = {
      action: 'write' as const,
      path: '重复.md',
      content: '一次',
      expectedRevision: null,
      operationId: 'stable',
    }
    await req(input, identity())
    await req({
      action: 'removeMount',
      mountId: m.id,
      expectedRevision: m.revision,
    })
    await expect(req(input, identity())).rejects.toThrow('ACCESS_DENIED')
  })
})
describe('managed file integrity', () => {
  it('preserves UTF-8 when reading tiny segments', async () => {
    await mount()
    let content = '',
      offset = 0
    do {
      const r = (
        await req(
          { action: 'read', path: '信息.md', offset, limit: 1 },
          identity(),
        )
      ).document!
      content += r.content
      if (r.nextOffset === null) break
      offset = r.nextOffset
    } while (true)
    expect(content).toBe('中文资料与产品说明')
  })
  it('reports version conflicts and never silently overwrites', async () => {
    const d = (await req({ action: 'read', path: '信息.md' })).document!
    const results = await Promise.allSettled([
      req({
        action: 'write',
        path: '信息.md',
        content: '用户修改',
        expectedRevision: d.entry.revision,
      }),
      req({
        action: 'write',
        path: '信息.md',
        content: '模型修改',
        expectedRevision: d.entry.revision,
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
  it('replays the same operation once across restarts, rejects a changed payload', async () => {
    const input = {
      action: 'write' as const,
      path: '一次.md',
      content: '一',
      expectedRevision: null,
      operationId: 'once',
    }
    const first = await req(input)
    repo = new ContextLibraryRepository(join(root, 'library'), identities)
    expect(await req(input)).toEqual(first)
    await expect(req({ ...input, content: '二' })).rejects.toThrow('不同请求')
  })
  it('moves/recycles/restores directories with content and no stale recycle file', async () => {
    await req({
      action: 'write',
      path: '目录/内容.md',
      content: '保存',
      expectedRevision: null,
    })
    let entry = (await req({ action: 'list', path: '' })).entries!.find(
      (e) => e.path === '目录',
    )!
    await req({
      action: 'move',
      path: '目录',
      toPath: '改名',
      expectedRevision: entry.revision,
    })
    entry = (await req({ action: 'list', path: '' })).entries!.find(
      (e) => e.path === '改名',
    )!
    const trashed = await req({
      action: 'trash',
      path: '改名',
      expectedRevision: entry.revision,
    })
    await req({ action: 'restore', path: trashed.recycledPath })
    expect(
      (await req({ action: 'read', path: '改名/内容.md' })).document!.content,
    ).toBe('保存')
    expect((await req({ action: 'recycle', path: '' })).entries).toEqual([])
  })
  it('blocks paths and symlinks escaping a collection, including ancestor links', async () => {
    await mount(undefined, 'write')
    await symlink(
      workspaceRoot,
      join(root, 'library', 'collections', collectionId, 'outside'),
    )
    for (const path of [
      '../secret',
      '/etc/passwd',
      'a/../../escape',
      'outside/file.md',
      'a\\b',
      '.paimind-hidden',
    ])
      await expect(
        req({ action: 'write', path, expectedRevision: null }, identity()),
      ).rejects.toThrow()
    expect(
      await readFile(
        join(root, 'library', 'collections', collectionId, '信息.md'),
        'utf8',
      ),
    ).toContain('中文')
  })
  it('rejects cancellation and respects the native write ceiling', async () => {
    await mount(undefined, 'write')
    const abort = new AbortController()
    abort.abort()
    await expect(
      repo.request(
        {
          action: 'write',
          collectionId,
          path: '取消.md',
          expectedRevision: null,
          operationId: 'cancel',
        },
        identity(),
        abort.signal,
      ),
    ).rejects.toThrow()
    await expect(
      req(
        { action: 'write', path: '拒绝.md', expectedRevision: null },
        {
          ...identity(),
          assertWrite: async () => {
            throw new Error('native denial')
          },
        },
      ),
    ).rejects.toThrow('native denial')
  })
  it('imports only a relative file from the trusted current workspace', async () => {
    await mount(undefined, 'write')
    await writeFile(join(workspaceRoot, '产物.md'), '真实产物')
    await req(
      {
        action: 'import',
        path: '保存.md',
        toPath: '产物.md',
        expectedRevision: null,
      },
      identity(),
    )
    expect(
      (await req({ action: 'read', path: '保存.md' })).document!.content,
    ).toBe('真实产物')
    await expect(
      req(
        {
          action: 'import',
          path: '越界.md',
          toPath: '../outside',
          expectedRevision: null,
        },
        identity(),
      ),
    ).rejects.toThrow()
  })
  it('stores binary bytes without claiming body parsing', async () => {
    const bytes = Buffer.from([0, 255, 123, 12])
    await req({
      action: 'write',
      path: '数据.pdf',
      content: bytes.toString('base64'),
      encoding: 'base64',
      expectedRevision: null,
    })
    const read = (await req({ action: 'read', path: '数据.pdf' })).document!
    expect(read.encoding).toBe('base64')
    expect(Buffer.from(read.content, 'base64')).toEqual(bytes)
    expect(read.entry.kind).toBe('binary')
  })
})

it('recovers a file committed before the metadata receipt after an interrupted save', async () => {
  const input = {
    action: 'write' as const,
    path: '恢复.md',
    content: '提交内容',
    expectedRevision: null,
    operationId: 'crash-after-file',
  }
  const save = vi
    .spyOn(
      repo as unknown as { save: (state: unknown) => Promise<void> },
      'save',
    )
    .mockRejectedValueOnce(new Error('simulated crash'))
  await expect(req(input)).rejects.toThrow('simulated crash')
  save.mockRestore()
  repo = new ContextLibraryRepository(join(root, 'library'), identities)
  expect((await req(input)).revision).toBeDefined()
  expect(
    (await req({ action: 'read', path: '恢复.md' })).document!.content,
  ).toBe('提交内容')
  await expect(
    readFile(join(root, 'library', 'pending.json')),
  ).rejects.toThrow()
})
it('discards an unapplied journal after denial before commit and safely retries', async () => {
  await mount(undefined, 'write')
  let calls = 0
  const input = {
    action: 'write' as const,
    path: '提交前.md',
    content: '完整内容',
    expectedRevision: null,
    operationId: 'crash-before-file',
  }
  await expect(
    req(input, {
      ...identity(),
      assertWrite: async () => {
        if (++calls > 1) throw new Error('revoked before commit')
      },
    }),
  ).rejects.toThrow('revoked before commit')
  repo = new ContextLibraryRepository(join(root, 'library'), identities)
  await req(input, identity())
  expect(
    (await req({ action: 'read', path: '提交前.md' })).document!.content,
  ).toBe('完整内容')
})
it('returns raw binary data even when a binary file is named as text', async () => {
  await req({
    action: 'write',
    path: '原始.md',
    content: 'AP8=',
    encoding: 'base64',
    expectedRevision: null,
  })
  const r = (await req({ action: 'read', path: '原始.md' })).document!
  expect(r.encoding).toBe('base64')
  expect(r.content).toBe('AP8=')
})
it('rejects a collection root replaced with a symbolic link', async () => {
  const folder = join(root, 'library', 'collections', collectionId)
  await rm(folder, { recursive: true })
  await symlink(workspaceRoot, folder)
  await expect(
    req({
      action: 'write',
      path: '逃逸.md',
      content: 'denied',
      expectedRevision: null,
    }),
  ).rejects.toThrow('根目录')
})

it('round-trips a report larger than 20 MiB through versioned writes, partial reads and recycle', async () => {
  const bytes = Buffer.alloc(24 * 1024 * 1024, 0x61)
  bytes.write('%PDF-1.7\n')
  const first = await req({ action: 'write', path: 'report.pdf', content: bytes.toString('base64'), encoding: 'base64', expectedRevision: null })
  await mount()
  const segment = (await req({ action: 'read', path: 'report.pdf', offset: bytes.length - 32, limit: 32 }, identity())).document!
  expect(segment.entry.bytes).toBe(bytes.length)
  expect(Buffer.from(segment.content, 'base64')).toEqual(bytes.subarray(-32))
  expect(segment.nextOffset).toBeNull()
  bytes[bytes.length - 1] = 0x62
  const changed = await req({ action: 'write', path: 'report.pdf', content: bytes.toString('base64'), encoding: 'base64', expectedRevision: first.revision })
  expect(changed.revision).not.toBe(first.revision)
  await expect(req({ action: 'write', path: 'report.pdf', content: 'stale', expectedRevision: first.revision })).rejects.toThrow('VERSION_CONFLICT')
  const recycled = await req({ action: 'trash', path: 'report.pdf', expectedRevision: changed.revision })
  await req({ action: 'restore', path: recycled.recycledPath })
  expect((await req({ action: 'read', path: 'report.pdf', limit: 32 })).document!.entry.revision).toBe(changed.revision)
})

it('rejects files beyond the bounded 64 MiB library limit without creating a file', async () => {
  await expect(req({ action: 'write', path: 'oversize.txt', content: 'a'.repeat(64 * 1024 * 1024 + 1), expectedRevision: null })).rejects.toThrow('64 MB')
  expect((await req({ action: 'list' })).entries!.some((entry) => entry.name === 'oversize.txt')).toBe(false)
})
