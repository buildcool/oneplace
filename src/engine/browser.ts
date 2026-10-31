import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { TabInfo } from '../core/browser.ts';
import type { FoundKind, FoundSource, Variant } from '../core/finder.ts';
import { listen } from './android.ts';

// The in-app browser's pages live on the native side (android/.../browser/): this is the app's handle
// on them, plus a stand-in for `npm run dev` and the tests that pretends to load pages.

/** What the phone found on a page (before the app merges it into its list). */
export interface RawFound {
  url: string;
  kind: FoundKind;
  source: FoundSource;
  title?: string;
  thumb?: string;
  size?: number;
  mime?: string;
  dur?: number;
  w?: number;
  h?: number;
  stream?: 'hls' | 'dash';
  variants?: Variant[];
  drm?: boolean;
}

export interface BrowserConfig {
  adblock: 'standard' | 'strong' | 'off';
  thirdPartyCookies: boolean;
  darkPages: boolean;
  /** The app is dark now (pages follow it when darkPages is on). */
  appDark: boolean;
  hideBars: boolean;
  /** YouTube and YT Music play in OnePlace's player (v1.0.18). */
  takeover: boolean;
  /** Site rules JSON (config/browser-rules.json), checked again on the phone. */
  rules: string;
}

export interface ContextTarget {
  id: string;
  page?: string;
  link?: string;
  linkText?: string;
  image?: string;
  video?: string;
  poster?: string;
  /** The post a long-pressed photo or video belongs to. */
  post?: string;
}

export interface PageDownload {
  id: string;
  url: string;
  page: string;
  ua: string;
  mime: string;
  size: number;
  name: string;
}

export interface PlayRequest {
  id: string;
  url: string;
  music: boolean;
  title?: string;
  artist?: string;
  thumb?: string;
}

export interface BrowserEvents {
  tab: TabInfo & { userAgent?: string };
  finder: { id: string; reset?: boolean; items?: RawFound[]; view?: RawFound | null };
  context: ContextTarget;
  download: PageDownload;
  external: { id: string; url: string };
  popup: { id: string };
  newTab: { id: string; parent: string; private: boolean };
  closed: { id: string };
  bars: { collapsed: boolean };
  fullscreen: { on: boolean };
  keyboard: { open: boolean };
  find: { id: string; index: number; count: number };
  play: PlayRequest;
}

export interface Browser {
  /** The page area (CSS px from the top and the bottom), shown or not, and whether a sheet covers it. */
  layout(o: { top: number; bottom: number; visible: boolean; overlay: boolean }): Promise<void>;
  open(o: { id: string; url: string; private?: boolean; background?: boolean }): Promise<void>;
  select(o: { id: string; url?: string; private?: boolean }): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  close(id: string): Promise<void>;
  /** False when the tab has nothing to go back to. */
  back(id: string): Promise<boolean>;
  forward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  find(o: { id: string; query?: string; next?: boolean; clear?: boolean }): Promise<void>;
  desktop(id: string, on: boolean): Promise<void>;
  /** A fresh picture of the tab on screen (for the tab switcher). */
  capture(): Promise<void>;
  state(): Promise<{ tabs: (TabInfo & { userAgent?: string })[]; active?: string; privateOk: boolean }>;
  configure(cfg: BrowserConfig): Promise<void>;
  exitFullscreen(): Promise<void>;
  /** The ad blocker for one site: set it, or only read it. */
  site(host: string, adblock?: boolean): Promise<{ adblock: boolean; level: string }>;
  clearData(o: { cookies?: boolean; cache?: boolean }): Promise<void>;
  /** Open an app link the user agreed to. False: no app for it. */
  openApp(url: string): Promise<boolean>;
  suggest(template: string, q: string): Promise<string[]>;
  /** Android's share menu for a link. */
  shareText(text: string): Promise<void>;
  on<E extends keyof BrowserEvents>(event: E, cb: (d: BrowserEvents[E]) => void): () => void;
}

// ---------- native ----------

interface BrowserPlugin {
  layout(o: { top: number; bottom: number; visible: boolean; overlay: boolean }): Promise<void>;
  open(o: { id: string; url: string; private?: boolean; background?: boolean }): Promise<void>;
  select(o: { id: string; url?: string; private?: boolean }): Promise<void>;
  navigate(o: { id: string; url: string }): Promise<void>;
  close(o: { id: string }): Promise<void>;
  back(o: { id: string }): Promise<{ value: boolean }>;
  forward(o: { id: string }): Promise<void>;
  reload(o: { id: string }): Promise<void>;
  stop(o: { id: string }): Promise<void>;
  find(o: { id: string; query?: string; next?: boolean; clear?: boolean }): Promise<void>;
  desktop(o: { id: string; on: boolean }): Promise<void>;
  capture(): Promise<void>;
  state(): Promise<{ tabs: (TabInfo & { userAgent?: string })[]; active?: string; privateOk: boolean }>;
  configure(o: { json: string }): Promise<void>;
  exitFullscreen(): Promise<void>;
  site(o: { host: string; adblock?: boolean }): Promise<{ adblock: boolean; level: string }>;
  clearData(o: { cookies?: boolean; cache?: boolean }): Promise<void>;
  openApp(o: { url: string }): Promise<{ value: boolean }>;
  suggest(o: { template: string; q: string }): Promise<{ items: unknown[] }>;
  shareText(o: { text: string }): Promise<void>;
  addListener(event: string, cb: (d: never) => void): Promise<PluginListenerHandle>;
}

