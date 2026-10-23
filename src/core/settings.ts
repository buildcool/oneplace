import { galleryArgs, ytdlpArgs } from './args.ts';
import { enginesFor } from './sites.ts';
import type { AudioFormat, DownloadSpec, EngineId, JobRequest, JobTemplate, Link, Mode } from './types.ts';

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
  /** "OnePlace · Video / · MP3 / · Thumbnail" entries in the share menu. */
  quickTargets: boolean;
  /** Remember the last quality picked in the sheet and preselect it. */
  rememberChoice: boolean;
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
  quickTargets: true,
  rememberChoice: true,
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
