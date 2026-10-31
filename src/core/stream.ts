import { detect } from './links.ts';
import type { MediaItem } from './media.ts';

// Playing links without downloading them (YouTube and YT Music in OnePlace's player): the items the
// players get, where "Up next" comes from, and what SponsorBlock skips. Pure, unit-tested.

/** SponsorBlock: paid sponsor reads, self-promotion, "like and subscribe" reminders… */
export const SKIP_VIDEO = ['sponsor', 'selfpromo', 'interaction'];
/** …and in music, the parts of music videos that aren't music. */
export const SKIP_MUSIC = [...SKIP_VIDEO, 'music_offtopic'];

/** The YouTube video id of a watch / Shorts / live / youtu.be / YT Music address. */
export function ytId(url: string): string | undefined {
  const d = detect(url);
  if (d.site !== 'youtube' && d.site !== 'ytmusic') return undefined;
  return d.id && /^[\w-]{11}$/.test(d.id) ? d.id : undefined;
}

export const ytThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : undefined);

/** A link to play, shaped like a Library item so the players, mini player and lock screen work as usual. */
export function streamItem(o: { url: string; title?: string; artist?: string; thumb?: string; dur?: number; audio?: boolean }): MediaItem {
  const d = detect(o.url);
  const id = ytId(o.url);
  // One address per YouTube video (YT Music links too), so "continue where you stopped" finds it.
  const uri = id ? `https://www.youtube.com/watch?v=${id}` : d.url;
  const title = str(o.title) ?? (id ? 'YouTube' : d.url);
  return {
    key: id ? `yt:${id}` : `web:${d.url}`,
    jobId: '',
    index: 0,
    kind: o.audio ? 'audio' : 'video',
    file: { uri, name: title, mime: o.audio ? 'audio/mp4' : 'video/mp4', size: 0 },
    title,
    ...(str(o.artist) ? { artist: str(o.artist) } : {}),
    site: d.site,
    url: d.url,
    date: Date.now(),
    ...(num(o.dur) ? { dur: num(o.dur) } : {}),
    thumbs: [o.thumb, id ? ytThumb(id) : undefined].filter((x): x is string => !!x && /^https:\/\//.test(x)),
    subs: [],
    stream: true,
  };
}

/**
 * Where the rest of the queue comes from: the link's own playlist or album, else (with autoplay) YouTube's
 * mix for this video — a radio of similar songs on YT Music.
 */
export function queueUrl(url: string, autoplay: boolean, music: boolean): string | undefined {
  let list: string | null = null;
  try {
    list = new URL(url).searchParams.get('list');
  } catch {
    return undefined;
  }
  const id = ytId(url);
  if (list && /^[\w-]{2,80}$/.test(list)) return id ? `https://www.youtube.com/watch?v=${id}&list=${list}` : `https://www.youtube.com/playlist?list=${list}`;
  if (autoplay && id) return `https://www.youtube.com/watch?v=${id}&list=${music ? 'RDAMVM' : 'RD'}${id}`;
  return undefined;
}

/** yt-dlp's list answer (--flat-playlist -J) → the items after the one playing, each once. */
export function entriesToItems(raw: unknown, audio: boolean, playingId?: string, max = 60): MediaItem[] {
  const entries = (raw as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  const ids = entries.map((e) => (e && typeof e === 'object' ? str((e as Record<string, unknown>).id) : undefined));
  // A playlist opened at a song: queue what comes after it (a mix starts with the song itself).
  const at = playingId ? ids.indexOf(playingId) : -1;
  const out: MediaItem[] = [];
  const seen = new Set<string>(playingId ? [playingId] : []);
  for (let i = at + 1; i < entries.length && out.length < max; i++) {
    const x = entries[i] as Record<string, unknown> | null;
    const id = ids[i];
    if (!x || !id || !/^[\w-]{11}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(
      streamItem({
        url: `https://${audio ? 'music' : 'www'}.youtube.com/watch?v=${id}`,
        title: str(x.title),
        artist: str(x.channel) ?? str(x.uploader),
        dur: num(x.duration),
        audio,
      }),
    );
  }
  return out;
}

/** "sponsor" → the words for the "Skipped …" message key. */
export function skipLabel(category: string): 'yt.skipSponsor' | 'yt.skipPromo' | 'yt.skipReminder' | 'yt.skipNonMusic' | 'yt.skipPart' {
  switch (category) {
    case 'sponsor':
      return 'yt.skipSponsor';
    case 'selfpromo':
      return 'yt.skipPromo';
    case 'interaction':
      return 'yt.skipReminder';
    case 'music_offtopic':
      return 'yt.skipNonMusic';
    default:
      return 'yt.skipPart';
  }
}
