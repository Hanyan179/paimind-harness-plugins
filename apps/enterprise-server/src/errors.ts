export class EnterpriseError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) {
    super(message)
    this.name = 'EnterpriseError'
  }
}

export function invalid(message = '输入无效'): never {
  throw new EnterpriseError(400, 'invalid-input', message)
}

export function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalid()
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) return invalid()
  return value
}

export function text(input: unknown, min: number, max: number): string {
  if (typeof input !== 'string' || input !== input.trim() || input.length < min || input.length > max
    || /[\u0000-\u001f\u007f]/u.test(input)) return invalid()
  return input
}

export function uuid(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(input)) return invalid('请求标识无效')
  return input.toLowerCase()
}
