import { baseHost, cleanUrl, detect } from './links.ts';
import { SITES } from './sites.ts';
import type { SiteId } from './types.ts';

// The in-app browser's own logic: what to do with typed text, search engines, history, bookmarks,
// tabs and the address panel's suggestions. Pure (storage helpers aside) so it is unit-tested.

export type SearchEngine = 'google' | 'duckduckgo' | 'bing' | 'brave';

/** %s is the encoded query. Suggestions use the OpenSearch JSON format: ["query", ["a", "b"…]]. */
export const ENGINES: Record<SearchEngine, { name: string; search: string; suggest: string }> = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  brave: { name: 'Brave', search: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
};

export const YOUTUBE_SEARCH = 'https://m.youtube.com/results?search_query=%s';
export const YTMUSIC_SEARCH = 'https://music.youtube.com/search?q=%s';

export const fill = (template: string, q: string) => template.replace('%s', encodeURIComponent(q.trim()));

/** Hosts typed without a dot that still mean a place, not a search. */
const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d{1,5})?([/?#].*)?$/i;
/** "example.com", "m.example.co.in/path?x=1", "example.com:8080". */
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}(:\d{1,5})?([/?#].*)?$/i;

/**
 * Typed text → where to go. Addresses open as they are ("https://" is added); anything else is a search.
 * Other schemes (javascript:, intent:, file:…) are never opened from here: they become searches.
 */
export function toUrl(raw: string, engine: SearchEngine = 'google'): { url: string; search: boolean } | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (/^https?:\/\/\S+$/i.test(s)) {
    try {
      return { url: new URL(s).href, search: false };
    } catch {
      // fall through to search
    }
  }
  if (!/\s/.test(s) && !/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) {
    if (LOCAL.test(s)) return { url: `http://${s}`, search: false };
    if (DOMAIN.test(s)) {
      try {
        return { url: new URL(`https://${s}`).href, search: false };
      } catch {
        // fall through
      }
    }
  }
  return { url: fill(ENGINES[engine].search, s), search: true };
}

/** The words of a search URL from one of our engines, YouTube or YT Music (to show them in the address panel). */
export function searchTerms(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = baseHost(u.hostname);
  const q =
    (host === 'google.com' || host === 'bing.com' || host === 'duckduckgo.com' || host === 'search.brave.com') && /^\/(search)?$/.test(u.pathname)
      ? u.searchParams.get('q')
      : host === 'youtube.com' && u.pathname === '/results'
        ? u.searchParams.get('search_query')
        : host === 'music.youtube.com' && u.pathname === '/search'
          ? u.searchParams.get('q')
          : null;
  return q?.trim() || undefined;
}

/** "https://www.youtube.com/watch?v=1" → "youtube.com". */
export function displayHost(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'about:') return url;
    return baseHost(u.hostname) || u.hostname;
  } catch {
    return url;
  }
}

export const isHttps = (url: string) => /^https:\/\//i.test(url);

/** The site OnePlace knows for a page (for icons and logins), or undefined. */
export function siteOf(url: string): SiteId | undefined {
  const s = detect(url).site;
  return s === 'other' ? undefined : s;
}

/** Same page for history and bookmarks: no #fragment, no tracking parameters. */
export function pageKey(url: string): string {
  return cleanUrl(url).replace(/\/$/, '');
}

// ---------- history ----------

export interface Visit {
  url: string;
  title: string;
  at: number;
  visits: number;
}

export const HISTORY_MAX = 1500;

/** Add a visit at the front; the same page only once (its count goes up). */
export function addVisit(list: Visit[], v: { url: string; title?: string }, now = Date.now()): Visit[] {
  if (!/^https?:/i.test(v.url)) return list;
  const key = pageKey(v.url);
  const old = list.find((x) => pageKey(x.url) === key);
  const title = v.title?.trim() || old?.title || displayHost(v.url);
  const rest = list.filter((x) => x !== old);
  return [{ url: v.url, title, at: now, visits: (old?.visits ?? 0) + 1 }, ...rest].slice(0, HISTORY_MAX);
}

/** The title arrived after the visit was stored. */
export function retitle(list: Visit[], url: string, title: string): Visit[] {
  const key = pageKey(url);
  const t = title.trim();
  if (!t) return list;
  let changed = false;
  const next = list.map((x) => {
    if (changed || pageKey(x.url) !== key || x.title === t) return x;
    changed = true;
    return { ...x, title: t };
  });
  return changed ? next : list;
}

