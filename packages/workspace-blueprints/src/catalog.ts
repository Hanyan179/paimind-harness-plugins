import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import {
  PAIMIND_SKILL_NAME_PATTERN,
  definePaimindWorkspaceCompositionSnapshot,
  type PaimindWorkspaceCompositionLookup,
  type PaimindWorkspaceCompositionSnapshotV1,
} from '@paimind/contracts'
import type { PaimindHostWorkspaceRegistry } from '@paimind/harness-compat/host'
import {
  WORKSPACE_BLUEPRINT_CATEGORIES,
  WORKSPACE_BLUEPRINT_DIGEST_PATTERN,
  WORKSPACE_BLUEPRINT_ID_PATTERN,
  WORKSPACE_BLUEPRINT_VERSION_PATTERN,
  type WorkspaceBlueprintCatalogPage,
  type WorkspaceBlueprintCategory,
  type WorkspaceBlueprintComposition,
  type WorkspaceBlueprintDetail,
  type WorkspaceBlueprintDeleteEntryInput,
  type WorkspaceBlueprintIdentityInput,
  type WorkspaceBlueprintListInput,
  type WorkspaceBlueprintManifest,
  type WorkspaceBlueprintMaterializeInput,
  type WorkspaceBlueprintMaterializeResult,
  type WorkspaceBlueprintMutationInput,
  type WorkspaceBlueprintMutationResult,
  type WorkspaceBlueprintPublishInput,
  type WorkspaceBlueprintReadTextInput,
  type WorkspaceBlueprintTextFile,
  type WorkspaceBlueprintUpdateCompositionInput,
  type WorkspaceBlueprintWriteTextInput,
} from './contract.js'

export * from './contract.js'

const MANIFEST_SCHEMA = 'paimind.workspace-blueprint/v1' as const
const PROVENANCE_SCHEMA = 'paimind.workspace-blueprint-instance/v1' as const
const MAX_BLUEPRINT_FILES = 5_000
const MAX_BLUEPRINT_BYTES = 200 * 1024 * 1024
const MAX_BLUEPRINT_FILE_BYTES = 25 * 1024 * 1024
const MAX_RELATIVE_PATH_LENGTH = 500
const CONTROL = /[\u0000-\u001f\u007f]/
const FORBIDDEN_SEGMENTS = new Set(['.git', '.paimind', 'node_modules'])
const FORBIDDEN_FILES = new Set(['.DS_Store'])
const SENSITIVE_FILE = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i
const OPERATION_TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const SOURCE_EXCLUDED_SEGMENTS = new Set(['.paimind'])
const MAX_COMPOSITION_RECEIPT_BYTES = 64 * 1024

interface SourceManifest {
  readonly schema: typeof MANIFEST_SCHEMA
  readonly blueprintId: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly category: WorkspaceBlueprintCategory
  readonly tags: readonly string[]
  readonly source: 'builtin' | 'user'
  /**
   * Explicitly declared digests from an already-materialized release whose
   * bytes changed without a version bump. This is a narrow compatibility
   * bridge for existing receipts, not permission to mutate a published
   * package: every future content change must still publish a new version.
   */
  readonly compatibleReceiptDigests?: readonly `sha256:${string}`[]
  readonly digest?: string
  readonly fileCount?: number
  readonly totalBytes?: number
  readonly createdAt?: number
  readonly updatedAt?: number
  readonly composition: Readonly<WorkspaceBlueprintComposition>
}

interface ScannedEntry {
  readonly path: string
  readonly name: string
  readonly kind: 'directory' | 'text' | 'binary'
  readonly size: number
  readonly digest?: string
  readonly absolutePath: string
}

interface ScannedTree {
  readonly entries: readonly Readonly<ScannedEntry>[]
  readonly fileCount: number
  readonly totalBytes: number
  readonly digest: string
}

interface ScanTreeOptions {
  readonly excludedSegments?: ReadonlySet<string>
}

interface LoadedBlueprint {
  readonly manifest: Readonly<WorkspaceBlueprintManifest>
  readonly root: string
  readonly tree: Readonly<ScannedTree>
  readonly compatibleReceiptDigests: readonly `sha256:${string}`[]
}

interface CompositionReceipt {
  readonly schema: typeof PROVENANCE_SCHEMA
  readonly blueprintId: string
  readonly version: string
  readonly packageDigest: `sha256:${string}`
  readonly source: 'builtin' | 'user'
  readonly composition: Readonly<WorkspaceBlueprintComposition>
  readonly materializedAt: number
}

interface MaterializedWorkspaceBlueprint {
  readonly workspaceId: string
  readonly manifest: Readonly<WorkspaceBlueprintManifest>
}

export interface WorkspaceBlueprintCompositionValidator {
  validate(composition: Readonly<WorkspaceBlueprintComposition>): Promise<void>
}

export interface WorkspaceBlueprintCatalogOptions {
  readonly templatesRoot: string
  readonly userTemplatesRoot: string
  readonly now?: () => number
  readonly createId?: () => string
  readonly compositionValidator?: Readonly<WorkspaceBlueprintCompositionValidator>
}

function frozenUnique(values: readonly string[] | undefined, maximum: number): readonly string[] {
  return Object.freeze([...new Set((values ?? [])
    .map(value => value.trim())
    .filter(value => value !== '' && value.length <= 100 && !CONTROL.test(value)))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maximum))
}

function assertCategory(value: unknown): asserts value is WorkspaceBlueprintCategory {
  if (typeof value !== 'string' || value === 'all' || !WORKSPACE_BLUEPRINT_CATEGORIES.includes(value as never)) {
    throw new Error('Workspace Blueprint category is invalid')
  }
}

function assertBlueprintId(value: string): void {
  if (!WORKSPACE_BLUEPRINT_ID_PATTERN.test(value) || value.length > 100) throw new Error('Workspace Blueprint id is invalid')
}

