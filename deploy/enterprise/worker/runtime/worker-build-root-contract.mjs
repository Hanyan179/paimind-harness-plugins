#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_NAMES = Object.freeze(['source', 'store', 'deploy', 'assembled', 'final'])

export const WORKER_BUILD_ROOT_CONTRACT = Object.freeze({
  schemaVersion: 1,
  roots: Object.freeze({
    source: Object.freeze({
      environmentVariable: 'PAIMIND_WORKER_BUILD_SOURCE_ROOT',
      path: '/opt/paimind-enterprise-build-source',
    }),
    store: Object.freeze({
      environmentVariable: 'PAIMIND_WORKER_PNPM_STORE_ROOT',
      path: '/opt/paimind-enterprise-pnpm-store',
    }),
    deploy: Object.freeze({
      environmentVariable: 'PAIMIND_WORKER_DEPLOY_ROOT',
      path: '/runtime-deploy',
    }),
    assembled: Object.freeze({
      environmentVariable: 'PAIMIND_WORKER_ASSEMBLED_ROOT',
      path: '/runtime',
    }),
    final: Object.freeze({
      environmentVariable: 'PAIMIND_WORKER_FINAL_ROOT',
      path: '/opt/paimind',
    }),
  }),
})

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function containsPath(parent, candidate) {
  const path = relative(parent, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function requireRootName(value) {
  if (!ROOT_NAMES.includes(value)) throw new Error(`unknown Worker build root name: ${value}`)
  return value
}

function normalizeRequiredRoots(requiredRoots) {
  if (requiredRoots === undefined) return Object.freeze([])
  if (!Array.isArray(requiredRoots)) throw new Error('required Worker build roots must be an array')
  return Object.freeze([...new Set(requiredRoots.map(requireRootName))].sort())
}

function readContractEnvironment(environment) {
  if (environment === null || typeof environment !== 'object') {
    throw new Error('Worker build root environment must be an object')
  }
  const values = {}
  for (const name of ROOT_NAMES) {
    const variable = WORKER_BUILD_ROOT_CONTRACT.roots[name].environmentVariable
    if (!Object.hasOwn(environment, variable) || typeof environment[variable] !== 'string' || environment[variable].length === 0) {
      throw new Error(`required Worker build root environment variable is missing: ${variable}`)
    }
    const value = environment[variable]
    if (!isAbsolute(value) || value === '/') {
      throw new Error(`Worker build root ${name} must be a non-root absolute path`)
    }
    if (resolve(value) !== value) {
      throw new Error(`Worker build root ${name} must be lexically normalized`)
    }
    values[name] = value
  }

  for (let index = 0; index < ROOT_NAMES.length; index += 1) {
    const left = ROOT_NAMES[index]
    for (const right of ROOT_NAMES.slice(index + 1)) {
      if (containsPath(values[left], values[right]) || containsPath(values[right], values[left])) {
        throw new Error(`Worker build roots overlap: ${left} and ${right}`)
      }
    }
  }

  for (const name of ROOT_NAMES) {
    if (values[name] !== WORKER_BUILD_ROOT_CONTRACT.roots[name].path) {
      throw new Error(`Worker build root ${name} does not match the locked root contract`)
    }
  }
  return Object.freeze(values)
}

export async function inspectWorkerBuildRootDirectory(name, configuredPath) {
  requireRootName(name)
  if (typeof configuredPath !== 'string' || !isAbsolute(configuredPath) || configuredPath === '/') {
    throw new Error(`required Worker build root ${name} must be a non-root absolute path`)
  }
  let metadata
  try {
    metadata = await lstat(configuredPath)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`required Worker build root ${name} is missing`)
    throw error
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`required Worker build root ${name} may not be a symbolic link`)
  }
  if (!metadata.isDirectory()) {
    throw new Error(`required Worker build root ${name} must be a directory`)
  }
  const canonicalPath = await realpath(configuredPath)
  if (canonicalPath !== configuredPath) {
    throw new Error(`required Worker build root ${name} may not alias another path`)
  }
  return Object.freeze({
    root: name,
    identityDigest: sha256(Buffer.from(configuredPath, 'utf8')),
    ownerUid: metadata.uid,
    ownerGid: metadata.gid,
    mode: metadata.mode & 0o777,
  })
}

function contractDigest() {
  const material = JSON.stringify({
    schemaVersion: WORKER_BUILD_ROOT_CONTRACT.schemaVersion,
    roots: ROOT_NAMES.map(name => ({
      name,
      environmentVariable: WORKER_BUILD_ROOT_CONTRACT.roots[name].environmentVariable,
      path: WORKER_BUILD_ROOT_CONTRACT.roots[name].path,
    })),
  })
  return sha256(Buffer.from(material, 'utf8'))
}

export const WORKER_BUILD_ROOT_CONTRACT_DIGEST = contractDigest()

export async function verifyWorkerBuildRootContract(options = {}) {
  const environment = options.environment ?? process.env
  const requiredRoots = normalizeRequiredRoots(options.requiredRoots)
  const values = readContractEnvironment(environment)
  const verifiedRoots = []
  for (const name of requiredRoots) {
    verifiedRoots.push(await inspectWorkerBuildRootDirectory(name, values[name]))
  }
  return Object.freeze({
    schemaVersion: WORKER_BUILD_ROOT_CONTRACT.schemaVersion,
    status: 'PASS',
    contractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
    requiredRoots,
    verifiedRoots: Object.freeze(verifiedRoots),
  })
}

export function parseWorkerBuildRootArguments(argv) {
  if (!Array.isArray(argv)) throw new Error('Worker build root arguments must be an array')
  const requiredRoots = []
  for (const argument of argv) {
    if (!argument.startsWith('--require=')) {
      throw new Error('Worker build root contract received an unknown argument')
    }
    const value = argument.slice('--require='.length)
    if (value.length === 0) throw new Error('Worker build root --require list may not be empty')
    for (const name of value.split(',')) {
      if (name.length === 0) throw new Error('Worker build root --require list contains an empty name')
      requiredRoots.push(requireRootName(name))
    }
  }
  return Object.freeze({ requiredRoots: normalizeRequiredRoots(requiredRoots) })
}

const modulePath = await realpath(fileURLToPath(import.meta.url))
const invoked = process.argv[1] !== undefined
  && await realpath(resolve(process.argv[1])).catch(() => undefined) === modulePath
if (invoked) {
  try {
    const result = await verifyWorkerBuildRootContract({
      environment: process.env,
      ...parseWorkerBuildRootArguments(process.argv.slice(2)),
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`Worker build root contract verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  }
}
