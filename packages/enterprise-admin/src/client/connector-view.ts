/** Browser metadata only. No configuration, secret or native access grant. */
export interface ConnectorEntry { entryId: string; serverName: string; transport: 'stdio' | 'streamable-http'; enabled: false }
export interface ConnectorConfiguration { schema: 'paimind.connector-configuration/v1'; revision: string; activation: 'not-authorized'; entries: ConnectorEntry[] }
export interface ConnectorSnapshot { targetUserId: string; cellRevision: string; configuration: ConnectorConfiguration; activation: 'not-authorized' }
export interface ConnectorActivationSnapshot {
  targetUserId: string; cellRevision: string; observation: 'native-lifecycle-only'; runtimeGrant: false
  lifecycle: { schema: 'paimind.connector-observation/v1'; revision: string; entries: Array<{
    entryId: string; configurationVersion: string | null; serverName: string; transport: 'stdio' | 'streamable-http';
    enabled: boolean; authority: 'live' | 'absent'; phase: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | null; connection: 'not-probed'
  }> }
}
export interface ConnectorIntent { targetUserId: string; expectedCellRevision: string; expectedConfigurationRevision: string; change: { kind: 'upsert' | 'remove'; entryId: string }; reason: string; confirmed: true }
export interface ConnectorCommand { commandId: string; targetUserId: string; outcome: 'saved-disabled' | 'unchanged' | 'conflict' | 'unconfirmed' | 'superseded'; intent: ConnectorIntent }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const revision = /^[a-f0-9]{64}$/u, identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u
const failure = (): never => { throw Error('连接器响应与当前成员或配置契约不匹配，未展示旧数据') }
function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) return failure()
  return value as Record<string, unknown>
}
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value)
function configurationView(value: unknown): ConnectorConfiguration {
  const row = shape(value, ['schema','revision','activation','entries'])
  if (row.schema !== 'paimind.connector-configuration/v1' || !matches(row.revision, revision) || row.activation !== 'not-authorized' || !Array.isArray(row.entries) || row.entries.length > 128) return failure()
  const ids = new Set(), names = new Set()
  const entries = row.entries.map(value => {
    const entry = shape(value, ['entryId','serverName','transport','enabled'])
    if (!matches(entry.entryId, identifier) || !matches(entry.serverName, /^[A-Za-z0-9_-]{1,32}$/u) || ids.has(entry.entryId) || names.has(entry.serverName)
      || !['stdio','streamable-http'].includes(String(entry.transport)) || entry.enabled !== false) return failure()
    ids.add(entry.entryId); names.add(entry.serverName)
    return { entryId: entry.entryId, serverName: entry.serverName, transport: entry.transport as ConnectorEntry['transport'], enabled: false as const }
  })
  return { schema: 'paimind.connector-configuration/v1', revision: row.revision, activation: 'not-authorized', entries }
}
export function connectorSnapshot(value: unknown, target: string): ConnectorSnapshot {
  const row = shape(value, ['targetUserId','cellRevision','configuration','activation'])
  if (row.targetUserId !== target || !matches(row.cellRevision, uuid) || row.activation !== 'not-authorized') return failure()
  return { targetUserId: target, cellRevision: row.cellRevision, configuration: configurationView(row.configuration), activation: 'not-authorized' }
}
export function connectorActivationSnapshot(value: unknown, target: string): ConnectorActivationSnapshot {
  const row = shape(value, ['targetUserId','cellRevision','lifecycle','observation','runtimeGrant'])
  const lifecycle = shape(row.lifecycle, ['schema','revision','entries'])
  if (row.targetUserId !== target || !matches(row.cellRevision, uuid) || row.observation !== 'native-lifecycle-only' || row.runtimeGrant !== false
    || lifecycle.schema !== 'paimind.connector-observation/v1' || !matches(lifecycle.revision, revision) || !Array.isArray(lifecycle.entries) || lifecycle.entries.length > 128) return failure()
  const ids = new Set(), names = new Set()
  const entries = lifecycle.entries.map(value => {
    const entry = shape(value, ['entryId','configurationVersion','serverName','transport','enabled','authority','phase','connection'])
    if (!matches(entry.entryId, identifier) || !matches(entry.serverName, /^[A-Za-z0-9_-]{1,32}$/u) || ids.has(entry.entryId) || names.has(entry.serverName)
      || entry.configurationVersion !== null && !matches(entry.configurationVersion, revision) || !['stdio','streamable-http'].includes(String(entry.transport))
      || typeof entry.enabled !== 'boolean' || !['live','absent'].includes(String(entry.authority)) || ![null,'pending','loading','active','failed','disposed','unloading'].includes(entry.phase as string | null)
      || entry.connection !== 'not-probed' || entry.enabled && entry.configurationVersion === null || !entry.enabled && entry.authority !== 'absent') return failure()
    ids.add(entry.entryId); names.add(entry.serverName)
    return { entryId: entry.entryId, configurationVersion: entry.configurationVersion as string | null, serverName: entry.serverName,
      transport: entry.transport as ConnectorEntry['transport'], enabled: entry.enabled, authority: entry.authority as 'live' | 'absent',
      phase: entry.phase as ConnectorActivationSnapshot['lifecycle']['entries'][number]['phase'], connection: 'not-probed' as const }
  })
  return { targetUserId: target, cellRevision: row.cellRevision, observation: 'native-lifecycle-only', runtimeGrant: false,
    lifecycle: { schema: 'paimind.connector-observation/v1', revision: lifecycle.revision, entries } }
}
export function connectorCommand(value: unknown, target: string): ConnectorCommand {
  const row = shape(value, ['commandId','targetUserId','outcome','intent','confirmation','historicalReceipt','runtimeGrant'])
  const intent = shape(row.intent, ['targetUserId','expectedCellRevision','expectedConfigurationRevision','change','reason','confirmed']), change = shape(intent.change, ['kind','entryId'])
  if (!matches(row.commandId, uuid) || row.targetUserId !== target || intent.targetUserId !== target || row.historicalReceipt !== true || row.runtimeGrant !== false
    || !['saved-disabled','unchanged','conflict','unconfirmed','superseded'].includes(String(row.outcome)) || !matches(intent.expectedCellRevision, uuid)
    || !matches(intent.expectedConfigurationRevision, revision) || !['upsert','remove'].includes(String(change.kind)) || !matches(change.entryId, identifier)
    || typeof intent.reason !== 'string' || intent.reason.length < 3 || intent.reason.length > 500 || intent.confirmed !== true) return failure()
  if (row.outcome === 'unconfirmed') { if (row.confirmation !== null) return failure() }
  else {
    const confirmation = shape(row.confirmation, row.outcome === 'superseded' ? ['commandId','outcome','effect','cellRevision','configuration','reason'] : ['commandId','outcome','configuration','activation'])
    if (confirmation.commandId !== row.commandId || confirmation.outcome !== row.outcome) return failure()
    configurationView(confirmation.configuration)
    if (row.outcome === 'superseded') {
      if (confirmation.effect !== 'unknown' || !matches(confirmation.cellRevision, uuid) || typeof confirmation.reason !== 'string' || confirmation.reason.length < 3 || confirmation.reason.length > 500) return failure()
    } else if (confirmation.activation !== 'not-authorized') return failure()
  }
  return { commandId: row.commandId, targetUserId: target, outcome: row.outcome as ConnectorCommand['outcome'], intent: {
    targetUserId: target, expectedCellRevision: intent.expectedCellRevision, expectedConfigurationRevision: intent.expectedConfigurationRevision,
    change: { kind: change.kind as 'upsert' | 'remove', entryId: change.entryId }, reason: intent.reason, confirmed: true } }
}
export function connectorCommandState(value: unknown, target: string): ConnectorCommand | null {
  const row = shape(value, ['targetUserId','command'])
  if (row.targetUserId !== target) return failure()
  return row.command === null ? null : connectorCommand(row.command, target)
}
export function matchesConnectorIntent(a: ConnectorIntent, b: ConnectorIntent): boolean {
  return a.targetUserId === b.targetUserId && a.expectedCellRevision === b.expectedCellRevision && a.expectedConfigurationRevision === b.expectedConfigurationRevision
    && a.change.kind === b.change.kind && a.change.entryId === b.change.entryId && a.reason === b.reason && a.confirmed === b.confirmed
}

