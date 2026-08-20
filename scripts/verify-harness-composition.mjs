import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const harnessOption = option('--harness')
const runtimeOption = option('--runtime')
const dshBinOption = option('--dsh-bin')
const providerOption = option('--provider')
const officeProviderOption = option('--office-provider')
const upstreamOption = option('--upstream-checkout') ?? harnessOption
const expectedDshVersion = option('--expected-dsh-version')
const expectedProviderVersion = option('--expected-provider-version') ?? '0.12.2'
const expectedOfficeProviderVersion = option('--expected-office-provider-version') ?? '0.1.0'

if ((harnessOption === undefined && (runtimeOption === undefined || dshBinOption === undefined)) || providerOption === undefined) {
  console.error('usage: node scripts/verify-harness-composition.mjs (--harness <checkout> | --runtime <root> --dsh-bin <bin.js>) --provider <dsh-better-sidebar-root> [--office-provider <office-viewer-root>] [--expected-dsh-version <version>] [--expected-provider-version <version>] [--expected-office-provider-version <version>] [--upstream-checkout <checkout>]')
  process.exit(2)
}

const runtimeRoot = resolve(runtimeOption ?? harnessOption)
const upstreamRoot = upstreamOption === undefined ? undefined : resolve(upstreamOption)
const repositoryRoot = resolve('.')
const bundleRoot = resolve(repositoryRoot, 'packages/harness-bundle')
const extensionCenterRoot = resolve(repositoryRoot, 'packages/extension-center')
const runtimeOrbsRoot = resolve(repositoryRoot, 'packages/runtime-orbs')
const brandingRoot = resolve(repositoryRoot, 'packages/branding')
const visualExperienceRoot = resolve(repositoryRoot, 'packages/visual-experience')
const workspaceProjectRoot = resolve(repositoryRoot, 'packages/workspace-project')
const sidebarAdapterRoot = resolve(repositoryRoot, 'packages/better-sidebar-adapter')
const taskMonitorRoot = resolve(repositoryRoot, 'packages/task-monitor')
const artifactRuntimeRoot = resolve(repositoryRoot, 'packages/artifact-runtime')
const generatorWebRoot = resolve(repositoryRoot, 'packages/generator-web')
const generatorOfficeRoot = resolve(repositoryRoot, 'packages/generator-office')
const generatorBentoRoot = resolve(repositoryRoot, 'packages/generator-bento')
const rendererBentoRoot = resolve(repositoryRoot, 'packages/renderer-bento')
const rendererPdfRoot = resolve(repositoryRoot, 'packages/renderer-pdf')
const artifactsRoot = resolve(repositoryRoot, 'packages/artifacts')
const presentationTraceRoot = resolve(repositoryRoot, 'packages/presentation-trace')
const walmartProposalAdapterRoot = resolve(repositoryRoot, 'packages/walmart-proposal-adapter')
const agentMarketRoot = resolve(repositoryRoot, 'packages/agent-market')
const agentBuilderRoot = resolve(repositoryRoot, 'packages/agent-builder')
const skillMarketRoot = resolve(repositoryRoot, 'packages/skill-market')
const notificationsRoot = resolve(repositoryRoot, 'packages/notifications')
const platformApiRoot = resolve(repositoryRoot, 'packages/platform-api')
const schedulerRoot = resolve(repositoryRoot, 'packages/scheduler')
const schedulerHarnessAdapterRoot = resolve(repositoryRoot, 'packages/scheduler-adapter-harness')
const schedulerHttpAdapterRoot = resolve(repositoryRoot, 'packages/scheduler-adapter-http')
const schedulerFeishuAdapterRoot = resolve(repositoryRoot, 'packages/scheduler-adapter-feishu-bot')
const userSettingsRoot = resolve(repositoryRoot, 'packages/user-settings')
const developerResourcesRoot = resolve(repositoryRoot, 'packages/developer-resources')
const providerRoot = resolve(providerOption)
const officeProviderRoot = resolve(officeProviderOption
  ?? resolve(bundleRoot, 'node_modules/@huanlin/dsh-plugin-better-sidebar-plugin-office'))
const dshHome = await mkdtemp(resolve(tmpdir(), 'paimind-dsh-home-'))
const dshBin = dshBinOption === undefined
  ? resolve(runtimeRoot, 'apps/cli/lib/bin.js')
  : resolve(dshBinOption)
const env = { ...process.env, DSH_HOME: dshHome }
const withoutCenterBundleRoot = resolve(dshHome, 'without-extension-center-bundle')
const withoutTaskMonitorBundleRoot = resolve(dshHome, 'without-task-monitor-bundle')
const withoutAgentMarketBundleRoot = resolve(dshHome, 'without-agent-market-bundle')
const withoutAgentBuilderBundleRoot = resolve(dshHome, 'without-agent-builder-bundle')
const withoutSkillMarketBundleRoot = resolve(dshHome, 'without-skill-market-bundle')
const withoutNotificationsBundleRoot = resolve(dshHome, 'without-notifications-bundle')
const withoutSchedulerBundleRoot = resolve(dshHome, 'without-scheduler-bundle')
const withoutUserSettingsBundleRoot = resolve(dshHome, 'without-user-settings-bundle')
const withoutDeveloperResourcesBundleRoot = resolve(dshHome, 'without-developer-resources-bundle')
const stagedFullBundleRoot = resolve(dshHome, 'full-paimind-bundle')
const visualExperienceBundleRoot = resolve(dshHome, 'visual-experience-bundle')

