import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
      'services/**/src/**/*.test.ts',
      'services/**/test/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
      'apps/**/tests/**/*.test.ts',
    ],
    environment: 'node',
    globals: true,
  },
});
