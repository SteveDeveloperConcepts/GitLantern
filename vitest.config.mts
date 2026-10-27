import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // The integration tests run real git, which is slow on Windows with every test file running at once.
    testTimeout: 90_000,
    hookTimeout: 90_000
  }
})
