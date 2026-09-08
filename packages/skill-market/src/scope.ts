import {
  PAIMIND_SKILL_NAME_PATTERN,
  definePaimindWorkspaceCompositionSnapshot,
  definePaimindSkillReference,
  definePaimindUserSkillPolicy,
  type PaimindBusinessSkillReference,
  type PaimindSkillReference,
  type PaimindSkillScopeInputV1,
  type PaimindSystemSkillReference,
} from '@hansen/contracts'

function selectedNames(values: readonly string[], field: string): readonly string[] {
  if (!Array.isArray(values) || values.length > 10_000) throw new Error(`invalid ${field}`)
  const names: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || !PAIMIND_SKILL_NAME_PATTERN.test(value)) {
      throw new Error(`invalid ${field}`)
    }
    if (!seen.has(value)) {
      seen.add(value)
      names.push(value)
    }
  }
  return Object.freeze(names)
}

function sameReference(left: PaimindSkillReference, right: PaimindSkillReference): boolean {
  if (left.kind !== right.kind || left.description !== right.description || left.whenToUse !== right.whenToUse) return false
  if (left.kind === 'business' || right.kind === 'business') {
    return left.kind === 'business' && right.kind === 'business' && left.digest === right.digest
  }
  return left.availability === right.availability
    && left.userControl === right.userControl
    && left.sourcePluginId === right.sourcePluginId
}

function addCanonicalReference(
  target: Map<string, Readonly<PaimindSkillReference>>,
  byName: Map<string, Readonly<PaimindSkillReference>>,
  reference: PaimindSkillReference,
): Readonly<PaimindSkillReference> {
  const normalized = definePaimindSkillReference(reference)
  const existingName = byName.get(normalized.name)
  if (existingName !== undefined && existingName.canonicalId !== normalized.canonicalId) {
    throw new Error(`System and Business Skill name collision: ${normalized.name}`)
  }
  const existingCanonical = target.get(normalized.canonicalId)
  if (existingCanonical !== undefined && !sameReference(existingCanonical, normalized)) {
    throw new Error(`conflicting canonical Skill reference: ${normalized.canonicalId}`)
  }
  target.set(normalized.canonicalId, existingCanonical ?? normalized)
  byName.set(normalized.name, existingName ?? normalized)
  return existingCanonical ?? normalized
}

/**
 * Stateless composition service. It returns summary references only; Harness owns
 * scoped registration, catalog injection and full SKILL.md loading.
 */
export class PaimindSkillScopeResolverService {
  resolve(input: PaimindSkillScopeInputV1): readonly Readonly<PaimindSkillReference>[] {
    if (input.schema !== 'paimind.skill-scope-input/v1') throw new Error('unsupported Skill scope input schema')
    if (input.sessionKind !== 'direct' && input.sessionKind !== 'agent') {
      throw new Error('invalid Skill Session kind')
    }
    const policy = definePaimindUserSkillPolicy(input.userPolicy)
    const agentNames = selectedNames(input.agentBusinessSkillNames, 'Agent Business Skill names')
    const sessionNames = selectedNames(input.sessionBusinessSkillNames, 'Session Business Skill names')
    const workspace = input.workspaceComposition === undefined
      ? undefined
      : definePaimindWorkspaceCompositionSnapshot(input.workspaceComposition)
    if (input.sessionKind === 'direct' && agentNames.length > 0) {
      throw new Error('direct Session cannot carry Agent Skill attachments')
    }

    const canonical = new Map<string, Readonly<PaimindSkillReference>>()
    const byName = new Map<string, Readonly<PaimindSkillReference>>()
    const mandatory: Readonly<PaimindSystemSkillReference>[] = []
    const optional: Readonly<PaimindSystemSkillReference>[] = []
    const business = new Map<string, Readonly<PaimindBusinessSkillReference>>()

    for (const reference of input.mandatorySystemSkills) {
      if (reference.availability !== 'mandatory' || reference.userControl !== 'locked') {
        throw new Error(`Mandatory System Skill must be locked: ${reference.name}`)
      }
      const normalized = addCanonicalReference(canonical, byName, reference)
      mandatory.push(normalized as Readonly<PaimindSystemSkillReference>)
    }
    for (const reference of input.optionalSystemSkills) {
      if (reference.availability !== 'optional' || reference.userControl !== 'atomic') {
        throw new Error(`Optional System Skill must have an atomic lifecycle: ${reference.name}`)
      }
      const normalized = addCanonicalReference(canonical, byName, reference)
      optional.push(normalized as Readonly<PaimindSystemSkillReference>)
    }
    for (const reference of input.installedBusinessSkills) {
      const normalized = addCanonicalReference(canonical, byName, reference)
      business.set(normalized.name, normalized as Readonly<PaimindBusinessSkillReference>)
    }

    const mandatoryNames = new Set(mandatory.map(reference => reference.name))
    if (policy.enabledOptionalSystemSkillNames.some(name => mandatoryNames.has(name))) {
      throw new Error('Mandatory System Skill cannot be enabled through Optional policy')
    }

    const result = new Map<string, Readonly<PaimindSkillReference>>()
    const include = (reference: Readonly<PaimindSkillReference>): void => {
      result.set(reference.canonicalId, reference)
    }
    mandatory.forEach(include)
    const enabledOptional = new Set(policy.enabledOptionalSystemSkillNames)
    optional.filter(reference => enabledOptional.has(reference.name)).forEach(include)

    const enabledBusiness = new Set(policy.enabledBusinessSkillNames)
    const workspaceNames: string[] = []
    for (const selection of workspace?.businessSkills ?? []) {
      const visibleSystem = byName.get(selection.name)
      if (visibleSystem?.kind === 'system') {
        throw new Error(`Workspace Business Skill 与当前系统能力冲突：${selection.name}`)
      }
      if (!enabledBusiness.has(selection.name)) continue
      const installed = business.get(selection.name)
      if (installed === undefined) {
        throw new Error(`Workspace Business Skill is not installed: ${selection.name}`)
      }
      if (installed.digest !== selection.digest) {
        throw new Error(`Workspace Business Skill digest mismatch: ${selection.name}`)
      }
      workspaceNames.push(selection.name)
    }
    const scopedBusinessNames = input.sessionKind === 'direct'
      ? selectedNames(
          [...policy.directBusinessSkillNames, ...workspaceNames, ...sessionNames],
          'Direct Session Business Skill names',
        )
      : selectedNames(
          [...agentNames, ...workspaceNames, ...sessionNames],
          'Agent Session Business Skill names',
        )
    for (const name of scopedBusinessNames) {
      if (!enabledBusiness.has(name)) continue
      const reference = business.get(name)
      if (reference !== undefined) include(reference)
    }
    return Object.freeze([...result.values()])
  }
}

const DEFAULT_SKILL_SCOPE_RESOLVER = new PaimindSkillScopeResolverService()

/** Pure convenience entry point used by tests and Harness compatibility adapters. */
export function resolvePaimindSkillScope(
  input: PaimindSkillScopeInputV1,
): readonly Readonly<PaimindSkillReference>[] {
  return DEFAULT_SKILL_SCOPE_RESOLVER.resolve(input)
}
