import type { HarnessAgentChoice } from '@paimind/harness-compat'
import AI_WORKFLOW_ARCHITECT_AVATAR from '../../assets/ai-workflow-architect-agent.webp'
import CONTENT_EXPRESSION_AVATAR from '../../assets/content-expression-agent.webp'
import PERSONAL_COFFEE_AVATAR from '../../assets/personal-coffee-agent.webp'
import PROJECT_PROGRESS_AVATAR from '../../assets/project-progress-agent.webp'
import SENIOR_AI_PRODUCT_MANAGER_AVATAR from '../../assets/senior-ai-product-manager-agent.webp'
import TECHNICAL_EXPERT_AVATAR from '../../assets/technical-expert-agent.webp'
import PARAMONT_BRAND_FALLBACK from '../../assets/paramont-brand-fallback.webp'

export const PAIMIND_AGENT_AVATAR_ICON_PREFIX = 'paimind-agent-avatar:'

export interface PaimindAgentAvatarIdentity {
  readonly canonicalId: string
  readonly asset: string
  readonly assetKey: string
  readonly fallback: boolean
  readonly projected: boolean
}

/**
 * Exact canonical-Preset mappings only. Prototype agent ids keep their own
 * frozen avatar; RC8 platform modes use the corresponding frozen personal
 * role portrait selected for FP17. Unknown valid Presets receive only a
 * deterministic visual projection from the published pool; invalid ids use
 * the Paramont brand fallback. Neither path creates identity metadata.
 */
const AVATAR_BY_CANONICAL_ID: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  paimind: ['paramont-brand-fallback', PARAMONT_BRAND_FALLBACK],
  standard: ['technical-expert-agent', TECHNICAL_EXPERT_AVATAR],
  code: ['technical-expert-agent', TECHNICAL_EXPERT_AVATAR],
  ptc: ['ai-workflow-architect-agent', AI_WORKFLOW_ARCHITECT_AVATAR],
  cordis: ['ai-workflow-architect-agent', AI_WORKFLOW_ARCHITECT_AVATAR],
  minimal: ['personal-coffee-agent', PERSONAL_COFFEE_AVATAR],
  creator: ['senior-ai-product-manager-agent', SENIOR_AI_PRODUCT_MANAGER_AVATAR],
  'personal-ai-product-partner': ['senior-ai-product-manager-agent', SENIOR_AI_PRODUCT_MANAGER_AVATAR],
  'personal-workflow-architect': ['ai-workflow-architect-agent', AI_WORKFLOW_ARCHITECT_AVATAR],
  'personal-sales-review-coach': ['personal-coffee-agent', PERSONAL_COFFEE_AVATAR],
  'content-expression-agent': ['content-expression-agent', CONTENT_EXPRESSION_AVATAR],
  'project-progress-agent': ['project-progress-agent', PROJECT_PROGRESS_AVATAR],
})

const PORTRAIT_POOL: readonly (readonly [string, string])[] = Object.freeze([
  ['ai-workflow-architect-agent', AI_WORKFLOW_ARCHITECT_AVATAR],
  ['content-expression-agent', CONTENT_EXPRESSION_AVATAR],
  ['personal-coffee-agent', PERSONAL_COFFEE_AVATAR],
  ['project-progress-agent', PROJECT_PROGRESS_AVATAR],
  ['senior-ai-product-manager-agent', SENIOR_AI_PRODUCT_MANAGER_AVATAR],
  ['technical-expert-agent', TECHNICAL_EXPERT_AVATAR],
])

function isValidCanonicalId(id: string): boolean {
  return id.length > 0 && id.length <= 256 && id.trim() === id && !/[\u0000-\u001f\u007f]/u.test(id)
}

/** FNV-1a plus a final avalanche; stable across browser sessions and builds. */
function canonicalIdHash(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return hash >>> 0
}

export function resolvePaimindAgentAvatar(
  choice: Pick<HarnessAgentChoice, 'id'>,
): PaimindAgentAvatarIdentity {
  const mapped = AVATAR_BY_CANONICAL_ID[choice.id]
  if (mapped !== undefined) return Object.freeze({
    canonicalId: choice.id, asset: mapped[1], assetKey: mapped[0], fallback: false, projected: false,
  })
  if (isValidCanonicalId(choice.id)) {
    const projected = PORTRAIT_POOL[canonicalIdHash(choice.id) % PORTRAIT_POOL.length]!
    if (projected[1].trim() !== '') return Object.freeze({
      canonicalId: choice.id, asset: projected[1], assetKey: projected[0], fallback: false, projected: true,
    })
  }
  return Object.freeze({
    canonicalId: choice.id, asset: PARAMONT_BRAND_FALLBACK,
    assetKey: 'paramont-brand-fallback', fallback: true, projected: false,
  })
}

export function paimindAgentAvatarIcon(canonicalId: string): string {
  return `${PAIMIND_AGENT_AVATAR_ICON_PREFIX}${encodeURIComponent(canonicalId)}`
}

export function canonicalIdFromPaimindAgentAvatarIcon(icon: string): string | null {
  if (!icon.startsWith(PAIMIND_AGENT_AVATAR_ICON_PREFIX)) return null
  try {
    return decodeURIComponent(icon.slice(PAIMIND_AGENT_AVATAR_ICON_PREFIX.length))
  } catch {
    return null
  }
}
