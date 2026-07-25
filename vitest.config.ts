import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['src/shared/**/*.test.ts', 'src/renderer/**/*.test.ts'],
    // Default stays node — it is faster and catches accidental DOM
    // dependencies in shared code. The one test that parses a real .pptx
    // opts into jsdom with a `// @vitest-environment jsdom` docblock.
    //
    // Do NOT switch that file to happy-dom: its DOMParser rejects the OOXML
    // declaration and returns an empty presentation WITHOUT throwing, so the
    // test passes while asserting nothing.
    environment: 'node'
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
