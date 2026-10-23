import { describe, expect, it } from 'vitest';
import { audioOptions, bestAudio, codecName, parseGallery, parseYtInfo, resLabel, videoOptions, type YtInfo } from '../src/core/formats.ts';
import video from './fixtures/yt-video.json';
import short from './fixtures/yt-short.json';
import playlist from './fixtures/yt-playlist.json';
import gallery from './fixtures/gallery-ig.json';

const V = video as YtInfo;

describe('labels', () => {
  it('names resolutions like people do', () => {
    expect(resLabel(2160)).toBe('4K');
    expect(resLabel(1440)).toBe('2K');
    expect(resLabel(1080, 60)).toBe('1080p60');
    expect(resLabel(720, 30, true)).toBe('720p HDR');
  });

  it('names codecs', () => {
    expect(codecName('avc1.640028')).toBe('H.264');
    expect(codecName('vp09.00.40.08')).toBe('VP9');
    expect(codecName('av01.0.08M.08')).toBe('AV1');
    expect(codecName('hev1')).toBe('H.265');
  });
});

describe('bestAudio', () => {
  it('skips DRC variants and prefers AAC in compatible mode', () => {
    expect(bestAudio(V.formats!, true)?.format_id).toBe('140');
    expect(bestAudio(V.formats!, false)?.format_id).toBe('251');
  });
});

describe('videoOptions', () => {
  it('compatible mode picks H.264 where it exists and merges with AAC', () => {
    const opts = videoOptions(V, true);
    expect(opts.map((o) => o.label)).toEqual(['4K', '1080p50', '1080p', '720p', '360p']);
    const p1080 = opts.find((o) => o.label === '1080p')!;
    expect(p1080.codec).toBe('H.264');
    expect(p1080.container).toBe('MP4');
    expect(p1080.formatSel.startsWith('137+140/')).toBe(true);
    expect(p1080.size).toBe(100000000 + 3450000);
    expect(p1080.approx).toBe(false);
  });

  it('best mode prefers VP9 and ends up in MKV when codecs need it', () => {
    const opts = videoOptions(V, false);
    const p1080 = opts.find((o) => o.label === '1080p')!;
    expect(p1080.codec).toBe('VP9');
    expect(p1080.formatSel.startsWith('248+251/')).toBe(true);
    expect(p1080.container).toBe('MKV');
    expect(opts.find((o) => o.label === '4K')!.codec).toBe('VP9');
  });

  it('a progressive format needs no merge', () => {
    const p360 = videoOptions(V, true).find((o) => o.label === '360p')!;
    // 134 (video-only H.264) and 18 (progressive) share a group; either is fine but must download with sound
    expect(p360.formatSel).toMatch(/^(18\/|134\+140\/)/);
  });

  it('uses the short side for vertical videos (1080×1920 is 1080p)', () => {
    expect(videoOptions(short as YtInfo, true).map((o) => o.label)).toEqual(['1080p', '720p']);
  });

  it('marks estimated sizes', () => {
    expect(videoOptions(V, false).find((o) => o.label === '1080p50')!.approx).toBe(true);
  });
});

describe('audioOptions', () => {
  it('estimates MP3 sizes from duration and reports the source bitrate', () => {
    const { options, sourceKbps } = audioOptions(V);
    expect(sourceKbps).toBe(135);
    const mp3 = options.find((o) => o.key === 'mp3-320')!;
    expect(mp3.converted).toBe(true);
    expect(Math.round(mp3.size!)).toBe((320 * 1000 * 213) / 8);
    expect(options.find((o) => o.key === 'original')!.converted).toBe(false);
    expect(options.find((o) => o.key === 'm4a')!.converted).toBe(false);
  });
});

describe('parseYtInfo', () => {
  it('reads a video', () => {
    const m = parseYtInfo(V, true);
    expect(m.title).toMatch(/Never Gonna/);
    expect(m.author).toBe('Rick Astley');
    expect(m.duration).toBe(213);
    expect(m.video.length).toBeGreaterThan(3);
    expect(m.playlist).toBeUndefined();
  });

  it('reads a flat playlist and drops missing entries', () => {
    const m = parseYtInfo(playlist as YtInfo, true);
    expect(m.playlist?.count).toBe(3);
    expect(m.playlist?.entries.map((e) => e.title)).toEqual(['One', 'Two']);
    expect(m.video).toEqual([]);
  });
});

describe('parseGallery', () => {
  it('lists photos and videos of an Instagram carousel', () => {
    const g = parseGallery(gallery);
    expect(g.title).toBe('Goa trip 🌴');
    expect(g.author).toBe('someuser');
    expect(g.items.map((i) => [i.num, i.ext, i.isVideo])).toEqual([
      [1, 'jpg', false],
      [2, 'mp4', true],
      [3, 'webp', false],
    ]);
    expect(g.items[1].preview).toContain('2-cover.jpg');
  });

  it('copes with junk', () => {
    expect(parseGallery({}).items).toEqual([]);
    expect(parseGallery([[6, 'https://x/queued', {}]]).queued).toBe(1);
  });
});

describe('gallery-dl errors', () => {
  it('reports the error gallery-dl prints inside its JSON', () => {
    const g = parseGallery([[-1, { error: 'AbortExtraction', message: 'HTTP redirect to login page (https://www.instagram.com/accounts/login/)' }]]);
    expect(g.items).toEqual([]);
    expect(g.error).toContain('redirect to login page');
  });
});

describe('parseJson', () => {
  it('reads engine output, skipping stray lines before the JSON', async () => {
    const { parseJson } = await import('../src/core/formats.ts');
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('WARNING: something\n[1,2]')).toEqual([1, 2]);
    expect(parseJson('nothing')).toBeUndefined();
  });
});
