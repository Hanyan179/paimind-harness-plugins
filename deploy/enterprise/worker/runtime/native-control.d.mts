import type { Duplex } from 'node:stream'
export interface NativeOriginInput { nativeSessionId: string; sources: string[] }
export interface NativeSkillPublicationReference {
  readonly tenantId: string; readonly publicationId: string; readonly sourceUserId: string; readonly name: string;
  readonly packageDigest: string; readonly archiveDigest: string; readonly archiveBytes: number;
  readonly expandedBytes: number; readonly entryCount: number
}
export interface NativeExecutionInput extends NativeOriginInput {
  presetId: string
  publication: null | { tenantId: string; publicationId: string; sourceUserId: string; contentDigest: string }
  skills: readonly NativeSkillPublicationReference[]
}
export interface NativeDelegationInput extends NativeExecutionInput { targetSessionId: string }
export interface NativeJobOriginInput extends NativeExecutionInput { nativeJobId: string }
export interface NativeControlPeer {
  readonly ready: boolean
  close(): void
  request(operation: string, input: object, signal?: AbortSignal): Promise<unknown>
  checkOrigins(input: NativeOriginInput, signal?: AbortSignal): Promise<void>
  authorizeExecution(input: NativeExecutionInput, signal?: AbortSignal): Promise<void>
  readSkillEligibility(input: readonly NativeSkillPublicationReference[], signal?: AbortSignal): Promise<readonly string[]>
  readConnectorApproval(input: NativeConnectorApprovalInput, signal?: AbortSignal): Promise<number>
  authorizeConnectorExecution(input: NativeConnectorExecutionInput, signal?: AbortSignal): Promise<void>
  deriveOrigins(input: NativeDelegationInput, signal?: AbortSignal): Promise<NativeOriginInput>
  sealJobOrigins(input: NativeJobOriginInput, signal?: AbortSignal): Promise<NativeOriginInput>
}
export const NATIVE_ORIGIN_PATH: string
export const NATIVE_CONTROL_PATH: string
export const NATIVE_CONTROL_SOCKET: string
export const NATIVE_CONTROL_LIMIT: number
export function validateNativeControlInput(operation: string, input: unknown): void
export interface NativeConnectorInventory {
  schema: 'paimind.native-connectors/v1'; scope: 'loader-tree'; connection: 'not-probed'
  entries: Array<{ entryId: string; serverName: string | null; transport: 'stdio' | 'streamable-http' | null;
    enabled: boolean; phase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disposed' | null;
    configuration: 'recognized' | 'unresolved' }>
}
export function validateConnectorInventory(value: unknown): asserts value is NativeConnectorInventory
export interface NativeConnectorConfiguration {
  schema: 'paimind.connector-configuration/v1'; revision: string; activation: 'not-authorized'
  entries: Array<{ entryId: string; serverName: string; transport: 'stdio' | 'streamable-http'; enabled: false }>
}
export function validateConnectorConfiguration(value: unknown): asserts value is NativeConnectorConfiguration
export interface NativeConnectorActivationState {
  schema: 'paimind.connector-observation/v1'; revision: string
  entries: Array<{ entryId: string; configurationVersion: string | null; serverName: string; transport: 'stdio' | 'streamable-http';
    enabled: boolean; authority: 'live' | 'absent'; phase: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | null; connection: 'not-probed' }>
}
export function validateConnectorActivationState(value: unknown): asserts value is NativeConnectorActivationState
export interface NativeConnectorReleaseReference {
  entryId: string; configurationVersion: string; serverName: string; transport: 'stdio' | 'streamable-http'
}
export interface NativeConnectorApprovalInput { reference: NativeConnectorReleaseReference; expectedApprovalRevision: number | null }
export interface NativeConnectorExecutionInput { reference: NativeConnectorReleaseReference; approvalRevision: number; execution: NativeExecutionInput }
export function validateNativeConnectorReference(input: unknown): asserts input is NativeConnectorReleaseReference
export function validateNativeConnectorApprovalInput(input: unknown): asserts input is NativeConnectorApprovalInput
export function validateNativeConnectorExecutionInput(input: unknown): asserts input is NativeConnectorExecutionInput
export function validateNativeConnectorRestoration(input: unknown): asserts input is { restored: string[]; pending: string[] }
export type NativeConnectorRelease = { outcome: 'current'; revision: string; reference: NativeConnectorReleaseReference }
  | { outcome: 'conflict' | 'missing' | 'unversioned'; revision: string; reference: null }
