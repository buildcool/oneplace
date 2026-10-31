import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useMemo, useSyncExternalStore } from 'react';
import { listen } from './android.ts';

// The built-in player: Media3 ExoPlayer in a media service on the phone (android/.../player/),
// so songs keep playing with the screen off and show lock-screen controls. Videos are drawn by
// the same player behind the web page while the video screen is open.

export interface PlayItem {
  /** The Library item's key (`job:index`). */
  id: string;
  uri: string;
  title: string;
  artist?: string;
  /** Local picture for the notification and lock screen. */
  art?: string;
  subs?: { uri: string; name: string }[];
  /** Played from a link (uri is the page): the phone finds the stream when it gets to this item. */
  stream?: boolean;
  /** Sound only (songs): less data. */
  audioOnly?: boolean;
  site?: string;
  /** SponsorBlock categories to skip (YouTube). */
  skip?: string[];
}

/** Stream quality limits by network (highest picture height, 0: none). */
export interface StreamQuality {
  wifi: number;
  mobile: number;
}

/** A part SponsorBlock skipped. */
export interface Skipped {
  category: string;
  from: number;
  to: number;
}

export type Repeat = 'off' | 'all' | 'one';

export interface PlayerState {
  id?: string;
  index: number;
  count: number;
  playing: boolean;
  /** Wants to play (also true while it buffers). */
  playWhenReady: boolean;
  buffering: boolean;
  ended: boolean;
  /** Nothing loaded. */
  idle: boolean;
  position: number;
  duration: number;
  buffered: number;
  speed: number;
  shuffle: boolean;
  repeat: Repeat;
  videoW: number;
  videoH: number;
  /** The picture is on screen (false: sound only). */
  video: boolean;
  subs: boolean;
  error?: string;
  /** Sleep timer: when it stops (ms since 1970), -1 after this song, 0 off. */
  sleepAt: number;
  /** A live stream (no end). */
  live?: boolean;
  /** Picture heights the current stream offers (its quality menu). */
  heights?: number[];
  /** Quality picked in the player (-1: automatic for the network). */
  quality?: number;
  /** When this state was read, to move the time along between updates. */
  at: number;
}

export type Action =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'seek'
  | 'seekBy'
  | 'next'
  | 'prev'
  | 'jump'
  | 'speed'
  | 'shuffle'
  | 'repeat'
  | 'sleep'
  | 'subs'
  | 'scrubStart'
  | 'scrub'
  | 'scrubEnd'
  | 'quality'
  | 'stop';

export type Orientation = 'landscape' | 'portrait' | 'auto';

export interface Player {
  load(o: { items: PlayItem[]; index: number; position?: number; video: boolean; quality?: StreamQuality }): Promise<void>;
  /** More items at the end of the queue (a radio's next songs, "Up next"). */
  append(items: PlayItem[]): Promise<void>;
  /**
   * seek/seekBy in seconds, speed as a factor, repeat 0 off / 1 all / 2 one, sleep in minutes (-1 after this song, 0 off).
   * scrubStart, scrub (seconds), scrubEnd (seconds): fast seeks while a finger drags, then one exact seek.
   */
  control(action: Action, value?: number): Promise<void>;
  state(): Promise<PlayerState>;
  /** Show the video behind the page (which turns transparent), or hide it and keep only the sound. */
  video(o: { show: boolean; fill?: boolean }): Promise<void>;
  /** brightness 0..1 for this screen only, -1 = the phone's own. Returns the brightness now. */
  screen(o: { orientation?: Orientation; immersive?: boolean; brightness?: number; keepOn?: boolean }): Promise<{ brightness: number }>;
  /** Media volume 0..1; without a value only reads it. */
  volume(value?: number): Promise<number>;
  /** Small floating window now. False when the phone doesn't allow it. */
  pip(): Promise<boolean>;
  /** Go to the floating window by itself when the user leaves the app (Android 12+; older phones are told on leave). */
  pipConfig(o: { auto: boolean; w: number; h: number }): Promise<void>;
  pipActive(): Promise<boolean>;
  onState(cb: (s: PlayerState) => void): () => void;
  onPip(cb: (active: boolean) => void): () => void;
  onSkipped(cb: (s: Skipped) => void): () => void;
}

