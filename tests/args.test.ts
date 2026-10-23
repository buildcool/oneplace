import { describe, expect, it } from 'vitest';
import { formatSort, galleryArgs, safeRemoteArgs, splitArgs, stripDangerous, ytdlpArgs } from '../src/core/args.ts';
import { DEFAULTS, buildRequest, quickTemplates } from '../src/core/settings.ts';
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

  it('quick templates follow settings', () => {
    const q = quickTemplates({ ...DEFAULTS, mp3Bitrate: 128, videoQuality: 720 });
    expect(q.audio.main.args).toEqual(expect.arrayContaining(['--audio-quality', '128K']));
    expect(after(q.video.main.args, '-S')).toContain('res:720');
    expect(q.video.fallback?.engine).toBe('gallerydl');
    expect(q.thumbnail.main.dest).toBe('image');
  });
});