function run(command, args, label) {
  console.log(`start: ${label}`)
  const result = spawnSync(command, args, {
    cwd: runtimeRoot,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  console.log(`passed: ${label}`)
  return `${result.stdout}\n${result.stderr}`
}

function dsh(args, label) {
  return run(process.execPath, [dshBin, ...args], label)
}

function gitStatus() {
  if (upstreamRoot === undefined) return null
  const result = spawnSync('git', ['status', '--porcelain=v1'], {
    cwd: upstreamRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) throw new Error(`read Harness git status failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to reserve a TCP port')
  await new Promise((resolveClosed, reject) => server.close(error => error === undefined ? resolveClosed() : reject(error)))
  return address.port
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 5_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function bootAndProbe(expectedPackages, absentPackages = []) {
  console.log('start: boot isolated Web profile and probe PAIMind client manifests')
  const port = await freePort()
  const child = spawn(process.execPath, [
    dshBin, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port),
  ], { cwd: runtimeRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  try {
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Harness boot timed out\n${output}`)), 30_000)
      const inspect = () => {
        if (!output.includes('dsh web:')) return
        clearTimeout(timeout)
        resolveReady()
      }
      child.stdout.on('data', inspect)
      child.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Harness exited before readiness (${String(code)})\n${output}`))
      })
    })
    const response = await fetch(`http://127.0.0.1:${port}/`)
    const html = await response.text()
    if (!response.ok) throw new Error(`Harness readiness probe returned HTTP ${response.status}`)
    for (const packageName of expectedPackages) {
      if (!html.includes(packageName)) throw new Error(`Harness boot manifest is missing ${packageName}`)
    }
    for (const packageName of absentPackages) {
      if (html.includes(packageName)) throw new Error(`Harness boot manifest unexpectedly contains ${packageName}`)
    }
    console.log('passed: boot isolated Web profile and probe PAIMind client manifests')
  } finally {
    await stopProcess(child)
  }
}

const providerManifest = JSON.parse(await readFile(resolve(providerRoot, 'package.json'), 'utf8'))
if (providerManifest.name !== 'dsh-better-sidebar' || providerManifest.version !== expectedProviderVersion) {
  throw new Error(`provider pin mismatch: expected dsh-better-sidebar@${expectedProviderVersion}, received ${providerManifest.name}@${providerManifest.version}`)
}
if (providerManifest.exports?.['./client/service'] === undefined) {
  throw new Error('provider contract mismatch: ./client/service export is absent')
}
const providerServiceTypes = await readFile(resolve(providerRoot, 'lib/types/client/service.d.ts'), 'utf8')
for (const marker of ['interface BetterSidebarService', 'registerTab(', 'openTab(', 'closeTab(', 'matchFileViewer(']) {
  if (!providerServiceTypes.includes(marker)) throw new Error(`provider type contract is missing ${marker}`)
}

const officeProviderManifest = JSON.parse(await readFile(resolve(officeProviderRoot, 'package.json'), 'utf8'))
if (officeProviderManifest.name !== '@huanlin/dsh-plugin-better-sidebar-plugin-office'
  || officeProviderManifest.version !== expectedOfficeProviderVersion) {
  throw new Error(`Office provider pin mismatch: expected @huanlin/dsh-plugin-better-sidebar-plugin-office@${expectedOfficeProviderVersion}, received ${officeProviderManifest.name}@${officeProviderManifest.version}`)
}

const runtimeVersion = dsh(['--version'], 'read Harness runtime version').trim()
if (expectedDshVersion !== undefined && runtimeVersion !== expectedDshVersion) {
  throw new Error(`Harness runtime version mismatch: expected ${expectedDshVersion}, received ${runtimeVersion}`)
}

