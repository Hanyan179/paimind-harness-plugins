import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PaimindSkillInstallerService,
  parseSkillMetadata,
  validateSkillArchivePath,
} from '../src/installer.js'

const roots: string[] = []

async function createInstaller(): Promise<{ service: PaimindSkillInstallerService; root: string; state: string }> {
  const base = await mkdtemp(join(tmpdir(), 'paimind-skill-installer-'))
  roots.push(base)
  const root = join(base, 'skills')
  const state = join(base, 'state')
  const context = {
    reflect: { provide: () => {} },
    webServer: { register: () => () => {} },
    effect(install: () => void) { install() },
  }
  return { service: new PaimindSkillInstallerService(context as never, { skillRoot: root, stateRoot: state, now: () => 42 }), root, state }
}

async function upload(service: PaimindSkillInstallerService, fileName: string, body: string | Uint8Array): Promise<{ uploadId: string; digest: string }> {
  const request = Readable.from([Buffer.from(body)]) as IncomingMessage
  Object.assign(request, {
    headers: { 'x-paimind-upload': '1', 'x-paimind-file-name': encodeURIComponent(fileName) },
    method: 'POST',
    url: '/paimind/skills/uploads',
  })
  let status = 0
  let payload = ''
  const response = {
    writeHead(value: number) { status = value; return this },
    end(value?: string) { payload = value ?? '' },
  } as unknown as ServerResponse
  await service.handleUpload(request, response)
  expect(status).toBe(201)
  return JSON.parse(payload) as { uploadId: string; digest: string }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('streaming Skill installer', () => {
  it('parses folded community YAML frontmatter with nested metadata', () => {
    expect(parseSkillMetadata(`---
name: ppt-master
description: >
  AI-driven presentation generation and editing.
  Supports reusable templates.
metadata:
  version: "4.7.0"
  license: MIT
---
`)).toEqual({
      name: 'ppt-master',
      description: 'AI-driven presentation generation and editing. Supports reusable templates.',
    })
  })

  it('accepts community packages with ecosystem metadata outside the Skill root', async () => {
    const { service, root } = await createInstaller()
    const archive = zipSync({
      'skills/.claude-plugin/plugin.json': strToU8('{"name":"ppt-master"}'),
      'skills/ppt-master/SKILL.md': strToU8(`---
name: ppt-master
description: >
  AI-driven presentation generation and editing.
  Supports reusable templates.
metadata:
  version: "4.7.0"
---
`),
      'skills/ppt-master/requirements.txt': strToU8('python-pptx>=1.0.0\n'),
      'skills/ppt-master/scripts/render.py': strToU8('print("ok")\n'),
    })
    const uploaded = await upload(service, 'ppt-master-skill-v4.7.0.zip', archive)
    const preview = await service.inspectUpload({ uploadId: uploaded.uploadId })
    expect(preview).toMatchObject({
      name: 'ppt-master',
      description: 'AI-driven presentation generation and editing. Supports reusable templates.',
      fileCount: 3,
      runtimeRequirements: ['python'],
    })
    expect(preview.warnings).toContain('包含脚本文件；安装过程不会执行脚本')
    const installed = await service.installUpload(uploaded)
    expect(installed.record.runtimeRequirements).toEqual(['python'])
    await expect(readFile(join(root, 'ppt-master', 'SKILL.md'), 'utf8')).resolves.toContain('name: ppt-master')
    await expect(stat(join(root, '.claude-plugin'))).rejects.toThrow()
  })

  it('stages official and PAIMind internal recommendations through the same inspection and atomic install path', async () => {
    const { service, root } = await createInstaller()
    const catalog = await service.listCatalog()
    expect(catalog.items.map(item => item.id)).toEqual(['openai-docs', 'skill-creator', 'skill-installer', 'bento-ppt', 'fineline-investment-analysis', 'white-space-analysis', 'build-walmart-buyer-proposal-outline', 'category-performance-analysis', 'category-opportunity-analysis', 'proposal-assistant-orchestration'])
    const preview = await service.inspectCatalog({ catalogId: 'openai-docs', version: '1.0.0' })
    expect(preview).toMatchObject({ name: 'openai-docs', kind: 'zip', fileCount: 3, operation: 'install' })
    const installed = await service.installUpload({ uploadId: preview.uploadId, digest: preview.digest })
    expect(installed.operation).toBe('installed')
    await expect(readFile(join(root, 'openai-docs', 'LICENSE.txt'), 'utf8')).resolves.toContain('Apache License')
    await expect(readFile(join(root, 'openai-docs', 'NOTICE.txt'), 'utf8')).resolves.toContain('Adapted for DeepSeek Harness')
    const bento = await service.inspectCatalog({ catalogId: 'bento-ppt', version: '1.4.0' })
    expect(bento).toMatchObject({ name: 'bento-ppt', kind: 'zip', fileCount: 3, operation: 'install' })
    await service.installUpload({ uploadId: bento.uploadId, digest: bento.digest })
    const bentoSkill = await readFile(join(root, 'bento-ppt', 'SKILL.md'), 'utf8')
    expect(bentoSkill).toContain('create_fact_bound_presentation_outline')
    expect(bentoSkill).toContain('generate_traceable_bento_from_outline')
    await expect(readFile(join(root, 'bento-ppt', 'LICENSE.txt'), 'utf8')).resolves.toContain('Internal Use Only')
  })

  it('rejects traversal, absolute and backslash archive paths', () => {
    expect(validateSkillArchivePath('skill/SKILL.md')).toBe('skill/SKILL.md')
    expect(() => validateSkillArchivePath('../SKILL.md')).toThrow(/路径穿越/)
    expect(() => validateSkillArchivePath('/tmp/SKILL.md')).toThrow(/不安全路径/)
    expect(() => validateSkillArchivePath('skill\\SKILL.md')).toThrow(/不安全路径/)
  })

  it('streams install, atomically updates, and recoverably uninstalls a managed Skill', async () => {
    const { service, root, state } = await createInstaller()
    const first = await upload(service, 'SKILL.md', '---\nname: acceptance-skill\ndescription: First version\n---\n\nFirst body.\n')
    const firstPreview = await service.inspectUpload({ uploadId: first.uploadId })
    expect(firstPreview.operation).toBe('install')
    const installed = await service.installUpload(first)
    expect(installed.operation).toBe('installed')
    expect(await readFile(join(root, 'acceptance-skill', 'SKILL.md'), 'utf8')).toContain('First body.')

    const second = await upload(service, 'SKILL.md', '---\nname: acceptance-skill\ndescription: Second version\n---\n\nSecond body.\n')
    expect((await service.inspectUpload({ uploadId: second.uploadId })).operation).toBe('update')
    const updated = await service.installUpload(second)
    expect(updated.operation).toBe('updated')
    expect(updated.record.installedAt).toBe(installed.record.installedAt)
    expect(await readFile(join(root, 'acceptance-skill', 'SKILL.md'), 'utf8')).toContain('Second body.')

    const removed = await service.uninstall({ skillId: 'acceptance-skill', version: updated.record.digest })
    expect(removed.recoverable).toBe(true)
    await expect(stat(join(root, 'acceptance-skill'))).rejects.toThrow()
    expect((await readdir(join(state, 'backups'))).some(name => name.startsWith('acceptance-skill-42-'))).toBe(true)
  })
})
