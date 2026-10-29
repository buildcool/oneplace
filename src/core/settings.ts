import { galleryArgs, ytdlpArgs } from './args.ts';
import { KIND_LABEL, enginesFor, siteInfo } from './sites.ts';
import { previewThumb } from './thumbs.ts';
import type { SortKey } from './media.ts';
import type { AudioFormat, DownloadSpec, EditSpec, EngineId, Job, JobRequest, JobTemplate, Link, LinkKind, Mode } from './types.ts';

export type Lang = 'en' | 'hinglish' | 'hi';
export type VideoQuality = 'best' | 2160 | 1440 | 1080 | 720 | 480 | 360;

export interface Settings {
  lang: Lang;
  theme: 'system' | 'light' | 'dark';
  amoled: boolean;
  /** Use the phone's wallpaper colours (Android 12+). */
  dynamicColor: boolean;
  videoQuality: VideoQuality;
  /** MP4 with H.264/AAC that plays everywhere, instead of the best codec. */
  compat: boolean;
  audioFormat: AudioFormat;
  mp3Bitrate: 320 | 192 | 128;
  embedCover: boolean;
  squareCover: boolean;
  concurrency: 1 | 2 | 3;
  wifiOnly: boolean;
  ytdlpChannel: 'stable' | 'nightly';
  autoEngineUpdate: boolean;
  appChannel: 'stable' | 'beta';
  autoAppUpdate: boolean;
  clipboardChip: boolean;
  /** Opening OnePlace right after copying a link starts downloading it with the usual settings. */
  autoCopied: boolean;
  /** "OnePlace · Video / · MP3 / · Thumbnail" entries in the share menu. */
  quickTargets: boolean;
  /** Remember the last quality picked in the sheet and preselect it. */
  rememberChoice: boolean;
  /** Finished downloads open in OnePlace's own player and viewer, or in another app. */
  openIn: 'app' | 'other';
  /** Leaving the app while a video plays: small floating window, keep the sound going, or pause. */
  leaveVideo: 'pip' | 'audio' | 'pause';
  /** Start videos and songs where you stopped. */
  resume: boolean;
  libSort: SortKey;
  lastVideoKey?: string;
  lastAudioKey?: string;
  skippedBuild?: number;
  onboarded: boolean;
}

export const DEFAULTS: Settings = {
  lang: 'en',
  theme: 'system',
  amoled: false,
  dynamicColor: true,
  videoQuality: 1080,
  compat: true,
  audioFormat: 'mp3',
  mp3Bitrate: 320,
  embedCover: true,
  squareCover: true,
  concurrency: 2,
  wifiOnly: false,
  ytdlpChannel: 'nightly',
  autoEngineUpdate: true,
  appChannel: 'stable',
  autoAppUpdate: true,
  clipboardChip: true,
  autoCopied: true,
  quickTargets: true,
  rememberChoice: true,
  openIn: 'app',
  leaveVideo: 'pip',
  resume: true,
  libSort: 'new',
  onboarded: false,
};

const KEY = 'op.settings';

export function loadSettings(defaultLang: Lang = 'en'): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // private mode / corrupt value: fall through to defaults
  }
  return { ...DEFAULTS, lang: defaultLang };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable; settings still apply for this session
  }
}

// ---------- specs and job requests ----------

export function videoSpec(s: Settings, extra: Partial<DownloadSpec> = {}): DownloadSpec {
  return { mode: 'video', maxRes: s.videoQuality === 'best' ? undefined : s.videoQuality, compat: s.compat, ...extra };
}

export function audioSpec(s: Settings, extra: Partial<DownloadSpec> = {}): DownloadSpec {
  return { mode: 'audio', audio: s.audioFormat, bitrate: s.mp3Bitrate, embedCover: s.embedCover, squareCover: s.squareCover, ...extra };
}

export const destFor = (mode: Mode) => (mode === 'video' ? 'video' : mode === 'audio' ? 'audio' : 'image');

export function template(engine: EngineId, spec: DownloadSpec): JobTemplate {
  const dest = destFor(spec.mode);
  if (engine === 'gallerydl') return { engine, args: galleryArgs(spec), dest: spec.mode === 'audio' ? 'audio' : 'image' };
  if (engine === 'http') return { engine, args: [], dest };
  return { engine, args: ytdlpArgs(spec), dest };
}

/** Photos fallback: when yt-dlp finds no video in a post, gallery-dl downloads its photos. */
const PHOTO_FALLBACK: JobTemplate = template('gallerydl', { mode: 'photo' });

