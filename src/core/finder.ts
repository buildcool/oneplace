import { bytes, duration } from './format.ts';
import { cleanUrl, detect } from './links.ts';
import { audioSpec, buildRequest, isMusic, videoSpec, type Settings } from './settings.ts';
import { KIND_LABEL } from './sites.ts';
import type { Job, JobRequest, LinkKind, SiteId } from './types.ts';

// The browser's content finder: what was found on a page (by the page script and by watching the
// page's requests), merged into one list, labelled, and turned into downloads. Pure, unit-tested.

export type FoundKind = 'video' | 'audio' | 'image' | 'file';

/**
 * page: the page itself is a post/video OnePlace supports · view: the media on screen right now ·
 * link: a supported link on the page · media: a media file or stream the page loaded · image: a photo.
 */
export type FoundSource = 'page' | 'view' | 'link' | 'media' | 'image';

export interface Variant {
  /** Height in pixels when known (HLS/DASH). */
  height?: number;
  /** Bits per second. */
  bandwidth?: number;
  /** Estimated bytes for the whole video. */
  size?: number;
}

export interface Found {
  key: string;
  url: string;
  kind: FoundKind;
  source: FoundSource;
  title?: string;
  thumb?: string;
  size?: number;
  mime?: string;
  dur?: number;
  w?: number;
  h?: number;
  /** A playlist of pieces (HLS m3u8 / DASH mpd) rather than one file. */
  stream?: 'hls' | 'dash';
  variants?: Variant[];
  /** Locked with DRM: shown, never offered for download. */
  drm?: boolean;
  /** Supported links: whose and what. */
  site?: SiteId;
  linkKind?: LinkKind;
  at: number;
}

/** Kinds of supported links worth offering (not profiles, channels or home pages). */
const CONTENT: ReadonlySet<LinkKind> = new Set(['video', 'short', 'live', 'song', 'reel', 'post', 'story', 'highlight', 'audio', 'playlist', 'album']);

export const isContentLink = (kind: LinkKind) => CONTENT.has(kind);

const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mkv|flv|3gp|mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|m3u8|mpd|jpe?g|png|webp|gif|avif)$/i;

/**
 * Same media, one row. Files with a media extension are told apart by their address without the
 * query (CDNs sign the same file differently each time); everything else by its cleaned address.
 */
export function foundKey(url: string, source: FoundSource): string {
  if (source === 'page' || source === 'link' || source === 'view') {
    const d = detect(url);
    // The same post by its id, whatever the address looks like (www., m., share parameters…).
    if (d.site !== 'other') return d.id ? `l:${d.site}:${d.id}` : `l:${d.url.replace(/^https?:\/\/(www\.|m\.)?/, '')}`;
  }
  try {
    const u = new URL(url);
    if (MEDIA_EXT.test(u.pathname)) return `m:${u.host.toLowerCase()}${u.pathname}`;
    return `m:${cleanUrl(url)}`;
  } catch {
    return `m:${url}`;
  }
}

const richer = <T>(a: T | undefined, b: T | undefined) => (b === undefined || b === null || b === '' ? a : b);

/** Add newly found items; known ones get the new details (a size, a title, a picture…). At most 200 kept. */
export function mergeFound(list: Found[], add: Found[], max = 200): Found[] {
  if (!add.length) return list;
  const map = new Map(list.map((f) => [f.key, f]));
  for (const f of add) {
    const old = map.get(f.key);
    if (!old) {
      map.set(f.key, f);
      continue;
    }
    map.set(f.key, {
      ...old,
      title: richer(old.title, f.title),
      thumb: richer(old.thumb, f.thumb),
      size: Math.max(old.size ?? 0, f.size ?? 0) || undefined,
      mime: richer(old.mime, f.mime),
      dur: richer(old.dur, f.dur),
      w: richer(old.w, f.w),
      h: richer(old.h, f.h),
      stream: richer(old.stream, f.stream),
      variants: f.variants?.length ? f.variants : old.variants,
      drm: old.drm || f.drm,
      // "view" is a moment; what it was found as before stays.
      source: old.source === 'media' && f.source === 'link' ? old.source : f.source === 'view' ? old.source : f.source,
    });
  }
  const all = [...map.values()];
  return all.length > max ? all.sort((a, b) => b.at - a.at).slice(0, max) : all;
}

/** The page itself when it is a post/video/song OnePlace supports (with the page's own title and picture). */
export function thisPage(page: { url: string; title?: string; pageTitle?: string; image?: string }, now = Date.now()): Found | undefined {
  const d = detect(page.url);
  if (d.site === 'other' || !isContentLink(d.kind)) return undefined;
  const kind: FoundKind = isMusic(d) ? 'audio' : d.kind === 'post' ? 'image' : 'video';
  return {
    key: foundKey(d.url, 'page'),
    url: d.url,
    kind,
    source: 'page',
    title: page.pageTitle || page.title || undefined,
    thumb: page.image,
    site: d.site,
    linkKind: d.kind,
    at: now,
  };
}

