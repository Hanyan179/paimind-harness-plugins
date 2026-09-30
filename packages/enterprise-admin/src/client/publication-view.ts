/** Bounded UI projections only. The native owner and authenticated control
 * plane validate immutable content and authority; these parsers grant neither. */
export interface PublicationView {
  publicationId: string; sourceUserId: string; presetId: string; configVersion: string; digest: string;
  name: string; description: string; status: 'pending' | 'published' | 'rejected' | 'withdrawn';
  revision: number; submissionReason: string; reviewReason: string | null
}
export interface PublicationDetail extends PublicationView {
  profile: { role: string; goal: string; behavior: string; instructions: string };
  dependencies: { name: string; digest: string }[]; nativeCompositionDigest: string
  skillPublications: SkillPublicationChoice[]
}
export interface SkillPublicationChoice { publicationId: string; name: string; digest: string; status: PublicationView['status'] }
export interface AssignmentView { subjectKind: 'user' | 'group' | 'all'; subjectId: string | null; effect: 'allow' | 'deny'; active: boolean }
const invalid = (): never => { throw new Error('企业发布响应不完整或不一致，请重新读取') }
const object = (input: unknown): Record<string, unknown> => !input || typeof input !== 'object' || Array.isArray(input) ? invalid() : input as Record<string, unknown>
const text = (value: unknown, min: number, max: number): string => typeof value === 'string' && value.length >= min && value.length <= max ? value : invalid()
const uuid = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value) ? value : invalid()
const digest = (value: unknown): string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value) ? value : invalid()
export function skillPublicationChoices(input: unknown): SkillPublicationChoice[] {
  if (!Array.isArray(input) || input.length > 1000) return invalid()
  const rows = input.map(value => {
    const row = object(value), name = text(row.name, 1, 255)
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(name) || !['pending', 'published', 'rejected', 'withdrawn'].includes(String(row.status))) return invalid()
    return { publicationId: uuid(row.publicationId), name, digest: digest(row.digest), status: row.status as PublicationView['status'] }
  })
  if (new Set(rows.map(row => row.publicationId)).size !== rows.length) return invalid()
  return rows
}
export function publicationView(input: unknown): PublicationView {
  const row = object(input)
  if (!['pending', 'published', 'rejected', 'withdrawn'].includes(String(row.status))
    || typeof row.revision !== 'number' || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2_147_483_647) return invalid()
  const presetId = text(row.presetId, 1, 160); if (!/^[a-z0-9][a-z0-9_-]*$/u.test(presetId)) return invalid()
  return { publicationId: uuid(row.publicationId), sourceUserId: uuid(row.sourceUserId), presetId,
    configVersion: text(row.configVersion, 1, 160), digest: digest(row.digest), name: text(row.name, 1, 80),
    description: text(row.description, 0, 500), status: row.status as PublicationView['status'], revision: row.revision,
    submissionReason: text(row.submissionReason, 3, 500), reviewReason: row.reviewReason === null ? null : text(row.reviewReason, 3, 500) }
}
export function publicationViews(input: unknown): PublicationView[] {
  if (!Array.isArray(input) || input.length > 1000) return invalid()
  const rows = input.map(publicationView)
  if (new Set(rows.map(row => row.publicationId)).size !== rows.length) return invalid()
  return rows
}
export function publicationDetail(input: unknown, allowedAccess: readonly string[] = ['review-copy']): PublicationDetail {
  const row = object(input), view = publicationView(row), snapshot = object(row.snapshot), content = object(snapshot.content), profile = object(content.profile)
  if (!allowedAccess.includes(String(row.access)) || snapshot.digest !== view.digest || content.schema !== 'paimind.agent-publication/v1'
    || content.agentId !== view.presetId || content.presetId !== view.presetId || content.configVersion !== view.configVersion
    || profile.name !== view.name || profile.description !== view.description || profile.basePresetId !== 'standard'
    || !Array.isArray(content.dependencies) || content.dependencies.length > 40 || !Array.isArray(profile.preferredSkillNames)) return invalid()
  const dependencies = content.dependencies.map(item => {
    const ref = object(item), name = ref.name
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(name)) return invalid()
    return { name, digest: digest(ref.digest) }
  })
  if (new Set(dependencies.map(item => item.name)).size !== dependencies.length
    || JSON.stringify([...profile.preferredSkillNames].sort()) !== JSON.stringify(dependencies.map(item => item.name).sort())) return invalid()
  const rawSkills = row.skillPublications ?? []
  if (!Array.isArray(rawSkills) || rawSkills.length > 40) return invalid()
  const skillPublications = skillPublicationChoices(rawSkills.map(value => {
    const ref = object(value); return { publicationId: ref.publicationId, name: ref.name, digest: ref.packageDigest, status: ref.status }
  }))
  if (new Set(skillPublications.map(ref => ref.name)).size !== skillPublications.length
    || skillPublications.some(ref => !dependencies.some(dependency => dependency.name === ref.name && dependency.digest === ref.digest))
    || ['published', 'withdrawn'].includes(view.status) && skillPublications.length !== dependencies.length) return invalid()
  return { ...view, profile: { role: text(profile.role, 1, 2000), goal: text(profile.goal, 1, 2000),
    behavior: text(profile.behavior, 1, 4000), instructions: text(profile.instructions, 0, 4000) },
    dependencies, skillPublications, nativeCompositionDigest: digest(content.nativeCompositionDigest) }
}
export function publicationAssignments(input: unknown): { publication: PublicationView; assignments: AssignmentView[] } {
  const data = object(input), publication = publicationView(data.publication)
  if (!Array.isArray(data.assignments) || data.assignments.length > 701) return invalid()
  const assignments = data.assignments.map(input => {
    const row = object(input)
    if (!['user', 'group', 'all'].includes(String(row.subjectKind)) || !['allow', 'deny'].includes(String(row.effect))
      || row.effect === 'deny' && row.subjectKind !== 'user' || typeof row.active !== 'boolean') return invalid()
    const subjectId = row.subjectKind === 'all' ? row.subjectId === null ? null : invalid() : uuid(row.subjectId)
    return { subjectKind: row.subjectKind as AssignmentView['subjectKind'], subjectId, effect: row.effect as AssignmentView['effect'], active: row.active }
  })
  if (new Set(assignments.map(row => `${row.subjectKind}:${row.subjectId}`)).size !== assignments.length) return invalid()
  return { publication, assignments }
}

/** Command evidence only. The source digest is not the adopted composition
 * digest, and neither this projection nor its presence grants execution. */
export function adoptedPublicationPreset(input: unknown, selected: PublicationView): string {
  const row = object(input)
  if (Object.keys(row).sort().join(',') !== 'adopted,configVersion,digest,nativeCompositionDigest,presetId,publicationId,runtimeGrant'
    || row.publicationId !== selected.publicationId || row.digest !== selected.digest
    || row.adopted !== true || row.runtimeGrant !== false
    || row.presetId !== `paimind-enterprise-${selected.publicationId.replaceAll('-', '')}`) return invalid()
  text(row.configVersion, 1, 160); digest(row.nativeCompositionDigest)
  return row.presetId as string
}
