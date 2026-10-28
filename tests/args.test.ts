import { describe, expect, it } from 'vitest';
import { formatSort, galleryArgs, safeRemoteArgs, splitArgs, stripDangerous, ytdlpArgs } from '../src/core/args.ts';
import { DEFAULTS, buildRequest, canAutoStart, isMusic, quickRequest, quickTemplates } from '../src/core/settings.ts';
import { detect } from '../src/core/links.ts';

const after = (args: string[], opt: string) => args[args.indexOf(opt) + 1];

describe('ytdlpArgs', () => {
  it('video: exact format with fallbacks, compatible MP4', () => {
    const a = ytdlpArgs({ mode: 'video', formatId: '137+140/137+ba/137/bv*+ba/b', compat: true });
    expect(after(a, '-f')).toBe('137+140/137+ba/137/bv*+ba/b');
    expect(after(a, '--merge-output-format')).toBe('mp4');
    expect(a).toContain('--no-playlist');
    expect(a).toContain('--no-mtime');
    expect(a).not.toContain('-P');
  });

  it('video preset sorts by resolution cap then H.264', () => {
    const a = ytdlpArgs({ mode: 'video', maxRes: 720, compat: true });
    expect(after(a, '-f')).toBe('bv*+ba/b');
    expect(after(a, '-S')).toBe('res:720,fps,vcodec:h264,acodec:m4a');
    expect(formatSort(undefined, false)).toBe('res,fps');
  });

  it('audio MP3 with cover, square crop and tags', () => {
    const a = ytdlpArgs({ mode: 'audio', audio: 'mp3', bitrate: 192, embedCover: true, squareCover: true });
    expect(a).toEqual(expect.arrayContaining(['-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--embed-thumbnail', '--embed-metadata']));
    expect(after(a, '--ppa')).toContain('crop=');
  });

  it('original audio is not re-encoded', () => {
    const a = ytdlpArgs({ mode: 'audio', audio: 'original' });
    expect(a).toContain('-x');
    expect(a).not.toContain('--audio-format');
  });

  it('thumbnail only', () => {
    const a = ytdlpArgs({ mode: 'thumbnail' });
    expect(a).toEqual(expect.arrayContaining(['--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg']));
  });

  it('playlist: first N items, numbered names, polite delays', () => {
    const a = ytdlpArgs({ mode: 'audio', playlist: true, playlistEnd: 10 });
    expect(a).toContain('--yes-playlist');
    expect(after(a, '-I')).toBe('1:10');
    expect(after(a, '-o')).toContain('playlist_index');
    expect(a).toContain('--sleep-interval');
  });
});

describe('galleryArgs', () => {
  it('passes the item range', () => {
    expect(galleryArgs({ mode: 'photo', range: '1,3' })).toEqual(expect.arrayContaining(['--range', '1,3']));
  });
});

describe('safety', () => {
  it('remote config can only set allow-listed options', () => {
    expect(
      safeRemoteArgs(['--extractor-args', 'youtube:player_client=tv', '--exec', 'rm -rf /', '--force-ipv4', '-o', '/sdcard/x', '--user-agent', '--bad']),
    ).toEqual(['--extractor-args', 'youtube:player_client=tv', '--force-ipv4']);
    expect(safeRemoteArgs('nope')).toEqual([]);
  });

  it('user options never run commands', () => {
    expect(stripDangerous(['--exec', 'echo hi', '-f', 'best', '--exec-before-download=x', '--paths', '/sdcard'])).toEqual(['-f', 'best']);
  });

  it('splits options like a shell', () => {
    expect(splitArgs(`--extractor-args "youtube:player_client=tv,web" -S 'res:720' --x ""`)).toEqual([
      '--extractor-args',
      'youtube:player_client=tv,web',
      '-S',
      'res:720',
      '--x',
      '',
    ]);
  });
});

describe('requests and quick templates', () => {
  it('Instagram post video falls back to photos', () => {
    const r = buildRequest({ link: detect('https://www.instagram.com/p/ABC/'), engine: 'ytdlp', spec: { mode: 'video' }, title: 't' });
    expect(r.fallback?.engine).toBe('gallerydl');
    expect(r.dest).toBe('video');
  });

  it('YouTube video has no photo fallback', () => {
    const r = buildRequest({ link: detect('https://youtu.be/dQw4w9WgXcQ'), engine: 'ytdlp', spec: { mode: 'video' }, title: 't' });
    expect(r.fallback).toBeUndefined();
  });

  it('a download started before the link was read takes its title from the file', () => {
    const link = detect('https://youtu.be/dQw4w9WgXcQ');
    expect(buildRequest({ link, engine: 'ytdlp', spec: { mode: 'video' }, title: 'YouTube · Video', titleFromFile: true }).titleFromFile).toBe(true);
    expect(buildRequest({ link, engine: 'ytdlp', spec: { mode: 'video' }, title: 't' })).not.toHaveProperty('titleFromFile');
  });

  it('quick templates follow settings', () => {
    const q = quickTemplates({ ...DEFAULTS, mp3Bitrate: 128, videoQuality: 720 });
    expect(q.audio.main.args).toEqual(expect.arrayContaining(['--audio-quality', '128K']));
    expect(after(q.video.main.args, '-S')).toContain('res:720');
    expect(q.video.fallback?.engine).toBe('gallerydl');
    expect(q.thumbnail.main.dest).toBe('image');
  });
});

describe('copied links that start by themselves', () => {
  it('one video, reel, post or song on a known site starts', () => {
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
      'https://www.youtube.com/shorts/abcDEF12345',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.instagram.com/reel/C9xYz12AbCd/',
      'https://x.com/user/status/1234567890',
    ]) {
      expect(canAutoStart(detect(url), false)).toBe(true);
    }
  });

  it('playlists, channels, live streams, short links, photo-first and unknown pages open the sheet instead', () => {
    for (const url of [
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/live/abcDEF12345',
      'https://fb.watch/abc123/',
      'https://www.instagram.com/stories/someone/123/',
      'https://example.com/news/article',
      'https://www.netflix.com/title/80057281',
    ]) {
      expect(canAutoStart(detect(url), false)).toBe(false);
    }
    // Logged in, Instagram posts go to gallery-dl first (photos and carousels).
    expect(canAutoStart(detect('https://www.instagram.com/p/C9xYz12AbCd/'), true)).toBe(false);
  });

  it('music links download as audio, the rest as video, both titled from the file', () => {
    const song = quickRequest(detect('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), DEFAULTS);
    expect(song.mode).toBe('audio');
    expect(song.titleFromFile).toBe(true);
    expect(song.thumb).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/');
    const video = quickRequest(detect('https://youtu.be/dQw4w9WgXcQ'), DEFAULTS);
    expect(video.mode).toBe('video');
    expect(video.title).toBe('YouTube · Video');
    expect(quickRequest(detect('https://youtu.be/dQw4w9WgXcQ'), DEFAULTS, 'audio').mode).toBe('audio');
    expect(isMusic(detect('https://soundcloud.com/artist/track'))).toBe(true);
  });
});
