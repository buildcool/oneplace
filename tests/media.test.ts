import { describe, expect, it } from 'vitest';
import {
  dateKey,
  groupByDate,
  isVertical,
  jobThumbs,
  mediaItems,
  resLabel,
  resumeAt,
  searchItems,
  sortItems,
  titleFromName,
  withPosition,
  type Positions,
} from '../src/core/media.ts';
import { DEFAULTS, editRequest } from '../src/core/settings.ts';
import type { Job, JobFile } from '../src/core/types.ts';

const file = (name: string, mime: string, extra: Partial<JobFile> = {}): JobFile => ({ uri: `content://media/${name}`, name, mime, size: 1000, ...extra });

function job(id: string, files: JobFile[], extra: Partial<Job> = {}): Job {
  return {
    id,
    url: `https://example.com/${id}`,
    site: 'youtube',
    title: `Job ${id}`,
    mode: 'video',
    dest: 'video',
    status: 'done',
    progress: 100,
    eta: 0,
    files,
    createdAt: 1000,
    finishedAt: 2000,
    attempts: 0,
    ...extra,
  };
}

describe('mediaItems', () => {
  it('one video: job title, local thumb first, then the site picture, then the live frame', () => {
    const [it] = mediaItems([job('a', [file('Clip [abc123def45].mp4', 'video/mp4', { thumb: '/t/a.jpg', dur: 61, w: 1920, h: 1080 })], { thumb: 'https://i.ytimg.com/x.jpg', preview: '/t/live.jpg' })]);
    expect(it).toMatchObject({ key: 'a:0', kind: 'video', title: 'Job a', dur: 61, w: 1920, h: 1080 });
    expect(it!.thumbs).toEqual(['/t/a.jpg', 'https://i.ytimg.com/x.jpg', '/t/live.jpg']);
    expect(it!.part).toBeUndefined();
  });

  it('playlists list every song with its own title and never the playlist picture', () => {
    const items = mediaItems([
      job('p', [file('001. One [aaaaaaaaaaa].mp3', 'audio/mpeg', { title: 'One' }), file('002. Two [bbbbbbbbbbb].mp3', 'audio/mpeg')], { thumb: 'https://x/playlist.jpg', mode: 'audio', dest: 'audio' }),
    ]);
    expect(items.map((i) => i.title)).toEqual(['One', 'Two']);
    expect(items.map((i) => i.part)).toEqual([
      { n: 1, of: 2 },
      { n: 2, of: 2 },
    ]);
    expect(items[1]!.thumbs).toEqual([]);
  });

  it('carousel photos are separate items that fall back to the photo itself', () => {
    const items = mediaItems([job('c', [file('1.jpg', 'image/jpeg', { thumb: '/t/1.jpg' }), file('2.jpg', 'image/jpeg')], { dest: 'image', mode: 'photo' })]);
    expect(items.map((i) => i.kind)).toEqual(['image', 'image']);
    expect(items[0]!.thumbs).toEqual(['/t/1.jpg', 'content://media/1.jpg']);
    expect(items[1]!.thumbs).toEqual(['content://media/2.jpg']);
  });

  it('a picture named like the song is its cover, and subtitles go with their video', () => {
    const items = mediaItems([
      job('s', [file('Song [x].mp3', 'audio/mpeg'), file('Song [x].jpg', 'image/jpeg')]),
      job('v', [file('Film [y].mp4', 'video/mp4'), file('Film [y].en.srt', 'application/x-subrip'), file('Film [y].hi.vtt', 'text/vtt')], { finishedAt: 1500 }),
    ]);
    expect(items.map((i) => i.key)).toEqual(['s:0', 'v:0']);
    expect(items[0]!.thumbs).toContain('content://media/Song [x].jpg');
    expect(items[1]!.subs.map((s) => s.name)).toEqual(['Film [y].en.srt', 'Film [y].hi.vtt']);
  });

  it('skips unfinished downloads and sorts newest first', () => {
    const items = mediaItems([
      job('old', [file('a.mp4', 'video/mp4')], { finishedAt: 10 }),
      job('new', [file('b.mp4', 'video/mp4')], { finishedAt: 99 }),
      job('run', [file('c.mp4', 'video/mp4')], { status: 'running' }),
    ]);
    expect(items.map((i) => i.jobId)).toEqual(['new', 'old']);
  });

  it('vocal remover copies point at their source', () => {
    const [it] = mediaItems([
      job('k', [file('Song (Karaoke).mp3', 'audio/mpeg', { stem: 'music' })], { edit: { kind: 'karaoke', source: { id: 's', index: 0 }, keep: 'music', as: 'audio' } }),
    ]);
    expect(it).toMatchObject({ editOf: 's:0', stem: 'music' });
  });
});

describe('titles and labels', () => {
  it('cleans yt-dlp file names', () => {
    expect(titleFromName('Me at the zoo [jNQXAC9IVRw].mp4')).toBe('Me at the zoo');
    expect(titleFromName('03. Track name [abcdefghijk].m4a')).toBe('Track name');
    expect(titleFromName('photo.jpg')).toBe('photo');
  });

  it('labels resolution by the short side', () => {
    expect(resLabel(1920, 1080)).toBe('1080p');
    expect(resLabel(1080, 1920)).toBe('1080p');
    expect(resLabel(3840, 2160)).toBe('4K');
    expect(resLabel(640, 360)).toBe('360p');
    expect(resLabel(undefined, 100)).toBe('');
    expect(isVertical({ w: 1080, h: 1920 })).toBe(true);
    expect(isVertical({ w: 1920, h: 1080 })).toBe(false);
  });
});

