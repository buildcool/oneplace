// Writes the default native config (1-tap share templates, notification texts) into the APK, so a
// 1-tap share works even before the app UI has ever been opened. Runs as part of `npm run build`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULTS, quickTemplates } from '../src/core/settings.ts';
import { nativeStrings } from '../src/strings.ts';
import type { NativeConfig } from '../src/engine/types.ts';

const out = 'android/app/src/main/assets/defaults.json';
const cfg: NativeConfig = {
  concurrency: DEFAULTS.concurrency,
  wifiOnly: DEFAULTS.wifiOnly,
  ytdlpChannel: DEFAULTS.ytdlpChannel,
  autoEngineUpdate: DEFAULTS.autoEngineUpdate,
  quickTargets: DEFAULTS.quickTargets,
  quick: quickTemplates(DEFAULTS),
  siteArgs: {},
  fastYouTube: true,
  openIn: DEFAULTS.openIn,
  strings: nativeStrings('en'),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
console.log(`wrote ${out}`);
