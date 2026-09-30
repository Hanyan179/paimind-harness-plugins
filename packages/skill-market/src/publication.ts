import { createHash } from 'node:crypto'

/** Complete packages use bounded chunks, never a larger native control frame. */
export const SKILL_PUBLICATION_CHUNK_BYTES = 96 * 1024
export const SKILL_PUBLICATION_MAX_EXPANDED_BYTES = 200 * 1024 * 1024
export const SKILL_PUBLICATION_MAX_ARCHIVE_BYTES = 216 * 1024 * 1024
export const SKILL_PUBLICATION_MAX_ENTRIES = 10_000
export const SKILL_PUBLICATION_EXPORT_TTL_MS = 5 * 60 * 1000
export interface SkillPublicationSelection { readonly skillId: string; readonly expectedDigest: string }
export interface SkillPublicationExport {
  readonly schema: 'paimind.skill-export/v1'
  readonly exportId: string
  readonly name: string
  readonly packageDigest: string
  readonly archiveDigest: string
  readonly archiveBytes: number
  readonly expandedBytes: number
  readonly entryCount: number
}
export interface SkillPublicationChunkInput { readonly exportId: string; readonly offset: number }
export interface SkillPublicationChunk extends SkillPublicationChunkInput { readonly data: string; readonly eof: boolean }
export interface SkillPublicationAdoptionInput {
  readonly tenantId: string; readonly publicationId: string; readonly sourceUserId: string;
  readonly name: string; readonly packageDigest: string; readonly archiveDigest: string;
  readonly archiveBytes: number; readonly expandedBytes: number; readonly entryCount: number
}
export interface SkillPublicationAdoption extends SkillPublicationAdoptionInput {
  readonly schema: 'paimind.skill-adoption/v1'; readonly adoptedAt: number
}
export interface SkillPublicationImportChunk { readonly importId: string; readonly offset: number; readonly data: string }
export type SkillPublicationImportStart = Readonly<{ kind: 'ready'; importId: string } | { kind: 'adopted'; receipt: SkillPublicationAdoption }>
export interface SkillPublicationTransfer {
  begin(input: SkillPublicationSelection, signal: AbortSignal): Promise<unknown>
  read(input: SkillPublicationChunkInput, signal: AbortSignal): Promise<unknown>
  release(input: { readonly exportId: string }, signal: AbortSignal): Promise<unknown>
}
export interface SkillPublicationAdoptionTransfer {
  begin(input: SkillPublicationAdoptionInput, signal: AbortSignal): Promise<unknown>
  write(input: SkillPublicationImportChunk, signal: AbortSignal): Promise<unknown>
  commit(input: { readonly importId: string }, signal: AbortSignal): Promise<unknown>
  release(input: { readonly importId: string }, signal: AbortSignal): Promise<unknown>
}
const invalid = () => new Error('Skill 发布内容或传输记录无效')
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw invalid()
  return value as Record<string, unknown>
}
function integer(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= low && value <= high
}
export function readSkillPublicationSelection(value: unknown): Readonly<SkillPublicationSelection> {
  const row = fields(value, ['skillId', 'expectedDigest'])
  if (typeof row.skillId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,254}$/u.test(row.skillId) || !digest(row.expectedDigest)) throw invalid()
  return Object.freeze({ skillId: row.skillId, expectedDigest: row.expectedDigest })
}
export function readSkillPublicationExport(value: unknown): Readonly<SkillPublicationExport> {
  const row = fields(value, ['schema', 'exportId', 'name', 'packageDigest', 'archiveDigest', 'archiveBytes', 'expandedBytes', 'entryCount'])
  if (row.schema !== 'paimind.skill-export/v1' || !id(row.exportId) || !digest(row.archiveDigest)
    || !integer(row.archiveBytes, 1, SKILL_PUBLICATION_MAX_ARCHIVE_BYTES)
    || !integer(row.expandedBytes, 1, SKILL_PUBLICATION_MAX_EXPANDED_BYTES)
    || !integer(row.entryCount, 1, SKILL_PUBLICATION_MAX_ENTRIES)) throw invalid()
  const selected = readSkillPublicationSelection({ skillId: row.name, expectedDigest: row.packageDigest })
  return Object.freeze({ schema: row.schema, exportId: row.exportId, name: selected.skillId,
    packageDigest: selected.expectedDigest, archiveDigest: row.archiveDigest, archiveBytes: row.archiveBytes,
    expandedBytes: row.expandedBytes, entryCount: row.entryCount })
}
export function readSkillPublicationReleaseInput(value: unknown): Readonly<{ exportId: string }> {
  const row = fields(value, ['exportId']); if (!id(row.exportId)) throw invalid()
  return Object.freeze({ exportId: row.exportId })
}

