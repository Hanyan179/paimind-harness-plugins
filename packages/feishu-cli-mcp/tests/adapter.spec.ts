// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { feishuCommand, runFeishuCli } from '../src/index.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fakeCli(body: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'paimind-feishu-test-')); roots.push(cwd)
  const executable = join(cwd, 'lark-cli')
  await writeFile(executable, `#!${process.execPath}\n${body}`, { mode: 0o700 })
  return { executable, cwd, profile: 'personal' }
}
describe('profile-pinned Feishu CLI MCP adapter', () => {
  it('keeps content on stdin and arguments literal, fixes profile and user identity', async () => {
    const content = '<doc><p>中文 $HOME `touch /tmp/never`</p></doc>'
    const command = feishuCommand('create', { content }, 'personal')
    expect(command.stdin).toBe(content); expect(command.args).not.toContain(content)
    expect(command.args.slice(-4)).toEqual(['--profile', 'personal', '--as', 'user'])
    const cli = await fakeCli(`let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>data+=s);process.stdin.on('end',()=>console.log(JSON.stringify({ok:true,args:process.argv.slice(2),data})))`)
    const result = await runFeishuCli(cli, 'create', { content })
    expect(result.ok).toBe(true); expect(result.result).toMatchObject({ data: content, args: command.args })
  })
  it('requires a fresh revision and a precise partial-update target', () => {
    expect(() => feishuCommand('update', { document: 'doc', command: 'block_replace', content: '<p>x</p>', blockId: 'b' }, 'one')).toThrow()
    expect(() => feishuCommand('update', { document: 'doc', command: 'str_replace', content: 'x', revisionId: 1 }, 'one')).toThrow()
    const result = feishuCommand('update', { document: 'doc', command: 'block_replace', content: '<p>x</p>', blockId: 'b', revisionId: 4 }, 'one')
    expect(result.args).toContain('4'); expect(result.args).not.toContain('overwrite')
    expect(() => feishuCommand('identity', {}, '--default')).toThrow()
  })
  it('never declares success on malformed output or blindly replays an uncertain write', async () => {
    const malformed = await fakeCli("console.log('not a result')")
    expect(await runFeishuCli(malformed, 'create', { content: '<p>x</p>' })).toMatchObject({ ok: false, outcome: 'unknown' })
    const denied = await fakeCli("console.log(JSON.stringify({ok:false,error:{code:99991672,message:'permission denied'}}));process.exitCode=1")
    const result = await runFeishuCli(denied, 'update', { document: 'doc', command: 'append', revisionId: 1, content: '<p>x</p>' })
    expect(result).toMatchObject({ ok: false, outcome: 'unknown', result: { error: { message: 'permission denied' } } })
    const missing = await runFeishuCli({ ...denied, executable: join(denied.cwd, 'missing') }, 'create', { content: 'x' })
    expect(missing).toMatchObject({ ok: false, outcome: 'failed' })
    const plain = await fakeCli("console.error('permission denied: authorize the selected profile');process.exitCode=1")
    expect(await runFeishuCli(plain, 'read', { document: 'doc' })).toMatchObject({
      ok: false, result: { stderr: 'permission denied: authorize the selected profile\n' },
    })
    const stderrOnly = await fakeCli("console.error(JSON.stringify({ok:true}))")
    expect(await runFeishuCli(stderrOnly, 'create', { content: 'x' })).toMatchObject({ ok: false, outcome: 'unknown' })
  })
  it('reports bot-only identity and cancelled writes honestly', async () => {
    const cli = await fakeCli("console.log(JSON.stringify({identity:'bot'}))")
    expect((await runFeishuCli(cli, 'identity', {})).ok).toBe(false)
    const slow = await fakeCli('setTimeout(()=>console.log(JSON.stringify({ok:true})),10000)')
    expect(await runFeishuCli({ ...slow, timeoutMs: 30 }, 'create', { content: 'x' })).toMatchObject({ ok: false, outcome: 'unknown' })
  })
})
