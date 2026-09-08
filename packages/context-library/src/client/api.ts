import type { HarnessRemoteResult } from '@hansen/harness-compat'
import type { ContextInput, ContextResult } from '../contract.js'
export interface ContextRemoteApi {
  request(input: ContextInput): Promise<HarnessRemoteResult<ContextResult>>
}
export async function contextResult(
  api: ContextRemoteApi,
  input: ContextInput,
): Promise<ContextResult> {
  const result = await api.request(input)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
