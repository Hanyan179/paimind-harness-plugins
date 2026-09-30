import { createHash } from 'node:crypto'
import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/)
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const skillName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/)
/** Reserved native namespace, never a personal authoring target or a grant. */
export const ENTERPRISE_AGENT_PRESET_PREFIX = 'paimind-enterprise-'
const content = z.object({
  schema: z.literal('paimind.agent-publication/v1'),
  agentId: id, presetId: id, configVersion: z.string().min(1).max(160),
  profile: z.object({
    name: z.string().min(1).max(80), description: z.string().max(500), basePresetId: z.literal('standard'),
    role: z.string().min(1).max(2000), goal: z.string().min(1).max(2000), behavior: z.string().min(1).max(4000),
    instructions: z.string().max(4000), avatarId: id.optional(),
    preferredSkillNames: z.array(skillName).max(40),
  }).strict(),
  dependencies: z.array(z.object({ name: skillName, digest }).strict()).max(40),
  nativeCompositionDigest: digest,
}).strict().refine(value => value.agentId === value.presetId
  && new Set(value.profile.preferredSkillNames).size === value.profile.preferredSkillNames.length
  && new Set(value.dependencies.map(row => row.name)).size === value.dependencies.length
  && JSON.stringify([...value.profile.preferredSkillNames].sort()) === JSON.stringify(value.dependencies.map(row => row.name).sort()))

/** A product-owned immutable semantic snapshot, not an executable Preset or a
 * container policy. No credentials, authoring Session ids or native history. */
export const agentPublicationSnapshotSchema = z.object({ content, digest }).strict()
export type AgentPublicationSnapshot = z.infer<typeof agentPublicationSnapshotSchema>

export function createAgentPublicationSnapshot(input: unknown): Readonly<AgentPublicationSnapshot> {
  const parsed = content.parse(input)
  parsed.dependencies.sort((a, b) => a.name.localeCompare(b.name))
  return freezePublication({ content: parsed,
    digest: `sha256:${createHash('sha256').update(JSON.stringify(parsed)).digest('hex')}` })
}

function freezePublication<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezePublication(child)
    Object.freeze(value)
  }
  return value
}

export function readAgentPublicationSnapshot(input: unknown): Readonly<AgentPublicationSnapshot> {
  const parsed = agentPublicationSnapshotSchema.parse(input)
  const canonical = createAgentPublicationSnapshot(parsed.content)
  if (canonical.digest !== parsed.digest) throw new Error('智能体发布内容摘要不匹配')
  return canonical
}
