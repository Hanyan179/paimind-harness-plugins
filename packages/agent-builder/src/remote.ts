import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9][a-z0-9-_]*$/)
const sessionId = z.string().min(1).max(200)
const profile = z.object({
  agentId: id, presetId: id, name: z.string(), description: z.string(), basePresetId: id,
  role: z.string(), goal: z.string(), behavior: z.string(),
  preferredSkillNames: z.array(z.string()).readonly(), instructions: z.string(),
  productKind: z.enum(['personal', 'business']), businessCategory: z.string().optional(), businessCategoryId: id.optional(),
  revision: z.number().int().positive(), configVersion: z.string(), updatedAt: z.number().nonnegative(),
  health: z.enum(['healthy', 'broken']), healthMessage: z.string().optional(),
}).readonly()
const profileInput = z.object({
  agentId: id, presetId: id, name: z.string(), description: z.string(), basePresetId: id,
  role: z.string(), goal: z.string(), behavior: z.string(),
  preferredSkillNames: z.array(z.string()).readonly(), instructions: z.string(),
  productKind: z.enum(['personal', 'business']).optional(), businessCategory: z.string().optional(), businessCategoryId: id.optional(),
  expectedVersion: z.string().optional(),
}).readonly()
const binding = z.object({ sessionId, agentId: id, presetId: id, configVersion: z.string(), boundAt: z.number().nonnegative() }).readonly()
const bindingInput = z.object({ sessionId, agentId: id, presetId: id, configVersion: z.string() }).readonly()
const planShape = { sourceSessionId: sessionId, agentId: id, presetId: id, fromVersion: z.string(), toVersion: z.string(), summary: z.string() } as const
const plan = z.object(planShape).readonly()
const migration = z.object({ ...planShape, targetSessionId: sessionId, migratedAt: z.number().nonnegative() }).readonly()
const migrationInput = z.object({ ...planShape, targetSessionId: sessionId }).readonly()
const verificationShape = {
  sessionId, agentId: id, presetId: id, configVersion: z.string(), firstTurnId: z.string(),
  result: z.enum(['passed', 'failed']), message: z.string(), verifiedAt: z.number().nonnegative(),
} as const
const verification = z.object(verificationShape).readonly()
const verificationInput = z.object({
  sessionId, agentId: id, presetId: id, configVersion: z.string(), firstTurnId: z.string(),
  result: z.enum(['passed', 'failed']), message: z.string(),
}).readonly()

const direct = (method: string, parameters: readonly unknown[], result: unknown, line: number) => ({
  id: `@paimind/agent-builder#paimindAgentProfiles/${method}`,
  service: 'paimindAgentProfiles', namespace: 'paimindAgentProfiles', method,
  invocation: { kind: 'direct' as const }, parameters,
  result: { mode: 'strict' as const, typeSymbol: `@paimind/agent-builder#${method}Result`, schema: result },
  sourceLocation: { file: 'packages/agent-builder/src/index.ts', line, column: 3 },
})
const input = (schema: unknown, symbol: string) => [{ name: 'input', wire: 'input', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: symbol, schema } }]

export const PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS = Object.freeze([
  direct('listProfiles', [], z.object({ profiles: z.array(profile).readonly() }).readonly(), 246),
  direct('saveProfile', input(profileInput, '@paimind/agent-builder#AgentBusinessProfileInput'), profile, 260),
  direct('setDefault', input(z.object({ presetId: id }).readonly(), '@paimind/agent-builder#AgentDefaultInput'), z.object({ presetId: id }).readonly(), 300),
  direct('bindSession', input(bindingInput, '@paimind/agent-builder#AgentSessionBindingInput'), binding, 311),
  direct('migrationPlan', input(z.object({ sourceSessionId: sessionId }).readonly(), '@paimind/agent-builder#AgentMigrationPlanInput'), plan.nullable(), 321),
  direct('recordMigration', input(migrationInput, '@paimind/agent-builder#AgentMigrationInput'), migration, 336),
  direct('recordVerification', input(verificationInput, '@paimind/agent-builder#AgentVerificationInput'), verification, 353),
  direct('verifySession', input(z.object({ sessionId }).readonly(), '@paimind/agent-builder#AgentVerifySessionInput'), verification, 360),
  direct('listAudit', [], z.object({ migrations: z.array(migration).readonly(), verifications: z.array(verification).readonly() }).readonly(), 360),
])

export const TYPERT_REMOTE = Object.freeze({ package: '@paimind/agent-builder', descriptors: PAIMIND_AGENT_PROFILE_REMOTE_DESCRIPTORS })
export default TYPERT_REMOTE
