import type { Job, JobRequest } from '../core/types.ts';
import type { Engine, EngineStatus, InfoResult } from './types.ts';

// Browser stand-in for the native engine (`npm run dev`). Link info comes from the real engines in
// Termux through scripts/dev-engine.ts when installed, otherwise from a small built-in sample.
// Downloads are simulated so every screen can be tried in the phone's browser.

const STATUS: EngineStatus = {
  ready: true,
  preparing: false,
  ytdlp: 'dev',
  gallerydl: 'dev',
  abis: ['arm64-v8a'],
  sdk: 35,
  appVersion: 'dev',
  build: 0,
  maker: 'browser',
};

const SAMPLE = {
  _type: 'video',
  id: 'dQw4w9WgXcQ',
  title: 'Sample video (install yt-dlp in Termux for real data)',
  uploader: 'OnePlace preview',
  duration: 213,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  formats: [
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, filesize: 3450000 },
    { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 135, filesize: 3560000 },
    { format_id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', width: 640, height: 360, tbr: 500, filesize_approx: 13300000 },
    { format_id: '136', ext: 'mp4', vcodec: 'avc1.4d401f', acodec: 'none', width: 1280, height: 720, fps: 25, tbr: 1500, filesize: 40000000 },
    { format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', width: 1920, height: 1080, fps: 25, tbr: 4000, filesize: 100000000 },
    { format_id: '313', ext: 'webm', vcodec: 'vp9', acodec: 'none', width: 3840, height: 2160, fps: 25, tbr: 16000, filesize: 410000000 },
  ],
};

const KEY = 'op.mockJobs';
let jobs: Job[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Job[];
  } catch {
    return [];
  }
})();
const jobListeners = new Set<(j: Job) => void>();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs.slice(0, 100)));
  } catch {
    // ignore
  }
};
const emit = (j: Job) => {
  jobs = [j, ...jobs.filter((x) => x.id !== j.id)];
  save();
  jobListeners.forEach((cb) => cb({ ...j }));
};

function simulate(job: Job) {
  let p = 0;
  const timer = setInterval(() => {
    const cur = jobs.find((j) => j.id === job.id);
    if (!cur || cur.status === 'canceled') return clearInterval(timer);
    p = Math.min(100, p + 7 + Math.random() * 12);
    if (p >= 100) {
      clearInterval(timer);
      const ext = cur.mode === 'audio' ? 'mp3' : cur.dest === 'image' ? 'jpg' : 'mp4';
      emit({
        ...cur,
        status: 'done',
        progress: 100,
        eta: 0,
        speed: undefined,
        finishedAt: Date.now(),
        files: [{ uri: '', name: `${cur.title}.${ext}`, mime: ext === 'mp3' ? 'audio/mpeg' : ext === 'jpg' ? 'image/jpeg' : 'video/mp4', size: 12_345_678 }],
      });
    } else emit({ ...cur, status: 'running', progress: p, eta: Math.round((100 - p) / 8), speed: '3.2MiB/s' });
  }, 600);
}

export const mockEngine: Engine = {
  native: false,
  status: async () => STATUS,
  prepare: async () => STATUS,
  configure: async () => {},
  resolve: async (url) => url,
  async info({ url, engine }): Promise<InfoResult> {
    try {
      const res = await fetch(`/__engine/info?engine=${engine}&url=${encodeURIComponent(url)}`);
      const body = (await res.json()) as InfoResult & { error?: string };
      if (res.ok) return body;
      if (res.status !== 501) throw new Error(body.error ?? `HTTP ${res.status}`);
    } catch (e) {
      if (!(e instanceof TypeError || (e as Error).message?.includes('JSON'))) throw e;
    }
    await new Promise((r) => setTimeout(r, 700));
    return { engine: 'ytdlp', json: JSON.stringify({ ...SAMPLE, webpage_url: url }), ms: 700 };
  },
  cancelInfo: async () => {},
  async enqueue(req: JobRequest) {
    const job: Job = {
      id: `mock-${Date.now()}`,
      url: req.url,
      site: req.site,
      title: req.title,
      thumb: req.thumb,
      mode: req.mode,
      dest: req.dest,
      status: 'queued',
      progress: -1,
      eta: -1,
      files: [],
      createdAt: Date.now(),
      attempts: 0,
    };
    emit(job);
    simulate(job);
    return job;
  },
  jobs: async () => jobs.map((j) => ({ ...j })),
  async cancel(id) {
    const j = jobs.find((x) => x.id === id);
    if (j) emit({ ...j, status: 'canceled' });
  },
  async retry(id) {
    const j = jobs.find((x) => x.id === id);
    if (j) {
      emit({ ...j, status: 'queued', progress: -1, error: undefined });
      simulate(j);
    }
  },
  async remove(ids) {
    jobs = jobs.filter((j) => !ids.includes(j.id));
    save();
  },
  open: async () => alert('Opens the file in the phone app'),
  share: async () => alert('Opens the Android share sheet in the phone app'),
  updateEngines: async () => ({ ...STATUS, changed: false }),
  login: async () => ({ saved: false }),
  logout: async () => {},
  sessions: async () => [],
  async downloadUpdate() {
    alert('Downloads and installs the update in the phone app');
  },
  canInstall: async () => true,
  openInstallSettings: async () => {},
  batteryOptimized: async () => false,
  openBatterySettings: async () => {},
  notificationsAllowed: async () => true,
  requestNotifications: async () => true,
  systemColors: async () => ({}),
  pendingShare: async () => undefined,
  debug: async () => ({ queueRunning: false, mock: true }),
  onJob(cb) {
    jobListeners.add(cb);
    return () => jobListeners.delete(cb);
  },
  onShared: () => () => {},
  onUpdateProgress: () => () => {},
  onStatus: () => () => {},
};
