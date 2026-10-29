// The Library's view of finished downloads: one item per video, song or photo, newest first.
// Pure (no DOM, no Capacitor) so it is unit-tested.

import type { Job, JobFile } from './types.ts';

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaItem {
  /** `${jobId}:${index}`, stable while the file exists. */
  key: string;
  jobId: string;
  /** Position of the file in its job. */
  index: number;
  kind: MediaKind;
  file: JobFile;
  title: string;
  artist?: string;
  site: string;
  /** The page it was downloaded from. */
  url: string;
  date: number;
  dur?: number;
  w?: number;
  h?: number;
  /** Pictures to try in order: local first (works offline), then the site's own. */
  thumbs: string[];
  /** Subtitle files that came with this video. */
  subs: JobFile[];
  /** One of several items from the same post or playlist. */
  part?: { n: number; of: number };
  /** Vocal remover copy: the item it was made from, and which part it keeps. */
  editOf?: string;
  stem?: 'music' | 'vocals';
}

export const kindOf = (mime: string): MediaKind | undefined =>
  mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('image/') ? 'image' : undefined;

const SUBTITLE = /\.(srt|vtt|ass|ssa)$/i;
const isSubtitle = (f: JobFile) => SUBTITLE.test(f.name) || f.mime === 'application/x-subrip' || f.mime === 'text/vtt';

/** "Song [id].mp3" → "Song [id]"; subtitles also lose the language: "Song [id].en.srt" → "Song [id]". */
function base(name: string): string {
  const noExt = name.replace(/\.[^.]+$/, '');
  return SUBTITLE.test(name) ? noExt.replace(/\.[\w-]{2,12}$/, '') : noExt;
}

/** yt-dlp names files "Title [id].ext"; the Library shows "Title". */
export function titleFromName(name: string): string {
  return base(name)
    .replace(/\s*\[[\w-]{6,}\]$/, '')
    .replace(/^\d{1,4}\.\s+/, '')
    .trim();
}

export function mediaItems(jobs: Job[]): MediaItem[] {
  const out: MediaItem[] = [];
  for (const j of jobs) {
    if (j.status !== 'done' || !j.files.length) continue;
    const media = j.files.map((file, index) => ({ file, index, kind: kindOf(file.mime) })).filter((m) => m.kind && !isSubtitle(m.file));
    // A picture with the same name as a song or video is its cover, not a separate photo.
    const playable = media.filter((m) => m.kind !== 'image');
    const covers = new Map<string, string>();
    const photos = media.filter((m) => {
      if (m.kind !== 'image') return true;
      const owner = playable.find((p) => base(p.file.name) === base(m.file.name));
      if (owner) covers.set(owner.file.uri, m.file.uri);
      return !owner;
    });
    const subs = j.files.filter(isSubtitle);
    const videos = photos.filter((m) => m.kind === 'video');
    const single = photos.length === 1;
    photos.forEach((m, n) => {
      const f = m.file;
      const kind = m.kind!;
      const own = kind === 'image' ? [f.thumb, f.uri] : [f.thumb, covers.get(f.uri)];
      // The job's picture belongs to the whole post or playlist: only use it for a single item.
      const shared = single ? [j.thumb, j.preview] : [];
      out.push({
        key: `${j.id}:${m.index}`,
        jobId: j.id,
        index: m.index,
        kind,
        file: f,
        title: f.title || (single ? j.title : '') || titleFromName(f.name) || j.title,
        artist: f.artist,
        site: j.site,
        url: j.url,
        date: j.finishedAt ?? j.createdAt,
        dur: f.dur,
        w: f.w,
        h: f.h,
        thumbs: uniq([...own, ...shared]),
        subs: kind === 'video' ? (videos.length === 1 ? subs : subs.filter((s) => base(s.name).startsWith(base(f.name)))) : [],
        ...(single ? {} : { part: { n: n + 1, of: photos.length } }),
        ...(j.edit ? { editOf: `${j.edit.source.id}:${j.edit.source.index}` } : {}),
        ...(f.stem ? { stem: f.stem } : {}),
      });
    });
  }
  // Newest download first; files of one download keep their order.
  return out.sort((a, b) => b.date - a.date || (a.jobId === b.jobId ? a.index - b.index : a.jobId < b.jobId ? -1 : 1));
}

