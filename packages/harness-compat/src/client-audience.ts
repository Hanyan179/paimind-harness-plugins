/** PAIMind's non-authoritative presentation wire, emitted by the managed
 * profile through native index injection. It contains no identity or secret. */
export const PAIMIND_CLIENT_AUDIENCE_GLOBAL = '__PAIMIND_CLIENT_AUDIENCE__'

/** Omission preserves the ordinary native/product composition. A member cell
 * never needs management startup traffic. Unknown/accessor-shaped metadata
 * fails closed for presentation only; this is NOT an authorization check. */
export function readPaimindClientAudience(target: object = globalThis): 'default' | 'member' | 'invalid' {
  try {
    if (!(PAIMIND_CLIENT_AUDIENCE_GLOBAL in target)) return 'default'
    const descriptor = Object.getOwnPropertyDescriptor(target, PAIMIND_CLIENT_AUDIENCE_GLOBAL)
    if (!descriptor || !('value' in descriptor)) return 'invalid'
    const value: unknown = descriptor.value
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return 'invalid'
    const fields = Object.getOwnPropertyDescriptors(value)
    if (Object.keys(fields).sort().join(',') !== 'audience,schemaVersion'
      || !('value' in fields.audience!) || !('value' in fields.schemaVersion!)) return 'invalid'
    return fields.schemaVersion!.value === 1 && fields.audience!.value === 'member' ? 'member' : 'invalid'
  } catch { return 'invalid' }
}
