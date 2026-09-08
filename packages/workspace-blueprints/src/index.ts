import { fileURLToPath } from 'node:url'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {
  PaimindWorkspaceCompositionLookup,
  PaimindWorkspaceCompositionSnapshotV1,
  PaimindWorkspaceCompositionSource,
} from '@hansen/contracts'
import {
  PaimindHostRemoteService,
  markPaimindHostRemoteMethods,
  type PaimindHostWorkspaceRegistry,
} from '@hansen/harness-compat/host'
import {
  WorkspaceBlueprintCatalog,
  type WorkspaceBlueprintComposition,
  type WorkspaceBlueprintCompositionValidator,
  type WorkspaceBlueprintCatalogOptions,
  type WorkspaceBlueprintCatalogPage,
  type WorkspaceBlueprintBindEntryAgentSessionInput,
  type WorkspaceBlueprintBindEntryAgentSessionResult,
  type WorkspaceBlueprintAgentChoice,
  type WorkspaceBlueprintBusinessSkillChoice,
  type WorkspaceBlueprintCompositionChoices,
  type WorkspaceBlueprintDetail,
  type WorkspaceBlueprintDeleteEntryInput,
  type WorkspaceBlueprintIdentityInput,
  type WorkspaceBlueprintListInput,
  type WorkspaceBlueprintMaterializeInput,
  type WorkspaceBlueprintMaterializeResult,
  type WorkspaceBlueprintManifest,
  type WorkspaceBlueprintMutationInput,
  type WorkspaceBlueprintMutationResult,
  type WorkspaceBlueprintPublishInput,
  type WorkspaceBlueprintReadTextInput,
  type WorkspaceBlueprintTextFile,
  type WorkspaceBlueprintUpdateCompositionInput,
  type WorkspaceBlueprintWriteTextInput,
} from './catalog.js'

export * from './catalog.js'

export const name = 'paimind-workspace-blueprints'
export const inject = ['workspaceRegistry']

export interface WorkspaceBlueprintHostContext {
  readonly workspaceRegistry: PaimindHostWorkspaceRegistry
  /** Dynamic structural lookup keeps Agent and Skill product services optional and source-owned. */
  get?(name: string): unknown
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

interface WorkspaceBlueprintAgentValidationSource {
  listProfiles(): Promise<Readonly<{
    readonly profiles: readonly Readonly<{
      readonly agentId: string
      readonly presetId: string
      readonly configVersion: string
      readonly name?: string
      readonly health: 'healthy' | 'broken'
      readonly healthMessage?: string
    }>[]
  }>>
  bindSession(input: Readonly<{
    readonly sessionId: string
    readonly agentId: string
    readonly presetId: string
    readonly configVersion: string
    readonly purpose: 'conversation'
  }>): Promise<Readonly<{
    readonly sessionId: string
    readonly agentId: string
    readonly presetId: string
    readonly configVersion: string
  }>>
}

interface WorkspaceBlueprintSkillValidationSource {
  listInstalled(): Promise<Readonly<{
    readonly items: readonly Readonly<{
      readonly skillId: string
      readonly name: string
      readonly displayName?: string
      readonly description: string
    }>[]
  }>>
  getUserSkillPolicy(): Promise<Readonly<{ readonly enabledBusinessSkillNames: readonly string[] }>>
  listSystemSkills(): Promise<Readonly<{ readonly items: readonly Readonly<{ readonly name: string }>[] }>>
  getSkillPackage(input: { readonly skillId: string }): Promise<Readonly<{
    readonly skillId: string
    readonly name: string
    readonly digest: string
  }>>
}

function method<T extends object, K extends keyof T>(candidate: unknown, key: K): candidate is T {
  return typeof candidate === 'object' && candidate !== null && typeof (candidate as T)[key] === 'function'
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 200
}

function choiceGroup<Item>(
  status: 'ready' | 'unavailable' | 'error',
  items: readonly Readonly<Item>[] = [],
): Readonly<{ readonly status: 'ready' | 'unavailable' | 'error'; readonly items: readonly Readonly<Item>[] }> {
  return Object.freeze({ status, items: Object.freeze([...items]) })
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const results = new Array<Output>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      results[index] = await transform(values[index]!)
    }
  })
  await Promise.all(workers)
  return Object.freeze(results)
}

