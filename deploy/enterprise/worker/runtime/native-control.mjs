import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { chmod, lstat, mkdtemp, readFile, realpath, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

const protocol = 'paimind.native-control/v1'
export const NATIVE_CONTROL_PATH = '/_paimind/native-control'
export const NATIVE_CONTROL_SOCKET = '/run/paimind-native-control/control.sock'
export const NATIVE_ORIGIN_PATH = '/_paimind/native-origins'
export const NATIVE_CONTROL_LIMIT = 262144
const operations = new Set(['publication.snapshot', 'publication.adopt', 'publication.receipt', 'skill.export.begin', 'skill.export.read', 'skill.export.release',
  'skill.adopt.begin', 'skill.adopt.write', 'skill.adopt.commit', 'skill.adopt.release', 'skill.adopt.receipt',
  'feature.describe', 'feature.plan', 'feature.apply', 'session.preset', 'session.creation', 'session.turn-state', 'session.events', 'session.approval', 'session.directory', 'session.file', 'connector.inventory', 'connector.configuration', 'connector.activation-state', 'connector.activate', 'connector.prepare', 'connector.configure', 'connector.release', 'connector.restore'])
const identifier = /^[a-f0-9]{32}$/u
const failure = () => new Error('Private native control unavailable')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function validateNativeFileChunk(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'data,nextOffset,offset,path,size,version'
    || typeof value.path !== 'string' || !value.path.startsWith('/') || value.path.length > 4096 || value.path.includes('\0')
    || value.path.split('/').some(part => part === '.' || part === '..')
    || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset % 65536 !== 0
    || !Number.isSafeInteger(value.size) || value.size < 0 || value.offset > value.size
    || value.offset === value.size && value.size !== 0 || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/u.test(value.version)
    || typeof value.data !== 'string' || value.data.length > 87384) throw failure()
  const bytes = Buffer.from(value.data, 'base64')
  if (bytes.toString('base64') !== value.data || bytes.length !== Math.min(65536, value.size - value.offset)
    || value.nextOffset !== (value.offset + bytes.length < value.size ? value.offset + bytes.length : null)) throw failure()
}
export function validateNativeOriginInput(input) {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'nativeSessionId,sources'
    || typeof input.nativeSessionId !== 'string' || !input.nativeSessionId || input.nativeSessionId.length > 200
    || !Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > 64
    || input.sources.some(source => typeof source !== 'string' || source.length > 8192
      || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(source))
    || new Set(input.sources).size !== input.sources.length) throw failure()
}
export function validateNativeExecutionInput(input) {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'nativeSessionId,presetId,publication,skills,sources'
    || typeof input.presetId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(input.presetId)) throw failure()
  validateNativeOriginInput({ nativeSessionId: input.nativeSessionId, sources: input.sources })
  validateNativeSkillReferences(input.skills)
  if (!input.presetId.startsWith('paimind-enterprise-')) {
    if (input.publication !== null) throw failure()
    return
  }
  const value = input.publication, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u
  if (!object(value) || Object.keys(value).sort().join(',') !== 'contentDigest,publicationId,sourceUserId,tenantId'
    || typeof value.tenantId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.tenantId)
    || typeof value.publicationId !== 'string' || !uuid.test(value.publicationId)
    || typeof value.sourceUserId !== 'string' || !uuid.test(value.sourceUserId)
    || typeof value.contentDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value.contentDigest)
    || input.presetId !== 'paimind-enterprise-' + value.publicationId.replaceAll('-', '')) throw failure()
}
export function validateNativeSkillReferences(skills) {
  if (!Array.isArray(skills) || skills.length > 128) throw failure()
  const names = new Set(), ids = new Set(), uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
  for (const row of skills) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'archiveBytes,archiveDigest,entryCount,expandedBytes,name,packageDigest,publicationId,sourceUserId,tenantId'
      || typeof row.tenantId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(row.tenantId)
      || typeof row.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,254}$/u.test(row.name)
      || typeof row.publicationId !== 'string' || !uuid.test(row.publicationId) || typeof row.sourceUserId !== 'string' || !uuid.test(row.sourceUserId)
      || ['packageDigest', 'archiveDigest'].some(key => typeof row[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(row[key]))
      || !Number.isSafeInteger(row.archiveBytes) || row.archiveBytes < 1 || row.archiveBytes > 216 * 1024 * 1024
      || !Number.isSafeInteger(row.expandedBytes) || row.expandedBytes < 1 || row.expandedBytes > 200 * 1024 * 1024
      || !Number.isSafeInteger(row.entryCount) || row.entryCount < 1 || row.entryCount > 10000
      || names.has(row.name) || ids.has(row.publicationId)) throw failure()
    names.add(row.name); ids.add(row.publicationId)
  }
}
export function validateNativeSkillIds(ids) {
  if (!Array.isArray(ids) || ids.length > 128 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id))) throw failure()
}
// Untrusted syntax projection can only ADD requirements. The gateway still
// authenticates the signed payload and checks every required exact version.
function inheritedSkillIds(sources) {
  const ids = new Set()
  for (const source of sources) {
    let payload
    try { payload = JSON.parse(Buffer.from(source.split('.')[1], 'base64url').toString('utf8')) } catch { throw failure() }
    if (!object(payload)) throw failure()
    const required = Object.hasOwn(payload, 'requiredSkillIds') ? payload.requiredSkillIds : []
    validateNativeSkillIds(required)
    for (const id of required) ids.add(id)
  }
  const result = [...ids].sort(); validateNativeSkillIds(result); return result
}
const validateReverseInput = (operation, input) => {
  if (operation === 'identity.origins') validateNativeOriginInput(input)
  else if (operation === 'runtime.authorize') validateNativeExecutionInput(input)
  else if (operation === 'runtime.delegate') validateNativeDelegationInput(input)
  else if (operation === 'runtime.job-origin') validateNativeJobOriginInput(input)
  else if (operation === 'skill.eligibility') validateNativeSkillReferences(input)
  else if (operation === 'connector.approval') validateNativeConnectorApprovalInput(input)
  else if (operation === 'connector.authorize') validateNativeConnectorExecutionInput(input)
  else throw failure()
}
const approvalRevision = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647
export function validateNativeConnectorApprovalInput(input) {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'expectedApprovalRevision,reference'
    || input.expectedApprovalRevision !== null && !approvalRevision(input.expectedApprovalRevision)) throw failure()
  validateNativeConnectorReference(input.reference)
}
export function validateNativeConnectorExecutionInput(input) {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'approvalRevision,execution,reference'
    || !approvalRevision(input.approvalRevision)) throw failure()
  validateNativeConnectorReference(input.reference); validateNativeExecutionInput(input.execution)
}
function validateConnectorApprovalResult(value, input) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'approvalRevision,executionAuthorized'
    || value.executionAuthorized !== false || !approvalRevision(value.approvalRevision)
    || input.expectedApprovalRevision !== null && input.expectedApprovalRevision !== value.approvalRevision) throw failure()
}
function validateSkillEligibility(value, references) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'eligiblePublicationIds,executionAuthorized'
    || value.executionAuthorized !== false) throw failure()
  validateNativeSkillIds(value.eligiblePublicationIds)
  if (value.eligiblePublicationIds.some(id => !references.some(reference => reference.publicationId === id))) throw failure()
}
export function validateNativeDelegationInput(input) {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'nativeSessionId,presetId,publication,skills,sources,targetSessionId'
    || typeof input.targetSessionId !== 'string' || !input.targetSessionId || input.targetSessionId.length > 200
    || input.targetSessionId === input.nativeSessionId) throw failure()
  const { targetSessionId: _target, ...execution } = input
  validateNativeExecutionInput(execution)
}
function validateDelegatedOrigins(value, input) {
  validateNativeOriginInput(value)
  if (value.nativeSessionId !== input.targetSessionId || value.sources.length > input.sources.length
    || value.sources.some(source => input.sources.includes(source))) throw failure()
}
export function validateNativeJobOriginInput(input) {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'nativeJobId,nativeSessionId,presetId,publication,skills,sources'
    || typeof input.nativeJobId !== 'string' || !input.nativeJobId.trim() || input.nativeJobId.length > 200) throw failure()
  const { nativeJobId: _job, ...execution } = input
  validateNativeExecutionInput(execution)
}
function validateJobOrigins(value, input) {
  validateDelegatedOrigins(value, { ...input, targetSessionId: input.nativeSessionId })
  for (const source of value.sources) {
    const payload = JSON.parse(Buffer.from(source.split('.')[1], 'base64url').toString('utf8'))
    // Payload projection is NOT verification. The authority signs, and every
    // actual execution verifies the signature, original login and current grant.
    if (payload?.nativeJobId !== input.nativeJobId || payload.delegatedPresetId !== input.presetId
      || payload.nativeSessionId !== input.nativeSessionId) throw failure()
  }
}

