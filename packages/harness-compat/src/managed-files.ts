import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const queues = new Map<string, Promise<unknown>>()
export async function withPaimindFileLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  queues.set(key, current)
  try {
    return await current
  } finally {
    if (queues.get(key) === current) queues.delete(key)
  }
}
export function paimindFileRevision(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
export function paimindRelativePath(input: string, allowRoot = false): string {
  if (allowRoot && input === '') return ''
  if (
    !input ||
    input.length > 1000 ||
    isAbsolute(input) ||
    /[\\\u0000-\u001f\u007f:]/.test(input) ||
    input
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.startsWith('.paimind-'),
      )
  ) {
    throw new Error('路径必须是资料范围内的相对路径')
  }
  return input
}
/** Resolve every component without following symbolic links; callers supply an owner-resolved root. */
export async function resolvePaimindManagedFile(
  root: string,
  path: string,
  createParents = false,
): Promise<string> {
  const normalized = paimindRelativePath(path)
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new Error('受管根目录不能是符号链接或特殊文件')
  const realRoot = await realpath(root)
  let current = realRoot
  const parts = normalized.split('/')
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!)
    let info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!info && i < parts.length - 1 && createParents) {
      await mkdir(current, { mode: 0o700 })
      info = await lstat(current)
    }
    if (
      info?.isSymbolicLink() ||
      (info && i < parts.length - 1 && !info.isDirectory()) ||
      (info && !info.isFile() && !info.isDirectory())
    )
      throw new Error('不允许符号链接或特殊文件')
    if (!info && i < parts.length - 1)
      throw Object.assign(new Error('父目录不存在'), { code: 'ENOENT' })
  }
  const edge = relative(realRoot, resolve(current))
  if (!edge || edge.startsWith(`..${sep}`) || isAbsolute(edge))
    throw new Error('路径超出允许范围')
  return current
}
export async function readPaimindManagedBytes(
  root: string,
  path: string,
  maxBytes = 20 * 1024 * 1024,
): Promise<Buffer> {
  const target = await resolvePaimindManagedFile(root, path)
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes)
      throw new Error('文件类型或大小不支持')
    const bytes = await handle.readFile()
    if (bytes.length > maxBytes) throw new Error('文件超过读取限制')
    return bytes
  } finally {
    await handle.close()
  }
}
export async function writePaimindManagedBytes(
  root: string,
  path: string,
  bytes: Uint8Array,
  expectedRevision: string | null,
  beforeCommit: () => Promise<void> = async () => {},
  signal?: AbortSignal,
  maxBytes = 20 * 1024 * 1024,
): Promise<string> {
  if (bytes.length > maxBytes) throw new Error('文件超过写入限制')
  const target = await resolvePaimindManagedFile(root, path, true)
  const current = await readPaimindManagedBytes(root, path, maxBytes).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    },
  )
  if (
    (current === null ? null : paimindFileRevision(current)) !==
    expectedRevision
  )
    throw new Error('VERSION_CONFLICT: 文件已经变化，请刷新后重试')
  const tmp = join(dirname(target), `.paimind-write-${randomUUID()}`)
  const handle = await open(tmp, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    signal?.throwIfAborted()
    await beforeCommit()
    signal?.throwIfAborted()
    await resolvePaimindManagedFile(root, path)
    const latest = await readPaimindManagedBytes(root, path, maxBytes).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      },
    )
    if (
      (latest === null ? null : paimindFileRevision(latest)) !==
      expectedRevision
    )
      throw new Error('VERSION_CONFLICT: 文件已经变化，请刷新后重试')
    await rename(tmp, target)
    return paimindFileRevision(bytes)
  } finally {
    await handle.close().catch(() => {})
    await rm(tmp, { force: true })
  }
}
