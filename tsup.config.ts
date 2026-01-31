import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/cli/index.ts'],
    format: ['esm'],
    outDir: 'dist/cli',
    clean: false,
    bundle: true,
    platform: 'node',
    target: 'node18',
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: ['src/server/index.ts'],
    format: ['esm'],
    outDir: 'dist/server',
    clean: false,
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: ['express', 'mssql', 'cors'],
  },
  {
    entry: ['src/server/dev.ts'],
    format: ['esm'],
    outDir: 'dist/server',
    clean: false,
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: ['express', 'mssql', 'cors'],
  },
]);
