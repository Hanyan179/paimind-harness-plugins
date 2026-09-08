import { isUtf8 } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { localContextStorage, type ContextStorage } from './storage.js'
import {
  localContextAuthorization,
  type ContextAuthorization,
} from './authorization.js'
import { join, basename, extname } from 'node:path'
import { z } from 'zod'
import {
  paimindFileRevision,
  paimindRelativePath,
  withPaimindFileLock,
} from '@hansen/harness-compat/managed-files'
import {
  CONTEXT_FILE_MAX_BYTES,
  collectionSchema,
  inputSchema,
  mountSchema,
  resultSchema,
  type ContextCollection,
  type ContextIdentity,
  type ContextIdentityProvider,
  type ContextInput,
  type ContextEntry,
  type ContextResult,
  type ContextConnectionInput,
  type ContextAccessInput,
  type ContextConnections,
  type ContextSessionResolver,
  type ContextAccess,
} from './contract.js'

const stateSchema = z
  .object({
    version: z.literal(1),
    owner: z.string(),
    collections: z.array(collectionSchema),
    mounts: z.array(mountSchema),
    descriptions: z.record(z.string(), z.string()),
    operations: z.record(
      z.string(),
      z.object({
        fingerprint: z.string(),
        result: resultSchema,
        at: z.number(),
        sessionId: z.string().optional(),
        callId: z.string().optional(),
        operationId: z.string().optional(),
        source: z.enum(['user', 'model']).optional(),
        sourceWorkspaceId: z.string().optional(),
        sourcePath: z.string().optional(),
        action: z.string().optional(),
        collectionId: z.string().optional(),
        path: z.string().optional(),
        beforeRevision: z.union([z.string(), z.number()]).nullable().optional(),
      }),
    ),
    recycle: z.record(
      z.string(),
      z.object({
        collectionId: z.string(),
        path: z.string(),
        revision: z.string(),
        kind: z.enum(['file', 'directory']).default('file'),
      }),
    ),
  })
  .strict()
type State = z.infer<typeof stateSchema>
const proofSchema = z
  .object({
    destination: z.string(),
    destinationRoot: z.enum(['collection', 'library']),
    collectionId: z.string(),
    after: z.string(),
    before: z.string().nullable(),
    source: z.string().optional(),
    sourceRoot: z.enum(['collection', 'library']).optional(),
    directory: z.boolean(),
  })
  .strict()
type Proof = z.infer<typeof proofSchema>
const journalSchema = z
  .object({ state: stateSchema, proof: proofSchema, operationKey: z.string() })
  .strict()
const managementActions = new Set([
  'createCollection',
  'updateCollection',
  'targets',
  'mounts',
  'setMount',
  'removeMount',
  'recycle',
  'restore',
])
const writeActions = new Set([
  'write',
  'mkdir',
  'move',
  'trash',
  'import',
  'restore',
])
export const contextIsText = (path: string): boolean =>
  /\.(md|markdown|txt|csv|tsv|json|yaml|yml|html?|xml|js|ts|py|css|sql|log)$/i.test(
    path,
  )
const mime = (path: string): string =>
  ({
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
  })[extname(path).toLowerCase()] ??
  (contextIsText(path) ? 'text/plain' : 'application/octet-stream')
const required = (value: string | undefined, label: string): string => {
  if (!value?.trim()) throw new Error(`${label}不能为空`)
  return value
}

