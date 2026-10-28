import type { YtThumb } from './formats.ts';
import { isCollection } from './links.ts';
import type { Link } from './types.ts';

// Thumbnail choices. YouTube thumbnails follow fixed URLs, so they work instantly from the
// video id; other sites use the list yt-dlp returns.

export interface ThumbChoice {
  key: string;
  label: string;
  width?: number;
  height?: number;
  /** URLs tried in order until one exists (YouTube has no maxres image for some videos). */
  urls: string[];
}

/** A picture to show before the link has been read (only YouTube's are known from the link alone). */
export function previewThumb(link: Pick<Link, 'site' | 'kind' | 'id'>): string | undefined {
  if ((link.site === 'youtube' || link.site === 'ytmusic') && link.id && !isCollection(link.kind)) return `https://i.ytimg.com/vi/${link.id}/hqdefault.jpg`;
  return undefined;
}

/** All YouTube sizes for a video id, biggest first. */
export function youtubeThumbs(id: string): ThumbChoice[] {
  const u = (name: string) => `https://i.ytimg.com/vi/${id}/${name}.jpg`;
  return [
    { key: 'max', label: 'Max', width: 1280, height: 720, urls: [u('maxresdefault'), u('hq720'), u('sddefault'), u('hqdefault')] },
    { key: 'sd', label: 'SD', width: 640, height: 480, urls: [u('sddefault'), u('hqdefault')] },
    { key: 'hq', label: 'HQ', width: 480, height: 360, urls: [u('hqdefault')] },
    { key: 'mq', label: 'Medium', width: 320, height: 180, urls: [u('mqdefault')] },
    { key: 'small', label: 'Small', width: 120, height: 90, urls: [u('default')] },
  ];
}

/** Thumbnail choices for any link: YouTube by id, otherwise the engine's list (largest first, max 4). */
export function thumbChoices(link: Pick<Link, 'site' | 'id'>, list: YtThumb[] = [], fallback?: string): ThumbChoice[] {
  if ((link.site === 'youtube' || link.site === 'ytmusic') && link.id && /^[\w-]{11}$/.test(link.id)) return youtubeThumbs(link.id);
  const seen = new Set<string>();
  const sorted = [...list]
    .filter((t) => t.url && !/\.svg(\?|$)/.test(t.url))
    .sort((a, b) => area(b) - area(a) || (b.preference ?? 0) - (a.preference ?? 0));
  const out: ThumbChoice[] = [];
  for (const t of sorted) {
    if (seen.has(t.url)) continue;
    seen.add(t.url);
    out.push({
      key: `t${out.length}`,
      label: t.width && t.height ? `${t.width}×${t.height}` : out.length ? `Option ${out.length + 1}` : 'Best',
      width: t.width,
      height: t.height,
      urls: [t.url],
    });
    if (out.length >= 4) break;
  }
  if (!out.length && fallback) out.push({ key: 'best', label: 'Best', urls: [fallback] });
  return out;
}

const area = (t: YtThumb) => (t.width ?? 0) * (t.height ?? 0);
