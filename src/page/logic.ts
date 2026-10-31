import { detect } from '../core/links.ts';
import type { LinkKind, SiteId } from '../core/types.ts';

// The page script's decisions that need no page (so tests can run them): which rules apply to a site,
// which links and files are worth reporting, the largest picture of a srcset, and the like.

/** Rules the app sends into every page (already checked on the native side). */
export interface PageCfg {
  /** Site → CSS selectors to hide (ads, "open the app" banners…). */
  hide: Record<string, string[]>;
  /** Site → selector of a post's own link, to tie the video on screen to its post. */
  links: Record<string, string>;
  /** Site → JSON paths to delete from the page's data (ad slots). */
  prune: Record<string, string[]>;
  /** YouTube / YT Music play in OnePlace's player (v1.0.18). */
  takeover?: boolean;
}

export const EMPTY_CFG: PageCfg = { hide: {}, links: {}, prune: {} };

/** "m.youtube.com" matches rules for "youtube.com" (and "music.youtube.com" those for both). */
export function hostMatches(host: string, key: string): boolean {
  const h = host.toLowerCase();
  return h === key || h.endsWith(`.${key}`);
}

export function rulesFor<T>(map: Record<string, T>, host: string): T[] {
  const out: T[] = [];
  for (const [key, v] of Object.entries(map)) if (hostMatches(host, key)) out.push(v);
  return out;
}

/** Our own hiding CSS from plain selectors (the rules can't carry style text, so they can't leak data). */
export function hideCss(selectors: string[]): string {
  const ok = selectors.filter((s) => s && s.length <= 200 && !/[{}@\\<]|url\(/i.test(s));
  return ok.length ? `${ok.join(',\n')} { display: none !important; }` : '';
}

/** srcset "a.jpg 320w, b.jpg 1080w" → "b.jpg" (or the "2x" one). */
export function largestSrc(srcset: string, base: string): string | undefined {
  let bestUrl: string | undefined;
  let bestScore = -1;
  for (const part of srcset.split(/,\s+/)) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const n = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 1;
    if (n > bestScore) {
      bestScore = n;
      bestUrl = u;
    }
  }
  if (!bestUrl) return undefined;
  try {
    return new URL(bestUrl, base).href;
  } catch {
    return undefined;
  }
}

/** Media that can be fetched again by address (not blob:/data: made inside the page). */
export function fetchable(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url) && url.length < 4096;
}

const CONTENT: ReadonlySet<LinkKind> = new Set(['video', 'short', 'live', 'song', 'reel', 'post', 'story', 'highlight', 'audio', 'playlist', 'album']);

export interface LinkHit {
  url: string;
  site: SiteId;
  kind: LinkKind;
}

/** A link to a post/video/song OnePlace can download (not a profile or a home page). */
export function contentLink(href: string, base: string): LinkHit | undefined {
  let abs: string;
  try {
    abs = new URL(href, base).href;
  } catch {
    return undefined;
  }
  if (!/^https?:/i.test(abs)) return undefined;
  const d = detect(abs);
  if (d.site === 'other' || !CONTENT.has(d.kind)) return undefined;
  return { url: d.url, site: d.site, kind: d.kind };
}

/** Text worth showing as a title: one line, no more than 120 characters. */
export function tidy(text: string | null | undefined, max = 120): string | undefined {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Pictures big enough to be content rather than icons and buttons. */
export const bigImage = (w: number, h: number) => w >= 300 && h >= 200;

/** Delete the given dotted paths ("playerResponse.adPlacements") from an object, in place. True if any. */
export function prune(obj: unknown, paths: string[]): boolean {
  if (!obj || typeof obj !== 'object') return false;
  let hit = false;
  for (const p of paths) {
    const keys = p.split('.');
    let cur: unknown = obj;
    for (let i = 0; i < keys.length - 1 && cur && typeof cur === 'object'; i++) cur = (cur as Record<string, unknown>)[keys[i]!];
    const last = keys.at(-1)!;
    if (cur && typeof cur === 'object' && last in (cur as object)) {
      delete (cur as Record<string, unknown>)[last];
      hit = true;
    }
  }
  return hit;
}
