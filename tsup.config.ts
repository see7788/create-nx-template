import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['prompts', 'degit', 'readline', 'tsup', 'esbuild', 'child_process', 'fs', 'path', 'url', 'type-fest'],
  shims: false,
  banner: { js: '/* eslint-disable */' },
  minify: false,
});