import { describe, expect, it } from 'vitest'
import { PAIMIND_SIDEBAR_DOWNLINK_PATHS, parsePaimindSidebarDownlink, parsePaimindSidebarTreeRequest, projectPaimindSidebarTree,
  parsePaimindSidebarFileRequest, projectPaimindSidebarFile, parsePaimindSidebarFileResource } from '../src/gateway.js'

describe('original file preview adapter', () => {
  it('recognizes only the exact original media URL, preserves MIME defaults and strips cwd', () => {
    for (const [path, contentType] of [['Hansen.pdf', 'application/pdf'], ['Hansen.PNG', 'image/png'], ['index.html', 'text/html'], ['data.xlsx', 'application/octet-stream'], ['.pdf', 'application/octet-stream']]) {
      const result = parsePaimindSidebarFileResource('GET', '/sidebar/file?' + new URLSearchParams({ sessionId: 'hansen', path: path!, cwd: '/untrusted', download: '1' }))
      expect(result).toEqual({ sessionId: 'hansen', path, download: true, contentType, maximumBytes: 20971520 })
    }
    expect(parsePaimindSidebarFileResource('GET', '/sidebar/api/fs.read')).toBeUndefined()
    for (const query of ['', '?sessionId=hansen', '?sessionId=hansen&path=x&path=y', '?sessionId=hansen&path=x&download=0',
      '?sessionId=hansen&path=x&userId=alex', '?sessionId=hansen&path=x#fragment', '?sessionId=hansen&path=../alex', '?sessionId=hansen&path=x&cwd=%00']) {
      expect(() => parsePaimindSidebarFileResource('GET', '/sidebar/file' + query)).toThrow()
    }
    expect(() => parsePaimindSidebarFileResource('POST', '/sidebar/file?sessionId=hansen&path=x')).toThrow()
  })
  it('parses only original reads and strips submitted roots, never authorization', () => {
    const parse = (value: unknown, target = '/sidebar/api/fs.read') => parsePaimindSidebarFileRequest('POST', target, 'application/json', Buffer.from(JSON.stringify(value)))
    expect(parse({ sessionId: 'hansen', path: '资料/a.txt', cwd: '/foreign', repoRoot: '/private' })).toEqual({ sessionId: 'hansen', path: '资料/a.txt' })
    for (const path of ['', '../secret', '/private/./x', '/x\u0000', '/x\n']) expect(() => parse({ sessionId: 'hansen', path })).toThrow()
    for (const path of ['/sidebar/api/fs.write', '/sidebar/api/fs.read?x=1', '/sidebar/api/%66s.read']) expect(parse({}, path)).toBeUndefined()
    expect(() => parse({ sessionId: 'hansen', path: 'x', userId: 'alex' })).toThrow()
    expect(() => parsePaimindSidebarFileRequest('POST', '/sidebar/api/fs.read', 'text/plain', Buffer.from('{}'))).toThrow()
  })
  it('retains text, binary and truncated carriers and rejects incomplete prefixes', () => {
    expect(projectPaimindSidebarFile(Buffer.alloc(0), 0)).toEqual({ ok: true, value: { kind: 'text', content: '', truncated: false } })
    const text = Buffer.from('<script>hello</script>你好')
    expect(projectPaimindSidebarFile(text, text.length)).toEqual({ ok: true, value: { kind: 'text', content: text.toString(), truncated: false } })
    expect(projectPaimindSidebarFile(Buffer.alloc(524288, 0), 600000)).toEqual({ ok: true, value: { kind: 'binary', size: 600000, head: Buffer.alloc(4096).toString('base64'), truncated: true } })
    for (const size of [-1, NaN, Infinity, 2, 524289]) expect(() => projectPaimindSidebarFile(Buffer.from('x'), size)).toThrow()
  })
})

