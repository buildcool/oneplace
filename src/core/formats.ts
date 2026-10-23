// Turns engine JSON (yt-dlp -J, gallery-dl -j) into the choices shown in the download sheet.

/** The parts of a yt-dlp format we use. */
export interface YtFormat {
  format_id: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  tbr?: number | null;
  abr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  dynamic_range?: string | null;
  protocol?: string;
  format_note?: string;
  language_preference?: number | null;
  has_drm?: boolean | string;
}

export interface YtThumb {
  url: string;
  width?: number;
  height?: number;
  preference?: number;
  id?: string;
}

/** The parts of yt-dlp's info JSON (-J) we use. */
export interface YtInfo {
  _type?: string;
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  creator?: string;
  track?: string;
  album?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: YtThumb[];
  webpage_url?: string;
  url?: string;
  extractor_key?: string;
  formats?: YtFormat[];
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  is_live?: boolean;
  live_status?: string;
  entries?: (YtInfo | null)[];
  playlist_count?: number;
  description?: string;
}

export interface VideoOption {
  key: string;
  /** Short side in pixels (1080 for both 1920×1080 and 1080×1920). */
  res: number;
  fps: number;
  hdr: boolean;
  label: string;
  codec: string;
  /** Container the file will end up in. */
  container: 'MP4' | 'MKV' | 'WEBM';
  size?: number;
  approx: boolean;
  /** yt-dlp -f value, with fallbacks so a changed format list still downloads something. */
  formatSel: string;
}

export interface AudioOption {
  key: 'original' | 'mp3-320' | 'mp3-256' | 'mp3-192' | 'mp3-128' | 'm4a' | 'opus';
  size?: number;
  approx: boolean;
  /** True when the file is re-encoded (never better than the source). */
  converted: boolean;
}

export interface PlaylistEntry {
  id?: string;
  title: string;
  url: string;
  duration?: number;
}

export interface Media {
  title: string;
  author?: string;
  duration?: number;
  thumb?: string;
  id?: string;
  url: string;
  isLive: boolean;
  drm: boolean;
  video: VideoOption[];
  audio: AudioOption[];
  /** Bitrate of the best source audio, for honest labels ("source ≈ 160 kbps"). */
  sourceKbps?: number;
  thumbnails: YtThumb[];
  playlist?: { count: number; entries: PlaylistEntry[] };
}

const isNone = (c?: string | null) => c === 'none';
const known = (c?: string | null): c is string => !!c && c !== 'none';

export function codecName(vcodec?: string | null): string {
  const c = (vcodec ?? '').toLowerCase();
  if (c.startsWith('avc') || c.startsWith('h264')) return 'H.264';
  if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) return 'H.265';
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'VP9';
  if (c.startsWith('av01')) return 'AV1';
  if (c.startsWith('vp8')) return 'VP8';
  return c ? c.split('.')[0].toUpperCase() : '';
}

/** Higher is preferred. "Most compatible" puts H.264 first; otherwise VP9 (good quality, plays on all phones). */
function codecRank(codec: string, compat: boolean): number {
  const order = compat ? ['H.264', 'VP9', 'H.265', 'AV1'] : ['VP9', 'AV1', 'H.265', 'H.264'];
  const i = order.indexOf(codec);
  return i < 0 ? 0 : order.length - i;
}

/** "1080p", "4K", "720p60 HDR". */
export function resLabel(res: number, fps = 30, hdr = false): string {
  const names: Record<number, string> = { 4320: '8K', 2160: '4K', 1440: '2K' };
  const base = names[res] ?? `${res}p`;
  return `${base}${fps > 30 ? Math.round(fps) : ''}${hdr ? ' HDR' : ''}`;
}

function shortSide(f: { width?: number | null; height?: number | null }): number {
  const { width: w, height: h } = f;
  if (w && h) return Math.min(w, h);
  return h ?? w ?? 0;
}

function sizeOf(f: YtFormat, duration?: number): { size?: number; approx: boolean } {
  if (f.filesize) return { size: f.filesize, approx: false };
  if (f.filesize_approx) return { size: f.filesize_approx, approx: true };
  if (f.tbr && duration) return { size: (f.tbr * 1000 * duration) / 8, approx: true };
  return { approx: true };
}

function isVideo(f: YtFormat): boolean {
  if (f.format_note === 'storyboard' || f.ext === 'mhtml' || f.protocol === 'mhtml') return false;
  if (isNone(f.vcodec)) return false;
  return known(f.vcodec) || !!(f.height || f.width);
}

function isAudioOnly(f: YtFormat): boolean {
  return isNone(f.vcodec) && known(f.acodec) && f.format_note !== 'storyboard';
}

