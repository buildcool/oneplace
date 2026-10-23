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
  open(id: string, index?: number): Promise<void>;
  share(id: string): Promise<void>;
  updateEngines(force?: boolean): Promise<EngineStatus & { changed: boolean }>;
  login(o: { site: string; url: string; cookieUrls: string[]; title: string }): Promise<{ saved: boolean }>;
  logout(o: { site: string; cookieUrls: string[] }): Promise<void>;
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
  /** Text shared to the app before the UI was ready (cold start from the share sheet). */
  pendingShare(): Promise<string | undefined>;
  onJob(cb: (job: Job) => void): () => void;
  onShared(cb: (text: string) => void): () => void;
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
  onStatus(cb: (s: EngineStatus) => void): () => void;
}
