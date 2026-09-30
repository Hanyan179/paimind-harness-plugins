import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, createWriteStream, readFileSync } from 'node:fs'
import {
  access,
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { isDeepStrictEqual } from 'node:util'
import { Transform } from 'node:stream'
import { SKILL_ADOPTED_CONTENT_BYTES, readSkillAdoptedContentInput, type SkillAdoptedContentInput, type SkillAdoptedContent } from './adopted-content.js'
export type { SkillAdoptedContentInput, SkillAdoptedContent } from './adopted-content.js'
import { readSkillAdoptedPreferenceInput, type SkillAdoptedPreferenceInput, type SkillAdoptedPreferenceResult } from './adopted-preference.js'
export type { SkillAdoptedPreferenceInput, SkillAdoptedPreferenceResult } from './adopted-preference.js'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { parseDocument } from 'yaml'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  PAIMIND_BUSINESS_SKILL_REPOSITORY_DIRECTORY,
  PAIMIND_SKILL_INSPECT_GITHUB_TOOL,
  PAIMIND_SKILL_INSTALL_TOOL,
  PAIMIND_SKILL_NAME_PATTERN,
  PAIMIND_SKILL_PREPARE_CREATE_TOOL,
  PAIMIND_STANDARD_AGENT_BASE_PRESET_ID,
  PAIMIND_SYSTEM_SKILL_NAMES,
  definePaimindSessionBusinessSkillSelection,
  definePaimindSkillReference,
  definePaimindUserSkillPolicy,
  definePaimindWorkspaceCompositionSnapshot,
  type PaimindWorkspaceCompositionSource,
  type PaimindWorkspaceCompositionSnapshotV1,
  type PaimindSystemSkillCatalogSnapshot,
  type PaimindSystemSkillReference,
  type PaimindSessionBusinessSkillSelectionReplaceInput,
  type PaimindSessionBusinessSkillSelectionV1,
  type PaimindUserSkillPolicyReplaceInput,
  type PaimindUserSkillPolicyV1,
} from '@paimind/contracts'
import {
  describePaimindHostLoaderEntry,
  definePaimindHarnessTool,
  installPaimindScopedSkillProjection,
  resolvePaimindLiveAgentPreset,
  PaimindHostRemoteService,
  markPaimindHostRemoteMethods,
  setPaimindHostLoaderEntryEnabled,
  type PaimindHostLoaderFacility,
  type PaimindScopedSkillAgent,
  type PaimindScopedSkillDefinition,
  type PaimindScopedSkillProjection,
  type PaimindHostToolRegistry,
  type PaimindToolRunContext,
} from '@paimind/harness-compat/host'
import type { PaimindHostWebServer } from '@paimind/harness-compat'
import { PAIMIND_SKILL_UPLOAD_PATH } from './catalog.js'
import {
  RECOMMENDED_SKILL_CATALOG,
  recommendedSkillPackage,
  type SkillCatalogSnapshot,
} from './recommended.js'
import { resolvePaimindSkillScope } from './scope.js'
import { SkillPublicationExports, type SkillPublicationSource } from './publication-export.js'
import { SkillPublicationImports } from './publication-import.js'
import { SKILL_PUBLICATION_MAX_ENTRIES, SKILL_PUBLICATION_MAX_EXPANDED_BYTES,
  readSkillPublicationAdoption, readSkillPublicationAdoptionInput,
  type SkillPublicationSelection, type SkillPublicationExport, type SkillPublicationChunk,
  type SkillPublicationAdoption, type SkillPublicationAdoptionInput, type SkillPublicationImportStart,
  type SkillPublicationImportChunk } from './publication.js'

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/
const UPLOAD_ID = /^[a-f0-9-]{36}$/
const METADATA_SCAN_BYTES = 256 * 1024
const MAX_EXPANSION_RATIO = 1_000
const MAX_REMOTE_ARCHIVE_BYTES = 20 * 1024 * 1024
const MAX_REMOTE_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_PACKAGE_EDITOR_FILE_BYTES = 2 * 1024 * 1024
const MAX_PACKAGE_EDITOR_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_PACKAGE_CHANGE_OPERATIONS = 1_000
const MAX_PACKAGE_DIRECTORY_PAGE = 500
const INSTALL_MANIFEST = '.paimind-install.json'
const USER_SKILL_POLICY_FILE = 'user-skill-policy.json'
const CONTROL = /[\u0000-\u001f\u007f]/
const AUTHORING_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const PAIMIND_SKILL_INSTALLATION_SKILL = 'paimind-skill-installation'
const PAIMIND_SKILL_INSTALLATION_DESCRIPTION = 'Inspect and install a public GitHub Skill into the PAIMind Skill Center, then optionally attach it to the current managed Agent. Use when the user asks to import, install, update, or bind a Skill from GitHub.'
const PAIMIND_SKILL_AUTHORING_SKILL = 'paimind-skill-authoring'
const PAIMIND_SKILL_AUTHORING_DESCRIPTION = 'Create a new Business Skill and hand an unsaved draft to the PAIMind Skill Center for review. Use when the user asks to create, write, or design a new Skill.'
const PAIMIND_SKILL_MARKET_PLUGIN_ID = '@paimind/skill-market'
const PAIMIND_AGENT_AUTHORING_SKILL = 'paimind-agent-authoring'
const PAIMIND_GENUI_SKILL = 'genui'
const PAIMIND_GENUI_DESCRIPTION = 'Generate and render structured interactive user interfaces when a task benefits from forms, tables, dashboards, or other visual interaction.'
const PAIMIND_GENUI_SOURCE_PLUGIN_ID = '@changfenhuang/dsh-genui'
const PAIMIND_GENUI_LOADER_ENTRY_ID = 'genui'
const PAIMIND_OPTIONAL_SYSTEM_SKILL_NAMES = new Set<string>(PAIMIND_SYSTEM_SKILL_NAMES)
const SYSTEM_SKILL_NAMES = new Set<string>(PAIMIND_SYSTEM_SKILL_NAMES)
const RETIRED_SYSTEM_BUSINESS_SKILLS = new Map<string, string>([
  ['skill-creator', 'skill-creator-1.0.0.zip'],
  ['skill-installer', 'skill-installer-1.0.0.zip'],
])
export { PAIMIND_SKILL_INSPECT_GITHUB_TOOL, PAIMIND_SKILL_INSTALL_TOOL } from '@paimind/contracts'
export { PAIMIND_SKILL_PREPARE_CREATE_TOOL }

function packagedSkillBody(url: URL): string {
  const source = readFileSync(url, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!source.startsWith('---\n')) throw new Error(`Packaged Skill is missing YAML frontmatter: ${url.pathname}`)
  const end = source.indexOf('\n---', 4)
  if (end < 0) throw new Error(`Packaged Skill frontmatter is incomplete: ${url.pathname}`)
  return source.slice(end + 4).replace(/^\n+/, '').trimEnd()
}

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

export type SkillRuntimeRequirement = 'python' | 'node' | 'system'

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
  readonly runtimeRequirements: readonly SkillRuntimeRequirement[]
}

