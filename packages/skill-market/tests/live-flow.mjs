import { readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { PaimindSkillInstallerService } from '../lib/index.js'

const phase = process.argv[2]
const harnessHome = process.env.DSH_HOME
const skillName = 'paimind-skill-center-e2e'

if (!['install-v1', 'update-v2', 'uninstall'].includes(phase ?? '')) {
  throw new Error('Usage: DSH_HOME=/exact/path node packages/skill-market/tests/live-flow.mjs <install-v1|update-v2|uninstall>')
}
if (harnessHome === undefined || !resolve(harnessHome).endsWith(`${join('paimind-harness-plugins', '.dsh-home')}`)) {
  throw new Error('Refusing to mutate a DSH_HOME outside this repository test profile')
}

const context = {
  reflect: { provide: () => {} },
  webServer: { register: () => () => {} },
  effect(install) { install() },
}
const service = new PaimindSkillInstallerService(context, {
  skillRoot: join(harnessHome, 'skills'),
  stateRoot: join(harnessHome, '.paimind-skill-installer'),
})

async function upload(path) {
  const body = await import('node:fs/promises').then(fs => fs.readFile(path))
  const request = Readable.from([body])
  Object.assign(request, {
    headers: { 'x-paimind-upload': '1', 'x-paimind-file-name': encodeURIComponent('SKILL.md') },
    method: 'POST',
    url: '/paimind/skills/uploads',
  })
  let status = 0
  let payload = ''
  const response = {
    writeHead(value) { status = value; return this },
    end(value = '') { payload = value },
  }
  await service.handleUpload(request, response)
  if (status !== 201) throw new Error(`Upload failed (${status}): ${payload}`)
  return JSON.parse(payload)
}

const current = (await service.listInstalled()).items.find(item => item.skillId === skillName)
if (phase === 'uninstall') {
  if (current === undefined) throw new Error(`${skillName} is not installed`)
  const removal = await service.uninstall({ skillId: skillName, version: current.digest })
  const backups = (await readdir(join(harnessHome, '.paimind-skill-installer', 'backups')))
    .filter(name => name.startsWith(`${skillName}-`))
  console.log(JSON.stringify({ phase, removal, installed: false, backups }, null, 2))
  process.exit(0)
}

if (phase === 'install-v1' && current !== undefined) {
  await service.uninstall({ skillId: skillName, version: current.digest })
}
if (phase === 'update-v2' && current === undefined) throw new Error(`${skillName} must be installed before update-v2`)

const fixture = fileURLToPath(new URL(`./fixtures/${phase === 'install-v1' ? 'e2e-v1' : 'e2e-v2'}/SKILL.md`, import.meta.url))
const uploaded = await upload(fixture)
const preview = await service.inspectUpload({ uploadId: uploaded.uploadId })
const result = await service.installUpload(uploaded)
const installed = (await service.listInstalled()).items.find(item => item.skillId === skillName)
console.log(JSON.stringify({ phase, preview, result, installed }, null, 2))
