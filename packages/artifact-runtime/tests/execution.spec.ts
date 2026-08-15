import { describe, expect, it, vi } from 'vitest'
import type {
  PaimindArtifactRuntimeHostContext,
  PaimindHostAgent,
  PaimindToolRunContext,
} from '@paimind/harness-compat/host'
import {
  ArtifactGeneratorRegistry,
  normalizeArtifactFailureResult,
  presentArtifactToolResult,
  type PaimindGeneratorProvider,
} from '../src/index.js'

interface JobResult {
  readonly status: 'completed' | 'killed' | 'failed'
  readonly detail?: string
}

function setup(writeFails = false): {
  readonly registry: ArtifactGeneratorRegistry
  readonly provider: PaimindGeneratorProvider
  readonly executeWrite: ReturnType<typeof vi.fn>
  readonly started: ReturnType<typeof vi.fn>
  readonly jobDone: () => Promise<JobResult>
  readonly exec: PaimindToolRunContext
} {
  const owner: PaimindHostAgent = {
    id: 'session-1',
    session: { id: 'session-1', header: { cwd: '/workspace' } },
  }
  let done: Promise<JobResult> | undefined
  const started = vi.fn((spec: {
    run(): { readonly done: Promise<JobResult> }
  }) => {
    done = spec.run().done
    return 'job-1'
  })
  const executeWrite = vi.fn(async (input: { readonly name: string }) => input.name === 'bash'
    ? { isError: false as const, value: { kind: 'foreground', exitCode: 0, stdout: { text: 'generated\n' }, stderr: { text: '' } }, content: [] }
    : writeFails
      ? { isError: true as const, content: [{ type: 'text', text: 'write denied' }] }
      : { isError: false as const, value: null, content: [] })
  const context: PaimindArtifactRuntimeHostContext = {
    jobs: {
      start: started,
      get: vi.fn(),
      kill: vi.fn(() => 'requested' as const),
    },
    tools: { register: vi.fn(), execute: executeWrite },
    fs: {
      async resolve(path, options) {
        if (path.startsWith('/')) return { displayPath: path }
        return { displayPath: `${options?.cwd ?? ''}/${path}`.replace(/\/+/g, '/') }
      },
      contains(parent, child) { return child.displayPath.startsWith(`${parent.displayPath}/`) },
      async stat() { return { type: 'file' as const, size: 42 } },
    },
    workspaceRegistry: {
      list: () => [{ id: 'workspace-1', path: '/workspace', sessionIds: ['session-1'] }],
    },
    sessionProjections: {
      register: vi.fn(),
      snapshot: () => ({ asOfSeq: 0, values: {} }),
    },
    reflect: { provide: vi.fn(() => () => {}) },
    effect: vi.fn(),
    on: vi.fn(() => () => {}),
  }
  const provider: PaimindGeneratorProvider = {
    id: 'paimind.generator.test',
    kind: 'html',
    previewKind: 'html-document',
    describe: () => ({ path: 'report.html', title: 'Report' }),
    async generate(_input, runtime) {
      await runtime.writeText('report.html', '<!doctype html><title>Report</title>')
      return { path: 'report.html', title: 'Report' }
    },
  }
  const registry = new ArtifactGeneratorRegistry(context)
  registry.register(provider)
  const exec: PaimindToolRunContext = {
    callId: 'call-1', rootCallId: 'root-1', name: 'generate_html_artifact', arguments: {},
    agent: owner, token: Symbol('tool-token'), signal: new AbortController().signal,
  }
  return {
    registry,
    provider,
    executeWrite,
    started,
    jobDone: async () => {
      if (done === undefined) throw new Error('Job did not start')
      return await done
    },
    exec,
  }
}