function words(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Visits matching every word, best first: the address starting with the text, then visits, then recency. */
export function searchVisits(list: Visit[], q: string, limit = 20, now = Date.now()): Visit[] {
  const w = words(q);
  if (!w.length) return list.slice(0, limit);
  const scored: { v: Visit; s: number }[] = [];
  for (const v of list) {
    const hay = `${v.title} ${v.url}`.toLowerCase();
    if (!w.every((x) => hay.includes(x))) continue;
    const host = displayHost(v.url).toLowerCase();
    const prefix = host.startsWith(w[0]!) ? 40 : 0;
    const days = (now - v.at) / 86_400_000;
    scored.push({ v, s: prefix + Math.min(v.visits, 20) * 2 + Math.max(0, 30 - days) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.v);
}

/** History grouped for the History page: Today, Yesterday, then dates. */
export function dayLabel(at: number, now = Date.now()): 'today' | 'yesterday' | string {
  const d = new Date(at);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return d.toISOString().slice(0, 10);
}

// ---------- bookmarks ----------

export interface Bookmark {
  url: string;
  title: string;
  at: number;
}

export const isBookmarked = (list: Bookmark[], url: string) => list.some((b) => pageKey(b.url) === pageKey(url));

export function toggleBookmark(list: Bookmark[], page: { url: string; title?: string }, now = Date.now()): Bookmark[] {
  const key = pageKey(page.url);
  if (list.some((b) => pageKey(b.url) === key)) return list.filter((b) => pageKey(b.url) !== key);
  return [{ url: page.url, title: page.title?.trim() || displayHost(page.url), at: now }, ...list].slice(0, 500);
}

// ---------- start page shortcuts ----------

export interface Shortcut {
  url: string;
  title: string;
  site?: SiteId;
}

/** Sites with a home page, YouTube and YouTube Music first (they get their own cards). */
export const SHORTCUT_SITES: SiteId[] = ['instagram', 'facebook', 'x', 'pinterest', 'reddit', 'jiosaavn', 'dailymotion', 'soundcloud', 'vimeo', 'twitch', 'tumblr', 'bluesky', 'imgur', 'archive'];

export function defaultShortcuts(): Shortcut[] {
  return SHORTCUT_SITES.map((id) => SITES[id]).map((s) => ({ url: s.home ?? `https://${s.id}.com/`, title: s.name.replace(' (Twitter)', ''), site: s.id }));
}

export interface ShortcutPrefs {
  /** Pinned by the user, first on the start page. */
  pinned: Shortcut[];
  /** Hosts the user removed from the grid. */
  hidden: string[];
}

/**
 * The start page grid: pinned sites, then the built-in ones, then the hosts visited most this month.
 * Each host once; removed ones never come back on their own.
 */
export function topSites(prefs: ShortcutPrefs, history: Visit[], max = 16, now = Date.now()): Shortcut[] {
  const out: Shortcut[] = [];
  const seen = new Set<string>(prefs.hidden);
  const add = (s: Shortcut) => {
    const h = displayHost(s.url);
    if (seen.has(h) || out.length >= max) return;
    seen.add(h);
    out.push(s);
  };
  prefs.pinned.forEach(add);
  defaultShortcuts().forEach(add);
  const counts = new Map<string, { n: number; v: Visit }>();
  for (const v of history) {
    if (now - v.at > 30 * 86_400_000) continue;
    const h = displayHost(v.url);
    const c = counts.get(h);
    counts.set(h, { n: (c?.n ?? 0) + v.visits, v: c?.v ?? v });
  }
  [...counts.entries()]
    .filter(([, c]) => c.n >= 3)
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([h, c]) => add({ url: `${new URL(c.v.url).origin}/`, title: h, site: siteOf(c.v.url) }));
  return out;
}

// ---------- tabs ----------

export interface TabError {
  /** offline · dns · ssl · crash · http · other */
  code: string;
  desc?: string;
}

/** What the phone reports about a tab (BrowserLayer on the native side). */
export interface TabInfo {
  id: string;
  url: string;
  title: string;
  /** Saved site icon (file path). */
  icon?: string;
  /** Saved screenshot for the tab switcher (file path). */
  thumb?: string;
  /** Changes when the screenshot is replaced (so the picture reloads). */
  thumbAt?: number;
  progress: number;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  /** https without certificate problems. */
  secure: boolean;
  /** Ads and trackers stopped on this page. */
  blocked: number;
  /** The page's own colour (meta theme-color). */
  theme?: string;
  desktop: boolean;
  private: boolean;
  error?: TabError;
  /** The page's own picture and title (og:image, og:title) for the finder's "This page" card. */
  image?: string;
  pageTitle?: string;
}

export function blankTab(id: string, url: string, priv = false): TabInfo {
  return { id, url, title: '', progress: 0, loading: !!url, canBack: false, canForward: false, secure: isHttps(url), blocked: 0, desktop: false, private: priv };
}

/** Tabs kept across app restarts (never private ones). */
export interface SavedTabs {
  active?: string;
  list: { id: string; url: string; title: string; icon?: string; thumb?: string }[];
}

export function saveableTabs(tabs: TabInfo[], active?: string): SavedTabs {
  const list = tabs.filter((t) => !t.private && t.url).map((t) => ({ id: t.id, url: t.url, title: t.title, ...(t.icon ? { icon: t.icon } : {}), ...(t.thumb ? { thumb: t.thumb } : {}) }));
  return { active: list.some((t) => t.id === active) ? active : list[0]?.id, list: list.slice(0, 40) };
}

let counter = 0;
export function newTabId(now = Date.now()): string {
  counter = (counter + 1) % 1000;
  return `t${now.toString(36)}${counter.toString(36)}`;
}

/** After closing a tab: the one to show next (the neighbour on the right, else the left one). */
export function nextActive(tabs: TabInfo[], closing: string, active?: string): string | undefined {
  if (active !== closing) return active;
  const i = tabs.findIndex((t) => t.id === closing);
  const rest = tabs.filter((t) => t.id !== closing);
  if (!rest.length) return undefined;
  return (rest[Math.min(Math.max(i, 0), rest.length - 1)] ?? rest[0])!.id;
}

// ---------- address panel suggestions ----------

export type SuggestionKind = 'go' | 'search' | 'clip' | 'tab' | 'bookmark' | 'history' | 'site' | 'suggest';

export interface Suggestion {
  kind: SuggestionKind;
  title: string;
  url: string;
  sub?: string;
  tabId?: string;
  site?: SiteId;
}

/**
 * Rows for the address panel. Order: what the typed text does (open / search), the copied link, open
 * tabs, bookmarks, history, sites OnePlace knows, then the search engine's guesses. Each address once.
 */
export function suggestions(o: {
  input: string;
  engine: SearchEngine;
  history: Visit[];
  bookmarks: Bookmark[];
  tabs: TabInfo[];
  activeId?: string;
  remote?: string[];
  clip?: string;
}): Suggestion[] {
  const q = o.input.trim();
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (s: Suggestion, max?: { n: number; kind: SuggestionKind }) => {
    if (max && out.filter((x) => x.kind === max.kind).length >= max.n) return;
    const key = s.kind === 'search' || s.kind === 'suggest' ? `?${s.title.toLowerCase()}` : pageKey(s.url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  if (q) {
    const target = toUrl(q, o.engine);
    if (target) push(target.search ? { kind: 'search', title: q, url: target.url } : { kind: 'go', title: target.url, url: target.url });
  }
  if (o.clip && (!q || o.clip.toLowerCase().includes(q.toLowerCase()))) push({ kind: 'clip', title: o.clip, url: o.clip });
  if (!q) return out;
  const w = words(q);
  const has = (title: string, url: string) => {
    const hay = `${title} ${url}`.toLowerCase();
    return w.every((x) => hay.includes(x));
  };
  for (const t of o.tabs) if (t.id !== o.activeId && t.url && has(t.title, t.url)) push({ kind: 'tab', title: t.title || displayHost(t.url), url: t.url, sub: displayHost(t.url), tabId: t.id }, { n: 2, kind: 'tab' });
  for (const b of o.bookmarks) if (has(b.title, b.url)) push({ kind: 'bookmark', title: b.title, url: b.url, sub: displayHost(b.url) }, { n: 3, kind: 'bookmark' });
  for (const v of searchVisits(o.history, q, 6)) push({ kind: 'history', title: v.title, url: v.url, sub: displayHost(v.url) }, { n: 4, kind: 'history' });
  const low = q.toLowerCase();
  for (const s of Object.values(SITES)) {
    if (!s.home || s.id === 'other') continue;
    if (s.name.toLowerCase().startsWith(low) || s.id.startsWith(low)) push({ kind: 'site', title: s.name, url: s.home, sub: displayHost(s.home), site: s.id }, { n: 2, kind: 'site' });
  }
  for (const r of o.remote ?? []) {
    if (r.trim().toLowerCase() === low) continue;
    push({ kind: 'suggest', title: r, url: fill(ENGINES[o.engine].search, r) }, { n: 6, kind: 'suggest' });
  }
  return out;
}

/** OpenSearch suggestion JSON → the list of phrases (anything else → empty). */
export function parseSuggest(raw: unknown): string[] {
  if (!Array.isArray(raw) || !Array.isArray(raw[1])) return [];
  return (raw[1] as unknown[]).filter((x): x is string => typeof x === 'string' && x.length < 200).slice(0, 8);
}

// ---------- storage ----------

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: not fatal
  }
}

const cleared = new Set<() => void>();

/** History cleared from Settings: the browser screen forgets it too. */
export const historyBus = {
  clear(): void {
    store.setHistory([]);
    cleared.forEach((cb) => cb());
  },
  onClear(cb: () => void): () => void {
    cleared.add(cb);
    return () => {
      cleared.delete(cb);
    };
  },
};

export const store = {
  history: () => read<Visit[]>('op.history', []).filter((v) => v && typeof v.url === 'string'),
  setHistory: (v: Visit[]) => write('op.history', v),
  bookmarks: () => read<Bookmark[]>('op.bookmarks', []).filter((v) => v && typeof v.url === 'string'),
  setBookmarks: (v: Bookmark[]) => write('op.bookmarks', v),
  shortcuts: () => ({ pinned: [], hidden: [], ...read<Partial<ShortcutPrefs>>('op.shortcuts', {}) }) as ShortcutPrefs,
  setShortcuts: (v: ShortcutPrefs) => write('op.shortcuts', v),
  tabs: () => {
    const t = read<SavedTabs>('op.tabs', { list: [] });
    return { ...t, list: Array.isArray(t.list) ? t.list.filter((x) => x && typeof x.id === 'string' && typeof x.url === 'string') : [] };
  },
  setTabs: (v: SavedTabs) => write('op.tabs', v),
};
