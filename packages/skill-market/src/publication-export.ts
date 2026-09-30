import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rmdir, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { Zip, ZipPassThrough } from 'fflate'
import { SKILL_PUBLICATION_CHUNK_BYTES, SKILL_PUBLICATION_EXPORT_TTL_MS, SKILL_PUBLICATION_MAX_ARCHIVE_BYTES,
  readSkillPublicationSelection, readSkillPublicationChunkInput, readSkillPublicationReleaseInput, readSkillPublicationExport,
  type SkillPublicationSelection, type SkillPublicationExport, type SkillPublicationChunk } from './publication.js'

type Entry = Readonly<{ path: string; kind: 'directory' | 'binary'; size: number; digest?: string }>
export interface SkillPublicationSource { readonly root: string; readonly entries: readonly Entry[]; readonly digest: string }
type Handle = { directory: string; path: string; file: FileHandle; descriptor: Readonly<SkillPublicationExport>;
  timer: ReturnType<typeof setTimeout>; active: boolean; tail: Promise<unknown>; release?: Promise<void>;
  expiresAt: number; mtimeMs: number; ctimeMs: number; identity: { dev: number; ino: number } }
const unavailable = () => new Error('Skill 发布导出不可用、已过期或来源变化')
async function removeOwnedFile(path: string, identity: { dev: number; ino: number }): Promise<void> {
  const current = await lstat(path)
  if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) throw unavailable()
  await unlink(path)
}

/** Source-plugin-owned, bounded, expiring transfer handles. No registry,
 * approval state, user-selected path, persistent resumability or stale-dir scan. */
export class SkillPublicationExports {
  private active = true
  private cleanupError: unknown
  private readonly handles = new Map<string, Handle>()
  private readonly captures = new Map<AbortController, Promise<unknown>>()
  private reservations = 0
  constructor(private readonly root: string,
    private readonly source: (selection: SkillPublicationSelection, signal: AbortSignal) => Promise<SkillPublicationSource>) {}

