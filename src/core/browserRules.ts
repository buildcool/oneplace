import bundled from '../../config/browser-rules.json';
import { REPO } from './update.ts';

// The browser's site rules (config/browser-rules.json): a copy ships inside the app, and a newer one is
// fetched like remote.json, so sites that change can be fixed without an app release. The phone checks
// every rule again (browser/Rules.kt) before using it.

export const RULES_URL = `https://cdn.jsdelivr.net/gh/${REPO}@main/config/browser-rules.json`;
const KEY = 'op.rules';
const TTL = 6 * 60 * 60 * 1000;

export const BUNDLED_RULES = JSON.stringify(bundled);

/** Newest rules as JSON text: the cached copy when fresh, else the network, else what the app shipped with. */
export async function loadBrowserRules(fetchFn: typeof fetch = fetch): Promise<string> {
  let cached: { at: number; json: string } | undefined;
  try {
    cached = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? undefined;
  } catch {
    cached = undefined;
  }
  if (cached && Date.now() - cached.at < TTL) return cached.json;
  try {
    const res = await fetchFn(RULES_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = JSON.stringify(await res.json());
    try {
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), json }));
    } catch {
      // not fatal
    }
    return json;
  } catch {
    return cached?.json ?? BUNDLED_RULES;
  }
}
