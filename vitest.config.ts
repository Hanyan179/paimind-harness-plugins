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
      '@paimind/harness-compat/host': packageModule('harness-compat', 'host'),
      '@paimind/harness-compat': packageSource('harness-compat'),
      '@paimind/testkit': packageSource('testkit'),
      '@paimind/permissions-core': packageSource('permissions-core'),
      '@paimind/agent-builder/remote': packageModule('agent-builder', 'remote'),
      '@paimind/agent-builder': packageSource('agent-builder'),
      '@paimind/skill-market/remote': packageModule('skill-market', 'remote'),
      '@paimind/skill-market': packageSource('skill-market'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/*/tests/**/*.spec.{ts,tsx}'],
  },
})
