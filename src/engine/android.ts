import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Job, JobRequest } from '../core/types.ts';
import type { Engine, EngineStatus, FileRef, InfoResult, KaraokeStatus, NativeConfig, UpdateProgress } from './types.ts';

/**
 * Native side: android/app/src/main/java/io/github/buildcool/oneplace/EnginePlugin.kt.
 * Jobs and requests cross the bridge as JSON strings so both sides parse them the same way.
 */
interface EnginePlugin {
  status(): Promise<EngineStatus>;
  prepare(): Promise<EngineStatus>;
  configure(o: { json: string }): Promise<void>;
  resolve(o: { url: string }): Promise<{ url: string }>;
  info(o: { url: string; engine: string; args: string[]; site: string }): Promise<InfoResult>;
  cancelInfo(): Promise<void>;
  enqueue(o: { json: string }): Promise<{ json: string }>;
  jobs(): Promise<{ json: string }>;
  cancel(o: { id: string }): Promise<void>;
  retry(o: { id: string }): Promise<void>;
  remove(o: { ids: string[]; deleteFiles: boolean }): Promise<void>;
  open(o: { id: string; index: number; uri?: string; chooser?: boolean }): Promise<void>;
  share(o: { id: string; uri?: string }): Promise<void>;
  shareFiles(o: { refs: FileRef[] }): Promise<void>;
  removeFiles(o: { refs: FileRef[] }): Promise<void>;
  checkFiles(): Promise<{ value: number }>;
  karaoke(): Promise<KaraokeStatus>;
  deleteKaraoke(): Promise<void>;
  pendingOpen(): Promise<{ id?: string }>;
  updateEngines(o: { force: boolean }): Promise<EngineStatus & { changed: boolean }>;
  login(o: { site: string; url: string; cookieUrls: string[]; title: string }): Promise<{ saved: boolean }>;
  logout(o: { site: string; cookieUrls: string[] }): Promise<void>;
  checkLogin(o: { site: string; cookieUrls: string[] }): Promise<{ saved: boolean }>;
  sessions(): Promise<{ sites: string[] }>;
  downloadUpdate(o: { url: string; fileName: string }): Promise<void>;
  canInstall(): Promise<{ value: boolean }>;
  openInstallSettings(): Promise<void>;
  batteryOptimized(): Promise<{ value: boolean }>;
  openBatterySettings(): Promise<void>;
  notificationsAllowed(): Promise<{ value: boolean }>;
  requestNotifications(): Promise<{ value: boolean }>;
  systemColors(): Promise<{ light?: string; dark?: string }>;
  pendingShare(): Promise<{ text?: string }>;
  clip(): Promise<{ text?: string; at: number }>;
  addTile(): Promise<{ value: boolean }>;
  debug(): Promise<Record<string, unknown>>;
  addListener(event: 'job', cb: (d: { json: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'shared', cb: (d: { text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'openJob', cb: (d: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'updateProgress', cb: (d: UpdateProgress) => void): Promise<PluginListenerHandle>;
  addListener(event: 'status', cb: (d: EngineStatus) => void): Promise<PluginListenerHandle>;
}

const P = registerPlugin<EnginePlugin>('Engine');

/** addListener is async; return a plain unsubscribe function that also works before it resolves. */
export function listen(add: () => Promise<PluginListenerHandle>): () => void {
  let handle: PluginListenerHandle | undefined;
  let removed = false;
  void add().then((h) => (removed ? void h.remove() : (handle = h)));
  return () => {
    removed = true;
    void handle?.remove();
  };
}

export const androidEngine: Engine = {
  native: true,
  status: () => P.status(),
  prepare: () => P.prepare(),
  configure: (cfg: NativeConfig) => P.configure({ json: JSON.stringify(cfg) }),
  resolve: async (url) => (await P.resolve({ url })).url,
  info: (o) => P.info(o),
  cancelInfo: () => P.cancelInfo(),
  enqueue: async (req: JobRequest) => JSON.parse((await P.enqueue({ json: JSON.stringify(req) })).json) as Job,
  jobs: async () => JSON.parse((await P.jobs()).json) as Job[],
  cancel: (id) => P.cancel({ id }),
  retry: (id) => P.retry({ id }),
  remove: (ids, deleteFiles) => P.remove({ ids, deleteFiles }),
  open: (id, index = 0, opts = {}) => P.open({ id, index, ...opts }),
  share: (id, uri) => P.share({ id, ...(uri ? { uri } : {}) }),
  shareFiles: (refs) => P.shareFiles({ refs }),
  removeFiles: (refs) => P.removeFiles({ refs }),
  checkFiles: async () => (await P.checkFiles()).value,
  karaoke: () => P.karaoke(),
  deleteKaraoke: () => P.deleteKaraoke(),
  pendingOpen: async () => (await P.pendingOpen()).id || undefined,
  updateEngines: (force = false) => P.updateEngines({ force }),
  login: (o) => P.login(o),
  logout: (o) => P.logout(o),
  checkLogin: async (o) => (await P.checkLogin(o)).saved,
  sessions: async () => (await P.sessions()).sites,
  downloadUpdate: (o) => P.downloadUpdate(o),
  canInstall: async () => (await P.canInstall()).value,
  openInstallSettings: () => P.openInstallSettings(),
  batteryOptimized: async () => (await P.batteryOptimized()).value,
  openBatterySettings: () => P.openBatterySettings(),
  notificationsAllowed: async () => (await P.notificationsAllowed()).value,
  requestNotifications: async () => (await P.requestNotifications()).value,
  systemColors: () => P.systemColors(),
  pendingShare: async () => (await P.pendingShare()).text || undefined,
  clip: () => P.clip(),
  addTile: async () => (await P.addTile()).value,
  debug: () => P.debug(),
  onJob: (cb) => listen(() => P.addListener('job', (d) => cb(JSON.parse(d.json) as Job))),
  onShared: (cb) => listen(() => P.addListener('shared', (d) => cb(d.text))),
  onOpenJob: (cb) => listen(() => P.addListener('openJob', (d) => cb(d.id))),
  onUpdateProgress: (cb) => listen(() => P.addListener('updateProgress', cb)),
  onStatus: (cb) => listen(() => P.addListener('status', cb)),
};
