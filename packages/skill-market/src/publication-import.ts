import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rmdir, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { readSkillPublicationAdoptionInput, readSkillPublicationAdoption, readSkillPublicationImportId,
  readSkillPublicationImportChunk, SKILL_PUBLICATION_CHUNK_BYTES, SKILL_PUBLICATION_EXPORT_TTL_MS,
  type SkillPublicationAdoption, type SkillPublicationAdoptionInput, type SkillPublicationImportStart } from './publication.js'

type Handle = { directory: string; path: string; file?: FileHandle; identity: { dev: number; ino: number };
  input: Readonly<SkillPublicationAdoptionInput>; nextOffset: number; hash: ReturnType<typeof createHash>;
  controller: AbortController; expiresAt: number; timer: ReturnType<typeof setTimeout>; active: boolean;
  committing: boolean; tail: Promise<unknown>; receipt?: Readonly<SkillPublicationAdoption>; release?: Promise<void> }
const unavailable = () => new Error('企业 Skill 接收已失效、内容不匹配或正在提交')
const matches = (input: SkillPublicationAdoptionInput, receipt: SkillPublicationAdoption) => {
  const { schema: _schema, adoptedAt: _time, ...origin } = readSkillPublicationAdoption(receipt)
  if (JSON.stringify(readSkillPublicationAdoptionInput(input)) !== JSON.stringify(origin)) throw unavailable()
  return receipt
}

/** Bounded private reception owned by the original Skill service. Installation
 * and immutable readback remain callbacks of that same owner, not a new store. */
export class SkillPublicationImports {
  private active = true
  private cleanupError: unknown
  private reservations = 0
  private readonly starting = new Map<AbortController, Promise<unknown>>()
  private readonly handles = new Map<string, Handle>()
  constructor(private readonly root: string,
    private readonly existing: (input: SkillPublicationAdoptionInput, signal: AbortSignal) => Promise<Readonly<SkillPublicationAdoption> | undefined>,
    private readonly install: (input: SkillPublicationAdoptionInput, path: string, signal: AbortSignal) => Promise<Readonly<SkillPublicationAdoption>>) {}

