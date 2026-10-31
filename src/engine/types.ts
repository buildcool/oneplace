import type { QuickAction, QuickTemplate } from '../core/settings.ts';
import type { EngineId, Job, JobRequest } from '../core/types.ts';

// What the UI needs from the download engine. Implemented natively (android.ts) and by a
// browser mock (mock.ts) so `npm run dev` works in the phone's browser.

export interface EngineStatus {
  /** Python/ffmpeg unpacked and yt-dlp ready. */
  ready: boolean;
  /** First start: unpacking and fetching the newest yt-dlp. */
  preparing: boolean;
  error?: string;
  ytdlp?: string;
  gallerydl?: string;
  /** Supported CPU ABIs, best first (used to pick the right update APK). */
  abis: string[];
  sdk: number;
  appVersion: string;
  build: number;
  /** Phone maker, for the battery-optimisation helper. */
  maker: string;
  /** Signed with buildcool's release key (copies built by others are not). */
  official?: boolean;
}

/** A file inside a download (the uri identifies it; positions can change when files are deleted). */
export interface FileRef {
  id: string;
  uri: string;
}

/** The vocal remover's one-time download (AI engine + voice model). */
export interface KaraokeStatus {
  installed: boolean;
  /** Space used on the phone now. */
  bytes: number;
  /** What the first use downloads. */
  download: number;
}

export interface InfoResult {
  engine: EngineId;
  json: string;
  ms: number;
}

/** Settings the native side needs while the UI is closed (1-tap shares, queue, notifications). */
export interface NativeConfig {
  concurrency: number;
  wifiOnly: boolean;
  ytdlpChannel: 'stable' | 'nightly';
  autoEngineUpdate: boolean;
  quickTargets: boolean;
  quick: Record<QuickAction, QuickTemplate>;
  siteArgs: Record<string, string[]>;
  minYtDlp?: string;
  /** YouTube's quick client first (no JavaScript challenge); remote config can switch it off. */
  fastYouTube: boolean;
  /** Where "Downloaded" notifications open files. */
  openIn: 'app' | 'other';
  /** Localised notification texts. */
  strings: Record<string, string>;
}

export interface UpdateProgress {
  progress: number;
  done?: boolean;
  error?: string;
}

export interface Engine {
  readonly native: boolean;
  status(): Promise<EngineStatus>;
  /** Unpack engines and fetch the newest yt-dlp (first start). Safe to call repeatedly. */
  prepare(): Promise<EngineStatus>;
  configure(cfg: NativeConfig): Promise<void>;
  /** Follow redirects of short links (fb.watch, pin.it…). */
  resolve(url: string): Promise<string>;
  info(o: { url: string; engine: EngineId; args: string[]; site: string }): Promise<InfoResult>;
  cancelInfo(): Promise<void>;
  enqueue(req: JobRequest): Promise<Job>;
  jobs(): Promise<Job[]>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  remove(ids: string[], deleteFiles: boolean): Promise<void>;
  /** Open a file in another app (chooser: always ask which app). */
  open(id: string, index?: number, opts?: { uri?: string; chooser?: boolean }): Promise<void>;
  /** Share one file of a download, or all of them. */
  share(id: string, uri?: string): Promise<void>;
  shareFiles(refs: FileRef[]): Promise<void>;
  /** Delete files from the phone; downloads left without files are removed too. */
  removeFiles(refs: FileRef[]): Promise<void>;
  /** Forget files that were deleted in another app. Returns how many. */
  checkFiles(): Promise<number>;
  karaoke(): Promise<KaraokeStatus>;
  deleteKaraoke(): Promise<void>;
  /** A download whose "Downloaded" notification was tapped before the UI was ready. */
  pendingOpen(): Promise<string | undefined>;
  updateEngines(force?: boolean): Promise<EngineStatus & { changed: boolean }>;
  login(o: { site: string; url: string; cookieUrls: string[]; title: string }): Promise<{ saved: boolean }>;
  logout(o: { site: string; cookieUrls: string[] }): Promise<void>;
  /** A login made in the browser is kept for downloads (and forgotten once it ends). True: logged in. */
  checkLogin(o: { site: string; cookieUrls: string[] }): Promise<boolean>;
  sessions(): Promise<string[]>;
  downloadUpdate(o: { url: string; fileName: string }): Promise<void>;
  canInstall(): Promise<boolean>;
  openInstallSettings(): Promise<void>;
  batteryOptimized(): Promise<boolean>;
  openBatterySettings(): Promise<void>;
  notificationsAllowed(): Promise<boolean>;
  requestNotifications(): Promise<boolean>;
  /** Wallpaper colours (Android 12+). */
  systemColors(): Promise<{ light?: string; dark?: string }>;
  /** Queue and keep-alive state (engine test page), to explain downloads that do not start. */
  debug(): Promise<Record<string, unknown>>;
  /** Text shared to the app before the UI was ready (cold start from the share sheet). */
  pendingShare(): Promise<string | undefined>;
  /** The copied text and when it was copied (ms since 1970; 0 when the phone does not say). */
  clip(): Promise<{ text?: string; at: number }>;
  /** Ask Android to add the "Download copied link" Quick Settings tile (Android 13+). False: add it by hand. */
  addTile(): Promise<boolean>;
  onJob(cb: (job: Job) => void): () => void;
  onShared(cb: (text: string) => void): () => void;
  /** "Downloaded" notification tapped while the app runs: show that download. */
  onOpenJob(cb: (id: string) => void): () => void;
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
  onStatus(cb: (s: EngineStatus) => void): () => void;
}
