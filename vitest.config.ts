import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const packageSource = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

const packageModule = (name: string, module: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/${module}.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@paimind/ui-foundation': packageSource('ui-foundation'),
      '@paimind/contracts': packageSource('contracts'),
      '@paimind/presentation-contracts': packageSource('presentation-contracts'),
      '@paimind/harness-compat/native-mcp': packageModule('harness-compat', 'native-mcp'),
      '@paimind/mcp-center/client': fileURLToPath(new URL('./packages/mcp-center/src/client/index.tsx', import.meta.url)),
      '@paimind/mcp-center': packageSource('mcp-center'),
      '@paimind/feishu-cli-mcp': packageSource('feishu-cli-mcp'),
      '@paimind/harness-compat/host': packageModule('harness-compat', 'host'),
      '@paimind/harness-compat/client-icons': packageModule('harness-compat', 'client-icons'),
      '@paimind/harness-compat/client-surface': packageModule('harness-compat', 'client-surface'),
      '@paimind/harness-compat': packageSource('harness-compat'),
      '@paimind/platform-sdk': packageSource('platform-sdk'),
      '@paimind/platform-scheduler': packageSource('scheduler'),
      '@paimind/scheduler-adapter-harness': packageSource('scheduler-adapter-harness'),
      '@paimind/testkit': packageSource('testkit'),
      '@paimind/agent-builder/remote': packageModule('agent-builder', 'remote'),
      '@paimind/agent-builder/client-contract': packageModule('agent-builder', 'client-contract'),
      '@paimind/agent-builder': packageSource('agent-builder'),
      '@paimind/skill-market/remote': packageModule('skill-market', 'remote'),
      '@paimind/skill-market/catalog': packageModule('skill-market', 'catalog'),
      '@paimind/skill-market': packageSource('skill-market'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
    include: ['packages/*/tests/**/*.spec.{ts,tsx}', 'examples/**/*.spec.{ts,tsx}'],
  },
})