  begin(input: unknown, requestSignal?: AbortSignal): Promise<Readonly<SkillPublicationExport>> {
    const selected = readSkillPublicationSelection(input)
    if (!this.active || this.cleanupError || this.reservations + this.handles.size >= 2) return Promise.reject(unavailable())
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(SKILL_PUBLICATION_EXPORT_TTL_MS),
      ...(requestSignal ? [requestSignal] : [])])
    this.reservations += 1
    const capture = this.capture(selected, signal)
    this.captures.set(controller, capture)
    void capture.finally(() => { this.captures.delete(controller); this.reservations -= 1 }).catch(() => {})
    return capture
  }

  private async capture(selected: SkillPublicationSelection, signal: AbortSignal): Promise<Readonly<SkillPublicationExport>> {
    let directory: string | undefined, path: string | undefined, file: FileHandle | undefined
    let handedOff = false, identity: { dev: number; ino: number } | undefined
    const check = () => { signal.throwIfAborted(); if (!this.active || this.cleanupError) throw unavailable() }
    try {
      check()
      const source = await this.source(selected, signal); check()
      if (source.digest !== selected.expectedDigest) throw unavailable()
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const rootInfo = await lstat(this.root)
      if (await realpath(this.root) !== this.root || !rootInfo.isDirectory() || (rootInfo.mode & 0o077) !== 0) throw unavailable()
      directory = await mkdtemp(join(this.root, 'export-')); path = join(directory, 'package.zip')
      file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      const created = await file.stat(); identity = { dev: created.dev, ino: created.ino }
      const output = file, hash = createHash('sha256'); let archiveBytes = 0, writeError: unknown, finalized = false
      let writes = Promise.resolve()
      const zip = new Zip((error, bytes, final) => {
        if (error) { writeError ??= error; return }
        const position = archiveBytes; archiveBytes += bytes.length
        if (archiveBytes > SKILL_PUBLICATION_MAX_ARCHIVE_BYTES) { writeError ??= unavailable(); return }
        hash.update(bytes); finalized ||= final
        writes = writes.then(async () => {
          check(); if (writeError) throw writeError
          for (let offset = 0; offset < bytes.length;) {
            const written = await output.write(bytes, offset, bytes.length - offset, position + offset)
            if (written.bytesWritten <= 0) throw unavailable(); offset += written.bytesWritten
          }
        }).catch(error => { writeError ??= error })
      })
      try {
        for (const entry of source.entries) {
          check()
          const target = join(source.root, entry.path)
          if (await realpath(target) !== target) throw unavailable()
          const item = new ZipPassThrough(entry.path + (entry.kind === 'directory' ? '/' : ''))
          item.mtime = new Date(1980, 0, 1); zip.add(item)
          if (entry.kind === 'directory') {
            const info = await lstat(target); if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable()
            item.push(new Uint8Array(), true)
          } else {
            const input = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
            try {
              const stat = await input.stat()
              if (!stat.isFile() || stat.nlink !== 1 || stat.size !== entry.size) throw unavailable()
              const contentHash = createHash('sha256'), buffer = Buffer.alloc(SKILL_PUBLICATION_CHUNK_BYTES)
              let offset = 0
              while (offset < entry.size) {
                check()
                const read = await input.read(buffer, 0, Math.min(buffer.length, entry.size - offset), offset)
                if (read.bytesRead <= 0) throw unavailable()
                const bytes = buffer.subarray(0, read.bytesRead); contentHash.update(bytes)
                offset += bytes.length; item.push(bytes, false); await writes
                if (writeError) throw writeError
              }
              if (`sha256:${contentHash.digest('hex')}` !== entry.digest) throw unavailable()
              const after = await input.stat()
              if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.nlink !== 1) throw unavailable()
              item.push(new Uint8Array(), true)
            } finally { await input.close() }
          }
          await writes; if (writeError) throw writeError
        }
        zip.end(); await writes
        if (writeError) throw writeError
        if (!finalized) throw unavailable()
      } finally { zip.terminate(); await writes }
      await file.close(); file = undefined
      check()
      const current = await this.source(selected, signal); check()
      if (current.digest !== source.digest) throw unavailable()
      const descriptor = readSkillPublicationExport({ schema: 'paimind.skill-export/v1', exportId: randomUUID(), name: selected.skillId,
        packageDigest: source.digest, archiveDigest: `sha256:${hash.digest('hex')}`, archiveBytes,
        expandedBytes: source.entries.reduce((sum, entry) => sum + entry.size, 0), entryCount: source.entries.length })
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); check()
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size !== archiveBytes || info.dev !== identity.dev || info.ino !== identity.ino) throw unavailable()
      const handle: Handle = { directory, path, file, descriptor, active: true, tail: Promise.resolve(),
        identity,
        expiresAt: performance.now() + SKILL_PUBLICATION_EXPORT_TTL_MS, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs,
        timer: setTimeout(() => { void this.release({ exportId: descriptor.exportId }).catch(error => { this.cleanupError = error }) }, SKILL_PUBLICATION_EXPORT_TTL_MS) }
      handle.timer.unref(); this.handles.set(descriptor.exportId, handle); handedOff = true
      return descriptor
    } finally {
      if (!handedOff) {
        try { if (file) await file.close(); if (path && identity) await removeOwnedFile(path, identity); if (directory) await rmdir(directory) }
        catch (error) { this.cleanupError = error; throw error }
      }
    }
  }

  read(input: unknown, signal?: AbortSignal): Promise<Readonly<SkillPublicationChunk>> {
    const selected = readSkillPublicationChunkInput(input), handle = this.handles.get(selected.exportId)
    if (!this.active || !handle?.active || selected.offset >= handle.descriptor.archiveBytes) return Promise.reject(unavailable())
    const read = handle.tail.then(async () => {
      const check = () => { signal?.throwIfAborted(); if (!this.active || !handle.active || performance.now() >= handle.expiresAt) throw unavailable() }
      check()
      const info = await handle.file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size !== handle.descriptor.archiveBytes
        || info.mtimeMs !== handle.mtimeMs || info.ctimeMs !== handle.ctimeMs) throw unavailable()
      const bytes = Buffer.alloc(Math.min(SKILL_PUBLICATION_CHUNK_BYTES, handle.descriptor.archiveBytes - selected.offset))
      for (let offset = 0; offset < bytes.length;) {
        check()
        const read = await handle.file.read(bytes, offset, bytes.length - offset, selected.offset + offset)
        if (read.bytesRead <= 0) throw unavailable(); offset += read.bytesRead
      }
      const after = await handle.file.stat()
      if (after.nlink !== 1 || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw unavailable()
      check()
      return Object.freeze({ ...selected, data: bytes.toString('base64'), eof: selected.offset + bytes.length === handle.descriptor.archiveBytes })
    })
    handle.tail = read.catch(() => {})
    return read
  }

  async release(input: unknown): Promise<Readonly<{ exportId: string; released: true }>> {
    const selected = readSkillPublicationReleaseInput(input), handle = this.handles.get(selected.exportId)
    if (handle) {
      handle.active = false; clearTimeout(handle.timer)
      handle.release ??= (async () => {
        await handle.tail; await handle.file.close(); await removeOwnedFile(handle.path, handle.identity); await rmdir(handle.directory)
        this.handles.delete(selected.exportId)
      })()
      try { await handle.release } catch (error) { this.cleanupError = error; throw error }
    }
    return Object.freeze({ exportId: selected.exportId, released: true })
  }

  async dispose(): Promise<void> {
    this.active = false
    for (const controller of this.captures.keys()) controller.abort()
    await Promise.allSettled(this.captures.values())
    await Promise.all([...this.handles.keys()].map(exportId => this.release({ exportId })))
    if (this.cleanupError) throw this.cleanupError
  }
}
