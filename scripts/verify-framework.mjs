import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('.')
const packagesRoot = resolve(root, 'packages')
const failures = []
const pluginPackages = []
const descriptorExemptions = new Set([
  '@hansen/workspace-project',
  '@hansen/better-sidebar-adapter',
])
const expectedExtensionCategories = [
  'experience', 'content-rendering', 'agents', 'skills-tools',
  'automation', 'governance', 'developer',
]

for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageRoot = resolve(packagesRoot, entry.name)
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  if (manifest.dsh?.client !== undefined) {
    pluginPackages.push(manifest.name)
    if (manifest.exports?.['./package.json'] !== './package.json') {
      failures.push(`${manifest.name}: dsh.client discovery requires exports["./package.json"]`)
    }
    if (!descriptorExemptions.has(manifest.name)) {
      let clientSource = ''
      try {
        clientSource = await readFile(resolve(packageRoot, manifest.hansenBuild?.client), 'utf8')
      } catch {
        failures.push(`${manifest.name}: user-visible client has no readable source entry`)
      }
      if (!clientSource.includes('contributePaimindExtension')) {
        failures.push(`${manifest.name}: user-visible client has no Extension Center descriptor contribution`)
      }
    }
  }
  if (manifest.hansenBuild?.client !== undefined) {
    try {
      await readFile(resolve(packageRoot, 'lib/client.js'))
    } catch {
      failures.push(`${manifest.name}: missing lib/client.js`)
    }
  }
}

const patch = await readFile(resolve(packagesRoot, 'harness-bundle/cordis.patch.yml'), 'utf8')
for (const packageName of pluginPackages) {
  if (!patch.includes(packageName)) {
    failures.push(`${packageName}: absent from harness bundle patch`)
  }
}

const contractsSource = await readFile(resolve(packagesRoot, 'contracts/src/index.ts'), 'utf8')
const categoryDeclaration = contractsSource.match(/PAIMIND_EXTENSION_CATEGORIES\s*=\s*\[([\s\S]*?)\]\s*as const/)
const actualCategories = categoryDeclaration === null
  ? []
  : [...categoryDeclaration[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1])
if (JSON.stringify(actualCategories) !== JSON.stringify(expectedExtensionCategories)) {
  failures.push(`contracts: Extension Center categories must be exactly ${expectedExtensionCategories.join(', ')}`)
}

const taskManifest = JSON.parse(await readFile(resolve(packagesRoot, 'task-monitor/package.json'), 'utf8'))
const taskDependencies = { ...taskManifest.dependencies, ...taskManifest.peerDependencies, ...taskManifest.devDependencies }
if (Object.keys(taskDependencies).some(name => name.includes('better-sidebar'))) {
  failures.push('@hansen/task-monitor: must not depend on Better Sidebar')
}
const taskClient = await readFile(resolve(packagesRoot, 'task-monitor/src/client/index.tsx'), 'utf8')
const taskProjection = await readFile(resolve(packagesRoot, 'task-monitor/src/index.ts'), 'utf8')
for (const marker of [
  'conversation.session.header.actions', "id: 'agent-preset'", "id: 'job-list'",
  'conversation.session.header.utilities', "id: 'session-log-download'", 'sessionLogDownload', "faceOf('goal')",
  'props.useSession', "category: 'automation'",
]) {
  if (!taskClient.includes(marker)) failures.push(`@hansen/task-monitor: complete native monitor client is missing ${marker}`)
}
for (const marker of [
  'input.sessions.jobsBySession', 'collectInputFiles', 'collectDeliverables',
  "source?.kind === 'skill-invocation'", 'collectMcps', 'projectTaskMonitor',
]) {
  if (!taskProjection.includes(marker)) failures.push(`@hansen/task-monitor: deterministic native projection is missing ${marker}`)
}
for (const forbidden of ['paimindTaskPreview', 'registerTab(', 'paimindSidebar', 'PaimindTaskRegistry']) {
  if (taskClient.includes(forbidden)) failures.push(`@hansen/task-monitor: retired task surface/state marker remains: ${forbidden}`)
}

