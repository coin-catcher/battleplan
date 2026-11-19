import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'e2e/mindmap-drag.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/app/core/mindmap.ts',
        'src/app/core/mindmap-drag-pipeline.ts',
        'src/app/core/graph-recovery-placement.ts',
        'src/app/core/mindmap-shape.ts',
        'src/app/core/fixtures/mindmap-sample-project.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});