/** Native-side composition of existing owners, never a browser operation.
 * The receipt owner verifies its actual immutable bytes before this minimal
 * proof crosses the existing channel. Neither snapshot nor credentials travel. */
async function nativeExecutionInput(context, input, signal) {
  signal.throwIfAborted()
  if (!object(input) || !['nativeSessionId,presetId,sources', 'nativeSessionId,presetId,requirements,sources', 'nativeSessionId,presetId,requirements,skillSelection,sources'].includes(Object.keys(input).sort().join(','))
    || Object.hasOwn(input, 'skillSelection') && (input.skillSelection !== 'captured' || !Array.isArray(input.requirements))) throw failure()
  validateNativeOriginInput({ nativeSessionId: input.nativeSessionId, sources: input.sources })
  const retained = input.requirements === undefined ? [] : input.requirements; validateNativeSkillIds(retained)
  const requiredPublicationIds = [...new Set([...retained, ...inheritedSkillIds(input.sources)])].sort()
  validateNativeSkillIds(requiredPublicationIds)
  const selected = { nativeSessionId: input.nativeSessionId, presetId: input.presetId, sources: [...input.sources] }
  let publication = null
  if (typeof selected.presetId !== 'string') throw failure()
  if (selected.presetId.startsWith('paimind-enterprise-')) {
    const owner = context.get('paimindAgentProfiles')
    if (!owner) throw failure()
    const receipt = await owner.getAdoptedPublication({ presetId: selected.presetId })
    publication = { tenantId: receipt.tenantId, publicationId: receipt.publicationId,
      sourceUserId: receipt.sourceUserId, contentDigest: receipt.snapshot.digest }
  }
  signal.throwIfAborted()
  const skillsOwner = context.get('paimindSkillInstaller')
  if (skillsOwner && typeof skillsOwner.getSelectedPublicationReferences !== 'function') throw failure()
  if (!skillsOwner && requiredPublicationIds.length) throw failure()
  const skills = skillsOwner ? await skillsOwner.getSelectedPublicationReferences({ nativeSessionId: selected.nativeSessionId, presetId: selected.presetId,
    ...(input.skillSelection === 'captured' ? { requiredPublicationIds, skillSelection: 'captured' }
      : requiredPublicationIds.length ? { requiredPublicationIds } : {}) }, signal) : []
  signal.throwIfAborted()
  const request = { ...selected, publication, skills }; validateNativeExecutionInput(request)
  if (requiredPublicationIds.some(id => !skills.some(skill => skill.publicationId === id))) throw failure()
  if (input.skillSelection === 'captured' && skills.length !== requiredPublicationIds.length) throw failure()
  return request
}
export async function authorizeNativeExecution(context, peer, input, signal) {
  if (!peer?.ready) throw failure()
  const request = await nativeExecutionInput(context, input, signal)
  await peer.authorizeExecution(request, signal)
  // A local selection or immutable target may change during the authority
  // round trip. Never carry the answer into a different composition.
  const current = await nativeExecutionInput(context, input, signal)
  if (JSON.stringify(current) !== JSON.stringify(request)) throw failure()
  signal.throwIfAborted()
  return Object.freeze(request.skills.map(skill => skill.publicationId).sort())
}
export async function authorizeNativeConnectorUse(context, peer, input, reference, approvalRevision, signal) {
  if (!peer?.ready) throw failure()
  const selected = structuredClone(reference), execution = await nativeExecutionInput(context, input, signal)
  const request = { reference: selected, approvalRevision, execution }; validateNativeConnectorExecutionInput(request)
  await peer.authorizeConnectorExecution(request, signal)
  if (JSON.stringify(await nativeExecutionInput(context, input, signal)) !== JSON.stringify(execution)) throw failure()
  signal.throwIfAborted()
}
/** Exact loaded-body provenance, composed from the same original owners and
 * current authority. The body stays in-process; the existing bounded wire
 * still carries only full immutable references, never another invocation. */