export function buildRequest(o: {
  link: Pick<Link, 'url' | 'site' | 'kind'>;
  engine: EngineId;
  spec: DownloadSpec;
  title: string;
  thumb?: string;
  httpUrls?: string[];
  imageFormat?: JobRequest['imageFormat'];
  crop?: JobRequest['crop'];
  expectedBytes?: number;
  titleFromFile?: boolean;
}): JobRequest {
  const t = template(o.engine, o.spec);
  const canFallback = o.engine === 'ytdlp' && o.spec.mode === 'video' && enginesFor(o.link).includes('gallerydl');
  return {
    ...t,
    url: o.link.url,
    site: o.link.site,
    title: o.title,
    thumb: o.thumb,
    mode: o.spec.mode,
    ...(canFallback ? { fallback: PHOTO_FALLBACK } : {}),
    ...(o.httpUrls ? { httpUrls: o.httpUrls } : {}),
    ...(o.imageFormat ? { imageFormat: o.imageFormat } : {}),
    ...(o.crop ? { crop: o.crop } : {}),
    ...(o.expectedBytes ? { expectedBytes: Math.round(o.expectedBytes) } : {}),
    ...(o.titleFromFile ? { titleFromFile: true } : {}),
  };
}

const MUSIC_SITES = new Set(['ytmusic', 'soundcloud', 'jiosaavn', 'bandcamp', 'mixcloud', 'audiomack']);

/** Links people usually want as audio. */
export const isMusic = (link: Pick<Link, 'site' | 'kind'>) => MUSIC_SITES.has(link.site) || link.kind === 'song' || link.kind === 'audio';

const AUTO_KINDS = new Set<LinkKind>(['video', 'short', 'reel', 'post', 'song', 'audio']);

/**
 * A copied link that is clearly one video, song or post on a known site, so OnePlace may start it
 * without asking. Playlists, profiles, stories, live streams, short links and other pages open the sheet.
 */
export function canAutoStart(link: Link, loggedIn: boolean): boolean {
  return link.site !== 'other' && !link.short && AUTO_KINDS.has(link.kind) && enginesFor(link, loggedIn)[0] === 'ytdlp';
}

/**
 * A download with the usual settings, started before the link has been read ("Start now" in the sheet,
 * copied links). The real title comes from the downloaded file's name.
 */
export function quickRequest(link: Link, s: Settings, mode: 'video' | 'audio' = isMusic(link) ? 'audio' : 'video'): JobRequest {
  return buildRequest({
    link,
    engine: 'ytdlp',
    spec: mode === 'audio' ? audioSpec(s) : videoSpec(s),
    title: `${siteInfo(link.site).name} · ${KIND_LABEL[link.kind]}`,
    thumb: previewThumb(link),
    titleFromFile: true,
  });
}

/**
 * Vocal remover: a new song or video made from a saved file. The original stays as it is.
 * Videos keep their picture unless "as" is audio.
 */
export function editRequest(o: {
  job: Pick<Job, 'id' | 'url' | 'site' | 'title' | 'thumb'>;
  index: number;
  title: string;
  isVideo: boolean;
  keep: EditSpec['keep'];
  as: EditSpec['as'];
  bitrate?: number;
}): JobRequest {
  const audio = o.as === 'audio' || !o.isVideo;
  const suffix = o.keep === 'vocals' ? 'Vocals' : o.keep === 'both' ? 'Karaoke + Vocals' : 'Karaoke';
  return {
    engine: 'edit',
    args: [],
    dest: audio ? 'audio' : 'video',
    url: o.job.url,
    site: o.job.site,
    title: `${o.title} (${suffix})`,
    thumb: o.job.thumb,
    mode: audio ? 'audio' : 'video',
    edit: { kind: 'karaoke', source: { id: o.job.id, index: o.index }, keep: o.keep, as: audio ? 'audio' : 'video', ...(o.bitrate ? { bitrate: o.bitrate } : {}) },
  };
}

export type QuickAction = 'video' | 'audio' | 'thumbnail';

export interface QuickTemplate {
  main: JobTemplate;
  fallback?: JobTemplate;
  mode: Mode;
}

/**
 * What the 1-tap share targets run. Stored natively so they work even when the app UI
 * has never been opened (a copy built from DEFAULTS ships inside the APK).
 */
export function quickTemplates(s: Settings): Record<QuickAction, QuickTemplate> {
  return {
    video: { main: template('ytdlp', videoSpec(s)), fallback: PHOTO_FALLBACK, mode: 'video' },
    audio: { main: template('ytdlp', audioSpec(s)), mode: 'audio' },
    thumbnail: { main: template('ytdlp', { mode: 'thumbnail' }), fallback: PHOTO_FALLBACK, mode: 'thumbnail' },
  };
}
