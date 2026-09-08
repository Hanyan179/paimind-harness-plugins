import { z } from 'zod'
export const WORKSPACE_EDITOR_SCHEMA = 'paimind.workspace-document/v1'
export const formatSchema = z.enum(['docs', 'slides', 'sheets'])
export type WorkspaceFormat = z.infer<typeof formatSchema>
export const documentSchema = z
  .object({
    schema: z.literal(WORKSPACE_EDITOR_SCHEMA),
    format: formatSchema,
    title: z.string().max(200),
    data: z.record(z.string(), z.json()),
  })
  .strict()
export type WorkspaceDocument = z.infer<typeof documentSchema>
export const editorInputSchema = z
  .object({
    workspaceId: z.string().max(200),
    path: z.string().max(1000),
    method: z.string().max(80),
    args: z.array(z.json()).max(8).default([]),
    expectedRevision: z.string().nullable().optional(),
    operationId: z.string().max(200).optional(),
  })
  .strict()
export type EditorInput = z.infer<typeof editorInputSchema>
export const editorResultSchema = z
  .object({
    format: formatSchema,
    revision: z.string(),
    value: z.json(),
    snapshot: z.json(),
    undo: z.object({ canUndo: z.boolean(), canRedo: z.boolean() }).strict(),
    changed: z.boolean(),
  })
  .strict()
export type EditorResult = z.infer<typeof editorResultSchema>
export interface WorkspaceEditorApi {
  call(input: EditorInput): Promise<EditorResult>
  list(input: { workspaceId: string }): Promise<EditorDocumentList>
}
export const editorListInputSchema = z
  .object({ workspaceId: z.string().max(200) })
  .strict()
export const editorListSchema = z.array(
  z
    .object({ path: z.string(), title: z.string(), format: formatSchema })
    .strict(),
)
export type EditorDocumentList = z.infer<typeof editorListSchema>
