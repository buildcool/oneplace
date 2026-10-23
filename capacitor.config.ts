import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.buildcool.oneplace',
  appName: 'OnePlace',
  webDir: 'dist',
  android: {
    // Downloads, logins and updates are all native; the web UI never needs plain http.
    allowMixedContent: false,
  },
  plugins: {
    // Edge-to-edge: Capacitor injects --safe-area-inset-* CSS variables (see styles.css).
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
};

export default config;
