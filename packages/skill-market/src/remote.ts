import { z } from 'zod'

const skillName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/)
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const metadata = {
  name: skillName,
  description: z.string(),
  whenToUse: z.string().optional(),
} as const
const preview = z.object({
  uploadId: z.uuid(), digest, fileName: z.string(),
  kind: z.enum(['zip', 'skill-md']),
  ...metadata,
  fileCount: z.number().int().nonnegative(),
  compressedBytes: z.number().int().nonnegative(),
  expandedBytes: z.number().int().nonnegative(),
  operation: z.enum(['install', 'update']),
  warnings: z.array(z.string()).readonly(),
  runtimeRequirements: z.array(z.enum(['python', 'node', 'system'])).readonly(),
}).readonly()
const record = z.object({
  skillId: skillName, ...metadata, digest,
  sourceFileName: z.string(), installedAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(),
  managed: z.boolean(),
  runtimeRequirements: z.array(z.enum(['python', 'node', 'system'])).readonly(),
}).readonly()
const installResult = z.object({ operation: z.enum(['installed', 'updated']), record }).readonly()
const removal = z.object({
  skillId: skillName, removedAt: z.number().nonnegative(), recoverable: z.boolean(),
}).readonly()
const catalogItem = z.object({
  id: skillName, name: skillName, description: z.string(), version: z.string(),
  source: z.string(), license: z.string(), digest,
}).readonly()

export const PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS = Object.freeze([
  {
    id: '@paimind/skill-market#paimindSkillInstaller/listCatalog',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'listCatalog',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: {
      mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillCatalogSnapshot',
      schema: z.object({ items: z.array(catalogItem).readonly() }).readonly(),
    },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 430, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/inspectCatalog',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'inspectCatalog',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillCatalogInspectInput',
        schema: z.object({ catalogId: skillName, version: z.string() }).readonly(),
      },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillUploadPreview', schema: preview },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 434, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/inspectUpload',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'inspectUpload',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillUploadInspectInput', schema: z.object({ uploadId: z.uuid() }).readonly() },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillUploadPreview', schema: preview },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 420, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/installUpload',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'installUpload',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillUploadInstallInput', schema: z.object({ uploadId: z.uuid(), digest }).readonly() },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillInstallResult', schema: installResult },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 452, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/listInstalled',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'listInstalled',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: {
      mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillInstallerSnapshot',
      schema: z.object({ items: z.array(record).readonly() }).readonly(),
    },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 496, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/uninstall',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'uninstall',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillUninstallInput', schema: z.object({ skillId: skillName, version: digest.optional() }).readonly() },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillRemovalRecord', schema: removal },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 525, column: 3 },
  },
])

export const TYPERT_REMOTE = Object.freeze({
  package: '@paimind/skill-market', descriptors: PAIMIND_SKILL_INSTALLER_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