/** Lights the finder button: anything but photos (pages are full of pictures). */
export const counts = (f: Found) => f.kind !== 'image' && !f.drm;

export type FinderFilter = 'all' | 'video' | 'audio' | 'image';

export function matches(f: Found, filter: FinderFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'image') return f.kind === 'image';
  if (filter === 'audio') return f.kind === 'audio';
  return f.kind === 'video' || f.kind === 'file';
}

const KIND_ORDER: Record<FoundKind, number> = { video: 0, audio: 1, file: 2, image: 3 };

/** Best first: on screen, then videos and songs by size, supported links, photos by size; newest breaks ties. */
export function sortFound(list: Found[]): Found[] {
  const area = (f: Found) => (f.w ?? 0) * (f.h ?? 0);
  return [...list].sort((a, b) => {
    if ((a.source === 'view') !== (b.source === 'view')) return a.source === 'view' ? -1 : 1;
    if (a.drm !== b.drm) return a.drm ? 1 : -1;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    const sa = a.size ?? (a.stream ? 1e12 : 0);
    const sb = b.size ?? (b.stream ? 1e12 : 0);
    if (sa !== sb) return sb - sa;
    if (area(a) !== area(b)) return area(b) - area(a);
    return b.at - a.at;
  });
}

export const best = (f: Found): Variant | undefined => [...(f.variants ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];

export const qualityLabel = (h?: number) => (!h ? '' : h >= 2160 ? '4K' : h >= 1440 ? '1440p' : `${h}p`);

/** "720p · 3:45 · 24 MB", "HLS · 4 qualities", "Reel". */
export function foundMeta(f: Found): string {
  const parts: string[] = [];
  if (f.source === 'page' || f.source === 'link' || f.source === 'view') {
    if (f.linkKind) parts.push(KIND_LABEL[f.linkKind]);
  }
  const top = best(f);
  const h = f.h ?? top?.height;
  if (f.kind !== 'image' && h) parts.push(qualityLabel(h));
  if (f.kind === 'image' && f.w && f.h) parts.push(`${f.w} × ${f.h}`);
  if (f.dur) parts.push(duration(f.dur));
  const size = f.size ?? top?.size;
  if (size) parts.push(bytes(size));
  if (f.variants && f.variants.length > 1) parts.push(`${f.variants.length} qualities`);
  else if (f.stream && !parts.length) parts.push(f.stream.toUpperCase());
  return parts.filter(Boolean).join(' · ');
}

/** A name from the file address when the page gives none: ".../My%20Song.mp3?x" → "My Song". */
export function nameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
    return last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 120);
  } catch {
    return '';
  }
}

/** Links already downloaded (or downloading), to mark them "✓ Downloaded". */
export function downloadedKeys(jobs: Job[]): Set<string> {
  const out = new Set<string>();
  for (const j of jobs) {
    if (j.status === 'failed' || j.status === 'canceled') continue;
    out.add(foundKey(j.url, 'link'));
    out.add(foundKey(j.url, 'media'));
  }
  return out;
}

export const isDownloaded = (f: Found, keys: Set<string>) => keys.has(f.key);

/** Where the browser got a file from: its page, user agent and cookies go with the download. */
export interface PageContext {
  pageUrl: string;
  pageTitle?: string;
  userAgent?: string;
  /** Private tabs: the cookies stay in the private profile. */
  private?: boolean;
}

/**
 * A media file, stream or photo found on a page → a download. Videos and songs go through yt-dlp (it
 * resumes, and joins HLS/DASH pieces); photos and other files through the plain http engine. [height]
 * picks a quality of a stream; [audio] saves only the sound.
 */
export function mediaRequest(f: Found, ctx: PageContext, s: Settings, o: { height?: number; audio?: boolean } = {}): JobRequest {
  const title = (f.title || ctx.pageTitle || nameFromUrl(f.url) || 'Download').slice(0, 150);
  const headers: NonNullable<JobRequest['headers']> = {
    referer: ctx.pageUrl,
    ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
    cookieUrls: [ctx.pageUrl, f.url],
    ...(ctx.private ? { private: true } : {}),
  };
  const link = { url: f.url, site: 'other' as SiteId, kind: 'unknown' as LinkKind };
  if (f.kind === 'image' || f.kind === 'file') {
    return {
      ...buildRequest({ link, engine: 'http', spec: { mode: 'photo' }, title, thumb: f.kind === 'image' ? f.url : f.thumb, httpUrls: [f.url], imageFormat: 'original' }),
      headers,
    };
  }
  const audio = o.audio || f.kind === 'audio';
  const spec = audio ? audioSpec(s) : videoSpec(s, o.height ? { maxRes: o.height } : {});
  return {
    ...buildRequest({ link, engine: 'ytdlp', spec, title, thumb: f.thumb, expectedBytes: f.size }),
    headers,
  };
}