export const IDLE: PlayerState = {
  index: 0,
  count: 0,
  playing: false,
  playWhenReady: false,
  buffering: false,
  ended: false,
  idle: true,
  position: 0,
  duration: 0,
  buffered: 0,
  speed: 1,
  shuffle: false,
  repeat: 'off',
  videoW: 0,
  videoH: 0,
  video: false,
  subs: true,
  sleepAt: 0,
  at: 0,
};

/** The time now: the last reported position moved along while playing. */
export function livePosition(s: PlayerState, now = Date.now()): number {
  if (!s.playing) return s.position;
  const p = s.position + ((now - s.at) / 1000) * s.speed;
  return s.duration > 0 ? Math.min(p, s.duration) : p;
}

// ---------- native ----------

interface PlayerPlugin {
  load(o: { items: PlayItem[]; index: number; position: number; video: boolean; quality?: StreamQuality }): Promise<void>;
  append(o: { items: PlayItem[] }): Promise<void>;
  control(o: { action: Action; value?: number }): Promise<void>;
  state(): Promise<Omit<PlayerState, 'at'>>;
  video(o: { show: boolean; fill?: boolean }): Promise<void>;
  screen(o: { orientation?: Orientation; immersive?: boolean; brightness?: number; keepOn?: boolean }): Promise<{ brightness: number }>;
  volume(o: { value?: number }): Promise<{ value: number }>;
  pip(): Promise<{ value: boolean }>;
  pipConfig(o: { auto: boolean; w: number; h: number }): Promise<void>;
  pipActive(): Promise<{ value: boolean }>;
  addListener(event: 'state', cb: (s: Omit<PlayerState, 'at'>) => void): Promise<PluginListenerHandle>;
  addListener(event: 'pip', cb: (d: { active: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'skipped', cb: (d: Skipped) => void): Promise<PluginListenerHandle>;
}

const P = registerPlugin<PlayerPlugin>('Player');
const stamp = (s: Omit<PlayerState, 'at'>): PlayerState => ({ ...IDLE, ...s, at: Date.now() });

const nativePlayer: Player = {
  load: (o) => P.load({ ...o, position: o.position ?? 0 }),
  append: (items) => P.append({ items }),
  control: (action, value) => P.control(value === undefined ? { action } : { action, value }),
  state: async () => stamp(await P.state()),
  video: (o) => P.video(o),
  screen: (o) => P.screen(o),
  volume: async (value) => (await P.volume(value === undefined ? {} : { value })).value,
  pip: async () => (await P.pip()).value,
  pipConfig: (o) => P.pipConfig(o),
  pipActive: async () => (await P.pipActive()).value,
  onState: (cb) => listen(() => P.addListener('state', (s) => cb(stamp(s)))),
  onPip: (cb) => listen(() => P.addListener('pip', (d) => cb(d.active))),
  onSkipped: (cb) => listen(() => P.addListener('skipped', cb)),
};

// ---------- browser stand-in (`npm run dev`): a pretend clock, no sound ----------

function mockPlayer(): Player {
  let s: PlayerState = { ...IDLE };
  let items: PlayItem[] = [];
  const subs = new Set<(s: PlayerState) => void>();
  const set = (patch: Partial<PlayerState>) => {
    s = { ...s, ...patch, at: Date.now() };
    subs.forEach((cb) => cb(s));
  };
  let clock: ReturnType<typeof setInterval> | undefined;
  const tick = () => {
    if (!s.playing) return;
    const position = livePosition(s);
    if (position >= s.duration) {
      if (s.index + 1 < items.length) set({ index: s.index + 1, id: items[s.index + 1]!.id, position: 0 });
      else set({ playing: false, playWhenReady: false, ended: true, position: s.duration });
    } else set({ position });
  };
  return {
    async load(o) {
      clock ??= setInterval(tick, 500);
      items = o.items;
      const it = items[o.index];
      set({ ...IDLE, id: it?.id, index: o.index, count: items.length, idle: false, playing: true, playWhenReady: true, position: o.position ?? 0, duration: 213, video: o.video, videoW: o.video ? 1920 : 0, videoH: o.video ? 1080 : 0, heights: it?.stream ? [1080, 720, 480, 360] : [], quality: -1 });
    },
    async append(more) {
      items = [...items, ...more];
      set({ count: items.length });
    },
    async control(action, v = 0) {
      const at = livePosition(s);
      const go = (index: number) => items[index] && set({ index, id: items[index]!.id, position: 0, ended: false });
      switch (action) {
        case 'play':
          return set({ playing: true, playWhenReady: true, ended: false, position: s.ended ? 0 : at });
        case 'pause':
          return set({ playing: false, playWhenReady: false, position: at });
        case 'toggle':
          return set({ playing: !s.playing, playWhenReady: !s.playing, position: at });
        case 'seek':
        case 'scrub':
        case 'scrubEnd':
          return set({ position: Math.max(0, Math.min(v, s.duration)) });
        case 'scrubStart':
          return;
        case 'seekBy':
          return set({ position: Math.max(0, Math.min(at + v, s.duration)) });
        case 'next':
          return go(s.index + 1);
        case 'prev':
          return at > 3 ? set({ position: 0 }) : go(s.index - 1);
        case 'jump':
          return go(v);
        case 'speed':
          return set({ speed: v, position: at });
        case 'shuffle':
          return set({ shuffle: !!v });
        case 'repeat':
          return set({ repeat: v === 2 ? 'one' : v === 1 ? 'all' : 'off' });
        case 'sleep':
          return set({ sleepAt: v > 0 ? Date.now() + v * 60_000 : v });
        case 'subs':
          return set({ subs: !!v });
        case 'quality':
          return set({ quality: v });
        case 'stop':
          items = [];
          return set({ ...IDLE });
      }
    },
    state: async () => ({ ...s, at: Date.now() }),
    video: async (o) => set({ video: o.show }),
    screen: async () => ({ brightness: 0.5 }),
    volume: async () => 0.6,
    pip: async () => false,
    pipConfig: async () => {},
    pipActive: async () => false,
    onState(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    onPip: () => () => {},
    onSkipped: () => () => {},
  };
}

export const player: Player = Capacitor.isNativePlatform() ? nativePlayer : mockPlayer();

// ---------- one shared copy of the state for the UI ----------

let latest: PlayerState = IDLE;
const watchers = new Set<() => void>();
let started = false;

function startWatching() {
  if (started) return;
  started = true;
  const set = (s: PlayerState) => {
    latest = s;
    watchers.forEach((w) => w());
  };
  player.onState(set);
  player.state().then(set, () => {});
}

const subscribe = (cb: () => void) => {
  startWatching();
  watchers.add(cb);
  return () => {
    watchers.delete(cb);
  };
};

/** The player state right now (outside React). */
export function playerNow(): PlayerState {
  startWatching();
  return latest;
}

/** Every update (4 times a second while playing): for the players' own screens. */
export function usePlayer(): PlayerState {
  return useSyncExternalStore(subscribe, () => latest, () => latest);
}

const coarse = (s: PlayerState) =>
  [s.id, s.playing, s.playWhenReady, s.buffering, s.ended, s.idle, s.index, s.count, s.videoW, s.videoH, s.video, s.subs, s.speed, s.shuffle, s.repeat, s.sleepAt, s.error, s.live, s.quality, s.heights?.join(',')].join('|');

/** Only what changes now and then (track, play/pause…), so the rest of the app does not redraw with the clock. */
export function usePlayerCoarse(): PlayerState {
  const key = useSyncExternalStore(subscribe, () => coarse(latest), () => coarse(latest));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => latest, [key]);
}

/** Call [cb] on every update; returns the unsubscribe function. */
export function watchPlayer(cb: (s: PlayerState) => void): () => void {
  return subscribe(() => cb(latest));
}
