// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Passwords, passwordInput } from '../src/password.js'

describe('bounded native password hashing', () => {
  it('uses unique salts and verifies real derived credentials without retaining plaintext', async () => {
    const passwords = new Passwords()
    const input = 'Correct synthetic password 2026'
    const first = await passwords.hash(input)
    const second = await passwords.hash(input)
    expect(first).not.toBe(second)
    expect(first).not.toContain(input)
    expect(await passwords.verify(input, first)).toBe(true)
    expect(await passwords.verify('Incorrect synthetic password', first)).toBe(false)
  }, 15_000)

  it('fails closed for absent and malformed credentials without accepting injected work factors', async () => {
    const passwords = new Passwords()
    expect(await passwords.verify('Correct synthetic password', undefined)).toBe(false)
    expect(await passwords.verify('Correct synthetic password', 'scrypt$999999999999999$anything')).toBe(false)
  }, 10_000)

  it('caps password work across service instances and releases capacity afterward', async () => {
    const first = new Passwords()
    const second = new Passwords()
    const inFlight = [first.hash('Synthetic password one'), second.hash('Synthetic password two')]
    await expect(new Passwords().hash('Synthetic password three')).rejects.toMatchObject({ code: 'authentication-busy' })
    await Promise.all(inFlight)
    expect(await first.hash('Synthetic password four')).toMatch(/^scrypt-v1\$/u)
  }, 15_000)

  it('validates bounds without trimming the user password', () => {
    expect(passwordInput('  Spaces are significant  ')).toBe('  Spaces are significant  ')
    for (const input of ['short', 'x'.repeat(257), 'password with \0 null', null, {}]) expect(() => passwordInput(input)).toThrow()
  })
})
