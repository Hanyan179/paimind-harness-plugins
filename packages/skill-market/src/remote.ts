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
const sourceDocument = z.object({
  skillId: skillName, ...metadata, instructions: z.string(), digest, managed: z.boolean(),
}).readonly()
const packageFile = z.object({
  path: z.string().min(1).max(500), kind: z.enum(['text', 'binary']),
  size: z.number().int().nonnegative(), digest, content: z.string().optional(),
}).readonly()
const packageEntry = z.object({
  path: z.string().min(1).max(500), name: z.string().min(1),
  kind: z.enum(['directory', 'text', 'binary']), size: z.number().int().nonnegative(),
  digest: digest.optional(),
}).readonly()
const packageDirectoryPage = z.object({
  path: z.string().max(500), entries: z.array(packageEntry).max(500).readonly(),
  nextCursor: z.string().regex(/^\d+$/).optional(),
}).readonly()
const packageDocument = z.object({
  skillId: skillName, ...metadata, digest, managed: z.boolean(),
  root: packageDirectoryPage,
}).readonly()
const packageChange = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('write'), path: z.string().min(1).max(500), content: z.string(), expectedDigest: digest.optional() }).readonly(),
  z.object({ operation: z.literal('delete'), path: z.string().min(1).max(500), expectedDigest: digest.optional() }).readonly(),
  z.object({ operation: z.literal('mkdir'), path: z.string().min(1).max(500) }).readonly(),
]).readonly()
const authoringDraft = z.object({
  draftId: z.uuid(), sessionId: z.string(), name: skillName, description: z.string(),
  whenToUse: z.string().optional(), instructions: z.string(), updatedAt: z.number().nonnegative(),
}).readonly()
const removal = z.object({
  skillId: skillName, removedAt: z.number().nonnegative(), recoverable: z.boolean(),
}).readonly()
const catalogItem = z.object({
  id: skillName, name: skillName, description: z.string(), version: z.string(),
  source: z.string(), license: z.string(), digest,
}).readonly()
const skillNameList = z.array(skillName).max(10_000).readonly()
const userSkillPolicy = z.object({
  schema: z.literal('paimind.user-skill-policy/v1'),
  revision: z.number().int().nonnegative(),
  enabledOptionalSystemSkillNames: skillNameList,
  enabledBusinessSkillNames: skillNameList,
  directBusinessSkillNames: skillNameList,
}).readonly()
const sessionBusinessSkillSelection = z.object({
  schema: z.literal('paimind.session-business-skill-selection/v1'),
  revision: z.number().int().nonnegative(),
  skillNames: skillNameList,
}).readonly()
const systemSkillReferenceBase = {
  kind: z.literal('system'), canonicalId: z.string().regex(/^system:[a-z0-9][a-z0-9-]*$/),
  name: skillName, description: z.string(), whenToUse: z.string().optional(), sourcePluginId: z.string(),
} as const
const systemSkillReference = z.discriminatedUnion('availability', [
  z.object({
    ...systemSkillReferenceBase,
    availability: z.literal('mandatory'), userControl: z.literal('locked'),
  }).readonly(),
  z.object({
    ...systemSkillReferenceBase,
    availability: z.literal('optional'), userControl: z.literal('atomic'),
  }).readonly(),
]).readonly()

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
    id: '@paimind/skill-market#paimindSkillInstaller/listSystemSkills',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'listSystemSkills',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: {
      mode: 'strict' as const, typeSymbol: '@paimind/contracts#PaimindSystemSkillCatalogSnapshot',
      schema: z.object({ items: z.array(systemSkillReference).readonly() }).readonly(),
    },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 1060, column: 3 },
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
    id: '@paimind/skill-market#paimindSkillInstaller/getUserSkillPolicy',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'getUserSkillPolicy',
    invocation: { kind: 'direct' as const }, parameters: [],
    result: {
      mode: 'strict' as const, typeSymbol: '@paimind/contracts#PaimindUserSkillPolicyV1',
      schema: userSkillPolicy,
    },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 1100, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/replaceUserSkillPolicy',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'replaceUserSkillPolicy',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@paimind/contracts#PaimindUserSkillPolicyReplaceInput',
        schema: z.object({
          expectedRevision: z.number().int().nonnegative(),
          enabledOptionalSystemSkillNames: skillNameList,
          enabledBusinessSkillNames: skillNameList,
          directBusinessSkillNames: skillNameList,
        }).readonly(),
      },
    }],
    result: {
      mode: 'strict' as const, typeSymbol: '@paimind/contracts#PaimindUserSkillPolicyV1',
      schema: userSkillPolicy,
    },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 1106, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/getSkillSource',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'getSkillSource',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillSourceInput', schema: z.object({ skillId: skillName }).readonly() },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillSourceDocument', schema: sourceDocument },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 875, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/getSessionBusinessSkillSelection',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'getSessionBusinessSkillSelection',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const,
        typeSymbol: '@paimind/skill-market#PaimindSessionBusinessSkillSelectionInput',
        schema: z.object({ sessionId: z.string().min(1).max(200) }).readonly(),
      },
    }],
    result: {
      mode: 'strict' as const,
      typeSymbol: '@paimind/contracts#PaimindSessionBusinessSkillSelectionV1',
      schema: sessionBusinessSkillSelection,
    },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 960, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/replaceSessionBusinessSkillSelection',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'replaceSessionBusinessSkillSelection',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const,
        typeSymbol: '@paimind/contracts#PaimindSessionBusinessSkillSelectionReplaceInput',
        schema: z.object({
          sessionId: z.string().min(1).max(200),
          expectedRevision: z.number().int().nonnegative(),
          skillNames: skillNameList,
        }).readonly(),
      },
    }],
    result: {
      mode: 'strict' as const,
      typeSymbol: '@paimind/contracts#PaimindSessionBusinessSkillSelectionV1',
      schema: sessionBusinessSkillSelection,
    },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 966, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/saveSkillSource',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'saveSkillSource',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillSourceSaveInput',
        schema: z.object({ name: skillName, description: z.string(), instructions: z.string(), expectedDigest: digest.optional() }).readonly(),
      },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillInstallResult', schema: installResult },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 895, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/getSkillPackage',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'getSkillPackage',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillPackageInput',
        schema: z.object({ skillId: skillName }).readonly(),
      },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillPackageDocument', schema: packageDocument },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 1745, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/listSkillPackageDirectory',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'listSkillPackageDirectory',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillPackageDirectoryInput',
        schema: z.object({
          skillId: skillName, path: z.string().max(500).optional(),
          cursor: z.string().regex(/^\d+$/).optional(), limit: z.number().int().min(1).max(500).optional(),
        }).readonly(),
      },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillPackageDirectoryPage', schema: packageDirectoryPage },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 1957, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/readSkillPackageFile',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'readSkillPackageFile',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillPackageFileInput',
        schema: z.object({ skillId: skillName, path: z.string().min(1).max(500) }).readonly(),
      },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillPackageFile', schema: packageFile },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 1970, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/saveSkillPackage',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'saveSkillPackage',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: {
        mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillPackageSaveInput',
        schema: z.object({
          skillId: skillName.optional(), expectedDigest: digest.optional(),
          changes: z.array(packageChange).min(1).max(1_000).readonly(),
        }).readonly(),
      },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillInstallResult', schema: installResult },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 1765, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/getAuthoringDraft',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'getAuthoringDraft',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillAuthoringDraftInput', schema: z.object({ sessionId: z.string() }).readonly() },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillAuthoringDraft', schema: authoringDraft.nullable() },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 950, column: 3 },
  },
  {
    id: '@paimind/skill-market#paimindSkillInstaller/dismissAuthoringDraft',
    service: 'paimindSkillInstaller', namespace: 'paimindSkillInstaller', method: 'dismissAuthoringDraft',
    invocation: { kind: 'direct' as const },
    parameters: [{
      name: 'input', wire: 'input', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillAuthoringDraftDismissInput', schema: z.object({ sessionId: z.string(), draftId: z.uuid() }).readonly() },
    }],
    result: { mode: 'strict' as const, typeSymbol: '@paimind/skill-market#SkillAuthoringDraftDismissed', schema: z.object({ dismissed: z.boolean() }).readonly() },
    sourceLocation: { file: 'packages/skill-market/src/installer.ts', line: 955, column: 3 },
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