/** Best audio stream to merge with a video-only stream. */
export function bestAudio(formats: YtFormat[], compat: boolean): YtFormat | undefined {
  const audios = formats.filter(isAudioOnly);
  const plain = audios.filter((f) => !/drc/i.test(f.format_id));
  const pool = plain.length ? plain : audios;
  const score = (f: YtFormat) =>
    // yt-dlp: 10 = the video's original/default audio track, -1 = normal, -10 = descriptive.
    (f.language_preference ?? -1) * 1e6 +
    (compat && (f.ext === 'm4a' || (f.acodec ?? '').startsWith('mp4a')) ? 1e5 : 0) +
    (f.abr ?? f.tbr ?? 0);
  return pool.reduce<YtFormat | undefined>((best, f) => (!best || score(f) > score(best) ? f : best), undefined);
}

/** Video quality choices, best first. */
export function videoOptions(info: YtInfo, compat: boolean): VideoOption[] {
  const formats = info.formats?.length ? info.formats : info.url ? [{ ...info, format_id: 'best' } as YtFormat] : [];
  const audio = bestAudio(formats, compat);
  const audioSize = audio ? sizeOf(audio, info.duration) : { approx: true };
  const groups = new Map<string, { f: YtFormat; res: number; fps: number; hdr: boolean; codec: string }>();
  for (const f of formats) {
    if (!isVideo(f) || f.has_drm === true) continue;
    const res = shortSide(f);
    if (res && res < 140) continue;
    const fps = f.fps && f.fps > 30 ? 60 : 30;
    const hdr = !!f.dynamic_range && f.dynamic_range !== 'SDR';
    const codec = codecName(f.vcodec);
    const key = `${res}-${fps}-${hdr ? 'hdr' : 'sdr'}`;
    const cur = groups.get(key);
    const better =
      !cur ||
      codecRank(codec, compat) > codecRank(cur.codec, compat) ||
      (codecRank(codec, compat) === codecRank(cur.codec, compat) && (f.tbr ?? 0) > (cur.f.tbr ?? 0));
    if (better) groups.set(key, { f, res, fps, hdr, codec });
  }
  const out: VideoOption[] = [];
  for (const [key, g] of groups) {
    const hasAudio = known(g.f.acodec);
    const unknownAudio = !g.f.acodec;
    const v = sizeOf(g.f, info.duration);
    const merge = !hasAudio && !!audio && (isNone(g.f.acodec) || unknownAudio);
    const size = v.size !== undefined ? v.size + (merge ? (audioSize.size ?? 0) : 0) : undefined;
    const id = g.f.format_id;
    const formatSel = merge ? `${id}+${audio!.format_id}/${id}+ba/${id}/bv*+ba/b` : `${id}/bv*+ba/b`;
    const mp4Like = (g.f.ext === 'mp4' || g.f.ext === 'm4v') && (!merge || audio?.ext === 'm4a' || audio?.ext === 'mp4');
    // Group by 30/60 fps buckets, but label with the real frame rate (50 fps stays "1080p50").
    const fps = g.f.fps ? Math.round(g.f.fps) : 30;
    out.push({
      key,
      res: g.res,
      fps,
      hdr: g.hdr,
      label: g.res ? resLabel(g.res, fps, g.hdr) : 'Original',
      codec: g.codec,
      container: compat || mp4Like ? 'MP4' : 'MKV',
      size,
      approx: v.approx || (merge && audioSize.approx),
      formatSel,
    });
  }
  out.sort((a, b) => b.res - a.res || b.fps - a.fps || Number(b.hdr) - Number(a.hdr));
  return out;
}

/** Audio choices with size estimates. MP3 sizes come from bitrate × duration. */
export function audioOptions(info: YtInfo): { options: AudioOption[]; sourceKbps?: number } {
  const formats = info.formats ?? [];
  const best = bestAudio(formats, false) ?? formats.filter((f) => known(f.acodec)).at(-1);
  const m4a = bestAudio(formats, true);
  const d = info.duration;
  const est = (kbps: number) => (d ? { size: (kbps * 1000 * d) / 8, approx: true } : { approx: true });
  const sourceKbps = best?.abr ? Math.round(best.abr) : undefined;
  const fromFormat = (f?: YtFormat) => (f ? sizeOf(f, d) : est(160));
  const options: AudioOption[] = [
    { key: 'original', ...fromFormat(best), converted: false },
    { key: 'mp3-320', ...est(320), converted: true },
    { key: 'mp3-192', ...est(192), converted: true },
    { key: 'mp3-128', ...est(128), converted: true },
    { key: 'm4a', ...fromFormat(m4a), converted: !(m4a && (m4a.ext === 'm4a' || (m4a.acodec ?? '').startsWith('mp4a'))) },
  ];
  return { options, sourceKbps };
}

