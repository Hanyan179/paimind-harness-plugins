import { z } from 'zod'
import { readdir } from 'node:fs/promises'
import {
  withPaimindFileLock,
  readPaimindManagedBytes,
  paimindFileRevision,
  writePaimindManagedBytes,
  paimindRelativePath,
} from '@hansen/harness-compat/managed-files'
import {
  documentSchema,
  editorInputSchema,
  editorResultSchema,
  type EditorInput,
  type EditorResult,
  type EditorDocumentList,
} from './contract.js'
import {
  createEditorModel,
  editorMethods,
  isEditorRead,
  isLocalEditorEdit,
  validateEditorData,
} from './model.js'
import type { PaimindHostWorkspaceRegistry } from '@hansen/harness-compat/host'

const receiptSchema = z.object({
  schema: z
    .literal('paimind.workspace-edit-receipt/v1')
    .default('paimind.workspace-edit-receipt/v1'),
  fingerprint: z.string(),
  before: z.string(),
  committed: z.boolean(),
  result: editorResultSchema,
})

export class WorkspaceEditorFiles {
  private active = true
  private readonly models = new Map<
    string,
    { revision: string; instance: ReturnType<typeof createEditorModel> }
  >()
  private readonly receipts = new Map<
    string,
    { fingerprint: string; result: EditorResult }
  >()
  constructor(private readonly workspaces: PaimindHostWorkspaceRegistry) {}
  dispose(): void {
    this.active = false
    this.models.clear()
    this.receipts.clear()
  }
  async list(workspaceId: string): Promise<EditorDocumentList> {
    if (!this.active) throw new Error('工作区编辑器已停用')
    const workspace = this.workspaces.list().find((w) => w.id === workspaceId)
    if (!workspace) throw new Error('工作区不存在')
    const documents: EditorDocumentList = []
    let visited = 0
    const visit = async (path: string, depth: number): Promise<void> => {
      if (depth > 5) return
      for (const entry of await readdir(
        path ? workspace.path + '/' + path : workspace.path,
        { withFileTypes: true },
      )) {
        if (++visited > 1000) return
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
        const relative = path ? path + '/' + entry.name : entry.name
        if (entry.isDirectory()) await visit(relative, depth + 1)
        else if (entry.name.endsWith('.json')) {
          try {
            const document = documentSchema.parse(
              JSON.parse(
                (
                  await readPaimindManagedBytes(workspace.path, relative)
                ).toString('utf8'),
              ),
            )
            documents.push({
              path: relative,
              title: document.title,
              format: document.format,
            })
          } catch {
            /* Ordinary JSON files are not workspace editor documents. */
          }
        }
      }
    }
    await visit('', 0)
    return documents
  }
  async call(
    raw: EditorInput,
    beforeCommit: () => Promise<void> = async () => {},
    signal?: AbortSignal,
  ): Promise<EditorResult> {
    if (!this.active) throw new Error('工作区编辑器已停用')
    const input = editorInputSchema.parse(raw)
    const workspace = this.workspaces
      .list()
      .find((w) => w.id === input.workspaceId)
    if (!workspace) throw new Error('工作区不存在')
    const path = paimindRelativePath(input.path)
    const key = `${workspace.id}/${path}`
    return withPaimindFileLock(key, async () => {
      signal?.throwIfAborted()
      const bytes = await readPaimindManagedBytes(workspace.path, path)
      const document = documentSchema.parse(JSON.parse(bytes.toString('utf8')))
      let revision = paimindFileRevision(bytes)
      if (!editorMethods[document.format].includes(input.method))
        throw new Error('该格式不支持此操作')
      validateEditorData(document)
      const isWrite = !isEditorRead(input.method)
      const authorize = async () => {
        if (!this.active) throw new Error('工作区编辑器已停用')
        signal?.throwIfAborted()
        await beforeCommit()
      }
      const fingerprint = paimindFileRevision(JSON.stringify(input))
      const receiptKey = `${key}:${input.operationId}`
      const receiptPath =
        '.paimind/workspace-editor-operations/' +
        paimindFileRevision(receiptKey).slice(7) +
        '.json'
      let receiptRevision: string | null = null
      const saveReceipt = async (result: EditorResult, committed: boolean) => {
        const body = Buffer.from(
          JSON.stringify({
            schema: 'paimind.workspace-edit-receipt/v1',
            fingerprint,
            before: paimindFileRevision(bytes),
            committed,
            result,
          }),
        )
        receiptRevision = await writePaimindManagedBytes(
          workspace.path,
          receiptPath,
          body,
          receiptRevision,
          authorize,
          signal,
        )
      }
      if (isWrite) {
        await authorize()
        if (!input.operationId) throw new Error('修改必须提供操作标识')
        const prior = this.receipts.get(receiptKey)
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new Error('操作标识已经使用')
          return prior.result
        }
        const saved = await readPaimindManagedBytes(
          workspace.path,
          receiptPath,
        ).catch((e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return null
          throw e
        })
        if (saved) {
          receiptRevision = paimindFileRevision(saved)
          const record = receiptSchema.parse(JSON.parse(saved.toString('utf8')))
          if (record.fingerprint !== fingerprint)
            throw new Error('操作标识已经使用')
          if (record.committed || record.result.revision === revision) {
            this.receipts.set(receiptKey, record)
            return record.result
          }
          if (record.before !== revision)
            throw new Error(
              'RECOVERY_REQUIRED: 未完成编辑后的文件又发生变化，已保留事务记录',
            )
        }

        if (
          input.expectedRevision !== revision &&
          !(
            input.expectedRevision &&
            isLocalEditorEdit(document, input.method, input.args)
          )
        )
          throw new Error(
            'VERSION_CONFLICT: 文件已被其他操作修改；未保存内容已保留',
          )
      }
      const cached = this.models.get(key)
      const instance =
        cached?.revision === revision
          ? cached.instance
          : createEditorModel(document)
      const method = instance.model[input.method]
      if (typeof method !== 'function') throw new Error('编辑操作不可用')
      const original = structuredClone(instance.data)
      try {
        const value: unknown = await (
          method as (...args: unknown[]) => Promise<unknown>
        ).apply(instance.model, input.args)
        if (
          value &&
          typeof value === 'object' &&
          'conflicts' in value &&
          Array.isArray(value.conflicts) &&
          value.conflicts.length
        )
          throw new Error('VERSION_CONFLICT: 局部内容已变化，当前操作未保存')
        const snapshot: unknown =
          document.format === 'slides'
            ? await instance.model.getDeck!()
            : await instance.model.getDocument!()
        const changed =
          isWrite && JSON.stringify(original) !== JSON.stringify(instance.data)
        const title =
          snapshot &&
          typeof snapshot === 'object' &&
          'title' in snapshot &&
          typeof snapshot.title === 'string'
            ? snapshot.title.slice(0, 200)
            : document.title
        const next = { ...document, title, data: instance.data }
        validateEditorData(documentSchema.parse(next))
        const nextBytes = Buffer.from(JSON.stringify(next, null, 2) + '\n')
        const nextRevision = changed ? paimindFileRevision(nextBytes) : revision
        const undo = instance.model.getUndoState
          ? await instance.model.getUndoState()
          : { canUndo: false, canRedo: false }
        const result = editorResultSchema.parse(
          JSON.parse(
            JSON.stringify({
              format: document.format,
              revision: nextRevision,
              value: value ?? null,
              snapshot,
              undo,
              changed,
            }),
          ),
        )
        if (isWrite) await saveReceipt(result, !changed)
        if (changed) {
          revision = await writePaimindManagedBytes(
            workspace.path,
            path,
            nextBytes,
            revision,
            authorize,
            signal,
          )
          await saveReceipt(result, true)
        }
        this.models.set(key, { revision, instance })
        if (isWrite) this.receipts.set(receiptKey, { fingerprint, result })
        return result
      } catch (error) {
        this.models.delete(key)
        throw error
      }
    })
  }
}
