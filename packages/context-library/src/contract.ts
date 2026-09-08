import { z } from 'zod'
export const targetSchema = z
  .object({
    kind: z.enum(['agent', 'workspace', 'session']),
    id: z.string().min(1).max(200),
  })
  .strict()
export type ContextTarget = z.infer<typeof targetSchema>
export const collectionSchema = z
  .object({
    id: z.string(),
    owner: z.string(),
    title: z.string(),
    description: z.string(),
    revision: z.number().int(),
    updatedAt: z.number(),
  })
  .strict()
export type ContextCollection = z.infer<typeof collectionSchema>
export const mountSchema = z
  .object({
    id: z.string(),
    target: targetSchema,
    collectionId: z.string(),
    mode: z.enum(['read', 'write']),
    revision: z.number().int(),
  })
  .strict()
export type ContextMount = z.infer<typeof mountSchema>
export interface ContextIdentity {
  readonly owner: string
  readonly sessionId: string
  readonly callId?: string
  readonly targets: readonly ContextTarget[]
  readonly workspaceRoot?: string
  readonly assertWrite: () => Promise<void>
}
export interface ContextIdentityProvider {
  owner(): string
  validateTarget(target: ContextTarget): Promise<boolean>
  forSession(sessionId: string): Promise<ContextIdentity>
}
export const entrySchema = z
  .object({
    path: z.string(),
    name: z.string(),
    kind: z.enum(['directory', 'text', 'binary']),
    bytes: z.number(),
    revision: z.string().nullable(),
    description: z.string(),
    contentType: z.string(),
  })
  .strict()
export type ContextEntry = z.infer<typeof entrySchema>
export const readSchema = z
  .object({
    entry: entrySchema,
    content: z.string(),
    encoding: z.enum(['utf8', 'base64']),
    offset: z.number(),
    nextOffset: z.number().nullable(),
  })
  .strict()
export type ContextRead = z.infer<typeof readSchema>
export const inputSchema = z
  .object({
    action: z.enum([
      'collections',
      'createCollection',
      'updateCollection',
      'targets',
      'mounts',
      'setMount',
      'removeMount',
      'effective',
      'list',
      'read',
      'search',
      'write',
      'mkdir',
      'move',
      'trash',
      'recycle',
      'restore',
      'import',
    ]),
    collectionId: z.string().max(200).optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(16000).optional(),
    target: targetSchema.optional(),
    mode: z.enum(['read', 'write']).optional(),
    mountId: z.string().optional(),
    sessionId: z.string().max(200).optional(),
    path: z.string().max(1000).optional(),
    toPath: z.string().max(1000).optional(),
    content: z.string().max(28_000_000).optional(),
    encoding: z.enum(['utf8', 'base64']).optional(),
    contentType: z.string().max(150).optional(),
    expectedRevision: z.union([z.string(), z.number()]).nullable().optional(),
    operationId: z.string().min(1).max(200).optional(),
    query: z.string().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(65536).optional(),
  })
  .strict()
export type ContextInput = z.infer<typeof inputSchema>
export const resultSchema = z
  .object({
    collections: z.array(collectionSchema).optional(),
    mounts: z.array(mountSchema).optional(),
    entries: z.array(entrySchema).optional(),
    document: readSchema.optional(),
    collection: collectionSchema.optional(),
    mount: mountSchema.optional(),
    path: z.string().optional(),
    destinationPath: z.string().optional(),
    revision: z.string().optional(),
    operationId: z.string().optional(),
    recycledPath: z.string().optional(),
    ok: z.boolean().optional(),
    effective: z
      .array(
        z
          .object({
            collection: collectionSchema,
            mode: z.enum(['read', 'write']),
            sources: z.array(mountSchema),
          })
          .strict(),
      )
      .optional(),
    targets: z
      .array(z.object({ target: targetSchema, title: z.string() }).strict())
      .optional(),
    hits: z
      .array(
        z
          .object({
            collectionId: z.string(),
            path: z.string(),
            description: z.string(),
            snippet: z.string(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
export type ContextResult = z.infer<typeof resultSchema>
export interface ContextManagement {
  request(input: ContextInput): Promise<ContextResult>
}

export type ContextConnectionInput = Omit<ContextInput, 'action'> & {
  action: 'mounts' | 'setMount' | 'removeMount'
}
export type ContextAccessInput = Omit<ContextInput, 'action'> & {
  action:
    | 'collections'
    | 'list'
    | 'read'
    | 'search'
    | 'write'
    | 'mkdir'
    | 'move'
    | 'trash'
    | 'import'
}
export interface ContextConnections {
  connections(input: ContextConnectionInput): Promise<ContextResult>
}
export interface ContextSessionResolver {
  resolveSession(
    sessionId: string,
  ): Promise<NonNullable<ContextResult['effective']>>
}
export interface ContextAccess {
  access(
    input: ContextAccessInput,
    identity: ContextIdentity,
    signal?: AbortSignal,
  ): Promise<ContextResult>
}
