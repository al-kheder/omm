import { copyFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  // Copy with Node rather than `cp` so the build also works on Windows
  onSuccess: async () => {
    copyFileSync('src/server/viewer.html', 'dist/viewer.html');
  },
});