/** Build an on-demand UI projection without taking ownership of source entities. */
export async function getWorkspaceBlueprintCompositionChoices(
  lookup: Pick<WorkspaceBlueprintHostContext, 'get'>,
): Promise<Readonly<WorkspaceBlueprintCompositionChoices>> {
  const agentCandidate = lookup.get?.('paimindAgentProfiles')
  const agentsPromise = !method<WorkspaceBlueprintAgentValidationSource, 'listProfiles'>(agentCandidate, 'listProfiles')
    ? Promise.resolve(choiceGroup<WorkspaceBlueprintAgentChoice>('unavailable'))
    : (async () => {
        try {
          const snapshot = await agentCandidate.listProfiles()
          if (!Array.isArray(snapshot?.profiles)) throw new Error('invalid Agent profile snapshot')
          const items = snapshot.profiles.filter(profile => profile.health === 'healthy').map(profile => {
            if (!validIdentifier(profile.agentId) || !validIdentifier(profile.presetId)
              || !validIdentifier(profile.configVersion) || !validIdentifier(profile.name)) {
              throw new Error('invalid Agent profile choice')
            }
            return Object.freeze({
              agentId: profile.agentId,
              presetId: profile.presetId,
              configVersion: profile.configVersion,
              name: profile.name,
            })
          }).sort((left, right) => left.name.localeCompare(right.name) || left.agentId.localeCompare(right.agentId))
          return choiceGroup('ready', items)
        } catch {
          return choiceGroup<WorkspaceBlueprintAgentChoice>('error')
        }
      })()

  const skillCandidate = lookup.get?.('paimindSkillInstaller')
  const hasSkillProjection = method<WorkspaceBlueprintSkillValidationSource, 'listInstalled'>(skillCandidate, 'listInstalled')
    && method<WorkspaceBlueprintSkillValidationSource, 'getUserSkillPolicy'>(skillCandidate, 'getUserSkillPolicy')
    && method<WorkspaceBlueprintSkillValidationSource, 'listSystemSkills'>(skillCandidate, 'listSystemSkills')
    && method<WorkspaceBlueprintSkillValidationSource, 'getSkillPackage'>(skillCandidate, 'getSkillPackage')
  const businessSkillsPromise = !hasSkillProjection
    ? Promise.resolve(choiceGroup<WorkspaceBlueprintBusinessSkillChoice>('unavailable'))
    : (async () => {
        try {
          const [installed, policy, system] = await Promise.all([
            skillCandidate.listInstalled(),
            skillCandidate.getUserSkillPolicy(),
            skillCandidate.listSystemSkills(),
          ])
          if (!Array.isArray(installed?.items) || !Array.isArray(policy?.enabledBusinessSkillNames)
            || !Array.isArray(system?.items)) throw new Error('invalid Skill Center snapshot')
          const enabled = new Set(policy.enabledBusinessSkillNames)
          const systemNames = new Set(system.items.map(item => item.name))
          const rows = installed.items.filter(item => enabled.has(item.name) && !systemNames.has(item.name))
          const items = await mapWithConcurrency(rows, 8, async item => {
            if (!validIdentifier(item.skillId) || !validIdentifier(item.name)
              || !/^[a-z0-9][a-z0-9-]*$/.test(item.name) || item.name.length > 100
              || item.skillId !== item.name || typeof item.description !== 'string' || item.description.length > 2_000) {
              throw new Error('invalid Business Skill choice')
            }
            const current = await skillCandidate.getSkillPackage({ skillId: item.skillId })
            if (current.skillId !== item.skillId || current.name !== item.name
              || !/^sha256:[a-f0-9]{64}$/.test(current.digest)) {
              throw new Error('Business Skill identity changed')
            }
            return Object.freeze({ name: current.name, description: item.description, ...(item.displayName === undefined ? {} : { displayName: item.displayName }), digest: current.digest as `sha256:${string}` })
          })
          return choiceGroup('ready', [...items].sort((left, right) => left.name.localeCompare(right.name)))
        } catch {
          return choiceGroup<WorkspaceBlueprintBusinessSkillChoice>('error')
        }
      })()

  const [agents, businessSkills] = await Promise.all([agentsPromise, businessSkillsPromise])

  return Object.freeze({
    schema: 'paimind.workspace-blueprint-composition-choices/v1',
    agents,
    businessSkills,
  })
}

/**
 * Revalidate exact external references at the Host mutation boundary. The
 * validator reads source-owned services only and persists no shadow state.
 */
