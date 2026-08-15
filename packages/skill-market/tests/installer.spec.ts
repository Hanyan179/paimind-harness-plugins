import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PaimindSkillInstallerService,
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

async function upload(service: PaimindSkillInstallerService, fileName: string, body: string): Promise<{ uploadId: string; digest: string }> {
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
  it('stages the three official recommendations through the same inspection and atomic install path', async () => {
    const { service, root } = await createInstaller()
    const catalog = await service.listCatalog()
    expect(catalog.items.map(item => item.id)).toEqual(['openai-docs', 'skill-creator', 'skill-installer'])
    const preview = await service.inspectCatalog({ catalogId: 'openai-docs', version: '1.0.0' })
    expect(preview).toMatchObject({ name: 'openai-docs', kind: 'zip', fileCount: 3, operation: 'install' })
    const installed = await service.installUpload({ uploadId: preview.uploadId, digest: preview.digest })
    expect(installed.operation).toBe('installed')
    await expect(readFile(join(root, 'openai-docs', 'LICENSE.txt'), 'utf8')).resolves.toContain('Apache License')
    await expect(readFile(join(root, 'openai-docs', 'NOTICE.txt'), 'utf8')).resolves.toContain('Adapted for DeepSeek Harness')
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