export function validateConnectorRelease(value: unknown): asserts value is NativeConnectorRelease
export interface NativeSessionPresetReference {
  sessionId: string
  agentPreset: string | null
  hasForkBoundary: boolean
}
export function validateNativeSessionPresetReference(value: unknown, sessionId: string): asserts value is NativeSessionPresetReference
export interface NativeSessionCreationReference { sessionId: string | null; kind: 'new' | 'existing'; agentPreset: string | null }
export function validateNativeSessionCreationReference(value: unknown, sessionId?: string): asserts value is NativeSessionCreationReference
export interface NativeSessionTurnState {
  sessionId: string; presetId: string | null; version: string; persisted: boolean; pending: boolean; accepted: { messageId: string; seq: number } | null
}
export function validateNativeSessionTurnState(value: unknown, sessionId: string): asserts value is NativeSessionTurnState
export interface NativeSessionEventPage {
  sessionId: string; afterSeq: number; headSeq: number; hasMore: boolean; cursorMatched: boolean
  events: Array<{ seq: number; time: number; digest: string; kind: string; data: Record<string, string | number | boolean> }>
}
export function validateNativeSessionEventPage(value: unknown, sessionId: string, afterSeq: number): asserts value is NativeSessionEventPage
export interface NativeApprovalReference {
  sessionId: string; approvalId: string; version: string; toolName: string; askedSeq: number; decidedSeq: number | null
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' | null; answerable: boolean; rpcId: string | null; persisted: boolean
}
export function validateNativeApprovalReference(value: unknown, sessionId: string, approvalId: string): asserts value is NativeApprovalReference
export interface NativeFileChunk { path: string; offset: number; size: number; version: string; data: string; nextOffset: number | null }
export function validateNativeFileChunk(value: unknown): asserts value is NativeFileChunk
export function handleNativeControl(context: { get(name: string): unknown }, operation: string, input: object, signal: AbortSignal): Promise<unknown>
export function validateNativeOriginInput(input: unknown): asserts input is NativeOriginInput
export function validateNativeExecutionInput(input: unknown): asserts input is NativeExecutionInput
export function validateNativeSkillReferences(input: unknown): asserts input is readonly NativeSkillPublicationReference[]
export function validateNativeSkillIds(input: unknown): asserts input is readonly string[]
export function validateNativeDelegationInput(input: unknown): asserts input is NativeDelegationInput
export function validateNativeJobOriginInput(input: unknown): asserts input is NativeJobOriginInput
export function authorizeNativeExecution(context: unknown, peer: Pick<NativeControlPeer, 'ready' | 'authorizeExecution'>,
  input: { nativeSessionId: string; presetId: string; sources: readonly string[]; requirements?: readonly string[]; skillSelection?: 'captured' }, signal: AbortSignal): Promise<readonly string[]>
export function authorizeNativeConnectorUse(context: unknown, peer: Pick<NativeControlPeer, 'ready' | 'authorizeConnectorExecution'>,
  input: { nativeSessionId: string; presetId: string; sources: readonly string[]; requirements?: readonly string[]; skillSelection?: 'captured' },
  reference: NativeConnectorReleaseReference, approvalRevision: number, signal: AbortSignal): Promise<void>
export function deriveNativeOrigins(context: unknown, peer: Pick<NativeControlPeer, 'ready' | 'deriveOrigins'>,
  input: { nativeSessionId: string; presetId: string; sources: readonly string[]; requirements?: readonly string[]; targetSessionId: string }, signal: AbortSignal): Promise<NativeOriginInput>
export function sealNativeJobOrigins(context: unknown, peer: Pick<NativeControlPeer, 'ready' | 'sealJobOrigins'>,
  input: { nativeSessionId: string; presetId: string; sources: readonly string[]; requirements?: readonly string[]; skillSelection?: 'captured'; nativeJobId: string }, signal: AbortSignal): Promise<NativeOriginInput>
export function createNativeControlPeer(socket: Duplex, options?: {
  handle?: (operation: string, input: object, signal: AbortSignal) => Promise<unknown>
  checkOrigins?: (input: NativeOriginInput, signal: AbortSignal) => Promise<void>
  authorizeExecution?: (input: NativeExecutionInput, signal: AbortSignal) => Promise<void>
  deriveOrigins?: (input: NativeDelegationInput, signal: AbortSignal) => Promise<NativeOriginInput>
  sealJobOrigins?: (input: NativeJobOriginInput, signal: AbortSignal) => Promise<NativeOriginInput>
  readSkillEligibility?: (input: readonly NativeSkillPublicationReference[], signal: AbortSignal) => Promise<readonly string[]>
  readConnectorApproval?: (input: NativeConnectorApprovalInput, signal: AbortSignal) => Promise<number>
  authorizeConnectorExecution?: (input: NativeConnectorExecutionInput, signal: AbortSignal) => Promise<void>
  onReady?: () => void
  onClose?: () => void
  timeoutMs?: number
}): NativeControlPeer
export function createNativeControlBroker(parent?: string,
  checkOrigins?: (input: NativeOriginInput, signal: AbortSignal) => Promise<void>,
  authorizeExecution?: (input: NativeExecutionInput, signal: AbortSignal) => Promise<void>,
  deriveOrigins?: (input: NativeDelegationInput, signal: AbortSignal) => Promise<NativeOriginInput>,
  sealJobOrigins?: (input: NativeJobOriginInput, signal: AbortSignal) => Promise<NativeOriginInput>,
  readSkillEligibility?: (input: readonly NativeSkillPublicationReference[], signal: AbortSignal) => Promise<readonly string[]>,
  readConnectorApproval?: (input: NativeConnectorApprovalInput, signal: AbortSignal) => Promise<number>,
  authorizeConnectorExecution?: (input: NativeConnectorExecutionInput, signal: AbortSignal) => Promise<void>): Promise<{
    readonly directory: string
    readonly path: string
    readonly ready: boolean
    request(operation: string, input: object, signal?: AbortSignal): Promise<unknown>
    close(): Promise<void>
  }>
export function connectNativeControl(path: string, context: unknown, onClose?: () => void): Promise<NativeControlPeer>