  begin(input: unknown, requestSignal?: AbortSignal): Promise<SkillPublicationImportStart> {
    const selected = readSkillPublicationAdoptionInput(input)
    if (!this.active || this.cleanupError || this.reservations + this.handles.size >= 2) return Promise.reject(unavailable())
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal,
      AbortSignal.timeout(SKILL_PUBLICATION_EXPORT_TTL_MS), ...(requestSignal ? [requestSignal] : [])])
    this.reservations += 1
    const run = this.start(selected, signal)
    this.starting.set(controller, run)
    void run.finally(() => { this.starting.delete(controller); this.reservations -= 1 }).catch(() => {})
    return run
  }

  private async start(input: SkillPublicationAdoptionInput, signal: AbortSignal): Promise<SkillPublicationImportStart> {
    const check = () => { signal.throwIfAborted(); if (!this.active || this.cleanupError) throw unavailable() }
    check()
    const receipt = await this.existing(input, signal); check()
    if (receipt) return Object.freeze({ kind: 'adopted', receipt: matches(input, receipt) })
    let directory: string | undefined, path: string | undefined, file: FileHandle | undefined, identity: Handle['identity'] | undefined
    let handedOff = false
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 }); check()
      const info = await lstat(this.root)
      if (!info.isDirectory() || await realpath(this.root) !== this.root || info.mode & 0o077) throw unavailable()
      directory = await mkdtemp(join(this.root, 'import-')); path = join(directory, 'package.zip')
      file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
      const created = await file.stat(); identity = { dev: created.dev, ino: created.ino }; check()
      const importId = randomUUID(), controller = new AbortController()
      const handle: Handle = { directory, path, file, identity, input, nextOffset: 0, hash: createHash('sha256'), controller,
        active: true, committing: false, tail: Promise.resolve(), expiresAt: performance.now() + SKILL_PUBLICATION_EXPORT_TTL_MS,
        timer: setTimeout(() => { void this.release({ importId }).catch(error => { this.cleanupError = error }) }, SKILL_PUBLICATION_EXPORT_TTL_MS) }
      handle.timer.unref(); this.handles.set(importId, handle); handedOff = true
      return Object.freeze({ kind: 'ready', importId })
    } finally {
      if (!handedOff) {
        try { await file?.close(); if (path && identity) await this.removeOwnFile(path, identity); if (directory) await rmdir(directory) }
        catch (error) { this.cleanupError = error; throw error }
      }
    }
  }

  private check(handle: Handle, signal?: AbortSignal): void {
    signal?.throwIfAborted(); handle.controller.signal.throwIfAborted()
    if (!this.active || !handle.active || performance.now() >= handle.expiresAt) throw unavailable()
  }

  write(input: unknown, signal?: AbortSignal): Promise<Readonly<{ importId: string; nextOffset: number }>> {
    const selected = readSkillPublicationImportChunk(input), handle = this.handles.get(selected.importId)
    if (!handle?.active || handle.committing) return Promise.reject(unavailable())
    const bytes = Buffer.from(selected.data, 'base64')
    const run = handle.tail.then(async () => {
      this.check(handle, signal)
      if (!handle.file || handle.nextOffset !== selected.offset
        || bytes.length !== Math.min(SKILL_PUBLICATION_CHUNK_BYTES, handle.input.archiveBytes - selected.offset)) throw unavailable()
      const before = await handle.file.stat()
      if (!before.isFile() || before.nlink !== 1 || before.size !== handle.nextOffset) throw unavailable()
      for (let offset = 0; offset < bytes.length;) {
        this.check(handle, signal)
        const written = await handle.file.write(bytes, offset, bytes.length - offset, selected.offset + offset)
        if (written.bytesWritten <= 0) throw unavailable(); offset += written.bytesWritten
      }
      handle.nextOffset += bytes.length; handle.hash.update(bytes); this.check(handle, signal)
      return Object.freeze({ importId: selected.importId, nextOffset: handle.nextOffset })
    })
    handle.tail = run.catch(() => {}); return run
  }

  commit(input: unknown, signal?: AbortSignal): Promise<Readonly<SkillPublicationAdoption>> {
    const { importId } = readSkillPublicationImportId(input), handle = this.handles.get(importId)
    if (!handle?.active || handle.committing) return Promise.reject(unavailable())
    handle.committing = true
    const run = handle.tail.then(async () => {
      const combined = AbortSignal.any([handle.controller.signal, ...(signal ? [signal] : [])])
      this.check(handle, combined)
      if (handle.receipt) {
        const current = await this.existing(handle.input, combined); this.check(handle, combined)
        if (!current) throw unavailable()
        return matches(handle.input, current)
      }
      if (!handle.file || handle.nextOffset !== handle.input.archiveBytes) throw unavailable()
      const info = await handle.file.stat(), pathInfo = await lstat(handle.path)
      if (!info.isFile() || info.nlink !== 1 || info.size !== handle.input.archiveBytes
        || !pathInfo.isFile() || pathInfo.dev !== handle.identity.dev || pathInfo.ino !== handle.identity.ino
        || await realpath(handle.path) !== handle.path) throw unavailable()
      // Re-read the actual file, not only the incoming chunk accumulator.
      const hash = createHash('sha256'), buffer = Buffer.alloc(SKILL_PUBLICATION_CHUNK_BYTES)
      for (let offset = 0; offset < info.size;) {
        this.check(handle, combined)
        const read = await handle.file.read(buffer, 0, Math.min(buffer.length, info.size - offset), offset)
        if (read.bytesRead <= 0) throw unavailable(); hash.update(buffer.subarray(0, read.bytesRead)); offset += read.bytesRead
      }
      if (`sha256:${hash.digest('hex')}` !== handle.input.archiveDigest
        || `sha256:${handle.hash.copy().digest('hex')}` !== handle.input.archiveDigest) throw unavailable()
      const after = await handle.file.stat()
      if (after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || after.nlink !== 1 || after.size !== info.size) throw unavailable()
      await handle.file.close(); delete handle.file; this.check(handle, combined)
      const adopted = readSkillPublicationAdoption(await this.install(handle.input, handle.path, combined))
      handle.receipt = matches(handle.input, adopted)
      this.check(handle, combined); return handle.receipt
    })
    const final = run.finally(() => { handle.committing = false })
    handle.tail = final.catch(() => {}); return final
  }

  private async removeOwnFile(path: string, identity: Handle['identity']): Promise<void> {
    const current = await lstat(path)
    if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) throw unavailable()
    await unlink(path)
  }

  async release(input: unknown): Promise<Readonly<{ importId: string; released: true }>> {
    const selected = readSkillPublicationImportId(input), handle = this.handles.get(selected.importId)
    if (handle) {
      handle.active = false; handle.controller.abort(); clearTimeout(handle.timer)
      handle.release ??= (async () => {
        await handle.tail; await handle.file?.close(); delete handle.file
        await this.removeOwnFile(handle.path, handle.identity); await rmdir(handle.directory); this.handles.delete(selected.importId)
      })()
      try { await handle.release } catch (error) { this.cleanupError = error; throw error }
    }
    return Object.freeze({ importId: selected.importId, released: true })
  }

  async dispose(): Promise<void> {
    this.active = false
    for (const controller of this.starting.keys()) controller.abort()
    await Promise.allSettled(this.starting.values())
    await Promise.all([...this.handles.keys()].map(importId => this.release({ importId })))
    if (this.cleanupError) throw this.cleanupError
  }
}
