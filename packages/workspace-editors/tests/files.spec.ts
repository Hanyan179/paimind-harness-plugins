import { beforeEach, afterEach, it, expect } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceEditorFiles } from '../src/service.js'
import type { EditorInput } from '../src/contract.js'
import { randomUUID } from 'node:crypto'
let root: string, files: WorkspaceEditorFiles
const call = (
  path: string,
  method: string,
  args: EditorInput['args'] = [],
  expectedRevision?: string,
) =>
  files.call({
    workspaceId: 'w1',
    path,
    method,
    args,
    ...(expectedRevision ? { expectedRevision } : {}),
    operationId: randomUUID(),
  })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-editor-'))
  files = new WorkspaceEditorFiles({
    list: () => [{ id: 'w1', path: root, sessionIds: ['s1'] }],
  })
  for (const format of ['docs', 'slides', 'sheets'])
    await writeFile(
      join(root, format + '.json'),
      await readFile(
        join(
          process.cwd(),
          `packages/workspace-blueprints/templates/workspace-${format}/1.0.0/files/content/document.json`,
        ),
      ),
    )
})
afterEach(async () => {
  files.dispose()
  await rm(root, { recursive: true, force: true })
})
it('discovers only explicit document envelopes', async () => {
  await writeFile(join(root, 'ordinary.json'), '{}')
  expect((await files.list('w1')).map((e) => e.format).sort()).toEqual([
    'docs',
    'sheets',
    'slides',
  ])
  await expect(call('ordinary.json', 'getDocument')).rejects.toThrow()
})
it('edits a document and reads back the same content after restart with markdown export', async () => {
  const before = await call('docs.json', 'getDocument')
  await call(
    'docs.json',
    'setDocument',
    [
      {
        title: '更新',
        blocks: [{ id: 'body', html: '<h1>真实内容</h1><p>保存后回读。</p>' }],
      },
    ],
    before.revision,
  )
  files.dispose()
  files = new WorkspaceEditorFiles({
    list: () => [{ id: 'w1', path: root, sessionIds: ['s1'] }],
  })
  const reopened = await call('docs.json', 'getDocument')
  expect(JSON.stringify(reopened.snapshot)).toContain('真实内容')
  expect((await call('docs.json', 'exportMarkdown')).value).toContain(
    '# 真实内容',
  )
})
it('serializes concurrent writers and rejects stale versions without losing contents', async () => {
  const before = await call('docs.json', 'getDocument')
  await call(
    'docs.json',
    'setDocument',
    [{ title: '用户', blocks: [{ id: 'b', html: '<p>用户修改</p>' }] }],
    before.revision,
  )
  await expect(
    call(
      'docs.json',
      'setDocument',
      [{ title: '模型', blocks: [] }],
      before.revision,
    ),
  ).rejects.toThrow('VERSION_CONFLICT')
  expect(
    JSON.stringify((await call('docs.json', 'getDocument')).snapshot),
  ).toContain('用户修改')
})
it('rejects partial block conflicts without committing accepted blocks from the same operation', async () => {
  const before = await call('docs.json', 'getDocument')
  await expect(
    call(
      'docs.json',
      'applyOperation',
      [
        {
          upserts: [
            { id: 'goal', html: '<p>冲突</p>', baseVersion: 999 },
            { id: 'new', html: '<p>应回滚</p>', baseVersion: 0 },
          ],
          baseRevision: 1,
        },
      ],
      before.revision,
    ),
  ).rejects.toThrow('VERSION_CONFLICT')
  expect((await call('docs.json', 'getDocument')).revision).toBe(
    before.revision,
  )
})
it('preserves the slide model and supports local undo/redo', async () => {
  const before = await call('slides.json', 'getDeck')
  const modified = await call(
    'slides.json',
    'updateBlock',
    ['cover', 'title', { props: { text: '修改后的封面' } }],
    before.revision,
  )
  expect(JSON.stringify(modified.snapshot)).toContain('修改后的封面')
  const undo = await call('slides.json', 'undo', [], modified.revision)
  expect(JSON.stringify(undo.snapshot)).not.toContain('修改后的封面')
  expect(undo.undo.canRedo).toBe(true)
})
it('edits cells, preserves formulas, and exports each saved sheet', async () => {
  const before = await call('sheets.json', 'getDocument')
  const modified = await call(
    'sheets.json',
    'applyOperation',
    [
      {
        cellOps: [{ sheetId: 'sheet1', ref: 'B2', value: '9', baseVersion: 1 }],
      },
    ],
    before.revision,
  )
  expect(JSON.stringify(modified.snapshot)).toContain('SUM(B2:B2)')
  expect((await call('sheets.json', 'exportCsv', ['sheet1'])).value).toContain(
    '示例内容,9',
  )
  expect((await call('sheets.json', 'exportCsv', ['sheet1'])).value).toContain(
    '=SUM(B2:B2)',
  )
})
it('never repairs a corrupt external edit with blank content', async () => {
  await writeFile(join(root, 'docs.json'), '{ broken')
  await expect(call('docs.json', 'getDocument')).rejects.toThrow()
  expect(await readFile(join(root, 'docs.json'), 'utf8')).toBe('{ broken')
})
it('does not persist changes denied by the host sandbox', async () => {
  const before = await call('slides.json', 'getDeck')
  await expect(
    files.call(
      {
        workspaceId: 'w1',
        path: 'slides.json',
        method: 'setDeck',
        args: [{ slides: [] }],
        expectedRevision: before.revision,
        operationId: 'denied',
      },
      async () => {
        throw new Error('sandbox')
      },
    ),
  ).rejects.toThrow('sandbox')
  expect((await call('slides.json', 'getDeck')).revision).toBe(before.revision)
})
it('blocks path escape, symlink and unlisted model methods', async () => {
  await symlink('/tmp', join(root, 'outside'))
  for (const path of ['../secret', '/etc/passwd', 'outside/file.json'])
    await expect(call(path, 'getDocument')).rejects.toThrow()
  await expect(call('docs.json', 'fetch')).rejects.toThrow('不支持')
})

