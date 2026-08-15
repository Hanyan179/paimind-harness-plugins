import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BENTO_CSP, inject, isTrustedInfoRequest, resolveBentoFile } from '../src/index.ts'

describe('FP07 isolated Bento host', () => {
  it('declares every Harness host service it consumes', () => {
    expect(inject).toEqual(['webServer', 'sessions'])
  })

  it('accepts only same-origin loopback info requests', () => {
    expect(isTrustedInfoRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' } })).toBe(true)
    expect(isTrustedInfoRequest({ headers: { host: 'localhost:3080' } })).toBe(true)
    expect(isTrustedInfoRequest({ headers: { host: 'evil.example', origin: 'https://evil.example' } })).toBe(false)
    expect(isTrustedInfoRequest({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } })).toBe(false)
  })

  it('realpath-confines HTML and rejects non-HTML, outside and symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-bento-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'paimind-bento-outside-'))
    const nested = join(root, 'decks')
    await mkdir(nested)
    const html = join(nested, 'deck.html')
    const text = join(nested, 'notes.txt')
    const secret = join(outside, 'secret.html')
    await Promise.all([writeFile(html, '<!doctype html>'), writeFile(text, 'no'), writeFile(secret, 'secret')])
    await symlink(secret, join(nested, 'escape.html'))
    await expect(resolveBentoFile(root, html)).resolves.toBe(await realpath(html))
    await expect(resolveBentoFile(root, text)).resolves.toBeNull()
    await expect(resolveBentoFile(root, secret)).resolves.toBeNull()
    await expect(resolveBentoFile(root, join(nested, 'escape.html'))).resolves.toBeNull()
  })

  it('allows local runtime assets while denying all network and form channels', () => {
    expect(BENTO_CSP).toContain("connect-src 'none'")
    expect(BENTO_CSP).toContain("form-action 'none'")
    expect(BENTO_CSP).toContain("script-src 'self'")
    expect(BENTO_CSP).not.toContain('allow-same-origin')
  })
})