function assertVersion(value: string): void {
  if (!WORKSPACE_BLUEPRINT_VERSION_PATTERN.test(value) || value.length > 100) throw new Error('Workspace Blueprint version is invalid')
}

function assertDigest(value: string): asserts value is `sha256:${string}` {
  if (!WORKSPACE_BLUEPRINT_DIGEST_PATTERN.test(value)) throw new Error('Workspace Blueprint digest is invalid')
}

function cleanText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`Workspace Blueprint ${field} is invalid`)
  const normalized = value.trim()
  if (normalized === '' || normalized.length > maximum || CONTROL.test(normalized)) {
    throw new Error(`Workspace Blueprint ${field} is invalid`)
  }
  return normalized
}

function assertOnlyKeys(value: object, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(`${label} contains unsupported fields`)
}

function parseComposition(value: unknown): Readonly<WorkspaceBlueprintComposition> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Workspace Blueprint composition is invalid')
  }
  assertOnlyKeys(value, new Set(['agent', 'businessSkills']), 'Workspace Blueprint composition')
  const candidate = value as Partial<WorkspaceBlueprintComposition>
  const agent = candidate.agent === null
    ? null
    : typeof candidate.agent === 'object' && candidate.agent !== null && !Array.isArray(candidate.agent)
      ? (() => {
          assertOnlyKeys(candidate.agent, new Set(['agentId', 'presetId', 'configVersion']), 'Workspace Blueprint Agent binding')
          return Object.freeze({
            agentId: cleanText(candidate.agent.agentId, 'composition agentId', 200),
            presetId: cleanText(candidate.agent.presetId, 'composition presetId', 200),
            configVersion: cleanText(candidate.agent.configVersion, 'composition configVersion', 200),
          })
        })()
      : undefined
  if (agent === undefined || !Array.isArray(candidate.businessSkills) || candidate.businessSkills.length > 100) {
    throw new Error('Workspace Blueprint composition is invalid')
  }
  const names = new Set<string>()
  const businessSkills = candidate.businessSkills.map(binding => {
    if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) {
      throw new Error('Workspace Blueprint Business Skill binding is invalid')
    }
    assertOnlyKeys(binding, new Set(['name', 'digest']), 'Workspace Blueprint Business Skill binding')
    const name = cleanText(binding.name, 'Business Skill name', 100)
    if (!PAIMIND_SKILL_NAME_PATTERN.test(name)) throw new Error('Workspace Blueprint Business Skill name is invalid')
    assertDigest(binding.digest)
    if (names.has(name)) throw new Error(`Duplicate Workspace Blueprint Business Skill binding: ${name}`)
    names.add(name)
    return Object.freeze({ name, digest: binding.digest })
  }).sort((left, right) => left.name.localeCompare(right.name) || left.digest.localeCompare(right.digest))
  return Object.freeze({ agent, businessSkills: Object.freeze(businessSkills) })
}

function safeRelativePath(raw: string): string {
  const value = raw.trim()
  if (value === '' || value.includes('\\') || CONTROL.test(value) || isAbsolute(value)
    || value.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new Error(`Workspace Blueprint path is invalid: ${raw || '(empty)'}`)
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Workspace Blueprint path traversal is not allowed: ${raw}`)
  }
  return parts.join('/')
}

function assertPackagedPath(path: string): void {
  const parts = path.split('/')
  if (parts.some(part => FORBIDDEN_SEGMENTS.has(part)) || FORBIDDEN_FILES.has(parts.at(-1) ?? '')) {
    throw new Error(`Workspace Blueprint contains an excluded path: ${path}`)
  }
  if (parts.some(part => SENSITIVE_FILE.test(part))) {
    throw new Error(`Workspace Blueprint contains a sensitive path: ${path}`)
  }
}

function contained(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)
}

async function safeDirectoryRoot(path: string, label: string): Promise<string> {
  const absolute = resolve(path)
  if (absolute === parse(absolute).root) throw new Error(`${label} cannot be a filesystem root`)
  const info = await lstat(absolute).catch(() => undefined)
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} is not a safe directory`)
  // Installed packages are often reached through a pnpm/profile symlinked
  // ancestor. Reject only a symlink at the owned root and canonicalize the
  // ancestor spelling before containment checks.
  return await realpath(absolute)
}

function treeDigest(entries: readonly Pick<ScannedEntry, 'path' | 'kind' | 'size' | 'digest'>[]): string {
  const hash = createHash('sha256')
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(entry.kind).update('\0').update(entry.path).update('\0').update(String(entry.size)).update('\0')
    if (entry.digest !== undefined) hash.update(entry.digest)
    hash.update('\n')
  }
  return `sha256:${hash.digest('hex')}`
}

function blueprintDigest(source: SourceManifest, tree: ScannedTree): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify({
    schema: source.schema,
    blueprintId: source.blueprintId,
    version: source.version,
    name: source.name,
    description: source.description,
    category: source.category,
    tags: source.tags,
    source: source.source,
    composition: source.composition,
    filesDigest: tree.digest,
  }))
  return `sha256:${hash.digest('hex')}`
}