it('accepts independent cell edits on an older file revision but refuses a stale cell or structure', async () => {
  const before = await call('sheets.json', 'getDocument')
  await call(
    'sheets.json',
    'applyOperation',
    [
      {
        cellOps: [
          { sheetId: 'sheet1', ref: 'B2', value: '20', baseVersion: 1 },
        ],
      },
    ],
    before.revision,
  )
  await call(
    'sheets.json',
    'applyOperation',
    [
      {
        cellOps: [
          { sheetId: 'sheet1', ref: 'A2', value: '独立修改', baseVersion: 1 },
        ],
      },
    ],
    before.revision,
  )
  await expect(
    call(
      'sheets.json',
      'applyOperation',
      [
        {
          cellOps: [
            { sheetId: 'sheet1', ref: 'B2', value: '丢失修改', baseVersion: 1 },
          ],
        },
      ],
      before.revision,
    ),
  ).rejects.toThrow('VERSION_CONFLICT')
  await expect(
    call(
      'sheets.json',
      'applyOperation',
      [{ structure: { title: '旧结构' } }],
      before.revision,
    ),
  ).rejects.toThrow('VERSION_CONFLICT')
  expect((await call('sheets.json', 'exportCsv', ['sheet1'])).value).toContain(
    '独立修改,20',
  )
})
it('replays an operation after restart and rechecks permissions even for replay and no-op writes', async () => {
  const before = await call('docs.json', 'getDocument')
  const input: EditorInput = {
    workspaceId: 'w1',
    path: 'docs.json',
    method: 'setDocument',
    args: [{ title: '持久回执', blocks: [] }],
    expectedRevision: before.revision,
    operationId: 'persisted',
  }
  const first = await files.call(input)
  files.dispose()
  files = new WorkspaceEditorFiles({
    list: () => [{ id: 'w1', path: root, sessionIds: ['s1'] }],
  })
  expect(await files.call(input)).toEqual(first)
  await expect(
    files.call(input, async () => {
      throw new Error('revoked')
    }),
  ).rejects.toThrow('revoked')
  await expect(
    files.call(
      {
        ...input,
        method: 'applyOperation',
        args: [{}],
        operationId: 'noop',
        expectedRevision: first.revision,
      },
      async () => {
        throw new Error('revoked')
      },
    ),
  ).rejects.toThrow('revoked')
})
it('rejects an explicit but corrupt format without initializing content', async () => {
  for (const format of ['docs', 'slides', 'sheets']) {
    const bad = JSON.stringify({
      schema: 'paimind.workspace-document/v1',
      format,
      title: '损坏',
      data: {},
    })
    await writeFile(join(root, format + '.json'), bad)
    await expect(
      call(format + '.json', format === 'slides' ? 'getDeck' : 'getDocument'),
    ).rejects.toThrow()
    expect(await readFile(join(root, format + '.json'), 'utf8')).toBe(bad)
  }
})
it('invalidates cell versions after structure changes and returns the new versions to the editor', async () => {
  const before = await call('sheets.json', 'getDocument')
  const modified = await call(
    'sheets.json',
    'applyOperation',
    [{ structure: { title: '新标题' } }],
    before.revision,
  )
  const snapshot = modified.snapshot as any,
    value = modified.value as any
  expect(value.replacedCells.sheet1.B2.version).toBe(
    snapshot.cells.sheet1.B2.version,
  )
  await expect(
    call(
      'sheets.json',
      'applyOperation',
      [
        {
          cellOps: [
            { sheetId: 'sheet1', ref: 'B2', value: 'stale', baseVersion: 1 },
          ],
        },
      ],
      before.revision,
    ),
  ).rejects.toThrow('VERSION_CONFLICT')
  await call(
    'sheets.json',
    'applyOperation',
    [
      {
        cellOps: [
          {
            sheetId: 'sheet1',
            ref: 'B2',
            value: '21',
            baseVersion: snapshot.cells.sheet1.B2.version,
          },
        ],
      },
    ],
    modified.revision,
  )
  expect(
    (await files.list('w1')).find((d) => d.format === 'sheets')?.title,
  ).toBe('新标题')
})
