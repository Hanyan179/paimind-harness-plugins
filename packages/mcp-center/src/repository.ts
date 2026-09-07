import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { connectionSchema, type McpConnection, type McpConnectionRepository } from './contract.js'

const stored = z.object({ schemaVersion: z.literal(1), owner: z.string(), connections: z.array(connectionSchema).max(100) }).strict()

/** Local account-scoped persistence. Enterprise storage can implement the same contract. */
export class FileMcpConnectionRepository implements McpConnectionRepository {
  constructor(private readonly path: string) {}
  async load(owner: string): Promise<McpConnection[]> {
    let content: string
    try { content = await readFile(this.path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const data = stored.parse(JSON.parse(content))
    if (data.owner !== owner || data.connections.some(connection => connection.owner !== owner)) throw new Error('Connection repository belongs to a different account')
    if (new Set(data.connections.map(connection => connection.configuration.id)).size !== data.connections.length) throw new Error('Duplicate connection identity')
    return data.connections
  }
  async replace(owner: string, connections: readonly McpConnection[]): Promise<void> {
    const data = stored.parse({ schemaVersion: 1, owner, connections })
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, this.path)
  }
}
