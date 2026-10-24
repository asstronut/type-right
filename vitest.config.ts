import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // WXT's content script context reads `import.meta.env`, which only modules Vite transforms have.
    server: { deps: { inline: ['wxt'] } },
  },
});
