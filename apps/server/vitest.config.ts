/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'

const extendedTier = process.env.TEST_TIER === 'extended'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: extendedTier ? [] : ['test/**/*.extended.test.ts'],
    fileParallelism: false,
    globals: false,
    hookTimeout: 15000,
    include: [extendedTier ? 'test/**/*.extended.test.ts' : 'test/**/*.test.ts'],
    passWithNoTests: extendedTier,
    pool: 'forks',
    testTimeout: 15000,
    restoreMocks: true,
    setupFiles: ['./test/setup.ts'],
    unstubEnvs: true,
  },
})
