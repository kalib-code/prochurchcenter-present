import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Renderer lib modules are pure (no React, no IPC) and are the only
    // renderer code worth unit-testing. Including them here is what makes
    // serviceClock / serviceNext / preflight actually run under `pnpm test`
    // — before this, a test file under src/renderer was silently skipped.
    include: [
      'src/shared/**/*.test.ts',
      'src/renderer/src/lib/**/*.test.ts'
    ],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
