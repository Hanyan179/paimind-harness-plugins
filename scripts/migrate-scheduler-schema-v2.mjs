#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs'
import { copyFile, readFile, rename, stat, unlink, writeFile, chmod } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const DOMAIN = 'paimind_scheduler'
const TARGET_VERSION = 2

function usage() {
  return [
    'Usage:',
    '  node scripts/migrate-scheduler-schema-v2.mjs --path <storage.json>',
    '  node scripts/migrate-scheduler-schema-v2.mjs --path <storage.json> --apply --backup <external-backup.json>',
    '',
    'Dry Run is the default. Apply requires an explicit backup path outside the source storage directory.',
  ].join('\n')
}

function argumentsOf(argv) {
  const result = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') result.apply = true
    else if (argument === '--path' || argument === '--backup') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      result[argument.slice(2)] = value
      index += 1
    } else if (argument === '--help' || argument === '-h') result.help = true
    else throw new Error(`unknown argument: ${argument}`)
  }
  return result
}

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function rows(tables, name) {
  return Object.values(record(tables[name], `tables.${name}`))
}

function validateDocument(value) {
  const root = record(value, 'root')
  const unit = record(root.unit, 'unit')
  if (unit.name !== DOMAIN) throw new Error(`expected storage unit ${DOMAIN}`)
  if (unit.version !== 1 && unit.version !== TARGET_VERSION) throw new Error(`unsupported ${DOMAIN} schema version ${String(unit.version)}`)
  const tables = record(root.tables, 'tables')
  const actions = rows(tables, 'actions')
  const definitions = rows(tables, 'definitions')
  const runs = rows(tables, 'runs')
  const audits = rows(tables, 'audits')
  const actionIds = new Set(actions.map((item, index) => {
    const action = record(item, `actions[${index}]`)
    if (typeof action.actionId !== 'string' || action.actionId === '') throw new Error(`actions[${index}].actionId is invalid`)
    return action.actionId
  }))
  for (const [index, item] of definitions.entries()) {
    const definition = record(item, `definitions[${index}]`)
    if (typeof definition.scheduleId !== 'string' || definition.scheduleId === '') throw new Error(`definitions[${index}].scheduleId is invalid`)
    if (typeof definition.actionId !== 'string' || !actionIds.has(definition.actionId)) {
      throw new Error(`definitions[${index}] references an unknown action`)
    }
    const rule = record(definition.rule, `definitions[${index}].rule`)
    if (!['once', 'daily', 'weekdays', 'weekly', 'monthly'].includes(rule.kind)) {
      throw new Error(`definitions[${index}] has an unsupported schedule rule`)
    }
  }
  return { root, unit, counts: { actions: actions.length, definitions: definitions.length, runs: runs.length, audits: audits.length } }
}

function report(input) {
  process.stdout.write(`${JSON.stringify(input, null, 2)}\n`)
}

async function main() {
  const args = argumentsOf(process.argv.slice(2))
  if (args.help) { process.stdout.write(`${usage()}\n`); return }
  if (typeof args.path !== 'string') throw new Error(`--path is required\n${usage()}`)
  const sourcePath = resolve(args.path)
  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile()) throw new Error('--path must resolve to one storage file')
  const original = await readFile(sourcePath, 'utf8')
  const parsed = JSON.parse(original)
  const before = validateDocument(parsed)
  const summary = {
    domain: DOMAIN,
    path: sourcePath,
    fromVersion: before.unit.version,
    toVersion: TARGET_VERSION,
    counts: before.counts,
    mode: args.apply ? 'apply' : 'dry-run',
    change: before.unit.version === TARGET_VERSION ? 'none' : 'stamp-schema-version',
  }
  if (!args.apply) { report(summary); return }
  if (typeof args.backup !== 'string') throw new Error('--backup is required with --apply')
  const backupPath = resolve(args.backup)
  if (backupPath === sourcePath) throw new Error('--backup must differ from --path')
  if (dirname(backupPath) === dirname(sourcePath)) throw new Error('--backup must be outside the source storage directory')
  if (before.unit.version === TARGET_VERSION) { report({ ...summary, backupPath, applied: false }); return }

  await copyFile(sourcePath, backupPath, fsConstants.COPYFILE_EXCL)
  const migrated = structuredClone(before.root)
  migrated.unit.version = TARGET_VERSION
  validateDocument(migrated)
  const temporaryPath = `${sourcePath}.v2-${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(migrated, null, 2)}\n`, { flag: 'wx', mode: sourceStat.mode })
    await chmod(temporaryPath, sourceStat.mode)
    await rename(temporaryPath, sourcePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  const after = validateDocument(JSON.parse(await readFile(sourcePath, 'utf8')))
  if (after.unit.version !== TARGET_VERSION || JSON.stringify(after.counts) !== JSON.stringify(before.counts)) {
    throw new Error('post-write transaction validation failed; restore the external backup')
  }
  report({ ...summary, backupPath, applied: true, verifiedVersion: after.unit.version, rollback: `cp ${JSON.stringify(backupPath)} ${JSON.stringify(sourcePath)}` })
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
