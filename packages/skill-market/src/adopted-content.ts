import { readSkillPublicationAdoptionInput, type SkillPublicationAdoptionInput } from './publication.js'
import type { SkillPackageDirectoryPage } from './installer.js'

export const SKILL_ADOPTED_CONTENT_BYTES = 32 * 1024
export type SkillAdoptedContentInput = { readonly reference: SkillPublicationAdoptionInput } & (
  { readonly kind: 'directory'; readonly path: string; readonly cursor?: string }
  | { readonly kind: 'file'; readonly path: string; readonly offset: number })
export type SkillAdoptedContent = { readonly reference: SkillPublicationAdoptionInput; readonly runtimeGrant: false } & (
  { readonly kind: 'directory'; readonly page: SkillPackageDirectoryPage }
  | { readonly kind: 'file'; readonly path: string; readonly size: number; readonly offset: number; readonly data: string; readonly nextOffset: number | null })

/** Exact read selector only, not a native path, identity or authority grant. */
export function readSkillAdoptedContentInput(value: unknown): Readonly<SkillAdoptedContentInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('已采用技能读取参数无效')
  const row = value as Record<string, unknown>, allowed = row.kind === 'directory' ? ['reference', 'kind', 'path', ...(row.cursor === undefined ? [] : ['cursor'])] : ['reference', 'kind', 'path', 'offset']
  if (Object.keys(row).sort().join(',') !== allowed.sort().join(',') || !['directory', 'file'].includes(String(row.kind))
    || typeof row.path !== 'string' || row.path.length > 500 || /[\\\x00-\x1f\x7f]/u.test(row.path)
    || row.path !== '' && row.path.split('/').some(part => !part || ['.', '..', '.paimind-install.json'].includes(part))
    || row.kind === 'file' && row.path === '') throw new Error('已采用技能读取路径无效')
  const reference = readSkillPublicationAdoptionInput(row.reference)
  if (row.kind === 'directory') {
    if (row.cursor !== undefined && (typeof row.cursor !== 'string' || !/^(0|[1-9][0-9]{0,4})$/u.test(row.cursor)
      || Number(row.cursor) % 100 !== 0 || Number(row.cursor) >= reference.entryCount)) throw new Error('已采用技能目录游标无效')
    return Object.freeze({ reference, kind: 'directory', path: row.path, ...(row.cursor === undefined ? {} : { cursor: row.cursor as string }) })
  }
  if (typeof row.offset !== 'number' || !Number.isSafeInteger(row.offset) || row.offset < 0
    || row.offset > reference.expandedBytes || row.offset % SKILL_ADOPTED_CONTENT_BYTES !== 0) throw new Error('已采用技能文件偏移无效')
  return Object.freeze({ reference, kind: 'file', path: row.path, offset: row.offset })
}
