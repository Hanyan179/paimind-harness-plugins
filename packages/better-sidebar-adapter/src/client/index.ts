import type { PaimindClientContext } from '@paimind/harness-compat'
import type { PaimindWorkspaceProjectService } from '@paimind/workspace-project'
import {
  BetterSidebarAdapter,
  type ExternalBetterSidebarService,
} from '../index.js'

/** Provider and PAIMind services required before the adapter activates. */
export const inject = ['betterSidebar', 'locale', 'paimindWorkspaceProject']

export interface BetterSidebarAdapterClientContext extends PaimindClientContext {
  readonly betterSidebar: ExternalBetterSidebarService
  readonly paimindWorkspaceProject: PaimindWorkspaceProjectService
}

/** Publish one stable service and attach all provider registrations to its lifecycle. */
export function apply(ctx: BetterSidebarAdapterClientContext): void {
  const adapter = new BetterSidebarAdapter(
    ctx.betterSidebar,
    ctx.locale,
    ctx.paimindWorkspaceProject,
  )
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('paimindSidebar', adapter)
    return () => {
      adapter.dispose()
      void disposeService()
    }
  }, 'paimind-better-sidebar-adapter: service')
}

