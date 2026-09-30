import { readSkillPublicationAdoptionInput, type SkillPublicationAdoptionInput } from './publication.js'

/** Original owner's local intent only; never an assignment or runtime grant. */
export interface SkillAdoptedPreferenceInput {
  readonly reference: SkillPublicationAdoptionInput
  readonly expectedRevision: number
  readonly field: 'enabled' | 'direct'
  readonly value: boolean
}

export interface SkillAdoptedPreferenceResult {
  readonly reference: SkillPublicationAdoptionInput
  readonly revision: number
  readonly enabled: boolean
  readonly direct: boolean
  readonly runtimeGrant: false
}

export function readSkillAdoptedPreferenceInput(value: unknown): Readonly<SkillAdoptedPreferenceInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('企业技能使用意愿参数无效')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'expectedRevision,field,reference,value'
    || typeof row.expectedRevision !== 'number' || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0
    || row.field !== 'enabled' && row.field !== 'direct' || typeof row.value !== 'boolean') throw new Error('企业技能使用意愿参数无效')
  return Object.freeze({ reference: readSkillPublicationAdoptionInput(row.reference), expectedRevision: row.expectedRevision, field: row.field, value: row.value })
}