describe('R2 native artifact execution', () => {
  it('publishes through the native write Tool under the parent token and completes the native Job', async () => {
    const fixture = setup()
    const { artifact } = await fixture.registry.execute(fixture.provider.id, {}, fixture.exec)

    expect(fixture.started).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'paimind-artifact', label: 'Report', owner: fixture.exec.agent,
    }))
    expect(fixture.executeWrite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'write',
      arguments: { file_path: 'report.html', content: '<!doctype html><title>Report</title>' },
      agent: fixture.exec.agent,
      parent: fixture.exec.token,
    }))
    expect(artifact).toMatchObject({
      sessionId: 'session-1', workspaceId: 'workspace-1', path: '/workspace/report.html',
      kind: 'html', previewKind: 'html-document', taskId: 'job-1', state: 'available',
    })
    expect(await fixture.jobDone()).toEqual({ status: 'completed', detail: 'html revision 1' })
    expect(presentArtifactToolResult({ isError: false, meta: {
      schema: 'paimind.tool-result/v1', artifact,
    } })).toMatchObject({ locations: [{ path: '/workspace/report.html' }] })
  })

  it('persists a structured failure, fails the native Job and never exposes a Deliverable location', async () => {
    const fixture = setup(true)
    const { artifact } = await fixture.registry.execute(fixture.provider.id, {}, fixture.exec)

    expect(artifact).toMatchObject({
      state: 'failed', taskId: 'job-1', error: { code: 'generation_failed', message: 'write denied' },
    })
    expect(await fixture.jobDone()).toEqual({ status: 'failed', detail: 'generation_failed' })
    const presentation = presentArtifactToolResult({ isError: false, meta: {
      schema: 'paimind.tool-result/v1', artifact,
    } })
    expect(presentation).toMatchObject({ kind: 'edit', content: [{ type: 'text', text: 'write denied' }] })
    expect(presentation).not.toHaveProperty('locations')
    expect(normalizeArtifactFailureResult({
      isError: false, value: { artifact }, content: [{ type: 'text', text: 'write denied' }],
      meta: { schema: 'paimind.tool-result/v1', artifact },
    })).toMatchObject({
      isError: true, error: { message: 'write denied' },
      meta: { artifact: { state: 'failed', taskId: 'job-1' } },
    })
  })

  it('executes binary-provider commands only through the nested native bash Tool', async () => {
    const fixture = setup()
    const commandProvider: PaimindGeneratorProvider = {
      id: 'paimind.generator.command-test',
      kind: 'pdf',
      previewKind: 'pdf',
      describe: () => ({ path: 'report.pdf', title: 'Report PDF' }),
      async generate(_input, runtime) {
        await runtime.runWorkspaceCommand({ command: "node generator.js", description: 'Generate report PDF', timeoutMs: 45_000 })
        return { path: 'report.pdf', title: 'Report PDF' }
      },
    }
    fixture.registry.register(commandProvider)
    const { artifact: result } = await fixture.registry.execute(commandProvider.id, {}, fixture.exec)
    expect(fixture.executeWrite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'bash',
      arguments: expect.objectContaining({ command: 'node generator.js', description: 'Generate report PDF', workdir: '/workspace', timeoutMs: 45_000 }),
      agent: fixture.exec.agent,
      parent: fixture.exec.token,
    }))
    expect(result).toMatchObject({ kind: 'pdf', previewKind: 'pdf', state: 'available' })
  })

  it('binds structured provenance to the same native Artifact result without a second store', async () => {
    const fixture = setup()
    const traceProvider: PaimindGeneratorProvider = {
      id: 'paimind.generator.trace-test', kind: 'pptx', previewKind: 'presentation',
      describe: () => ({ path: 'deck.pptx', title: 'Deck' }),
      async generate() {
        return { path: 'deck.pptx', title: 'Deck', traceDocument: {
          schemaVersion: 'paimind.presentation-trace/v2', reviewStatus: 'generated', sources: [], slides: [],
        } }
      },
    }
    fixture.registry.register(traceProvider)
    const generated = await fixture.registry.execute(traceProvider.id, {}, fixture.exec)
    expect(generated.artifact.traceId).toMatch(/^trace:/)
    expect(generated.trace).toMatchObject({
      traceId: generated.artifact.traceId, artifactId: generated.artifact.artifactId,
      sessionId: 'session-1', taskId: 'job-1', artifactRevision: 1,
    })
  })
})
