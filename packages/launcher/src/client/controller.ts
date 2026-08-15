import type { ComponentType } from 'react'
import type { FeaturePackageId } from '@paimind/contracts'

/** Availability is explicit so a placeholder can never masquerade as a migrated feature. */
export type LauncherAvailability = 'available' | 'planned' | 'unavailable'

/** Props delivered to a real destination panel registered by a later feature package. */
export interface LauncherPanelProps {
  readonly closeLauncher: () => void
}

/** One stable destination registration in the PAIMind launcher. */
export interface LauncherDestination {
  readonly id: string
  readonly order: number
  readonly featurePackage: FeaturePackageId
  readonly availability: LauncherAvailability
  readonly titleZh: string
  readonly titleEn: string
  readonly descriptionZh: string
  readonly descriptionEn: string
  readonly Panel?: ComponentType<LauncherPanelProps>
}

/** Immutable render snapshot consumed by both the sidebar trigger and overlay. */
export interface LauncherSnapshot {
  readonly open: boolean
  readonly activeId: string
  readonly destinations: readonly LauncherDestination[]
}

/** Public cross-plugin controller provided as the `paimindLauncher` Cordis service. */
export interface PaimindLauncherService {
  getSnapshot(): LauncherSnapshot
  subscribe(listener: () => void): () => void
  open(opener?: HTMLElement | null, destinationId?: string): void
  close(options?: { readonly restoreFocus?: boolean }): void
  select(destinationId: string): void
  register(destination: LauncherDestination): () => void
}

export const DEFAULT_DESTINATIONS: readonly LauncherDestination[] = [
  {
    id: 'agents', order: 10, featurePackage: 'FP09', availability: 'planned',
    titleZh: 'Agent 中心', titleEn: 'Agent Center',
    descriptionZh: '企业 Agent、个人 Agent、检索、收藏与会话选择。',
    descriptionEn: 'Enterprise and personal Agents, search, favorites, and session selection.',
  },
  {
    id: 'skills', order: 20, featurePackage: 'FP11', availability: 'planned',
    titleZh: 'Skill 中心', titleEn: 'Skill Center',
    descriptionZh: '技能目录、版本、文件查看与真实会话挂载。',
    descriptionEn: 'Skill catalog, versions, files, and real Session attachment.',
  },
  {
    id: 'notifications', order: 30, featurePackage: 'FP12', availability: 'planned',
    titleZh: '通知中心', titleEn: 'Notifications',
    descriptionZh: '全部与未读通知、已读状态和安全深链。',
    descriptionEn: 'All and unread notifications, read state, and safe deep links.',
  },
  {
    id: 'scheduled-tasks', order: 40, featurePackage: 'FP13', availability: 'planned',
    titleZh: '定时任务', titleEn: 'Scheduled Tasks',
    descriptionZh: '任务定义、立即运行、运行结果与独立会话。',
    descriptionEn: 'Definitions, run-now actions, results, and isolated Sessions.',
  },
  {
    id: 'personal-settings', order: 50, featurePackage: 'FP14', availability: 'planned',
    titleZh: '个人中心', titleEn: 'Personal Center',
    descriptionZh: '个性化、通知偏好和应用权限入口。',
    descriptionEn: 'Personalization, notification preferences, and app permission entry points.',
  },
  {
    id: 'administration', order: 60, featurePackage: 'FP15', availability: 'planned',
    titleZh: '权限与管理', titleEn: 'Permissions & Admin',
    descriptionZh: '角色可见性、服务端授权与配置工作室。',
    descriptionEn: 'Role visibility, server authorization, and Configuration Studio.',
  },
  {
    id: 'developer-resources', order: 70, featurePackage: 'FP16', availability: 'planned',
    titleZh: '开发者资源', titleEn: 'Developer Resources',
    descriptionZh: '组件、插件清单、集成参考与运行诊断。',
    descriptionEn: 'Components, plugin inventory, integration references, and diagnostics.',
  },
]

/** Observable, stack-safe registry controller shared by every PAIMind launcher destination. */
export class LauncherController implements PaimindLauncherService {
  private readonly stacks = new Map<string, LauncherDestination[]>()
  private readonly listeners = new Set<() => void>()
  private snapshot: LauncherSnapshot
  private opener: HTMLElement | null = null

  constructor(destinations: readonly LauncherDestination[] = DEFAULT_DESTINATIONS) {
    for (const destination of destinations) this.stacks.set(destination.id, [Object.freeze({ ...destination })])
    const sorted = this.resolveDestinations()
    this.snapshot = Object.freeze({ open: false, activeId: sorted[0]?.id ?? '', destinations: sorted })
  }

  getSnapshot = (): LauncherSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open = (opener: HTMLElement | null = null, destinationId?: string): void => {
    this.opener = opener
    const requested = destinationId === undefined
      ? this.snapshot.activeId
      : this.snapshot.destinations.some(entry => entry.id === destinationId) ? destinationId : this.snapshot.activeId
    this.publish(true, requested)
  }

  close = (options: { readonly restoreFocus?: boolean } = {}): void => {
    if (!this.snapshot.open) return
    const target = this.opener
    this.publish(false, this.snapshot.activeId)
    this.opener = null
    if (options.restoreFocus !== false && target !== null) {
      window.setTimeout(() => { target.focus({ preventScroll: true }) }, 0)
    }
  }

  select = (destinationId: string): void => {
    if (!this.snapshot.destinations.some(entry => entry.id === destinationId)) return
    this.publish(this.snapshot.open, destinationId)
  }

  register = (destination: LauncherDestination): (() => void) => {
    if (destination.id.trim() === '') throw new Error('launcher destination id must not be empty')
    const entry = Object.freeze({ ...destination })
    const stack = this.stacks.get(entry.id) ?? []
    stack.push(entry)
    this.stacks.set(entry.id, stack)
    this.publish(this.snapshot.open, this.snapshot.activeId || entry.id)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.stacks.get(entry.id)
      if (current === undefined) return
      const index = current.lastIndexOf(entry)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) this.stacks.delete(entry.id)
      const next = this.resolveDestinations()
      const activeId = next.some(item => item.id === this.snapshot.activeId)
        ? this.snapshot.activeId
        : next[0]?.id ?? ''
      this.publish(this.snapshot.open && next.length > 0, activeId)
    }
  }

  dispose(): void {
    this.close({ restoreFocus: false })
    this.listeners.clear()
    this.opener = null
  }

  private resolveDestinations(): readonly LauncherDestination[] {
    return Object.freeze([...this.stacks.values()]
      .map(stack => stack.at(-1))
      .filter((entry): entry is LauncherDestination => entry !== undefined)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)))
  }

  private publish(open: boolean, activeId: string): void {
    const destinations = this.resolveDestinations()
    const next = Object.freeze({ open, activeId, destinations })
    if (
      this.snapshot.open === next.open
      && this.snapshot.activeId === next.activeId
      && this.snapshot.destinations.length === next.destinations.length
      && this.snapshot.destinations.every((entry, index) => entry === next.destinations[index])
    ) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