/** Trusted control-plane provenance, never a grant or a caller-selected path. */
export function readSkillPublicationAdoptionInput(value: unknown): Readonly<SkillPublicationAdoptionInput> {
  const row = fields(value, ['tenantId', 'publicationId', 'sourceUserId', 'name', 'packageDigest', 'archiveDigest', 'archiveBytes', 'expandedBytes', 'entryCount'])
  if (typeof row.tenantId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(row.tenantId)
    || !id(row.publicationId) || !id(row.sourceUserId)) throw invalid()
  const archive = readSkillPublicationExport({ schema: 'paimind.skill-export/v1', exportId: row.publicationId,
    name: row.name, packageDigest: row.packageDigest, archiveDigest: row.archiveDigest,
    archiveBytes: row.archiveBytes, expandedBytes: row.expandedBytes, entryCount: row.entryCount })
  return Object.freeze({ tenantId: row.tenantId, publicationId: row.publicationId, sourceUserId: row.sourceUserId,
    name: archive.name, packageDigest: archive.packageDigest, archiveDigest: archive.archiveDigest,
    archiveBytes: archive.archiveBytes, expandedBytes: archive.expandedBytes, entryCount: archive.entryCount })
}
export function readSkillPublicationAdoption(value: unknown): Readonly<SkillPublicationAdoption> {
  const row = fields(value, ['schema', 'adoptedAt', 'tenantId', 'publicationId', 'sourceUserId', 'name', 'packageDigest', 'archiveDigest', 'archiveBytes', 'expandedBytes', 'entryCount'])
  if (row.schema !== 'paimind.skill-adoption/v1' || !integer(row.adoptedAt, 0, Number.MAX_SAFE_INTEGER)) throw invalid()
  const { schema, adoptedAt, ...input } = row
  return Object.freeze({ ...readSkillPublicationAdoptionInput(input), schema, adoptedAt })
}
export function readSkillPublicationImportId(value: unknown): Readonly<{ importId: string }> {
  const row = fields(value, ['importId']); if (!id(row.importId)) throw invalid()
  return Object.freeze({ importId: row.importId })
}
export function readSkillPublicationImportChunk(value: unknown): Readonly<SkillPublicationImportChunk> {
  const row = fields(value, ['importId', 'offset', 'data'])
  if (!id(row.importId) || !integer(row.offset, 0, SKILL_PUBLICATION_MAX_ARCHIVE_BYTES - 1)
    || row.offset % SKILL_PUBLICATION_CHUNK_BYTES !== 0 || typeof row.data !== 'string'
    || row.data.length < 4 || row.data.length > 4 * Math.ceil(SKILL_PUBLICATION_CHUNK_BYTES / 3)) throw invalid()
  const bytes = Buffer.from(row.data, 'base64')
  if (bytes.length < 1 || bytes.length > SKILL_PUBLICATION_CHUNK_BYTES || bytes.toString('base64') !== row.data) throw invalid()
  return Object.freeze({ importId: row.importId, offset: row.offset, data: row.data })
}
export function readSkillPublicationChunkInput(value: unknown): Readonly<SkillPublicationChunkInput> {
  const row = fields(value, ['exportId', 'offset'])
  if (!id(row.exportId) || !integer(row.offset, 0, SKILL_PUBLICATION_MAX_ARCHIVE_BYTES - 1)
    || row.offset % SKILL_PUBLICATION_CHUNK_BYTES !== 0) throw invalid()
  return Object.freeze({ exportId: row.exportId, offset: row.offset })
}
export function readSkillPublicationChunk(value: unknown, descriptor: SkillPublicationExport, offset: number): Buffer {
  const row = fields(value, ['exportId', 'offset', 'data', 'eof'])
  const size = Math.min(SKILL_PUBLICATION_CHUNK_BYTES, descriptor.archiveBytes - offset)
  if (row.exportId !== descriptor.exportId || row.offset !== offset || size <= 0
    || typeof row.data !== 'string' || row.data.length !== 4 * Math.ceil(size / 3)
    || row.eof !== (offset + size === descriptor.archiveBytes)) throw invalid()
  const bytes = Buffer.from(row.data, 'base64')
  if (bytes.length !== size || bytes.toString('base64') !== row.data) throw invalid()
  return bytes
}