describe('managed directory projection for the original sidebar carrier', () => {
  const parse = (value: unknown, target = '/sidebar/api/fs.tree') => parsePaimindSidebarTreeRequest('POST', target, 'application/json', Buffer.from(JSON.stringify(value)))
  it('strips the untrusted cwd and rejects selectors, aliases, invalid utf8 and wrong carriers', () => {
    expect(parse({ sessionId: 'hansen', cwd: '/other-member', repoRoot: '/another-claimed-root', path: '/workspace/docs' })).toEqual({ sessionId: 'hansen', path: '/workspace/docs' })
    expect(parse({ sessionId: 'hansen' })).toEqual({ sessionId: 'hansen' })
    for (const value of [{ sessionId: 'hansen', userId: 'alex' }, { sessionId: 'hansen', cwd: null }, { sessionId: '' }, []]) expect(() => parse(value)).toThrow()
    for (const target of ['/sidebar/api/fs.read', '/sidebar/api/fs.tree?x=1', '/sidebar/api/%66s.tree']) expect(parse({ sessionId: 'hansen' }, target)).toBeUndefined()
    expect(() => parsePaimindSidebarTreeRequest('POST', '/sidebar/api/fs.tree', 'text/plain', Buffer.from('{}'))).toThrow()
    expect(() => parsePaimindSidebarTreeRequest('POST', '/sidebar/api/fs.tree', 'application/json', new Uint8Array([0xff]))).toThrow()
  })
  it('retains directories-first, hidden files, symlink denial and bounded/truncated shape without exposing opaque targets', () => {
    const view = { path: '/workspace/docs', truncated: true, entries: [
      { name: 'Z.txt', path: '/workspace/docs/Z.txt', type: 'file', symlink: false, unavailable: false },
      { name: '.notes', path: '/workspace/docs/.notes', type: 'directory', symlink: false, unavailable: false },
      { name: 'external', path: '/workspace/docs/external', type: 'directory', symlink: true, unavailable: true },
    ] }
    const result = projectPaimindSidebarTree(view)
    expect(result).toEqual({ ok: true, value: { path: '/workspace/docs', truncated: true, entries: [
      { name: '.notes', path: '/workspace/docs/.notes', isDir: true, hidden: true, isSymlink: false, broken: false },
      { name: 'external', path: '/workspace/docs/external', isDir: false, hidden: false, isSymlink: true, broken: true },
      { name: 'Z.txt', path: '/workspace/docs/Z.txt', isDir: false, hidden: false, isSymlink: false, broken: false },
    ] } })
    for (const bad of [{ ...view, secret: 'no' }, { ...view, entries: [{ ...view.entries[0], targetKey: '/private' }] },
      { ...view, entries: [{ ...view.entries[0], path: '/foreign' }] }, { ...view, entries: [view.entries[0], view.entries[0]] }]) {
      expect(() => projectPaimindSidebarTree(bad)).toThrow()
    }
  })
})

describe('verified provider session-addressed downlinks, not authorization', () => {
  it('recognizes exactly the two original push paths with one canonical session query', () => {
    for (const path of PAIMIND_SIDEBAR_DOWNLINK_PATHS) {
      expect(parsePaimindSidebarDownlink('GET', path + '?sessionId=session-hansen')).toEqual({ sessionId: 'session-hansen' })
      expect(parsePaimindSidebarDownlink('GET', path + '?sessionId=child%3A123')).toEqual({ sessionId: 'child:123' })
      expect(parsePaimindSidebarDownlink('POST', path + '?sessionId=session-hansen')).toBeUndefined()
      expect(parsePaimindSidebarDownlink('HEAD', path + '?sessionId=session-hansen')).toBeUndefined()
    }
  })
  it.each([
    '/sidebar/ws/terminal?sessionId=session-hansen', '/sidebar/ws/agent-opens',
    '/sidebar/ws/agent-opens?sessionId=', '/sidebar/ws/agent-opens?sessionId=a&sessionId=b',
    '/sidebar/ws/agent-opens?sessionId=a&userId=alex', '/sidebar/ws/agent-opens?sessionId=a&',
    '/sidebar/ws/agent-opens?sessionId=%61', '/sidebar/ws/agent-opens?sessionId=%2Fprivate',
    '/sidebar/ws/agent-opens?sessionId=a+b', '/sidebar/ws/agent-opens?sessionId=%00',
    '/sidebar/ws/agent-opens?sessionId=' + 'a'.repeat(201), '/sidebar/ws/agent-opens?sessionId=a#fragment',
    '/sidebar/ws/%61gent-opens?sessionId=a', '/sidebar/ws/other/../agent-opens?sessionId=a',
    'http://sidebar.invalid/sidebar/ws/agent-opens?sessionId=a', '//foreign.example/sidebar/ws/agent-opens?sessionId=a',
  ])('rejects alias, unreviewed route or ambiguous query %s', target => {
    expect(parsePaimindSidebarDownlink('GET', target)).toBeUndefined()
  })
})
