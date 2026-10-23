import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { devEngine } from './scripts/dev-engine.ts';

export default defineConfig({
  // devEngine: `npm run dev` previews real yt-dlp/gallery-dl info from Termux (see scripts/dev-engine.ts).
  plugins: [react(), devEngine()],
  // localhost only: the dev engine must not be reachable from other devices on your Wi-Fi.
  server: { host: '127.0.0.1' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