/** The sink is private staging, NOT an approved artifact or native installation.
 * Callers commit only after this returns and their own current-authority check.
 * Cancellation/failed hashes may leave partial staging for its owner to discard. */
export async function transferSkillPublication(selection: SkillPublicationSelection, transport: SkillPublicationTransfer,
  sink: (bytes: Buffer, offset: number, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<Readonly<SkillPublicationExport>> {
  const selected = readSkillPublicationSelection(selection)
  signal.throwIfAborted()
  const descriptor = readSkillPublicationExport(await transport.begin(selected, signal))
  try {
    signal.throwIfAborted()
    if (descriptor.name !== selected.skillId || descriptor.packageDigest !== selected.expectedDigest) throw invalid()
    const hash = createHash('sha256')
    for (let offset = 0; offset < descriptor.archiveBytes; offset += SKILL_PUBLICATION_CHUNK_BYTES) {
      signal.throwIfAborted()
      const bytes = readSkillPublicationChunk(await transport.read({ exportId: descriptor.exportId, offset }, signal), descriptor, offset)
      signal.throwIfAborted(); hash.update(bytes)
      await sink(bytes, offset, signal); signal.throwIfAborted()
    }
    if (`sha256:${hash.digest('hex')}` !== descriptor.archiveDigest) throw invalid()
    return descriptor
  } finally {
    // Cancellation of a transfer must not suppress cleanup of an already issued
    // handle. The private transport still independently bounds this request.
    const released = fields(await transport.release({ exportId: descriptor.exportId }, AbortSignal.timeout(4000)), ['exportId', 'released'])
    if (released.exportId !== descriptor.exportId || released.released !== true) throw invalid()
  }
}

/** Exact private delivery from a currently authorized immutable archive. The
 * caller owns current governance checks; the target owner validates its bytes.
 * Neither a returned receipt nor replay constitutes an execution permission. */
export async function transferSkillPublicationAdoption(input: SkillPublicationAdoptionInput, transport: SkillPublicationAdoptionTransfer,
  readChunk: (offset: number, signal: AbortSignal) => Promise<Buffer>, signal: AbortSignal): Promise<Readonly<SkillPublicationAdoption>> {
  const selected = readSkillPublicationAdoptionInput(input)
  const match = (value: unknown) => {
    const receipt = readSkillPublicationAdoption(value), { schema: _schema, adoptedAt: _at, ...origin } = receipt
    if (JSON.stringify(origin) !== JSON.stringify(selected)) throw invalid()
    return receipt
  }
  signal.throwIfAborted()
  const first = await transport.begin(selected, signal)
  if (first !== null && typeof first === 'object' && 'kind' in first && first.kind === 'adopted') {
    const row = fields(first, ['kind', 'receipt']); signal.throwIfAborted(); return match(row.receipt)
  }
  const ready = fields(first, ['kind', 'importId'])
  if (ready.kind !== 'ready' || !id(ready.importId)) throw invalid()
  const importId = ready.importId
  try {
    const hash = createHash('sha256')
    for (let offset = 0; offset < selected.archiveBytes; offset += SKILL_PUBLICATION_CHUNK_BYTES) {
      signal.throwIfAborted()
      const bytes = await readChunk(offset, signal)
      if (!Buffer.isBuffer(bytes) || bytes.length !== Math.min(SKILL_PUBLICATION_CHUNK_BYTES, selected.archiveBytes - offset)) throw invalid()
      signal.throwIfAborted(); hash.update(bytes)
      const ack = fields(await transport.write({ importId, offset, data: bytes.toString('base64') }, signal), ['importId', 'nextOffset'])
      if (ack.importId !== importId || ack.nextOffset !== offset + bytes.length) throw invalid()
    }
    if (`sha256:${hash.digest('hex')}` !== selected.archiveDigest) throw invalid()
    signal.throwIfAborted()
    const receipt = match(await transport.commit({ importId }, signal)); signal.throwIfAborted()
    return receipt
  } finally {
    const released = fields(await transport.release({ importId }, AbortSignal.timeout(4000)), ['importId', 'released'])
    if (released.importId !== importId || released.released !== true) throw invalid()
  }
}
