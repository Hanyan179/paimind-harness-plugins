import { describe, expect, it, vi } from 'vitest'
import {
  authorizePermission,
  PaimindAuthorizationError,
  PaimindAuthorizationRequestError,
  requirePermission,
  type PaimindAuthorizationProvider,
} from '../src/index.ts'

function provider(allowed: boolean): PaimindAuthorizationProvider {
  return {
    id: 'paimind.test-identity',
    resolvePrincipal: async () => ({ issuer: 'https://identity.example', subject: 'user:42' }),
    authorize: async () => allowed,
  }
}

describe('FP15 provider-backed product authorization', () => {
  it('allows only the principal and policy returned by one trusted provider', async () => {
    const authorization = provider(true)
    const request = {
      capability: 'workspace.use' as const,
      resource: { kind: 'workspace' as const, id: 'workspace:one' },
    }
    await expect(authorizePermission(authorization, request)).resolves.toEqual({
      allowed: true,
      capability: 'workspace.use',
      resource: request.resource,
      reason: 'allowed',
      providerId: 'paimind.test-identity',
      principal: { issuer: 'https://identity.example', subject: 'user:42' },
    })
  })

  it('fails closed when no provider or authenticated principal exists', async () => {
    await expect(authorizePermission(undefined, { capability: 'conversation.use' })).resolves.toMatchObject({
      allowed: false, reason: 'provider-unavailable',
    })
    await expect(authorizePermission({
      id: 'paimind.empty-identity',
      resolvePrincipal: async () => undefined,
      authorize: vi.fn(async () => true),
    }, { capability: 'conversation.use' })).resolves.toMatchObject({
      allowed: false, reason: 'unauthenticated',
    })
  })

  it('keeps explicit deny and provider failure structured without leaking errors', async () => {
    await expect(authorizePermission(provider(false), { capability: 'administration.manage' })).resolves.toMatchObject({
      allowed: false, reason: 'forbidden', principal: { subject: 'user:42' },
    })
    await expect(authorizePermission({
      id: 'paimind.failed-identity',
      resolvePrincipal: async () => { throw new Error('secret provider detail') },
      authorize: vi.fn(async () => true),
    }, { capability: 'administration.manage' })).resolves.toEqual({
      allowed: false,
      capability: 'administration.manage',
      reason: 'provider-error',
      providerId: 'paimind.failed-identity',
    })
  })

  it('rejects malformed authority requests before invoking the provider', async () => {
    const authorization = provider(true)
    const authorize = vi.spyOn(authorization, 'authorize')
    await expect(authorizePermission(authorization, {
      capability: 'root.everything' as never,
    })).rejects.toBeInstanceOf(PaimindAuthorizationRequestError)
    await expect(authorizePermission(authorization, {
      capability: 'workspace.use', resource: { kind: 'workspace', id: '../escape\n' },
    })).rejects.toBeInstanceOf(PaimindAuthorizationRequestError)
    await expect(authorizePermission(authorization, {
      capability: 'workspace.use', resource: { kind: 'root' as never, id: 'resource:one' },
    })).rejects.toBeInstanceOf(PaimindAuthorizationRequestError)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('throws a structured denial at the protected server operation', async () => {
    await expect(requirePermission(undefined, { capability: 'developer-resources.view' }))
      .rejects.toMatchObject({
        code: 'PAIMIND_AUTHORIZATION_DENIED',
        decision: { allowed: false, reason: 'provider-unavailable' },
      })
    await expect(requirePermission(undefined, { capability: 'developer-resources.view' }))
      .rejects.toBeInstanceOf(PaimindAuthorizationError)
  })
})
