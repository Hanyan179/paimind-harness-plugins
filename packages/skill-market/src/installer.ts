import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  PaimindHostRemoteService,
  markPaimindHostRemoteMethods,
} from '@paimind/harness-compat/host'
import type { PaimindHostWebServer } from '@paimind/harness-compat'
import { PAIMIND_SKILL_UPLOAD_PATH } from './catalog.js'
import {
  RECOMMENDED_SKILL_CATALOG,
  recommendedSkillPackage,
  type SkillCatalogSnapshot,
} from './recommended.js'

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/
const UPLOAD_ID = /^[a-f0-9-]{36}$/
const METADATA_SCAN_BYTES = 256 * 1024
const MAX_EXPANSION_RATIO = 1_000
const INSTALL_MANIFEST = '.paimind-install.json'
const CONTROL = /[\u0000-\u001f\u007f]/

function openZip(path: string, options: yauzl.Options): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, options, (error, zip) => {
      if (error !== null) reject(error)
      else if (zip === undefined) reject(new Error('无法打开压缩包'))
      else resolveZip(zip)
    })
  })
}

export interface SkillPackageMetadata {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
}

export interface SkillUploadPreview extends SkillPackageMetadata {
  readonly uploadId: string
  readonly digest: string
  readonly fileName: string
  readonly kind: 'zip' | 'skill-md'
  readonly fileCount: number
  readonly compressedBytes: number
  readonly expandedBytes: number
  readonly operation: 'install' | 'update'
  readonly warnings: readonly string[]
}

export interface SkillInstallRecord extends SkillPackageMetadata {
  readonly skillId: string
  readonly digest: string
  readonly sourceFileName: string
  readonly installedAt: number
  readonly updatedAt: number
  readonly managed: boolean
}

export interface SkillInstallResult {
  readonly operation: 'installed' | 'updated'
  readonly record: Readonly<SkillInstallRecord>
}

export interface SkillRemovalRecord {
  readonly skillId: string
  readonly removedAt: number
  readonly recoverable: boolean
}

export interface SkillInstallerSnapshot {
  readonly items: readonly Readonly<SkillInstallRecord>[]
}

interface UploadRecord {
  readonly uploadId: string
  readonly fileName: string
  readonly path: string
  readonly digest: string
  readonly compressedBytes: number
  preview?: SkillUploadPreview
  archive?: ArchiveInspection
}

interface ArchiveEntryInfo {
  readonly entry: Entry
  readonly path: string
  readonly relativePath: string
  readonly directory: boolean
}

interface ArchiveInspection {
  readonly metadata: SkillPackageMetadata
  readonly rootPrefix: string
  readonly entries: readonly ArchiveEntryInfo[]
  readonly fileCount: number
  readonly expandedBytes: number
  readonly warnings: readonly string[]
}

interface InstallManifest extends SkillInstallRecord {
  readonly schemaVersion: 1
}

export interface SkillInstallerOptions {
  readonly skillRoot?: string
  readonly stateRoot?: string
  readonly now?: () => number
}

export interface SkillInstallerHostContext {
  readonly webServer: PaimindHostWebServer
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function decodeUploadFileName(value: string | string[] | undefined): string {
  if (typeof value !== 'string') throw new Error('缺少上传文件名')
  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { throw new Error('上传文件名无效') }
  const name = basename(decoded.trim())
  if (name === '' || name !== decoded.trim() || CONTROL.test(name)) throw new Error('上传文件名无效')
  const extension = extname(name).toLocaleLowerCase()
  if (extension !== '.zip' && extension !== '.md') throw new Error('仅支持 .zip 或 SKILL.md')
  return name
}

function safeArchivePath(raw: string): string {
  if (raw === '' || raw.includes('\\') || CONTROL.test(raw) || isAbsolute(raw)) {
    throw new Error(`压缩包包含不安全路径：${raw || '(empty)'}`)
  }
  const normalized = normalize(raw).split(sep).join('/')
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`压缩包包含路径穿越：${raw}`)
  }
  return normalized.replace(/^\.\//, '')
}

