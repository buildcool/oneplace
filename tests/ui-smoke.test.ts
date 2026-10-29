// Renders every new screen to HTML with sample downloads, so a mistake that would crash the screen (and show a
// blank page on the phone) fails here. Effects and gestures do not run; the drawing does.
import { createElement as h, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mediaItems } from '../src/core/media.ts';
import { DEFAULTS } from '../src/core/settings.ts';
import type { Job, JobFile } from '../src/core/types.ts';

const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.innerWidth ??= 400;
g.innerHeight ??= 800;

const noop = () => {};
const file = (name: string, mime: string, extra: Partial<JobFile> = {}): JobFile => ({ uri: `content://media/external/${name}`, name, mime, size: 5_000_000, ...extra });
const job = (id: string, files: JobFile[], extra: Partial<Job> = {}): Job => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  site: 'youtube',
  title: `Title ${id}`,
  thumb: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
  mode: 'video',
  dest: 'video',
  status: 'done',
  progress: 100,
  eta: 0,
  files,
  createdAt: 1_000,
  finishedAt: Date.now() - 3_600_000,
  attempts: 0,
  ...extra,
});

const jobs: Job[] = [
  job('wide', [file('Wide [abcdefghijk].mp4', 'video/mp4', { dur: 245, w: 1920, h: 1080, thumb: '/data/thumbs/a.jpg' }), file('Wide [abcdefghijk].en.srt', 'application/x-subrip')]),
  job('reel', [file('Reel.mp4', 'video/mp4', { dur: 31, w: 1080, h: 1920 })], { site: 'instagram' }),
  job('album', [file('01. One [aaaaaaaaaaa].mp3', 'audio/mpeg', { title: 'One', artist: 'Singer', dur: 200 }), file('02. Two [bbbbbbbbbbb].mp3', 'audio/mpeg', { dur: 180 })], {
    mode: 'audio',
    dest: 'audio',
    finishedAt: Date.now() - 86_400_000 * 40,
  }),
  job('photos', [file('1.jpg', 'image/jpeg', { w: 1080, h: 1350 }), file('2.jpg', 'image/jpeg')], { mode: 'photo', dest: 'image', site: 'instagram' }),
  job('karaoke', [file('One (Karaoke).mp3', 'audio/mpeg', { stem: 'music', dur: 200 })], {
    mode: 'audio',
    dest: 'audio',
    edit: { kind: 'karaoke', source: { id: 'album', index: 0 }, keep: 'music', as: 'audio' },
  }),
  job('running', [], { status: 'running', progress: 40, edit: { kind: 'karaoke', source: { id: 'album', index: 1 }, keep: 'both', as: 'audio' }, line: 'Removing vocals' }),
  job('gone', [], {}),
];
const items = mediaItems(jobs);
const video = items.find((it) => it.key === 'wide:0')!;
const song = items.find((it) => it.key === 'album:0')!;
const photo = items.find((it) => it.key === 'photos:0')!;

function render<P extends object>(c: ComponentType<P>, props: P): string {
  return renderToString(h(c as ComponentType<object>, props));
}

describe('new screens render', () => {
  it('Library: shelves, tabs and lists', async () => {
    const { Library } = await import('../src/ui/Library.tsx');
    const html = render(Library, {
      jobs,
      lang: 'en',
      sort: 'new' as const,
      positions: { [video.file.uri]: [60, 245, 1] as [number, number, number] },
      playingKey: song.key,
      onSort: noop,
      onOpen: noop,
      onPlayAll: noop,
      onMenu: noop,
      onShare: noop,
      onDelete: noop,
      onCheck: noop,
    });
    expect(html).toContain('Title wide');
    expect(html).toContain('Continue watching');
    expect(html).toContain('Shorts &amp; Reels');
    expect(html).toContain('One');
  });

  it('players and viewers', async () => {
    const { VideoPlayer } = await import('../src/ui/viewer/VideoPlayer.tsx');
    const { NowPlaying, MiniPlayer } = await import('../src/ui/viewer/NowPlaying.tsx');
    const { ImageViewer } = await import('../src/ui/viewer/ImageViewer.tsx');
    expect(
      render(VideoPlayer, { items: [video], index: 0, settings: DEFAULTS, pipOk: true, onClose: noop, onMenu: noop, onOpenWith: noop, onToast: noop }),
    ).toContain('Title wide');
    expect(render(NowPlaying, { cur: song, queue: [song], alt: items.find((it) => it.stem === 'music'), onClose: noop, onMenu: noop, onSwap: noop, onWatch: noop, onToast: noop })).toContain('One');
    expect(render(MiniPlayer, { cur: song, onOpen: noop })).toContain('One');
    expect(render(ImageViewer, { items: items.filter((it) => it.kind === 'image'), index: 0, onClose: noop, onShare: noop, onMenu: noop })).toContain('1 / 2');
  });

  it('item sheets', async () => {
    const { ItemMenu, InfoSheet, KaraokeSheet } = await import('../src/ui/viewer/ItemSheets.tsx');
    const menu = {
      item: song,
      onClose: noop,
      onOpen: noop,
      onOpenWith: noop,
      onShare: noop,
      onKaraoke: noop,
      onInfo: noop,
      onSwap: noop,
      onSource: noop,
      onCopyLink: noop,
      onDelete: noop,
    };
    expect(render(ItemMenu, menu)).toContain('Remove vocals');
    expect(render(InfoSheet, { item: photo, onClose: noop, onSource: noop })).toContain('1080 × 1350');
    expect(render(KaraokeSheet, { item: video, status: { installed: false, bytes: 0, download: 52_000_000 }, onClose: noop, onStart: noop })).toContain('52 MB');
  });

  it('Downloads shows vocal remover progress and deleted files', async () => {
    const { Downloads } = await import('../src/ui/Downloads.tsx');
    const html = render(Downloads, { jobs, onCancel: noop, onRetry: noop, onFix: noop, onOpen: noop, onMenu: noop, onClearFinished: noop });
    expect(html).toContain('Removing vocals · 40%');
    expect(html).toContain('Deleted from phone');
  });
});

describe('app shell renders', () => {
  it('Settings with the Player section', async () => {
    const { Settings } = await import('../src/ui/Settings.tsx');
    const html = render(Settings, {
      settings: DEFAULTS,
      update: noop,
      sessions: [],
      onLogin: noop,
      onLogout: noop,
      onUpdateEngine: async () => '',
      onCheckApp: async () => '',
      onBattery: noop,
      onNotifications: noop,
      onAddTile: async () => false,
      pipOk: true,
      onKaraokeStatus: async () => ({ installed: true, bytes: 70_000_000, download: 52_000_000 }),
      onKaraokeDelete: async () => {},
      onPage: noop,
    });
    expect(html).toContain('When you leave a video');
    expect(html).toContain('Vocal remover');
  });

  it('App', async () => {
    const { default: App } = await import('../src/App.tsx');
    expect(renderToString(h(App))).toContain('OnePlace');
  });
});
