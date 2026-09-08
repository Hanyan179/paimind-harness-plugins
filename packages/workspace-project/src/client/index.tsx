import type { PaimindWorkspaceClientContext } from '@hansen/harness-compat'
import { WorkspaceProjectBridge } from '../index.js'

/** Native services projected by the headless FP04 adapter. */
export const inject = ['sessions', 'workspaces']

/**
 * Publish one read-only Project = Workspace bridge for downstream plugins.
 * FP04 intentionally registers no button, menu, slot, style, overlay, or storage.
 */
export function apply(ctx: PaimindWorkspaceClientContext): void {
  ctx.effect(() => {
    const bridge = new WorkspaceProjectBridge(ctx.workspaces, ctx.sessions)
    const disposeService = ctx.reflect.provide('paimindWorkspaceProject', bridge)
    return () => {
      bridge.dispose()
      void disposeService()
    }
  }, 'paimind-workspace-project: headless bridge')
}