/** Public validation seam used by installer security tests. */
export const validateSkillArchivePath = safeArchivePath

function contained(root: string, target: string): boolean {
  const candidate = relative(resolve(root), resolve(target))
  return candidate === '' || (!candidate.startsWith(`..${sep}`) && candidate !== '..' && !isAbsolute(candidate))
}

function ignoredArchivePath(path: string): boolean {
  return path === '__MACOSX' || path.startsWith('__MACOSX/') || basename(path) === '.DS_Store'
}

function zipUnixMode(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff
}

function isSymlink(entry: Entry): boolean {
  return (zipUnixMode(entry) & 0o170000) === 0o120000
}

function parseScalar(raw: string): string {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim()
  }
  return value
}

/** Parse only the small standard Skill frontmatter contract; content remains Harness-owned. */
export function parseSkillMetadata(source: string): SkillPackageMetadata {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) throw new Error('SKILL.md 缺少 YAML frontmatter')
  const end = normalized.indexOf('\n---', 4)
  if (end < 0 || end > METADATA_SCAN_BYTES) throw new Error('SKILL.md frontmatter 无效或过长')
  const fields = new Map<string, string>()
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (match !== null) fields.set(match[1]!.toLocaleLowerCase(), parseScalar(match[2]!))
  }
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  const whenToUse = fields.get('when-to-use') ?? fields.get('when_to_use')
  if (!SKILL_NAME.test(name)) throw new Error('Skill name 必须使用小写字母、数字和连字符')
  if (description === '' || description.length > 1_000 || CONTROL.test(description)) {
    throw new Error('Skill description 缺失或无效')
  }
  return Object.freeze({ name, description, ...(whenToUse === undefined || whenToUse === '' ? {} : { whenToUse }) })
}

async function readPrefix(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(METADATA_SCAN_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await handle.close() }
}

async function readZipEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  if (entry.uncompressedSize > METADATA_SCAN_BYTES) throw new Error('SKILL.md frontmatter 文件过大')
  const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, reject) => {
    zip.openReadStream(entry, (error, value) => {
      if (error !== null) reject(error)
      else if (value === undefined) reject(new Error('无法读取 SKILL.md'))
      else resolveStream(value)
    })
  })
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += value.length
    if (total > METADATA_SCAN_BYTES) throw new Error('SKILL.md frontmatter 文件过大')
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function inspectZip(path: string): Promise<ArchiveInspection> {
  const zip = await openZip(path, { lazyEntries: true, validateEntrySizes: true, autoClose: false })
  const rows: { entry: Entry; path: string; directory: boolean }[] = []
  const skillFiles: { entry: Entry; path: string }[] = []
  let expandedBytes = 0
  let compressedBytes = 0
  const warnings = new Set<string>()
  try {
    await new Promise<void>((resolveEntries, reject) => {
      const fail = (error: Error): void => { reject(error) }
      zip.once('error', fail)
      zip.on('entry', (entry: Entry) => {
        try {
          const entryPath = safeArchivePath(entry.fileName)
          if (ignoredArchivePath(entryPath)) { zip.readEntry(); return }
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error('不支持加密压缩包')
          if (isSymlink(entry)) throw new Error(`压缩包包含符号链接：${entryPath}`)
          const directory = /\/$/.test(entry.fileName)
          if (!directory) {
            expandedBytes += entry.uncompressedSize
            compressedBytes += entry.compressedSize
            if (entry.compressedSize === 0 && entry.uncompressedSize > 0) throw new Error(`压缩比异常：${entryPath}`)
            if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_EXPANSION_RATIO) {
              throw new Error(`压缩比异常：${entryPath}`)
            }
            if (basename(entryPath).toLocaleLowerCase() === 'skill.md') skillFiles.push({ entry, path: entryPath })
            if (entryPath.split('/').includes('scripts')) warnings.add('包含脚本文件；安装过程不会执行脚本')
            if ((zipUnixMode(entry) & 0o111) !== 0) warnings.add('包含可执行文件；请确认来源可信')
          }
          rows.push({ entry, path: entryPath, directory })
          zip.readEntry()
        } catch (error) { reject(error) }
      })
      zip.once('end', () => { resolveEntries() })
      zip.readEntry()
    })
    if (skillFiles.length !== 1) throw new Error('压缩包必须且只能包含一个 SKILL.md')
    if (compressedBytes > 0 && expandedBytes / compressedBytes > MAX_EXPANSION_RATIO) {
      throw new Error('压缩包总体压缩比异常')
    }
    const skillFile = skillFiles[0]!
    const rootPrefix = dirname(skillFile.path) === '.' ? '' : `${dirname(skillFile.path)}/`
    const outside = rows.find(row => !row.path.startsWith(rootPrefix))
    if (outside !== undefined) throw new Error(`压缩包包含 Skill 目录之外的文件：${outside.path}`)
    const metadata = parseSkillMetadata((await readZipEntry(zip, skillFile.entry)).toString('utf8'))
    const entries = rows.map(row => Object.freeze({
      ...row,
      relativePath: row.path.slice(rootPrefix.length),
    }))
    return Object.freeze({
      metadata,
      rootPrefix,
      entries,
      fileCount: entries.filter(row => !row.directory).length,
      expandedBytes,
      warnings: Object.freeze([...warnings]),
    })
  } finally { zip.close() }
}