export interface SkillInstallRecord extends SkillPackageMetadata {
  readonly skillId: string
  readonly digest: string
  readonly sourceFileName: string
  readonly installedAt: number
  readonly updatedAt: number
  readonly managed: boolean
  readonly runtimeRequirements: readonly SkillRuntimeRequirement[]
  readonly publication?: Readonly<SkillPublicationAdoption>
  /** Live enterprise assignment projection; never persisted or an execution grant. */
  readonly publicationEligible?: boolean
  /** Read-only projection of this owner's stored intent, not current permission. */
  readonly publicationPreference?: Readonly<{ revision: number; enabled: boolean; direct: boolean }>
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

export interface SkillSourceDocument extends SkillPackageMetadata {
  readonly skillId: string
  readonly instructions: string
  readonly digest: string
  readonly managed: boolean
}

export interface SkillSourceSaveInput {
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly expectedDigest?: string
}

/** One direct child in a managed Business Skill directory. */
export interface SkillPackageEntry {
  readonly path: string
  readonly name: string
  readonly kind: 'directory' | 'text' | 'binary'
  readonly size: number
  readonly digest?: string
}

export interface SkillPackageDirectoryPage {
  readonly path: string
  readonly entries: readonly Readonly<SkillPackageEntry>[]
  readonly nextCursor?: string
}

/** One file loaded on demand. Binary files remain visible but are not decoded as text. */
export interface SkillPackageFile {
  readonly path: string
  readonly kind: 'text' | 'binary'
  readonly size: number
  readonly digest: string
  readonly content?: string
}

/** Package summary plus the first lazily paged root directory. */
export interface SkillPackageDocument extends SkillPackageMetadata {
  readonly skillId: string
  readonly digest: string
  readonly managed: boolean
  readonly root: Readonly<SkillPackageDirectoryPage>
}

export interface SkillPackageWriteOperation {
  readonly operation: 'write'
  readonly path: string
  readonly content: string
  readonly expectedDigest?: string
}

export interface SkillPackageDeleteOperation {
  readonly operation: 'delete'
  readonly path: string
  readonly expectedDigest?: string
}

export interface SkillPackageCreateDirectoryOperation {
  readonly operation: 'mkdir'
  readonly path: string
}

export type SkillPackageChange = SkillPackageWriteOperation | SkillPackageDeleteOperation | SkillPackageCreateDirectoryOperation

/** Incremental package changes; untouched files remain byte-for-byte unchanged. */
export interface SkillPackageSaveInput {
  readonly skillId?: string
  readonly expectedDigest?: string
  readonly changes: readonly Readonly<SkillPackageChange>[]
}

export interface SkillAuthoringDraft extends SkillPackageMetadata {
  readonly draftId: string
  readonly sessionId: string
  readonly instructions: string
  readonly updatedAt: number
}

interface UploadRecord {
  readonly uploadId: string
  readonly fileName: string
  readonly path: string
  readonly digest: string
  readonly compressedBytes: number
  preview?: SkillUploadPreview
  archive?: ArchiveInspection
  repositorySelection?: Readonly<{ subdirectory?: string }>
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
  readonly runtimeRequirements: readonly SkillRuntimeRequirement[]
}

interface InstallManifest extends SkillInstallRecord {
  readonly schemaVersion: 1
}

interface LegacyStoredUserSkillPolicyV1 {
  readonly schema: 'paimind.user-skill-policy-storage/v1'
  readonly revision: number
  readonly enabledOptionalSystemSkillNames: readonly string[]
  readonly disabledBusinessSkillNames: readonly string[]
  readonly directBusinessSkillNames: readonly string[]
}

interface StoredUserSkillPolicyV2 {
  readonly schema: 'paimind.user-skill-policy-storage/v2'
  readonly revision: number
  readonly enabledOptionalSystemSkillNames: readonly string[]
  readonly disabledBusinessSkillNames: readonly string[]
  readonly directBusinessSkillNames: readonly string[]
}

interface StoredUserSkillPolicyV3 {
  readonly schema: 'paimind.user-skill-policy-storage/v3'
  readonly revision: number
  readonly enabledOptionalSystemSkillNames: readonly string[]
  readonly disabledBusinessSkillNames: readonly string[]
  readonly directBusinessSkillNames: readonly string[]
}

interface StoredUserSkillPolicyV4 extends Omit<StoredUserSkillPolicyV3, 'schema'> {
  readonly schema: 'paimind.user-skill-policy-storage/v4'
  readonly enabledAdoptedSkillIds: readonly string[]
}

export interface SkillInstallerOptions {
  readonly skillRoot?: string
  /** Existing Harness-global directory used only for one-time managed-Skill migration. */
  readonly legacySkillRoot?: string
  readonly stateRoot?: string
  readonly now?: () => number
  readonly fetch?: typeof fetch
  /** Test/build seam; production reads the two canonical packaged SKILL files. */
  readonly bundledSkillBodies?: Readonly<{ readonly installation: string; readonly authoring: string }>
}

export interface SkillInstallerHostContext {
  readonly webServer: PaimindHostWebServer
  readonly loader?: PaimindHostLoaderFacility
  readonly tools?: Pick<PaimindHostToolRegistry, 'register'>
  readonly skills?: {
    list(): Promise<readonly {
      readonly name: string
      readonly description: string
      readonly whenToUse?: string
      readonly source: string
      readonly provider: string
    }[]>
    register(skill: {
      readonly name: string
      readonly description: string
      readonly content: string
      readonly source: 'bundled'
      readonly invocation: { readonly modelInvocable: true; readonly userInvocable: true }
    }): () => void
  }
  readonly sessions?: {
    get(id: string): SkillInstallerHostSession | undefined
  }
  readonly agents?: {
    get(id: string): SkillInstallerHostAgent | undefined
    list(): readonly SkillInstallerHostAgent[]
  }
  readonly paimindAgentProfiles?: AgentBusinessSkillSelectionSource
  /** Structural Cordis lookup keeps sibling product services optional and source-owned. */
  get?(name: string): unknown
  readonly on?: {
    (
      event: 'agent/created' | 'agent/disposed',
      listener: (payload: { readonly agent: SkillInstallerHostAgent }) => void,
    ): () => void
    (
      event: 'agent/pre-step',
      listener: (
        payload: { readonly agent: SkillInstallerHostAgent },
        next: () => Promise<unknown>,
      ) => Promise<unknown>,
    ): () => void
  }
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export interface SkillInstallerHostSession {
  readonly id: string
  readonly header: { readonly cwd?: string; readonly agentPreset?: string }
}

export interface SkillInstallerHostAgent extends PaimindScopedSkillAgent {
  readonly session: SkillInstallerHostSession
}

export interface AgentBusinessSkillSelectionSource {
  businessSkillNamesForPreset(presetId: string): Promise<readonly string[] | undefined>
  describeAgentAuthoringCapability?(): Readonly<{
    readonly name: typeof PAIMIND_AGENT_AUTHORING_SKILL
    readonly description: string
    readonly sourcePluginId: string
  }>
  setAgentAuthoringEnabled?(enabled: boolean): void | Promise<void>
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

function safeSkillPackageFilePath(raw: string): string {
  const path = safeArchivePath(raw.trim())
  if (path === '' || path.endsWith('/') || path.length > 500) throw new Error('Skill 文件路径无效')
  if (path === INSTALL_MANIFEST || basename(path) === INSTALL_MANIFEST) {
    throw new Error('Skill 安装清单不能通过编辑器修改')
  }
  return path
}

/** Reject every symbolic-link segment before package reads or writes. */
async function assertNoSkillPackageSymlink(
  root: string,
  relativePath = '',
  allowMissing = false,
): Promise<void> {
  const rootInfo = await lstat(root).catch(() => undefined)
  if (rootInfo === undefined || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error('Skill 文件夹不存在或包含不受支持的符号链接')
  }
  const rootReal = await realpath(root)
  let current = root
  for (const part of relativePath.split('/').filter(Boolean)) {
    current = join(current, part)
    const info = await lstat(current).catch(() => undefined)
    if (info === undefined) {
      if (allowMissing) return
      throw new Error(`Skill 路径不存在：${relativePath}`)
    }
    if (info.isSymbolicLink()) throw new Error(`Skill 包含不受支持的符号链接：${relativePath}`)
  }
  const currentReal = await realpath(current).catch(() => undefined)
  if (currentReal !== undefined && currentReal !== rootReal && !contained(rootReal, currentReal)) {
    throw new Error(`Skill 路径越界：${relativePath}`)
  }
}

function editableSkillText(buffer: Buffer): string | undefined {
  if (buffer.byteLength > MAX_PACKAGE_EDITOR_FILE_BYTES || buffer.includes(0)) return undefined
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { return undefined }
}

async function scanSkillPackageFiles(root: string): Promise<readonly Readonly<SkillPackageFile>[]> {
  const rows: SkillPackageFile[] = []
  const visit = async (directory: string, prefix = ''): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === INSTALL_MANIFEST) continue
      const relativePath = safeSkillPackageFilePath(prefix === '' ? entry.name : `${prefix}/${entry.name}`)
      const absolutePath = join(root, relativePath)
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) throw new Error(`Skill 包含不受支持的符号链接：${relativePath}`)
      if (info.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      if (!info.isFile()) throw new Error(`Skill 包含不受支持的文件类型：${relativePath}`)
      const buffer = info.size <= MAX_PACKAGE_EDITOR_FILE_BYTES ? await readFile(absolutePath) : undefined
      const content = buffer === undefined ? undefined : editableSkillText(buffer)
      rows.push(Object.freeze({
        path: relativePath,
        kind: content === undefined ? 'binary' : 'text',
        size: info.size,
        digest: buffer === undefined
          ? await digestFile(absolutePath)
          : `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
        ...(content === undefined ? {} : { content }),
      }))
    }
  }
  await visit(root)
  return Object.freeze(rows.sort((left, right) => left.path.localeCompare(right.path)))
}

/** Stable folder revision without retaining package contents in memory. */
async function skillPackageRevision(root: string): Promise<string> {
  return skillPackageDigest(await skillPackageInventory(root))
}

/** One canonical directory traversal/digest vocabulary for authoring and export.
 * Export additionally bounds work and refuses links; ordinary revision semantics
 * and ordering remain unchanged. */
async function skillPackageInventory(root: string, publicationSignal?: AbortSignal): Promise<SkillPublicationSource['entries']> {
  const rows: Array<SkillPublicationSource['entries'][number]> = []
  let expandedBytes = 0
  const visit = async (directory: string, prefix = ''): Promise<void> => {
    publicationSignal?.throwIfAborted()
    if (publicationSignal && await realpath(directory) !== directory) throw new Error('Skill 发布路径不能包含符号链接')
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === INSTALL_MANIFEST) continue
      publicationSignal?.throwIfAborted()
      if (publicationSignal && rows.length >= SKILL_PUBLICATION_MAX_ENTRIES) throw new Error('Skill 发布文件数量超过上限')
      const path = safeSkillPackageFilePath(prefix === '' ? entry.name : `${prefix}/${entry.name}`)
      const target = join(root, path)
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw new Error(`Skill 包含不受支持的符号链接：${path}`)
      if (info.isDirectory()) {
        rows.push(Object.freeze({ path, kind: 'directory', size: 0 }))
        await visit(target, path)
        continue
      }
      if (!info.isFile()) throw new Error(`Skill 包含不受支持的文件类型：${path}`)
      expandedBytes += info.size
      if (publicationSignal && (info.nlink !== 1 || expandedBytes > SKILL_PUBLICATION_MAX_EXPANDED_BYTES)) {
        throw new Error('Skill 发布文件存在硬链接或内容超过上限')
      }
      rows.push(Object.freeze({ path, kind: 'binary', size: info.size, digest: await digestFile(target, publicationSignal) }))
    }
  }
  await visit(root)
  return Object.freeze(rows)
}

function safeSkillPackageDirectoryPath(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return ''
  const path = safeArchivePath(raw.trim()).replace(/\/$/, '')
  if (path === '' || path.length > 500 || path === INSTALL_MANIFEST || basename(path) === INSTALL_MANIFEST) {
    throw new Error('Skill 目录路径无效')
  }
  return path
}

async function listSkillPackageDirectoryPage(
  root: string,
  input: { readonly path?: string; readonly cursor?: string; readonly limit?: number },
): Promise<Readonly<SkillPackageDirectoryPage>> {
  const path = safeSkillPackageDirectoryPath(input.path)
  const directory = path === '' ? root : join(root, path)
  if (!contained(root, directory)) throw new Error('Skill 目录路径越界')
  await assertNoSkillPackageSymlink(root, path)
  const directoryInfo = await lstat(directory).catch(() => undefined)
  if (directoryInfo === undefined || directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('Skill 目录不存在')
  const offset = input.cursor === undefined ? 0 : Number(input.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Skill 目录分页游标无效')
  const limit = input.limit ?? 200
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PACKAGE_DIRECTORY_PAGE) throw new Error('Skill 目录分页大小无效')
  const children = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.name !== INSTALL_MANIFEST)
    .sort((left, right) => left.name.localeCompare(right.name))
  const entries: SkillPackageEntry[] = []
  for (const entry of children.slice(offset, offset + limit)) {
    const relativePath = safeSkillPackageFilePath(path === '' ? entry.name : `${path}/${entry.name}`)
    const absolutePath = join(root, relativePath)
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink()) throw new Error(`Skill 包含不受支持的符号链接：${relativePath}`)
    if (info.isDirectory()) {
      entries.push(Object.freeze({ path: relativePath, name: entry.name, kind: 'directory', size: 0 }))
      continue
    }
    if (!info.isFile()) throw new Error(`Skill 包含不受支持的文件类型：${relativePath}`)
    const buffer = info.size <= MAX_PACKAGE_EDITOR_FILE_BYTES ? await readFile(absolutePath) : undefined
    const content = buffer === undefined ? undefined : editableSkillText(buffer)
    entries.push(Object.freeze({
      path: relativePath,
      name: entry.name,
      kind: content === undefined ? 'binary' : 'text',
      size: info.size,
      digest: buffer === undefined
        ? await digestFile(absolutePath)
        : `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
    }))
  }
  const nextOffset = offset + entries.length
  return Object.freeze({
    path,
    entries: Object.freeze(entries),
    ...(nextOffset < children.length ? { nextCursor: String(nextOffset) } : {}),
  })
}

async function readSkillPackageFile(root: string, rawPath: string): Promise<Readonly<SkillPackageFile>> {
  const path = safeSkillPackageFilePath(rawPath)
  const target = join(root, path)
  if (!contained(root, target)) throw new Error('Skill 文件路径越界')
  await assertNoSkillPackageSymlink(root, path)
  const info = await lstat(target).catch(() => undefined)
  if (info === undefined || info.isSymbolicLink() || !info.isFile()) throw new Error('Skill 文件不存在')
  const buffer = info.size <= MAX_PACKAGE_EDITOR_FILE_BYTES ? await readFile(target) : undefined
  const content = buffer === undefined ? undefined : editableSkillText(buffer)
  return Object.freeze({
    path,
    kind: content === undefined ? 'binary' : 'text',
    size: info.size,
    digest: buffer === undefined
      ? await digestFile(target)
      : `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
    ...(content === undefined ? {} : { content }),
  })
}

function skillPackageDigest(files: readonly Readonly<Pick<SkillPackageEntry, 'path' | 'kind' | 'size' | 'digest'>>[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.path).update('\0').update(file.kind).update('\0').update(String(file.size)).update('\0').update(file.digest ?? '').update('\n')
  }
  return `sha256:${hash.digest('hex')}`
}

function packageRuntimeRequirements(files: readonly { readonly path: string }[]): readonly SkillRuntimeRequirement[] {
  const requirements = new Set<SkillRuntimeRequirement>()
  for (const file of files) {
    const name = basename(file.path).toLocaleLowerCase()
    if (name === 'requirements.txt' || name === 'pyproject.toml' || name === 'environment.yml' || name === 'environment.yaml') {
      requirements.add('python')
    }
    if (name === 'package.json') requirements.add('node')
  }
  return Object.freeze([...requirements].sort())
}

function normalizedPackageChanges(input: SkillPackageSaveInput): readonly Readonly<SkillPackageChange>[] {
  if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > MAX_PACKAGE_CHANGE_OPERATIONS) {
    throw new Error('Skill 文件变更数量无效')
  }
  const paths = new Set<string>()
  let totalBytes = 0
  const changes = input.changes.map(change => {
    const path = change.operation === 'mkdir'
      ? safeSkillPackageDirectoryPath(change.path)
      : safeSkillPackageFilePath(change.path)
    if (change.operation === 'mkdir' && path === '') throw new Error('Skill 目录路径无效')
    if (paths.has(path)) throw new Error(`Skill 编辑快照包含重复路径：${path}`)
    paths.add(path)
    if (change.operation === 'mkdir') return Object.freeze({ operation: 'mkdir' as const, path })
    if (change.operation === 'delete') {
      if (path === 'SKILL.md') throw new Error('Skill 包必须保留根目录 SKILL.md')
      return Object.freeze({ operation: 'delete' as const, path, ...(change.expectedDigest === undefined ? {} : { expectedDigest: change.expectedDigest }) })
    }
    if (change.operation !== 'write' || typeof change.content !== 'string' || AUTHORING_CONTROL.test(change.content)) {
      throw new Error(`Skill 文本文件内容无效：${path}`)
    }
    const bytes = Buffer.byteLength(change.content)
    if (bytes > MAX_PACKAGE_EDITOR_FILE_BYTES) throw new Error(`Skill 文本文件超过编辑上限：${path}`)
    totalBytes += bytes
    if (totalBytes > MAX_PACKAGE_EDITOR_TOTAL_BYTES) throw new Error('Skill 编辑快照超过总大小上限')
    return Object.freeze({ operation: 'write' as const, path, content: change.content, ...(change.expectedDigest === undefined ? {} : { expectedDigest: change.expectedDigest }) })
  })
  const filePaths = changes.filter(change => change.operation !== 'mkdir').map(change => change.path).sort()
  for (const parent of filePaths) {
    const child = changes.find(change => change.path.startsWith(`${parent}/`))
    if (child !== undefined) throw new Error(`Skill 路径同时作为文件和目录：${parent}`)
  }
  return Object.freeze(changes.sort((left, right) => left.path.localeCompare(right.path)))
}

interface GitHubSkillSource {
  readonly owner: string
  readonly repository: string
  readonly ref: string
  readonly subdirectory?: string
  readonly archiveUrl: string
}

const GITHUB_OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i
const GITHUB_REPOSITORY = /^[a-z0-9_.-]{1,100}$/i
const GITHUB_REF = /^[a-z0-9][a-z0-9._/-]{0,199}$/i

function normalizeRepositorySubdirectory(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const normalized = value.trim().replace(/^\/+|\/+$/g, '')
  if (normalized === '' || normalized.includes('\\') || CONTROL.test(normalized)) throw new Error('GitHub Skill 子目录无效')
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error('GitHub Skill 子目录无效')
  return segments.join('/')
}

/** Parse only public github.com repository URLs; the resulting fetch target can never become an arbitrary host. */
export function parseGitHubSkillSource(input: {
  readonly repositoryUrl: string
  readonly ref?: string
  readonly subdirectory?: string
}): Readonly<GitHubSkillSource> {
  let url: URL
  try { url = new URL(input.repositoryUrl.trim()) } catch { throw new Error('GitHub 仓库 URL 无效') }
  if (url.protocol !== 'https:' || url.hostname.toLocaleLowerCase() !== 'github.com' || url.port !== '' || url.username !== '' || url.password !== '') {
    throw new Error('仅支持公开的 https://github.com 仓库')
  }
  const segments = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
  const owner = segments[0] ?? ''
  const repository = (segments[1] ?? '').replace(/\.git$/i, '')
  if (!GITHUB_OWNER.test(owner) || !GITHUB_REPOSITORY.test(repository)) throw new Error('GitHub 仓库路径无效')
  let treeRef: string | undefined
  let treeSubdirectory: string | undefined
  if (segments.length > 2) {
    if (segments[2] !== 'tree' || segments.length < 4) throw new Error('请提供 GitHub 仓库首页或 tree 子目录 URL')
    treeRef = segments[3]
    treeSubdirectory = segments.slice(4).join('/') || undefined
  }
  const ref = (input.ref ?? treeRef ?? 'HEAD').trim()
  if (!GITHUB_REF.test(ref) || ref.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('GitHub ref 无效')
  if (input.ref !== undefined && treeRef !== undefined && input.ref !== treeRef) throw new Error('GitHub URL 与 ref 参数不一致')
  const subdirectory = normalizeRepositorySubdirectory(input.subdirectory ?? treeSubdirectory)
  if (input.subdirectory !== undefined && treeSubdirectory !== undefined
    && normalizeRepositorySubdirectory(input.subdirectory) !== normalizeRepositorySubdirectory(treeSubdirectory)) {
    throw new Error('GitHub URL 与 subdirectory 参数不一致')
  }
  return Object.freeze({
    owner, repository, ref,
    ...(subdirectory === undefined ? {} : { subdirectory }),
    archiveUrl: `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/zip/${encodeURIComponent(ref)}`,
  })
}

function contained(root: string, target: string): boolean {
  const candidate = relative(resolve(root), resolve(target))
  return candidate === '' || (!candidate.startsWith(`..${sep}`) && candidate !== '..' && !isAbsolute(candidate))
}

function ignoredArchivePath(path: string): boolean {
  const segments = path.split('/')
  return path === '__MACOSX' || path.startsWith('__MACOSX/') || basename(path) === '.DS_Store'
    || segments.includes('.claude-plugin') || segments.includes('.codex-plugin')
}

function zipUnixMode(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff
}

function isSymlink(entry: Entry): boolean {
  return (zipUnixMode(entry) & 0o170000) === 0o120000
}

function metadataString(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

/** Parse standard YAML frontmatter without evaluating package content or custom tags. */
export function parseSkillMetadata(source: string): SkillPackageMetadata {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) throw new Error('SKILL.md 缺少 YAML frontmatter')
  const end = normalized.indexOf('\n---', 4)
  if (end < 0 || end > METADATA_SCAN_BYTES) throw new Error('SKILL.md frontmatter 无效或过长')
  const document = parseDocument(normalized.slice(4, end), {
    schema: 'core', uniqueKeys: true,
  })
  if (document.errors.length > 0) throw new Error('SKILL.md YAML frontmatter 无效')
  const value = document.toJS({ maxAliasCount: 0 }) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('SKILL.md YAML frontmatter 必须是对象')
  }
  const fields = value as Readonly<Record<string, unknown>>
  const name = metadataString(fields.name)
  const description = metadataString(fields.description)
  const whenToUse = metadataString(fields['when-to-use'] ?? fields.when_to_use)
  if (!SKILL_NAME.test(name)) throw new Error('Skill name 必须使用小写字母、数字和连字符')
  if (description === '' || description.length > 1_000 || CONTROL.test(description)) {
    throw new Error('Skill description 缺失或无效')
  }
  return Object.freeze({ name, description, ...(whenToUse === '' ? {} : { whenToUse }) })
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

async function inspectZip(path: string, repositorySelection?: Readonly<{ subdirectory?: string }>, publicationSignal?: AbortSignal): Promise<ArchiveInspection> {
  const zip = await openZip(path, { lazyEntries: true, validateEntrySizes: true, autoClose: false })
  const rows: { entry: Entry; path: string; directory: boolean }[] = []
  const publicationPaths = new Set<string>()
  const skillFiles: { entry: Entry; path: string }[] = []
  let expandedBytes = 0
  let compressedBytes = 0
  const warnings = new Set<string>()
  const runtimeRequirements = new Set<SkillRuntimeRequirement>()
  try {
    await new Promise<void>((resolveEntries, reject) => {
      const fail = (error: Error): void => { reject(error) }
      zip.once('error', fail)
      zip.on('entry', (entry: Entry) => {
        try {
          publicationSignal?.throwIfAborted()
          const entryPath = safeArchivePath(entry.fileName)
          if (!publicationSignal && ignoredArchivePath(entryPath)) { zip.readEntry(); return }
          if (publicationSignal && (entryPath !== entry.fileName || basename(entryPath) === INSTALL_MANIFEST
            || rows.length >= SKILL_PUBLICATION_MAX_ENTRIES || publicationPaths.has(entryPath.replace(/\/$/, '')))) {
            throw new Error('企业 Skill 压缩包路径重复、保留或超过上限')
          }
          publicationPaths.add(entryPath.replace(/\/$/, ''))
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
            if (publicationSignal ? entryPath === 'SKILL.md' : basename(entryPath).toLocaleLowerCase() === 'skill.md') skillFiles.push({ entry, path: entryPath })
            if (entryPath.split('/').includes('scripts')) warnings.add('包含脚本文件；安装过程不会执行脚本')
            if ((zipUnixMode(entry) & 0o111) !== 0) warnings.add('包含可执行文件；请确认来源可信')
            const manifest = basename(entryPath).toLocaleLowerCase()
            if (manifest === 'requirements.txt' || manifest === 'pyproject.toml' || manifest === 'environment.yml' || manifest === 'environment.yaml') {
              runtimeRequirements.add('python')
            }
            if (manifest === 'package.json') runtimeRequirements.add('node')
          }
          rows.push({ entry, path: entryPath, directory })
          zip.readEntry()
        } catch (error) { reject(error) }
      })
      zip.once('end', () => { resolveEntries() })
      zip.readEntry()
    })
    if (expandedBytes > MAX_REMOTE_EXPANDED_BYTES) throw new Error('压缩包解压后超过 200 MB 安全上限')
    const repositoryRoot = rows[0]?.path.split('/')[0]
    const requestedPrefix = repositorySelection === undefined || repositoryRoot === undefined
      ? undefined
      : repositorySelection.subdirectory === undefined
        ? `${repositoryRoot}/`
        : `${repositoryRoot}/${repositorySelection.subdirectory}/`
    const selectedSkillFiles = requestedPrefix === undefined
      ? skillFiles
      : skillFiles.filter(row => row.path.startsWith(requestedPrefix))
    if (selectedSkillFiles.length !== 1) {
      throw new Error(repositorySelection === undefined
        ? '压缩包必须且只能包含一个 SKILL.md'
        : 'GitHub 选择范围必须且只能包含一个 SKILL.md；请指定更准确的 subdirectory')
    }
    if (compressedBytes > 0 && expandedBytes / compressedBytes > MAX_EXPANSION_RATIO) {
      throw new Error('压缩包总体压缩比异常')
    }
    const skillFile = selectedSkillFiles[0]!
    const rootPrefix = dirname(skillFile.path) === '.' ? '' : `${dirname(skillFile.path)}/`
    const outside = repositorySelection === undefined ? rows.find(row => !row.path.startsWith(rootPrefix)) : undefined
    if (outside !== undefined) throw new Error(`压缩包包含 Skill 目录之外的文件：${outside.path}`)
    const metadata = parseSkillMetadata((await readZipEntry(zip, skillFile.entry)).toString('utf8'))
    const selectedRows = rows.filter(row => row.path.startsWith(rootPrefix))
    const selectedWarnings = new Set<string>()
    const selectedRuntimeRequirements = new Set<SkillRuntimeRequirement>()
    for (const row of selectedRows) {
      if (row.directory) continue
      if (row.path.split('/').includes('scripts')) selectedWarnings.add('包含脚本文件；安装过程不会执行脚本')
      if ((zipUnixMode(row.entry) & 0o111) !== 0) selectedWarnings.add('包含可执行文件；请确认来源可信')
      const manifest = basename(row.path).toLocaleLowerCase()
      if (manifest === 'requirements.txt' || manifest === 'pyproject.toml' || manifest === 'environment.yml' || manifest === 'environment.yaml') selectedRuntimeRequirements.add('python')
      if (manifest === 'package.json') selectedRuntimeRequirements.add('node')
    }
    const entries = selectedRows.map(row => Object.freeze({
      ...row,
      relativePath: row.path.slice(rootPrefix.length),
    }))
    return Object.freeze({
      metadata,
      rootPrefix,
      entries,
      fileCount: entries.filter(row => !row.directory).length,
      expandedBytes: entries.reduce((total, row) => total + (row.directory ? 0 : row.entry.uncompressedSize), 0),
      warnings: Object.freeze(repositorySelection === undefined ? [...warnings] : [...selectedWarnings]),
      runtimeRequirements: Object.freeze(repositorySelection === undefined ? [...runtimeRequirements] : [...selectedRuntimeRequirements]),
    })
  } finally { zip.close() }
}

async function ensureDiskCapacity(path: string, expandedBytes: number): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await statfs(path)
  const free = Number(info.bavail) * Number(info.bsize)
  if (expandedBytes > free * 0.8) throw new Error('临时磁盘空间不足，无法安全解压')
}

async function extractZip(path: string, inspection: ArchiveInspection, targetRoot: string, signal?: AbortSignal): Promise<void> {
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
          signal?.throwIfAborted()
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
            await pipeline(input, createWriteStream(destination, { mode: (zipUnixMode(entry) & 0o111) === 0 ? 0o600 : 0o700 }), ...(signal ? [{ signal }] : []))
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

async function digestFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, signal ? { signal } : undefined)) hash.update(chunk as Buffer)
  return `sha256:${hash.digest('hex')}`
}

function installManifest(record: SkillInstallRecord): InstallManifest {
  return Object.freeze({ schemaVersion: 1, ...record })
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function boundedAuthoringText(value: unknown, maximum: number, label: string, required = true): string {
  if (typeof value !== 'string') throw new Error(`${label}无效`)
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if ((required && normalized === '') || normalized.length > maximum || AUTHORING_CONTROL.test(normalized)) throw new Error(`${label}无效`)
  return normalized
}

function assertBusinessSkillName(name: string): void {
  if (SYSTEM_SKILL_NAMES.has(name)) throw new Error(`Skill 名称与系统能力冲突：${name}`)
}

function skillDocumentParts(source: string): Readonly<{ metadata: SkillPackageMetadata; instructions: string; frontmatter: string }> {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const metadata = parseSkillMetadata(normalized)
  const end = normalized.indexOf('\n---', 4)
  return Object.freeze({
    metadata,
    frontmatter: normalized.slice(4, end),
    instructions: normalized.slice(end + 4).replace(/^\n+/, '').trimEnd(),
  })
}

function serializeSkillDocument(input: SkillSourceSaveInput, existingSource?: string): string {
  const name = boundedAuthoringText(input.name, 63, 'Skill name')
  if (!SKILL_NAME.test(name)) throw new Error('Skill name 必须使用小写字母、数字和连字符')
  const description = boundedAuthoringText(input.description, 1_000, 'Skill description')
  const instructions = boundedAuthoringText(input.instructions, 120_000, 'Skill instructions')
  const frontmatter = existingSource === undefined
    ? `name: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n`
    : (() => {
        const document = parseDocument(skillDocumentParts(existingSource).frontmatter, { schema: 'core', uniqueKeys: true })
        if (document.errors.length > 0) throw new Error('现有 SKILL.md YAML frontmatter 无效')
        document.set('name', name)
        document.set('description', description)
        return document.toString().trimEnd()
      })()
  const source = `---\n${frontmatter}\n---\n\n${instructions}\n`
  parseSkillMetadata(source)
  return source
}

async function readInstallManifest(path: string): Promise<SkillInstallRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<InstallManifest>
    if (value.schemaVersion !== 1 || typeof value.skillId !== 'string' || !SKILL_NAME.test(value.skillId)
      || typeof value.digest !== 'string' || typeof value.installedAt !== 'number' || typeof value.updatedAt !== 'number'
      || typeof value.sourceFileName !== 'string' || typeof value.name !== 'string' || typeof value.description !== 'string') throw new Error('Skill 安装回执无效，保留原内容')
    const publication = value.publication === undefined ? undefined : readSkillPublicationAdoption(value.publication)
    if (publication && (publication.name !== value.skillId || publication.name !== value.name || publication.archiveDigest !== value.digest)) {
      throw new Error('企业 Skill 安装回执身份不一致')
    }
    return Object.freeze({
      skillId: value.skillId, name: value.name, description: value.description,
      ...(typeof value.whenToUse === 'string' ? { whenToUse: value.whenToUse } : {}),
      digest: value.digest, sourceFileName: value.sourceFileName,
      installedAt: value.installedAt, updatedAt: value.updatedAt, managed: true,
      ...(publication ? { publication } : {}),
      runtimeRequirements: Object.freeze(Array.isArray(value.runtimeRequirements)
        ? value.runtimeRequirements.filter((item): item is SkillRuntimeRequirement => ['python', 'node', 'system'].includes(String(item)))
        : []),
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function storedPolicyNames(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(`用户 Skill Policy ${field} 无效`)
  return Object.freeze([...new Set(value.map(item => {
    if (typeof item !== 'string' || !PAIMIND_SKILL_NAME_PATTERN.test(item)) {
      throw new Error(`用户 Skill Policy ${field} 无效`)
    }
    return item
  }))].sort())
}

function emptyStoredUserSkillPolicy(
  defaultOptionalSystemSkillNames: readonly string[] = Object.freeze([]),
): Readonly<StoredUserSkillPolicyV4> {
  return Object.freeze({
    schema: 'paimind.user-skill-policy-storage/v4',
    revision: 0,
    enabledOptionalSystemSkillNames: Object.freeze([...defaultOptionalSystemSkillNames].sort()),
    disabledBusinessSkillNames: Object.freeze([]),
    directBusinessSkillNames: Object.freeze([]),
    enabledAdoptedSkillIds: Object.freeze([]),
  })
}

function parseStoredUserSkillPolicy(
  value: unknown,
  legacyDefaultOptionalSystemSkillNames: readonly string[] = Object.freeze([]),
): Readonly<StoredUserSkillPolicyV4> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('用户 Skill Policy 文件无效')
  }
  const candidate = value as Partial<LegacyStoredUserSkillPolicyV1 | StoredUserSkillPolicyV2 | StoredUserSkillPolicyV3 | StoredUserSkillPolicyV4>
  if ((candidate.schema !== 'paimind.user-skill-policy-storage/v1'
    && candidate.schema !== 'paimind.user-skill-policy-storage/v2'
    && candidate.schema !== 'paimind.user-skill-policy-storage/v3'
    && candidate.schema !== 'paimind.user-skill-policy-storage/v4')
    || !Number.isSafeInteger(candidate.revision) || (candidate.revision ?? -1) < 0) {
    throw new Error('用户 Skill Policy 文件无效')
  }
  const enabledOptionalSystemSkillNames = storedPolicyNames(
    candidate.enabledOptionalSystemSkillNames,
    'enabledOptionalSystemSkillNames',
  )
  const migratedOptionalSystemSkillNames = candidate.schema === 'paimind.user-skill-policy-storage/v1'
    ? legacyDefaultOptionalSystemSkillNames
    : candidate.schema === 'paimind.user-skill-policy-storage/v2'
      // v2 controlled only installation. Preserve that explicit choice while
      // enabling the three capabilities that had always been on and locked.
      ? [
          ...legacyDefaultOptionalSystemSkillNames.filter(name => name !== PAIMIND_SKILL_INSTALLATION_SKILL),
          ...enabledOptionalSystemSkillNames,
        ]
      : enabledOptionalSystemSkillNames
  const adopted = candidate.schema === 'paimind.user-skill-policy-storage/v4' ? candidate.enabledAdoptedSkillIds : []
  if (!Array.isArray(adopted) || adopted.length > 128 || new Set(adopted).size !== adopted.length
    || adopted.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(id))) {
    throw new Error('用户 Skill Policy 企业启用意愿无效')
  }
  return Object.freeze({
    schema: 'paimind.user-skill-policy-storage/v4',
    revision: candidate.revision!,
    enabledOptionalSystemSkillNames: Object.freeze([...new Set(migratedOptionalSystemSkillNames)].sort()),
    disabledBusinessSkillNames: storedPolicyNames(
      candidate.disabledBusinessSkillNames,
      'disabledBusinessSkillNames',
    ),
    directBusinessSkillNames: storedPolicyNames(candidate.directBusinessSkillNames, 'directBusinessSkillNames'),
    enabledAdoptedSkillIds: Object.freeze([...adopted].sort()),
  })
}

const EMPTY_SESSION_BUSINESS_SKILL_SELECTION = definePaimindSessionBusinessSkillSelection({
  schema: 'paimind.session-business-skill-selection/v1',
  revision: 0,
  skillNames: Object.freeze([]),
})

/** Host-owned installer. Harness remains the only runtime Skill registry. */
export class PaimindSkillInstallerService extends PaimindHostRemoteService {
  static inject = ['webServer', 'tools', 'skills', 'sessions', 'agents']
  private readonly skillRoot: string
  private readonly legacySkillRoot: string | null
  private readonly stateRoot: string
  private readonly uploadRoot: string
  private readonly stagingRoot: string
  private readonly backupRoot: string
  private readonly userSkillPolicyPath: string
  private readonly now: () => number
  private readonly remoteFetch: typeof fetch
  private readonly globalSkills: SkillInstallerHostContext['skills']
  private readonly installationSkillBody: string
  private readonly authoringSkillBody: string
  private readonly supportsAtomicSystemSkillLifecycle: boolean
  private installationCapabilityDisposer: (() => void) | undefined
  private authoringCapabilityDisposer: (() => void) | undefined
  private lifecycleReady: Promise<void> = Promise.resolve()
  private lifecycleStartupError: unknown
  private readonly scopedProjections = new Map<SkillInstallerHostAgent, PaimindScopedSkillProjection>()
  private readonly refreshTails = new Map<SkillInstallerHostAgent, Promise<void>>()
  /**
   * Harness 0.1.1 persistence rejects unknown downstream Session events on restore,
   * and Session.append has no safe public ignorable-event seam. Keep this truly
   * temporary selection on the native Session object instead of corrupting its log.
   */
  private readonly sessionSelections = new WeakMap<SkillInstallerHostSession, Readonly<PaimindSessionBusinessSkillSelectionV1>>()
  private readonly uploads = new Map<string, UploadRecord>()
  private readonly authoringDrafts = new Map<string, SkillAuthoringDraft>()
  private legacyMigration: Promise<void> | null = null
  private policyMutation: Promise<void> = Promise.resolve()
  private packageMutation: Promise<void> = Promise.resolve()
  private readonly publicationExports: SkillPublicationExports
  private readonly publicationImports: SkillPublicationImports
  private readonly adoptedLifetime = new AbortController()
  private contentReads = 0
  private preferenceWrites = 0

  constructor(private readonly installerCtx: SkillInstallerHostContext, options: SkillInstallerOptions = {}) {
    super(installerCtx, 'paimindSkillInstaller')
    this.skillRoot = resolve(options.skillRoot ?? dshHomePath(PAIMIND_BUSINESS_SKILL_REPOSITORY_DIRECTORY))
    this.legacySkillRoot = options.legacySkillRoot === undefined
      ? options.skillRoot === undefined ? resolve(dshHomePath('skills')) : null
      : resolve(options.legacySkillRoot)
    this.stateRoot = resolve(options.stateRoot ?? dshHomePath('.paimind-skill-installer'))
    this.uploadRoot = join(this.stateRoot, 'uploads')
    this.stagingRoot = join(this.stateRoot, 'staging')
    this.backupRoot = join(this.stateRoot, 'backups')
    this.userSkillPolicyPath = join(this.stateRoot, USER_SKILL_POLICY_FILE)
    this.now = options.now ?? Date.now
    this.remoteFetch = options.fetch ?? fetch
    this.globalSkills = installerCtx.skills
    this.supportsAtomicSystemSkillLifecycle = installerCtx.skills !== undefined && installerCtx.tools !== undefined
    this.installationSkillBody = options.bundledSkillBodies?.installation
      ?? (this.supportsAtomicSystemSkillLifecycle ? packagedSkillBody(new URL('../SKILL.md', import.meta.url)) : '')
    this.authoringSkillBody = options.bundledSkillBodies?.authoring
      ?? (this.supportsAtomicSystemSkillLifecycle ? packagedSkillBody(new URL('../SKILL_AUTHORING.md', import.meta.url)) : '')
    this.publicationExports = new SkillPublicationExports(join(this.stateRoot, 'publication-exports'),
      (selection, signal) => this.readPublicationSource(selection, signal))
    installerCtx.effect(() => () => this.publicationExports.dispose(), 'paimind-skill-market: transient publication exports')
    this.publicationImports = new SkillPublicationImports(join(this.stateRoot, 'publication-imports'),
      (input, signal) => this.withPackageMutation(() => this.readAdoptedSkill(input, signal, true)),
      (input, path, signal) => this.withPackageMutation(() => this.installPublishedSkill(input, path, signal)))
    installerCtx.effect(() => () => this.publicationImports.dispose(), 'paimind-skill-market: transient publication imports')
    installerCtx.effect(() => () => this.adoptedLifetime.abort(), 'paimind-skill-market: adopted content and preference operations')
    markPaimindHostRemoteMethods(this, [
      'listCatalog', 'inspectCatalog', 'inspectUpload', 'installUpload', 'listInstalled', 'uninstall',
      'getSkillSource', 'saveSkillSource', 'getSkillPackage', 'listSkillPackageDirectory',
      'readSkillPackageFile', 'saveSkillPackage', 'readAdoptedSkillContent',
      'getAuthoringDraft', 'dismissAuthoringDraft',
      'getUserSkillPolicy', 'replaceUserSkillPolicy', 'setAdoptedSkillPreference', 'listSystemSkills',
      'getSessionBusinessSkillSelection', 'replaceSessionBusinessSkillSelection',
    ])
    installerCtx.effect(() => {
      if (installerCtx.agents === undefined || installerCtx.on === undefined) return
      for (const agent of installerCtx.agents.list()) this.startScopedProjection(agent)
      const stopCreated = installerCtx.on('agent/created', ({ agent }) => {
        this.startScopedProjection(agent)
      })
      const stopPreStep = installerCtx.on('agent/pre-step', async ({ agent }, next) => {
        await this.queueScopedProjectionRefresh(agent)
        return await next()
      })
      const stopDisposed = installerCtx.on('agent/disposed', ({ agent }) => {
        this.disposeScopedProjection(agent)
      })
      return () => {
        try { stopDisposed() } finally {
          try { stopPreStep() } finally {
            try { stopCreated() } finally {
              for (const agent of [...this.scopedProjections.keys()]) this.disposeScopedProjection(agent)
            }
          }
        }
      }
    }, 'paimind-skill-market: native Agent Skill scope lifecycle')
    installerCtx.effect(() => {
      try {
        const startupPolicy = this.readStoredUserSkillPolicySync()
        // Calling the async method directly performs source-owned Skill/Tool
        // registration synchronously up to the first external actuator await.
        this.lifecycleReady = this.applyOptionalSystemSkillPolicy(startupPolicy.enabledOptionalSystemSkillNames)
          .catch(error => { this.lifecycleStartupError = error })
      } catch (error) {
        this.lifecycleStartupError = error
        this.lifecycleReady = Promise.resolve()
      }
      return () => {
        // Disposal must never wait on a Loader-wide barrier: this Plugin can be
        // one of the entries that the same Product Pack transaction is stopping.
        try { this.disableAuthoringCapability() } finally { this.disableInstallationCapability() }
      }
    }, 'paimind-skill-market: optional System Skill lifecycle control plane')
    installerCtx.effect(() => installerCtx.webServer.register({
      kind: 'prefix', path: PAIMIND_SKILL_UPLOAD_PATH,
      handler: async (request, response) => { await this.handleUpload(request, response) },
    }), 'paimind-skill-market: upload route')
  }

  private agentProfileSource(): AgentBusinessSkillSelectionSource | undefined {
    const dynamic = this.installerCtx.get?.('paimindAgentProfiles') as AgentBusinessSkillSelectionSource | undefined
    if (typeof dynamic?.businessSkillNamesForPreset === 'function') return dynamic
    // Plain test/minimal contexts may expose an own property instead of the
    // Cordis structural lookup. A real uninjected Cordis property read throws,
    // so this compatibility fallback must remain guarded.
    try {
      const direct = this.installerCtx.paimindAgentProfiles
      return typeof direct?.businessSkillNamesForPreset === 'function' ? direct : undefined
    } catch {
      return undefined
    }
  }

  private workspaceCompositionSource(): PaimindWorkspaceCompositionSource | undefined {
    const candidate = this.installerCtx.get?.('paimindWorkspaceBlueprints') as
      | Partial<PaimindWorkspaceCompositionSource>
      | undefined
    return typeof candidate?.getWorkspaceComposition === 'function'
      ? candidate as PaimindWorkspaceCompositionSource
      : undefined
  }

  private loaderFacility(): PaimindHostLoaderFacility | undefined {
    const dynamic = this.installerCtx.get?.('loader') as PaimindHostLoaderFacility | undefined
    if (dynamic !== undefined) return dynamic
    // Loader is optional, not a required Service injection. Cordis rejects an
    // absent uninjected property; plain host/test contexts may expose it as an
    // own property. Keep lookup failures observable and guard only that fallback.
    try { return this.installerCtx.loader } catch { return undefined }
  }

  private async workspaceComposition(
    session: SkillInstallerHostSession,
  ): Promise<Readonly<PaimindWorkspaceCompositionSnapshotV1> | undefined> {
    const source = this.workspaceCompositionSource()
    if (source === undefined) return undefined
    const candidate = await source.getWorkspaceComposition({
      sessionId: session.id,
      ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
    })
    return candidate === undefined ? undefined : definePaimindWorkspaceCompositionSnapshot(candidate)
  }

  private defaultOptionalSystemSkillNames(): readonly string[] {
    const names: string[] = []
    if (this.supportsAtomicSystemSkillLifecycle) {
      names.push(PAIMIND_SKILL_INSTALLATION_SKILL, PAIMIND_SKILL_AUTHORING_SKILL)
    }
    const agentSource = this.agentProfileSource()
    if (agentSource?.setAgentAuthoringEnabled !== undefined
      && agentSource.describeAgentAuthoringCapability !== undefined) {
      names.push(PAIMIND_AGENT_AUTHORING_SKILL)
    }
    const loader = this.loaderFacility()
    if (loader !== undefined && describePaimindHostLoaderEntry(loader, PAIMIND_GENUI_LOADER_ENTRY_ID).installed) {
      names.push(PAIMIND_GENUI_SKILL)
    }
    return Object.freeze(names.sort())
  }

  private readStoredUserSkillPolicySync(): Readonly<StoredUserSkillPolicyV4> {
    const defaults = this.defaultOptionalSystemSkillNames()
    try {
      return parseStoredUserSkillPolicy(
        JSON.parse(readFileSync(this.userSkillPolicyPath, 'utf8')),
        defaults,
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStoredUserSkillPolicy(defaults)
      if (error instanceof SyntaxError) throw new Error('用户 Skill Policy 文件不是有效 JSON', { cause: error })
      throw error
    }
  }

  private assertOptionalSystemSkillPolicy(names: readonly string[]): void {
    const available = new Set(this.defaultOptionalSystemSkillNames())
    const unsupported = names.find(name => !PAIMIND_OPTIONAL_SYSTEM_SKILL_NAMES.has(name) || !available.has(name))
    if (unsupported !== undefined) {
      throw new Error(`当前 System Skill 不是可原子启停的 Optional 能力：${unsupported}`)
    }
  }

  private assertKnownOptionalSystemSkillPolicy(names: readonly string[]): void {
    const unsupported = names.find(name => !PAIMIND_OPTIONAL_SYSTEM_SKILL_NAMES.has(name))
    if (unsupported !== undefined) {
      throw new Error(`当前 System Skill 不是可原子启停的 Optional 能力：${unsupported}`)
    }
  }

  private async ensureLifecycleReady(): Promise<void> {
    await this.lifecycleReady
    if (this.lifecycleStartupError !== undefined) {
      throw new Error('System Skill 生命周期启动失败', { cause: this.lifecycleStartupError })
    }
  }

  private enableAuthoringCapability(): void {
    if (this.authoringCapabilityDisposer !== undefined) return
    const skills = this.installerCtx.skills
    const tools = this.installerCtx.tools
    if (skills === undefined || tools === undefined) {
      throw new Error('Skill Authoring 原子生命周期当前不可用')
    }
    let disposePrepareCreate: (() => void) | undefined
    let disposeAuthoring: (() => void) | undefined
    try {
      disposePrepareCreate = tools.register(this.prepareCreateTool())
      disposeAuthoring = skills.register({
        name: PAIMIND_SKILL_AUTHORING_SKILL,
        description: PAIMIND_SKILL_AUTHORING_DESCRIPTION,
        content: this.authoringSkillBody,
        source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true },
      })
    } catch (error) {
      try { disposeAuthoring?.() } finally { disposePrepareCreate?.() }
      throw error
    }
    this.authoringCapabilityDisposer = () => {
      try { disposeAuthoring?.() } finally { disposePrepareCreate?.() }
    }
  }

  private disableAuthoringCapability(): void {
    const dispose = this.authoringCapabilityDisposer
    if (dispose === undefined) return
    this.authoringCapabilityDisposer = undefined
    dispose()
  }

  private enableInstallationCapability(): void {
    if (this.installationCapabilityDisposer !== undefined) return
    const skills = this.installerCtx.skills
    const tools = this.installerCtx.tools
    if (skills === undefined || tools === undefined) {
      throw new Error('Optional System Skill 原子生命周期当前不可用')
    }
    let disposeInspect: (() => void) | undefined
    let disposeInstall: (() => void) | undefined
    let disposeSkill: (() => void) | undefined
    try {
      // Tools become available before the catalog summary. No asynchronous
      // boundary exists inside this transaction, so the model never discovers
      // a Skill whose required Tools have not yet been registered.
      disposeInspect = tools.register(this.inspectGitHubTool())
      disposeInstall = tools.register(this.installSkillTool())
      disposeSkill = skills.register({
        name: PAIMIND_SKILL_INSTALLATION_SKILL,
        description: PAIMIND_SKILL_INSTALLATION_DESCRIPTION,
        content: this.installationSkillBody,
        source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true },
      })
    } catch (error) {
      try { disposeSkill?.() } finally {
        try { disposeInstall?.() } finally { disposeInspect?.() }
      }
      throw error
    }
    this.installationCapabilityDisposer = () => {
      // Hide the summary/body first, then withdraw its private Tools within the
      // same synchronous source-Plugin lifecycle transaction.
      try { disposeSkill?.() } finally {
        try { disposeInstall?.() } finally { disposeInspect?.() }
      }
    }
  }

  private disableInstallationCapability(): void {
    const dispose = this.installationCapabilityDisposer
    if (dispose === undefined) return
    this.installationCapabilityDisposer = undefined
    dispose()
  }

  private async applyOptionalSystemSkillPolicy(names: readonly string[]): Promise<void> {
    // Persisted policy may outlive an optional source Plugin. Known-but-absent
    // sources are inert here; keep their choice for the next installed-source
    // startup (Agent Center also has its explicit live reconciliation hook).
    this.assertKnownOptionalSystemSkillPolicy(names)
    const enabled = new Set(names)
    if (enabled.has(PAIMIND_SKILL_AUTHORING_SKILL)) this.enableAuthoringCapability()
    else this.disableAuthoringCapability()
    if (names.includes(PAIMIND_SKILL_INSTALLATION_SKILL)) this.enableInstallationCapability()
    else this.disableInstallationCapability()
    const agentSource = this.agentProfileSource()
    if (agentSource?.setAgentAuthoringEnabled !== undefined) {
      await agentSource.setAgentAuthoringEnabled(enabled.has(PAIMIND_AGENT_AUTHORING_SKILL))
    }
    const loader = this.loaderFacility()
    if (loader !== undefined) {
      const state = describePaimindHostLoaderEntry(loader, PAIMIND_GENUI_LOADER_ENTRY_ID)
      if (state.installed) {
        await setPaimindHostLoaderEntryEnabled(loader, PAIMIND_GENUI_LOADER_ENTRY_ID, enabled.has(PAIMIND_GENUI_SKILL))
      }
    }
  }

  /** Reconcile the persisted Agent-authoring choice after its optional source mounts. */
  async reconcileAgentSourcePolicy(): Promise<void> {
    await this.ensureLifecycleReady()
    const source = this.agentProfileSource()
    if (source?.setAgentAuthoringEnabled === undefined
      || source.describeAgentAuthoringCapability === undefined) return
    const stored = await this.readStoredUserSkillPolicy()
    this.assertKnownOptionalSystemSkillPolicy(stored.enabledOptionalSystemSkillNames)
    await source.setAgentAuthoringEnabled(
      stored.enabledOptionalSystemSkillNames.includes(PAIMIND_AGENT_AUTHORING_SKILL),
    )
  }

  private installScopedProjection(agent: SkillInstallerHostAgent): PaimindScopedSkillProjection {
    const existing = this.scopedProjections.get(agent)
    if (existing !== undefined) return existing
    const projection = installPaimindScopedSkillProjection(
      agent,
      Object.freeze([]),
      'paimind-session-business-skills',
    )
    this.scopedProjections.set(agent, projection)
    return projection
  }

  private startScopedProjection(agent: SkillInstallerHostAgent): void {
    this.installScopedProjection(agent)
    // agent/created is a synchronous Harness event and does not await returned
    // Promises. The native provider therefore carries this initial refresh as
    // a read barrier so first-turn `@` discovery cannot observe an empty
    // placeholder projection while selected Business Skills are loading.
    void this.queueScopedProjectionRefresh(agent).catch(() => undefined)
  }

  private disposeScopedProjection(agent: SkillInstallerHostAgent): void {
    this.refreshTails.delete(agent)
    const projection = this.scopedProjections.get(agent)
    this.scopedProjections.delete(agent)
    projection?.dispose()
  }

  private queueScopedProjectionRefresh(agent: SkillInstallerHostAgent): Promise<void> {
    const projection = this.installScopedProjection(agent)
    const previous = this.refreshTails.get(agent) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      const definitions = await this.scopedSkillDefinitions(agent)
      projection.replace(definitions)
    })
    this.refreshTails.set(agent, operation)
    projection.setRefreshBarrier(operation)
    void operation.finally(() => {
      if (this.refreshTails.get(agent) === operation) this.refreshTails.delete(agent)
    }).catch(() => undefined)
    return operation
  }

  private async refreshAfterDurableMutation(): Promise<void> {
    // Repository/policy state is already authoritative at this point. A live
    // projection refresh is best-effort so a transient Agent cannot turn a
    // committed install/save/policy/uninstall into a false failure response.
    // Every agent/pre-step recomputes the same catalog and fails closed before
    // next(), providing the authoritative retry boundary.
    await Promise.allSettled([...this.scopedProjections.keys()].map(async agent => {
      await this.queueScopedProjectionRefresh(agent)
    }))
  }

  private sessionSelection(
    session: SkillInstallerHostSession,
  ): Readonly<PaimindSessionBusinessSkillSelectionV1> {
    return this.sessionSelections.get(session) ?? EMPTY_SESSION_BUSINESS_SKILL_SELECTION
  }

  private requireSession(inputSessionId: string): SkillInstallerHostSession {
    const sessionId = boundedAuthoringText(inputSessionId, 200, 'Session 标识')
    const session = this.installerCtx.sessions?.get(sessionId)
    if (session === undefined) throw new Error('Harness Session 不存在或尚未加载')
    return session
  }

  private async sessionKindAndAgentSkills(presetId: string | undefined): Promise<Readonly<{
    kind: 'direct' | 'agent'
    names: readonly string[]
  }>> {
    if (presetId === undefined || presetId === PAIMIND_STANDARD_AGENT_BASE_PRESET_ID) {
      return Object.freeze({ kind: 'direct', names: Object.freeze([]) })
    }
    const source = this.agentProfileSource()
    const names = await source?.businessSkillNamesForPreset(presetId)
    // Every non-standard Preset is an Agent boundary. A Harness-owned or
    // otherwise unmanaged Agent has no PAIMind attachment, so it receives an
    // empty Agent selection instead of inheriting direct-chat defaults.
    return Object.freeze({ kind: 'agent', names: names ?? Object.freeze([]) })
  }

  private async scopedSkillSelection(session: SkillInstallerHostSession, presetId: string | undefined, includeGovernedIntent = false) {
    const installed = await this.listInstalled()
    const system = await this.listSystemSkills()
    let policy = await this.getUserSkillPolicy()
    if (includeGovernedIntent) {
      // Intent is not eligibility. Reuse the same resolver before asking the
      // enterprise authority; do not enable, register or persist these choices.
      const stored = await this.readStoredUserSkillPolicy(), disabled = new Set(stored.disabledBusinessSkillNames)
      const enabled = installed.items.filter(item => !disabled.has(item.name)
        && (!item.publication || stored.enabledAdoptedSkillIds.includes(item.publication.publicationId)))
      policy = definePaimindUserSkillPolicy({ ...policy,
        enabledBusinessSkillNames: enabled.map(item => item.name),
        directBusinessSkillNames: stored.directBusinessSkillNames.filter(name => enabled.some(item => item.name === name)),
      })
    }
    const sessionSelection = this.sessionSelection(session)
    const agentSelection = await this.sessionKindAndAgentSkills(presetId)
    const workspaceComposition = await this.workspaceComposition(session)
    const systemNames = new Set<string>([
      ...PAIMIND_SYSTEM_SKILL_NAMES,
      ...system.items.map(reference => reference.name),
    ])
    const agentCollision = agentSelection.names.find(name => systemNames.has(name))
    if (agentCollision !== undefined) {
      throw new Error(`Agent Business Skill 与当前系统能力冲突：${agentCollision}`)
    }
    const installedByName = new Map(installed.items.map(record => {
      if (record.skillId !== record.name) {
        throw new Error(`Business Skill folder identity mismatch: ${record.skillId}`)
      }
      return [record.name, record] as const
    }))
    const workspaceSkillNames = new Set(
      workspaceComposition?.businessSkills.map(reference => reference.name) ?? [],
    )
    const installedReferences = await Promise.all(installed.items.map(async record => definePaimindSkillReference({
      kind: 'business' as const,
      canonicalId: `business:${record.name}` as const,
      name: record.name,
      // `SkillInstallRecord.digest` tracks the source artifact for market
      // update checks. Workspace composition instead pins the live folder
      // revision returned by getSkillPackage(), so recompute only referenced
      // packages on the runtime path.
      digest: (workspaceSkillNames.has(record.name)
        ? await skillPackageRevision(join(this.skillRoot, record.skillId))
        : record.digest) as `sha256:${string}`,
      description: record.description,
      ...(record.whenToUse === undefined ? {} : { whenToUse: record.whenToUse }),
    })))
    const resolved = resolvePaimindSkillScope({
      schema: 'paimind.skill-scope-input/v1',
      sessionKind: agentSelection.kind,
      mandatorySystemSkills: system.items.filter(reference => reference.availability === 'mandatory'),
      optionalSystemSkills: system.items.filter(reference => reference.availability === 'optional'),
      installedBusinessSkills: installedReferences,
      userPolicy: policy,
      agentBusinessSkillNames: agentSelection.names,
      workspaceComposition,
      sessionBusinessSkillNames: sessionSelection.skillNames,
    })
    return { installedByName, resolved }
  }

  /** Trusted native control only. Exact selected enterprise intent and bytes,
   * never a new registry, browser method, eligibility switch or execution grant. */
  async getSelectedPublicationReferences(input: { readonly nativeSessionId: string; readonly presetId: string; readonly requiredPublicationIds?: readonly string[]; readonly skillSelection?: 'captured' }, signal = new AbortController().signal): Promise<readonly Readonly<SkillPublicationAdoptionInput>[]> {
    if (input === null || typeof input !== 'object' || !['nativeSessionId,presetId', 'nativeSessionId,presetId,requiredPublicationIds', 'nativeSessionId,presetId,requiredPublicationIds,skillSelection'].includes(Object.keys(input).sort().join(','))
      || Object.hasOwn(input, 'skillSelection') && (input.skillSelection !== 'captured' || !Array.isArray(input.requiredPublicationIds))
      || typeof input.presetId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(input.presetId)) throw new Error('Invalid native Skill selection')
    const retained = input.requiredPublicationIds === undefined ? [] : input.requiredPublicationIds
    if (!Array.isArray(retained) || retained.length > 128 || new Set(retained).size !== retained.length
      || retained.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id))) throw new Error('Invalid retained Skill requirements')
    const required = [...retained], captured = input.skillSelection === 'captured'
    return this.withPackageMutation(async () => {
      signal.throwIfAborted()
      const session = this.requireSession(input.nativeSessionId)
      // Read the original installation receipts without consulting the parent's
      // later mutable catalog for an already-started native job. This is not a
      // permission cache: every retained version is fully re-read below.
      const { installedByName, resolved } = captured
        ? { installedByName: new Map((await this.listInstalled()).items.map(row => [row.name, row])), resolved: [] }
        : await this.scopedSkillSelection(session, input.presetId, true)
      const names = new Set(resolved.filter(row => row.kind === 'business' && installedByName.get(row.name)?.publication !== undefined).map(row => row.name))
      for (const id of required) {
        const matches = [...installedByName.values()].filter(row => row.publication?.publicationId === id)
        if (matches.length !== 1) throw new Error('已使用的企业技能固定版本缺失或不唯一，不能省略权限检查')
        names.add(matches[0]!.name)
      }
      if (names.size > 128) throw new Error('当前会话超过128个企业技能依赖，未截断权限检查')
      const proofs: Readonly<SkillPublicationAdoptionInput>[] = []
      for (const name of [...names].sort()) {
        const { schema: _schema, adoptedAt: _at, ...origin } = installedByName.get(name)!.publication!
        const input = readSkillPublicationAdoptionInput(origin)
        await this.readAdoptedSkill(input, signal, false)
        proofs.push(input)
      }
      signal.throwIfAborted(); return Object.freeze(proofs)
    })
  }

  /** Same-process execution provenance only; never registered as a Remote
   * method. Compare the actually loaded native value with the original owned
   * immutable package. This neither selects a Skill nor grants its use. */
  async getLoadedPublicationReference(value: { readonly name: string; readonly provider: string; readonly content: string; readonly resourceBase?: unknown },
    signal = new AbortController().signal): Promise<Readonly<SkillPublicationAdoptionInput> | undefined> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['content,name,provider', 'content,name,provider,resourceBase'].includes(Object.keys(value).sort().join(','))
      || typeof value.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.name)
      || typeof value.provider !== 'string' || !value.provider || typeof value.content !== 'string') throw new Error('Invalid native loaded Skill value')
    value = structuredClone(value)
    return this.withPackageMutation(async () => {
      signal.throwIfAborted()
      const matches = (await this.listInstalled()).items.filter(row => row.name === value.name)
      if (matches.length > 1) throw new Error('原生技能来源不唯一')
      const record = matches[0]
      if (value.provider !== 'paimind-session-business-skills') {
        if (record?.publication) throw new Error('同名原生技能不是企业固定版本的原提供方')
        return undefined
      }
      if (!record) throw new Error('原生技能的受管来源已不存在')
      if (!record.publication) return undefined
      const { schema: _schema, adoptedAt: _at, ...origin } = record.publication
      const reference = readSkillPublicationAdoptionInput(origin)
      await this.readAdoptedSkill(reference, signal, false)
      const directory = join(this.skillRoot, record.skillId)
      const document = skillDocumentParts(await readFile(join(directory, 'SKILL.md'), 'utf8'))
      const expected = { name: reference.name, provider: 'paimind-session-business-skills',
        resourceBase: { kind: 'directory', path: directory }, content: document.instructions }
      if (!isDeepStrictEqual(value, expected)) throw new Error('已读取的原生技能正文或资源来源与企业固定版本不一致')
      await this.readAdoptedSkill(reference, signal, false)
      signal.throwIfAborted(); return reference
    })
  }

  private async scopedSkillDefinitions(agent: SkillInstallerHostAgent): Promise<readonly Readonly<PaimindScopedSkillDefinition>[]> {
    const { installedByName, resolved } = await this.scopedSkillSelection(agent.session, resolvePaimindLiveAgentPreset(agent))
    const effectiveBusinessNames = new Set(
      resolved.filter(reference => reference.kind === 'business').map(reference => reference.name),
    )
    const definitions: Readonly<PaimindScopedSkillDefinition>[] = []
    for (const name of [...effectiveBusinessNames].sort()) {
      const record = installedByName.get(name)
      if (record === undefined) throw new Error(`Resolved Business Skill is not installed: ${name}`)
      const resourceDirectory = join(this.skillRoot, record.skillId)
      const source = await readFile(join(resourceDirectory, 'SKILL.md'), 'utf8')
      const document = skillDocumentParts(source)
      if (document.metadata.name !== name) throw new Error(`Business Skill identity changed on disk: ${name}`)
      definitions.push(Object.freeze({
        name,
        description: document.metadata.description,
        ...(document.metadata.whenToUse === undefined ? {} : { whenToUse: document.metadata.whenToUse }),
        content: document.instructions,
        resourceDirectory,
      }))
    }

    return Object.freeze(definitions)
  }

  async getSessionBusinessSkillSelection(
    input: { readonly sessionId: string },
  ): Promise<Readonly<PaimindSessionBusinessSkillSelectionV1>> {
    return this.sessionSelection(this.requireSession(input.sessionId))
  }

  async replaceSessionBusinessSkillSelection(
    input: PaimindSessionBusinessSkillSelectionReplaceInput,
  ): Promise<Readonly<PaimindSessionBusinessSkillSelectionV1>> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error('Session Business Skill expectedRevision 无效')
    }
    const requested = definePaimindSessionBusinessSkillSelection({
      schema: 'paimind.session-business-skill-selection/v1',
      revision: 0,
      skillNames: input.skillNames,
    }).skillNames
    const session = this.requireSession(input.sessionId)
    const current = this.sessionSelection(session)
    if (current.revision !== input.expectedRevision) {
      throw new Error('Session Business Skill Selection 已更新，请刷新后重试')
    }
    const [installed, policy, systemNames] = await Promise.all([
      this.listInstalled(),
      this.getUserSkillPolicy(),
      this.currentSystemSkillNames(),
    ])
    const installedNames = new Set(installed.items.map(record => record.name))
    const enabledNames = new Set(policy.enabledBusinessSkillNames)
    const previouslySelected = new Set(current.skillNames)
    // A disabled Skill cannot be newly attached, but an existing disabled
    // attachment may remain while the user removes another one. Otherwise a
    // multi-selection becomes impossible to clean up one row at a time.
    const unavailable = requested.find(name => !previouslySelected.has(name)
      && (!installedNames.has(name) || !enabledNames.has(name)))
    if (unavailable !== undefined) {
      throw new Error(`Session Business Skill 未安装或未启用：${unavailable}`)
    }
    const collision = requested.find(name => systemNames.has(name))
    if (collision !== undefined) throw new Error(`Skill 名称与当前系统能力冲突：${collision}`)
    const next = definePaimindSessionBusinessSkillSelection({
      schema: 'paimind.session-business-skill-selection/v1',
      revision: current.revision + 1,
      skillNames: requested,
    })
    this.sessionSelections.set(session, next)
    const live = this.installerCtx.agents?.get(session.id)
    if (live !== undefined) {
      try { await this.queueScopedProjectionRefresh(live) } catch (error) {
        if (current.revision === 0) this.sessionSelections.delete(session)
        else this.sessionSelections.set(session, current)
        throw error
      }
    }
    return next
  }

  private async assertNoSystemSkillCollision(name: string): Promise<void> {
    assertBusinessSkillName(name)
    const systemSkillNames = await this.currentSystemSkillNames()
    if (systemSkillNames.has(name)) {
      throw new Error(`Skill 名称与当前系统能力冲突：${name}`)
    }
  }

  private async currentSystemSkillNames(): Promise<ReadonlySet<string>> {
    const names = new Set<string>(PAIMIND_SYSTEM_SKILL_NAMES)
    if (this.globalSkills !== undefined) {
      for (const skill of await this.globalSkills.list()) names.add(skill.name)
    }
    return names
  }

  private inspectGitHubTool(): unknown {
    return definePaimindHarnessTool({
      name: PAIMIND_SKILL_INSPECT_GITHUB_TOOL,
      description: 'Download and safely inspect one public GitHub Skill without installing or executing it. Use this before paimind_skill_install.',
      parameters: {
        repository_url: { type: 'string', required: true },
        ref: { type: 'string' },
        subdirectory: { type: 'string' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            uploadId: { type: 'string', required: true }, digest: { type: 'string', required: true },
            fileName: { type: 'string', required: true }, kind: { type: 'string', required: true },
            name: { type: 'string', required: true }, description: { type: 'string', required: true },
            whenToUse: { type: 'string' },
            fileCount: { type: 'number', required: true }, compressedBytes: { type: 'number', required: true },
            expandedBytes: { type: 'number', required: true },
            operation: { type: 'string', required: true }, repository: { type: 'string', required: true },
            ref: { type: 'string', required: true }, subdirectory: { type: 'string' },
            warnings: { type: 'array', required: true, items: { type: 'string' } },
            runtimeRequirements: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
      },
      execute: async (args, _exec: PaimindToolRunContext) => {
        const preview = await this.inspectGitHub({
          repositoryUrl: String(args.repository_url ?? ''),
          ...(typeof args.ref === 'string' ? { ref: args.ref } : {}),
          ...(typeof args.subdirectory === 'string' ? { subdirectory: args.subdirectory } : {}),
        })
        return preview
      },
      presentCall: () => ({ card: 'generic', title: 'Inspect GitHub Skill', kind: 'read' }),
    })
  }

  private installSkillTool(): unknown {
    return definePaimindHarnessTool({
      name: PAIMIND_SKILL_INSTALL_TOOL,
      description: 'Install a previously inspected Skill into the PAIMind Skill Center. Call only after the user confirms the exact inspection result.',
      parameters: {
        upload_id: { type: 'string', required: true },
        digest: { type: 'string', required: true },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            operation: { type: 'string', required: true }, skillName: { type: 'string', required: true },
            description: { type: 'string', required: true }, digest: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
        render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
      },
      execute: async args => {
        const result = await this.installUpload({ uploadId: String(args.upload_id ?? ''), digest: String(args.digest ?? '') })
        return {
          operation: result.operation, skillName: result.record.name, description: result.record.description,
          digest: result.record.digest,
          message: 'Skill 已安装到 PAIMind 技能中心；是否绑定当前 Agent 需要单独确认。',
        }
      },
      presentCall: () => ({ card: 'generic', title: 'Install Skill', kind: 'edit' }),
    })
  }

  private prepareCreateTool(): unknown {
    return definePaimindHarnessTool({
      name: PAIMIND_SKILL_PREPARE_CREATE_TOOL,
      description: 'Prepare one complete unsaved Business Skill draft and open it in the PAIMind Skill Center for user review. Never persists automatically.',
      parameters: {
        name: { type: 'string', required: true },
        description: { type: 'string', required: true },
        instructions: { type: 'string', required: true },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            draftId: { type: 'string', required: true }, sessionId: { type: 'string', required: true },
            name: { type: 'string', required: true }, description: { type: 'string', required: true },
            instructions: { type: 'string', required: true }, updatedAt: { type: 'number', required: true },
            saved: { type: 'boolean', required: true },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: `<!--PAIMIND_SKILL_DRAFT\n${JSON.stringify(value)}\n-->\nThe Skill draft is ready for review in the Skill Center.` }]
        },
      },
      execute: async (args, exec: PaimindToolRunContext) => {
        if (exec.agent === undefined) throw new Error('创建 Skill 需要当前 Harness Session')
        const sessionId = boundedAuthoringText(exec.agent.session.id, 200, 'Session 标识')
        const name = boundedAuthoringText(args.name, 63, 'Skill name')
        if (!SKILL_NAME.test(name)) throw new Error('Skill name 必须使用小写字母、数字和连字符')
        await this.assertNoSystemSkillCollision(name)
        const draft = Object.freeze({
          draftId: randomUUID(), sessionId, name,
          description: boundedAuthoringText(args.description, 1_000, 'Skill description'),
          instructions: boundedAuthoringText(args.instructions, 120_000, 'Skill instructions'),
          updatedAt: this.now(),
        })
        this.authoringDrafts.set(sessionId, draft)
        return { ...draft, saved: false }
      },
      presentCall: () => ({ card: 'generic', title: 'Prepare Skill draft', kind: 'edit' }),
    })
  }

  /** Stage one public GitHub repository archive through the existing inspection pipeline. */
  async inspectGitHub(input: {
    readonly repositoryUrl: string
    readonly ref?: string
    readonly subdirectory?: string
  }): Promise<Readonly<SkillUploadPreview & { repository: string; ref: string; subdirectory?: string }>> {
    const source = parseGitHubSkillSource(input)
    await mkdir(this.uploadRoot, { recursive: true, mode: 0o700 })
    const uploadId = randomUUID()
    const path = join(this.uploadRoot, uploadId)
    const response = await this.remoteFetch(source.archiveUrl, {
      method: 'GET', redirect: 'follow', headers: { accept: 'application/zip', 'user-agent': 'PAIMind-Skill-Installer/1' },
    })
    if (!response.ok || response.body === null) throw new Error(`GitHub Skill 下载失败：HTTP ${response.status}`)
    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_ARCHIVE_BYTES) throw new Error('GitHub Skill 压缩包超过 20 MB 安全上限')
    const handle = await open(path, 'wx', 0o600)
    const hash = createHash('sha256')
    let compressedBytes = 0
    try {
      const reader = response.body.getReader()
      while (true) {
        const part = await reader.read()
        if (part.done) break
        const chunk = Buffer.from(part.value)
        compressedBytes += chunk.byteLength
        if (compressedBytes > MAX_REMOTE_ARCHIVE_BYTES) {
          await reader.cancel('archive too large')
          throw new Error('GitHub Skill 压缩包超过 20 MB 安全上限')
        }
        hash.update(chunk)
        await handle.write(chunk)
      }
      if (compressedBytes === 0) throw new Error('GitHub Skill 压缩包为空')
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(path, { force: true })
      throw error
    }
    await handle.close()
    const digest = `sha256:${hash.digest('hex')}`
    const safeRef = source.ref.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80)
    this.uploads.set(uploadId, {
      uploadId, path, digest, compressedBytes,
      fileName: `${source.owner}-${source.repository}-${safeRef || 'HEAD'}.zip`,
      repositorySelection: Object.freeze({ ...(source.subdirectory === undefined ? {} : { subdirectory: source.subdirectory }) }),
    })
    try {
      const preview = await this.inspectUpload({ uploadId })
      return Object.freeze({
        ...preview, repository: `${source.owner}/${source.repository}`, ref: source.ref,
        ...(source.subdirectory === undefined ? {} : { subdirectory: source.subdirectory }),
      })
    } catch (error) {
      await this.cancelUpload(uploadId)
      throw error
    }
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
    await this.migrateLegacyManagedSkills()
    const upload = this.upload(input.uploadId)
    if (upload.preview !== undefined) return upload.preview
    try {
      const extension = extname(upload.fileName).toLocaleLowerCase()
      let metadata: SkillPackageMetadata
      let fileCount: number
      let expandedBytes: number
      let warnings: readonly string[]
      let runtimeRequirements: readonly SkillRuntimeRequirement[]
      if (extension === '.zip') {
        const inspection = await inspectZip(upload.path, upload.repositorySelection)
        upload.archive = inspection
        metadata = inspection.metadata
        fileCount = inspection.fileCount
        expandedBytes = inspection.expandedBytes
        warnings = inspection.warnings
        runtimeRequirements = inspection.runtimeRequirements
      } else {
        metadata = parseSkillMetadata(await readPrefix(upload.path))
        fileCount = 1
        expandedBytes = (await stat(upload.path)).size
        warnings = Object.freeze([])
        runtimeRequirements = Object.freeze([])
      }
      await ensureDiskCapacity(this.stateRoot, expandedBytes)
      await this.assertNoSystemSkillCollision(metadata.name)
      const operation = await pathExists(join(this.skillRoot, metadata.name)) ? 'update' : 'install'
      const preview = Object.freeze({
        uploadId: upload.uploadId, digest: upload.digest, fileName: upload.fileName,
        kind: extension === '.zip' ? 'zip' as const : 'skill-md' as const,
        ...metadata, fileCount, compressedBytes: upload.compressedBytes, expandedBytes,
        operation, warnings, runtimeRequirements,
      })
      upload.preview = preview
      return preview
    } catch (error) {
      await this.cancelUpload(input.uploadId)
      throw error
    }
  }

  async installUpload(input: { readonly uploadId: string; readonly digest: string }): Promise<Readonly<SkillInstallResult>> {
    return this.withPackageMutation(() => this.installUploadNow(input))
  }

  private async installUploadNow(input: { readonly uploadId: string; readonly digest: string }): Promise<Readonly<SkillInstallResult>> {
    await this.migrateLegacyManagedSkills()
    const upload = this.upload(input.uploadId)
    if (upload.digest !== input.digest) throw new Error('上传摘要不匹配，请重新上传')
    const preview = await this.inspectUpload({ uploadId: input.uploadId })
    await this.assertNoSystemSkillCollision(preview.name)
    const staging = join(this.stagingRoot, `${preview.name}-${randomUUID()}`)
    const destination = join(this.skillRoot, preview.name)
    await this.assertMutableSkill(destination)
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
        runtimeRequirements: preview.runtimeRequirements,
      })
      await writeFile(join(staging, INSTALL_MANIFEST), `${JSON.stringify(installManifest(record), null, 2)}\n`, { mode: 0o600 })
      await rename(staging, destination)
      await this.cancelUpload(upload.uploadId)
      const result = Object.freeze({ operation: preview.operation === 'install' ? 'installed' as const : 'updated' as const, record })
      await this.refreshAfterDurableMutation()
      return result
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      if (movedPrevious && !(await pathExists(destination))) await rename(backup, destination)
      throw error
    }
  }

  async listSystemSkills(): Promise<Readonly<PaimindSystemSkillCatalogSnapshot>> {
    if (this.globalSkills === undefined) throw new Error('Harness System Skill Provider 当前不可用')
    await this.ensureLifecycleReady()
    const live = await this.globalSkills.list()
    const optional = new Map<string, Readonly<{
      readonly name: string
      readonly description: string
      readonly whenToUse?: string
      readonly sourcePluginId: string
    }>>()
    if (this.supportsAtomicSystemSkillLifecycle) {
      optional.set(PAIMIND_SKILL_INSTALLATION_SKILL, Object.freeze({
        name: PAIMIND_SKILL_INSTALLATION_SKILL,
        description: PAIMIND_SKILL_INSTALLATION_DESCRIPTION,
        sourcePluginId: PAIMIND_SKILL_MARKET_PLUGIN_ID,
      }))
      optional.set(PAIMIND_SKILL_AUTHORING_SKILL, Object.freeze({
        name: PAIMIND_SKILL_AUTHORING_SKILL,
        description: PAIMIND_SKILL_AUTHORING_DESCRIPTION,
        sourcePluginId: PAIMIND_SKILL_MARKET_PLUGIN_ID,
      }))
    }
    const agentDescriptor = this.agentProfileSource()?.describeAgentAuthoringCapability?.()
    if (agentDescriptor !== undefined) optional.set(agentDescriptor.name, agentDescriptor)
    const loader = this.loaderFacility()
    if (loader !== undefined) {
      await loader.await()
      if (describePaimindHostLoaderEntry(loader, PAIMIND_GENUI_LOADER_ENTRY_ID).installed) {
        const liveGenui = live.find(skill => skill.name === PAIMIND_GENUI_SKILL)
        optional.set(PAIMIND_GENUI_SKILL, Object.freeze({
          name: PAIMIND_GENUI_SKILL,
          description: liveGenui?.description ?? PAIMIND_GENUI_DESCRIPTION,
          ...(liveGenui?.whenToUse === undefined ? {} : { whenToUse: liveGenui.whenToUse }),
          sourcePluginId: liveGenui?.provider || liveGenui?.source || PAIMIND_GENUI_SOURCE_PLUGIN_ID,
        }))
      }
    }
    const items: Readonly<PaimindSystemSkillReference>[] = live
      .filter(skill => !optional.has(skill.name))
      .map(skill => definePaimindSkillReference({
        kind: 'system', canonicalId: `system:${skill.name}`, name: skill.name,
        description: skill.description,
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        availability: 'mandatory', userControl: 'locked',
        sourcePluginId: skill.provider || skill.source,
      }))
    for (const descriptor of optional.values()) {
      // These source-owned inventory rows intentionally survive runtime
      // disablement. They are control-plane descriptors, not a second Skill
      // discovery registry: Harness remains the sole catalog/body source.
      items.push(definePaimindSkillReference({
        kind: 'system', canonicalId: `system:${descriptor.name}`,
        name: descriptor.name,
        description: descriptor.description,
        ...(descriptor.whenToUse === undefined ? {} : { whenToUse: descriptor.whenToUse }),
        availability: 'optional', userControl: 'atomic',
        sourcePluginId: descriptor.sourcePluginId,
      }))
    }
    return Object.freeze({ items: Object.freeze(items.sort((left, right) => left.name.localeCompare(right.name))) })
  }

  async listInstalled(): Promise<Readonly<SkillInstallerSnapshot>> {
    await this.migrateLegacyManagedSkills()
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
          runtimeRequirements: Object.freeze([]),
        }))
      } catch { /* invalid folders remain Harness-owned and are omitted from the business list */ }
    }
    const eligible = await this.currentPublicationEligibility(items)
    const policy = items.some(item => item.publication) ? await this.readStoredUserSkillPolicy() : undefined
    return Object.freeze({ items: Object.freeze(items.map(item => item.publication
      ? Object.freeze({ ...item, publicationEligible: eligible.has(item.publication.publicationId), publicationPreference: Object.freeze({
        revision: policy!.revision,
        enabled: policy!.enabledAdoptedSkillIds.includes(item.publication.publicationId) && !policy!.disabledBusinessSkillNames.includes(item.name),
        direct: policy!.enabledAdoptedSkillIds.includes(item.publication.publicationId) && !policy!.disabledBusinessSkillNames.includes(item.name)
          && policy!.directBusinessSkillNames.includes(item.name),
      }) }) : item)
      .sort((left, right) => left.name.localeCompare(right.name))) })
  }

  private async currentPublicationEligibility(items: readonly SkillInstallRecord[]): Promise<ReadonlySet<string>> {
    const governed = items.filter(item => item.publication)
    if (!governed.length) return new Set()
    const provider = this.installerCtx.get?.('paimindEnterpriseSkillEligibility') as {
      read?: (references: readonly Readonly<SkillPublicationAdoptionInput>[], signal: AbortSignal) => Promise<unknown>
    } | undefined
    if (provider === undefined) return new Set()
    if (!provider || typeof provider.read !== 'function') throw new Error('企业技能可用资格服务无效')
    const references = Object.freeze(governed.map(item => {
      const { schema: _schema, adoptedAt: _at, ...origin } = item.publication!
      return readSkillPublicationAdoptionInput(origin)
    }))
    if (references.length > 128 || new Set(references.map(item => item.publicationId)).size !== references.length
      || new Set(references.map(item => item.name)).size !== references.length) throw new Error('企业技能可用资格引用无效')
    const signal = AbortSignal.timeout(4000)
    for (const reference of references) await this.readAdoptedSkill(reference, signal, false)
    const eligible = await provider.read(references, signal)
    signal.throwIfAborted()
    if (this.installerCtx.get?.('paimindEnterpriseSkillEligibility') !== provider
      || !Array.isArray(eligible) || eligible.length > references.length || new Set(eligible).size !== eligible.length
      || eligible.some(id => typeof id !== 'string' || !references.some(reference => reference.publicationId === id))) {
      throw new Error('企业技能可用资格响应无效或提供方已变化')
    }
    for (const reference of references) await this.readAdoptedSkill(reference, signal, false)
    signal.throwIfAborted()
    if (this.installerCtx.get?.('paimindEnterpriseSkillEligibility') !== provider) throw new Error('企业技能可用资格提供方已撤回')
    return new Set(eligible as string[])
  }

  private async readStoredUserSkillPolicy(): Promise<Readonly<StoredUserSkillPolicyV4>> {
    const defaults = this.defaultOptionalSystemSkillNames()
    try {
      return parseStoredUserSkillPolicy(
        JSON.parse(await readFile(this.userSkillPolicyPath, 'utf8')),
        defaults,
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStoredUserSkillPolicy(defaults)
      if (error instanceof SyntaxError) throw new Error('用户 Skill Policy 文件不是有效 JSON', { cause: error })
      throw error
    }
  }

  private async writeStoredUserSkillPolicy(policy: Readonly<StoredUserSkillPolicyV4>): Promise<void> {
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
    const temporary = `${this.userSkillPolicyPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      await rename(temporary, this.userSkillPolicyPath)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  private async materializeUserSkillPolicy(
    stored: Readonly<StoredUserSkillPolicyV4>,
  ): Promise<Readonly<PaimindUserSkillPolicyV1>> {
    const installed = await this.listInstalled()
    const installedNames = new Set(installed.items.map(skill => skill.name))
    const disabled = new Set(stored.disabledBusinessSkillNames)
    const unavailable = new Set(installed.items.filter(item => item.publication && !item.publicationEligible).map(item => item.name))
    const explicit = new Set(installed.items.filter(item => !item.publication || stored.enabledAdoptedSkillIds.includes(item.publication.publicationId)).map(item => item.name))
    const systemSkillNames = await this.currentSystemSkillNames()
    // A persisted preference can outlive an optional source Plugin. Preserve
    // that known preference without making the independent Skill Center read
    // path unavailable while the source is absent.
    this.assertKnownOptionalSystemSkillPolicy(stored.enabledOptionalSystemSkillNames)
    const collision = [...installedNames].find(name => systemSkillNames.has(name))
    if (collision !== undefined) throw new Error(`Skill 名称与当前系统能力冲突：${collision}`)
    return definePaimindUserSkillPolicy({
      schema: 'paimind.user-skill-policy/v1',
      revision: stored.revision,
      enabledOptionalSystemSkillNames: stored.enabledOptionalSystemSkillNames,
      // Preferences never confer enterprise eligibility. Read the current
      // assignment every time; actual execution additionally checks login,
      // immutable bytes and current authority at its own native boundaries.
      enabledBusinessSkillNames: [...installedNames].filter(name => explicit.has(name) && !disabled.has(name) && !unavailable.has(name)),
      directBusinessSkillNames: stored.directBusinessSkillNames.filter(name => explicit.has(name) && !disabled.has(name) && !unavailable.has(name)),
    })
  }

  async getUserSkillPolicy(): Promise<Readonly<PaimindUserSkillPolicyV1>> {
    await this.ensureLifecycleReady()
    await this.policyMutation
    return this.materializeUserSkillPolicy(await this.readStoredUserSkillPolicy())
  }

  async replaceUserSkillPolicy(
    input: PaimindUserSkillPolicyReplaceInput,
  ): Promise<Readonly<PaimindUserSkillPolicyV1>> {
    await this.ensureLifecycleReady()
    const operation = this.policyMutation.then(async () => {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new Error('用户 Skill Policy expectedRevision 无效')
      }
      const current = await this.readStoredUserSkillPolicy()
      if (current.revision !== input.expectedRevision) {
        throw new Error('用户 Skill Policy 已更新，请刷新后重试')
      }
      const installed = await this.listInstalled()
      const installedNames = new Set(installed.items.map(skill => skill.name))
      const candidate = definePaimindUserSkillPolicy({
        schema: 'paimind.user-skill-policy/v1',
        revision: current.revision + 1,
        enabledOptionalSystemSkillNames: input.enabledOptionalSystemSkillNames,
        enabledBusinessSkillNames: input.enabledBusinessSkillNames,
        directBusinessSkillNames: input.directBusinessSkillNames,
      })
      if (candidate.enabledBusinessSkillNames.some(name => !installedNames.has(name))
        || candidate.directBusinessSkillNames.some(name => !installedNames.has(name))) {
        throw new Error('用户 Skill Policy 引用了未安装的 Business Skill')
      }
      const systemSkillNames = await this.currentSystemSkillNames()
      this.assertOptionalSystemSkillPolicy(candidate.enabledOptionalSystemSkillNames)
      const collision = candidate.enabledBusinessSkillNames.find(name => systemSkillNames.has(name))
      if (collision !== undefined) throw new Error(`Skill 名称与当前系统能力冲突：${collision}`)
      const enabledBusiness = new Set(candidate.enabledBusinessSkillNames)
      if (installed.items.some(item => item.publication && !item.publicationEligible
        && (enabledBusiness.has(item.name) || candidate.directBusinessSkillNames.includes(item.name)))) {
        throw new Error('企业 Skill 当前不可用或运行授权尚未接入，采用回执不能作为启用许可')
      }
      const stored = Object.freeze({
        schema: 'paimind.user-skill-policy-storage/v4' as const,
        revision: candidate.revision,
        enabledOptionalSystemSkillNames: candidate.enabledOptionalSystemSkillNames,
        disabledBusinessSkillNames: Object.freeze(
          [...installedNames].filter(name => !enabledBusiness.has(name)).sort(),
        ),
        directBusinessSkillNames: candidate.directBusinessSkillNames,
        enabledAdoptedSkillIds: Object.freeze(installed.items.filter(item => item.publication && enabledBusiness.has(item.name)).map(item => item.publication!.publicationId).sort()),
      })
      await this.writeStoredUserSkillPolicy(stored)
      try {
        await this.applyOptionalSystemSkillPolicy(candidate.enabledOptionalSystemSkillNames)
      } catch (error) {
        const rollbackErrors: unknown[] = [error]
        try { await this.writeStoredUserSkillPolicy(current) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
        try { await this.applyOptionalSystemSkillPolicy(current.enabledOptionalSystemSkillNames) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
        if (rollbackErrors.length > 1) {
          throw new AggregateError(rollbackErrors, 'Optional System Skill 生命周期切换失败且回滚不完整')
        }
        throw error
      }
      return candidate
    })
    this.policyMutation = operation.then(() => undefined, () => undefined)
    const result = await operation
    await this.refreshAfterDurableMutation()
    return result
  }

  /** Change exactly one adopted Skill preference, not system capabilities or
   * enterprise assignment. Legacy policy files are upgraded only on this write. */
  async setAdoptedSkillPreference(input: SkillAdoptedPreferenceInput): Promise<Readonly<SkillAdoptedPreferenceResult>> {
    const selected = readSkillAdoptedPreferenceInput(input)
    const signal = AbortSignal.any([this.adoptedLifetime.signal, AbortSignal.timeout(30_000)])
    signal.throwIfAborted()
    if (this.preferenceWrites >= 2) throw new Error('企业技能使用意愿正在保存，请稍后重试')
    this.preferenceWrites += 1
    try {
      await this.ensureLifecycleReady(); signal.throwIfAborted()
      const operation = this.policyMutation.then(async () => {
        signal.throwIfAborted()
        const current = await this.readStoredUserSkillPolicy()
        if (current.revision !== selected.expectedRevision || current.revision >= Number.MAX_SAFE_INTEGER) throw new Error('用户技能策略已变化，请刷新后重试')
        await this.readAdoptedSkill(selected.reference, signal, false)
        const enabled = new Set(current.enabledAdoptedSkillIds), disabled = new Set(current.disabledBusinessSkillNames)
        const direct = new Set(current.directBusinessSkillNames), { name, publicationId } = selected.reference
        if (selected.field === 'direct' && selected.value && (!enabled.has(publicationId) || disabled.has(name))) throw new Error('请先明确允许使用这个企业技能')
        const authorize = selected.value ? this.adoptedEligibilityCheck(selected.reference, signal) : undefined
        await authorize?.()
        if (selected.field === 'enabled') {
          if (selected.value) { enabled.add(publicationId); disabled.delete(name) }
          else { enabled.delete(publicationId); disabled.add(name); direct.delete(name) }
        } else if (selected.value) direct.add(name)
        else direct.delete(name)
        if (enabled.size > 128) throw new Error('企业技能启用意愿数量超限')
        const stored: StoredUserSkillPolicyV4 = Object.freeze({ ...current, revision: current.revision + 1,
          enabledAdoptedSkillIds: Object.freeze([...enabled].sort()), disabledBusinessSkillNames: Object.freeze([...disabled].sort()),
          directBusinessSkillNames: Object.freeze([...direct].sort()) })
        await this.readAdoptedSkill(selected.reference, signal, false); await authorize?.(); signal.throwIfAborted()
        await this.writeStoredUserSkillPolicy(stored)
        // A committed preference is not permission. Later revocation need not
        // erase it; scope and execution always consult current assignment.
        const isEnabled = enabled.has(publicationId) && !disabled.has(name)
        return Object.freeze({ reference: selected.reference, revision: stored.revision, enabled: isEnabled,
          direct: isEnabled && direct.has(name), runtimeGrant: false as const })
      })
      this.policyMutation = operation.then(() => undefined, () => undefined)
      const result = await operation
      await this.refreshAfterDurableMutation()
      return result
    } finally { this.preferenceWrites -= 1 }
  }

  async getSkillSource(input: { readonly skillId: string }): Promise<Readonly<SkillSourceDocument>> {
    await this.migrateLegacyManagedSkills()
    if (!SKILL_NAME.test(input.skillId)) throw new Error('Skill 名称无效')
    const root = join(this.skillRoot, input.skillId)
    const skillFile = join(root, 'SKILL.md')
    if (!contained(this.skillRoot, root) || !(await pathExists(skillFile))) throw new Error('Skill 不存在')
    await assertNoSkillPackageSymlink(root, 'SKILL.md')
    const source = await readFile(skillFile, 'utf8')
    const document = skillDocumentParts(source)
    const managed = await readInstallManifest(join(root, INSTALL_MANIFEST)) !== undefined
    return Object.freeze({
      skillId: input.skillId,
      ...document.metadata,
      instructions: document.instructions,
      digest: digestText(source),
      managed,
    })
  }

  async saveSkillSource(input: SkillSourceSaveInput): Promise<Readonly<SkillInstallResult>> {
    return this.withPackageMutation(() => this.saveSkillSourceNow(input))
  }

  private async saveSkillSourceNow(input: SkillSourceSaveInput): Promise<Readonly<SkillInstallResult>> {
    await this.migrateLegacyManagedSkills()
    const name = boundedAuthoringText(input.name, 63, 'Skill name')
    if (!SKILL_NAME.test(name)) throw new Error('Skill name 必须使用小写字母、数字和连字符')
    await this.assertNoSystemSkillCollision(name)
    const destination = join(this.skillRoot, name)
    await this.assertMutableSkill(destination)
    if (!contained(this.skillRoot, destination)) throw new Error('Skill 保存目标越界')
    const existing = await pathExists(destination)
    const existingFile = join(destination, 'SKILL.md')
    const existingSource = existing ? await readFile(existingFile, 'utf8') : undefined
    const previous = existing ? await readInstallManifest(join(destination, INSTALL_MANIFEST)) : undefined
    if (existing && previous === undefined) throw new Error('外部安装的 Skill 只能由原来源管理')
    if (existing && input.expectedDigest === undefined) throw new Error('Skill 已存在，请从已安装列表进入编辑')
    if (!existing && input.expectedDigest !== undefined) throw new Error('Skill 已被移除，请刷新后重试')
    if (existingSource !== undefined && digestText(existingSource) !== input.expectedDigest) throw new Error('Skill 内容已更新，请刷新后重试')

    const source = serializeSkillDocument(input, existingSource)
    const savedMetadata = parseSkillMetadata(source)
    const digest = digestText(source)
    const staging = join(this.stagingRoot, `${name}-authoring-${randomUUID()}`)
    const backup = join(this.backupRoot, `${name}-${this.now()}-${randomUUID()}`)
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
    if (existing) await cp(destination, staging, { recursive: true, errorOnExist: true })
    else await mkdir(staging, { recursive: true, mode: 0o700 })
    let movedPrevious = false
    try {
      await writeFile(join(staging, 'SKILL.md'), source, { mode: 0o600 })
      const now = this.now()
      const record: SkillInstallRecord = Object.freeze({
        skillId: name, name,
        description: savedMetadata.description,
        ...(savedMetadata.whenToUse === undefined ? {} : { whenToUse: savedMetadata.whenToUse }),
        digest, sourceFileName: previous?.sourceFileName ?? 'Skill Center authoring',
        installedAt: previous?.installedAt ?? now, updatedAt: now, managed: true,
        runtimeRequirements: previous?.runtimeRequirements ?? Object.freeze([]),
      })
      await writeFile(join(staging, INSTALL_MANIFEST), `${JSON.stringify(installManifest(record), null, 2)}\n`, { mode: 0o600 })
      await mkdir(this.skillRoot, { recursive: true, mode: 0o700 })
      if (existing) { await rename(destination, backup); movedPrevious = true }
      await rename(staging, destination)
      const result = Object.freeze({ operation: existing ? 'updated' as const : 'installed' as const, record })
      await this.refreshAfterDurableMutation()
      return result
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      if (movedPrevious && !(await pathExists(destination))) await rename(backup, destination)
      throw error
    }
  }

  /** Trusted same-process/private-cell operations only: deliberately NOT marked
   * Remote, declared in Typert, or exposed as a browser native RPC. */
  beginPublicationExport(input: SkillPublicationSelection, signal?: AbortSignal): Promise<Readonly<SkillPublicationExport>> {
    return this.publicationExports.begin(input, signal)
  }

  beginPublicationAdoption(input: SkillPublicationAdoptionInput, signal?: AbortSignal): Promise<SkillPublicationImportStart> {
    return this.publicationImports.begin(input, signal)
  }

  writePublicationAdoption(input: SkillPublicationImportChunk, signal?: AbortSignal) {
    return this.publicationImports.write(input, signal)
  }

  commitPublicationAdoption(input: { readonly importId: string }, signal?: AbortSignal): Promise<Readonly<SkillPublicationAdoption>> {
    return this.publicationImports.commit(input, signal)
  }

  releasePublicationAdoption(input: { readonly importId: string }) {
    return this.publicationImports.release(input)
  }

  getAdoptedSkillPublication(input: SkillPublicationAdoptionInput, signal?: AbortSignal): Promise<Readonly<SkillPublicationAdoption>> {
    const selected = readSkillPublicationAdoptionInput(input)
    return this.withPackageMutation(async () => {
      const receipt = await this.readAdoptedSkill(selected, signal ?? new AbortController().signal, false)
      if (!receipt) throw new Error('企业 Skill 采用版本不存在')
      return receipt
    })
  }

  private async assertMutableSkill(root: string): Promise<void> {
    const receipt = await readInstallManifest(join(root, INSTALL_MANIFEST))
    if (receipt?.publication) throw new Error('企业 Skill 发布版本只读，不能编辑、覆盖或卸载其历史内容')
  }

  private async readAdoptedSkill(input: SkillPublicationAdoptionInput, signal: AbortSignal, allowMissing: boolean): Promise<Readonly<SkillPublicationAdoption> | undefined> {
    const selected = readSkillPublicationAdoptionInput(input)
    await this.migrateLegacyManagedSkills(); signal.throwIfAborted()
    await this.assertNoSystemSkillCollision(selected.name)
    const root = join(this.skillRoot, selected.name)
    const info = await lstat(root).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
    if (!info && allowMissing) return undefined
    if (!info?.isDirectory() || await realpath(root) !== root) throw new Error('企业 Skill 采用目录不存在或被替换')
    const manifestPath = join(root, INSTALL_MANIFEST), manifestInfo = await lstat(manifestPath)
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.nlink !== 1 || manifestInfo.size > METADATA_SCAN_BYTES) {
      throw new Error('企业 Skill 采用回执无效')
    }
    const record = await readInstallManifest(manifestPath)
    if (!record?.publication) throw new Error('同名个人 Skill 已存在，不能覆盖或借用')
    const { schema: _schema, adoptedAt: _at, ...origin } = record.publication
    if (JSON.stringify(origin) !== JSON.stringify(selected)) throw new Error('同名 Skill 已由其他发布版本占用')
    const entries = await skillPackageInventory(root, signal)
    if (skillPackageDigest(entries) !== selected.packageDigest || entries.length !== selected.entryCount
      || entries.reduce((sum, entry) => sum + entry.size, 0) !== selected.expandedBytes) throw new Error('企业 Skill 完整内容已变化，不会自动修复')
    const metadata = parseSkillMetadata(await readPrefix(join(root, 'SKILL.md')))
    if (metadata.name !== selected.name || metadata.description !== record.description || metadata.whenToUse !== record.whenToUse) {
      throw new Error('企业 Skill 元数据已变化')
    }
    signal.throwIfAborted(); return record.publication
  }

  private async installPublishedSkill(input: SkillPublicationAdoptionInput, archivePath: string, signal: AbortSignal): Promise<Readonly<SkillPublicationAdoption>> {
    const selected = readSkillPublicationAdoptionInput(input)
    const previous = await this.readAdoptedSkill(selected, signal, true)
    if (previous) return previous
    signal.throwIfAborted()
    if (await digestFile(archivePath, signal) !== selected.archiveDigest) throw new Error('企业 Skill 归档摘要不一致')
    const inspection = await inspectZip(archivePath, undefined, signal)
    if (inspection.metadata.name !== selected.name || inspection.rootPrefix !== '' || inspection.entries.length !== selected.entryCount
      || inspection.expandedBytes !== selected.expandedBytes) throw new Error('企业 Skill 归档结构与发布版本不一致')
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    if (await realpath(this.stagingRoot) !== this.stagingRoot) throw new Error('企业 Skill 暂存目录被替换')
    const staging = await mkdtemp(join(this.stagingRoot, 'enterprise-')), stageIdentity = await lstat(staging)
    const destination = join(this.skillRoot, selected.name)
    let promoted = false
    try {
      await extractZip(archivePath, inspection, staging, signal)
      signal.throwIfAborted()
      const entries = await skillPackageInventory(staging, signal)
      if (skillPackageDigest(entries) !== selected.packageDigest || entries.length !== selected.entryCount
        || await digestFile(archivePath, signal) !== selected.archiveDigest) throw new Error('企业 Skill 解压后完整版本不一致')
      const publication = readSkillPublicationAdoption({ ...selected, schema: 'paimind.skill-adoption/v1', adoptedAt: this.now() })
      const record: SkillInstallRecord = { skillId: selected.name, ...inspection.metadata, digest: selected.archiveDigest,
        sourceFileName: 'Enterprise Skill publication', installedAt: publication.adoptedAt, updatedAt: publication.adoptedAt,
        managed: true, runtimeRequirements: inspection.runtimeRequirements, publication }
      await writeFile(join(staging, INSTALL_MANIFEST), `${JSON.stringify(installManifest(record), null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      await mkdir(this.skillRoot, { recursive: true, mode: 0o700 })
      if (await realpath(this.skillRoot) !== this.skillRoot) throw new Error('企业 Skill 目标仓库被替换')
      await this.assertNoSystemSkillCollision(selected.name); signal.throwIfAborted()
      const occupied = await lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
      if (occupied) throw new Error('企业 Skill 目标已被占用，保留现有内容')
      await rename(staging, destination); promoted = true
      const checked = await this.readAdoptedSkill(selected, signal, false)
      if (!checked) throw new Error('企业 Skill 提升后无法确认准确版本')
      await this.refreshAfterDurableMutation()
      return checked
    } finally {
      if (!promoted) {
        const current = await lstat(staging).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
        if (current) {
          if (!current.isDirectory() || current.dev !== stageIdentity.dev || current.ino !== stageIdentity.ino || await realpath(staging) !== staging) {
            throw new Error('企业 Skill 暂存目标被替换，保留现场')
          }
          await rm(staging, { recursive: true })
        }
      }
    }
  }

  readPublicationExport(input: { readonly exportId: string; readonly offset: number }, signal?: AbortSignal): Promise<Readonly<SkillPublicationChunk>> {
    return this.publicationExports.read(input, signal)
  }

  releasePublicationExport(input: { readonly exportId: string }): Promise<Readonly<{ exportId: string; released: true }>> {
    return this.publicationExports.release(input)
  }

  private async readPublicationSource(selection: SkillPublicationSelection, signal: AbortSignal): Promise<SkillPublicationSource> {
    signal.throwIfAborted(); await this.migrateLegacyManagedSkills(); signal.throwIfAborted()
    await this.assertNoSystemSkillCollision(selection.skillId); signal.throwIfAborted()
    const root = join(this.skillRoot, selection.skillId)
    if (await realpath(this.skillRoot) !== this.skillRoot || await realpath(root) !== root) throw new Error('Skill 发布来源路径无效')
    await assertNoSkillPackageSymlink(root, 'SKILL.md')
    const entries = await skillPackageInventory(root, signal)
    if (!entries.some(entry => entry.path === 'SKILL.md' && entry.kind === 'binary')) throw new Error('Skill 发布入口缺失')
    const metadata = parseSkillMetadata(await readPrefix(join(root, 'SKILL.md')))
    const manifestPath = join(root, INSTALL_MANIFEST), info = await lstat(manifestPath)
    if (!info.isFile() || info.nlink !== 1 || await realpath(manifestPath) !== manifestPath) throw new Error('Skill 发布需要受管来源')
    const manifest = await readInstallManifest(manifestPath)
    if (metadata.name !== selection.skillId || manifest?.skillId !== selection.skillId || manifest.name !== selection.skillId) {
      throw new Error('Skill 发布来源身份不一致')
    }
    const digest = skillPackageDigest(entries)
    signal.throwIfAborted()
    if (digest !== selection.expectedDigest) throw new Error('Skill 发布来源版本已变化')
    return Object.freeze({ root, entries, digest })
  }

  private adoptedEligibilityCheck(reference: SkillPublicationAdoptionInput, signal: AbortSignal): () => Promise<void> {
    const provider = this.installerCtx.get?.('paimindEnterpriseSkillEligibility') as {
      read?: (references: readonly SkillPublicationAdoptionInput[], signal: AbortSignal) => Promise<unknown>
    } | undefined
    if (!provider || typeof provider.read !== 'function') throw new Error('当前企业分配资格服务不可用')
    return async () => {
      signal.throwIfAborted()
      if (this.installerCtx.get?.('paimindEnterpriseSkillEligibility') !== provider) throw new Error('企业分配资格提供方已变化')
      let stop!: () => void
      const cancelled = new Promise<never>((_resolve, reject) => {
        stop = () => reject(signal.reason); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
      })
      try {
        const result = await Promise.race([Promise.resolve().then(() => provider.read!([reference], signal)), cancelled])
        signal.throwIfAborted()
        if (this.installerCtx.get?.('paimindEnterpriseSkillEligibility') !== provider || !Array.isArray(result)
          || result.length !== 1 || result[0] !== reference.publicationId) throw new Error('当前企业技能分配不可用，操作已拒绝')
      } finally { signal.removeEventListener('abort', stop) }
    }
  }

  /** Bounded bytes from this native owner's exact adopted version. The gateway
   * independently owns the current login; the provider owns current assignment.
   * Neither an install receipt nor an earlier read grants future access. */
  async readAdoptedSkillContent(input: SkillAdoptedContentInput): Promise<Readonly<SkillAdoptedContent>> {
    const selected = readSkillAdoptedContentInput(input)
    const signal = AbortSignal.any([this.adoptedLifetime.signal, AbortSignal.timeout(30_000)])
    signal.throwIfAborted()
    if (this.contentReads >= 2) throw new Error('已采用技能内容正在读取，请稍后重试')
    this.contentReads += 1
    try { return await this.withPackageMutation(async () => {
      signal.throwIfAborted()
      const authorize = this.adoptedEligibilityCheck(selected.reference, signal)
      await this.readAdoptedSkill(selected.reference, signal, false); await authorize()
      const root = join(this.skillRoot, selected.reference.name)
      let result: SkillAdoptedContent
      if (selected.kind === 'directory') {
        const page = await listSkillPackageDirectoryPage(root, { path: selected.path, limit: 100,
          ...(selected.cursor === undefined ? {} : { cursor: selected.cursor }) })
        result = { reference: selected.reference, runtimeGrant: false, kind: 'directory', page }
      } else {
        const path = safeSkillPackageFilePath(selected.path), target = join(root, path)
        await assertNoSkillPackageSymlink(root, path); signal.throwIfAborted()
        const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const before = await file.stat()
          if (!before.isFile() || before.nlink !== 1 || before.size > selected.reference.expandedBytes
            || (before.size === 0 ? selected.offset !== 0 : selected.offset >= before.size)) throw new Error('已采用技能文件或偏移无效')
          const bytes = Buffer.alloc(Math.min(SKILL_ADOPTED_CONTENT_BYTES, before.size - selected.offset))
          for (let offset = 0; offset < bytes.length;) {
            signal.throwIfAborted()
            const read = await file.read(bytes, offset, bytes.length - offset, selected.offset + offset)
            if (!read.bytesRead) throw new Error('已采用技能文件读取不完整')
            offset += read.bytesRead
          }
          const after = await file.stat(), current = await lstat(target)
          await assertNoSkillPackageSymlink(root, path)
          for (const actual of [after, current]) {
            if (!actual.isFile() || actual.nlink !== 1 || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => actual[key as keyof typeof actual] !== before[key as keyof typeof before])) {
              throw new Error('已采用技能文件在读取中变化')
            }
          }
          const next = selected.offset + bytes.length
          result = { reference: selected.reference, runtimeGrant: false, kind: 'file', path, size: before.size,
            offset: selected.offset, data: bytes.toString('base64'), nextOffset: next < before.size ? next : null }
        } finally { await file.close() }
      }
      await this.readAdoptedSkill(selected.reference, signal, false); await authorize(); signal.throwIfAborted()
      return Object.freeze(result)
    }) } finally { this.contentReads -= 1 }
  }

  async getSkillPackage(input: { readonly skillId: string }): Promise<Readonly<SkillPackageDocument>> {
    await this.migrateLegacyManagedSkills()
    if (!SKILL_NAME.test(input.skillId)) throw new Error('Skill 名称无效')
    const root = join(this.skillRoot, input.skillId)
    const skillFile = join(root, 'SKILL.md')
    if (!contained(this.skillRoot, root) || !(await pathExists(skillFile))) throw new Error('Skill 不存在')
    await assertNoSkillPackageSymlink(root, 'SKILL.md')
    const metadata = parseSkillMetadata(await readPrefix(skillFile))
    if (metadata.name !== input.skillId) throw new Error('Skill 目录名与 SKILL.md 身份不一致')
    const managed = await readInstallManifest(join(root, INSTALL_MANIFEST)) !== undefined
    return Object.freeze({
      skillId: input.skillId,
      ...metadata,
      digest: await skillPackageRevision(root),
      managed,
      root: await listSkillPackageDirectoryPage(root, {}),
    })
  }

  async listSkillPackageDirectory(input: {
    readonly skillId: string
    readonly path?: string
    readonly cursor?: string
    readonly limit?: number
  }): Promise<Readonly<SkillPackageDirectoryPage>> {
    await this.migrateLegacyManagedSkills()
    if (!SKILL_NAME.test(input.skillId)) throw new Error('Skill 名称无效')
    const root = join(this.skillRoot, input.skillId)
    if (!contained(this.skillRoot, root) || !(await pathExists(join(root, 'SKILL.md')))) throw new Error('Skill 不存在')
    await assertNoSkillPackageSymlink(root, 'SKILL.md')
    return await listSkillPackageDirectoryPage(root, input)
  }

  async readSkillPackageFile(input: { readonly skillId: string; readonly path: string }): Promise<Readonly<SkillPackageFile>> {
    await this.migrateLegacyManagedSkills()
    if (!SKILL_NAME.test(input.skillId)) throw new Error('Skill 名称无效')
    const root = join(this.skillRoot, input.skillId)
    if (!contained(this.skillRoot, root) || !(await pathExists(join(root, 'SKILL.md')))) throw new Error('Skill 不存在')
    await assertNoSkillPackageSymlink(root, 'SKILL.md')
    return await readSkillPackageFile(root, input.path)
  }

  async saveSkillPackage(input: SkillPackageSaveInput): Promise<Readonly<SkillInstallResult>> {
    return this.withPackageMutation(() => this.saveSkillPackageNow(input))
  }

  private async withPackageMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.packageMutation.then(operation, operation)
    this.packageMutation = run.then(() => undefined, () => undefined)
    return await run
  }

  private async saveSkillPackageNow(input: SkillPackageSaveInput): Promise<Readonly<SkillInstallResult>> {
    await this.migrateLegacyManagedSkills()
    const changes = normalizedPackageChanges(input)
    const existingId = input.skillId
    if (existingId !== undefined && !SKILL_NAME.test(existingId)) throw new Error('Skill 名称无效')
    const existingRoot = existingId === undefined ? undefined : join(this.skillRoot, existingId)
    const skillChange = changes.find(change => change.path === 'SKILL.md' && change.operation === 'write')
    const skillSource = skillChange?.operation === 'write'
      ? skillChange.content
      : existingRoot === undefined ? undefined : await readFile(join(existingRoot, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (skillSource === undefined) throw new Error('新建 Skill 必须写入根目录 SKILL.md')
    const metadata = parseSkillMetadata(skillSource)
    if (existingId !== undefined && existingId !== metadata.name) throw new Error('已安装 Skill 不能通过文件编辑器更改身份名称')
    const skillId = existingId ?? metadata.name
    await this.assertNoSystemSkillCollision(skillId)
    const destination = join(this.skillRoot, skillId)
    await this.assertMutableSkill(destination)
    if (!contained(this.skillRoot, destination)) throw new Error('Skill 保存目标越界')
    const existing = await pathExists(destination)
    if (existing !== (existingId !== undefined)) {
      throw new Error(existing ? 'Skill 已存在，请从已安装列表进入编辑' : 'Skill 已被移除，请刷新后重试')
    }

    let previous: SkillInstallRecord | undefined
    if (existing) {
      await assertNoSkillPackageSymlink(destination)
      await scanSkillPackageFiles(destination)
      previous = await readInstallManifest(join(destination, INSTALL_MANIFEST))
      if (previous === undefined) throw new Error('外部安装的 Skill 只能由原来源管理')
      if (input.expectedDigest === undefined) throw new Error('缺少 Skill Package 并发摘要')
      if (await skillPackageRevision(destination) !== input.expectedDigest) throw new Error('Skill 文件夹已更新，请刷新后重试')
    } else if (input.expectedDigest !== undefined) throw new Error('新建 Skill 不接受旧版本摘要')

    const staging = join(this.stagingRoot, `${skillId}-package-${randomUUID()}`)
    const backup = join(this.backupRoot, `${skillId}-${this.now()}-${randomUUID()}`)
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 })
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
    if (existing) await cp(destination, staging, { recursive: true, errorOnExist: true })
    else await mkdir(staging, { recursive: true, mode: 0o700 })
    let movedPrevious = false
    try {
      for (const change of changes) {
        const target = join(staging, change.path)
        if (!contained(staging, target)) throw new Error(`Skill 文件保存路径越界：${change.path}`)
        await assertNoSkillPackageSymlink(staging, change.path, true)
        const current = await lstat(target).catch(() => undefined)
        if (current?.isSymbolicLink()) throw new Error(`Skill 包含不受支持的符号链接：${change.path}`)
        if (change.operation === 'mkdir') {
          if (current !== undefined) throw new Error(`Skill 目录已存在，请刷新目录后重试：${change.path}`)
          const parent = await lstat(dirname(target)).catch(() => undefined)
          if (parent === undefined || parent.isSymbolicLink() || !parent.isDirectory()) {
            throw new Error(`Skill 父目录不存在，请先显式创建：${change.path}`)
          }
          await mkdir(target, { mode: 0o700 })
          continue
        }
        if (change.expectedDigest !== undefined) {
          if (current === undefined || !current.isFile()) throw new Error(`Skill 文件已变化，请刷新后重试：${change.path}`)
          const currentDigest = await digestFile(target)
          if (currentDigest !== change.expectedDigest) throw new Error(`Skill 文件已变化，请刷新后重试：${change.path}`)
        }
        if (change.operation === 'write' && change.expectedDigest === undefined && current !== undefined) {
          throw new Error(`Skill 文件已存在，请刷新目录后重试：${change.path}`)
        }
        if (change.operation === 'delete') {
          if (current === undefined || !current.isFile()) throw new Error(`Skill 文件不存在：${change.path}`)
          await rm(target, { force: true })
          continue
        }
        if (current?.isDirectory()) throw new Error(`Skill 路径已被目录占用：${change.path}`)
        const parent = await lstat(dirname(target)).catch(() => undefined)
        if (parent === undefined || parent.isSymbolicLink() || !parent.isDirectory()) {
          throw new Error(`Skill 父目录不存在，请先显式创建：${change.path}`)
        }
        await writeFile(target, change.content, { mode: 0o600 })
      }
      const checked = parseSkillMetadata(await readPrefix(join(staging, 'SKILL.md')))
      if (checked.name !== skillId) throw new Error('保存内容与 Skill 身份不一致')
      const savedFiles = await scanSkillPackageFiles(staging)
      const digest = skillPackageDigest(savedFiles)
      const now = this.now()
      const record: SkillInstallRecord = Object.freeze({
        skillId, name: skillId, description: checked.description,
        ...(checked.whenToUse === undefined ? {} : { whenToUse: checked.whenToUse }),
        // Preserve the source-artifact digest used by market update checks;
        // package editing concurrency uses the independent folder revision.
        digest: previous?.digest ?? digest,
        sourceFileName: previous?.sourceFileName ?? 'Skill Center package editor',
        installedAt: previous?.installedAt ?? now,
        updatedAt: now,
        managed: true,
        runtimeRequirements: packageRuntimeRequirements(savedFiles),
      })
      await writeFile(join(staging, INSTALL_MANIFEST), `${JSON.stringify(installManifest(record), null, 2)}\n`, { mode: 0o600 })
      await mkdir(this.skillRoot, { recursive: true, mode: 0o700 })
      if (existing) { await rename(destination, backup); movedPrevious = true }
      await rename(staging, destination)
      const result = Object.freeze({ operation: existing ? 'updated' as const : 'installed' as const, record })
      await this.refreshAfterDurableMutation()
      return result
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      if (movedPrevious && !(await pathExists(destination))) await rename(backup, destination)
      throw error
    }
  }

  async getAuthoringDraft(input: { readonly sessionId: string }): Promise<Readonly<SkillAuthoringDraft> | null> {
    const sessionId = boundedAuthoringText(input.sessionId, 200, 'Session 标识')
    return this.authoringDrafts.get(sessionId) ?? null
  }

  async dismissAuthoringDraft(input: { readonly sessionId: string; readonly draftId: string }): Promise<Readonly<{ dismissed: boolean }>> {
    const sessionId = boundedAuthoringText(input.sessionId, 200, 'Session 标识')
    const draftId = boundedAuthoringText(input.draftId, 100, '草稿标识')
    const current = this.authoringDrafts.get(sessionId)
    if (current?.draftId !== draftId) return Object.freeze({ dismissed: false })
    this.authoringDrafts.delete(sessionId)
    return Object.freeze({ dismissed: true })
  }

  async uninstall(input: { readonly skillId: string; readonly version?: string }): Promise<Readonly<SkillRemovalRecord>> {
    return this.withPackageMutation(() => this.uninstallNow(input))
  }

  private async uninstallNow(input: { readonly skillId: string; readonly version?: string }): Promise<Readonly<SkillRemovalRecord>> {
    await this.migrateLegacyManagedSkills()
    if (!SKILL_NAME.test(input.skillId)) throw new Error('Skill 名称无效')
    const source = join(this.skillRoot, input.skillId)
    await this.assertMutableSkill(source)
    if (!contained(this.skillRoot, source) || !(await pathExists(source))) throw new Error('Skill 不存在')
    const manifest = await readInstallManifest(join(source, INSTALL_MANIFEST))
    if (manifest === undefined) throw new Error('只能从技能市场卸载由 PAIMind 安装的 Skill')
    if (input.version !== undefined && manifest.digest !== input.version) throw new Error('Skill 已更新，请刷新后重试')
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
    const removedAt = this.now()
    await rename(source, join(this.backupRoot, `${input.skillId}-${removedAt}-${randomUUID()}`))
    const result = Object.freeze({ skillId: input.skillId, removedAt, recoverable: true })
    await this.refreshAfterDurableMutation()
    return result
  }

  private upload(uploadId: string): UploadRecord {
    if (!UPLOAD_ID.test(uploadId)) throw new Error('上传标识无效')
    const upload = this.uploads.get(uploadId)
    if (upload === undefined) throw new Error('上传已失效，请重新选择文件')
    return upload
  }

  /** Move only PAIMind-managed packages out of Harness global discovery. */
  private async migrateLegacyManagedSkills(): Promise<void> {
    this.legacyMigration ??= this.runManagedSkillMigrations()
    await this.legacyMigration
  }

  private async runManagedSkillMigrations(): Promise<void> {
    if (this.legacySkillRoot !== null && this.legacySkillRoot !== this.skillRoot) {
      await this.runLegacyManagedSkillMigration()
    }
    await this.retireSystemSkillBusinessCopies()
  }

  private async runLegacyManagedSkillMigration(): Promise<void> {
    let entries
    try { entries = await readdir(this.legacySkillRoot!, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !SKILL_NAME.test(entry.name)) continue
      const source = join(this.legacySkillRoot!, entry.name)
      const sourceManifest = await readInstallManifest(join(source, INSTALL_MANIFEST))
      if (sourceManifest === undefined) continue
      await mkdir(this.skillRoot, { recursive: true, mode: 0o700 })
      const destination = join(this.skillRoot, entry.name)
      if (!(await pathExists(destination))) {
        await rename(source, destination)
        continue
      }
      const destinationManifest = await readInstallManifest(join(destination, INSTALL_MANIFEST))
      if (destinationManifest === undefined) throw new Error(`业务 Skill 仓库存在未托管的同名目录：${entry.name}`)
      await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
      const backup = join(this.backupRoot, `legacy-global-${entry.name}-${this.now()}-${randomUUID()}`)
      if (sourceManifest.updatedAt > destinationManifest.updatedAt) {
        await rename(destination, backup)
        try { await rename(source, destination) } catch (error) { await rename(backup, destination); throw error }
      } else {
        await rename(source, backup)
      }
    }
  }

  /** Retire only the two former catalog packages; user-authored same-name folders remain untouched. */
  private async retireSystemSkillBusinessCopies(): Promise<void> {
    for (const [name, formerSourceFileName] of RETIRED_SYSTEM_BUSINESS_SKILLS) {
      const source = join(this.skillRoot, name)
      const manifest = await readInstallManifest(join(source, INSTALL_MANIFEST))
      if (manifest?.sourceFileName !== formerSourceFileName) continue
      await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
      await rename(source, join(this.backupRoot, `retired-system-${name}-${this.now()}-${randomUUID()}`))
    }
  }
}