const uniq = (list: (string | undefined)[]): string[] => [...new Set(list.filter((s): s is string => !!s))];

/** Pictures for a job in the Downloads list: what the phone made, then the site's, then a frame from the download. */
export function jobThumbs(j: Job): string[] {
  const local = j.files.find((f) => f.thumb)?.thumb;
  const photo = j.files.find((f) => f.mime.startsWith('image/'))?.uri;
  return j.status === 'done' ? uniq([local, j.thumb, j.preview, photo]) : uniq([j.thumb, j.preview, local]);
}

// ---------- sorting, search, dates ----------

export type SortKey = 'new' | 'old' | 'big' | 'long' | 'name';

export function sortItems(items: MediaItem[], key: SortKey): MediaItem[] {
  const list = items.slice();
  switch (key) {
    case 'new':
      return list;
    case 'old':
      return list.reverse();
    case 'big':
      return list.sort((a, b) => (b.file.size || 0) - (a.file.size || 0));
    case 'long':
      return list.sort((a, b) => (b.dur ?? -1) - (a.dur ?? -1));
    case 'name':
      return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  }
}

/** Every word must appear in the title, artist, site or file name. */
export function searchItems(items: MediaItem[], query: string): MediaItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const hay = `${it.title} ${it.artist ?? ''} ${it.site} ${it.file.name}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type DateKey = 'today' | 'yesterday' | 'week' | `${number}-${number}`;

/** Today, yesterday, the last 7 days, then calendar months ("2026-9" = October 2026, months from 0). */
export function dateKey(ts: number, now: number): DateKey {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime();
  if (ts >= start) return 'today';
  if (ts >= start - 86_400_000) return 'yesterday';
  if (ts >= start - 6 * 86_400_000) return 'week';
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function groupByDate(items: MediaItem[], now = Date.now()): { key: DateKey; items: MediaItem[] }[] {
  const groups: { key: DateKey; items: MediaItem[] }[] = [];
  for (const it of items) {
    const key = dateKey(it.date, now);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(it);
    else groups.push({ key, items: [it] });
  }
  return groups;
}

/** Short side decides: a vertical 1080×1920 video is 1080p. */
export function resLabel(w?: number, h?: number): string {
  if (!w || !h) return '';
  const s = Math.min(w, h);
  if (s >= 4320) return '8K';
  if (s >= 2160) return '4K';
  if (s >= 1440) return '1440p';
  if (s >= 1080) return '1080p';
  if (s >= 720) return '720p';
  return s >= 144 ? `${s}p` : '';
}

export const isVertical = (it: Pick<MediaItem, 'w' | 'h'>) => !!it.w && !!it.h && it.h > it.w * 1.1;

// ---------- where you left off ----------

/** Seconds watched per file (uri → [seconds, length, when]); the newest 300 are kept. */
export type Positions = Record<string, [number, number, number]>;

const POS_KEY = 'op.pos';
const KEEP = 300;

/** Worth resuming: more than 10 s in and not in the last 5 % (or the last 10 s). */
export function resumeAt(sec: number | undefined, dur: number | undefined): number {
  if (!sec || sec < 10) return 0;
  if (dur && (sec > dur * 0.95 || dur - sec < 10)) return 0;
  return sec;
}

export function withPosition(all: Positions, uri: string, sec: number, dur: number, now = Date.now()): Positions {
  const next = { ...all };
  if (resumeAt(sec, dur)) next[uri] = [Math.round(sec), Math.round(dur), now];
  else delete next[uri];
  const keys = Object.keys(next);
  if (keys.length > KEEP) {
    keys
      .sort((a, b) => next[a]![2] - next[b]![2])
      .slice(0, keys.length - KEEP)
      .forEach((k) => delete next[k]);
  }
  return next;
}

export function loadPositions(): Positions {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Positions) : {};
  } catch {
    return {};
  }
}

export function savePosition(uri: string, sec: number, dur: number): Positions {
  const next = withPosition(loadPositions(), uri, sec, dur);
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(next));
  } catch {
    // storage full or unavailable: resuming is a nicety
  }
  return next;
}

/** 0..1 watched, for the bar under a thumbnail. */
export function watched(p: Positions, uri: string): number {
  const v = p[uri];
  return v && v[1] > 0 ? Math.min(1, v[0] / v[1]) : 0;
}