async function ensureDiskCapacity(path: string, expandedBytes: number): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await statfs(path)
  const free = Number(info.bavail) * Number(info.bsize)
  if (expandedBytes > free * 0.8) throw new Error('临时磁盘空间不足，无法安全解压')
}

async function extractZip(path: string, inspection: ArchiveInspection, targetRoot: string): Promise<void> {
  await ensureDiskCapacity(targetRoot, inspection.expandedBytes)
  const zip = await openZip(path, { lazyEntries: true, validateEntrySizes: true, autoClose: false })
  const byPath = new Map(inspection.entries.map(row => [row.path, row]))
  try {
    await new Promise<void>((resolveEntries, reject) => {
      let active = false
      const fail = (error: unknown): void => { reject(error) }
      zip.once('error', fail)
      zip.on('entry', (entry: Entry) => {
        if (active) { reject(new Error('压缩包读取状态无效')); return }
        active = true
        void (async () => {
          const entryPath = safeArchivePath(entry.fileName)
          const row = byPath.get(entryPath)
          if (row === undefined) { active = false; zip.readEntry(); return }
          if (isSymlink(entry)) throw new Error(`压缩包包含符号链接：${entryPath}`)
          const destination = resolve(targetRoot, row.relativePath)
          if (!contained(targetRoot, destination)) throw new Error(`压缩包路径越界：${entryPath}`)
          if (row.directory) await mkdir(destination, { recursive: true, mode: 0o700 })
          else {
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
            const input = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => {
              zip.openReadStream(entry, (error, stream) => {
                if (error !== null) rejectStream(error)
                else if (stream === undefined) rejectStream(new Error(`无法读取：${entryPath}`))
                else resolveStream(stream)
              })
            })
            await pipeline(input, createWriteStream(destination, { mode: (zipUnixMode(entry) & 0o111) === 0 ? 0o600 : 0o700 }))
          }
          active = false
          zip.readEntry()
        })().catch(fail)
      })
      zip.once('end', () => { if (!active) resolveEntries(); else reject(new Error('压缩包提前结束')) })
      zip.readEntry()
    })
  } finally { zip.close() }
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return `sha256:${hash.digest('hex')}`
}

