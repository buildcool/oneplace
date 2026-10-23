import { safeRemoteArgs } from './args.ts';
import { REPO } from './update.ts';

// Hotfixes without an app release: config/remote.json in the repo, served free by jsDelivr.
// Only allow-listed engine options are accepted (see safeRemoteArgs).

export const REMOTE_URL = `https://cdn.jsdelivr.net/gh/${REPO}@main/config/remote.json`;

export interface Announcement {
  id: string;
  /** Text per language; English is the fallback. */
  text: { en: string; hinglish?: string; hi?: string };
  url?: string;
  level?: 'info' | 'warn';
}

export interface RemoteConfig {
  announcement?: Announcement;
  /** Extra yt-dlp options per site id, e.g. a different YouTube client after YouTube changes something. */
  siteArgs: Record<string, string[]>;
  /** yt-dlp versions older than this are updated before the next download. */
  minYtDlp?: string;
  /** Features switched off remotely if they misbehave. */
  disabled: string[];
}

export const EMPTY_CONFIG: RemoteConfig = { siteArgs: {}, disabled: [] };

/** Validate untrusted JSON into a RemoteConfig. Anything unexpected is dropped. */
export function parseRemoteConfig(raw: unknown): RemoteConfig {
  if (!raw || typeof raw !== 'object') return EMPTY_CONFIG;
  const r = raw as Record<string, unknown>;
  const siteArgs: Record<string, string[]> = {};
  if (r.siteArgs && typeof r.siteArgs === 'object') {
    for (const [site, args] of Object.entries(r.siteArgs as Record<string, unknown>)) {
      if (!/^[a-z0-9]{1,20}$/.test(site)) continue;
      const safe = safeRemoteArgs(args);
      if (safe.length) siteArgs[site] = safe;
    }
  }
  let announcement: Announcement | undefined;
  const a = r.announcement as Record<string, unknown> | undefined;
  if (a && typeof a === 'object' && typeof a.id === 'string' && a.text && typeof (a.text as Record<string, unknown>).en === 'string') {
    const t = a.text as Record<string, unknown>;
    announcement = {
      id: a.id.slice(0, 40),
      text: {
        en: String(t.en).slice(0, 300),
        ...(typeof t.hinglish === 'string' ? { hinglish: t.hinglish.slice(0, 300) } : {}),
        ...(typeof t.hi === 'string' ? { hi: t.hi.slice(0, 300) } : {}),
      },
      ...(typeof a.url === 'string' && /^https:\/\//.test(a.url) ? { url: a.url } : {}),
      level: a.level === 'warn' ? 'warn' : 'info',
    };
  }
  return {
    siteArgs,
    disabled: Array.isArray(r.disabled) ? r.disabled.filter((d): d is string => typeof d === 'string').slice(0, 50) : [],
    ...(announcement ? { announcement } : {}),
    ...(typeof r.minYtDlp === 'string' && /^\d{4}\.\d{2}\.\d{2}/.test(r.minYtDlp) ? { minYtDlp: r.minYtDlp } : {}),
  };
}

const KEY = 'op.remote';
const TTL = 6 * 60 * 60 * 1000;

/** Cached copy if fresh, otherwise fetch (failures fall back to the cache or an empty config). */
export async function loadRemoteConfig(fetchFn: typeof fetch = fetch, force = false): Promise<RemoteConfig> {
  let cached: { at: number; cfg: RemoteConfig } | undefined;
  try {
    cached = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? undefined;
  } catch {
    cached = undefined;
  }
  if (!force && cached && Date.now() - cached.at < TTL) return parseRemoteConfig(cached.cfg);
  try {
    const res = await fetchFn(REMOTE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = parseRemoteConfig(await res.json());
    try {
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), cfg }));
    } catch {
      // not fatal
    }
    return cfg;
  } catch {
    return cached ? parseRemoteConfig(cached.cfg) : EMPTY_CONFIG;
  }
}

/** "2026.10.20" < "2026.10.21.123456" style comparison (nightly tags carry an extra part). */
export function olderThan(version: string | undefined, min: string | undefined): boolean {
  if (!version || !min) return false;
  const p = (v: string) => v.split('.').map((x) => Number(x) || 0);
  const [a, b] = [p(version), p(min)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}
