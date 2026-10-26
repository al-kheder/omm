import { copyFileSync } from 'node:fs';
import { build, defineConfig } from 'tsup';

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
  onSuccess: async () => {
    // Copy with Node rather than `cp` so the build also works on Windows
    copyFileSync('src/server/viewer.html', 'dist/viewer.html');
    // Browser bundle of the shared parsers, served to the viewer as /vendor/omm.js
    await build({
      config: false,
      entry: { 'omm-viewer': 'src/viewer/index.ts' },
      format: ['iife'],
      globalName: 'OmmViewer',
      platform: 'browser',
      target: 'es2020',
      minify: true,
      clean: false,
      dts: false,
      silent: true,
    });
  },
});
