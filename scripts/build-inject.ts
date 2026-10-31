// Builds the browser's page script (src/page/inject.ts) into one self-running file inside the APK
// (assets/browser/inject.js). The app adds it to every page it opens. Runs as part of `npm run build`.
import { build } from 'vite';

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    // Old phones may still have an old WebView.
    target: 'es2017',
    outDir: 'android/app/src/main/assets/browser',
    emptyOutDir: false,
    copyPublicDir: false,
    minify: true,
    lib: { entry: 'src/page/inject.ts', name: '__op_page', formats: ['iife'], fileName: () => 'inject.js' },
  },
});
console.log('wrote android/app/src/main/assets/browser/inject.js');
