import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'

export interface HarnessModelSettings {
  selection: { provider: string; model: string; reasoningEffort?: string } | null
  /** Only a named default-route reference, never its resolved value. Null also
   * covers owner-managed record/OAuth authentication, not a missing credential. */
  credentialRef: string | null
}
export interface HarnessModelReadValues {
  settings: HarnessModelSettings
  providers: { provider: string; name: string; active: boolean }[]
  catalog: { groups: { provider: string; name: string; models: { id: string; name: string }[] }[]; failedProviders: string[] }
  credentials: { ref: string; configured: boolean }[]
}
type Kind = keyof HarnessModelReadValues
function fail(): never { throw Error('Native model state unavailable') }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : fail()
const label = (value: unknown): string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && !/[\u0000-\u001f\u007f]/u.test(value) ? value : fail()
const list = (value: unknown, max = 128): unknown[] => Array.isArray(value) && value.length <= max ? value : fail()
const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) fail() }
const reference = (value: unknown): string => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,199}$/u.test(value) ? value : fail()
const methods = { settings: 'settings.describe', providers: 'llm.providers', catalog: 'llm.models', credentials: 'credentials.describe' } as const

/** Exact readonly native calls, not a generic RPC or a role grant. */
export function createHarnessModelRead(kind: Kind, rpcId: string, refs: readonly string[] = []): Readonly<{ path: string; body: string }> {
  label(rpcId)
  if (!Object.hasOwn(methods, kind) || !Array.isArray(refs) || refs.length > 1 || kind !== 'credentials' && refs.length) fail()
  refs.forEach(reference); unique([...refs])
  if (kind === 'credentials' && refs.length !== 1) fail()
  const method = methods[kind]
  return { path: '/api/' + method, body: JSON.stringify({ type: 'client-request', rpcId, method, payload: kind === 'credentials' ? { refs } : {} }) }
}

/** Discards all raw settings, schemas, base/user layers, secrets, endpoints,
 * headers, provider failure messages and credential sources. */
export function decodeHarnessModelRead<K extends Kind>(text: string, rpcId: string, kind: K, refs: readonly string[] = []): HarnessModelReadValues[K] {
  try {
    createHarnessModelRead(kind, rpcId, refs)
    if (text.length > 2 * 1024 * 1024) fail()
    const response = serverResponseSchema.parse(JSON.parse(text))
    if (response.rpcId !== rpcId || !response.result.ok) fail()
    const value = object(response.result.value)
    let result: HarnessModelReadValues[Kind]
    if (kind === 'settings') {
      const namespaces = list(value.namespaces, 512).map(object)
      unique(namespaces.map(row => label(row.ns)))
      const selected = namespaces.find(row => row.ns === 'agent-default-model')
      if (!selected) result = { selection: null, credentialRef: null }
      else {
        const raw = object(selected.value), provider = label(raw.provider), model = label(raw.model)
        const selection = { provider, model, ...(raw.reasoningEffort === undefined ? {} : { reasoningEffort: label(raw.reasoningEffort) }) }
        let credentialRef: string | null = null
        if (provider === 'deepseek-official') {
          const settings = namespaces.find(row => row.ns === 'llm-deepseek')
          if (settings) credentialRef = reference(object(settings.value).apiKeyEnv ?? 'DEEPSEEK_API_KEY')
        } else {
          const settings = namespaces.find(row => row.ns === 'llm-pi-ai')
          if (settings) {
            const providers = object(object(settings.value).providers)
            if (Object.hasOwn(providers, provider)) {
              const ref = object(providers[provider]).apiKeyEnv
              if (ref !== undefined) credentialRef = reference(ref)
            }
          }
        }
        result = { selection, credentialRef }
      }
    } else if (kind === 'providers') {
      const providers = list(value.providers).map(item => {
        const row = object(item)
        if (typeof row.active !== 'boolean') fail()
        return { provider: label(row.provider), name: label(row.displayName), active: row.active }
      })
      unique(providers.map(row => row.provider)); result = providers
    } else if (kind === 'catalog') {
      let total = 0
      const groups = list(value.groups).map(item => {
        const row = object(item), models = list(row.models, 5000).map(item => {
          const model = object(item); return { id: label(model.id), name: label(model.name) }
        })
        total += models.length; if (total > 5000) fail()
        unique(models.map(row => row.id))
        return { provider: label(row.id), name: label(row.name), models }
      })
      const failedProviders = list(value.failures).map(item => label(object(item).id))
      unique([...groups.map(row => row.provider), ...failedProviders])
      result = { groups, failedProviders }
    } else {
      const credentials = object(value.credentials)
      if (Object.keys(credentials).length !== refs.length || !refs.every(ref => Object.hasOwn(credentials, ref))) fail()
      result = refs.map(ref => {
        const row = object(credentials[ref]); if (typeof row.configured !== 'boolean') fail()
        return { ref, configured: row.configured }
      })
    }
    return result as HarnessModelReadValues[K]
  } catch { return fail() }
}
