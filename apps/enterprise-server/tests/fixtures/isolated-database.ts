import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { verifyResumedDatabaseConfig } from '../../../../deploy/enterprise/controller/database-resume.mjs'

type TestDatabase = { ownerUrl: string; applicationUrl: string; masterKey: string; bootstrapSecret: string;
  tenantId: string; containerId: string; evidence: string }
const failure = 'Private owned isolated database configuration required'

function privateJson(path: string) {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077)
    || info.uid !== process.getuid!() || realpathSync(path) !== resolve(path)) throw Error(failure)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Test-only identity check, before any database connection. Ephemeral port
 * numbers are not ownership: bind the private setup receipt to the exact live
 * container/image and its unique loopback publication. Never print credentials
 * or raw engine errors. The bundled child keeps the test runner's working dir. */
export function isolatedDatabase(path = process.env.PAIMIND_HAAS_TEST_CONFIG, sourceRoot = process.cwd()): TestDatabase {
  try {
    if (!path || !isAbsolute(path)) throw Error(failure)
    const root = realpathSync(sourceRoot), config: TestDatabase = privateJson(path)
    if (!config || !isAbsolute(config.evidence) || !/^[a-f0-9]{64}$/.test(config.containerId)) throw Error(failure)
    const evidence = realpathSync(config.evidence), rel = relative(root, evidence), directory = lstatSync(evidence)
    if (evidence !== config.evidence || !directory.isDirectory() || (directory.mode & 0o077)
      || directory.uid !== process.getuid!() || (!rel.startsWith('../') && !isAbsolute(rel))
      || resolve(path) !== join(evidence, 'test-config.json')) throw Error(failure)
    const receipt = privateJson(join(evidence, 'fixture-receipt.json'))
    if (receipt.sourceRoot !== root || receipt.containerId !== config.containerId
      || receipt.role !== 'isolated-identity-backend-not-final-worker-acceptance'
      || !/^sha256:[a-f0-9]{64}$/.test(receipt.image)) throw Error(failure)
    const rows = JSON.parse(execFileSync('docker', ['inspect', config.containerId], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }))
    if (!Array.isArray(rows) || rows.length !== 1) throw Error(failure)
    const observed = rows[0]
    if (observed.Image !== receipt.image || observed.Name !== '/' + receipt.container
      || observed.Config?.Labels?.['paimind.goal'] !== 'enterprise-haas') throw Error(failure)
    verifyResumedDatabaseConfig(config, config, observed)
    return Object.freeze(config)
  } catch { throw Error(failure) }
}
