import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (![3, 5].includes(process.argv.length)) throw new Error('Usage: node prepare-browser-fixture.mjs PRIVATE_TEST_CONFIG [OWN_NATIVE_FIXTURE NATIVE_ORIGIN]')
const path = process.argv[2]
if ((statSync(path).mode & 0o077) !== 0) throw new Error('Test configuration must remain private')
const config = JSON.parse(readFileSync(path, 'utf8'))
const nativeFixture = process.argv[3]
const nativeOrigin = process.argv[4]
if (nativeFixture) {
  const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
  const ready = JSON.parse(readFileSync(join(nativeFixture, 'ready.json'), 'utf8'))
  const receipt = JSON.parse(readFileSync(join(nativeFixture, 'fixture.json'), 'utf8'))
  const target = new URL(nativeOrigin)
  if (receipt.root !== root || ready.dshHome !== resolve(nativeFixture, 'dsh-home') || target.origin !== nativeOrigin
    || target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.port === '3080') throw new Error('Unsafe native fixture')
  const pid = execFileSync('/usr/sbin/lsof', ['-t', `-iTCP:${target.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
  if (!/^\d+$/u.test(pid)) throw new Error('Ambiguous native listener')
  const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
  const command = execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
  if (!cwd.split('\n').includes(`n${realpathSync(nativeFixture)}`) || !command.includes(ready.patch)) throw new Error('Native process ownership mismatch')
}
const reservation = createServer()
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
const address = reservation.address()
if (!address || typeof address === 'string' || address.port === 3080) throw new Error('Unable to allocate isolated browser endpoint')
const publicOrigin = `http://127.0.0.1:${address.port}`
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
const serverPath = join(dirname(path), 'browser-server-config.json')
writeFileSync(serverPath, JSON.stringify({
  applicationUrl: config.applicationUrl, tenantId: config.tenantId, masterKey: config.masterKey,
  bootstrapSecret: config.bootstrapSecret, publicOrigin, loopbackDevelopment: true,
  ...(nativeOrigin ? { nativeDevelopmentOrigins: [nativeOrigin] } : {}),
}, null, 2), { flag: 'wx', mode: 0o600 })
if (nativeFixture) writeFileSync(join(dirname(path), 'browser-credentials.json'), JSON.stringify({
  username: 'admin.browser', displayName: 'Morgan', password: randomBytes(24).toString('base64url'),
  bootstrapSecret: config.bootstrapSecret, memberUsername: 'member.browser.a', memberName: 'Taylor',
  memberPassword: randomBytes(24).toString('base64url'), nativeFixture,
}, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ serverPath, publicOrigin, nativeOrigin, purpose: 'identity-browser-slice-not-final-TLS-or-Worker-acceptance' }, null, 2))