export async function authorizeNativeSkillUse(context, peer, input, value, signal) {
  if (!peer?.ready || !object(value) || !['content,name,provider', 'content,name,provider,resourceBase'].includes(Object.keys(value).sort().join(','))
    || typeof value.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.name)
    || typeof value.provider !== 'string' || !value.provider || typeof value.content !== 'string') throw failure()
  value = structuredClone(value)
  const request = await nativeExecutionInput(context, input, signal), owner = context.get('paimindSkillInstaller')
  if (owner && typeof owner.getLoadedPublicationReference !== 'function'
    || !owner && value.provider === 'paimind-session-business-skills') throw failure()
  const reference = owner ? await owner.getLoadedPublicationReference(value, signal) : undefined
  if (reference) {
    validateNativeSkillReferences([reference])
    if (!request.skills.some(row => JSON.stringify(row) === JSON.stringify(reference))) throw failure()
  }
  await peer.authorizeExecution(request, signal)
  if (JSON.stringify(await nativeExecutionInput(context, input, signal)) !== JSON.stringify(request)
    || JSON.stringify(owner ? await owner.getLoadedPublicationReference(value, signal) : undefined) !== JSON.stringify(reference)) throw failure()
  signal.throwIfAborted()
  return reference && Object.freeze({ name: reference.name, publicationId: reference.publicationId, packageDigest: reference.packageDigest })
}
/** Called only after the original native delegation owner establishes the
 * exact child identity and inherited composition, before inbox publication.
 * This operation derives provenance; it neither creates nor starts a child. */
export async function deriveNativeOrigins(context, peer, input, signal) {
  if (!peer?.ready || !object(input) || !['nativeSessionId,presetId,sources,targetSessionId', 'nativeSessionId,presetId,requirements,sources,targetSessionId'].includes(Object.keys(input).sort().join(','))) throw failure()
  const { targetSessionId, ...parent } = input
  const execution = await nativeExecutionInput(context, parent, signal)
  const request = { ...execution, targetSessionId }
  validateNativeDelegationInput(request)
  const value = await peer.deriveOrigins(request, signal)
  if (JSON.stringify(await nativeExecutionInput(context, parent, signal)) !== JSON.stringify(execution)) throw failure()
  signal.throwIfAborted(); validateDelegatedOrigins(value, request)
  if (JSON.stringify(inheritedSkillIds(value.sources)) !== JSON.stringify(execution.skills.map(skill => skill.publicationId).sort())) throw failure()
  return value
}
export async function sealNativeJobOrigins(context, peer, input, signal) {
  if (!peer?.ready || !object(input) || !['nativeJobId,nativeSessionId,presetId,sources', 'nativeJobId,nativeSessionId,presetId,requirements,sources', 'nativeJobId,nativeSessionId,presetId,requirements,skillSelection,sources'].includes(Object.keys(input).sort().join(','))) throw failure()
  const { nativeJobId, ...execution } = input
  const selected = await nativeExecutionInput(context, execution, signal)
  const request = { ...selected, nativeJobId }
  validateNativeJobOriginInput(request)
  const value = await peer.sealJobOrigins(request, signal)
  if (JSON.stringify(await nativeExecutionInput(context, execution, signal)) !== JSON.stringify(selected)) throw failure()
  signal.throwIfAborted(); validateJobOrigins(value, request)
  if (JSON.stringify(inheritedSkillIds(value.sources)) !== JSON.stringify(selected.skills.map(skill => skill.publicationId).sort())) throw failure()
  return value
}
// The gateway uses the same exact output boundary before disclosing a private
// launcher's response. This internal protocol is not a public native RPC.
export function validateConnectorInventory(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'connection,entries,schema,scope'
    || value.schema !== 'paimind.native-connectors/v1' || value.scope !== 'loader-tree' || value.connection !== 'not-probed'
    || !Array.isArray(value.entries) || value.entries.length > 128) throw failure()
  const ids = new Set()
  for (const entry of value.entries) {
    if (!object(entry) || Object.keys(entry).sort().join(',') !== 'configuration,enabled,entryId,phase,serverName,transport'
      || typeof entry.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u.test(entry.entryId) || ids.has(entry.entryId)
      || entry.serverName !== null && (typeof entry.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(entry.serverName))
      || ![null,'stdio','streamable-http'].includes(entry.transport) || typeof entry.enabled !== 'boolean'
      || ![null,'pending','loading','active','failed','unloading','disposed'].includes(entry.phase)
      || entry.configuration !== (entry.serverName !== null && entry.transport !== null ? 'recognized' : 'unresolved')) throw failure()
    ids.add(entry.entryId)
  }
}

export function validateConnectorConfiguration(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'activation,entries,revision,schema'
    || value.schema !== 'paimind.connector-configuration/v1' || value.activation !== 'not-authorized'
    || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision) || !Array.isArray(value.entries) || value.entries.length > 128) throw failure()
  const ids = new Set(), names = new Set()
  for (const entry of value.entries) {
    if (!object(entry) || Object.keys(entry).sort().join(',') !== 'enabled,entryId,serverName,transport'
      || typeof entry.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(entry.entryId) || ids.has(entry.entryId)
      || typeof entry.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(entry.serverName) || names.has(entry.serverName)
      || !['stdio','streamable-http'].includes(entry.transport) || entry.enabled !== false) throw failure()
    ids.add(entry.entryId); names.add(entry.serverName)
  }
}

export function validateConnectorActivationState(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'entries,revision,schema'
    || value.schema !== 'paimind.connector-observation/v1' || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision)
    || !Array.isArray(value.entries) || value.entries.length > 128) throw failure()
  const ids = new Set(), names = new Set()
  for (const entry of value.entries) {
    if (!object(entry) || Object.keys(entry).sort().join(',') !== 'authority,configurationVersion,connection,enabled,entryId,phase,serverName,transport'
      || typeof entry.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(entry.entryId) || ids.has(entry.entryId)
      || typeof entry.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(entry.serverName) || names.has(entry.serverName)
      || entry.configurationVersion !== null && (typeof entry.configurationVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.configurationVersion))
      || !['stdio','streamable-http'].includes(entry.transport) || typeof entry.enabled !== 'boolean'
      || !['live','absent'].includes(entry.authority) || ![null,'pending','loading','active','failed','disposed','unloading'].includes(entry.phase) || entry.connection !== 'not-probed'
      || entry.enabled && entry.configurationVersion === null || !entry.enabled && entry.authority !== 'absent') throw failure()
    ids.add(entry.entryId); names.add(entry.serverName)
  }
}

export function validateConnectorRelease(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'outcome,reference,revision'
    || !['current','conflict','missing','unversioned'].includes(value.outcome)
    || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision)) throw failure()
  if (value.outcome !== 'current') { if (value.reference !== null) throw failure(); return }
  validateNativeConnectorReference(value.reference)
}
export function validateNativeConnectorReference(ref) {
  if (!object(ref) || Object.keys(ref).sort().join(',') !== 'configurationVersion,entryId,serverName,transport'
    || typeof ref.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(ref.entryId)
    || typeof ref.configurationVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(ref.configurationVersion)
    || typeof ref.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/u.test(ref.serverName)
    || !['stdio','streamable-http'].includes(ref.transport)) throw failure()
}

