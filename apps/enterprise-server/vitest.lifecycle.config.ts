import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', fileParallelism: false,
  include: ['apps/enterprise-server/tests/**/*.lifecycle-test.ts'], testTimeout: 240_000, hookTimeout: 30_000 } })
