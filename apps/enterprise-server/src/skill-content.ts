import { Readable } from 'node:stream'
import { fromRandomAccessReaderPromise, RandomAccessReader, type Entry } from 'yauzl'
import { SKILL_PUBLICATION_CHUNK_BYTES, SKILL_PUBLICATION_MAX_ARCHIVE_BYTES,
  SKILL_PUBLICATION_MAX_ENTRIES, SKILL_PUBLICATION_MAX_EXPANDED_BYTES } from '@paimind/skill-market/publication'
import { EnterpriseError } from './errors.js'

export const SKILL_CONTENT_PAGE_BYTES = 32 * 1024
export const SKILL_CONTENT_PAGE_ENTRIES = 100
export type SkillContentSelection = { kind: 'entries'; cursor: number } | { kind: 'file'; index: number; offset: number }
type Archive = { archiveBytes: number; expandedBytes: number; entryCount: number }
export type SkillContentEntry = { index: number; path: string; kind: 'file' | 'directory'; size: number }
const invalid = () => new EnterpriseError(409, 'skill-content-invalid', '封存技能内容不可完整读取；未执行或修改任何文件')
const integer = (value: number, max: number) => Number.isSafeInteger(value) && value >= 0 && value <= max

/** Reads only immutable control-plane bytes. The caller reauthorizes every
 * chunk and the final response. No extraction, filesystem access or registry.
 * Source-owner exports are stored ZIP entries, not arbitrary uploaded ZIPs. */
class ArchiveReader extends RandomAccessReader {
  private cached?: { offset: number; bytes: Buffer }
  constructor(private readonly size: number, private readonly chunk: (offset: number) => Promise<Buffer>, private readonly signal: AbortSignal) { super() }
  _readStreamForRange(start: number, end: number): Readable {
    const self = this
    return Readable.from((async function* () {
      if (!integer(start, self.size) || !integer(end, self.size) || end < start) throw invalid()
      for (let position = start; position < end;) {
        self.signal.throwIfAborted()
        const offset = Math.floor(position / SKILL_PUBLICATION_CHUNK_BYTES) * SKILL_PUBLICATION_CHUNK_BYTES
        if (self.cached?.offset !== offset) {
          const bytes = await new Promise<Buffer>((resolve, reject) => {
            const cancelled = () => { self.signal.removeEventListener('abort', cancelled); reject(self.signal.reason ?? invalid()) }
            self.signal.addEventListener('abort', cancelled, { once: true })
            if (self.signal.aborted) { cancelled(); return }
            Promise.resolve().then(() => self.chunk(offset)).then(value => {
              self.signal.removeEventListener('abort', cancelled); resolve(value)
            }, error => { self.signal.removeEventListener('abort', cancelled); reject(error) })
          }); self.signal.throwIfAborted()
          if (!Buffer.isBuffer(bytes) || bytes.length !== Math.min(SKILL_PUBLICATION_CHUNK_BYTES, self.size - offset)) throw invalid()
          self.cached = { offset, bytes }
        }
        const length = Math.min(end - position, self.cached.bytes.length - (position - offset))
        yield self.cached.bytes.subarray(position - offset, position - offset + length)
        position += length
      }
    })())
  }
}