export interface ConnectorApproval {
  targetUserId: string; entryId: string; configurationVersion: string; serverName: string; transport: ConnectorEntry['transport']
  imageId: string; policyDigest: string; decision: 'approved' | 'revoked'; revision: number; reason: string; updatedBy: string
  historicalRecord: true; runtimeGrant: false; activation: 'not-observed'
}
export interface ConnectorActivationIntent {
  targetUserId: string; expectedCellRevision: string; expectedConfigurationRevision: string; entryId: string; configurationVersion: string
  enabled: boolean; expectedApprovalRevision: number | null; reason: string; confirmed: true
}
export interface ConnectorActivationCommand {
  commandId: string; targetUserId: string; outcome: 'unconfirmed' | 'enabled' | 'disabled' | 'conflict' | 'superseded'; intent: ConnectorActivationIntent
  resolvedCellRevision?: string
}
const validReason = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length >= 3 && value.length <= 500
const positiveRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
export function connectorApproval(value: unknown, target: string, entryId: string): ConnectorApproval {
  const row = shape(value, ['targetUserId','entryId','configurationVersion','serverName','transport','imageId','policyDigest','decision','revision','reason','updatedBy','historicalRecord','runtimeGrant','activation'])
  if (row.targetUserId !== target || row.entryId !== entryId || !matches(entryId, identifier) || !matches(row.configurationVersion, revision)
    || !matches(row.serverName, /^[A-Za-z0-9_-]{1,32}$/u) || !['stdio','streamable-http'].includes(String(row.transport))
    || !matches(row.imageId, /^sha256:[a-f0-9]{64}$/u) || !matches(row.policyDigest, /^sha256:[a-f0-9]{64}$/u)
    || !['approved','revoked'].includes(String(row.decision)) || !positiveRevision(row.revision) || !validReason(row.reason) || !matches(row.updatedBy, uuid)
    || row.historicalRecord !== true || row.runtimeGrant !== false || row.activation !== 'not-observed') return failure()
  return row as unknown as ConnectorApproval
}
export function connectorApprovalState(value: unknown, target: string, entryId: string): ConnectorApproval | null {
  const row = shape(value, ['targetUserId','entryId','approval','observation'])
  if (row.targetUserId !== target || row.entryId !== entryId || row.observation !== 'stored-only') return failure()
  return row.approval === null ? null : connectorApproval(row.approval, target, entryId)
}
export function connectorActivationCommand(value: unknown, target: string): ConnectorActivationCommand {
  const row = shape(value, ['commandId','targetUserId','outcome','intent','confirmation','historicalReceipt','runtimeGrant'])
  const intent = shape(row.intent, ['targetUserId','expectedCellRevision','expectedConfigurationRevision','entryId','configurationVersion','enabled','expectedApprovalRevision','reason','confirmed'])
  if (!matches(row.commandId, uuid) || row.targetUserId !== target || intent.targetUserId !== target || row.historicalReceipt !== true || row.runtimeGrant !== false
    || !['unconfirmed','enabled','disabled','conflict','superseded'].includes(String(row.outcome)) || !matches(intent.expectedCellRevision, uuid)
    || !matches(intent.expectedConfigurationRevision, revision) || !matches(intent.entryId, identifier) || !matches(intent.configurationVersion, revision)
    || typeof intent.enabled !== 'boolean' || (intent.enabled ? !positiveRevision(intent.expectedApprovalRevision) : intent.expectedApprovalRevision !== null)
    || !validReason(intent.reason) || intent.confirmed !== true || row.outcome === 'enabled' && !intent.enabled || row.outcome === 'disabled' && intent.enabled) return failure()
  let resolvedCellRevision: string | undefined
  if (row.outcome === 'unconfirmed') { if (row.confirmation !== null) return failure() }
  else {
    const confirmation = shape(row.confirmation, row.outcome === 'superseded' ? ['commandId','outcome','effect','cellRevision','lifecycle','reason'] : ['commandId','outcome','lifecycle','observation'])
    if (confirmation.commandId !== row.commandId || confirmation.outcome !== row.outcome) return failure()
    if (row.outcome === 'superseded') {
      if (confirmation.effect !== 'unknown' || !matches(confirmation.cellRevision, uuid) || confirmation.cellRevision === intent.expectedCellRevision || !validReason(confirmation.reason)) return failure()
      resolvedCellRevision = confirmation.cellRevision
    } else if (confirmation.observation !== 'native-lifecycle-only') return failure()
    const view = connectorActivationSnapshot({ targetUserId: target, cellRevision: resolvedCellRevision ?? intent.expectedCellRevision,
      lifecycle: confirmation.lifecycle, observation: 'native-lifecycle-only', runtimeGrant: false }, target)
    if (row.outcome === 'enabled' || row.outcome === 'disabled') {
      const entry = view.lifecycle.entries.find(entry => entry.entryId === intent.entryId)
      if (!entry || entry.configurationVersion !== intent.configurationVersion || entry.enabled !== intent.enabled) return failure()
    }
  }
  return { commandId: row.commandId, targetUserId: target, outcome: row.outcome as ConnectorActivationCommand['outcome'], intent: intent as unknown as ConnectorActivationIntent,
    ...(resolvedCellRevision ? { resolvedCellRevision } : {}) }
}
export function connectorActivationCommandState(value: unknown, target: string): ConnectorActivationCommand | null {
  const row = shape(value, ['targetUserId','command'])
  if (row.targetUserId !== target) return failure()
  return row.command === null ? null : connectorActivationCommand(row.command, target)
}
export function matchesConnectorActivationIntent(a: ConnectorActivationIntent, b: ConnectorActivationIntent): boolean {
  return a.targetUserId === b.targetUserId && a.expectedCellRevision === b.expectedCellRevision && a.expectedConfigurationRevision === b.expectedConfigurationRevision
    && a.entryId === b.entryId && a.configurationVersion === b.configurationVersion && a.enabled === b.enabled && a.expectedApprovalRevision === b.expectedApprovalRevision
    && a.reason === b.reason && a.confirmed === b.confirmed
}