export async function validateWorkspaceBlueprintComposition(
  lookup: Pick<WorkspaceBlueprintHostContext, 'get'>,
  composition: Readonly<WorkspaceBlueprintComposition>,
): Promise<void> {
  if (composition.agent === null && composition.businessSkills.length === 0) return

  const agent = composition.agent
  if (agent !== null) {
    const candidate = lookup.get?.('paimindAgentProfiles')
    if (!method<WorkspaceBlueprintAgentValidationSource, 'listProfiles'>(candidate, 'listProfiles')) {
      throw new Error('Agent Center is unavailable for Workspace Blueprint composition validation')
    }
    const snapshot = await candidate.listProfiles()
    if (!Array.isArray(snapshot?.profiles)) throw new Error('Agent Center returned an invalid profile snapshot')
    const exact = snapshot.profiles.find(profile => profile.agentId === agent.agentId
      && profile.presetId === agent.presetId
      && profile.configVersion === agent.configVersion)
    if (exact === undefined) throw new Error('Workspace Blueprint Agent revision is missing or changed')
    if (exact.health !== 'healthy') {
      throw new Error(`Workspace Blueprint Agent is not runnable: ${exact.healthMessage ?? exact.agentId}`)
    }
  }

  if (composition.businessSkills.length === 0) return
  const candidate = lookup.get?.('paimindSkillInstaller')
  if (!method<WorkspaceBlueprintSkillValidationSource, 'getUserSkillPolicy'>(candidate, 'getUserSkillPolicy')
    || !method<WorkspaceBlueprintSkillValidationSource, 'listSystemSkills'>(candidate, 'listSystemSkills')
    || !method<WorkspaceBlueprintSkillValidationSource, 'getSkillPackage'>(candidate, 'getSkillPackage')) {
    throw new Error('Skill Center is unavailable for Workspace Blueprint composition validation')
  }
  const [policy, system] = await Promise.all([
    candidate.getUserSkillPolicy(),
    candidate.listSystemSkills(),
  ])
  if (!Array.isArray(policy?.enabledBusinessSkillNames) || !Array.isArray(system?.items)) {
    throw new Error('Skill Center returned an invalid validation snapshot')
  }
  const enabled = new Set(policy.enabledBusinessSkillNames)
  const systemNames = new Set(system.items.map(item => item.name))
  for (const binding of composition.businessSkills) {
    if (systemNames.has(binding.name)) {
      throw new Error(`Workspace Blueprint Business Skill collides with a System Skill: ${binding.name}`)
    }
    if (!enabled.has(binding.name)) {
      throw new Error(`Workspace Blueprint Business Skill is not enabled: ${binding.name}`)
    }
    const current = await candidate.getSkillPackage({ skillId: binding.name })
    if (current.skillId !== binding.name || current.name !== binding.name) {
      throw new Error(`Workspace Blueprint Business Skill identity changed: ${binding.name}`)
    }
    if (current.digest !== binding.digest) {
      throw new Error(`Workspace Blueprint Business Skill digest mismatch: ${binding.name}`)
    }
  }
}

export interface WorkspaceBlueprintServiceOptions {
  readonly templatesRoot?: string
  readonly userTemplatesRoot?: string
  readonly now?: () => number
  readonly createId?: () => string
}

/**
 * Host owner for the Blueprint catalog and user repository. Harness remains
 * the only Workspace registry: every publication source and materialization
 * target is resolved from `workspaceId` here.
 */
export class PaimindWorkspaceBlueprintService extends PaimindHostRemoteService implements PaimindWorkspaceCompositionSource {
  static inject = inject
  private readonly catalog: WorkspaceBlueprintCatalog
  private readonly hostContext: WorkspaceBlueprintHostContext

