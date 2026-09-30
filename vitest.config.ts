import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const packageSource = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

const packageModule = (name: string, module: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/${module}.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@paimind/contracts': packageSource('contracts'),
      '@paimind/artifacts': packageSource('artifacts'),
      '@paimind/better-sidebar-adapter': packageSource('better-sidebar-adapter'),
      '@paimind/ui-foundation': packageSource('ui-foundation'),
      '@paimind/presentation-contracts': packageSource('presentation-contracts'),
      '@paimind/harness-compat/host': packageModule('harness-compat', 'host'),
      '@paimind/enterprise-admin/auth-boundary': packageModule('enterprise-admin', 'auth-boundary'),
      '@paimind/harness-compat/gateway-transport': packageModule('harness-compat', 'gateway-transport'),
      '@paimind/harness-compat/client-icons': packageModule('harness-compat', 'client-icons'),
      '@paimind/harness-compat/client-surface': packageModule('harness-compat', 'client-surface'),
      '@paimind/harness-compat': packageSource('harness-compat'),
      '@paimind/platform-sdk': packageSource('platform-sdk'),
      '@paimind/platform-scheduler': packageSource('scheduler'),
      '@paimind/scheduler-adapter-harness': packageSource('scheduler-adapter-harness'),
      '@paimind/testkit': packageSource('testkit'),
      '@paimind/agent-builder/remote': packageModule('agent-builder', 'remote'),
      '@paimind/agent-builder/publication': packageModule('agent-builder', 'publication'),
      '@paimind/agent-builder/adoption': packageModule('agent-builder', 'adoption'),
      '@paimind/agent-builder/client-contract': packageModule('agent-builder', 'client-contract'),
      '@paimind/agent-builder': packageSource('agent-builder'),
      '@paimind/skill-market/remote': packageModule('skill-market', 'remote'),
      '@paimind/skill-market/catalog': packageModule('skill-market', 'catalog'),
      '@paimind/skill-market/publication': packageModule('skill-market', 'publication'),
      '@paimind/skill-market': packageSource('skill-market'),
    },
  },
  test: {
    // Bound aggregate worker/file IO on a shared development host. Keep every
    // case, its timeout and explicit in-test concurrency unchanged.
    maxWorkers: 4,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
    include: ['packages/*/tests/**/*.spec.{ts,tsx}', 'apps/*/tests/**/*.spec.{ts,tsx}', 'examples/**/*.spec.{ts,tsx}'],
  },
})
