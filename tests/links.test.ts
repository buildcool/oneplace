import { describe, expect, it } from 'vitest';
import { cleanUrl, detect, drmService, findUrls, firstLink, isCollection } from '../src/core/links.ts';

describe('findUrls', () => {
  it('finds links inside shared text and trims punctuation', () => {
    const text = 'Dekho ye reel 👉 https://www.instagram.com/reel/C9xYz12AbCd/?igsh=abc123. Mast hai! (also https://youtu.be/dQw4w9WgXcQ)';
    expect(findUrls(text)).toEqual(['https://www.instagram.com/reel/C9xYz12AbCd/?igsh=abc123', 'https://youtu.be/dQw4w9WgXcQ']);
  });

  it('keeps balanced parentheses that belong to the link', () => {
    expect(findUrls('see https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });

  it('finds links pasted without https://', () => {
    expect(findUrls('youtu.be/dQw4w9WgXcQ and instagram.com/p/ABC123xyz/')).toEqual([
      'https://youtu.be/dQw4w9WgXcQ',
      'https://instagram.com/p/ABC123xyz/',
    ]);
  });

  it('does not double count a bare match inside a full link', () => {
    expect(findUrls('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  });

  it('removes duplicates and ignores text without links', () => {
    expect(findUrls('https://x.com/a/status/1 https://x.com/a/status/1')).toEqual(['https://x.com/a/status/1']);
    expect(findUrls('no links here, just words.')).toEqual([]);
  });
});

describe('cleanUrl', () => {
  it('removes tracking parameters but keeps what matters', () => {
    expect(cleanUrl('https://youtu.be/dQw4w9WgXcQ?si=XYZ&t=42')).toBe('https://youtu.be/dQw4w9WgXcQ?t=42');
    expect(cleanUrl('https://www.instagram.com/reel/C9x/?igsh=abc&utm_source=ig_web')).toBe('https://www.instagram.com/reel/C9x/');
    expect(cleanUrl('https://x.com/user/status/123?s=20&t=abc')).toBe('https://x.com/user/status/123');
    expect(cleanUrl('https://www.facebook.com/reel/123?mibextid=abc&rdid=x#frag')).toBe('https://www.facebook.com/reel/123');
  });

  it('leaves the string untouched when nothing changes', () => {
    const u = 'https://example.com/a?b=c%20d';
    expect(cleanUrl(u)).toBe(u);
  });

  it('moves m.youtube.com to www', () => {
    expect(cleanUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('detect', () => {
  const cases: [string, Partial<ReturnType<typeof detect>>][] = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { site: 'youtube', kind: 'video', id: 'dQw4w9WgXcQ' }],
    ['https://youtu.be/dQw4w9WgXcQ?list=PL123', { site: 'youtube', kind: 'video', id: 'dQw4w9WgXcQ', listId: 'PL123' }],
    ['https://youtube.com/shorts/abcDEF12345?feature=share', { site: 'youtube', kind: 'short', id: 'abcDEF12345' }],
    ['https://www.youtube.com/live/abcDEF12345', { site: 'youtube', kind: 'live' }],
    ['https://www.youtube.com/playlist?list=PLx', { site: 'youtube', kind: 'playlist', listId: 'PLx' }],
    ['https://www.youtube.com/@SomeChannel', { site: 'youtube', kind: 'channel' }],
    ['https://music.youtube.com/watch?v=abcDEF12345&si=1', { site: 'ytmusic', kind: 'song', id: 'abcDEF12345' }],
    ['https://music.youtube.com/playlist?list=OLAK5uy_abc', { site: 'ytmusic', kind: 'album' }],
    ['https://www.instagram.com/reel/C9xYz12AbCd/', { site: 'instagram', kind: 'reel', id: 'C9xYz12AbCd' }],
    ['https://www.instagram.com/reels/C9xYz12AbCd/', { site: 'instagram', kind: 'reel' }],
    ['https://www.instagram.com/p/C9xYz12AbCd/?img_index=2', { site: 'instagram', kind: 'post', id: 'C9xYz12AbCd' }],
    ['https://www.instagram.com/someuser/p/C9xYz12AbCd/', { site: 'instagram', kind: 'post', id: 'C9xYz12AbCd' }],
    ['https://www.instagram.com/stories/someuser/3412345678901234567/', { site: 'instagram', kind: 'story' }],
    ['https://www.instagram.com/stories/highlights/17912345678901234/', { site: 'instagram', kind: 'highlight' }],
    ['https://www.instagram.com/reels/audio/1234567890/', { site: 'instagram', kind: 'audio' }],
    ['https://www.instagram.com/someuser/', { site: 'instagram', kind: 'profile', id: 'someuser' }],
    ['https://www.instagram.com/share/reel/BAabc123/', { site: 'instagram', short: true }],
    ['https://fb.watch/abcD12/', { site: 'facebook', short: true }],
    ['https://www.facebook.com/share/r/1AbCdEf/', { site: 'facebook', kind: 'reel', short: true }],
    ['https://www.facebook.com/reel/123456789', { site: 'facebook', kind: 'reel', id: '123456789' }],
    ['https://m.facebook.com/watch/?v=123', { site: 'facebook', kind: 'video', id: '123' }],
    ['https://www.facebook.com/somepage/videos/987654/', { site: 'facebook', kind: 'video', id: '987654' }],
    ['https://www.facebook.com/photo/?fbid=555', { site: 'facebook', kind: 'post', id: '555' }],
    ['https://x.com/someone/status/1790000000000000000', { site: 'x', kind: 'post', id: '1790000000000000000' }],
    ['https://twitter.com/someone/status/1790000000000000000/photo/1', { site: 'x', kind: 'post' }],
    ['https://t.co/abc', { site: 'x', short: true }],
    ['https://www.tiktok.com/@user/video/7300000000000000000', { site: 'tiktok', kind: 'video' }],
    ['https://vm.tiktok.com/ZMabc/', { site: 'tiktok', short: true }],
    ['https://www.reddit.com/r/videos/comments/abc123/some_title/', { site: 'reddit', kind: 'post', id: 'abc123' }],
    ['https://www.reddit.com/r/pics/s/AbCdEf', { site: 'reddit', short: true }],
    ['https://in.pinterest.com/pin/123456/', { site: 'pinterest', kind: 'post', id: '123456' }],
    ['https://pin.it/abc', { site: 'pinterest', short: true }],
    ['https://www.threads.net/@user/post/C9abc', { site: 'threads', kind: 'post' }],
    ['https://soundcloud.com/artist/track-name', { site: 'soundcloud', kind: 'song' }],
    ['https://soundcloud.com/artist/sets/album', { site: 'soundcloud', kind: 'album' }],
    ['https://www.jiosaavn.com/song/kesariya/abc', { site: 'jiosaavn', kind: 'song' }],
    ['https://clips.twitch.tv/SomeClipSlug', { site: 'twitch', kind: 'video' }],
    ['https://www.twitch.tv/streamer', { site: 'twitch', kind: 'live' }],
    ['https://www.snapchat.com/spotlight/W7_abc', { site: 'snapchat', kind: 'video' }],
    ['https://www.terabox.com/s/1abc', { site: 'terabox' }],
    ['https://bit.ly/3abc', { site: 'other', short: true }],
    ['https://example.com/some/video', { site: 'other', kind: 'unknown' }],
  ];
  it.each(cases)('%s', (url, want) => {
    expect(detect(url)).toMatchObject(want);
  });

  it('returns the cleaned URL', () => {
    expect(detect('https://youtu.be/dQw4w9WgXcQ?si=abc').url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('survives junk', () => {
    expect(detect('not a url')).toMatchObject({ site: 'other', kind: 'unknown' });
  });
});

describe('helpers', () => {
  it('firstLink detects the first link in text', () => {
    expect(firstLink('watch https://youtu.be/dQw4w9WgXcQ now')?.site).toBe('youtube');
    expect(firstLink('nothing')).toBeUndefined();
  });

  it('isCollection', () => {
    expect(isCollection('playlist')).toBe(true);
    expect(isCollection('video')).toBe(false);
  });
});

describe('drmService', () => {
  it('knows the DRM-only streaming services', () => {
    expect(drmService('https://www.netflix.com/title/80057281?s=a&trkid=13747225')).toEqual({ name: 'Netflix', music: false });
    expect(drmService('https://app.primevideo.com/detail?gti=amzn1.dv.gti.123')?.name).toBe('Prime Video');
    expect(drmService('https://www.amazon.in/gp/video/detail/B0D1234567')?.name).toBe('Prime Video');
    expect(drmService('https://www.hotstar.com/in/shows/anupama/1260022017/anupama-anuj-share-a-moment/1000282843')?.name).toBe('JioHotstar');
    expect(drmService('https://www.zee5.com/movies/details/krishna-and-his-leela/0-0-133334')?.name).toBe('ZEE5');
    expect(drmService('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc')).toEqual({ name: 'Spotify', music: true });
  });

  it('leaves other links alone', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.amazon.in/minitv/tp/75fe3a75-b8fe-4499-8100-5c9424344840',
      'https://www.amazon.in/dp/B0D1234567',
      'https://www.jiosaavn.com/song/chuttamalle/P1FfWjZkQ0Q',
      'not a link',
    ]) {
      expect(drmService(url)).toBeUndefined();
    }
  });
});