  constructor(blueprintCtx: WorkspaceBlueprintHostContext, options: WorkspaceBlueprintServiceOptions = {}) {
    super(blueprintCtx, 'paimindWorkspaceBlueprints')
    this.hostContext = blueprintCtx
    const catalogOptions: WorkspaceBlueprintCatalogOptions = {
      templatesRoot: options.templatesRoot ?? fileURLToPath(new URL('../templates', import.meta.url)),
      userTemplatesRoot: options.userTemplatesRoot ?? dshHomePath('.paimind-workspace-blueprints/templates'),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createId === undefined ? {} : { createId: options.createId }),
      compositionValidator: Object.freeze<WorkspaceBlueprintCompositionValidator>({
        validate: async composition => await validateWorkspaceBlueprintComposition(blueprintCtx, composition),
      }),
    }
    this.catalog = new WorkspaceBlueprintCatalog(blueprintCtx.workspaceRegistry, catalogOptions)
    markPaimindHostRemoteMethods(this, [
      'listBlueprints',
      'materializeBlueprint',
      'publishBlueprint',
      'getBlueprint',
      'readBlueprintText',
      'writeBlueprintText',
      'createBlueprintDirectory',
      'deleteBlueprintFile',
      'updateBlueprintComposition',
      'getCompositionChoices',
      'bindEntryAgentSession',
    ])
  }

  async listBlueprints(input: Readonly<WorkspaceBlueprintListInput> = {}): Promise<WorkspaceBlueprintCatalogPage> {
    return await this.catalog.listBlueprints(input)
  }

  async materializeBlueprint(
    input: Readonly<WorkspaceBlueprintMaterializeInput>,
  ): Promise<WorkspaceBlueprintMaterializeResult> {
    return await this.catalog.materializeBlueprint(input)
  }

  async getWorkspaceComposition(
    input: Readonly<PaimindWorkspaceCompositionLookup>,
  ): Promise<Readonly<PaimindWorkspaceCompositionSnapshotV1> | undefined> {
    return await this.catalog.getWorkspaceComposition(input)
  }

  async publishBlueprint(input: Readonly<WorkspaceBlueprintPublishInput>): Promise<WorkspaceBlueprintManifest> {
    return await this.catalog.publishBlueprint(input)
  }

  async getBlueprint(input: Readonly<WorkspaceBlueprintIdentityInput>): Promise<WorkspaceBlueprintDetail> {
    return await this.catalog.getBlueprint(input)
  }

  async readBlueprintText(input: Readonly<WorkspaceBlueprintReadTextInput>): Promise<WorkspaceBlueprintTextFile> {
    return await this.catalog.readBlueprintText(input)
  }

  async writeBlueprintText(input: Readonly<WorkspaceBlueprintWriteTextInput>): Promise<WorkspaceBlueprintMutationResult> {
    return await this.catalog.writeBlueprintText(input)
  }

  async createBlueprintDirectory(
    input: Readonly<WorkspaceBlueprintMutationInput>,
  ): Promise<WorkspaceBlueprintMutationResult> {
    return await this.catalog.createBlueprintDirectory(input)
  }

  async deleteBlueprintFile(
    input: Readonly<WorkspaceBlueprintDeleteEntryInput>,
  ): Promise<WorkspaceBlueprintMutationResult> {
    return await this.catalog.deleteBlueprintFile(input)
  }

  async updateBlueprintComposition(
    input: Readonly<WorkspaceBlueprintUpdateCompositionInput>,
  ): Promise<WorkspaceBlueprintMutationResult> {
    return await this.catalog.updateBlueprintComposition(input)
  }

  async getCompositionChoices(): Promise<Readonly<WorkspaceBlueprintCompositionChoices>> {
    return await getWorkspaceBlueprintCompositionChoices(this.hostContext)
  }

  async bindEntryAgentSession(
    input: Readonly<WorkspaceBlueprintBindEntryAgentSessionInput>,
  ): Promise<Readonly<WorkspaceBlueprintBindEntryAgentSessionResult>> {
    if (!validIdentifier(input.workspaceId) || !validIdentifier(input.sessionId)) {
      throw new Error('Workspace Blueprint entry Session identity is invalid')
    }
    const materialized = await this.catalog.getMaterializedWorkspaceBlueprint({ sessionId: input.sessionId })
    if (materialized === undefined || materialized.workspaceId !== input.workspaceId) {
      throw new Error('Workspace Blueprint entry Session does not belong to the materialized Workspace')
    }
    const manifest = materialized.manifest
    if (manifest.blueprintId !== input.blueprintId || manifest.version !== input.version
      || manifest.digest !== input.expectedDigest) {
      throw new Error('Workspace Blueprint entry Session package identity does not match its receipt')
    }
    const agent = manifest.composition.agent
    if (agent === null) throw new Error('Workspace Blueprint does not define an entry Agent')

    // Revalidate immediately before the only source-owned mutation. Agent
    // Center bindSession performs its own exact revision check as well.
    await validateWorkspaceBlueprintComposition(this.hostContext, manifest.composition)
    const current = await this.catalog.getMaterializedWorkspaceBlueprint({ sessionId: input.sessionId })
    if (current === undefined || current.workspaceId !== input.workspaceId
      || current.manifest.blueprintId !== manifest.blueprintId || current.manifest.version !== manifest.version
      || current.manifest.digest !== manifest.digest) {
      throw new Error('Workspace Blueprint entry Session or materialized package changed before binding')
    }
    const candidate = this.hostContext.get?.('paimindAgentProfiles')
    if (!method<WorkspaceBlueprintAgentValidationSource, 'bindSession'>(candidate, 'bindSession')) {
      throw new Error('Agent Center is unavailable for Workspace Blueprint entry Session binding')
    }
    const binding = await candidate.bindSession({
      sessionId: input.sessionId,
      agentId: agent.agentId,
      presetId: agent.presetId,
      configVersion: agent.configVersion,
      purpose: 'conversation',
    })
    if (binding.sessionId !== input.sessionId || binding.agentId !== agent.agentId
      || binding.presetId !== agent.presetId || binding.configVersion !== agent.configVersion) {
      throw new Error('Agent Center entry Session binding did not match the materialized package')
    }
    return Object.freeze({
      workspaceId: materialized.workspaceId,
      sessionId: binding.sessionId,
      blueprintId: manifest.blueprintId,
      version: manifest.version,
      digest: manifest.digest,
      agent,
    })
  }
}

export function apply(ctx: WorkspaceBlueprintHostContext): void {
  new PaimindWorkspaceBlueprintService(ctx)
}
