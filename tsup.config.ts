import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: false,
  dts: false,
  bundle: true,
  // Bundle everything except Node built-ins so the CLI works after `npm i -g` without a node_modules tree.
  noExternal: [/^[^.]/], // bundle every non-relative import
  banner: { js: '#!/usr/bin/env node' },
});