const P = registerPlugin<BrowserPlugin>('Browser');

const nativeBrowser: Browser = {
  layout: (o) => P.layout(o),
  open: (o) => P.open(o),
  select: (o) => P.select(o),
  navigate: (id, url) => P.navigate({ id, url }),
  close: (id) => P.close({ id }),
  back: async (id) => (await P.back({ id })).value,
  forward: (id) => P.forward({ id }),
  reload: (id) => P.reload({ id }),
  stop: (id) => P.stop({ id }),
  find: (o) => P.find(o),
  desktop: (id, on) => P.desktop({ id, on }),
  capture: () => P.capture(),
  state: () => P.state(),
  configure: (cfg) => P.configure({ json: JSON.stringify(cfg) }),
  exitFullscreen: () => P.exitFullscreen(),
  site: (host, adblock) => P.site(adblock === undefined ? { host } : { host, adblock }),
  clearData: (o) => P.clearData(o),
  openApp: async (url) => (await P.openApp({ url })).value,
  suggest: async (template, q) => (await P.suggest({ template, q })).items.filter((x): x is string => typeof x === 'string').slice(0, 8),
  shareText: (text) => P.shareText({ text }),
  on: (event, cb) => listen(() => P.addListener(event, cb as (d: never) => void)),
};

// ---------- browser stand-in: pretend pages load at once ----------

function mockBrowser(): Browser {
  const subs = new Map<string, Set<(d: unknown) => void>>();
  const emit = <E extends keyof BrowserEvents>(event: E, d: BrowserEvents[E]) => subs.get(event)?.forEach((cb) => cb(d));
  const tabs = new Map<string, TabInfo>();
  const history = new Map<string, string[]>();
  const show = (id: string, url: string, priv = false) => {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();
    const t: TabInfo = { id, url, title: host, progress: 100, loading: false, canBack: (history.get(id)?.length ?? 0) > 0, canForward: false, secure: url.startsWith('https:'), blocked: 3, desktop: false, private: priv };
    tabs.set(id, t);
    setTimeout(() => {
      emit('tab', t);
      emit('finder', { id, reset: true });
      if (/video|youtube|instagram/.test(url)) emit('finder', { id, items: [{ url: `${url.replace(/\/$/, '')}/clip.mp4`, kind: 'video', source: 'media', size: 24_000_000, dur: 225, h: 720 }] });
    }, 30);
  };
  const go = (id: string, url: string) => {
    const old = tabs.get(id);
    if (old?.url) history.set(id, [...(history.get(id) ?? []), old.url]);
    show(id, url, old?.private);
  };
  return {
    layout: async () => {},
    open: async (o) => show(o.id, o.url, o.private),
    select: async (o) => {
      if (!tabs.has(o.id) && o.url) show(o.id, o.url, o.private);
    },
    navigate: async (id, url) => go(id, url),
    close: async (id) => {
      tabs.delete(id);
    },
    back: async (id) => {
      const h = history.get(id) ?? [];
      const prev = h.pop();
      if (!prev) return false;
      show(id, prev, tabs.get(id)?.private);
      return true;
    },
    forward: async () => {},
    reload: async (id) => {
      const t = tabs.get(id);
      if (t) show(id, t.url, t.private);
    },
    stop: async () => {},
    find: async (o) => emit('find', { id: o.id, index: o.query ? 1 : 0, count: o.query ? 2 : 0 }),
    desktop: async () => {},
    capture: async () => {},
    state: async () => ({ tabs: [...tabs.values()], privateOk: true }),
    configure: async () => {},
    exitFullscreen: async () => {},
    site: async (_host, adblock) => ({ adblock: adblock ?? true, level: 'standard' }),
    clearData: async () => {},
    openApp: async () => false,
    suggest: async (_t, q) => (q ? [`${q} songs`, `${q} video`, `${q} status`] : []),
    shareText: async (text) => {
      await navigator.share?.({ text });
    },
    on(event, cb) {
      const set = subs.get(event) ?? new Set();
      set.add(cb as (d: unknown) => void);
      subs.set(event, set);
      return () => set.delete(cb as (d: unknown) => void);
    },
  };
}

export const browser: Browser = Capacitor.isNativePlatform() ? nativeBrowser : mockBrowser();