const artifactsClient = await readFile(resolve(packagesRoot, 'artifacts/src/client/index.tsx'), 'utf8')
if (/paimindSidebar\.registerTab\s*\(\s*\{\s*id:\s*['"]paimind:artifacts['"]/.test(artifactsClient)) {
  failures.push('@hansen/artifacts: fixed Artifacts sidebar tab must remain retired')
}
const bentoClient = await readFile(resolve(packagesRoot, 'renderer-bento/src/client/index.tsx'), 'utf8')
if (!/id:\s*['"]paimind:bento-preview['"][\s\S]{0,180}hidden:\s*true/.test(bentoClient)) {
  failures.push('@hansen/renderer-bento: Bento workbench must remain a hidden on-demand tab')
}
const sidebarAdapter = await readFile(resolve(packagesRoot, 'better-sidebar-adapter/src/index.ts'), 'utf8')
for (const marker of ['PAIMIND_SIDEBAR_CONTRACT_VERSION = 4', 'readonly hidden?: boolean', 'PaimindSidebarOpenTabOptions']) {
  if (!sidebarAdapter.includes(marker)) failures.push(`@hansen/better-sidebar-adapter: on-demand tab contract is missing ${marker}`)
}

const extensionCenterClient = await readFile(resolve(packagesRoot, 'extension-center/src/client/index.tsx'), 'utf8')
const featurePackCatalog = await readFile(resolve(packagesRoot, 'extension-center/src/feature-packs.ts'), 'utf8')
if (/pluginInventory\.(?:add|remove|install|uninstall|enable|disable|toggle)\s*\(/.test(extensionCenterClient)) {
  failures.push('@hansen/extension-center: must not mutate the Harness Plugin Registry')
}
if (extensionCenterClient.includes('paimindLauncher')) {
  failures.push('@hansen/extension-center: must remain capability management rather than Launcher navigation')
}
for (const packId of ['experience', 'agents', 'context', 'content', 'proposal', 'automation', 'operations']) {
  if (!featurePackCatalog.includes(`id: 'paimind:pack:${packId}'`)) {
    failures.push(`@hansen/extension-center: product Feature Pack catalog is missing ${packId}`)
  }
  if (!featurePackCatalog.includes(`loaderEntryId: 'paimind-pack-${packId}'`)) {
    failures.push(`@hansen/extension-center: stable Loader group id is missing for ${packId}`)
  }
}
for (const marker of ['paimind:capability:runtime-orbs', 'paimind-capability-runtime-orbs']) {
  if (!featurePackCatalog.includes(marker)) failures.push(`@hansen/extension-center: nested capability is missing ${marker}`)
}
for(const marker of ['paimind:capability:workspace-editors','paimind-capability-workspace-editors'])if(!featurePackCatalog.includes(marker))failures.push(`@hansen/extension-center: workspace editor capability is missing ${marker}`)
if (!/id: paimind-capability-runtime-orbs\s+name: cordis:group\s+group: true\s+disabled: true/u.test(patch)) {
  failures.push('@hansen/extension-center: nested capability must remain boot-disabled until Feature Pack reconciliation')
}

const brandingClient = await readFile(resolve(packagesRoot, 'branding/src/client/index.tsx'), 'utf8')
const brandingCompat = await readFile(resolve(packagesRoot, 'harness-compat/src/index.ts'), 'utf8')
for (const marker of ["surface: 'shell'", "ctx.slots.inject('shell.overlay'", 'installHarnessDocumentBranding']) {
  if (!brandingClient.includes(marker)) failures.push(`@hansen/branding: reversible shell identity is missing ${marker}`)
}
for (const forbidden of ['data-ds-dark-theme', 'setAttribute(\'data-ds-dark-theme\'', 'document.body.style', 'sidebar.workspaces']) {
  if (brandingClient.includes(forbidden)) failures.push(`@hansen/branding: theme or Sidebar ownership is forbidden: ${forbidden}`)
}
for (const sensitiveMarker of ['0 0 182 24', '0 0 23.16 17.04', 'DeepSeek Harness']) {
  if (brandingClient.includes(sensitiveMarker) || !brandingCompat.includes(sensitiveMarker)) {
    failures.push(`@hansen/branding: RC6-sensitive marker must exist only in harness-compat: ${sensitiveMarker}`)
  }
}

const workspaceBlueprintManifest = JSON.parse(await readFile(resolve(packagesRoot, 'workspace-blueprints/package.json'), 'utf8'))
const workspaceBlueprintHost = await readFile(resolve(packagesRoot, 'workspace-blueprints/src/index.ts'), 'utf8')
const workspaceBlueprintCatalog = await readFile(resolve(packagesRoot, 'workspace-blueprints/src/catalog.ts'), 'utf8')
const workspaceBlueprintContract = await readFile(resolve(packagesRoot, 'workspace-blueprints/src/contract.ts'), 'utf8')
const workspaceBlueprintRemote = await readFile(resolve(packagesRoot, 'workspace-blueprints/src/remote.ts'), 'utf8')
const workspaceBlueprintClient = await readFile(resolve(packagesRoot, 'workspace-blueprints/src/client/index.tsx'), 'utf8')
for (const marker of [
  "export const inject = ['workspaceRegistry']",
  'new WorkspaceBlueprintCatalog(blueprintCtx.workspaceRegistry',
  'const initialWorkspace = this.requireWorkspace(input.workspaceId)',
  'this.workspaceRegistry.list().find(candidate => candidate.id === workspaceId)',
  "const BASE_INJECT = ['slots', 'locale', 'remote', 'workspaces', 'sessions'] as const",
  'const workspace = await props.workspaces.create({ path })',
  'workspaceId: workspace.workspaceId',
  'props.workspaces.startSession(workspace.workspaceId)',
]) {
  if (!workspaceBlueprintHost.includes(marker)
    && !workspaceBlueprintCatalog.includes(marker)
    && !workspaceBlueprintClient.includes(marker)) {
    failures.push(`@hansen/workspace-blueprints: native Workspace ownership or workspaceId materialization boundary is missing ${marker}`)
  }
}
const workspaceBlueprintMaterializeInput = workspaceBlueprintContract.match(
  /export interface WorkspaceBlueprintMaterializeInput[^}]*}/,
)?.[0] ?? ''
const workspaceBlueprintRemoteInput = workspaceBlueprintRemote.match(
  /const materializeInput = (?:z\.object|identityInputObject\.extend)\(\{[\s\S]*?\}\)\.strict\(\)\.readonly\(\)/,
)?.[0] ?? ''
if (!workspaceBlueprintMaterializeInput.includes('readonly workspaceId: string')
  || workspaceBlueprintMaterializeInput.includes('readonly path: string')
  || !workspaceBlueprintRemoteInput.includes('workspaceId:')
  || workspaceBlueprintRemoteInput.includes('path:')) {
  failures.push('@hansen/workspace-blueprints: materialization must accept a strict workspaceId, never a caller-controlled path')
}
if (workspaceBlueprintManifest.dependencies?.['@hansen/agent-market'] !== undefined
  || workspaceBlueprintManifest.peerDependencies?.['@hansen/agent-market'] !== undefined) {
  failures.push('@hansen/workspace-blueprints: composition must use the Agent owner contract, not the Agent Center presentation package')
}
for (const forbidden of [
  'saveProfile(', 'installUpload(', 'saveSkillPackage(',
  'window.localStorage', 'window.sessionStorage',
]) {
  if (workspaceBlueprintHost.includes(forbidden)
    || workspaceBlueprintCatalog.includes(forbidden)
    || workspaceBlueprintClient.includes(forbidden)) {
    failures.push(`@hansen/workspace-blueprints: composition ownership boundary forbids ${forbidden}`)
  }
}
for (const marker of [
  'WorkspaceBlueprintComposition',
  'readonly agent:',
  'readonly businessSkills:',
  'readonly digest:',
]) {
  if (!workspaceBlueprintContract.includes(marker)) {
    failures.push(`@hansen/workspace-blueprints: Folder-first composition contract is missing ${marker}`)
  }
}
if (/recommendations?|推荐能力/u.test(workspaceBlueprintContract)
  || /\.recommendations\b/.test(workspaceBlueprintClient)) {
  failures.push('@hansen/workspace-blueprints: deterministic composition must not regress to recommendation metadata')
}
for (const marker of [
  "join(stage, '.paimind', 'workspace-blueprint.json')",
  'getWorkspaceComposition(',
  'packageDigest: blueprint.manifest.digest',
  'composition: blueprint.manifest.composition',
]) {
  if (!workspaceBlueprintCatalog.includes(marker)) {
    failures.push(`@hansen/workspace-blueprints: persistent Workspace composition projection is missing ${marker}`)
  }
}

const developerResourcesClient = await readFile(resolve(packagesRoot, 'developer-resources/src/client/index.tsx'), 'utf8')
const developerResourcesCore = await readFile(resolve(packagesRoot, 'developer-resources/src/index.ts'), 'utf8')
for (const marker of [
  'remote.pluginInventory.list()', "const EXTENSION_SLOT = 'paimind.extension'", 'PAIMIND_INTEGRATION_REFERENCES',
  "category: 'developer'", "name: 'settings.section'", 'Bundled reference',
]) {
  if (!developerResourcesClient.includes(marker) && !developerResourcesCore.includes(marker)) {
    failures.push(`@hansen/developer-resources: truthful read-only surface is missing ${marker}`)
  }
}
if (/pluginInventory\.(?:add|remove|install|uninstall|enable|disable|toggle)\s*\(/.test(developerResourcesClient)) {
  failures.push('@hansen/developer-resources: must not mutate the Harness Plugin Registry')
}
for (const forbidden of [
  'window.localStorage', 'localStorage.', 'window.sessionStorage', 'sessionStorage.',
  'dsh-better-sidebar', 'package-lock', 'node_modules/', 'dependencyGraph', 'healthScore',
]) {
  if (developerResourcesClient.includes(forbidden) || developerResourcesCore.includes(forbidden)) {
    failures.push(`@hansen/developer-resources: inferred, browser-owned or internal technical truth is forbidden: ${forbidden}`)
  }
}

const agentMarketClient = await readFile(resolve(packagesRoot, 'agent-market/src/client/index.tsx'), 'utf8')
const agentMarketProjection = await readFile(resolve(packagesRoot, 'agent-market/src/index.ts'), 'utf8')
for (const marker of ["category: 'agents'", 'api.list({})', 'resolveHarnessAgentPresetSeatControl', 'await seat.select(presetId)', 'props.profiles.saveProfile', 'this.remote.bindSession', 'installHarnessAgentPresetSettingsNavigation']) {
  if (!agentMarketClient.includes(marker)) failures.push(`@hansen/agent-market: native Preset boundary is missing ${marker}`)
}
for (const marker of ["slots.entries('conversation.hero.agentPreset')", 'hooks?.agentPresetSeat']) {
  if (!brandingCompat.includes(marker)) failures.push(`@hansen/harness-compat: native Agent Preset Seat boundary is missing ${marker}`)
}
if (agentMarketClient.includes('api.select({ sessionId')) {
  failures.push('@hansen/agent-market: direct Preset wire selection bypasses the native visible selector')
}
for (const forbidden of ['AgentRuntime', 'agentConfigStore', 'mockPreset', 'mockAgent']) {
  if (agentMarketClient.includes(forbidden) || agentMarketProjection.includes(forbidden)) {
    failures.push(`@hansen/agent-market: duplicate Agent runtime/config marker is forbidden: ${forbidden}`)
  }
}
if (!agentMarketProjection.includes('readonly preset: HarnessAgentPresetEntry')) {
  failures.push('@hansen/agent-market: catalog rows must retain the exact Harness Preset object')
}

const skillMarketClient = await readFile(resolve(packagesRoot, 'skill-market/src/client/index.tsx'), 'utf8')
const skillMarketProjection = await readFile(resolve(packagesRoot, 'skill-market/src/catalog.ts'), 'utf8')
for (const marker of [
  "category: 'skills-tools'",
  'installer.listCatalog()',
  'installer.inspectCatalog',
  'installer.installUpload',
  'installer.saveSkillPackage',
  'installer.getAuthoringDraft',
  'installSkillAuthoringDraftNavigation',
]) {
  if (!skillMarketClient.includes(marker)) failures.push(`@hansen/skill-market: native Skill boundary is missing ${marker}`)
}
for (const forbidden of [
  'SkillRuntime', 'skillConfigStore', 'mockSkill', 'readFile(', 'readdir(', 'glob(',
  'api.list({ sessionId }', 'setDraft(`/${name} `)',
]) {
  if (skillMarketClient.includes(forbidden) || skillMarketProjection.includes(forbidden)) {
    failures.push(`@hansen/skill-market: duplicate runtime or Host-path discovery marker is forbidden: ${forbidden}`)
  }
}
if (!skillMarketProjection.includes('readonly skill: HarnessSkillEntry')) {
  failures.push('@hansen/skill-market: catalog rows must retain the exact Harness Skill object')
}
const skillInstaller = await readFile(resolve(packagesRoot, 'skill-market/src/installer.ts'), 'utf8')
for (const marker of [
  'pipeline(request',
  'safeArchivePath',
  'isSymlink(entry)',
  'MAX_EXPANSION_RATIO',
  'await rename(staging, destination)',
  'PAIMIND_SKILL_PREPARE_CREATE_TOOL',
  'PAIMIND_SKILL_AUTHORING_SKILL',
  'assertBusinessSkillName',
  'await cp(destination, staging',
  'installPaimindScopedSkillProjection',
  'WeakMap<SkillInstallerHostSession',
  'getSessionBusinessSkillSelection',
  'replaceSessionBusinessSkillSelection',
  "installerCtx.on('agent/pre-step'",
  'Promise.allSettled',
  "get?.('paimindWorkspaceBlueprints')",
  'getWorkspaceComposition({',
  'skillPackageRevision(join(this.skillRoot, record.skillId))',
]) {
  if (!skillInstaller.includes(marker)) failures.push(`@hansen/skill-market: streaming atomic installer is missing ${marker}`)
}
for (const forbidden of [
  'PAIMIND_SESSION_SKILL_SELECTION_EVENT',
  'session.append(',
  'sessionProjections.register',
]) {
  if (skillInstaller.includes(forbidden)) {
    failures.push(`@hansen/skill-market: unsafe Session selection persistence marker is forbidden: ${forbidden}`)
  }
}
const skillScopeResolver = await readFile(resolve(packagesRoot, 'skill-market/src/scope.ts'), 'utf8')
for (const marker of [
  'resolvePaimindSkillScope',
  "input.sessionKind === 'direct'",
  'policy.directBusinessSkillNames',
  'input.agentBusinessSkillNames',
  'input.workspaceComposition',
  'input.sessionBusinessSkillNames',
  'Workspace Business Skill digest mismatch',
  'System and Business Skill name collision',
]) {
  if (!skillScopeResolver.includes(marker)) failures.push(`@hansen/skill-market: stateless Skill scope resolver is missing ${marker}`)
}
const scopedSkillCompat = await readFile(resolve(packagesRoot, 'harness-compat/src/host.ts'), 'utf8')
for (const marker of ['installPaimindScopedSkillProjection', "registry.registerProvider", "source: 'custom' as const"]) {
  if (!scopedSkillCompat.includes(marker)) failures.push(`@hansen/harness-compat: native scoped Skill projection is missing ${marker}`)
}
const skillRecommended = await readFile(resolve(packagesRoot, 'skill-market/src/recommended.ts'), 'utf8')
for (const forbidden of ["id: 'skill-creator'", "id: 'skill-installer'"]) {
  if (skillRecommended.includes(forbidden)) failures.push(`@hansen/skill-market: system Skill must not be listed as a business Skill: ${forbidden}`)
}
const skillAuthoring = await readFile(resolve(packagesRoot, 'skill-market/SKILL_AUTHORING.md'), 'utf8')
for (const marker of ['name: paimind-skill-authoring', 'paimind_skill_prepare_create', 'unsaved draft']) {
  if (!skillAuthoring.includes(marker)) failures.push(`@hansen/skill-market: Skill authoring system capability is missing ${marker}`)
}
const agentBuilderManifest = JSON.parse(await readFile(resolve(packagesRoot, 'agent-builder/package.json'), 'utf8'))
if (agentBuilderManifest.dsh?.client !== undefined || agentBuilderManifest.hansenBuild?.client !== undefined) {
  failures.push('@hansen/agent-builder: Builder must remain a headless workflow service with no independent client page')
}
const agentBuilderSource = await readFile(resolve(packagesRoot, 'agent-builder/src/index.ts'), 'utf8')
for (const marker of ['businessSkillNamesForPreset', 'PAIMIND_STANDARD_AGENT_BASE_PRESET_ID', 'AGENT_SKILL_SCOPE_DIRECTORY']) {
  if (!agentBuilderSource.includes(marker)) failures.push(`@hansen/agent-builder: authoritative Agent Skill selection boundary is missing ${marker}`)
}
for (const forbidden of ['AGENT_AUTHORING_SYSTEM_PROTOCOL', 'capabilityPrompt']) {
  if (agentBuilderSource.includes(forbidden)) failures.push(`@hansen/agent-builder: duplicate authoring or Skill Persona injection marker is forbidden: ${forbidden}`)
}

const userSettingsClient = await readFile(resolve(packagesRoot, 'user-settings/src/client/index.tsx'), 'utf8')
const userSettingsEditor = await readFile(resolve(packagesRoot, 'user-settings/src/client/editor.ts'), 'utf8')
const userSettingsHost = await readFile(resolve(packagesRoot, 'user-settings/src/index.ts'), 'utf8')
for (const marker of [
  "category: 'experience'", "surface: 'settings'", 'remote.$mount(TYPERT_REMOTE)',
  'expectedRevision: revision', 'data-paimind-saved-preview', 'personalization.aboutMe', 'personalization.customInstructions', 'getPersonalizationEditor',
]) {
  if (!userSettingsClient.includes(marker)) failures.push(`@hansen/user-settings: native Settings client boundary is missing ${marker}`)
}
for (const marker of [
  'installPaimindHostSettings<PaimindPersonalization>', "name: 'paimind:personalization'",
  'systemPrompt.context', 'renderPaimindPersonalizationContext(this.source())',
  'async saveText(', 'mutatePaimindHostSettingsOperations',
]) {
  if (!userSettingsHost.includes(marker)) failures.push(`@hansen/user-settings: live Host consumer is missing ${marker}`)
}
for (const forbidden of [
  'window.localStorage', 'localStorage.', 'window.sessionStorage', 'sessionStorage.',
  'memoryStore', 'theme:', 'language:', 'model:', 'agentPreset:',
]) {
  if (`${userSettingsClient}\n${userSettingsEditor}`.includes(forbidden)) failures.push(`@hansen/user-settings: duplicate or browser-only preference marker is forbidden: ${forbidden}`)
}
const runtimeOrbClient = await readFile(resolve(packagesRoot, 'runtime-orbs/src/client/index.tsx'), 'utf8')
// User-controlled motion supersedes the former OS-only policy. The shared
// foundation resolves preference; runtime-orbs remains only a consumer.
if (!runtimeOrbClient.includes("from '@hansen/ui-foundation'")
  || !runtimeOrbClient.includes('readPaimindMotion')
  || !runtimeOrbClient.includes('subscribePaimindMotion')
  || runtimeOrbClient.includes('prefers-reduced-motion')
  || runtimeOrbClient.includes('data-paimind-motion')) {
  failures.push('@hansen/runtime-orbs: motion must consume the shared foundation, without a second preference resolver or store')
}
const notificationHost = await readFile(resolve(packagesRoot, 'notifications/src/index.ts'), 'utf8')
if (notificationHost.includes('paimindUserSettings') || notificationHost.includes('shouldPublishNotification')) {
  failures.push('@hansen/notifications: Personalization must not own or filter Notification publication')
}

const bundleManifest = JSON.parse(await readFile(resolve(packagesRoot, 'harness-bundle/package.json'), 'utf8'))
const bundleDependencies = Object.keys(bundleManifest.dependencies ?? {})
for (const required of [
  '@hansen/platform-scheduler', '@hansen/scheduler-adapter-harness',
  '@hansen/scheduler-adapter-http', '@hansen/scheduler-adapter-feishu-bot',
]) {
  if (!bundleDependencies.includes(required) || !patch.includes(`name: '${required}'`)) {
    failures.push(`@hansen/harness-bundle: active platform Scheduler composition is missing ${required}`)
  }
}
if (!patch.includes("name: '@hansen/scheduler-adapter-harness/agent-action'")) {
  failures.push('@hansen/harness-bundle: built-in Agent Session schedule action is missing')
}
for (const retiredNativeSchedulerPackage of ['@deepseek-ai/dsh-schedule', '@deepseek-ai/dsh-time-context']) {
  if (bundleDependencies.includes(retiredNativeSchedulerPackage) || patch.includes(`name: '${retiredNativeSchedulerPackage}'`)) {
    failures.push(`@hansen/harness-bundle: retired native Session-reminder package must not be selected: ${retiredNativeSchedulerPackage}`)
  }
}
const futureSchedulerManifest = JSON.parse(await readFile(resolve(packagesRoot, 'scheduler/package.json'), 'utf8'))
if (futureSchedulerManifest.name !== '@hansen/platform-scheduler') {
  failures.push('@hansen/platform-scheduler: active platform package name must remain stable')
}
const platformSchedulerClient = await readFile(resolve(packagesRoot, 'scheduler/src/client/index.tsx'), 'utf8')
if (!platformSchedulerClient.includes("name: 'settings.section'") || !platformSchedulerClient.includes("surface: 'settings'")) {
  failures.push('@hansen/platform-scheduler: management entry must remain inside Settings')
}
if (!platformSchedulerClient.includes('<SchedulerWorkspace controller={props.controller} zh={zh}')) {
  failures.push('@hansen/platform-scheduler: Settings must render the task workspace directly')
}
if (platformSchedulerClient.includes("slots.inject('sidebar.footer.action'")) {
  failures.push('@hansen/platform-scheduler: duplicate sidebar footer entry is forbidden')
}
for (const intermediateSchedulerSurface of ['\u6253\u5f00\u4efb\u52a1\u5217\u8868', 'Open task list', "name: 'shell.overlay', id: 'paimind-scheduler-overlay'"]) {
  if (platformSchedulerClient.includes(intermediateSchedulerSurface)) {
    failures.push(`@hansen/platform-scheduler: intermediate Scheduler surface is forbidden: ${intermediateSchedulerSurface}`)
  }
}
for (const technicalTaskListDetail of [
  '<div data-paimind-scheduler-muted>{definition.scheduleId}</div>',
  '<div data-paimind-scheduler-muted>{definition.timeZone}</div>',
  '<div data-paimind-scheduler-muted>{latest.message}</div>',
]) {
  if (platformSchedulerClient.includes(technicalTaskListDetail)) {
    failures.push(`@hansen/platform-scheduler: task-list technical detail is forbidden: ${technicalTaskListDetail}`)
  }
}

for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageRoot = resolve(packagesRoot, entry.name)
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  if (manifest.dsh?.client === undefined) continue
  const clientSource = await readFile(resolve(packageRoot, manifest.hansenBuild?.client), 'utf8')
  if (clientSource.includes("category: 'governance'")) {
    failures.push(`${manifest.name}: Governance product must not appear before an authenticated authorization provider exists`)
  }
}

const bentoManifest = JSON.parse(await readFile(resolve(packagesRoot, 'renderer-bento/package.json'), 'utf8'))
const bentoDependencies = { ...bentoManifest.dependencies, ...bentoManifest.peerDependencies, ...bentoManifest.devDependencies }
if (Object.keys(bentoDependencies).some(name => name === 'dsh-better-sidebar' || name.startsWith('dsh-better-sidebar/'))) {
  failures.push('@hansen/renderer-bento: core must use only the PAIMind Preview/Side Card adapter')
}

const sensitiveImport = /from ['"](@deepseek-ai\/[^'"]+)/g
const compatibilityNeutralHostImports = new Set(['@deepseek-ai/dsh-home-paths'])
const externalSidebarImport = /from ['"]dsh-better-sidebar(?:\/|['"])/
for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'harness-compat') continue
  const sourceRoot = resolve(packagesRoot, entry.name, 'src')
  let files = []
  try {
    files = await readdir(sourceRoot, { recursive: true })
  } catch {
    continue
  }
  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    const source = await readFile(resolve(sourceRoot, file), 'utf8')
    for (const match of source.matchAll(sensitiveImport)) {
      if (!compatibilityNeutralHostImports.has(match[1])) failures.push(`${entry.name}/${file}: imports a version-sensitive Harness package`)
    }
    if (entry.name !== 'better-sidebar-adapter' && externalSidebarImport.test(source)) {
      failures.push(`${entry.name}/${file}: bypasses the Better Sidebar adapter boundary`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`framework verification passed: ${pluginPackages.length} client plugin(s), seven Product Feature Packs with nested optional capabilities, seven-category technical descriptor taxonomy, Registry remains installation/version truth, Loader remains lifecycle truth, Task Monitor is a complete native read-only monitor, Bento is hidden on-demand and adapter-only, no synthetic Governance product, every user-visible client contributes one descriptor, only compatibility-neutral home-path imports exist outside harness-compat, zero Better Sidebar imports outside better-sidebar-adapter`)
}