function installManifest(record: SkillInstallRecord): InstallManifest {
  return Object.freeze({ schemaVersion: 1, ...record })
}

async function readInstallManifest(path: string): Promise<SkillInstallRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<InstallManifest>
    if (value.schemaVersion !== 1 || typeof value.skillId !== 'string' || !SKILL_NAME.test(value.skillId)
      || typeof value.digest !== 'string' || typeof value.installedAt !== 'number' || typeof value.updatedAt !== 'number'
      || typeof value.sourceFileName !== 'string' || typeof value.name !== 'string' || typeof value.description !== 'string') return undefined
    return Object.freeze({
      skillId: value.skillId, name: value.name, description: value.description,
      ...(typeof value.whenToUse === 'string' ? { whenToUse: value.whenToUse } : {}),
      digest: value.digest, sourceFileName: value.sourceFileName,
      installedAt: value.installedAt, updatedAt: value.updatedAt, managed: true,
    })
  } catch { return undefined }
}

/** Host-owned installer. Harness remains the only runtime Skill registry. */
export class PaimindSkillInstallerService extends PaimindHostRemoteService {
  static inject = ['webServer']
  private readonly skillRoot: string
  private readonly stateRoot: string
  private readonly uploadRoot: string
  private readonly stagingRoot: string
  private readonly backupRoot: string
  private readonly now: () => number
  private readonly uploads = new Map<string, UploadRecord>()

  constructor(private readonly installerCtx: SkillInstallerHostContext, options: SkillInstallerOptions = {}) {
    super(installerCtx, 'paimindSkillInstaller')
    this.skillRoot = resolve(options.skillRoot ?? dshHomePath('skills'))
    this.stateRoot = resolve(options.stateRoot ?? dshHomePath('.paimind-skill-installer'))
    this.uploadRoot = join(this.stateRoot, 'uploads')
    this.stagingRoot = join(this.stateRoot, 'staging')
    this.backupRoot = join(this.stateRoot, 'backups')
    this.now = options.now ?? Date.now
    markPaimindHostRemoteMethods(this, ['listCatalog', 'inspectCatalog', 'inspectUpload', 'installUpload', 'listInstalled', 'uninstall'])
    installerCtx.effect(() => installerCtx.webServer.register({
      kind: 'prefix', path: PAIMIND_SKILL_UPLOAD_PATH,
      handler: async (request, response) => { await this.handleUpload(request, response) },
    }), 'paimind-skill-market: upload route')
  }

