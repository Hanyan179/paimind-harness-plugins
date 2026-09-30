import { z } from 'zod'
import { agentPublicationSnapshotSchema, ENTERPRISE_AGENT_PRESET_PREFIX, readAgentPublicationSnapshot } from './publication.js'

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const source = z.object({ tenantId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/),
  publicationId: z.uuid(), sourceUserId: z.uuid(), snapshot: agentPublicationSnapshotSchema }).strict()

/** Trusted same-process integration input. A snapshot is not permission:
 * control-plane authorization and managed execution gates remain mandatory. */
export type AgentPublicationAdoptionInput = z.infer<typeof source>
export const adoptionReceiptSchema = source.extend({
  schema: z.literal('paimind.agent-adoption/v1'),
  presetId: z.string(), configVersion: z.string().min(1).max(160),
  nativeCompositionDigest: digest, adoptedAt: z.number().int().nonnegative(),
}).strict()
export type AgentPublicationAdoption = z.infer<typeof adoptionReceiptSchema>
export const ADOPTION_RECEIPT_FILE = '.paimind-publication.json'

export function readAdoptionInput(input: unknown): AgentPublicationAdoptionInput {
  const value = source.parse(input)
  return Object.freeze({ ...value, snapshot: readAgentPublicationSnapshot(value.snapshot) })
}
export function adoptedPresetId(publicationId: string): string {
  return ENTERPRISE_AGENT_PRESET_PREFIX + z.uuid().parse(publicationId).replaceAll('-', '')
}
export function readAdoptionReceipt(input: unknown): AgentPublicationAdoption {
  const value = adoptionReceiptSchema.parse(input)
  const canonical = readAdoptionInput({ tenantId: value.tenantId, publicationId: value.publicationId,
    sourceUserId: value.sourceUserId, snapshot: value.snapshot })
  if (value.presetId !== adoptedPresetId(value.publicationId)) throw new Error('企业采用来源与原生预设不一致')
  return Object.freeze({ ...value, ...canonical })
}