export async function handleNativeControl(context, operation, input, signal) {
  validateNativeControlInput(operation, input); signal.throwIfAborted()
  if (operation === 'connector.activate') {
    const configuration = context.get('paimindNativeConnectorConfiguration'), authority = context.get('paimindNativeConnectorActivation')
    if (typeof configuration?.observeActivation !== 'function' || typeof authority?.activate !== 'function') throw failure()
    const { expectedApprovalRevision, ...selection } = input
    const result = await authority.activate(selection, signal, expectedApprovalRevision)
    signal.throwIfAborted()
    if (!object(result) || !['activated','disabled','conflict'].includes(result.outcome)
      || result.outcome !== 'conflict' && result.outcome !== (input.enabled ? 'activated' : 'disabled')) throw failure()
    const state = await configuration.observeActivation(signal)
    signal.throwIfAborted(); validateConnectorActivationState(state)
    const entry = state.entries.find(row => row.entryId === input.entryId)
    if (result.outcome !== 'conflict' && (!entry || entry.configurationVersion !== input.configurationVersion || entry.enabled !== input.enabled
      || input.enabled && (entry.authority !== 'live' || entry.phase !== 'active') || !input.enabled && entry.authority !== 'absent')) throw failure()
    return { outcome: result.outcome, state }
  }
  if (operation === 'connector.activation-state') {
    const owner = context.get('paimindNativeConnectorConfiguration')
    if (typeof owner?.observeActivation !== 'function') throw failure()
    const result = await owner.observeActivation(signal)
    signal.throwIfAborted(); validateConnectorActivationState(result)
    return result
  }
  if (operation === 'connector.restore') {
    const owner = context.get('paimindNativeConnectorActivation')
    if (typeof owner?.restore !== 'function') throw failure()
    const result = await owner.restore(signal)
    signal.throwIfAborted(); validateNativeConnectorRestoration(result)
    return result
  }
  if (operation === 'connector.release') {
    const owner = context.get('paimindNativeConnectorConfiguration')
    if (typeof owner?.release !== 'function') throw failure()
    const result = await owner.release(input, signal)
    signal.throwIfAborted(); validateConnectorRelease(result)
    if (result.outcome !== 'conflict' && result.revision !== input.expectedRevision
      || result.reference && result.reference.entryId !== input.entryId) throw failure()
    return result
  }
  if (operation === 'connector.configuration' || operation === 'connector.configure' || operation === 'connector.prepare') {
    const owner = context.get('paimindNativeConnectorConfiguration')
    if (typeof owner?.read !== 'function' || typeof owner?.configure !== 'function') throw failure()
    const result = operation === 'connector.configuration' ? await owner.read(signal)
      : operation === 'connector.prepare' ? await owner.prepare(input, signal) : await owner.configure(input, signal)
    signal.throwIfAborted()
    if (operation === 'connector.configuration') validateConnectorConfiguration(result)
    else {
      if (!object(result) || Object.keys(result).sort().join(',') !== 'outcome,state'
        || !(operation === 'connector.prepare' ? ['conflict','unchanged','ready'] : ['conflict','unchanged','saved-disabled']).includes(result.outcome)) throw failure()
      validateConnectorConfiguration(result.state)
    }
    return result
  }
  if (operation === 'connector.inventory') {
    const owner = context.get('paimindNativeConnectorReferences')
    if (typeof owner?.read !== 'function') throw failure()
    const result = await owner.read(signal)
    signal.throwIfAborted(); validateConnectorInventory(result)
    return result
  }
  if (operation === 'session.directory') {
    const owner = context.get('paimindNativeSessionReferences')
    if (typeof owner?.directory !== 'function') throw failure()
    const result = await owner.directory(input.sessionId, input.path, signal)
    signal.throwIfAborted()
    return result
  }
  if (operation === 'session.file') {
    const owner = context.get('paimindNativeSessionReferences')
    if (typeof owner?.file !== 'function') throw failure()
    const result = await owner.file(input.sessionId, input.path, input.offset, input.version, signal)
    signal.throwIfAborted(); validateNativeFileChunk(result)
    if (result.offset !== input.offset || input.version !== undefined && result.version !== input.version) throw failure()
    return result
  }
  if (operation === 'session.creation') {
    const owner = context.get('paimindNativeSessionReferences')
    if (typeof owner?.creation !== 'function') throw failure()
    const result = await owner.creation(input.sessionId, signal)
    signal.throwIfAborted(); validateNativeSessionCreationReference(result, input.sessionId)
    return result
  }
  if (operation === 'session.turn-state') {
    const owner = context.get('paimindNativeSessionReferences')
    if (typeof owner?.turnState !== 'function') throw failure()
    const result = await owner.turnState(input.sessionId, input.selection, signal)
    signal.throwIfAborted(); validateNativeSessionTurnState(result, input.sessionId)
    return result
  }
  if (operation === 'session.approval') {
    const owner = context.get('paimindNativeSessionReferences')
    if (typeof owner?.approval !== 'function') throw failure()
    const result = await owner.approval(input.sessionId, input.approvalId, signal)
    signal.throwIfAborted(); validateNativeApprovalReference(result, input.sessionId, input.approvalId)
    return result
  }
  if (operation === 'session.events') {
    const owner = context.get('paimindNativeSessionReferences')
    if (typeof owner?.events !== 'function') throw failure()
    const result = await owner.events(input.sessionId, { afterSeq: input.afterSeq,
      ...(input.afterDigest === undefined ? {} : { afterDigest: input.afterDigest }) }, signal)
    signal.throwIfAborted(); validateNativeSessionEventPage(result, input.sessionId, input.afterSeq)
    return result
  }
  if (operation === 'session.preset') {
    const owner = context.get('paimindNativeSessionReferences')
    if (typeof owner?.read !== 'function') throw failure()
    const result = await owner.read(input.sessionId, signal)
    signal.throwIfAborted(); validateNativeSessionPresetReference(result, input.sessionId)
    return result
  }
  if (operation.startsWith('feature.')) {
    const owner = context.get('paimindFeaturePacks')
    if (!owner) throw failure()
    if (operation === 'feature.describe') return owner.describeGovernedFeatures()
    if (operation === 'feature.plan') return owner.previewGovernedChange(input)
    if (operation === 'feature.apply') return owner.applyGovernedChange(input, signal)
    throw failure()
  }
  if (operation.startsWith('skill.')) {
    const owner = context.get('paimindSkillInstaller')
    if (!owner) throw failure()
    if (operation === 'skill.export.begin') return owner.beginPublicationExport(input, signal)
    if (operation === 'skill.export.read') return owner.readPublicationExport(input, signal)
    if (operation === 'skill.export.release') return owner.releasePublicationExport(input)
    if (operation === 'skill.adopt.begin') return owner.beginPublicationAdoption(input, signal)
    if (operation === 'skill.adopt.write') return owner.writePublicationAdoption(input, signal)
    if (operation === 'skill.adopt.commit') return owner.commitPublicationAdoption(input, signal)
    if (operation === 'skill.adopt.release') return owner.releasePublicationAdoption(input)
    if (operation === 'skill.adopt.receipt') return owner.getAdoptedSkillPublication(input, signal)
    throw failure()
  }
  const owner = context.get('paimindAgentProfiles')
  if (!owner) throw failure()
  if (operation === 'publication.snapshot') return owner.getPublicationSnapshot(input)
  if (operation === 'publication.receipt') return owner.getAdoptedPublication(input)
  if (operation === 'publication.adopt') return owner.adoptPublication(input)
  throw failure()
}

