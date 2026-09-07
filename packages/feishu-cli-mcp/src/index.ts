import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export interface FeishuCliConfiguration {
  readonly executable: string
  readonly profile: string
  readonly cwd: string
  readonly timeoutMs?: number
}

export const feishuReadInput = z.object({
  document: z.string().min(1).max(2048),
  format: z.enum(['xml', 'markdown']).default('xml'),
}).strict()
export const feishuCreateInput = z.object({
  content: z.string().min(1).max(200_000),
  format: z.enum(['xml', 'markdown']).default('xml'),
  parentToken: z.string().min(1).max(200).optional(),
}).strict()
export const feishuUpdateInput = z.object({
  document: z.string().min(1).max(2048),
  command: z.enum(['str_replace', 'block_replace', 'block_insert_after', 'append']),
  content: z.string().max(200_000),
  pattern: z.string().min(1).max(30_000).optional(),
  blockId: z.string().min(1).max(200).optional(),
  revisionId: z.number().int().nonnegative(),
  format: z.enum(['xml', 'markdown']).default('xml'),
}).strict().superRefine((input, ctx) => {
  if (input.command === 'str_replace' && input.pattern === undefined) ctx.addIssue({ code: 'custom', message: 'str_replace requires pattern' })
  if (input.command.startsWith('block_') && input.blockId === undefined) ctx.addIssue({ code: 'custom', message: 'block operation requires blockId' })
})

/** No command-string parsing, profile switching, credential transport, or automatic retry. */
export function feishuCommand(operation: 'identity' | 'read' | 'create' | 'update', value: unknown, profile: string): { args: string[]; stdin?: string } {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(profile)) throw new Error('Invalid CLI profile')
  const fixed = ['--profile', profile, '--as', 'user']
  if (operation === 'identity') return { args: ['auth', 'status', '--profile', profile] }
  if (operation === 'read') {
    const input = feishuReadInput.parse(value)
    return { args: ['docs', '+fetch', '--api-version', 'v2', '--doc', input.document, '--doc-format', input.format, '--detail', 'full', ...fixed] }
  }
  if (operation === 'create') {
    const input = feishuCreateInput.parse(value)
    return { args: ['docs', '+create', '--api-version', 'v2', '--doc-format', input.format, '--content', '-', ...(input.parentToken === undefined ? [] : ['--parent-token', input.parentToken]), ...fixed], stdin: input.content }
  }
  const input = feishuUpdateInput.parse(value)
  return {
    args: ['docs', '+update', '--api-version', 'v2', '--doc', input.document, '--command', input.command,
      '--revision-id', String(input.revisionId), '--doc-format', input.format, '--content', '-',
      ...(input.pattern === undefined ? [] : ['--pattern', input.pattern]), ...(input.blockId === undefined ? [] : ['--block-id', input.blockId]), ...fixed],
    stdin: input.content,
  }
}

export interface FeishuCliResult {
  readonly ok: boolean
  readonly operation: string
  readonly profile: string
  readonly result: unknown
  readonly outcome: 'succeeded' | 'failed' | 'unknown'
}

/** Execute the installed CLI as the local user; an uncertain write is surfaced, never replayed. */
export async function runFeishuCli(configuration: FeishuCliConfiguration, operation: 'identity' | 'read' | 'create' | 'update', input: unknown, signal?: AbortSignal): Promise<FeishuCliResult> {
  const command = feishuCommand(operation, input, configuration.profile)
  const write = operation === 'create' || operation === 'update'
  return await new Promise(resolve => {
    let stdout = '', stderr = '', limitExceeded = false, timedOut = false, spawnFailed = false
    const child = spawn(configuration.executable, command.args, {
      cwd: configuration.cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    })
    const stop = (): void => { timedOut = true; child.kill('SIGKILL') }
    const timer = setTimeout(stop, configuration.timeoutMs ?? 50_000)
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    const collect = (text: string, next: string): string => {
      if (text.length + next.length > 2_000_000) { limitExceeded = true; child.kill('SIGKILL'); return text }
      return text + next
    }
    child.stdout.on('data', (chunk: string) => { stdout = collect(stdout, chunk) })
    child.stderr.on('data', (chunk: string) => { stderr = collect(stderr, chunk) })
    child.stdin.on('error', () => {})
    child.on('error', () => { spawnFailed = true })
    child.on('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      let result: unknown, structuredStdout = false
      try { result = JSON.parse(stdout) as unknown; structuredStdout = true } catch {
        try { result = JSON.parse(stderr) as unknown } catch {
          result = {
            message: spawnFailed ? 'CLI executable unavailable' : timedOut ? 'CLI timed out or was cancelled' : limitExceeded ? 'CLI output exceeded limit' : 'CLI returned no structured result',
            exitCode: code, stdout: stdout.slice(0, 32_000), stderr: stderr.slice(0, 32_000),
            diagnosticsTruncated: stdout.length > 32_000 || stderr.length > 32_000,
          }
        }
      }
      const record = typeof result === 'object' && result !== null ? result as Record<string, unknown> : {}
      // Exit zero without the CLI's explicit success envelope is not evidence of a write.
      const ok = structuredStdout && code === 0 && !timedOut && !limitExceeded && (operation === 'identity'
        ? record.identity === 'user' && record.verified !== false : record.ok === true)
      const outcome = ok ? 'succeeded' : write && !spawnFailed ? 'unknown' : 'failed'
      resolve({ ok, operation, profile: configuration.profile, result, outcome })
    })
    child.stdin.end(command.stdin)
  })
}

/** A reusable local connection template; profile and binary are explicit user choices. */
export function feishuMcpTemplate(): { command: string; args: string[]; cwd: string } {
  return { command: process.execPath, args: [fileURLToPath(new URL('./server.js', import.meta.url)), '--cli', 'lark-cli', '--profile', 'default'], cwd: process.cwd() }
}

/** Optional host integration. The standalone /server entry needs no Center runtime. */
export const name = 'paimind-feishu-cli-mcp'
export const inject = ['paimindMcpConnections']
export interface FeishuTemplateHostContext {
  readonly paimindMcpConnections: import('@paimind/mcp-center/contract').McpTemplateContribution
  effect(install: () => (() => void), label?: string): void
}
export function apply(ctx: FeishuTemplateHostContext): void {
  ctx.effect(() => ctx.paimindMcpConnections.registerTemplate({
    id: 'feishu-cli', name: '本地飞书', description: '通过本机已授权的飞书命令行账号操作文档。',
    setupHint: '将启动参数里的 default 改为明确的命令行账号配置名，并填写已安装的 lark-cli 路径；每条连接固定使用该配置，不切换全局默认账号。',
    configuration: { ...feishuMcpTemplate(), transport: 'stdio', category: 'documents', enabled: true, timeoutMs: 60_000, envRefs: {} },
  }), 'paimind-feishu-cli-mcp: connection template')
}