/** Parse yt-dlp's -J output for one video or a playlist. */
export function parseYtInfo(info: YtInfo, compat: boolean): Media {
  const isPlaylist = info._type === 'playlist';
  const entries = (info.entries ?? []).filter((e): e is YtInfo => !!e);
  const first = isPlaylist ? undefined : info;
  const { options: audio, sourceKbps } = first ? audioOptions(first) : { options: [] as AudioOption[], sourceKbps: undefined };
  return {
    title: info.track || info.title || 'Untitled',
    author: info.artist || info.creator || info.channel || info.uploader || undefined,
    duration: info.duration,
    thumb: info.thumbnail ?? bestThumbUrl(info.thumbnails) ?? (isPlaylist ? (entries[0]?.thumbnail ?? bestThumbUrl(entries[0]?.thumbnails)) : undefined),
    id: info.id,
    url: info.webpage_url ?? info.url ?? '',
    isLive: !!info.is_live || info.live_status === 'is_live',
    drm: !!info.formats?.length && info.formats.every((f) => f.has_drm === true),
    video: first ? videoOptions(first, compat) : [],
    audio,
    sourceKbps,
    thumbnails: info.thumbnails ?? [],
    playlist: isPlaylist
      ? {
          count: info.playlist_count ?? entries.length,
          entries: entries.map((e) => ({ id: e.id, title: e.title ?? e.id ?? '', url: e.url ?? e.webpage_url ?? '', duration: e.duration })),
        }
      : undefined,
  };
}

function bestThumbUrl(thumbs?: YtThumb[]): string | undefined {
  if (!thumbs?.length) return undefined;
  const scored = thumbs.filter((t) => t.url && !/\.svg/.test(t.url));
  return scored.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) || (b.preference ?? 0) - (a.preference ?? 0))[0]?.url;
}

// ---------- gallery-dl ----------

export interface GalleryItem {
  url: string;
  ext: string;
  isVideo: boolean;
  width?: number;
  height?: number;
  /** 1-based position, used for --range. */
  num: number;
  /** Small preview image (for videos, their cover). */
  preview?: string;
}

export interface Gallery {
  title: string;
  author?: string;
  items: GalleryItem[];
  /** Links gallery-dl would follow (profiles list posts this way). */
  queued: number;
  /** gallery-dl reports problems inside its JSON (it still exits 0), e.g. "HTTP redirect to login page". */
  error?: string;
}

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'm3u8', 'gif']);

/** Parse gallery-dl's -j output: [[2, meta], [3, url, meta], [6, url, meta], …]. */
export function parseGallery(data: unknown): Gallery {
  const msgs = Array.isArray(data) ? (data as unknown[][]) : [];
  const items: GalleryItem[] = [];
  let meta: Record<string, unknown> = {};
  let queued = 0;
  let error: string | undefined;
  for (const m of msgs) {
    if (!Array.isArray(m)) continue;
    if (m[0] === -1 && m[1] && typeof m[1] === 'object') {
      const e = m[1] as Record<string, unknown>;
      error = [str(e.error), str(e.message)].filter(Boolean).join(': ');
    }
    if (m[0] === 2 && m[1] && typeof m[1] === 'object') meta = m[1] as Record<string, unknown>;
    if (m[0] === 6) queued++;
    if (m[0] !== 3 || typeof m[1] !== 'string') continue;
    const kw = (m[2] ?? {}) as Record<string, unknown>;
    if (!Object.keys(meta).length) meta = kw;
    const url = m[1].replace(/^ytdl:/, '');
    const ext = String(kw.extension ?? url.split('?')[0].split('.').pop() ?? '').toLowerCase();
    const isVideo = VIDEO_EXT.has(ext) || !!kw.video_url;
    items.push({
      url,
      ext,
      isVideo,
      width: num(kw.width),
      height: num(kw.height),
      num: items.length + 1,
      preview: isVideo ? str(kw.display_url) ?? str(kw.thumbnail) : url,
    });
  }
  const caption = str(meta.description) ?? str(meta.content) ?? str(meta.title);
  return {
    title: caption ? caption.split('\n')[0].slice(0, 120) : (str(meta.post_shortcode) ?? str(meta.shortcode) ?? 'Post'),
    author: str(meta.username) ?? str(meta.fullname) ?? str(meta.author && (meta.author as Record<string, unknown>).name) ?? str(meta.user),
    items,
    queued,
    ...(error ? { error } : {}),
  };
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Engine output is one JSON document; tolerate stray lines printed before it. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/^[[{]/m);
    return start > 0 ? JSON.parse(text.slice(start)) : undefined;
  }
}
