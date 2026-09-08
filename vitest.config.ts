import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const packageSource = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

const packageModule = (name: string, module: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/${module}.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@hansen/ui-foundation': packageSource('ui-foundation'),
      '@hansen/contracts': packageSource('contracts'),
      '@hansen/presentation-contracts': packageSource('presentation-contracts'),
      '@hansen/harness-compat/native-mcp': packageModule('harness-compat', 'native-mcp'),
      '@hansen/mcp-center/client': fileURLToPath(new URL('./packages/mcp-center/src/client/index.tsx', import.meta.url)),
      '@hansen/mcp-center': packageSource('mcp-center'),
      '@hansen/feishu-cli-mcp': packageSource('feishu-cli-mcp'),
      '@hansen/harness-compat/host': packageModule('harness-compat', 'host'),
      '@hansen/harness-compat/client-icons': packageModule('harness-compat', 'client-icons'),
      '@hansen/harness-compat/client-surface': packageModule('harness-compat', 'client-surface'),
      '@hansen/harness-compat': packageSource('harness-compat'),
      '@hansen/platform-sdk': packageSource('platform-sdk'),
      '@hansen/platform-scheduler': packageSource('scheduler'),
      '@hansen/scheduler-adapter-harness': packageSource('scheduler-adapter-harness'),
      '@hansen/testkit': packageSource('testkit'),
      '@hansen/agent-builder/remote': packageModule('agent-builder', 'remote'),
      '@hansen/agent-builder/client-contract': packageModule('agent-builder', 'client-contract'),
      '@hansen/agent-builder': packageSource('agent-builder'),
      '@hansen/skill-market/remote': packageModule('skill-market', 'remote'),
      '@hansen/skill-market/catalog': packageModule('skill-market', 'catalog'),
      '@hansen/skill-market': packageSource('skill-market'),
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