export function validateNativeControlInput(operation, input) {
  if (!operations.has(operation) || !object(input)) throw failure()
  if (operation === 'connector.inventory' || operation === 'connector.configuration' || operation === 'connector.activation-state' || operation === 'connector.restore') {
    if (Object.keys(input).length !== 0) throw failure()
  } else if (operation === 'connector.activate') {
    if (Object.keys(input).sort().join(',') !== 'configurationVersion,enabled,entryId,expectedApprovalRevision,expectedRevision'
      || typeof input.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.entryId)
      || typeof input.configurationVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(input.configurationVersion)
      || typeof input.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedRevision) || typeof input.enabled !== 'boolean'
      || (input.enabled ? !Number.isSafeInteger(input.expectedApprovalRevision) || input.expectedApprovalRevision < 1 || input.expectedApprovalRevision > 2147483647 : input.expectedApprovalRevision !== null)) throw failure()
  } else if (operation === 'connector.release') {
    if (Object.keys(input).sort().join(',') !== 'entryId,expectedRevision'
      || typeof input.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.entryId)
      || typeof input.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedRevision)) throw failure()
  } else if (operation === 'connector.configure' || operation === 'connector.prepare') {
    if (!['upsert','remove'].includes(input.kind)
      || Object.keys(input).sort().join(',') !== (input.kind === 'upsert' ? 'configuration,entryId,expectedRevision,kind' : 'entryId,expectedRevision,kind')
      || typeof input.entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.entryId)
      || typeof input.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedRevision)
      || input.kind === 'upsert' && !object(input.configuration)) throw failure()
  } else if (operation === 'session.file') {
    if (Object.keys(input).sort().join(',') !== (input.version === undefined ? 'offset,path,sessionId' : 'offset,path,sessionId,version')
      || typeof input.sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.sessionId)
      || typeof input.path !== 'string' || !input.path || input.path.length > 4096 || /[\u0000-\u001f\u007f]/u.test(input.path)
      || input.path.split('/').some(part => part === '.' || part === '..')
      || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset % 65536 !== 0
      || input.version !== undefined && (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/u.test(input.version)) || input.offset !== 0 && input.version === undefined) throw failure()
  } else if (operation === 'session.directory') {
    if (Object.keys(input).some(key => !['sessionId', 'path'].includes(key))
      || typeof input.sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.sessionId)
      || input.path !== undefined && (typeof input.path !== 'string' || input.path.length > 4096 || input.path.includes('\0'))) throw failure()
  } else if (operation === 'session.creation') {
    if (Object.keys(input).length !== 0 && (Object.keys(input).join(',') !== 'sessionId'
      || typeof input.sessionId !== 'string' || !input.sessionId.length || input.sessionId.length > 200
      || input.sessionId.trim() !== input.sessionId || /[\u0000-\u001f\u007f]/u.test(input.sessionId))) throw failure()
  } else if (operation === 'session.approval') {
    if (Object.keys(input).sort().join(',') !== 'approvalId,sessionId'
      || typeof input.sessionId !== 'string' || !input.sessionId.length || input.sessionId.length > 200
      || input.sessionId.trim() !== input.sessionId || /[\u0000-\u001f\u007f]/u.test(input.sessionId)
      || typeof input.approvalId !== 'string' || !approvalIdPattern.test(input.approvalId)) throw failure()
  } else if (operation === 'session.events') {
    if (!['afterSeq,sessionId', 'afterDigest,afterSeq,sessionId'].includes(Object.keys(input).sort().join(','))
      || typeof input.sessionId !== 'string' || !input.sessionId.length || input.sessionId.length > 200
      || input.sessionId.trim() !== input.sessionId || /[\u0000-\u001f\u007f]/u.test(input.sessionId)
      || !Number.isSafeInteger(input.afterSeq) || input.afterSeq < -1
      || (input.afterSeq === -1 ? input.afterDigest !== undefined : !eventDigest(input.afterDigest))) throw failure()
  } else if (operation === 'session.turn-state') {
    if (!['sessionId', 'selection,sessionId'].includes(Object.keys(input).sort().join(','))
      || typeof input.sessionId !== 'string' || !input.sessionId.length || input.sessionId.length > 200
      || input.sessionId.trim() !== input.sessionId || /[\u0000-\u001f\u007f]/u.test(input.sessionId)) throw failure()
    if (Object.hasOwn(input, 'selection')) {
      const value = input.selection
      if (!object(value) || Object.keys(value).sort().join(',') !== 'commandId,contentDigest,expectedVersion'
        || typeof value.commandId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.commandId)
        || [value.contentDigest, value.expectedVersion].some(part => typeof part !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(part)
          || Buffer.from(part, 'base64url').toString('base64url') !== part)) throw failure()
    }
  } else if (operation === 'session.preset') {
    if (Object.keys(input).join(',') !== 'sessionId' || typeof input.sessionId !== 'string' || !input.sessionId.length
      || input.sessionId.length > 200 || input.sessionId.trim() !== input.sessionId || /[\u0000-\u001f\u007f]/u.test(input.sessionId)) throw failure()
  } else if (operation === 'feature.describe') {
    if (Object.keys(input).length !== 0) throw failure()
  } else if (operation === 'feature.plan' || operation === 'feature.apply') {
    const selected = operation === 'feature.plan' ? input : input.selection
    if (!object(selected) || Object.keys(selected).sort().join(',') !== 'enabled,expectedRevision,id'
      || typeof selected.id !== 'string' || !/^paimind:(?:pack|capability):[a-z][a-z0-9-]{0,79}$/u.test(selected.id)
      || typeof selected.enabled !== 'boolean' || !Number.isSafeInteger(selected.expectedRevision) || selected.expectedRevision < 0) throw failure()
    if (operation === 'feature.apply' && (Object.keys(input).sort().join(',') !== 'approvedPackIds,commandId,planDigest,requestDigest,selection'
      || typeof input.commandId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(input.commandId)
      || ['requestDigest', 'planDigest'].some(key => typeof input[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(input[key]))
      || !Array.isArray(input.approvedPackIds) || input.approvedPackIds.length > 128
      || new Set(input.approvedPackIds).size !== input.approvedPackIds.length
      || input.approvedPackIds.some(id => typeof id !== 'string' || !/^paimind:pack:[a-z][a-z0-9-]{0,79}$/u.test(id)))) throw failure()
    // Syntax and transport bounds only. The original owner validates exact
    // catalogue/impact and execution identity; the control plane must supply
    // currently authorized approval, never browser-claimed permissions.
  } else if (operation === 'publication.snapshot') {
    if (Object.keys(input).sort().join(',') !== 'expectedVersion,presetId'
      || typeof input.presetId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(input.presetId)
      || typeof input.expectedVersion !== 'string' || !input.expectedVersion.length || input.expectedVersion.length > 160) throw failure()
  } else if (operation === 'publication.receipt') {
    if (Object.keys(input).join(',') !== 'presetId' || typeof input.presetId !== 'string'
      || !/^paimind-enterprise-[a-f0-9]{32}$/u.test(input.presetId)) throw failure()
  } else if (operation === 'skill.export.begin') {
    if (Object.keys(input).sort().join(',') !== 'expectedDigest,skillId'
      || typeof input.skillId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,254}$/u.test(input.skillId)
      || typeof input.expectedDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(input.expectedDigest)) throw failure()
  } else if (operation === 'skill.export.read' || operation === 'skill.export.release') {
    if (Object.keys(input).sort().join(',') !== (operation === 'skill.export.read' ? 'exportId,offset' : 'exportId')
      || typeof input.exportId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(input.exportId)
      || operation === 'skill.export.read' && (!Number.isSafeInteger(input.offset) || input.offset < 0
        || input.offset >= 216 * 1024 * 1024 || input.offset % (96 * 1024) !== 0)) throw failure()
  } else if (operation === 'skill.adopt.begin' || operation === 'skill.adopt.receipt') {
    if (Object.keys(input).sort().join(',') !== 'archiveBytes,archiveDigest,entryCount,expandedBytes,name,packageDigest,publicationId,sourceUserId,tenantId') throw failure()
    // The original Skill owner applies the complete provenance/size schema
    // before any local access; no target path is accepted by this channel.
  } else if (operation.startsWith('skill.adopt.')) {
    if (Object.keys(input).sort().join(',') !== (operation === 'skill.adopt.write' ? 'data,importId,offset' : 'importId')
      || typeof input.importId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(input.importId)) throw failure()
    if (operation === 'skill.adopt.write' && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset >= 216 * 1024 * 1024
      || input.offset % (96 * 1024) !== 0 || typeof input.data !== 'string' || input.data.length < 4 || input.data.length > 131072)) throw failure()
  }
  // Adoption is validated by the original service's strict schema before any
  // native write. This transport never interprets content as a command/preset.
}

