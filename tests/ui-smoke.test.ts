// Renders every new screen to HTML with sample downloads, so a mistake that would crash the screen (and show a
// blank page on the phone) fails here. Effects and gestures do not run; the drawing does.
import { createElement as h, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mediaItems } from '../src/core/media.ts';
import { DEFAULTS } from '../src/core/settings.ts';
import type { Found } from '../src/core/finder.ts';
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
      onClearBrowsing: async () => {},
      onPage: noop,
    });
    expect(html).toContain('When you leave a video');
    expect(html).toContain('Vocal remover');
    expect(html).toContain('Search engine');
    expect(html).toContain('Block ads and trackers');
  });

  it('App', async () => {
    const { default: App } = await import('../src/App.tsx');
    expect(renderToString(h(App))).toContain('OnePlace');
  });
});

describe('in-app browser renders', () => {
  const tab = (id: string, url: string, extra: Record<string, unknown> = {}) => ({
    id,
    url,
    title: `Page ${id}`,
    progress: 60,
    loading: true,
    canBack: true,
    canForward: false,
    secure: true,
    blocked: 12,
    desktop: false,
    private: false,
    ...extra,
  });
  const reel = tab('t1', 'https://www.instagram.com/reel/ABC123/', { pageTitle: 'A reel', image: 'https://cdn/x.jpg' });
  const news = tab('t2', 'https://news.example.com/story', { loading: false, progress: 100 });

  it('start page with sites, tabs, bookmarks and history', async () => {
    const { StartPage } = await import('../src/ui/browser/StartPage.tsx');
    const { topSites, addVisit } = await import('../src/core/browser.ts');
    const history = addVisit([], { url: 'https://news.example.com/story', title: 'Big story' });
    const html = render(StartPage, {
      tabs: [reel, news],
      shortcuts: topSites({ pinned: [], hidden: [] }, history),
      history,
      bookmarks: [{ url: 'https://www.jiosaavn.com/', title: 'JioSaavn', at: 1 }],
      clip: 'https://x.com/a/status/1',
      onSearch: noop,
      onOpen: noop,
      onTab: noop,
      onCloseTab: noop,
      onTabs: noop,
      onShortcutMenu: noop,
      onAllSites: noop,
      onHistory: noop,
      onBookmarks: noop,
      onDownloadClip: noop,
    });
    expect(html).toContain('Search or type a site');
    expect(html).toContain('YouTube Music');
    expect(html).toContain('Instagram');
    expect(html).toContain('Your tabs');
    expect(html).toContain('Big story');
    expect(html).toContain('JioSaavn');
  });

  it('the bar in each of its states', async () => {
    const { BrowserBar } = await import('../src/ui/browser/BrowserBar.tsx');
    const base = {
      tab: reel,
      count: 2,
      collapsed: false,
      tabsCount: 3,
      top: false,
      onToastDone: noop,
      onFind: noop,
      onFindNext: noop,
      onFindClose: noop,
      onAddress: noop,
      onAddressHold: noop,
      onFinder: noop,
      onTabs: noop,
      onMenu: noop,
      onSwipe: noop,
      onExpand: noop,
    };
    const normal = render(BrowserBar, base);
    expect(normal).toContain('instagram.com');
    expect(normal).toContain('bb-find lit');
    expect(render(BrowserBar, { ...base, label: 'Download reel' })).toContain('Download reel');
    expect(render(BrowserBar, { ...base, collapsed: true })).toContain('bb-mini');
    expect(render(BrowserBar, { ...base, toast: { text: 'Added to downloads', action: { label: 'Downloads', run: noop } } })).toContain('Added to downloads');
    expect(render(BrowserBar, { ...base, find: { query: 'cat', index: 1, count: 4 } })).toContain('1/4');
    expect(render(BrowserBar, { ...base, tab: { ...news, private: true, secure: false } })).toContain('private');
  });

  it('address panel, tab switcher, history, bookmarks and all sites', async () => {
    const { Omnibox } = await import('../src/ui/browser/Omnibox.tsx');
    const { TabSwitcher } = await import('../src/ui/browser/TabSwitcher.tsx');
    const { HistoryPage, BookmarksPage, AllSitesPage } = await import('../src/ui/browser/HistoryPage.tsx');
    const { addVisit } = await import('../src/core/browser.ts');
    const history = addVisit([], { url: 'https://news.example.com/story', title: 'Big story' });
    expect(
      render(Omnibox, { url: 'https://www.google.com/search?q=lofi', engine: 'google', remote: true, privateTab: false, history, bookmarks: [], tabs: [reel, news], activeId: 't1', clip: undefined, onGo: noop, onTab: noop, onClose: noop }),
    ).toContain('Search YouTube');
    const sw = render(TabSwitcher, { tabs: [reel, { ...news, private: true }], activeId: 't1', privateOk: true, startPrivate: false, onSelect: noop, onClose: noop, onCloseAll: noop, onNew: noop, onHome: noop, onDismiss: noop });
    expect(sw).toContain('Page t1');
    expect(sw).toContain('Private');
    expect(render(HistoryPage, { history, onOpen: noop, onRemove: noop, onClear: noop, onClose: noop })).toContain('Big story');
    expect(render(BookmarksPage, { bookmarks: [], onOpen: noop, onRemove: noop, onClose: noop })).toContain('No bookmarks yet');
    expect(render(AllSitesPage, { onOpen: noop, onClose: noop })).toContain('Dailymotion');
  });

  it('content finder with the page, the video on screen, files, streams and photos', async () => {
    const { FinderSheet } = await import('../src/ui/browser/FinderSheet.tsx');
    const { foundKey, thisPage } = await import('../src/core/finder.ts');
    const item = (url: string, extra: Partial<Found>): Found => ({ key: foundKey(url, extra.source ?? 'media'), url, kind: 'video', source: 'media', at: 1, ...extra });
    const html = render(FinderSheet, {
      tab: reel,
      page: thisPage(reel),
      view: item('https://www.instagram.com/reel/XYZ987/', { source: 'link', linkKind: 'reel', site: 'instagram' }),
      items: [
        item('https://cdn.news.com/master.m3u8', { stream: 'hls', dur: 300, variants: [{ height: 1080, size: 80_000_000 }, { height: 480 }] }),
        item('https://cdn.news.com/clip.mp4', { size: 12_000_000, h: 720 }),
        item('https://cdn.news.com/locked.mpd', { stream: 'dash', drm: true }),
        item('https://cdn.news.com/a.jpg', { kind: 'image', source: 'image', w: 1200, h: 800 }),
        item('https://cdn.news.com/b.jpg', { kind: 'image', source: 'image', w: 1200, h: 800 }),
      ],
      downloaded: new Set<string>(),
      onPage: noop,
      onLink: noop,
      onQuick: noop,
      onMedia: noop,
      onMany: noop,
      onClose: noop,
    });
    expect(html).toContain('On this page');
    expect(html).toContain('A reel');
    expect(html).toContain('On screen now');
    expect(html).toContain('2 qualities');
    expect(html).toContain('Protected (DRM)');
    expect(html).toContain('Download all photos (2)');
  });

  it('menu, long-press, page download and app-link sheets', async () => {
    const { BrowserMenu, ContextSheet, PageDownloadSheet, ExternalSheet } = await import('../src/ui/browser/BrowserSheets.tsx');
    const menu = render(BrowserMenu, {
      tab: reel,
      bookmarked: true,
      adblock: { adblock: true, level: 'standard' },
      privateOk: true,
      onBack: noop,
      onForward: noop,
      onReload: noop,
      onBookmark: noop,
      onShare: noop,
      onNewTab: noop,
      onNewPrivate: noop,
      onFind: noop,
      onDesktop: noop,
      onAdblock: noop,
      onBookmarks: noop,
      onHistory: noop,
      onDownloads: noop,
      onOpenOther: noop,
      onCopy: noop,
      onHome: noop,
      onSettings: noop,
      onClose: noop,
    });
    expect(menu).toContain('Find in page');
    expect(menu).toContain('12 ads and trackers blocked');
    const cx = render(ContextSheet, { target: { id: 't1', link: 'https://example.com/a', linkText: 'A link', image: 'https://cdn/p.jpg' }, onOpenTab: noop, onCopy: noop, onShare: noop, onDownloadLink: noop, onSavePhoto: noop, onSaveVideo: noop, onClose: noop });
    expect(cx).toContain('Open in new tab');
    expect(cx).toContain('Download photo');
    expect(render(PageDownloadSheet, { d: { id: 't1', url: 'https://cdn/file.pdf', page: 'https://a.com/', ua: 'UA', mime: 'application/pdf', size: 2_000_000, name: 'file.pdf' }, onDownload: noop, onClose: noop })).toContain('file.pdf');
    expect(render(PageDownloadSheet, { d: { id: 't1', url: 'blob:https://a.com/1', page: '', ua: '', mime: '', size: -1, name: '' }, onDownload: noop, onClose: noop })).toContain('made the file itself');
    expect(render(ExternalSheet, { url: 'intent://x', onOpen: noop, onClose: noop })).toContain('Open in another app?');
  });

  it('Browse starts on its start page', async () => {
    const { Browse } = await import('../src/ui/browser/Browse.tsx');
    const props = {
      shown: true,
      covered: false,
      hidden: false,
      settings: { ...DEFAULTS, onboarded: true },
      jobs,
      sessions: [],
      miniShown: false,
      onRequestDone: noop,
      onPageMode: noop,
      onLink: noop,
      onAdd: noop,
      onDownloads: noop,
      onSettings: noop,
      onSessions: noop,
      onToastDone: noop,
      onCopy: noop,
      say: noop,
    };
    expect(render(Browse, props)).toContain('Search or type a site');
    expect(render(Browse, { ...props, shown: false })).toBe('');
  });
});
