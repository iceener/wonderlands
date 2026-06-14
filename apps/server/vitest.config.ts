/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: false,
    hookTimeout: 15000,
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 15000,
    restoreMocks: true,
    setupFiles: ['./test/setup.ts'],
    unstubEnvs: true,
  },
})
