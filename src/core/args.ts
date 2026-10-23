import type { DownloadSpec } from './types.ts';

// DownloadSpec → command-line arguments for yt-dlp / gallery-dl.
// The URL, output folder (-P / -D), cookies and cache dir are added natively.

/** Output file names. `.180B` keeps names under Android's 255-byte limit even for Hindi titles. */
export const OUT_TEMPLATE = '%(title).180B.%(ext)s';
export const OUT_TEMPLATE_PLAYLIST = '%(playlist_index)03d. %(title).170B.%(ext)s';

/** Crops embedded cover art to a square (album style). Recipe from yt-dlp issue #429. */
const SQUARE_COVER_PPA = `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`;

const COMMON = ['--newline', '--no-mtime', '--color', 'never', '--windows-filenames'];

/** Format sort: resolution first, then (for "Most compatible") H.264 video + AAC audio. */
export function formatSort(maxRes: number | undefined, compat: boolean): string {
  const res = maxRes ? `res:${maxRes}` : 'res';
  return compat ? `${res},fps,vcodec:h264,acodec:m4a` : `${res},fps`;
}

export function ytdlpArgs(spec: DownloadSpec): string[] {
  const a = [...COMMON];
  if (spec.playlist) {
    a.push('--yes-playlist', '-o', OUT_TEMPLATE_PLAYLIST, '--sleep-interval', '2', '--max-sleep-interval', '5');
    if (spec.playlistEnd) a.push('-I', `1:${spec.playlistEnd}`);
  } else {
    a.push('--no-playlist', '-o', OUT_TEMPLATE);
  }

  switch (spec.mode) {
    case 'video': {
      const compat = spec.compat ?? true;
      a.push('-f', spec.formatId ?? 'bv*+ba/b', '-S', formatSort(spec.maxRes, compat));
      a.push('--merge-output-format', compat ? 'mp4' : 'mp4/mkv', '--embed-metadata');
      break;
    }
    case 'audio': {
      const fmt = spec.audio ?? 'mp3';
      if (fmt === 'original') a.push('-f', 'ba/b', '-x');
      else if (fmt === 'm4a') a.push('-f', 'ba[ext=m4a]/ba/b', '-x', '--audio-format', 'm4a');
      else if (fmt === 'opus') a.push('-f', 'ba[acodec=opus]/ba/b', '-x', '--audio-format', 'opus');
      else a.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', `${spec.bitrate ?? 320}K`);
      a.push('--embed-metadata');
      if (spec.embedCover ?? true) {
        a.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
        if (spec.squareCover) a.push('--ppa', SQUARE_COVER_PPA);
      }
      break;
    }
    case 'thumbnail':
      a.push('--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg');
      break;
    case 'photo':
      // Photos are gallery-dl's job; if yt-dlp gets here, take whatever media it finds.
      a.push('-f', 'bv*+ba/b');
      break;
  }
  return a;
}

export function galleryArgs(spec: DownloadSpec): string[] {
  const a = ['--no-mtime', '--sleep-request', '1'];
  if (spec.range) a.push('--range', spec.range);
  else if (spec.playlistEnd) a.push('--range', `1-${spec.playlistEnd}`);
  return a;
}

// ---------- safety ----------

/**
 * Options remote config may add (per site), e.g. a new YouTube client when YouTube changes.
 * Anything that runs commands, reads other files or moves output is rejected.
 */
const REMOTE_ALLOWED = new Set([
  '--extractor-args',
  '--user-agent',
  '--add-headers',
  '--referer',
  '--sleep-requests',
  '--sleep-interval',
  '--max-sleep-interval',
  '--force-ipv4',
  '--force-ipv6',
  '--impersonate',
  '--compat-options',
  '-S',
  '--format-sort',
  '--throttled-rate',
  '--http-chunk-size',
  '--concurrent-fragments',
  '-N',
  '--retries',
  '--fragment-retries',
  '--extractor-retries',
  '--geo-bypass',
  '--no-check-certificates',
]);

/** Options that are never allowed, even in user templates: they run commands or touch other files. */
const NEVER = [
  /^--exec/,
  /^--config-locations?$/,
  /^--plugin-dirs$/,
  /^--load-info-json$/,
  /^-a$|^--batch-file$/,
  /^--cookies-from-browser$/,
  /^-U$|^--update/,
  /^--external-downloader-args$|^--downloader-args$/,
  /^-P$|^--paths$/,
  /^--ffmpeg-location$/,
  /^--js-runtimes$/,
];

/** Keep only option/value pairs from `args` that remote config is allowed to set. */
export function safeRemoteArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const opt = args[i];
    if (typeof opt !== 'string' || !REMOTE_ALLOWED.has(opt)) continue;
    const next = args[i + 1];
    const takesValue = !['--force-ipv4', '--force-ipv6', '--geo-bypass', '--no-check-certificates'].includes(opt);
    if (takesValue) {
      if (typeof next !== 'string' || next.startsWith('-')) continue;
      out.push(opt, next);
      i++;
    } else out.push(opt);
  }
  return out;
}

/** Drop dangerous options (and their values) from user-written extra arguments. */
export function stripDangerous(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const [opt, inline] = [args[i].split('=')[0], args[i].includes('=')];
    if (!NEVER.some((re) => re.test(opt))) {
      out.push(args[i]);
      continue;
    }
    // "--exec cmd": skip the value too, or yt-dlp would treat it as a URL.
    if (!inline && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
  }
  return out;
}

/** Split a user's options string like a shell would (quotes, no expansion). */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | '' = '';
  let has = false;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