export async function readSkillContent(archive: Archive, selected: SkillContentSelection,
  chunk: (offset: number) => Promise<Buffer>, signal: AbortSignal) {
  if (!['entries', 'file'].includes(selected.kind) || !integer(archive.archiveBytes, SKILL_PUBLICATION_MAX_ARCHIVE_BYTES) || !archive.archiveBytes
    || !integer(archive.expandedBytes, SKILL_PUBLICATION_MAX_EXPANDED_BYTES) || !archive.expandedBytes
    || !integer(archive.entryCount, SKILL_PUBLICATION_MAX_ENTRIES) || !archive.entryCount
    || selected.kind === 'entries' && (!integer(selected.cursor, archive.entryCount - 1) || selected.cursor % SKILL_CONTENT_PAGE_ENTRIES !== 0)
    || selected.kind === 'file' && (!integer(selected.index, archive.entryCount - 1)
      || !integer(selected.offset, SKILL_PUBLICATION_MAX_EXPANDED_BYTES) || selected.offset % SKILL_CONTENT_PAGE_BYTES !== 0)) throw invalid()
  signal.throwIfAborted()
  const zip = await fromRandomAccessReaderPromise(new ArchiveReader(archive.archiveBytes, chunk, signal), archive.archiveBytes,
    { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true })
  const rows: SkillContentEntry[] = [], paths = new Map<string, 'file' | 'directory'>()
  let expanded = 0, file: Entry | undefined
  try {
    if (zip.entryCount !== archive.entryCount) throw invalid()
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted()
      const directory = entry.fileName.endsWith('/'), path = directory ? entry.fileName.slice(0, -1) : entry.fileName
      const parts = path.split('/'), mode = entry.externalFileAttributes >>> 16, type = mode & 0o170000
      if (!path || path.length > 500 || /[\\\x00-\x1f\x7f]/u.test(path)
        || parts.some(part => !part || part === '.' || part === '..' || part === '.paimind-install.json')
        || paths.has(path) || rows.length >= archive.entryCount || entry.isEncrypted() || entry.compressionMethod !== 0
        || type !== 0 && type !== (directory ? 0o040000 : 0o100000)
        || !integer(entry.uncompressedSize, SKILL_PUBLICATION_MAX_EXPANDED_BYTES)
        || entry.compressedSize !== entry.uncompressedSize || directory && entry.uncompressedSize !== 0) throw invalid()
      paths.set(path, directory ? 'directory' : 'file'); expanded += entry.uncompressedSize
      if (expanded > archive.expandedBytes) throw invalid()
      const index = rows.length
      rows.push({ index, path, kind: directory ? 'directory' : 'file', size: entry.uncompressedSize })
      if (selected.kind === 'file' && selected.index === index) file = entry
    }
    if (rows.length !== archive.entryCount || expanded !== archive.expandedBytes || paths.get('SKILL.md') !== 'file') throw invalid()
    for (const row of rows) {
      const parts = row.path.split('/')
      for (let i = 1; i < parts.length; i++) if (paths.get(parts.slice(0, i).join('/')) !== 'directory') throw invalid()
    }
    if (selected.kind === 'entries') return { kind: 'entries' as const, cursor: selected.cursor, total: rows.length,
      entries: rows.slice(selected.cursor, selected.cursor + SKILL_CONTENT_PAGE_ENTRIES),
      nextCursor: selected.cursor + SKILL_CONTENT_PAGE_ENTRIES < rows.length ? selected.cursor + SKILL_CONTENT_PAGE_ENTRIES : null }
    const entry = rows[selected.index]!
    if (!file || entry.kind !== 'file' || selected.offset >= entry.size && !(entry.size === 0 && selected.offset === 0)) throw invalid()
    const header = await zip.readLocalFileHeaderPromise(file)
    if (header.fileName.toString('utf8') !== file.fileName || header.compressionMethod !== 0 || (header.generalPurposeBitFlag & 1) !== 0) throw invalid()
    const length = Math.min(SKILL_CONTENT_PAGE_BYTES, entry.size - selected.offset), buffers: Buffer[] = []
    if (length) {
      const stream = await zip.openReadStreamPromise(file, { start: selected.offset, end: selected.offset + length })
      const cancel = () => stream.destroy(new Error('Skill content read cancelled'))
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
      let received = 0
      try {
        for await (const value of stream) {
          signal.throwIfAborted(); const bytes = Buffer.from(value); received += bytes.length
          if (received > length) throw invalid(); buffers.push(bytes)
        }
        if (received !== length) throw invalid()
      } finally { signal.removeEventListener('abort', cancel); stream.destroy() }
    }
    signal.throwIfAborted()
    return { kind: 'file' as const, entry, offset: selected.offset, data: Buffer.concat(buffers).toString('base64'),
      nextOffset: selected.offset + length < entry.size ? selected.offset + length : null }
  } finally { zip.close() }
}