export function validateNativeConnectorRestoration(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'pending,restored'
    || !Array.isArray(value.pending) || !Array.isArray(value.restored)) throw failure()
  const ids = [...value.pending, ...value.restored]
  if (ids.length > 128 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id))) throw failure()
}

export function validateNativeSessionPresetReference(value, sessionId) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'agentPreset,hasForkBoundary,sessionId'
    || value.sessionId !== sessionId || typeof value.hasForkBoundary !== 'boolean'
    || value.agentPreset !== null && (typeof value.agentPreset !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(value.agentPreset))) throw failure()
}

export function validateNativeSessionCreationReference(value, sessionId) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'agentPreset,kind,sessionId'
    || value.sessionId !== (sessionId ?? null) || !['new', 'existing'].includes(value.kind)
    || value.kind === 'existing' && sessionId === undefined
    || value.agentPreset === null && value.kind !== 'existing'
    || value.agentPreset !== null && (typeof value.agentPreset !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(value.agentPreset))) throw failure()
}

export function validateNativeSessionTurnState(value, sessionId) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'accepted,pending,persisted,presetId,sessionId,version'
    || typeof value.pending !== 'boolean' || value.pending && value.accepted === null
    || typeof value.persisted !== 'boolean' || value.persisted && value.accepted === null
    || value.sessionId !== sessionId || typeof value.version !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.version)
    || Buffer.from(value.version, 'base64url').toString('base64url') !== value.version
    || value.presetId !== null && (typeof value.presetId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/u.test(value.presetId))) throw failure()
  if (value.accepted !== null && (!object(value.accepted) || Object.keys(value.accepted).sort().join(',') !== 'messageId,seq'
    || typeof value.accepted.messageId !== 'string' || !value.accepted.messageId.length || value.accepted.messageId.length > 200
    || !Number.isSafeInteger(value.accepted.seq) || value.accepted.seq < 0)) throw failure()
}

const eventDigest = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value)
  && Buffer.from(value, 'base64url').toString('base64url') === value
const approvalIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
export function validateNativeApprovalReference(value, sessionId, approvalId) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'answerable,approvalId,askedSeq,decidedSeq,outcome,persisted,rpcId,sessionId,toolName,version'
    || value.sessionId !== sessionId || value.approvalId !== approvalId || !eventDigest(value.version)
    || typeof value.toolName !== 'string' || !value.toolName || value.toolName.length > 200
    || !Number.isSafeInteger(value.askedSeq) || value.askedSeq < 0 || typeof value.answerable !== 'boolean'
    || value.decidedSeq !== null && (!Number.isSafeInteger(value.decidedSeq) || value.decidedSeq <= value.askedSeq)
    || value.outcome !== null && !['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(value.outcome)
    || (value.decidedSeq === null) !== (value.outcome === null)
    || value.rpcId !== null && (typeof value.rpcId !== 'string' || !value.rpcId || value.rpcId.length > 200)
    || value.answerable !== (value.rpcId !== null) || value.outcome !== null && value.answerable
    || typeof value.persisted !== 'boolean' || value.persisted && value.outcome === null) throw failure()
}
export function validateNativeSessionEventPage(value, sessionId, afterSeq) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'afterSeq,cursorMatched,events,hasMore,headSeq,sessionId'
    || value.sessionId !== sessionId || value.afterSeq !== afterSeq || !Number.isSafeInteger(value.headSeq) || value.headSeq < -1
    || typeof value.cursorMatched !== 'boolean' || typeof value.hasMore !== 'boolean' || !Array.isArray(value.events)
    || value.events.length > 128 || !value.cursorMatched && (value.events.length || value.hasMore)) throw failure()
  let previous = afterSeq
  const keys = { 'user.message': 'omittedBlocks,text', 'assistant.message': 'omittedBlocks,text',
    'turn.started': 'turn', 'turn.ended': 'reason,turn', 'step.started': 'step,turn', 'step.ended': 'step,turn',
    'tool.started': 'callId,name', 'tool.ended': 'callId,isError', 'queue.changed': '', 'session.checkpoint': '',
    'approval.required': 'approvalId,toolName,version', 'approval.decided': 'approvalId,outcome,toolName,version' }
  for (const event of value.events) {
    if (!object(event) || Object.keys(event).sort().join(',') !== 'data,digest,kind,seq,time' || event.seq !== previous + 1
      || event.seq > value.headSeq || typeof event.time !== 'number' || !Number.isFinite(event.time) || !eventDigest(event.digest)
      || !Object.hasOwn(keys, event.kind) || !object(event.data) || Object.keys(event.data).sort().join(',') !== keys[event.kind]) throw failure()
    const data = event.data
    if (event.kind.startsWith('approval.') && (typeof data.approvalId !== 'string' || !approvalIdPattern.test(data.approvalId)
      || !eventDigest(data.version) || typeof data.toolName !== 'string' || !data.toolName || data.toolName.length > 200
      || event.kind === 'approval.decided' && !['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(data.outcome))) throw failure()
    for (const name of ['turn', 'step']) if (Object.hasOwn(data, name) && (!Number.isSafeInteger(data[name]) || data[name] < 1)) throw failure()
    for (const name of ['name', 'callId']) if (Object.hasOwn(data, name) && (typeof data[name] !== 'string' || data[name].length > 200)) throw failure()
    if (Object.hasOwn(data, 'text') && (typeof data.text !== 'string' || !Number.isSafeInteger(data.omittedBlocks) || data.omittedBlocks < 0)
      || Object.hasOwn(data, 'isError') && typeof data.isError !== 'boolean'
      || Object.hasOwn(data, 'reason') && !['completed', 'blocked', 'aborted', 'interrupted', 'error', 'max-tokens', 'unknown'].includes(data.reason)) throw failure()
    previous = event.seq
  }
  if (value.cursorMatched && value.hasMore !== (previous < value.headSeq)
    || Buffer.byteLength(JSON.stringify(value)) > 132 * 1024) throw failure()
}

/** Bounded request/reply protocol over an already trusted local socket. No
 * identity, permission cache, credentials, Session records or retry loop. */
export function createNativeControlPeer(socket, { handle, checkOrigins, authorizeExecution, deriveOrigins, sealJobOrigins, readSkillEligibility, readConnectorApproval, authorizeConnectorExecution, onReady = () => {}, onClose = () => {}, timeoutMs = 4000 } = {}) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000)
  const responder = typeof handle === 'function', pending = new Map(), active = new Map()
  let ready = false, closed = false, buffered = Buffer.alloc(0), handshake
  const close = () => {
    if (closed) return
    closed = true; ready = false; clearTimeout(handshake); socket.destroy()
    for (const request of pending.values()) request.finish(failure())
    for (const controller of active.values()) controller.abort()
    active.clear(); onClose()
  }
  const send = value => {
    if (closed) throw failure()
    const frame = Buffer.from(JSON.stringify({ protocol, ...value }) + '\n')
    if (frame.length > NATIVE_CONTROL_LIMIT || socket.writableLength + frame.length > NATIVE_CONTROL_LIMIT * 2) throw failure()
    socket.write(frame, error => { if (error) close() })
  }
  const receive = frame => {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame))
    if (!object(value) || value.protocol !== protocol) throw failure()
    if (!responder && value.kind === 'ready') {
      if (ready || Object.keys(value).length !== 2) throw failure()
      ready = true; clearTimeout(handshake); onReady(); return
    }
    if (typeof value.id !== 'string' || !identifier.test(value.id)) throw failure()
    const reverse = ['origin-request', 'origin-reply', 'origin-cancel'].includes(value.kind)
    const responding = reverse ? !responder : responder
    if (!responding) {
      if (!ready || value.kind !== (reverse ? 'origin-reply' : 'reply') || typeof value.ok !== 'boolean'
        || Object.keys(value).sort().join(',') !== (value.ok ? 'id,kind,ok,protocol,value' : 'id,kind,ok,protocol')) throw failure()
      // A canceled/deadline-expired request may already have a reply in flight.
      // It cannot authorize anything else because IDs are never reused.
      pending.get(value.id)?.finish(value.ok ? undefined : Object.assign(failure(), { code: 'NATIVE_CONTROL_REJECTED' }), value.value)
      return
    }
    if (!ready) throw failure()
    if (value.kind === (reverse ? 'origin-cancel' : 'cancel') && Object.keys(value).length === 3) { active.get(value.id)?.abort(); return }
    if (value.kind !== (reverse ? 'origin-request' : 'request') || Object.keys(value).sort().join(',') !== 'id,input,kind,operation,protocol'
      || active.has(value.id)) throw failure()
    if (reverse) validateReverseInput(value.operation, value.input)
    else validateNativeControlInput(value.operation, value.input)
    const replyKind = reverse ? 'origin-reply' : 'reply'
    // A canceled atomic owner write may still be draining. Keep its slot until
    // it joins; reject new work without treating honest overload as a broken
    // protocol and terminating the whole native runtime.
    if (active.size >= 16) { send({ kind: replyKind, id: value.id, ok: false }); return }
    const controller = new AbortController(); active.set(value.id, controller)
    const deadline = setTimeout(() => controller.abort(), timeoutMs); deadline.unref()
    Promise.resolve().then(async () => {
      controller.signal.throwIfAborted()
      if (!reverse) return handle(value.operation, value.input, controller.signal)
      if (value.operation === 'connector.approval') {
        if (typeof readConnectorApproval !== 'function') throw failure()
        const result = { approvalRevision: await readConnectorApproval(value.input, controller.signal), executionAuthorized: false }
        validateConnectorApprovalResult(result, value.input)
        return result
      }
      if (value.operation === 'connector.authorize') {
        if (typeof authorizeConnectorExecution !== 'function') throw failure()
        await authorizeConnectorExecution(value.input, controller.signal)
        return { executionAuthorized: true }
      }
      if (value.operation === 'skill.eligibility') {
        if (typeof readSkillEligibility !== 'function') throw failure()
        const result = { eligiblePublicationIds: await readSkillEligibility(value.input, controller.signal), executionAuthorized: false }
        validateSkillEligibility(result, value.input)
        return result
      }
      if (value.operation === 'runtime.job-origin') {
        if (typeof sealJobOrigins !== 'function') throw failure()
        const result = await sealJobOrigins(value.input, controller.signal)
        validateJobOrigins(result, value.input)
        return result
      }
      if (value.operation === 'runtime.delegate') {
        if (typeof deriveOrigins !== 'function') throw failure()
        const result = await deriveOrigins(value.input, controller.signal)
        validateDelegatedOrigins(result, value.input)
        return result // Signed associations only, not a cached execution grant.
      }
      if (value.operation === 'runtime.authorize') {
        if (typeof authorizeExecution !== 'function') throw failure()
        await authorizeExecution(value.input, controller.signal)
        return { executionAuthorized: true } // This check only; never cached.
      }
      if (typeof checkOrigins !== 'function') throw failure()
      await checkOrigins(value.input, controller.signal)
      return { originsVerified: true } // Not a resource, model or tool grant.
    })
      .then(result => { if (!closed && !controller.signal.aborted) send({ kind: replyKind, id: value.id, ok: true, value: result }) },
        () => { if (!closed && !controller.signal.aborted) send({ kind: replyKind, id: value.id, ok: false }) })
      .catch(close).finally(() => { clearTimeout(deadline); active.delete(value.id) })
  }
  socket.on('data', chunk => {
    try {
      let offset = 0
      while (offset < chunk.length && !closed) {
        const end = chunk.indexOf(10, offset), stop = end < 0 ? chunk.length : end + 1
        if (buffered.length + stop - offset > NATIVE_CONTROL_LIMIT) throw failure()
        buffered = Buffer.concat([buffered, chunk.subarray(offset, stop)])
        if (end >= 0) { const frame = buffered.subarray(0, -1); buffered = Buffer.alloc(0); receive(frame) }
        offset = stop
      }
    } catch { close() }
  })
  socket.on('error', close); socket.once('close', close); socket.once('end', close)
  handshake = setTimeout(close, timeoutMs); handshake.unref()
  const announce = () => { try { send({ kind: 'ready' }); ready = true; clearTimeout(handshake); onReady() } catch { close() } }
  if (responder) { if (socket.connecting) socket.once('connect', announce); else announce() }
  const request = (operation, input, signal, reverse = false) => {
      return new Promise((resolve, reject) => {
        if (responder !== reverse || !ready || closed || pending.size >= 16 || signal?.aborted) { reject(failure()); return }
        try { if (reverse) validateReverseInput(operation, input); else validateNativeControlInput(operation, input) } catch { reject(failure()); return }
        const id = randomBytes(16).toString('hex')
        let timer
        const finish = (error, value) => {
          if (!pending.delete(id)) return
          clearTimeout(timer); signal?.removeEventListener('abort', abort)
          if (error) reject(error); else resolve(value)
        }
        const abort = () => { try { send({ kind: reverse ? 'origin-cancel' : 'cancel', id }) } catch { close() }; finish(failure()) }
        pending.set(id, { finish })
        signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(abort, timeoutMs)
        try { send({ kind: reverse ? 'origin-request' : 'request', id, operation, input }) } catch { finish(failure()); close() }
      })
  }
  return {
    get ready() { return ready && !closed }, close,
    request: (operation, input, signal) => request(operation, input, signal),
    async checkOrigins(input, signal) {
      const value = await request('identity.origins', input, signal, true)
      if (!object(value) || Object.keys(value).join(',') !== 'originsVerified' || value.originsVerified !== true) throw failure()
    },
    async authorizeExecution(input, signal) {
      const value = await request('runtime.authorize', input, signal, true)
      if (!object(value) || Object.keys(value).join(',') !== 'executionAuthorized' || value.executionAuthorized !== true) throw failure()
    },
    async readSkillEligibility(input, signal) {
      const selected = structuredClone(input)
      const value = await request('skill.eligibility', selected, signal, true)
      validateSkillEligibility(value, selected)
      return Object.freeze([...value.eligiblePublicationIds].sort())
    },
    async readConnectorApproval(input, signal) {
      const selected = structuredClone(input)
      const value = await request('connector.approval', selected, signal, true)
      validateConnectorApprovalResult(value, selected)
      return value.approvalRevision
    },
    async authorizeConnectorExecution(input, signal) {
      const selected = structuredClone(input)
      const value = await request('connector.authorize', selected, signal, true)
      if (!object(value) || Object.keys(value).join(',') !== 'executionAuthorized' || value.executionAuthorized !== true) throw failure()
    },
    async deriveOrigins(input, signal) {
      const selected = structuredClone(input)
      const value = await request('runtime.delegate', selected, signal, true)
      validateDelegatedOrigins(value, selected)
      return value
    },
    async sealJobOrigins(input, signal) {
      const selected = structuredClone(input)
      const value = await request('runtime.job-origin', selected, signal, true)
      validateJobOrigins(value, selected)
      return value
    },
  }
}