async function scanTree(rootInput: string, options: Readonly<ScanTreeOptions> = {}): Promise<ScannedTree> {
  const root = await safeDirectoryRoot(rootInput, 'Workspace Blueprint files root')
  const entries: ScannedEntry[] = []
  let fileCount = 0
  let totalBytes = 0

  const visit = async (relativePath: string): Promise<void> => {
    const path = safeRelativePath(relativePath)
    if (path.split('/').some(part => options.excludedSegments?.has(part) === true)) return
    assertPackagedPath(path)
    const absolutePath = join(root, ...path.split('/'))
    if (!contained(root, absolutePath)) throw new Error(`Workspace Blueprint path escapes its root: ${path}`)
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not supported in Workspace Blueprints: ${path}`)
    if (info.isDirectory()) {
      entries.push(Object.freeze({ path, name: basename(path), kind: 'directory', size: 0, absolutePath }))
      for (const child of (await readdir(absolutePath, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(`${path}/${child.name}`)
      }
      return
    }
    if (!info.isFile()) throw new Error(`Unsupported Workspace Blueprint entry type: ${path}`)
    if (info.size > MAX_BLUEPRINT_FILE_BYTES) throw new Error(`Workspace Blueprint file is too large: ${path}`)
    fileCount += 1
    totalBytes += info.size
    if (fileCount > MAX_BLUEPRINT_FILES) throw new Error(`Workspace Blueprint exceeds ${MAX_BLUEPRINT_FILES} files`)
    if (totalBytes > MAX_BLUEPRINT_BYTES) throw new Error('Workspace Blueprint exceeds the total size limit')
    const bytes = await readFile(absolutePath)
    let text = false
    if (!bytes.includes(0)) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); text = true } catch { text = false }
    }
    entries.push(Object.freeze({
      path,
      name: basename(path),
      kind: text ? 'text' : 'binary',
      size: info.size,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      absolutePath,
    }))
  }

  for (const name of (await readdir(root)).sort((left, right) => left.localeCompare(right))) await visit(name)
  const stable = Object.freeze(entries.sort((left, right) => left.path.localeCompare(right.path)))
  return Object.freeze({ fileCount, totalBytes, entries: stable, digest: treeDigest(stable) })
}

async function copyTree(tree: ScannedTree, targetRoot: string): Promise<void> {
  for (const entry of tree.entries) {
    const target = join(targetRoot, ...entry.path.split('/'))
    if (entry.kind === 'directory') await mkdir(target, { recursive: true, mode: 0o700 })
    else {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await copyFile(entry.absolutePath, target)
    }
  }
}

function parseSourceManifest(value: unknown, expectedSource: 'builtin' | 'user'): Readonly<SourceManifest> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Workspace Blueprint manifest is invalid')
  assertOnlyKeys(value, new Set([
    'schema', 'blueprintId', 'version', 'name', 'description', 'category', 'tags', 'source',
    'digest', 'fileCount', 'totalBytes', 'createdAt', 'updatedAt', 'composition', 'compatibleReceiptDigests',
  ]), 'Workspace Blueprint manifest')
  const candidate = value as Partial<SourceManifest>
  if (candidate.schema !== MANIFEST_SCHEMA || typeof candidate.blueprintId !== 'string'
    || typeof candidate.version !== 'string' || typeof candidate.name !== 'string'
    || typeof candidate.description !== 'string' || typeof candidate.category !== 'string') {
    throw new Error('Workspace Blueprint manifest is invalid')
  }
  assertBlueprintId(candidate.blueprintId)
  assertVersion(candidate.version)
  assertCategory(candidate.category)
  if (candidate.source !== expectedSource) throw new Error('Workspace Blueprint source is invalid')
  if (candidate.digest !== undefined) assertDigest(candidate.digest)
  if (candidate.fileCount !== undefined && (!Number.isSafeInteger(candidate.fileCount) || candidate.fileCount < 0)) {
    throw new Error('Workspace Blueprint file count is invalid')
  }
  if (candidate.totalBytes !== undefined && (!Number.isSafeInteger(candidate.totalBytes) || candidate.totalBytes < 0)) {
    throw new Error('Workspace Blueprint size is invalid')
  }
  if (candidate.compatibleReceiptDigests !== undefined
    && (!Array.isArray(candidate.compatibleReceiptDigests) || candidate.compatibleReceiptDigests.length > 20)) {
    throw new Error('Workspace Blueprint compatible receipt digests are invalid')
  }
  const compatibleReceiptDigests = Object.freeze([...new Set((candidate.compatibleReceiptDigests ?? []).map(value => {
    if (typeof value !== 'string') throw new Error('Workspace Blueprint compatible receipt digest is invalid')
    assertDigest(value)
    return value
  }))].sort((left, right) => left.localeCompare(right)))
  const createdAt = candidate.createdAt ?? 0
  const updatedAt = candidate.updatedAt ?? createdAt
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !Number.isSafeInteger(updatedAt) || updatedAt < createdAt) {
    throw new Error('Workspace Blueprint timestamps are invalid')
  }
  return Object.freeze({
    schema: MANIFEST_SCHEMA,
    blueprintId: candidate.blueprintId,
    version: candidate.version,
    name: cleanText(candidate.name, 'name', 120),
    description: cleanText(candidate.description, 'description', 2_000),
    category: candidate.category,
    tags: frozenUnique(candidate.tags, 20),
    source: expectedSource,
    compatibleReceiptDigests,
    ...(candidate.digest === undefined ? {} : { digest: candidate.digest }),
    ...(candidate.fileCount === undefined ? {} : { fileCount: candidate.fileCount }),
    ...(candidate.totalBytes === undefined ? {} : { totalBytes: candidate.totalBytes }),
    createdAt,
    updatedAt,
    composition: parseComposition(candidate.composition),
  })
}

function parseCompositionReceipt(value: unknown): Readonly<CompositionReceipt> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Workspace Blueprint composition receipt is invalid')
  }
  const candidate = value as Record<string, unknown>
  const expectedKeys = ['blueprintId', 'composition', 'materializedAt', 'packageDigest', 'schema', 'source', 'version']
  if (Object.keys(candidate).sort().join('\0') !== expectedKeys.join('\0')
    || candidate.schema !== PROVENANCE_SCHEMA
    || typeof candidate.blueprintId !== 'string'
    || typeof candidate.version !== 'string'
    || (candidate.source !== 'builtin' && candidate.source !== 'user')
    || typeof candidate.packageDigest !== 'string'
    || !Number.isSafeInteger(candidate.materializedAt)
    || (candidate.materializedAt as number) < 0) {
    throw new Error('Workspace Blueprint composition receipt is invalid')
  }
  assertBlueprintId(candidate.blueprintId)
  assertVersion(candidate.version)
  assertDigest(candidate.packageDigest)
  return Object.freeze({
    schema: PROVENANCE_SCHEMA,
    blueprintId: candidate.blueprintId,
    version: candidate.version,
    packageDigest: candidate.packageDigest,
    source: candidate.source,
    composition: parseComposition(candidate.composition),
    materializedAt: candidate.materializedAt as number,
  })
}

function sameComposition(
  left: Readonly<WorkspaceBlueprintComposition>,
  right: Readonly<WorkspaceBlueprintComposition>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readCompositionReceipt(path: string): Promise<Readonly<CompositionReceipt>> {
  let handle
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
    throw new Error('Workspace Blueprint composition receipt is unsafe', { cause: error })
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Workspace Blueprint composition receipt is unsafe')
    if (info.size > MAX_COMPOSITION_RECEIPT_BYTES) {
      throw new Error('Workspace Blueprint composition receipt is too large')
    }
    const buffer = Buffer.alloc(MAX_COMPOSITION_RECEIPT_BYTES + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > MAX_COMPOSITION_RECEIPT_BYTES) {
      throw new Error('Workspace Blueprint composition receipt is too large')
    }
    return parseCompositionReceipt(JSON.parse(buffer.subarray(0, offset).toString('utf8')))
  } finally {
    await handle.close()
  }
}

function manifestFromSource(source: SourceManifest, tree: ScannedTree): Readonly<WorkspaceBlueprintManifest> {
  const digest = blueprintDigest(source, tree)
  if (source.digest !== undefined && source.digest !== digest) throw new Error(`Workspace Blueprint digest mismatch: ${source.blueprintId}@${source.version}`)
  if (source.fileCount !== undefined && source.fileCount !== tree.fileCount) throw new Error(`Workspace Blueprint file count mismatch: ${source.blueprintId}@${source.version}`)
  if (source.totalBytes !== undefined && source.totalBytes !== tree.totalBytes) throw new Error(`Workspace Blueprint size mismatch: ${source.blueprintId}@${source.version}`)
  return Object.freeze({
    schema: MANIFEST_SCHEMA,
    blueprintId: source.blueprintId,
    version: source.version,
    name: source.name,
    description: source.description,
    category: source.category,
    tags: source.tags,
    source: source.source,
    digest,
    fileCount: tree.fileCount,
    totalBytes: tree.totalBytes,
    createdAt: source.createdAt ?? 0,
    updatedAt: source.updatedAt ?? source.createdAt ?? 0,
    composition: source.composition,
  })
}

function semverParts(version: string): readonly [number, number, number] {
  const [major = '0', minor = '0', patch = '0'] = version.split('-', 1)[0]!.split('.')
  return [Number(major), Number(minor), Number(patch)]
}

function compareVersions(left: string, right: string): number {
  const a = semverParts(left)
  const b = semverParts(right)
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return left.localeCompare(right)
}

function nextPatchVersion(baseVersion: string, occupied: ReadonlySet<string>): string {
  const [major, minor, patch] = semverParts(baseVersion)
  for (let next = patch + 1; Number.isSafeInteger(next); next += 1) {
    const candidate = `${major}.${minor}.${next}`
    if (!occupied.has(candidate)) return candidate
  }
  throw new Error('Workspace Blueprint patch version is exhausted')
}

/** Versioned built-in/user catalog and safe materializer over native Harness Workspaces. */
export class WorkspaceBlueprintCatalog {
  private readonly templatesRoot: string
  private readonly userTemplatesRoot: string
  private readonly now: () => number
  private readonly createId: () => string
  private readonly compositionValidator: Readonly<WorkspaceBlueprintCompositionValidator> | undefined
  private materializeTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly workspaceRegistry: PaimindHostWorkspaceRegistry,
    options: WorkspaceBlueprintCatalogOptions,
  ) {
    this.templatesRoot = resolve(options.templatesRoot)
    this.userTemplatesRoot = resolve(options.userTemplatesRoot)
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    this.compositionValidator = options.compositionValidator
  }

  private async validateComposition(composition: Readonly<WorkspaceBlueprintComposition>): Promise<void> {
    await this.compositionValidator?.validate(composition)
  }

  async listBlueprints(input: Readonly<WorkspaceBlueprintListInput> = {}): Promise<WorkspaceBlueprintCatalogPage> {
    const loaded = await this.loadAll()
    const query = (input.query ?? '').trim().toLocaleLowerCase()
    const category = input.category ?? 'all'
    const source = input.source ?? 'all'
    if (!WORKSPACE_BLUEPRINT_CATEGORIES.includes(category)) throw new Error('Workspace Blueprint category filter is invalid')
    if (source !== 'all' && source !== 'builtin' && source !== 'user') throw new Error('Workspace Blueprint source filter is invalid')

    const byId = new Map<string, LoadedBlueprint[]>()
    for (const blueprint of loaded) {
      const versions = byId.get(blueprint.manifest.blueprintId) ?? []
      versions.push(blueprint)
      byId.set(blueprint.manifest.blueprintId, versions)
    }
    const rows = [...byId.values()].map(versions => {
      const sorted = [...versions].sort((left, right) => compareVersions(left.manifest.version, right.manifest.version))
      const latest = sorted.at(-1)!
      return Object.freeze({
        ...latest.manifest,
        versionCount: sorted.length,
        files: Object.freeze(latest.tree.entries
          .filter((entry): entry is ScannedEntry & { readonly kind: 'text' | 'binary' } => entry.kind !== 'directory')
          .map(entry => Object.freeze({ path: entry.path, kind: entry.kind, size: entry.size }))),
      })
    }).filter(item => {
      if (category !== 'all' && item.category !== category) return false
      if (source !== 'all' && item.source !== source) return false
      if (query === '') return true
      return [item.name, item.description, item.blueprintId, item.category, ...item.tags]
        .some(value => value.toLocaleLowerCase().includes(query))
    }).sort((left, right) => left.name.localeCompare(right.name) || left.blueprintId.localeCompare(right.blueprintId))

    const cursor = input.cursor === undefined ? 0 : Number(input.cursor)
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Workspace Blueprint cursor is invalid')
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
    return Object.freeze({
      revision: rows.reduce((revision, item) => Math.max(revision, item.updatedAt), 0),
      items: Object.freeze(rows.slice(cursor, cursor + limit)),
      ...(cursor + limit < rows.length ? { nextCursor: String(cursor + limit) } : {}),
    })
  }

  async materializeBlueprint(input: Readonly<WorkspaceBlueprintMaterializeInput>): Promise<WorkspaceBlueprintMaterializeResult> {
    return await this.enqueueMaterialization(async () => {
      assertDigest(input.expectedDigest)
      const initialWorkspace = this.requireWorkspace(input.workspaceId)
      if (initialWorkspace.sessionIds.length !== 0) throw new Error('Workspace Blueprint target already has Sessions')
      const targetRoot = await safeDirectoryRoot(initialWorkspace.path, 'Workspace Blueprint target')
      if ((await readdir(targetRoot)).length !== 0) throw new Error('Workspace Blueprint target must be empty')

      const blueprint = await this.resolveBlueprint(input)
      if (blueprint.manifest.digest !== input.expectedDigest) throw new Error('Workspace Blueprint digest conflict')
      const token = this.createId()
      if (!OPERATION_TOKEN.test(token)) throw new Error('Workspace Blueprint operation id is invalid')
      const parent = dirname(targetRoot)
      const stage = join(parent, `.paimind-blueprint-stage-${token}`)
      const backup = join(parent, `.paimind-blueprint-empty-${token}`)
      const warnings: string[] = []
      let stageCreated = false
      let targetMoved = false
      let installed = false

      try {
        await mkdir(stage, { mode: 0o700 })
        stageCreated = true
        await copyTree(blueprint.tree, stage)
        const copied = await scanTree(stage)
        if (copied.digest !== blueprint.tree.digest) throw new Error('Workspace Blueprint materialization verification failed')
        const provenancePath = join(stage, '.paimind', 'workspace-blueprint.json')
        await mkdir(dirname(provenancePath), { recursive: true, mode: 0o700 })
        await writeFile(provenancePath, `${JSON.stringify({
          schema: PROVENANCE_SCHEMA,
          blueprintId: blueprint.manifest.blueprintId,
          version: blueprint.manifest.version,
          packageDigest: blueprint.manifest.digest,
          source: blueprint.manifest.source,
          composition: blueprint.manifest.composition,
          materializedAt: this.now(),
        }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })

        await this.validateComposition(blueprint.manifest.composition)
        const currentWorkspace = this.requireWorkspace(input.workspaceId)
        const currentRoot = await safeDirectoryRoot(currentWorkspace.path, 'Workspace Blueprint target')
        if (currentRoot !== targetRoot || currentWorkspace.sessionIds.length !== 0
          || (await readdir(targetRoot)).length !== 0) {
          throw new Error('Workspace Blueprint target changed before materialization')
        }
        await rename(targetRoot, backup)
        targetMoved = true
        if ((await readdir(backup)).length !== 0) {
          await rename(backup, targetRoot)
          targetMoved = false
          throw new Error('Workspace Blueprint target changed during materialization')
        }
        await rename(stage, targetRoot)
        installed = true
        try { await rmdir(backup) } catch {
          warnings.push(`The original empty Workspace directory remains recoverable at ${backup}`)
        }
        return Object.freeze({
          workspaceId: input.workspaceId,
          path: initialWorkspace.path,
          blueprintId: blueprint.manifest.blueprintId,
          version: blueprint.manifest.version,
          digest: blueprint.manifest.digest,
          warnings: Object.freeze(warnings),
        })
      } catch (error) {
        if (!installed && targetMoved) {
          const targetExists = await stat(targetRoot).then(() => true).catch(() => false)
          if (!targetExists) await rename(backup, targetRoot).catch(() => undefined)
        }
        if (!installed && stageCreated) await rm(stage, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async publishBlueprint(input: Readonly<WorkspaceBlueprintPublishInput>): Promise<WorkspaceBlueprintManifest> {
    return await this.enqueueMaterialization(async () => {
      assertBlueprintId(input.blueprintId)
      assertVersion(input.version)
      assertCategory(input.category)
      const workspace = this.requireWorkspace(input.workspaceId)
      const workspaceRoot = await safeDirectoryRoot(workspace.path, 'Workspace Blueprint publication source')
      const tree = await scanTree(workspaceRoot, { excludedSegments: SOURCE_EXCLUDED_SEGMENTS })
      const composition = parseComposition(input.composition)
      const builtins = await this.loadBuiltins()
      if (builtins.some(item => item.manifest.blueprintId === input.blueprintId)) {
        throw new Error(`Built-in Workspace Blueprint id is read-only: ${input.blueprintId}`)
      }
      const repositoryRoot = await this.ensureUserTemplatesRoot()
      const blueprintRoot = join(repositoryRoot, input.blueprintId)
      if (!contained(repositoryRoot, blueprintRoot)) throw new Error('User Workspace Blueprint target escapes its repository')
      await mkdir(blueprintRoot, { recursive: true, mode: 0o700 })
      const safeBlueprintRoot = await safeDirectoryRoot(blueprintRoot, 'User Workspace Blueprint identity root')
      if (!contained(repositoryRoot, safeBlueprintRoot)) throw new Error('User Workspace Blueprint identity root escapes its repository')
      const versionRoot = join(safeBlueprintRoot, input.version)
      if (await lstat(versionRoot).then(() => true).catch(() => false)) {
        throw new Error(`Workspace Blueprint version already exists: ${input.blueprintId}@${input.version}`)
      }
      const token = this.operationToken()
      const stage = join(repositoryRoot, `.paimind-blueprint-publish-${token}`)
      let stageCreated = false
      try {
        await mkdir(join(stage, 'files'), { recursive: true, mode: 0o700 })
        stageCreated = true
        await copyTree(tree, join(stage, 'files'))
        const copied = await scanTree(join(stage, 'files'))
        if (copied.digest !== tree.digest) throw new Error('Workspace Blueprint publication verification failed')
        const timestamp = this.now()
        const source: SourceManifest = Object.freeze({
          schema: MANIFEST_SCHEMA,
          blueprintId: input.blueprintId,
          version: input.version,
          name: cleanText(input.name, 'name', 120),
          description: cleanText(input.description, 'description', 2_000),
          category: input.category,
          tags: frozenUnique(input.tags, 20),
          source: 'user' as const,
          fileCount: copied.fileCount,
          totalBytes: copied.totalBytes,
          createdAt: timestamp,
          updatedAt: timestamp,
          composition,
        })
        const manifest = manifestFromSource(source, copied)
        await this.validateComposition(manifest.composition)
        await this.writeManifest(stage, manifest)
        await rename(stage, versionRoot)
        stageCreated = false
        return manifest
      } catch (error) {
        if (stageCreated) await rm(stage, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async getWorkspaceComposition(
    input: Readonly<PaimindWorkspaceCompositionLookup>,
  ): Promise<Readonly<PaimindWorkspaceCompositionSnapshotV1> | undefined> {
    const materialized = await this.getMaterializedWorkspaceBlueprint(input)
    if (materialized === undefined) return undefined
    return definePaimindWorkspaceCompositionSnapshot({
      schema: 'paimind.workspace-composition/v1',
      workspaceId: materialized.workspaceId,
      businessSkills: materialized.manifest.composition.businessSkills,
    })
  }

  /**
   * Resolve a trusted materialized package from the native Workspace registry
   * and its immutable receipt. Callers cannot substitute composition refs.
   */
  async getMaterializedWorkspaceBlueprint(
    input: Readonly<PaimindWorkspaceCompositionLookup>,
  ): Promise<Readonly<MaterializedWorkspaceBlueprint> | undefined> {
    const workspaces = this.workspaceRegistry.list()
    let workspace: ReturnType<PaimindHostWorkspaceRegistry['list']>[number] | undefined
    if ('workspaceId' in input) {
      workspace = workspaces.find(candidate => candidate.id === input.workspaceId)
    } else {
      const matches = workspaces.filter(candidate => candidate.sessionIds.includes(input.sessionId))
      if (matches.length > 1) throw new Error(`Harness Session belongs to multiple Workspaces: ${input.sessionId}`)
      workspace = matches[0]
    }
    if (workspace === undefined) return undefined
    const workspaceRoot = await safeDirectoryRoot(workspace.path, 'Workspace Blueprint composition Workspace')
    const metadataRoot = join(workspaceRoot, '.paimind')
    const metadataInfo = await lstat(metadataRoot).catch(() => undefined)
    if (metadataInfo === undefined) return undefined
    if (metadataInfo.isSymbolicLink() || !metadataInfo.isDirectory()) {
      throw new Error('Workspace Blueprint composition metadata root is unsafe')
    }
    const receiptPath = join(metadataRoot, 'workspace-blueprint.json')
    const receiptInfo = await lstat(receiptPath).catch(() => undefined)
    if (receiptInfo === undefined) return undefined
    if (receiptInfo.isSymbolicLink() || !receiptInfo.isFile()) {
      throw new Error('Workspace Blueprint composition receipt is unsafe')
    }
    if (receiptInfo.size > MAX_COMPOSITION_RECEIPT_BYTES) {
      throw new Error('Workspace Blueprint composition receipt is too large')
    }
    const receipt = await readCompositionReceipt(receiptPath)
    const blueprint = await this.resolveBlueprint({
      blueprintId: receipt.blueprintId,
      version: receipt.version,
    })
    const digestMatches = blueprint.manifest.digest === receipt.packageDigest
      || blueprint.compatibleReceiptDigests.includes(receipt.packageDigest)
    if (blueprint.manifest.source !== receipt.source
      || !digestMatches
      || !sameComposition(blueprint.manifest.composition, receipt.composition)) {
      throw new Error('Workspace Blueprint composition receipt does not match its immutable package')
    }
    return Object.freeze({
      workspaceId: workspace.id,
      manifest: blueprint.manifest,
    })
  }

  async getBlueprint(input: Readonly<WorkspaceBlueprintIdentityInput>): Promise<WorkspaceBlueprintDetail> {
    const blueprint = await this.resolveBlueprint(input)
    return Object.freeze({
      manifest: blueprint.manifest,
      entries: Object.freeze(blueprint.tree.entries.map(entry => Object.freeze({
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        ...(entry.digest === undefined ? {} : { digest: entry.digest }),
      }))),
    })
  }

  async readBlueprintText(input: Readonly<WorkspaceBlueprintReadTextInput>): Promise<WorkspaceBlueprintTextFile> {
    const blueprint = await this.resolveBlueprint(input)
    const path = safeRelativePath(input.path)
    assertPackagedPath(path)
    const entry = blueprint.tree.entries.find(candidate => candidate.path === path)
    if (entry === undefined || entry.kind !== 'text' || entry.digest === undefined) {
      throw new Error(`Workspace Blueprint text file not found: ${path}`)
    }
    return Object.freeze({
      blueprintId: blueprint.manifest.blueprintId,
      version: blueprint.manifest.version,
      blueprintDigest: blueprint.manifest.digest,
      path,
      digest: entry.digest,
      text: await readFile(entry.absolutePath, 'utf8'),
    })
  }

  async writeBlueprintText(input: Readonly<WorkspaceBlueprintWriteTextInput>): Promise<WorkspaceBlueprintMutationResult> {
    const bytes = Buffer.byteLength(input.text, 'utf8')
    if (bytes > MAX_BLUEPRINT_FILE_BYTES) throw new Error('Workspace Blueprint file is too large')
    return await this.mutateUserBlueprint(input, async filesRoot => {
      const target = await this.safeMutationTarget(filesRoot, input.path)
      const existing = await lstat(target).catch(() => undefined)
      if (existing?.isSymbolicLink() === true || existing?.isDirectory() === true) {
        throw new Error(`Workspace Blueprint file target is unsafe: ${input.path}`)
      }
      await writeFile(target, input.text, { encoding: 'utf8', mode: 0o600 })
    })
  }

  async createBlueprintDirectory(input: Readonly<WorkspaceBlueprintMutationInput>): Promise<WorkspaceBlueprintMutationResult> {
    return await this.mutateUserBlueprint(input, async filesRoot => {
      const target = await this.safeMutationTarget(filesRoot, input.path)
      await mkdir(target, { mode: 0o700 })
    })
  }

  async deleteBlueprintFile(input: Readonly<WorkspaceBlueprintDeleteEntryInput>): Promise<WorkspaceBlueprintMutationResult> {
    return await this.mutateUserBlueprint(input, async filesRoot => {
      const target = await this.safeMutationTarget(filesRoot, input.path)
      const info = await lstat(target).catch(() => undefined)
      if (info === undefined || info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        throw new Error(`Workspace Blueprint entry not found: ${input.path}`)
      }
      if (info.isDirectory()) {
        if (input.recursive === true) await rm(target, { recursive: true })
        else {
          if ((await readdir(target)).length !== 0) {
            throw new Error(`Workspace Blueprint non-empty directory deletion requires recursive=true: ${input.path}`)
          }
          await rmdir(target)
        }
      } else {
        await rm(target)
      }
    })
  }

  async updateBlueprintComposition(
    input: Readonly<WorkspaceBlueprintUpdateCompositionInput>,
  ): Promise<WorkspaceBlueprintMutationResult> {
    const composition = parseComposition(input.composition)
    return await this.mutateUserBlueprint(input, async () => undefined, composition)
  }

  private requireWorkspace(workspaceId: string): ReturnType<PaimindHostWorkspaceRegistry['list']>[number] {
    if (workspaceId.trim() === '' || workspaceId.length > 200 || CONTROL.test(workspaceId)) {
      throw new Error('Harness Workspace id is invalid')
    }
    const workspace = this.workspaceRegistry.list().find(candidate => candidate.id === workspaceId)
    if (workspace === undefined) throw new Error(`Unknown Harness Workspace: ${workspaceId}`)
    return workspace
  }

  private operationToken(): string {
    const token = this.createId()
    if (!OPERATION_TOKEN.test(token)) throw new Error('Workspace Blueprint operation id is invalid')
    return token
  }

  private async ensureUserTemplatesRoot(): Promise<string> {
    await mkdir(this.userTemplatesRoot, { recursive: true, mode: 0o700 })
    return await safeDirectoryRoot(this.userTemplatesRoot, 'User Workspace Blueprint repository')
  }

  private async writeManifest(root: string, manifest: Readonly<WorkspaceBlueprintManifest>): Promise<void> {
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    })
  }

  private async safeMutationTarget(filesRoot: string, rawPath: string): Promise<string> {
    const path = safeRelativePath(rawPath)
    assertPackagedPath(path)
    const target = join(filesRoot, ...path.split('/'))
    if (!contained(filesRoot, target)) throw new Error(`Workspace Blueprint path escapes its root: ${path}`)
    const parent = await safeDirectoryRoot(dirname(target), 'Workspace Blueprint mutation parent')
    if (parent !== filesRoot && !contained(filesRoot, parent)) {
      throw new Error(`Workspace Blueprint path escapes its root: ${path}`)
    }
    return target
  }

  private async mutateUserBlueprint(
    input: Readonly<WorkspaceBlueprintIdentityInput & { readonly expectedDigest: string }>,
    mutation: (filesRoot: string) => Promise<void>,
    composition?: Readonly<WorkspaceBlueprintComposition>,
  ): Promise<WorkspaceBlueprintMutationResult> {
    return await this.enqueueMaterialization(async () => {
      assertDigest(input.expectedDigest)
      const blueprint = await this.resolveBlueprint(input)
      if (blueprint.manifest.source !== 'user') throw new Error('Built-in Workspace Blueprints are read-only')
      if (blueprint.manifest.digest !== input.expectedDigest) throw new Error('Workspace Blueprint digest conflict')
      const repositoryRoot = await this.ensureUserTemplatesRoot()
      const baseVersionRoot = dirname(blueprint.root)
      const blueprintRoot = dirname(baseVersionRoot)
      if (!contained(repositoryRoot, baseVersionRoot) || !contained(repositoryRoot, blueprintRoot)) {
        throw new Error('User Workspace Blueprint escapes its repository')
      }
      const occupied = new Set((await this.loadAll())
        .filter(item => item.manifest.blueprintId === blueprint.manifest.blueprintId)
        .map(item => item.manifest.version))
      const nextVersion = nextPatchVersion(blueprint.manifest.version, occupied)
      const nextVersionRoot = join(blueprintRoot, nextVersion)
      const token = this.operationToken()
      const stage = join(repositoryRoot, `.paimind-blueprint-mutation-${token}`)
      let stageCreated = false
      try {
        const stageFiles = join(stage, 'files')
        await mkdir(stageFiles, { recursive: true, mode: 0o700 })
        stageCreated = true
        await copyTree(blueprint.tree, stageFiles)
        await mutation(stageFiles)
        const tree = await scanTree(stageFiles)
        const timestamp = Math.max(this.now(), blueprint.manifest.updatedAt + 1)
        const source: SourceManifest = Object.freeze({
          schema: MANIFEST_SCHEMA,
          blueprintId: blueprint.manifest.blueprintId,
          version: nextVersion,
          name: blueprint.manifest.name,
          description: blueprint.manifest.description,
          category: blueprint.manifest.category,
          tags: blueprint.manifest.tags,
          source: 'user',
          fileCount: tree.fileCount,
          totalBytes: tree.totalBytes,
          createdAt: timestamp,
          updatedAt: timestamp,
          composition: composition ?? blueprint.manifest.composition,
        })
        const manifest = manifestFromSource(source, tree)
        await this.validateComposition(manifest.composition)
        await this.writeManifest(stage, manifest)
        const current = await this.resolveBlueprint(input)
        if (current.manifest.source !== 'user' || current.manifest.digest !== input.expectedDigest
          || dirname(current.root) !== baseVersionRoot) throw new Error('Workspace Blueprint changed before mutation')
        if (await lstat(nextVersionRoot).then(() => true).catch(() => false)) {
          throw new Error(`Workspace Blueprint version already exists: ${manifest.blueprintId}@${manifest.version}`)
        }
        await rename(stage, nextVersionRoot)
        stageCreated = false
        return Object.freeze({
          blueprintId: manifest.blueprintId,
          version: manifest.version,
          digest: manifest.digest,
          fileCount: manifest.fileCount,
          totalBytes: manifest.totalBytes,
          updatedAt: manifest.updatedAt,
        })
      } catch (error) {
        if (stageCreated) await rm(stage, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  private async resolveBlueprint(input: Readonly<WorkspaceBlueprintIdentityInput>): Promise<LoadedBlueprint> {
    assertBlueprintId(input.blueprintId)
    assertVersion(input.version)
    const blueprint = (await this.loadAll()).find(item => (
      item.manifest.blueprintId === input.blueprintId && item.manifest.version === input.version
    ))
    if (blueprint === undefined) throw new Error(`Workspace Blueprint not found: ${input.blueprintId}@${input.version}`)
    return blueprint
  }

  private async loadBuiltins(): Promise<readonly Readonly<LoadedBlueprint>[]> {
    return await this.loadRoot(this.templatesRoot, 'builtin')
  }

  private async loadUsers(): Promise<readonly Readonly<LoadedBlueprint>[]> {
    return await this.loadRoot(await this.ensureUserTemplatesRoot(), 'user')
  }

  private async loadAll(): Promise<readonly Readonly<LoadedBlueprint>[]> {
    const loaded = [...await this.loadBuiltins(), ...await this.loadUsers()]
    const identities = new Set<string>()
    for (const item of loaded) {
      const identity = `${item.manifest.blueprintId}@${item.manifest.version}`
      if (identities.has(identity)) throw new Error(`Duplicate Workspace Blueprint version: ${identity}`)
      identities.add(identity)
    }
    return Object.freeze(loaded)
  }

  private async loadRoot(
    rootInput: string,
    expectedSource: 'builtin' | 'user',
  ): Promise<readonly Readonly<LoadedBlueprint>[]> {
    const root = await safeDirectoryRoot(
      rootInput,
      expectedSource === 'builtin' ? 'Built-in Workspace Blueprint catalog' : 'User Workspace Blueprint repository',
    )
    const items: LoadedBlueprint[] = []
    const identities = new Set<string>()
    for (const blueprintId of (await readdir(root)).sort((left, right) => left.localeCompare(right))) {
      if (blueprintId.startsWith('.')) continue
      assertBlueprintId(blueprintId)
      const blueprintRoot = join(root, blueprintId)
      const blueprintInfo = await lstat(blueprintRoot)
      if (blueprintInfo.isSymbolicLink() || !blueprintInfo.isDirectory()) throw new Error('Workspace Blueprint catalog contains an unsafe entry')
      for (const version of (await readdir(blueprintRoot)).sort(compareVersions)) {
        assertVersion(version)
        const versionRoot = join(blueprintRoot, version)
        const versionInfo = await lstat(versionRoot)
        if (versionInfo.isSymbolicLink() || !versionInfo.isDirectory()) throw new Error('Workspace Blueprint version is not a safe directory')
        const source = parseSourceManifest(
          JSON.parse(await readFile(join(versionRoot, 'manifest.json'), 'utf8')),
          expectedSource,
        )
        if (source.blueprintId !== blueprintId || source.version !== version) throw new Error('Workspace Blueprint path identity mismatch')
        const identity = `${blueprintId}@${version}`
        if (identities.has(identity)) throw new Error(`Duplicate Workspace Blueprint version: ${identity}`)
        identities.add(identity)
        const filesRoot = join(versionRoot, 'files')
        const tree = await scanTree(filesRoot)
        items.push(Object.freeze({
          manifest: manifestFromSource(source, tree),
          root: filesRoot,
          tree,
          compatibleReceiptDigests: source.compatibleReceiptDigests ?? Object.freeze([]),
        }))
      }
    }
    return Object.freeze(items)
  }

  private async enqueueMaterialization<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.materializeTail
    let release: (() => void) | undefined
    this.materializeTail = new Promise<void>(resolveMutation => { release = resolveMutation })
    await previous
    try { return await operation() } finally { release?.() }
  }
}

export const workspaceBlueprintLimits = Object.freeze({
  maxFiles: MAX_BLUEPRINT_FILES,
  maxTotalBytes: MAX_BLUEPRINT_BYTES,
  maxFileBytes: MAX_BLUEPRINT_FILE_BYTES,
  maxCompositionReceiptBytes: MAX_COMPOSITION_RECEIPT_BYTES,
})
