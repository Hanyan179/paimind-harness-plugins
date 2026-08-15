/** Stable PAIMind product capabilities. Harness Sandbox and Approval are separate owners. */
export const PAIMIND_CAPABILITIES = Object.freeze([
  'conversation.use',
  'workspace.use',
  'market.view',
  'agent.manage-own',
  'schedule.manage-own',
  'developer-resources.view',
  'administration.manage',
] as const)

export type PaimindCapability = typeof PAIMIND_CAPABILITIES[number]

export const PAIMIND_RESOURCE_KINDS = Object.freeze([
  'workspace', 'session', 'agent-preset', 'skill', 'schedule', 'artifact', 'extension', 'administration',
] as const)

export type PaimindResourceKind = typeof PAIMIND_RESOURCE_KINDS[number]

/** Authenticated identity asserted by one trusted server-composed provider. */
export interface PaimindPrincipal {
  readonly issuer: string
  readonly subject: string
}

/** Opaque product resource context. It is never proof of access. */
export interface PaimindAuthorizationResource {
  readonly kind: PaimindResourceKind
  readonly id: string
}

export interface PaimindAuthorizationRequest {
  readonly capability: PaimindCapability
  readonly resource?: PaimindAuthorizationResource
}

export interface PaimindProviderAuthorizationRequest extends PaimindAuthorizationRequest {
  readonly principal: Readonly<PaimindPrincipal>
}

export interface PaimindAuthorizationProvider {
  readonly id: string
  resolvePrincipal(): Promise<Readonly<PaimindPrincipal> | undefined>
  authorize(request: Readonly<PaimindProviderAuthorizationRequest>): Promise<boolean>
}

export type PaimindAuthorizationReason =
  | 'allowed'
  | 'provider-unavailable'
  | 'unauthenticated'
  | 'forbidden'
  | 'provider-error'

export interface PaimindAuthorizationDecision {
  readonly allowed: boolean
  readonly capability: PaimindCapability
  readonly resource?: Readonly<PaimindAuthorizationResource>
  readonly reason: PaimindAuthorizationReason
  readonly providerId?: string
  readonly principal?: Readonly<PaimindPrincipal>
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/

function isCapability(value: unknown): value is PaimindCapability {
  return typeof value === 'string' && (PAIMIND_CAPABILITIES as readonly string[]).includes(value)
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function normalizeRequest(request: PaimindAuthorizationRequest): Readonly<PaimindAuthorizationRequest> {
  if (!isCapability(request.capability)) throw new PaimindAuthorizationRequestError('unknown capability')
  if (request.resource === undefined) return Object.freeze({ capability: request.capability })
  if (!(PAIMIND_RESOURCE_KINDS as readonly unknown[]).includes(request.resource.kind)) {
    throw new PaimindAuthorizationRequestError('unknown resource kind')
  }
  if (!validIdentity(request.resource.id)) throw new PaimindAuthorizationRequestError('invalid resource id')
  return Object.freeze({
    capability: request.capability,
    resource: Object.freeze({ kind: request.resource.kind, id: request.resource.id }),
  })
}

function denial(
  request: Readonly<PaimindAuthorizationRequest>,
  reason: Exclude<PaimindAuthorizationReason, 'allowed'>,
  providerId?: string,
  principal?: Readonly<PaimindPrincipal>,
): Readonly<PaimindAuthorizationDecision> {
  return Object.freeze({
    allowed: false,
    capability: request.capability,
    ...(request.resource === undefined ? {} : { resource: request.resource }),
    reason,
    ...(providerId === undefined ? {} : { providerId }),
    ...(principal === undefined ? {} : { principal }),
  })
}

/** Invalid caller input is rejected before any provider or policy code executes. */
export class PaimindAuthorizationRequestError extends Error {
  readonly code = 'PAIMIND_AUTHORIZATION_REQUEST_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'PaimindAuthorizationRequestError'
  }
}

/**
 * Resolve and authorize through the same trusted provider. Missing or failing
 * identity infrastructure always fails closed; callers never submit a role.
 */
export async function authorizePermission(
  provider: PaimindAuthorizationProvider | undefined,
  request: PaimindAuthorizationRequest,
): Promise<Readonly<PaimindAuthorizationDecision>> {
  const normalized = normalizeRequest(request)
  if (provider === undefined) return denial(normalized, 'provider-unavailable')
  if (!validIdentity(provider.id)) return denial(normalized, 'provider-error')
  try {
    const candidate = await provider.resolvePrincipal()
    if (candidate === undefined) return denial(normalized, 'unauthenticated', provider.id)
    if (!validIdentity(candidate.issuer) || !validIdentity(candidate.subject)) {
      return denial(normalized, 'provider-error', provider.id)
    }
    const principal = Object.freeze({ issuer: candidate.issuer, subject: candidate.subject })
    const allowed = await provider.authorize(Object.freeze({ ...normalized, principal }))
    if (!allowed) return denial(normalized, 'forbidden', provider.id, principal)
    return Object.freeze({
      allowed: true,
      capability: normalized.capability,
      ...(normalized.resource === undefined ? {} : { resource: normalized.resource }),
      reason: 'allowed' as const,
      providerId: provider.id,
      principal,
    })
  } catch {
    return denial(normalized, 'provider-error', provider.id)
  }
}

/** Structured denial thrown at the protected server operation boundary. */
export class PaimindAuthorizationError extends Error {
  readonly code = 'PAIMIND_AUTHORIZATION_DENIED'

  constructor(readonly decision: Readonly<PaimindAuthorizationDecision>) {
    super(`PAIMind authorization denied: ${decision.reason} (${decision.capability})`)
    this.name = 'PaimindAuthorizationError'
  }
}

export async function requirePermission(
  provider: PaimindAuthorizationProvider | undefined,
  request: PaimindAuthorizationRequest,
): Promise<Readonly<PaimindAuthorizationDecision>> {
  const decision = await authorizePermission(provider, request)
  if (!decision.allowed) throw new PaimindAuthorizationError(decision)
  return decision
}
