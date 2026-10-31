import { describe, expect, it } from 'vitest';
import { counts, downloadedKeys, foundKey, foundMeta, matches, mediaRequest, mergeFound, nameFromUrl, sortFound, thisPage, type Found } from '../src/core/finder.ts';
import { DEFAULTS } from '../src/core/settings.ts';
import type { Job } from '../src/core/types.ts';

const f = (url: string, extra: Partial<Found> = {}): Found => ({ key: foundKey(url, extra.source ?? 'media'), url, kind: 'video', source: 'media', at: 1, ...extra });

describe('finder list', () => {
  it('treats the same file signed differently as one', () => {
    expect(foundKey('https://cdn.x.com/v/clip.mp4?sig=1', 'media')).toBe(foundKey('https://cdn.x.com/v/clip.mp4?sig=2', 'media'));
    expect(foundKey('https://x.com/play?id=1', 'media')).not.toBe(foundKey('https://x.com/play?id=2', 'media'));
    expect(foundKey('https://www.instagram.com/reel/ABC/?igsh=1', 'link')).toBe(foundKey('https://instagram.com/reel/ABC/', 'link'));
  });

  it('merges new details into known items and keeps the biggest size', () => {
    const a = f('https://cdn.x.com/a.mp4', { at: 1 });
    const merged = mergeFound([a], [f('https://cdn.x.com/a.mp4?s=2', { size: 5_000_000, title: 'Clip', at: 2 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ size: 5_000_000, title: 'Clip', at: 1 });
    expect(mergeFound(merged, [])).toBe(merged);
  });

  it('keeps at most the newest 200', () => {
    const many = Array.from({ length: 230 }, (_, i) => f(`https://cdn.x.com/${i}.mp4`, { at: i }));
    const list = mergeFound([], many);
    expect(list).toHaveLength(200);
    expect(list.some((x) => x.at === 229)).toBe(true);
    expect(list.some((x) => x.at === 0)).toBe(false);
  });

  it('puts what is on screen first, then videos by size, locked ones last', () => {
    const list = sortFound([
      f('https://a/small.mp4', { size: 1 }),
      f('https://a/photo.jpg', { kind: 'image', source: 'image', w: 1000, h: 800 }),
      f('https://a/drm.mpd', { stream: 'dash', drm: true }),
      f('https://a/big.mp4', { size: 9 }),
      f('https://a/view.mp4', { source: 'view' }),
    ]);
    expect(list.map((x) => x.url.split('/').pop())).toEqual(['view.mp4', 'big.mp4', 'small.mp4', 'photo.jpg', 'drm.mpd']);
  });

  it('lights the button for videos and songs, not for photos or locked streams', () => {
    expect(counts(f('https://a/v.mp4'))).toBe(true);
    expect(counts(f('https://a/p.jpg', { kind: 'image' }))).toBe(false);
    expect(counts(f('https://a/x.m3u8', { drm: true }))).toBe(false);
    expect(matches(f('https://a/p.jpg', { kind: 'image' }), 'image')).toBe(true);
    expect(matches(f('https://a/s.mp3', { kind: 'audio' }), 'video')).toBe(false);
  });

  it('describes items briefly', () => {
    expect(foundMeta(f('https://a/v.mp4', { h: 720, dur: 225, size: 24 * 1024 * 1024 }))).toBe('720p · 3:45 · 24 MB');
    expect(foundMeta(f('https://a/m.m3u8', { stream: 'hls', variants: [{ height: 1080, size: 50_000_000 }, { height: 480 }] }))).toBe('1080p · 48 MB · 2 qualities');
    expect(foundMeta(f('https://a/p.jpg', { kind: 'image', w: 1080, h: 1350 }))).toBe('1080 × 1350');
    expect(nameFromUrl('https://a.com/media/My%20Song_final.mp3?x=1')).toBe('My Song final');
  });
});

describe('this page', () => {
  it('is a card when the page is a supported post, video or song', () => {
    expect(thisPage({ url: 'https://www.instagram.com/reel/ABC123/', pageTitle: 'Reel' })).toMatchObject({ kind: 'video', linkKind: 'reel', site: 'instagram', source: 'page', title: 'Reel' });
    expect(thisPage({ url: 'https://music.youtube.com/watch?v=abcdefghijk' })).toMatchObject({ kind: 'audio', linkKind: 'song' });
    expect(thisPage({ url: 'https://www.instagram.com/' })).toBeUndefined();
    expect(thisPage({ url: 'https://news.example.com/story' })).toBeUndefined();
  });
});

describe('downloads from the finder', () => {
  const ctx = { pageUrl: 'https://news.example.com/story', pageTitle: 'Big story', userAgent: 'UA' };

  it('sends videos and streams to yt-dlp with the page, user agent and cookies', () => {
    const r = mediaRequest(f('https://cdn.news.com/live/master.m3u8', { stream: 'hls' }), ctx, DEFAULTS, { height: 720 });
    expect(r.engine).toBe('ytdlp');
    expect(r.title).toBe('Big story');
    expect(r.headers).toEqual({ referer: ctx.pageUrl, userAgent: 'UA', cookieUrls: [ctx.pageUrl, 'https://cdn.news.com/live/master.m3u8'] });
    expect(r.args.join(' ')).toContain('720');
    expect(r.site).toBe('other');
  });

  it('saves songs as audio and photos with the plain downloader', () => {
    expect(mediaRequest(f('https://a.com/s.mp3', { kind: 'audio' }), ctx, DEFAULTS).mode).toBe('audio');
    const photo = mediaRequest(f('https://a.com/p.jpg', { kind: 'image', source: 'image' }), { ...ctx, private: true }, DEFAULTS);
    expect(photo).toMatchObject({ engine: 'http', httpUrls: ['https://a.com/p.jpg'], imageFormat: 'original', dest: 'image' });
    expect(photo.headers?.private).toBe(true);
  });

  it('knows what is already downloaded', () => {
    const job = { url: 'https://www.instagram.com/reel/ABC/', status: 'done' } as Job;
    const keys = downloadedKeys([job, { url: 'https://x.com/y.mp4', status: 'failed' } as Job]);
    expect(keys.has(foundKey('https://instagram.com/reel/ABC/?igsh=2', 'link'))).toBe(true);
    expect(keys.has(foundKey('https://x.com/y.mp4', 'media'))).toBe(false);
  });
});