/** Launcher-owned directory is mounted into the trusted native namespace only.
 * The outer transport key/private volume never crosses this boundary. */
export async function createNativeControlBroker(parent = '/tmp', checkOrigins, authorizeExecution, deriveOrigins, sealJobOrigins, readSkillEligibility, readConnectorApproval, authorizeConnectorExecution) {
  const directory = await mkdtemp(join(parent, 'paimind-native-control-'))
  await chmod(directory, 0o700)
  const path = join(directory, 'control.sock')
  let peer, closing
  const server = createServer(socket => {
    if (peer || closing) { socket.destroy(); return }
    peer = createNativeControlPeer(socket, { checkOrigins, authorizeExecution, deriveOrigins, sealJobOrigins, readSkillEligibility, readConnectorApproval, authorizeConnectorExecution, onClose: () => { peer = undefined } })
  })
  server.maxConnections = 1
  server.on('error', () => { peer?.close() })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); resolve() }) })
    await chmod(path, 0o600)
  } catch (error) { server.close(); await rmdir(directory).catch(() => {}); throw error }
  return { directory, path,
    get ready() { return peer?.ready === true },
    request(operation, input, signal) { return peer?.ready ? peer.request(operation, input, signal) : Promise.reject(failure()) },
    close() {
      closing ??= (async () => { peer?.close(); await new Promise(resolve => server.close(resolve)); await rmdir(directory) })()
      return closing
    },
  }
}

export async function connectNativeControl(path, context, onClose = () => {}) {
  assert.equal(process.platform, 'linux')
  assert.equal(path, NATIVE_CONTROL_SOCKET)
  const directory = '/run/paimind-native-control', parent = await lstat(directory)
  assert.ok(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o777) === 0o700)
  assert.equal(await realpath(directory), directory)
  const mounts = (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line => line.split(' '))
    .filter(fields => fields[4] === directory)
  assert.ok(mounts.length === 1 && mounts[0][5].split(',').includes('ro'), 'Private native control must be its own read-only mount')
  const stat = await lstat(path)
  assert.ok(stat.isSocket() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0)
  assert.equal(await realpath(path), path)
  const socket = createConnection(path)
  return await new Promise((resolve, reject) => {
    let peer, settled = false
    const timer = setTimeout(() => { socket.destroy(); reject(failure()) }, 4000)
    peer = createNativeControlPeer(socket, {
      onReady: () => { settled = true; clearTimeout(timer); resolve(peer) },
      onClose: () => { clearTimeout(timer); if (!settled) reject(failure()); onClose() },
      handle: (operation, input, signal) => handleNativeControl(context, operation, input, signal),
    })
  })
}