describe('jobThumbs', () => {
  it('prefers the site picture while downloading and the phone-made one when done', () => {
    const running = job('r', [], { status: 'running', thumb: 'https://x/t.jpg', preview: '/t/live.jpg' });
    expect(jobThumbs(running)).toEqual(['https://x/t.jpg', '/t/live.jpg']);
    const done = job('d', [file('a.mp4', 'video/mp4', { thumb: '/t/a.jpg' })], { thumb: 'https://x/t.jpg' });
    expect(jobThumbs(done)).toEqual(['/t/a.jpg', 'https://x/t.jpg']);
  });
});

describe('sort, search, dates', () => {
  const items = mediaItems([
    job('1', [file('b.mp4', 'video/mp4', { size: 5, dur: 10, title: 'Banana song' })], { finishedAt: 3 }),
    job('2', [file('a.mp4', 'video/mp4', { size: 9, dur: 300, title: 'apple Pie', artist: 'Chef' })], { finishedAt: 2, site: 'instagram' }),
    job('3', [file('c.mp4', 'video/mp4', { size: 1, title: 'Cherry' })], { finishedAt: 1 }),
  ]);

  it('sorts', () => {
    expect(sortItems(items, 'new').map((i) => i.jobId)).toEqual(['1', '2', '3']);
    expect(sortItems(items, 'old').map((i) => i.jobId)).toEqual(['3', '2', '1']);
    expect(sortItems(items, 'big').map((i) => i.jobId)).toEqual(['2', '1', '3']);
    expect(sortItems(items, 'long').map((i) => i.jobId)).toEqual(['2', '1', '3']);
    expect(sortItems(items, 'name').map((i) => i.title)).toEqual(['apple Pie', 'Banana song', 'Cherry']);
  });

  it('searches every word in title, artist and site', () => {
    expect(searchItems(items, 'pie chef').map((i) => i.jobId)).toEqual(['2']);
    expect(searchItems(items, 'INSTAGRAM').map((i) => i.jobId)).toEqual(['2']);
    expect(searchItems(items, '  ')).toHaveLength(3);
  });

  it('groups by day, week and month', () => {
    const now = new Date(2026, 9, 29, 15, 0).getTime();
    expect(dateKey(new Date(2026, 9, 29, 1).getTime(), now)).toBe('today');
    expect(dateKey(new Date(2026, 9, 28, 23).getTime(), now)).toBe('yesterday');
    expect(dateKey(new Date(2026, 9, 24).getTime(), now)).toBe('week');
    expect(dateKey(new Date(2026, 8, 3).getTime(), now)).toBe('2026-8');
    const groups = groupByDate(
      [
        { ...items[0]!, date: new Date(2026, 9, 29, 9).getTime() },
        { ...items[1]!, date: new Date(2026, 9, 29, 8).getTime() },
        { ...items[2]!, date: new Date(2026, 6, 1).getTime() },
      ],
      now,
    );
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['today', 2],
      ['2026-6', 1],
    ]);
  });
});

describe('resume positions', () => {
  it('resumes only in the middle', () => {
    expect(resumeAt(5, 100)).toBe(0);
    expect(resumeAt(50, 100)).toBe(50);
    expect(resumeAt(96, 100)).toBe(0);
    expect(resumeAt(595, 600)).toBe(0);
    expect(resumeAt(120, undefined)).toBe(120);
  });

  it('keeps the newest 300 and forgets finished ones', () => {
    let p: Positions = {};
    for (let i = 0; i < 305; i++) p = withPosition(p, `u${i}`, 30, 100, i);
    expect(Object.keys(p)).toHaveLength(300);
    expect(p.u0).toBeUndefined();
    expect(p.u304).toEqual([30, 100, 304]);
    p = withPosition(p, 'u304', 99, 100, 400);
    expect(p.u304).toBeUndefined();
  });
});

describe('editRequest', () => {
  const src = { id: 'j1', url: 'https://youtu.be/x', site: 'youtube', title: 'Song', thumb: 'https://x/t.jpg' };
  it('karaoke from a video keeps the video', () => {
    const r = editRequest({ job: src, index: 0, title: 'Song', isVideo: true, keep: 'music', as: 'video' });
    expect(r).toMatchObject({ engine: 'edit', dest: 'video', mode: 'video', title: 'Song (Karaoke)' });
    expect(r.edit).toEqual({ kind: 'karaoke', source: { id: 'j1', index: 0 }, keep: 'music', as: 'video' });
  });
  it('songs always come out as audio', () => {
    const r = editRequest({ job: src, index: 2, title: 'Song', isVideo: false, keep: 'vocals', as: 'video', bitrate: DEFAULTS.mp3Bitrate });
    expect(r).toMatchObject({ dest: 'audio', mode: 'audio', title: 'Song (Vocals)' });
    expect(r.edit).toMatchObject({ as: 'audio', bitrate: 320, source: { index: 2 } });
  });
});
