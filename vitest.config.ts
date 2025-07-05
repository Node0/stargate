import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Include only test files in the main codebase
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    // Exclude reference documentation examples
    exclude: [
      'design_docs/**/*',
      'node_modules/**/*'
    ],
    // Use fake timers for consistent timing in tests
    globals: true,
    environment: 'node'
  }
});