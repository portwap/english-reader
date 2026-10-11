// Vitest settings: where tests live. Kept in one place so every stage uses the same setup.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests sit next to the code they check; node_modules and output folders are never scanned.
    include: ['{shared,pipeline,web,netlify}/**/*.test.ts'],
  },
});
