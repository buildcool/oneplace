// Shared types. Pure TS: no DOM, no Capacitor, so tests and scripts can import them.

/** Sites OnePlace knows by name. Anything else is "other" (yt-dlp may still support it). */
export type SiteId =
  | 'youtube'
  | 'ytmusic'
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'tiktok'
  | 'reddit'
  | 'pinterest'
  | 'snapchat'
  | 'threads'
  | 'linkedin'
  | 'tumblr'
  | 'bluesky'
  | 'imgur'
  | 'vimeo'
  | 'dailymotion'
  | 'twitch'
  | 'kick'
  | 'soundcloud'
  | 'bandcamp'
  | 'mixcloud'
  | 'audiomack'
  | 'jiosaavn'
  | 'bilibili'
  | 'rumble'
  | 'streamable'
  | 'ninegag'
  | 'likee'
  | 'sharechat'
  | 'moj'
  | 'terabox'
  | 'gdrive'
  | 'dropbox'
  | 'archive'
  | 'other';

export type LinkKind =
  | 'video'
  | 'short'
  | 'live'
  | 'song'
  | 'reel'
  | 'post'
  | 'story'
  | 'highlight'
  | 'profile'
  | 'playlist'
  | 'channel'
  | 'album'
  | 'audio'
  | 'unknown';

export interface Link {
  /** Cleaned URL (tracking parameters removed). */
  url: string;
  site: SiteId;
  kind: LinkKind;
  /** Video id, post shortcode… when the URL contains one. */
  id?: string;
  /** YouTube playlist that came with a watch URL (?list=). */
  listId?: string;
  /** A redirect link (fb.watch, pin.it, vm.tiktok…) that should be resolved before routing. */
  short?: boolean;
}

/** yt-dlp for video/audio, gallery-dl for photos/galleries, http for plain files (thumbnails). */
export type EngineId = 'ytdlp' | 'gallerydl' | 'http';

/** What the user wants out of a link. */
export type Mode = 'video' | 'audio' | 'photo' | 'thumbnail';

/** Where finished files go: Movies/, Music/ or Pictures/ OnePlace. */
export type Dest = 'video' | 'audio' | 'image';

export type AudioFormat = 'original' | 'mp3' | 'm4a' | 'opus';

export type ImageFormat = 'original' | 'jpg' | 'png' | 'webp';

/** Everything needed to turn a link into engine arguments. */
export interface DownloadSpec {
  mode: Mode;
  /** Exact yt-dlp format(s) picked in the sheet, e.g. "137+140". Falls back to the rules below. */
  formatId?: string;
  /** Largest resolution (short side, so vertical 1080×1920 is 1080p). Undefined = best. */
  maxRes?: number;
  /** Prefer MP4 with H.264/AAC that plays everywhere. */
  compat?: boolean;
  audio?: AudioFormat;
  /** MP3 bitrate in kbps. */
  bitrate?: number;
  /** Put title/artist tags and the cover art inside audio files. */
  embedCover?: boolean;
  /** Crop audio covers to a square (album-art style). */
  squareCover?: boolean;
  /** gallery-dl item selection, e.g. "1,3-5". */
  range?: string;
  /** Download a whole playlist/channel/profile instead of one item. */
  playlist?: boolean;
  /** Only the first N items of a playlist. */
  playlistEnd?: number;
}

/** A compiled job: which engine runs and with what arguments (URL and output folder are added natively). */
export interface JobTemplate {
  engine: EngineId;
  args: string[];
  dest: Dest;
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled';

export interface JobFile {
  /** content:// URI in MediaStore (or the user's folder). */
  uri: string;
  name: string;
  mime: string;
  size: number;
}

/** A download as stored by the native queue. */
export interface Job {
  id: string;
  url: string;
  site: string;
  title: string;
  thumb?: string;
  mode: Mode;
  dest: Dest;
  status: JobStatus;
  /** 0..100, or -1 when unknown. */
  progress: number;
  /** Seconds left, -1 when unknown. */
  eta: number;
  speed?: string;
  /** Last line the engine printed (shown under the progress bar). */
  line?: string;
  /** Tail of the engine's error output when status is "failed". */
  error?: string;
  files: JobFile[];
  createdAt: number;
  finishedAt?: number;
  attempts: number;
}

/** What the UI hands to the native queue. */
export interface JobRequest extends JobTemplate {
  url: string;
  site: string;
  title: string;
  thumb?: string;
  mode: Mode;
  /** Tried when the main engine finds nothing to download (e.g. a photo-only Instagram post). */
  fallback?: JobTemplate;
  /** Direct file URLs for the http engine (thumbnails), tried in order until one works. */
  httpUrls?: string[];
  imageFormat?: ImageFormat;
  crop?: 'square';
}
