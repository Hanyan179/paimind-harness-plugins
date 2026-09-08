import type {
  ContextCollection,
  ContextMount,
  ContextIdentity,
  ContextIdentityProvider,
  ContextResult,
} from './contract.js'
export type ContextEffectiveAccess = NonNullable<ContextResult['effective']>
export interface ContextAuthorization {
  effective(
    collections: readonly ContextCollection[],
    mounts: readonly ContextMount[],
    identity: ContextIdentity,
    identities: ContextIdentityProvider,
  ): Promise<ContextEffectiveAccess>
}
/** Local grants combine positively; an enterprise implementation can apply an
 * additional ceiling here without changing Agent, Workspace or Session state. */
export const localContextAuthorization: ContextAuthorization = {
  async effective(collections, mounts, identity, identities) {
    const live: ContextMount[] = []
    for (const m of mounts)
      if (
        identity.targets.some(
          (t) => t.kind === m.target.kind && t.id === m.target.id,
        ) &&
        (await identities.validateTarget(m.target))
      )
        live.push(m)
    return collections.flatMap((collection) => {
      const sources = live.filter((m) => m.collectionId === collection.id)
      return sources.length
        ? [
            {
              collection,
              mode: sources.some((m) => m.mode === 'write')
                ? ('write' as const)
                : ('read' as const),
              sources,
            },
          ]
        : []
    })
  },
}