const beforeStatus = gitStatus()
try {
  dsh(['--profile', 'web', '--dump-config'], 'initialize isolated web profile')
  await mkdir(withoutCenterBundleRoot, { recursive: true })
  await writeFile(resolve(withoutCenterBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-extension-center',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(resolve(withoutCenterBundleRoot, 'cordis.patch.yml'), `- insert:
    - id: paimind-runtime-orbs
      name: '@paimind/runtime-orbs'
    - id: paimind-branding
      name: '@paimind/branding'
    - id: paimind-workspace-project
      name: '@paimind/workspace-project'
    - id: paimind-better-sidebar-adapter
      name: '@paimind/better-sidebar-adapter'
    - id: paimind-task-monitor
      name: '@paimind/task-monitor'
    - id: paimind-artifact-runtime
      name: '@paimind/artifact-runtime'
    - id: paimind-generator-web
      name: '@paimind/generator-web'
    - id: paimind-generator-office
      name: '@paimind/generator-office'
    - id: paimind-generator-bento
      name: '@paimind/generator-bento'
    - id: paimind-renderer-bento
      name: '@paimind/renderer-bento'
    - id: paimind-renderer-pdf
      name: '@paimind/renderer-pdf'
    - id: paimind-artifacts
      name: '@paimind/artifacts'
    - id: paimind-presentation-trace
      name: '@paimind/presentation-trace'
    - id: paimind-agent-market
      name: '@paimind/agent-market'
    - id: paimind-agent-builder
      name: '@paimind/agent-builder'
    - id: paimind-skill-market
      name: '@paimind/skill-market'
    - id: paimind-notifications
      name: '@paimind/notifications'
    - id: paimind-developer-resources
      name: '@paimind/developer-resources'
`)
  await mkdir(withoutTaskMonitorBundleRoot, { recursive: true })
  await writeFile(resolve(withoutTaskMonitorBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-task-monitor',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(resolve(withoutTaskMonitorBundleRoot, 'cordis.patch.yml'), `- insert:
    - id: paimind-extension-center
      name: '@paimind/extension-center'
    - id: paimind-runtime-orbs
      name: '@paimind/runtime-orbs'
    - id: paimind-branding
      name: '@paimind/branding'
    - id: paimind-workspace-project
      name: '@paimind/workspace-project'
    - id: paimind-better-sidebar-adapter
      name: '@paimind/better-sidebar-adapter'
    - id: paimind-artifact-runtime
      name: '@paimind/artifact-runtime'
    - id: paimind-generator-web
      name: '@paimind/generator-web'
    - id: paimind-generator-office
      name: '@paimind/generator-office'
    - id: paimind-generator-bento
      name: '@paimind/generator-bento'
    - id: paimind-renderer-bento
      name: '@paimind/renderer-bento'
    - id: paimind-renderer-pdf
      name: '@paimind/renderer-pdf'
    - id: paimind-artifacts
      name: '@paimind/artifacts'
    - id: paimind-presentation-trace
      name: '@paimind/presentation-trace'
    - id: paimind-agent-market
      name: '@paimind/agent-market'
    - id: paimind-agent-builder
      name: '@paimind/agent-builder'
    - id: paimind-skill-market
      name: '@paimind/skill-market'
    - id: paimind-notifications
      name: '@paimind/notifications'
`)
  await mkdir(withoutAgentMarketBundleRoot, { recursive: true })
  await writeFile(resolve(withoutAgentMarketBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-agent-market',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(resolve(withoutAgentMarketBundleRoot, 'cordis.patch.yml'), `- insert:
    - id: paimind-extension-center
      name: '@paimind/extension-center'
    - id: paimind-runtime-orbs
      name: '@paimind/runtime-orbs'
    - id: paimind-branding
      name: '@paimind/branding'
    - id: paimind-workspace-project
      name: '@paimind/workspace-project'
    - id: paimind-better-sidebar-adapter
      name: '@paimind/better-sidebar-adapter'
    - id: paimind-task-monitor
      name: '@paimind/task-monitor'
    - id: paimind-artifact-runtime
      name: '@paimind/artifact-runtime'
    - id: paimind-generator-web
      name: '@paimind/generator-web'
    - id: paimind-generator-office
      name: '@paimind/generator-office'
    - id: paimind-generator-bento
      name: '@paimind/generator-bento'
    - id: paimind-renderer-bento
      name: '@paimind/renderer-bento'
    - id: paimind-renderer-pdf
      name: '@paimind/renderer-pdf'
    - id: paimind-artifacts
      name: '@paimind/artifacts'
    - id: paimind-presentation-trace
      name: '@paimind/presentation-trace'
    - id: paimind-agent-builder
      name: '@paimind/agent-builder'
    - id: paimind-skill-market
      name: '@paimind/skill-market'
    - id: paimind-notifications
      name: '@paimind/notifications'
`)
  await mkdir(withoutAgentBuilderBundleRoot, { recursive: true })
  await writeFile(resolve(withoutAgentBuilderBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-agent-builder',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(resolve(withoutAgentBuilderBundleRoot, 'cordis.patch.yml'), `- insert:
    - id: paimind-extension-center
      name: '@paimind/extension-center'
    - id: paimind-runtime-orbs
      name: '@paimind/runtime-orbs'
    - id: paimind-branding
      name: '@paimind/branding'
    - id: paimind-workspace-project
      name: '@paimind/workspace-project'
    - id: paimind-better-sidebar-adapter
      name: '@paimind/better-sidebar-adapter'
    - id: paimind-task-monitor
      name: '@paimind/task-monitor'
    - id: paimind-artifact-runtime
      name: '@paimind/artifact-runtime'
    - id: paimind-generator-web
      name: '@paimind/generator-web'
    - id: paimind-generator-office
      name: '@paimind/generator-office'
    - id: paimind-generator-bento
      name: '@paimind/generator-bento'
    - id: paimind-renderer-bento
      name: '@paimind/renderer-bento'
    - id: paimind-renderer-pdf
      name: '@paimind/renderer-pdf'
    - id: paimind-artifacts
      name: '@paimind/artifacts'
    - id: paimind-presentation-trace
      name: '@paimind/presentation-trace'
    - id: paimind-agent-market
      name: '@paimind/agent-market'
    - id: paimind-skill-market
      name: '@paimind/skill-market'
    - id: paimind-notifications
      name: '@paimind/notifications'
`)
  await mkdir(withoutSkillMarketBundleRoot, { recursive: true })
  await writeFile(resolve(withoutSkillMarketBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-skill-market',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(resolve(withoutSkillMarketBundleRoot, 'cordis.patch.yml'), `- insert:
    - id: paimind-extension-center
      name: '@paimind/extension-center'
    - id: paimind-runtime-orbs
      name: '@paimind/runtime-orbs'
    - id: paimind-branding
      name: '@paimind/branding'
    - id: paimind-workspace-project
      name: '@paimind/workspace-project'
    - id: paimind-better-sidebar-adapter
      name: '@paimind/better-sidebar-adapter'
    - id: paimind-task-monitor
      name: '@paimind/task-monitor'
    - id: paimind-artifact-runtime
      name: '@paimind/artifact-runtime'
    - id: paimind-generator-web
      name: '@paimind/generator-web'
    - id: paimind-generator-office
      name: '@paimind/generator-office'
    - id: paimind-generator-bento
      name: '@paimind/generator-bento'
    - id: paimind-renderer-bento
      name: '@paimind/renderer-bento'
    - id: paimind-renderer-pdf
      name: '@paimind/renderer-pdf'
    - id: paimind-artifacts
      name: '@paimind/artifacts'
    - id: paimind-presentation-trace
      name: '@paimind/presentation-trace'
    - id: paimind-agent-market
      name: '@paimind/agent-market'
    - id: paimind-agent-builder
      name: '@paimind/agent-builder'
    - id: paimind-notifications
      name: '@paimind/notifications'
`)
  await mkdir(withoutNotificationsBundleRoot, { recursive: true })
  await writeFile(resolve(withoutNotificationsBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-notifications',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(resolve(withoutNotificationsBundleRoot, 'cordis.patch.yml'), `- insert:
    - id: paimind-extension-center
      name: '@paimind/extension-center'
    - id: paimind-runtime-orbs
      name: '@paimind/runtime-orbs'
    - id: paimind-branding
      name: '@paimind/branding'
    - id: paimind-workspace-project
      name: '@paimind/workspace-project'
    - id: paimind-better-sidebar-adapter
      name: '@paimind/better-sidebar-adapter'
    - id: paimind-task-monitor
      name: '@paimind/task-monitor'
    - id: paimind-artifact-runtime
      name: '@paimind/artifact-runtime'
    - id: paimind-generator-web
      name: '@paimind/generator-web'
    - id: paimind-generator-office
      name: '@paimind/generator-office'
    - id: paimind-generator-bento
      name: '@paimind/generator-bento'
    - id: paimind-renderer-bento
      name: '@paimind/renderer-bento'
    - id: paimind-renderer-pdf
      name: '@paimind/renderer-pdf'
    - id: paimind-artifacts
      name: '@paimind/artifacts'
    - id: paimind-presentation-trace
      name: '@paimind/presentation-trace'
    - id: paimind-agent-market
      name: '@paimind/agent-market'
    - id: paimind-agent-builder
      name: '@paimind/agent-builder'
    - id: paimind-skill-market
      name: '@paimind/skill-market'
`)
  await mkdir(withoutSchedulerBundleRoot, { recursive: true })
  await writeFile(resolve(withoutSchedulerBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-scheduler',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {},
  }, null, 2))
  const sourceBundlePatch = await readFile(resolve(bundleRoot, 'cordis.patch.yml'), 'utf8')
  const fullPatch = sourceBundlePatch
  await mkdir(stagedFullBundleRoot, { recursive: true })
  await writeFile(resolve(stagedFullBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/harness-bundle',
    version: '0.1.0-alpha.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {},
  }, null, 2))
  await writeFile(resolve(stagedFullBundleRoot, 'cordis.patch.yml'), fullPatch)
  await mkdir(visualExperienceBundleRoot, { recursive: true })
  await writeFile(resolve(visualExperienceBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-visual-experience-bundle',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {},
  }, null, 2))
  await writeFile(resolve(visualExperienceBundleRoot, 'cordis.patch.yml'), `- insert:
    - id: paimind-branding
      name: '@paimind/branding'
    - id: paimind-visual-experience
      name: '@paimind/visual-experience'
`)
  const isolationPatch = fullPatch.replace(
    /\n    - id: paimind-visual-experience\n      name: '@paimind\/visual-experience'\n?/,
    '\n',
  )
  if (isolationPatch === fullPatch) throw new Error('failed to derive legacy feature-isolation patch without Visual Experience')
  const withoutSchedulerPatch = isolationPatch.replace(
    /\n    - id: paimind-platform-scheduler\n      name: '@paimind\/platform-scheduler'[\s\S]*?    - id: paimind-scheduler-adapter-feishu-bot-invariant\n      name: '@paimind\/scheduler-adapter-feishu-bot\/invariant'\n      inject: \[invariants\]\n?/,
    '\n',
  )
  if (withoutSchedulerPatch === isolationPatch) throw new Error('failed to derive Scheduler isolation patch')
  await writeFile(resolve(withoutSchedulerBundleRoot, 'cordis.patch.yml'), withoutSchedulerPatch)
  await mkdir(withoutUserSettingsBundleRoot, { recursive: true })
  await writeFile(resolve(withoutUserSettingsBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-user-settings',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {},
  }, null, 2))
  const withoutUserSettingsPatch = isolationPatch.replace(
    /\n    - id: paimind-user-settings\n      name: '@paimind\/user-settings'\n?/,
    '\n',
  )
  if (withoutUserSettingsPatch === isolationPatch) throw new Error('failed to derive User Settings isolation patch')
  await writeFile(resolve(withoutUserSettingsBundleRoot, 'cordis.patch.yml'), withoutUserSettingsPatch)
  await mkdir(withoutDeveloperResourcesBundleRoot, { recursive: true })
  await writeFile(resolve(withoutDeveloperResourcesBundleRoot, 'package.json'), JSON.stringify({
    name: '@paimind/test-without-developer-resources',
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {},
  }, null, 2))
  const withoutDeveloperResourcesPatch = isolationPatch.replace(
    /\n    - id: paimind-developer-resources\n      name: '@paimind\/developer-resources'\n?/,
    '\n',
  )
  if (withoutDeveloperResourcesPatch === isolationPatch) throw new Error('failed to derive Developer Resources isolation patch')
  await writeFile(resolve(withoutDeveloperResourcesBundleRoot, 'cordis.patch.yml'), withoutDeveloperResourcesPatch)
  dsh([
    'plugin', '--profile', 'web', 'add', providerRoot,
  ], 'install Better Sidebar provider before dependent extensions')
  dsh([
    'plugin', '--profile', 'web', 'add',
    officeProviderRoot,
    stagedFullBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    visualExperienceRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    walmartProposalAdapterRoot,
    agentMarketRoot,
    agentBuilderRoot,
    skillMarketRoot,
    notificationsRoot,
    platformApiRoot,
    schedulerRoot,
    schedulerHarnessAdapterRoot,
    schedulerHttpAdapterRoot,
    schedulerFeishuAdapterRoot,
    userSettingsRoot,
    developerResourcesRoot,
  ], 'install PAIMind bundle and feature plugins')
  const installed = dsh(['--profile', 'web', '--dump-config'], 'dump installed composition')
  for (const marker of [
    'better-sidebar', 'dsh-better-sidebar',
    'dsh-better-sidebar-plugin-office', '@huanlin/dsh-plugin-better-sidebar-plugin-office',
    'paimind-extension-center', '@paimind/extension-center',
    'paimind-runtime-orbs', '@paimind/runtime-orbs',
    'paimind-branding', '@paimind/branding',
    'paimind-visual-experience', '@paimind/visual-experience',
    'paimind-workspace-project', '@paimind/workspace-project',
    'paimind-better-sidebar-adapter', '@paimind/better-sidebar-adapter',
    'paimind-task-monitor', '@paimind/task-monitor',
    'paimind-artifact-runtime', '@paimind/artifact-runtime',
    'paimind-generator-web', '@paimind/generator-web',
    'paimind-generator-office', '@paimind/generator-office',
    'paimind-generator-bento', '@paimind/generator-bento',
    'paimind-renderer-bento', '@paimind/renderer-bento',
    'paimind-renderer-pdf', '@paimind/renderer-pdf',
    'paimind-artifacts', '@paimind/artifacts',
    'paimind-presentation-trace', '@paimind/presentation-trace',
    'paimind-walmart-proposal-adapter', '@paimind/walmart-proposal-adapter',
    'paimind-agent-market', '@paimind/agent-market',
    'paimind-agent-builder', '@paimind/agent-builder',
    'paimind-skill-market', '@paimind/skill-market',
    'paimind-notifications', '@paimind/notifications',
    'paimind-platform-scheduler', '@paimind/platform-scheduler',
    'paimind-scheduler-adapter-harness', '@paimind/scheduler-adapter-harness',
    'paimind-scheduler-adapter-http', '@paimind/scheduler-adapter-http',
    'paimind-scheduler-adapter-feishu-bot', '@paimind/scheduler-adapter-feishu-bot',
    'paimind-user-settings', '@paimind/user-settings',
    'paimind-developer-resources', '@paimind/developer-resources',
  ]) {
    if (!installed.includes(marker)) {
      const schedulerRows = installed.split('\n').filter(line => /schedule/i.test(line)).join('\n')
      throw new Error(`installed composition is missing ${marker}\nSchedule rows:\n${schedulerRows}`)
    }
  }
  for (const retiredNativeMarker of ['@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-schedule']) {
    if (installed.includes(retiredNativeMarker)) {
      throw new Error(`retired native Scheduler package remained in the active PAIMind composition: ${retiredNativeMarker}`)
    }
  }
  if ((installed.match(/name: dsh-better-sidebar/g) ?? []).length !== 1) {
    throw new Error('installed composition must contain exactly one Better Sidebar row')
  }
  if ((installed.match(/name: '@huanlin\/dsh-plugin-better-sidebar-plugin-office'/g) ?? []).length !== 1) {
    throw new Error('installed composition must contain exactly one Office viewer row')
  }
  const providerBundleIndex = installed.indexOf('# == dsh-better-sidebar')
  const officeBundleIndex = installed.indexOf('# == @huanlin/dsh-plugin-better-sidebar-plugin-office')
  if (providerBundleIndex < 0 || officeBundleIndex <= providerBundleIndex) {
    throw new Error('Office viewer bundle must activate after Better Sidebar provider')
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@huanlin/dsh-plugin-better-sidebar-plugin-office',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/visual-experience',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/platform-scheduler',
    '@paimind/user-settings',
    '@paimind/developer-resources',
  ], [
    '@paimind/agent-builder',
    '@paimind/platform-api',
    '@paimind/scheduler-adapter-harness',
    '@paimind/scheduler-adapter-http',
    '@paimind/scheduler-adapter-feishu-bot',
  ])

  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/harness-bundle',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/visual-experience',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/walmart-proposal-adapter',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/platform-api',
    '@paimind/platform-scheduler',
    '@paimind/scheduler-adapter-harness',
    '@paimind/scheduler-adapter-http',
    '@paimind/scheduler-adapter-feishu-bot',
    '@paimind/user-settings',
    '@paimind/developer-resources',
    '@huanlin/dsh-plugin-better-sidebar-plugin-office',
    'dsh-better-sidebar',
  ], 'remove PAIMind packages')
  const removed = dsh(['--profile', 'web', '--dump-config'], 'dump restored composition')
  if (removed.includes('paimind-extension-center')
    || removed.includes('paimind-runtime-orbs')
    || removed.includes('paimind-branding')
    || removed.includes('paimind-visual-experience')
    || removed.includes('paimind-workspace-project')
    || removed.includes('paimind-better-sidebar-adapter')
    || removed.includes('paimind-task-monitor')
    || removed.includes('paimind-artifact-runtime')
    || removed.includes('paimind-generator-web')
    || removed.includes('paimind-generator-office')
    || removed.includes('paimind-generator-bento')
    || removed.includes('paimind-renderer-bento')
    || removed.includes('paimind-renderer-pdf')
    || removed.includes('paimind-artifacts')
    || removed.includes('paimind-presentation-trace')
    || removed.includes('paimind-walmart-proposal-adapter')
    || removed.includes('paimind-agent-market')
    || removed.includes('paimind-agent-builder')
    || removed.includes('paimind-skill-market')
    || removed.includes('paimind-notifications')
    || removed.includes('paimind-platform-api')
    || removed.includes('paimind-platform-scheduler')
    || removed.includes('paimind-scheduler')
    || removed.includes('paimind-user-settings')
    || removed.includes('paimind-developer-resources')
    || removed.includes("name: '@deepseek-ai/dsh-schedule'")
    || removed.includes("name: '@deepseek-ai/dsh-time-context'")
    || removed.includes('dsh-better-sidebar')) {
    throw new Error(`PAIMind feature row remained after bundle removal\n${removed}`)
  }

  dsh([
    'plugin', '--profile', 'web', 'add', visualExperienceBundleRoot, brandingRoot, visualExperienceRoot,
  ], 'install Visual Experience as an independent plugin')
  await bootAndProbe([
    '@paimind/branding', '@paimind/visual-experience',
  ])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-visual-experience-bundle', '@paimind/visual-experience',
  ], 'remove Visual Experience independently')
  await bootAndProbe([], ['@paimind/visual-experience'])
  dsh([
    'plugin', '--profile', 'web', 'remove', '@paimind/branding',
  ], 'remove Visual Experience companion branding')
  const visualExperienceRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm Visual Experience cleanup')
  if (visualExperienceRemoved.includes('paimind-visual-experience')
    || visualExperienceRemoved.includes('@paimind/visual-experience')
    || visualExperienceRemoved.includes('paimind-branding')) {
    throw new Error('Visual Experience or its companion branding remained after independent removal')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutCenterBundleRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    agentBuilderRoot,
    skillMarketRoot,
    notificationsRoot,
    walmartProposalAdapterRoot,
    developerResourcesRoot,
  ], 'install independent features without Extension Center or bundle')
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/developer-resources',
  ], ['@paimind/extension-center', '@paimind/agent-builder'])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/walmart-proposal-adapter',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/developer-resources',
    'dsh-better-sidebar',
  ], 'remove independent features after Extension Center absence probe')
  const independentRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm independent feature cleanup')
  if (independentRemoved.includes('paimind-') || independentRemoved.includes('dsh-better-sidebar')) {
    throw new Error('independent feature remained after Extension Center absence probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutTaskMonitorBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    agentBuilderRoot,
    skillMarketRoot,
    notificationsRoot,
  ], 'install product composition without Task Monitor')
  const withoutTaskMonitor = dsh(['--profile', 'web', '--dump-config'], 'dump composition without Task Monitor')
  if (withoutTaskMonitor.includes('paimind-task-monitor') || withoutTaskMonitor.includes('@paimind/task-monitor')) {
    throw new Error('Task Monitor remained in its isolated-removal composition')
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
  ], ['@paimind/task-monitor', '@paimind/agent-builder'])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-task-monitor',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    '@paimind/notifications',
    'dsh-better-sidebar',
  ], 'remove composition after Task Monitor isolation probe')
  const taskIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm Task Monitor isolation cleanup')
  if (taskIsolationRemoved.includes('paimind-') || taskIsolationRemoved.includes('dsh-better-sidebar')) {
    throw new Error('feature remained after Task Monitor isolation probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutAgentMarketBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentBuilderRoot,
    skillMarketRoot,
    notificationsRoot,
  ], 'install product composition without Agent Market')
  const withoutAgentMarket = dsh(['--profile', 'web', '--dump-config'], 'dump composition without Agent Market')
  if (withoutAgentMarket.includes('paimind-agent-market') || withoutAgentMarket.includes('@paimind/agent-market')) {
    throw new Error('Agent Market remained in its isolated-removal composition')
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/skill-market',
    '@paimind/notifications',
  ], ['@paimind/agent-market', '@paimind/agent-builder'])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-agent-market',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    '@paimind/notifications',
    'dsh-better-sidebar',
  ], 'remove composition after Agent Market isolation probe')
  const agentIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm Agent Market isolation cleanup')
  if (agentIsolationRemoved.includes('paimind-') || agentIsolationRemoved.includes('dsh-better-sidebar')) {
    throw new Error('feature remained after Agent Market isolation probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutAgentBuilderBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    skillMarketRoot,
    notificationsRoot,
  ], 'install product composition without Agent Builder')
  const withoutAgentBuilder = dsh(['--profile', 'web', '--dump-config'], 'dump composition without Agent Builder')
  if (withoutAgentBuilder.includes('paimind-agent-builder') || withoutAgentBuilder.includes('@paimind/agent-builder')) {
    throw new Error('Agent Builder remained in its isolated-removal composition')
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
  ], ['@paimind/agent-builder'])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-agent-builder',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
    'dsh-better-sidebar',
  ], 'remove composition after Agent Builder isolation probe')
  const builderIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm Agent Builder isolation cleanup')
  if (builderIsolationRemoved.includes('paimind-') || builderIsolationRemoved.includes('dsh-better-sidebar')) {
    throw new Error('feature remained after Agent Builder isolation probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutSkillMarketBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    agentBuilderRoot,
    notificationsRoot,
  ], 'install product composition without Skill Market')
  const withoutSkillMarket = dsh(['--profile', 'web', '--dump-config'], 'dump composition without Skill Market')
  if (withoutSkillMarket.includes('paimind-skill-market') || withoutSkillMarket.includes('@paimind/skill-market')) {
    throw new Error('Skill Market remained in its isolated-removal composition')
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/notifications',
  ], ['@paimind/skill-market', '@paimind/agent-builder'])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-skill-market',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/notifications',
    'dsh-better-sidebar',
  ], 'remove composition after Skill Market isolation probe')
  const skillIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm Skill Market isolation cleanup')
  if (skillIsolationRemoved.includes('paimind-') || skillIsolationRemoved.includes('dsh-better-sidebar')) {
    throw new Error('feature remained after Skill Market isolation probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutNotificationsBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    agentBuilderRoot,
    skillMarketRoot,
  ], 'install product composition without Notification Center')
  const withoutNotifications = dsh(['--profile', 'web', '--dump-config'], 'dump composition without Notification Center')
  if (withoutNotifications.includes('paimind-notifications') || withoutNotifications.includes('@paimind/notifications')) {
    throw new Error('Notification Center remained in its isolated-removal composition')
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
  ], ['@paimind/notifications', '@paimind/agent-builder'])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-notifications',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    'dsh-better-sidebar',
  ], 'remove composition after Notification Center isolation probe')
  const notificationIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm Notification Center isolation cleanup')
  if (notificationIsolationRemoved.includes('paimind-') || notificationIsolationRemoved.includes('dsh-better-sidebar')) {
    throw new Error('feature remained after Notification Center isolation probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutSchedulerBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    agentBuilderRoot,
    skillMarketRoot,
    notificationsRoot,
    walmartProposalAdapterRoot,
    developerResourcesRoot,
  ], 'install product composition without PAIMind Scheduler')
  const withoutScheduler = dsh(['--profile', 'web', '--dump-config'], 'dump composition without PAIMind Scheduler')
  if (withoutScheduler.includes('paimind-platform-scheduler')
    || withoutScheduler.includes('@paimind/platform-scheduler')
    || withoutScheduler.includes('@paimind/scheduler-adapter-')) {
    throw new Error('PAIMind Scheduler remained in its isolated-removal composition')
  }
  for (const retiredNativeMarker of ['@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-schedule']) {
    if (withoutScheduler.includes(retiredNativeMarker)) throw new Error(`retired native Scheduler package unexpectedly loaded: ${retiredNativeMarker}`)
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/developer-resources',
  ], ['@paimind/agent-builder', '@paimind/platform-scheduler', '@paimind/scheduler-adapter-harness', '@paimind/scheduler-adapter-http', '@paimind/scheduler-adapter-feishu-bot', '@paimind/platform-api'])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-scheduler',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/walmart-proposal-adapter',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/developer-resources',
    'dsh-better-sidebar',
  ], 'remove composition after PAIMind Scheduler isolation probe')
  const schedulerIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm PAIMind Scheduler isolation cleanup')
  if (schedulerIsolationRemoved.includes('paimind-')
    || schedulerIsolationRemoved.includes('dsh-better-sidebar')
    || schedulerIsolationRemoved.includes("name: '@deepseek-ai/dsh-schedule'")
    || schedulerIsolationRemoved.includes("name: '@deepseek-ai/dsh-time-context'")) {
    throw new Error('feature remained after PAIMind Scheduler isolation probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutUserSettingsBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    agentBuilderRoot,
    skillMarketRoot,
    notificationsRoot,
    walmartProposalAdapterRoot,
    platformApiRoot,
    schedulerRoot,
    schedulerHarnessAdapterRoot,
    schedulerHttpAdapterRoot,
    schedulerFeishuAdapterRoot,
    developerResourcesRoot,
  ], 'install product composition without PAIMind User Settings')
  const withoutUserSettings = dsh(['--profile', 'web', '--dump-config'], 'dump composition without PAIMind User Settings')
  if (withoutUserSettings.includes('paimind-user-settings') || withoutUserSettings.includes('@paimind/user-settings')) {
    throw new Error('PAIMind User Settings remained in its isolated-removal composition')
  }
  for (const retainedMarker of [
    '@paimind/extension-center', '@paimind/runtime-orbs', '@paimind/notifications',
    '@paimind/platform-scheduler', '@paimind/walmart-proposal-adapter',
    "name: '@deepseek-ai/dsh-settings-file'",
  ]) {
    if (!withoutUserSettings.includes(retainedMarker)) throw new Error(`User Settings isolation lost ${retainedMarker}`)
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/platform-scheduler',
    '@paimind/developer-resources',
  ], [
    '@paimind/user-settings',
    '@paimind/agent-builder',
    '@paimind/platform-api',
    '@paimind/scheduler-adapter-harness',
    '@paimind/scheduler-adapter-http',
    '@paimind/scheduler-adapter-feishu-bot',
  ])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-user-settings',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/walmart-proposal-adapter',
    '@paimind/platform-api',
    '@paimind/platform-scheduler',
    '@paimind/scheduler-adapter-harness',
    '@paimind/scheduler-adapter-http',
    '@paimind/scheduler-adapter-feishu-bot',
    '@paimind/developer-resources',
    'dsh-better-sidebar',
  ], 'remove composition after PAIMind User Settings isolation probe')
  const userSettingsIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm PAIMind User Settings isolation cleanup')
  if (userSettingsIsolationRemoved.includes('paimind-')
    || userSettingsIsolationRemoved.includes('dsh-better-sidebar')
    || userSettingsIsolationRemoved.includes("name: '@deepseek-ai/dsh-schedule'")
    || userSettingsIsolationRemoved.includes("name: '@deepseek-ai/dsh-time-context'")) {
    throw new Error('feature remained after PAIMind User Settings isolation probe')
  }

  dsh([
    'plugin', '--profile', 'web', 'add',
    providerRoot,
    withoutDeveloperResourcesBundleRoot,
    extensionCenterRoot,
    runtimeOrbsRoot,
    brandingRoot,
    workspaceProjectRoot,
    sidebarAdapterRoot,
    taskMonitorRoot,
    artifactRuntimeRoot,
    generatorWebRoot,
    generatorOfficeRoot,
    generatorBentoRoot,
    rendererBentoRoot,
    rendererPdfRoot,
    artifactsRoot,
    presentationTraceRoot,
    agentMarketRoot,
    agentBuilderRoot,
    skillMarketRoot,
    notificationsRoot,
    walmartProposalAdapterRoot,
    platformApiRoot,
    schedulerRoot,
    schedulerHarnessAdapterRoot,
    schedulerHttpAdapterRoot,
    schedulerFeishuAdapterRoot,
    userSettingsRoot,
  ], 'install product composition without PAIMind Developer Resources')
  const withoutDeveloperResources = dsh(['--profile', 'web', '--dump-config'], 'dump composition without PAIMind Developer Resources')
  if (withoutDeveloperResources.includes('paimind-developer-resources')
    || withoutDeveloperResources.includes('@paimind/developer-resources')) {
    throw new Error('PAIMind Developer Resources remained in its isolated-removal composition')
  }
  for (const retainedMarker of [
    '@paimind/extension-center', '@paimind/runtime-orbs', '@paimind/task-monitor',
    '@paimind/user-settings', '@paimind/walmart-proposal-adapter',
    '@deepseek-ai/dsh-host-plugin-inventory',
  ]) {
    if (!withoutDeveloperResources.includes(retainedMarker)) {
      throw new Error(`Developer Resources isolation lost ${retainedMarker}`)
    }
  }
  await bootAndProbe([
    'dsh-better-sidebar',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/platform-scheduler',
    '@paimind/user-settings',
  ], [
    '@paimind/developer-resources',
    '@paimind/agent-builder',
    '@paimind/platform-api',
    '@paimind/scheduler-adapter-harness',
    '@paimind/scheduler-adapter-http',
    '@paimind/scheduler-adapter-feishu-bot',
  ])
  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-without-developer-resources',
    '@paimind/extension-center',
    '@paimind/runtime-orbs',
    '@paimind/branding',
    '@paimind/workspace-project',
    '@paimind/better-sidebar-adapter',
    '@paimind/task-monitor',
    '@paimind/artifact-runtime',
    '@paimind/generator-web',
    '@paimind/generator-office',
    '@paimind/generator-bento',
    '@paimind/renderer-bento',
    '@paimind/renderer-pdf',
    '@paimind/artifacts',
    '@paimind/presentation-trace',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
    '@paimind/notifications',
    '@paimind/walmart-proposal-adapter',
    '@paimind/platform-api',
    '@paimind/platform-scheduler',
    '@paimind/scheduler-adapter-harness',
    '@paimind/scheduler-adapter-http',
    '@paimind/scheduler-adapter-feishu-bot',
    '@paimind/user-settings',
    'dsh-better-sidebar',
  ], 'remove composition after PAIMind Developer Resources isolation probe')
  const developerResourcesIsolationRemoved = dsh(['--profile', 'web', '--dump-config'], 'confirm PAIMind Developer Resources isolation cleanup')
  if (developerResourcesIsolationRemoved.includes('paimind-')
    || developerResourcesIsolationRemoved.includes('dsh-better-sidebar')
    || developerResourcesIsolationRemoved.includes("name: '@deepseek-ai/dsh-schedule'")
    || developerResourcesIsolationRemoved.includes("name: '@deepseek-ai/dsh-time-context'")) {
    throw new Error('feature remained after PAIMind Developer Resources isolation probe')
  }
  const afterStatus = gitStatus()
  if (afterStatus !== beforeStatus) {
    throw new Error(`Harness worktree changed\nbefore:\n${beforeStatus}\nafter:\n${afterStatus}`)
  }
  console.log(`real Harness composition passed: Harness ${runtimeVersion}, Better Sidebar ${providerManifest.version}, Office Viewer ${officeProviderManifest.version}, full install/boot/remove/restore, independent Visual Experience install/remove, independent features without Extension Center, independent product compositions without Task Monitor, Agent Market, Agent Builder, Skill Market, Notification Center, PAIMind Scheduler, PAIMind User Settings or PAIMind Developer Resources, no legacy native Session-reminder rows, cleanup, zero upstream worktree delta`)
} finally {
  await rm(dshHome, { recursive: true, force: true })
}