/** The collection repository is replaceable; host and UI share this owner, never each other's state. */
export class ContextLibraryRepository
  implements ContextConnections, ContextSessionResolver, ContextAccess
{
  constructor(
    readonly root: string,
    readonly identities: ContextIdentityProvider,
    readonly storage: ContextStorage = localContextStorage,
    readonly authorization: ContextAuthorization = localContextAuthorization,
  ) {}
  connections(input: ContextConnectionInput): Promise<ContextResult> {
    return this.request(input)
  }
  async resolveSession(
    sessionId: string,
  ): Promise<NonNullable<ContextResult['effective']>> {
    return (await this.request({ action: 'effective', sessionId })).effective!
  }
  access(
    input: ContextAccessInput,
    identity: ContextIdentity,
    signal?: AbortSignal,
  ): Promise<ContextResult> {
    return this.request(input, identity, signal)
  }
  private async load(): Promise<State> {
    await this.storage.mkdir(this.root, { recursive: true, mode: 0o700 })
    const raw = await this.storage
      .readFile(join(this.root, 'state.json'), 'utf8')
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null
        throw e
      })
    const state =
      raw === null
        ? {
            version: 1 as const,
            owner: this.identities.owner(),
            collections: [],
            mounts: [],
            descriptions: {},
            operations: {},
            recycle: {},
          }
        : stateSchema.parse(JSON.parse(raw))
    if (state.owner !== this.identities.owner())
      throw new Error('资料库不属于当前用户')
    return this.recover(state)
  }
  private async recover(state: State): Promise<State> {
    const raw = await this.storage
      .readFile(join(this.root, 'pending.json'), 'utf8')
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null
        throw e
      })
    if (raw === null) return state
    const journal = journalSchema.parse(JSON.parse(raw))
    if (journal.state.owner !== state.owner)
      throw new Error('资料事务的所有者不一致')
    if (state.operations[journal.operationKey]) {
      await this.storage.rm(join(this.root, 'pending.json'))
      return state
    }
    const proof = journal.proof
    const root =
      proof.destinationRoot === 'collection'
        ? this.folder(proof.collectionId)
        : this.root
    const revision = async (
      base: string,
      path: string,
    ): Promise<string | null> => {
      try {
        const target = await this.storage.resolve(base, path)
        const stat = await this.storage.lstat(target)
        return stat.isDirectory()
          ? await this.directoryRevision(base, path)
          : paimindFileRevision(await this.storage.read(base, path))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    }
    const destination = await revision(root, proof.destination)
    const source = proof.source
      ? await revision(
          proof.sourceRoot === 'collection'
            ? this.folder(proof.collectionId)
            : this.root,
          proof.source,
        )
      : null
    if (destination === proof.after && source === null) {
      await this.save(journal.state)
      await this.storage.rm(join(this.root, 'pending.json'))
      return journal.state
    }
    if (
      destination === proof.before &&
      (!proof.source || source === proof.after)
    ) {
      await this.storage.rm(join(this.root, 'pending.json'))
      return state
    }
    throw new Error(
      'RECOVERY_REQUIRED: 中断操作的文件版本发生额外变化，已保留内容和事务记录，请先处理后重试',
    )
  }
  private async prepare(
    state: State,
    proof: Proof,
    operationKey: string,
  ): Promise<void> {
    await this.storage.write(
      this.root,
      'pending.json',
      Buffer.from(JSON.stringify({ state, proof, operationKey })),
      null,
    )
  }
  private async save(state: State): Promise<void> {
    const current = await this.storage
      .readFile(join(this.root, 'state.json'))
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null
        throw e
      })
    await this.storage.write(
      this.root,
      'state.json',
      Buffer.from(JSON.stringify(state)),
      current === null ? null : paimindFileRevision(current),
    )
  }
  private collection(state: State, id: string): ContextCollection {
    const item = state.collections.find((c) => c.id === id)
    if (!item) throw new Error('资料夹不可用')
    return item
  }
  private folder(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('资料夹身份无效')
    return join(this.root, 'collections', id)
  }
  private async effective(
    state: State,
    identity: ContextIdentity,
  ): Promise<NonNullable<ContextResult['effective']>> {
    if (identity.owner !== state.owner) throw new Error('用户无权访问资料库')
    return this.authorization.effective(
      state.collections,
      state.mounts,
      identity,
      this.identities,
    )
  }
  private async authorize(
    state: State,
    id: string,
    identity: ContextIdentity | undefined,
    write: boolean,
  ): Promise<void> {
    this.collection(state, id)
    if (!identity) return
    const entry = (await this.effective(state, identity)).find(
      (e) => e.collection.id === id,
    )
    if (!entry || (write && entry.mode !== 'write'))
      throw new Error('ACCESS_DENIED: 当前会话没有所需的资料权限')
    if (write) await identity.assertWrite()
  }
  private async entry(
    root: string,
    path: string,
    state: State,
    id: string,
  ): Promise<ContextEntry> {
    const target = await this.storage.resolve(root, path)
    const stat = await this.storage.lstat(target)
    const bytes = stat.isDirectory()
      ? null
      : await this.storage.read(root, path)
    return {
      path,
      name: basename(path),
      kind:
        bytes === null
          ? 'directory'
          : contextIsText(path) && isUtf8(bytes) && !bytes.includes(0)
            ? 'text'
            : 'binary',
      bytes: bytes?.length ?? stat.size,
      revision:
        bytes === null
          ? await this.directoryRevision(root, path)
          : paimindFileRevision(bytes),
      description: state.descriptions[`${id}/${path}`] ?? '',
      contentType: mime(path),
    }
  }
  private async directoryRevision(root: string, path: string): Promise<string> {
    const target = await this.storage.resolve(root, path)
    const parts: string[] = []
    for (const row of (
      await this.storage.readdir(target, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (row.isSymbolicLink())
        throw new Error('资料目录含符号链接，不能执行目录操作')
      const child = path + '/' + row.name
      parts.push(
        row.name +
          ':' +
          (row.isDirectory()
            ? await this.directoryRevision(root, child)
            : paimindFileRevision(await this.storage.read(root, child))),
      )
    }
    return paimindFileRevision(parts.join('\n'))
  }
  private async list(
    root: string,
    path: string,
    state: State,
    id: string,
  ): Promise<ContextEntry[]> {
    const target = path === '' ? root : await this.storage.resolve(root, path)
    const rows = await this.storage.readdir(target, { withFileTypes: true })
    const output: ContextEntry[] = []
    for (const row of rows) {
      if (row.name.startsWith('.paimind-') || row.isSymbolicLink()) continue
      if (output.length >= 1000) throw new Error('目录文件过多，请拆分资料夹')
      output.push(
        await this.entry(
          root,
          path ? `${path}/${row.name}` : row.name,
          state,
          id,
        ),
      )
    }
    return output.sort((a, b) =>
      a.kind === 'directory' && b.kind !== 'directory'
        ? -1
        : b.kind === 'directory' && a.kind !== 'directory'
          ? 1
          : a.name.localeCompare(b.name),
    )
  }
  async request(
    raw: ContextInput,
    identity?: ContextIdentity,
    signal?: AbortSignal,
  ): Promise<ContextResult> {
    const input = inputSchema.parse(raw)
    signal?.throwIfAborted()
    if (identity && managementActions.has(input.action))
      throw new Error('模型不能管理资料连接或授权')
    return withPaimindFileLock(this.root, async () => {
      signal?.throwIfAborted()
      const state = await this.load()
      const id = input.collectionId ?? ''
      const scoped =
        identity ??
        (input.action === 'effective'
          ? await this.identities.forSession(required(input.sessionId, '会话'))
          : undefined)
      if (input.action === 'effective')
        return { effective: await this.effective(state, scoped!) }
      if (input.action === 'collections') {
        if (!identity) return { collections: state.collections }
        const effective = await this.effective(state, identity)
        return { collections: effective.map((e) => e.collection), effective }
      }
      if (input.action === 'mounts')
        return {
          mounts: state.mounts.filter(
            (m) =>
              (!input.target ||
                (m.target.kind === input.target.kind &&
                  m.target.id === input.target.id)) &&
              (!id || m.collectionId === id),
          ),
        }
      if (input.action === 'createCollection') {
        const item = {
          id: randomUUID(),
          owner: state.owner,
          title: required(input.title, '名称').trim(),
          description: input.description ?? '',
          revision: 1,
          updatedAt: Date.now(),
        }
        await this.storage.mkdir(this.folder(item.id), {
          recursive: true,
          mode: 0o700,
        })
        state.collections.push(item)
        await this.save(state)
        return { collection: item }
      }
      if (input.action === 'updateCollection') {
        const item = this.collection(state, id)
        if (input.expectedRevision !== item.revision)
          throw new Error('VERSION_CONFLICT: 资料夹已经变化')
        item.title = input.title?.trim() || item.title
        item.description = input.description ?? item.description
        item.revision++
        item.updatedAt = Date.now()
        await this.save(state)
        return { collection: item }
      }
      if (input.action === 'setMount') {
        this.collection(state, id)
        if (
          !input.target ||
          !(await this.identities.validateTarget(input.target))
        )
          throw new Error('连接目标不存在或不可用')
        const current = state.mounts.find(
          (m) =>
            m.target.kind === input.target!.kind &&
            m.target.id === input.target!.id &&
            m.collectionId === id,
        )
        if (input.expectedRevision !== (current?.revision ?? null))
          throw new Error('VERSION_CONFLICT: 连接已更新')
        const mount = {
          id: current?.id ?? randomUUID(),
          target: input.target,
          collectionId: id,
          mode: input.mode ?? ('read' as const),
          revision: (current?.revision ?? 0) + 1,
        }
        state.mounts = state.mounts.filter((m) => m.id !== mount.id)
        state.mounts.push(mount)
        await this.save(state)
        return { mount }
      }
      if (input.action === 'removeMount') {
        const current = state.mounts.find((m) => m.id === input.mountId)
        if (!current || current.revision !== input.expectedRevision)
          throw new Error('VERSION_CONFLICT: 连接已更新')
        state.mounts = state.mounts.filter((m) => m.id !== current.id)
        await this.save(state)
        return { ok: true }
      }
      if (input.action === 'search') {
        const collections = identity
          ? (await this.effective(state, identity)).map((e) => e.collection)
          : state.collections
        const query = required(input.query, '搜索内容').toLocaleLowerCase()
        const hits: NonNullable<ContextResult['hits']> = []
        const visit = async (
          c: ContextCollection,
          path: string,
        ): Promise<void> => {
          for (const entry of await this.list(
            this.folder(c.id),
            path,
            state,
            c.id,
          )) {
            signal?.throwIfAborted()
            if (hits.length >= 100) return
            if (entry.kind === 'directory') await visit(c, entry.path)
            else {
              const text =
                entry.kind === 'text'
                  ? (
                      await this.storage.read(this.folder(c.id), entry.path)
                    ).toString('utf8')
                  : ''
              const hay = `${entry.name}\n${entry.description}\n${text}`
              const index = hay.toLocaleLowerCase().indexOf(query)
              if (index >= 0)
                hits.push({
                  collectionId: c.id,
                  path: entry.path,
                  description: entry.description,
                  snippet: hay.slice(Math.max(0, index - 60), index + 180),
                })
            }
          }
        }
        for (const c of collections.filter((c) => !id || c.id === id))
          await visit(c, '')
        return { hits }
      }
      await this.authorize(state, id, identity, writeActions.has(input.action))
      const root = this.folder(id)
      const path = paimindRelativePath(
        input.path ?? '',
        input.action === 'list' || input.action === 'recycle',
      )
      if (input.action === 'list')
        return { entries: await this.list(root, path, state, id) }
      if (input.action === 'read') {
        const entry = await this.entry(root, path, state, id)
        if (entry.kind === 'directory') throw new Error('请使用目录浏览')
        const bytes = await this.storage.read(root, path)
        const offset = input.offset ?? 0
        let end = Math.min(bytes.length, offset + (input.limit ?? 32768))
        if (offset > bytes.length) throw new Error('读取偏移超出文件范围')
        if (entry.kind === 'text') {
          if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)
            throw new Error('读取偏移必须位于文本字符边界')
          while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end++
        }
        return {
          document: {
            entry: {
              ...entry,
              revision: paimindFileRevision(bytes),
              bytes: bytes.length,
            },
            content: bytes
              .subarray(offset, end)
              .toString(entry.kind === 'text' ? 'utf8' : 'base64'),
            encoding: entry.kind === 'text' ? 'utf8' : 'base64',
            offset,
            nextOffset: end < bytes.length ? end : null,
          },
        }
      }
      if (input.action === 'recycle')
        return {
          entries: Object.entries(state.recycle)
            .filter(([, v]) => v.collectionId === id)
            .map(([key, v]) => ({
              path: key,
              name: v.path,
              kind:
                v.kind === 'directory'
                  ? ('directory' as const)
                  : ('binary' as const),
              bytes: 0,
              revision: v.revision,
              description: '已回收',
              contentType: 'application/octet-stream',
            })),
        }
      const operationId = required(input.operationId, '操作标识')
      const operationKey = paimindFileRevision(
        `${identity?.sessionId ?? state.owner}:${operationId}`,
      )
      const fingerprint = paimindFileRevision(
        JSON.stringify({ ...input, operationId: undefined }),
      )
      const prior = state.operations[operationKey]
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error('操作标识已用于不同请求')
        return prior.result
      }
      const beforeCommit = async (): Promise<void> => {
        signal?.throwIfAborted()
        let current = identity
        if (identity) {
          const fresh = await this.identities.forSession(identity.sessionId)
          if (
            fresh.owner !== identity.owner ||
            (input.action === 'import' &&
              fresh.workspaceRoot !== identity.workspaceRoot)
          )
            throw new Error('ACCESS_DENIED: 会话归属已变化')
          current = { ...fresh, assertWrite: identity.assertWrite }
        }
        await this.authorize(state, id, current, true)
      }
      let result: ContextResult = { ok: true, operationId, path }
      let mutation: (() => Promise<void>) | undefined
      let proof: Proof | undefined
      if (input.action === 'write' || input.action === 'import') {
        let bytes: Buffer
        if (input.action === 'import') {
          if (!identity?.workspaceRoot) throw new Error('当前会话未绑定工作区')
          bytes = await this.storage.read(
            identity.workspaceRoot,
            required(input.toPath, '工作区来源路径'),
          )
        } else
          bytes = Buffer.from(input.content ?? '', input.encoding ?? 'utf8')
        if (bytes.length > CONTEXT_FILE_MAX_BYTES)
          throw new Error('文件超过 64 MB 限制')
        if (
          input.expectedRevision !== null &&
          typeof input.expectedRevision !== 'string'
        )
          throw new Error('必须提供文件版本，新文件使用 null')
        const expected = input.expectedRevision
        const existing = await this.storage
          .read(root, path)
          .catch((e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') return null
            throw e
          })
        if (
          (existing === null ? null : paimindFileRevision(existing)) !==
          expected
        )
          throw new Error('VERSION_CONFLICT: 文件已经变化')
        result.revision = paimindFileRevision(bytes)
        proof = {
          destination: path,
          destinationRoot: 'collection',
          collectionId: id,
          after: result.revision,
          before: expected,
          directory: false,
        }
        mutation = async () => {
          await this.storage.write(
            root,
            path,
            bytes,
            expected,
            beforeCommit,
            signal,
          )
        }
        if (input.description !== undefined)
          state.descriptions[`${id}/${path}`] = input.description
      } else if (input.action === 'mkdir') {
        const target = await this.storage.resolve(root, path, true)
        if (
          await this.storage
            .lstat(target)
            .then(() => true)
            .catch((e: NodeJS.ErrnoException) => {
              if (e.code === 'ENOENT') return false
              throw e
            })
        )
          throw new Error('目标路径已存在')
        result.revision = paimindFileRevision('')
        proof = {
          destination: path,
          destinationRoot: 'collection',
          collectionId: id,
          after: result.revision,
          before: null,
          directory: true,
        }
        mutation = async () => {
          await beforeCommit()
          await this.storage.mkdir(target, { mode: 0o700 })
        }
      } else if (input.action === 'move' || input.action === 'trash') {
        const entry = await this.entry(root, path, state, id)
        if (entry.revision !== input.expectedRevision)
          throw new Error('VERSION_CONFLICT: 文件已经变化')
        const from = await this.storage.resolve(root, path)
        const to =
          input.action === 'move'
            ? paimindRelativePath(required(input.toPath, '目标路径'))
            : `recycle/${randomUUID()}`
        if (
          input.action === 'move' &&
          (to === path || to.startsWith(path + '/'))
        )
          throw new Error('不能移动到目录自身或内部')
        const destinationRoot = input.action === 'move' ? root : this.root
        const target = await this.storage.resolve(destinationRoot, to, true)
        if (
          await this.storage
            .lstat(target)
            .then(() => true)
            .catch((e: NodeJS.ErrnoException) => {
              if (e.code === 'ENOENT') return false
              throw e
            })
        )
          throw new Error('目标路径已存在')
        result.revision = entry.revision!
        result.destinationPath = to
        proof = {
          destination: to,
          destinationRoot: input.action === 'move' ? 'collection' : 'library',
          collectionId: id,
          after: entry.revision!,
          before: null,
          source: path,
          sourceRoot: 'collection',
          directory: entry.kind === 'directory',
        }
        mutation = async () => {
          await beforeCommit()
          if (
            (await this.entry(root, path, state, id)).revision !==
            entry.revision
          )
            throw new Error('VERSION_CONFLICT: 文件已经变化')
          await this.storage.resolve(destinationRoot, to, true)
          if (
            await this.storage
              .lstat(target)
              .then(() => true)
              .catch((e: NodeJS.ErrnoException) => {
                if (e.code === 'ENOENT') return false
                throw e
              })
          )
            throw new Error('目标路径已存在')
          await this.storage.rename(from, target)
        }
        if (input.action === 'trash') {
          state.recycle[to] = {
            collectionId: id,
            path,
            revision: entry.revision!,
            kind: entry.kind === 'directory' ? 'directory' : 'file',
          }
          result.recycledPath = to
        }
        for (const key of Object.keys(state.descriptions)) {
          if (key === `${id}/${path}` || key.startsWith(`${id}/${path}/`)) {
            const suffix = key.slice(`${id}/${path}`.length)
            state.descriptions[`${id}/${to}${suffix}`] =
              state.descriptions[key]!
            delete state.descriptions[key]
          }
        }
      } else if (input.action === 'restore') {
        const recycled = state.recycle[path]
        if (!recycled || recycled.collectionId !== id)
          throw new Error('回收记录不存在')
        const to = paimindRelativePath(input.toPath ?? recycled.path)
        const from = await this.storage.resolve(this.root, path)
        const target = await this.storage.resolve(root, to, true)
        if (
          await this.storage
            .lstat(target)
            .then(() => true)
            .catch((e: NodeJS.ErrnoException) => {
              if (e.code === 'ENOENT') return false
              throw e
            })
        )
          throw new Error('恢复位置已存在，请选择其他位置')
        const revision =
          recycled.kind === 'directory'
            ? await this.directoryRevision(this.root, path)
            : paimindFileRevision(await this.storage.read(this.root, path))
        if (revision !== recycled.revision) throw new Error('回收内容已经变化')
        proof = {
          destination: to,
          destinationRoot: 'collection',
          collectionId: id,
          after: revision,
          before: null,
          source: path,
          sourceRoot: 'library',
          directory: recycled.kind === 'directory',
        }
        mutation = async () => {
          await beforeCommit()
          await this.storage.resolve(root, to, true)
          if (
            await this.storage
              .lstat(target)
              .then(() => true)
              .catch((e: NodeJS.ErrnoException) => {
                if (e.code === 'ENOENT') return false
                throw e
              })
          )
            throw new Error('恢复位置已存在')
          await this.storage.rename(from, target)
        }
        result.revision = revision
        delete state.recycle[path]
        for (const key of Object.keys(state.descriptions))
          if (key === `${id}/${path}` || key.startsWith(`${id}/${path}/`)) {
            state.descriptions[
              `${id}/${to}${key.slice(`${id}/${path}`.length)}`
            ] = state.descriptions[key]!
            delete state.descriptions[key]
          }
      } else throw new Error('不支持的资料操作')
      state.operations[operationKey] = {
        fingerprint,
        result,
        operationId,
        source: identity ? 'model' : 'user',
        ...(identity?.callId ? { callId: identity.callId } : {}),
        ...(input.action === 'import'
          ? {
              sourcePath: input.toPath,
              sourceWorkspaceId: identity?.targets.find(
                (t) => t.kind === 'workspace',
              )?.id,
            }
          : {}),
        at: Date.now(),
        action: input.action,
        collectionId: id,
        path,
        ...(input.expectedRevision === undefined
          ? {}
          : { beforeRevision: input.expectedRevision }),
        ...(identity ? { sessionId: identity.sessionId } : {}),
      }
      if (!mutation || !proof) throw new Error('缺少受管文件事务')
      await this.prepare(state, proof, operationKey)
      await mutation()
      await this.save(state)
      await this.storage.rm(join(this.root, 'pending.json'))
      return result
    })
  }
}
