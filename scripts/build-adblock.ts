// Puts the browser's ad and tracker block list into the APK (assets/browser/block-light.bin):
// HaGeZi's Light list (GPL-3.0, like OnePlace), or the small list in config/ when the download fails.
// The app fetches a newer list about once a week by itself. Runs in CI before the APK is built.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encodeBlocklist, parseDomains } from './adblock.ts';

const URL = 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/light-onlydomains.txt';
const OUT = 'android/app/src/main/assets/browser/block-light.bin';

let domains: string[] = [];
try {
  const res = await fetch(URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  domains = parseDomains(await res.text());
  if (domains.length < 1000) throw new Error(`only ${domains.length} domains`);
} catch (e) {
  console.warn(`HaGeZi list not downloaded (${(e as Error).message}); using config/adblock-fallback.txt`);
  domains = parseDomains(readFileSync('config/adblock-fallback.txt', 'utf8'));
}
mkdirSync('android/app/src/main/assets/browser', { recursive: true });
writeFileSync(OUT, encodeBlocklist(domains));
console.log(`wrote ${OUT}: ${domains.length} domains`);
