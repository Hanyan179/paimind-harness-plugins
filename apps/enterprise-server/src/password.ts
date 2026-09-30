import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { EnterpriseError, invalid } from './errors.js'

// Fixed bounded parameters: never execute work factors supplied by a stored
// credential. Migrating older credentials requires an explicit migration.
const COST = 131_072
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_BYTES = 64
const MAX_MEMORY = 192 * 1024 * 1024
const FORMAT = 'scrypt-v1'
const DUMMY = `${FORMAT}$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(KEY_BYTES).toString('base64url')}`
let activeDerivations = 0

export function passwordInput(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256 || value.includes('\0')) return invalid('密码须为 12 至 256 个字符')
  return value
}

/** Async native crypto with a process-wide admission limit, including dummy
 * verification. Do not queue unbounded password work on Node's worker pool. */
export class Passwords {
  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    if (activeDerivations >= 2) throw new EnterpriseError(503, 'authentication-busy', '登录服务繁忙，请稍后重试', true)
    activeDerivations += 1
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, KEY_BYTES, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY }, (error, key) => {
          if (error) reject(error)
          else resolve(key)
        })
      })
    } finally { activeDerivations -= 1 }
  }

  async hash(password: string): Promise<string> {
    passwordInput(password)
    const salt = randomBytes(16)
    const digest = await this.derive(password, salt)
    return `${FORMAT}$${salt.toString('base64url')}$${digest.toString('base64url')}`
  }

  async verify(password: string, credential: string | undefined): Promise<boolean> {
    passwordInput(password)
    const parts = (credential ?? DUMMY).split('$')
    if (parts.length !== 3 || parts[0] !== FORMAT || !/^[A-Za-z0-9_-]{22}$/u.test(parts[1] ?? '')
      || !/^[A-Za-z0-9_-]{86}$/u.test(parts[2] ?? '')) {
      // Malformed stored credentials fail closed without an attacker-controlled
      // resource allocation. Still run fixed dummy work to avoid account leaks.
      await this.derive(password, Buffer.alloc(16))
      return false
    }
    const salt = Buffer.from(parts[1]!, 'base64url')
    const expected = Buffer.from(parts[2]!, 'base64url')
    const actual = await this.derive(password, salt)
    return timingSafeEqual(actual, expected) && credential !== undefined
  }
}
