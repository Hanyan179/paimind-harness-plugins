import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('.')
const packagesRoot = resolve(root, 'packages')
const failures = []
const pluginPackages = []
const descriptorExemptions = new Set([
  '@paimind/workspace-project',
  '@paimind/better-sidebar-adapter',
])
const bundleExemptions = new Set([
  // Legacy Session-local facade remains buildable but is replaced by the platform surface.
  '@paimind/scheduler',
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
        clientSource = await readFile(resolve(packageRoot, manifest.paimindBuild?.client), 'utf8')
      } catch {
        failures.push(`${manifest.name}: user-visible client has no readable source entry`)
      }
      if (!clientSource.includes('contributePaimindExtension')) {
        failures.push(`${manifest.name}: user-visible client has no Extension Center descriptor contribution`)
      }
    }
  }
  if (manifest.paimindBuild?.client !== undefined) {
    try {
      await readFile(resolve(packageRoot, 'lib/client.js'))
    } catch {
      failures.push(`${manifest.name}: missing lib/client.js`)
    }
  }
}

const patch = await readFile(resolve(packagesRoot, 'harness-bundle/cordis.patch.yml'), 'utf8')
for (const packageName of pluginPackages) {
  if (!bundleExemptions.has(packageName) && !patch.includes(packageName)) {
    failures.push(`${packageName}: absent from harness bundle patch`)
  }
  if (bundleExemptions.has(packageName) && patch.includes(`name: '${packageName}'`)) {
    failures.push(`${packageName}: legacy Session-local facade must remain outside the active bundle patch`)
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
  failures.push('@paimind/task-monitor: must not depend on Better Sidebar')
}
const taskClient = await readFile(resolve(packagesRoot, 'task-monitor/src/client/index.tsx'), 'utf8')
for (const marker of [
  'conversation.session.header.actions', 'jobsBySession', "useProjection('paimind.artifacts')",
  "category: 'automation'",
]) {
  if (!taskClient.includes(marker)) failures.push(`@paimind/task-monitor: independent Native Job projection is missing ${marker}`)
}
for (const forbidden of ['paimindTaskPreview', 'registerTab(', 'paimindSidebar', 'PaimindTaskRegistry']) {
  if (taskClient.includes(forbidden)) failures.push(`@paimind/task-monitor: retired task surface/state marker remains: ${forbidden}`)
}

const extensionCenterClient = await readFile(resolve(packagesRoot, 'extension-center/src/client/index.tsx'), 'utf8')
if (/pluginInventory\.(?:add|remove|install|uninstall|enable|disable|toggle)\s*\(/.test(extensionCenterClient)) {
  failures.push('@paimind/extension-center: must not mutate the Harness Plugin Registry')
}
if (extensionCenterClient.includes('@paimind/launcher') || extensionCenterClient.includes('paimindLauncher')) {
  failures.push('@paimind/extension-center: must remain capability management rather than Launcher navigation')
}

const brandingClient = await readFile(resolve(packagesRoot, 'branding/src/client/index.tsx'), 'utf8')
const brandingCompat = await readFile(resolve(packagesRoot, 'harness-compat/src/index.ts'), 'utf8')
for (const marker of ["surface: 'shell'", "ctx.slots.inject('shell.overlay'", 'installHarnessDocumentBranding']) {
  if (!brandingClient.includes(marker)) failures.push(`@paimind/branding: reversible shell identity is missing ${marker}`)
}
for (const forbidden of ['data-ds-dark-theme', 'setAttribute(\'data-ds-dark-theme\'', 'document.body.style', 'sidebar.workspaces']) {
  if (brandingClient.includes(forbidden)) failures.push(`@paimind/branding: theme or Sidebar ownership is forbidden: ${forbidden}`)
}
for (const sensitiveMarker of ['0 0 182 24', '0 0 23.16 17.04', 'DeepSeek Harness']) {
  if (brandingClient.includes(sensitiveMarker) || !brandingCompat.includes(sensitiveMarker)) {
    failures.push(`@paimind/branding: RC6-sensitive marker must exist only in harness-compat: ${sensitiveMarker}`)
  }
}

const developerResourcesClient = await readFile(resolve(packagesRoot, 'developer-resources/src/client/index.tsx'), 'utf8')
const developerResourcesCore = await readFile(resolve(packagesRoot, 'developer-resources/src/index.ts'), 'utf8')
for (const marker of [
  'remote.pluginInventory.list()', "const EXTENSION_SLOT = 'paimind.extension'", 'PAIMIND_INTEGRATION_REFERENCES',
  "category: 'developer'", "name: 'settings.section'", 'Bundled reference',
]) {
  if (!developerResourcesClient.includes(marker) && !developerResourcesCore.includes(marker)) {
    failures.push(`@paimind/developer-resources: truthful read-only surface is missing ${marker}`)
  }
}
if (/pluginInventory\.(?:add|remove|install|uninstall|enable|disable|toggle)\s*\(/.test(developerResourcesClient)) {
  failures.push('@paimind/developer-resources: must not mutate the Harness Plugin Registry')
}
for (const forbidden of [
  'window.localStorage', 'localStorage.', 'window.sessionStorage', 'sessionStorage.',
  'dsh-better-sidebar', 'package-lock', 'node_modules/', 'dependencyGraph', 'healthScore',
]) {
  if (developerResourcesClient.includes(forbidden) || developerResourcesCore.includes(forbidden)) {
    failures.push(`@paimind/developer-resources: inferred, browser-owned or internal technical truth is forbidden: ${forbidden}`)
  }
}

const agentMarketClient = await readFile(resolve(packagesRoot, 'agent-market/src/client/index.tsx'), 'utf8')
const agentMarketProjection = await readFile(resolve(packagesRoot, 'agent-market/src/index.ts'), 'utf8')
for (const marker of ["category: 'agents'", 'api.list({})', 'api.select({ sessionId', 'props.profiles.saveProfile', 'this.remote.bindSession', 'installHarnessAgentPresetSettingsNavigation']) {
  if (!agentMarketClient.includes(marker)) failures.push(`@paimind/agent-market: native Preset boundary is missing ${marker}`)
}
for (const forbidden of ['AgentRuntime', 'agentConfigStore', 'mockPreset', 'mockAgent']) {
  if (agentMarketClient.includes(forbidden) || agentMarketProjection.includes(forbidden)) {
    failures.push(`@paimind/agent-market: duplicate Agent runtime/config marker is forbidden: ${forbidden}`)
  }
}
if (!agentMarketProjection.includes('readonly preset: HarnessAgentPresetEntry')) {
  failures.push('@paimind/agent-market: catalog rows must retain the exact Harness Preset object')
}

const skillMarketClient = await readFile(resolve(packagesRoot, 'skill-market/src/client/index.tsx'), 'utf8')
const skillMarketProjection = await readFile(resolve(packagesRoot, 'skill-market/src/catalog.ts'), 'utf8')
for (const marker of ["category: 'skills-tools'", 'api.list({ sessionId }', 'setDraft(`/${name} `)', 'installer.listCatalog()', 'installer.inspectCatalog', 'installer.installUpload']) {
  if (!skillMarketClient.includes(marker)) failures.push(`@paimind/skill-market: native Skill boundary is missing ${marker}`)
}
for (const forbidden of ['SkillRuntime', 'skillConfigStore', 'mockSkill', 'readFile(', 'readdir(', 'glob(']) {
  if (skillMarketClient.includes(forbidden) || skillMarketProjection.includes(forbidden)) {
    failures.push(`@paimind/skill-market: duplicate runtime or Host-path discovery marker is forbidden: ${forbidden}`)
  }
}
if (!skillMarketProjection.includes('readonly skill: HarnessSkillEntry')) {
  failures.push('@paimind/skill-market: catalog rows must retain the exact Harness Skill object')
}
const skillInstaller = await readFile(resolve(packagesRoot, 'skill-market/src/installer.ts'), 'utf8')
for (const marker of ['pipeline(request', 'safeArchivePath', 'isSymlink(entry)', 'MAX_EXPANSION_RATIO', 'await rename(staging, destination)']) {
  if (!skillInstaller.includes(marker)) failures.push(`@paimind/skill-market: streaming atomic installer is missing ${marker}`)
}
const agentBuilderManifest = JSON.parse(await readFile(resolve(packagesRoot, 'agent-builder/package.json'), 'utf8'))
if (agentBuilderManifest.dsh?.client !== undefined || agentBuilderManifest.paimindBuild?.client !== undefined) {
  failures.push('@paimind/agent-builder: Builder must remain a headless workflow service with no independent client page')
}

const userSettingsClient = await readFile(resolve(packagesRoot, 'user-settings/src/client/index.tsx'), 'utf8')
const userSettingsHost = await readFile(resolve(packagesRoot, 'user-settings/src/index.ts'), 'utf8')
for (const marker of [
  "category: 'experience'", "surface: 'settings'", 'remote.$mount(TYPERT_REMOTE)',
  'expectedRevision: current.revision', 'dataset.paimindMotion', 'No persistence is simulated',
]) {
  if (!userSettingsClient.includes(marker)) failures.push(`@paimind/user-settings: native Settings client boundary is missing ${marker}`)
}
for (const marker of [
  'installPaimindHostSettings<PaimindUserPreferences>', "name: 'paimind:user-preferences'",
  'shouldPublishNotification',
]) {
  if (!userSettingsHost.includes(marker)) failures.push(`@paimind/user-settings: live Host consumer is missing ${marker}`)
}
for (const forbidden of [
  'window.localStorage', 'localStorage.', 'window.sessionStorage', 'sessionStorage.',
  'memoryStore', 'theme:', 'language:', 'model:', 'agentPreset:',
]) {
  if (userSettingsClient.includes(forbidden)) failures.push(`@paimind/user-settings: duplicate or browser-only preference marker is forbidden: ${forbidden}`)
}
const runtimeOrbClient = await readFile(resolve(packagesRoot, 'runtime-orbs/src/client/index.tsx'), 'utf8')
if (!runtimeOrbClient.includes("dataset.paimindMotion === 'reduce'")) {
  failures.push('@paimind/runtime-orbs: PAIMind reduced-motion preference is not consumed')
}
const notificationHost = await readFile(resolve(packagesRoot, 'notifications/src/index.ts'), 'utf8')
if (!notificationHost.includes("inject(['paimindUserSettings']")
  || !notificationHost.includes('shouldPublishNotification(input.level)')) {
  failures.push('@paimind/notifications: future publication does not consume the optional PAIMind policy')
}

const bundleManifest = JSON.parse(await readFile(resolve(packagesRoot, 'harness-bundle/package.json'), 'utf8'))
const bundleDependencies = Object.keys(bundleManifest.dependencies ?? {})
for (const required of [
  '@paimind/platform-scheduler', '@paimind/scheduler-adapter-harness',
  '@paimind/scheduler-adapter-http', '@paimind/scheduler-adapter-feishu-bot',
]) {
  if (!bundleDependencies.includes(required) || !patch.includes(`name: '${required}'`)) {
    failures.push(`@paimind/harness-bundle: active platform Scheduler composition is missing ${required}`)
  }
}
if (!patch.includes("name: '@paimind/scheduler-adapter-harness/agent-action'")) {
  failures.push('@paimind/harness-bundle: built-in Agent Session schedule action is missing')
}
if (bundleDependencies.includes('@paimind/scheduler') || patch.includes("name: '@paimind/scheduler'")) {
  failures.push('@paimind/harness-bundle: legacy Session-local Scheduler facade must not compete with the platform Scheduler')
}
for (const retiredNativeSchedulerPackage of ['@deepseek-ai/dsh-schedule', '@deepseek-ai/dsh-time-context']) {
  if (bundleDependencies.includes(retiredNativeSchedulerPackage) || patch.includes(`name: '${retiredNativeSchedulerPackage}'`)) {
    failures.push(`@paimind/harness-bundle: retired native Session-reminder package must not be selected: ${retiredNativeSchedulerPackage}`)
  }
}
const nativeSchedulerHost = await readFile(resolve(packagesRoot, 'scheduler-native/src/index.ts'), 'utf8')
const nativeSchedulerClient = await readFile(resolve(packagesRoot, 'scheduler-native/src/client/index.tsx'), 'utf8')
const schedulerCompat = await readFile(resolve(packagesRoot, 'harness-compat/src/host.ts'), 'utf8')
for (const marker of [
  'listPaimindNativeSchedules', "static inject = ['sessions']", "markPaimindHostRemoteMethods(this, ['list'])",
]) {
  if (!nativeSchedulerHost.includes(marker)) failures.push(`@paimind/scheduler: native Session projection is missing ${marker}`)
}
for (const marker of [
  'schedule_create', 'schedule_delete', "session.prompt([{ type: 'text', text }], 'queue')",
  "category: 'automation'", "surface: 'header-button'", 'session-local',
]) {
  if (!nativeSchedulerClient.includes(marker)) failures.push(`@paimind/scheduler: native management surface is missing ${marker}`)
}
for (const forbidden of [
  'definePaimindStorageDomain', 'PaimindSchedulerCore', 'PAIMIND_SCHEDULER_DOMAIN',
  'scheduler-adapter-harness', 'scheduler-adapter-http', 'PaimindScheduleRun', 'Run Now', 'Cron',
]) {
  if (nativeSchedulerHost.includes(forbidden) || nativeSchedulerClient.includes(forbidden)) {
    failures.push(`@paimind/scheduler: shadow Scheduler runtime marker is forbidden: ${forbidden}`)
  }
}
for (const marker of ["from '@deepseek-ai/dsh-schedule'", 'foldScheduleEvents', 'scheduleView']) {
  if (!schedulerCompat.includes(marker)) failures.push(`@paimind/harness-compat: native Schedule compatibility boundary is missing ${marker}`)
}
const futureSchedulerManifest = JSON.parse(await readFile(resolve(packagesRoot, 'scheduler/package.json'), 'utf8'))
if (futureSchedulerManifest.name !== '@paimind/platform-scheduler') {
  failures.push('@paimind/platform-scheduler: active platform package name must remain stable')
}
const platformSchedulerClient = await readFile(resolve(packagesRoot, 'scheduler/src/client/index.tsx'), 'utf8')
if (!platformSchedulerClient.includes("name: 'settings.section'") || !platformSchedulerClient.includes("surface: 'settings'")) {
  failures.push('@paimind/platform-scheduler: management entry must remain inside Settings')
}
if (platformSchedulerClient.includes("slots.inject('sidebar.footer.action'")) {
  failures.push('@paimind/platform-scheduler: duplicate sidebar footer entry is forbidden')
}
for (const technicalTaskListDetail of [
  '<div data-paimind-scheduler-muted>{definition.scheduleId}</div>',
  '<div data-paimind-scheduler-muted>{definition.timeZone}</div>',
  '<div data-paimind-scheduler-muted>{latest.message}</div>',
]) {
  if (platformSchedulerClient.includes(technicalTaskListDetail)) {
    failures.push(`@paimind/platform-scheduler: task-list technical detail is forbidden: ${technicalTaskListDetail}`)
  }
}

const permissionsCore = await readFile(resolve(packagesRoot, 'permissions-core/src/index.ts'), 'utf8')
for (const marker of [
  'resolvePrincipal()', 'authorize(request:', "'provider-unavailable'", "'unauthenticated'", "'provider-error'",
]) {
  if (!permissionsCore.includes(marker)) failures.push(`@paimind/permissions-core: fail-closed provider boundary is missing ${marker}`)
}
for (const forbidden of [
  'PaimindRole', 'ROLE_CAPABILITIES', 'defaultRole', 'window.localStorage', 'localStorage.',
  'window.sessionStorage', 'sessionStorage.',
]) {
  if (permissionsCore.includes(forbidden)) failures.push(`@paimind/permissions-core: synthetic or caller-asserted authority is forbidden: ${forbidden}`)
}
for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageRoot = resolve(packagesRoot, entry.name)
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  if (manifest.dsh?.client === undefined) continue
  const clientSource = await readFile(resolve(packageRoot, manifest.paimindBuild?.client), 'utf8')
  if (clientSource.includes("category: 'governance'")) {
    failures.push(`${manifest.name}: Governance product must not appear before an authenticated authorization provider exists`)
  }
}

const bentoManifest = JSON.parse(await readFile(resolve(packagesRoot, 'renderer-bento/package.json'), 'utf8'))
const bentoDependencies = { ...bentoManifest.dependencies, ...bentoManifest.peerDependencies, ...bentoManifest.devDependencies }
if (Object.keys(bentoDependencies).some(name => name === 'dsh-better-sidebar' || name.startsWith('dsh-better-sidebar/'))) {
  failures.push('@paimind/renderer-bento: core must use only the PAIMind Preview/Side Card adapter')
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
  console.log(`framework verification passed: ${pluginPackages.length} client plugin(s), exact seven-category Extension Center taxonomy, Registry remains technical-only, Task Monitor is an independent Native Job button, Bento is adapter-only, authorization fails closed without a trusted provider and exposes no synthetic Governance product, every user-visible client contributes one descriptor, only compatibility-neutral home-path imports exist outside harness-compat, zero Better Sidebar imports outside better-sidebar-adapter`)
}