  async handleUpload(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.headers['x-paimind-upload'] !== '1') throw new Error('上传请求缺少安全标记')
      const url = new URL(request.url ?? '/', 'http://paimind.invalid')
      if (request.method === 'POST' && url.pathname === PAIMIND_SKILL_UPLOAD_PATH) {
        const value = await this.receiveUpload(request)
        json(response, 201, value)
        return
      }
      const cancel = url.pathname.match(/^\/paimind\/skills\/uploads\/([a-f0-9-]{36})$/)
      if (request.method === 'DELETE' && cancel !== null) {
        await this.cancelUpload(cancel[1]!)
        response.writeHead(204, { 'cache-control': 'no-store' }); response.end(); return
      }
      json(response, 404, { error: { code: 'not_found', message: '上传接口不存在' } })
    } catch (error) {
      json(response, 400, { error: { code: 'invalid_upload', message: failureMessage(error) } })
    }
  }

  private async receiveUpload(request: IncomingMessage): Promise<{ uploadId: string; digest: string }> {
    const fileName = decodeUploadFileName(request.headers['x-paimind-file-name'])
    await mkdir(this.uploadRoot, { recursive: true, mode: 0o700 })
    const uploadId = randomUUID()
    const path = join(this.uploadRoot, uploadId)
    const hash = createHash('sha256')
    let compressedBytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        compressedBytes += chunk.length
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(request, meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
      if (compressedBytes === 0) throw new Error('上传文件为空')
      const digest = `sha256:${hash.digest('hex')}`
      this.uploads.set(uploadId, { uploadId, fileName, path, digest, compressedBytes })
      return { uploadId, digest }
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
  }

  private async cancelUpload(uploadId: string): Promise<void> {
    if (!UPLOAD_ID.test(uploadId)) return
    const upload = this.uploads.get(uploadId)
    this.uploads.delete(uploadId)
    if (upload !== undefined) await rm(upload.path, { force: true })
  }

  async listCatalog(): Promise<Readonly<SkillCatalogSnapshot>> {
    return Object.freeze({ items: RECOMMENDED_SKILL_CATALOG })
  }

  async inspectCatalog(input: { readonly catalogId: string; readonly version: string }): Promise<Readonly<SkillUploadPreview>> {
    const source = recommendedSkillPackage(input)
    await mkdir(this.uploadRoot, { recursive: true, mode: 0o700 })
    const uploadId = randomUUID()
    const path = join(this.uploadRoot, uploadId)
    await writeFile(path, source.archive, { flag: 'wx', mode: 0o600 })
    this.uploads.set(uploadId, {
      uploadId, fileName: source.fileName, path,
      digest: source.item.digest, compressedBytes: source.archive.byteLength,
    })
    try { return await this.inspectUpload({ uploadId }) }
    catch (error) { await this.cancelUpload(uploadId); throw error }
  }

  async inspectUpload(input: { readonly uploadId: string }): Promise<Readonly<SkillUploadPreview>> {
    const upload = this.upload(input.uploadId)
    if (upload.preview !== undefined) return upload.preview
    const extension = extname(upload.fileName).toLocaleLowerCase()
    let metadata: SkillPackageMetadata
    let fileCount: number
    let expandedBytes: number
    let warnings: readonly string[]
    if (extension === '.zip') {
      const inspection = await inspectZip(upload.path)
      upload.archive = inspection
      metadata = inspection.metadata
      fileCount = inspection.fileCount
      expandedBytes = inspection.expandedBytes
      warnings = inspection.warnings
    } else {
      metadata = parseSkillMetadata(await readPrefix(upload.path))
      fileCount = 1
      expandedBytes = (await stat(upload.path)).size
      warnings = Object.freeze([])
    }
    await ensureDiskCapacity(this.stateRoot, expandedBytes)
    const operation = await pathExists(join(this.skillRoot, metadata.name)) ? 'update' : 'install'
    const preview = Object.freeze({
      uploadId: upload.uploadId, digest: upload.digest, fileName: upload.fileName,
      kind: extension === '.zip' ? 'zip' as const : 'skill-md' as const,
      ...metadata, fileCount, compressedBytes: upload.compressedBytes, expandedBytes,
      operation, warnings,
    })
    upload.preview = preview
    return preview
  }

  async installUpload(input: { readonly uploadId: string; readonly digest: string }): Promise<Readonly<SkillInstallResult>> {
    const upload = this.upload(input.uploadId)
    if (upload.digest !== input.digest) throw new Error('上传摘要不匹配，请重新上传')
    const preview = await this.inspectUpload({ uploadId: input.uploadId })
    const staging = join(this.stagingRoot, `${preview.name}-${randomUUID()}`)
    const destination = join(this.skillRoot, preview.name)
    const backup = join(this.backupRoot, `${preview.name}-${this.now()}-${randomUUID()}`)
    if (!contained(this.skillRoot, destination)) throw new Error('Skill 安装目标越界')
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
    await mkdir(staging, { recursive: true, mode: 0o700 })
    let previous: SkillInstallRecord | undefined
    let movedPrevious = false
    try {
      if (preview.kind === 'zip') {
        if (upload.archive === undefined) throw new Error('压缩包尚未完成检查')
        await extractZip(upload.path, upload.archive, staging)
      } else await copyFile(upload.path, join(staging, 'SKILL.md'))
      const checked = parseSkillMetadata(await readPrefix(join(staging, 'SKILL.md')))
      if (checked.name !== preview.name) throw new Error('安装内容与检查结果不一致')
      await mkdir(this.skillRoot, { recursive: true, mode: 0o700 })
      if (await pathExists(destination)) {
        previous = await readInstallManifest(join(destination, INSTALL_MANIFEST))
        await rename(destination, backup)
        movedPrevious = true
      }
      const now = this.now()
      const record: SkillInstallRecord = Object.freeze({
        skillId: preview.name, name: preview.name, description: preview.description,
        ...(preview.whenToUse === undefined ? {} : { whenToUse: preview.whenToUse }),
        digest: preview.digest, sourceFileName: preview.fileName,
        installedAt: previous?.installedAt ?? now, updatedAt: now, managed: true,
      })
      await writeFile(join(staging, INSTALL_MANIFEST), `${JSON.stringify(installManifest(record), null, 2)}\n`, { mode: 0o600 })
      await rename(staging, destination)
      await this.cancelUpload(upload.uploadId)
      return Object.freeze({ operation: preview.operation === 'install' ? 'installed' : 'updated', record })
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      if (movedPrevious && !(await pathExists(destination))) await rename(backup, destination)
      throw error
    }
  }

  async listInstalled(): Promise<Readonly<SkillInstallerSnapshot>> {
    let entries
    try { entries = await readdir(this.skillRoot, { withFileTypes: true }) } catch { return Object.freeze({ items: Object.freeze([]) }) }
    const items: SkillInstallRecord[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !SKILL_NAME.test(entry.name)) continue
      const root = join(this.skillRoot, entry.name)
      if (!(await pathExists(join(root, 'SKILL.md')))) continue
      const managed = await readInstallManifest(join(root, INSTALL_MANIFEST))
      if (managed !== undefined) { items.push(managed); continue }
      try {
        const metadata = parseSkillMetadata(await readPrefix(join(root, 'SKILL.md')))
        const info = await stat(join(root, 'SKILL.md'))
        items.push(Object.freeze({
          skillId: entry.name, name: metadata.name, description: metadata.description,
          ...(metadata.whenToUse === undefined ? {} : { whenToUse: metadata.whenToUse }),
          digest: await digestFile(join(root, 'SKILL.md')), sourceFileName: 'SKILL.md',
          installedAt: info.birthtimeMs, updatedAt: info.mtimeMs, managed: false,
        }))
      } catch { /* invalid folders remain Harness-owned and are omitted from the business list */ }
    }
    return Object.freeze({ items: Object.freeze(items.sort((left, right) => left.name.localeCompare(right.name))) })
  }

  async uninstall(input: { readonly skillId: string; readonly version?: string }): Promise<Readonly<SkillRemovalRecord>> {
    if (!SKILL_NAME.test(input.skillId)) throw new Error('Skill 名称无效')
    const source = join(this.skillRoot, input.skillId)
    if (!contained(this.skillRoot, source) || !(await pathExists(source))) throw new Error('Skill 不存在')
    const manifest = await readInstallManifest(join(source, INSTALL_MANIFEST))
    if (manifest === undefined) throw new Error('只能从技能市场卸载由 PAIMind 安装的 Skill')
    if (input.version !== undefined && manifest.digest !== input.version) throw new Error('Skill 已更新，请刷新后重试')
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
    const removedAt = this.now()
    await rename(source, join(this.backupRoot, `${input.skillId}-${removedAt}-${randomUUID()}`))
    return Object.freeze({ skillId: input.skillId, removedAt, recoverable: true })
  }

  private upload(uploadId: string): UploadRecord {
    if (!UPLOAD_ID.test(uploadId)) throw new Error('上传标识无效')
    const upload = this.uploads.get(uploadId)
    if (upload === undefined) throw new Error('上传已失效，请重新选择文件')
    return upload
  }
}
