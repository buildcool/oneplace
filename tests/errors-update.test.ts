import { describe, expect, it } from 'vitest';
import { errorLine, explain } from '../src/core/errors.ts';
import { buildOf, newest, pickAsset, type GhRelease } from '../src/core/update.ts';
import { olderThan, parseRemoteConfig } from '../src/core/remoteConfig.ts';
import { thumbChoices, youtubeThumbs } from '../src/core/thumbs.ts';
import { bytes, duration } from '../src/core/format.ts';

describe('explain', () => {
  const cases: [string, string, string][] = [
    ["ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies", 'login', 'login'],
    ['ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access', 'private', 'login'],
    ['ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader', 'unavailable', 'none'],
    ['ERROR: [Instagram] C9x: There is no video in this post', 'novideo', 'photos'],
    ['ERROR: [youtube] abc: nsig extraction failed: Some formats may be missing', 'extractor', 'update'],
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'forbidden', 'update'],
    ['ERROR: Unsupported URL: https://example.com/', 'unsupported', 'report'],
    ['ERROR: [Errno 28] No space left on device', 'space', 'folder'],
    ['ERROR: Unable to download webpage: <urlopen error [Errno 7] No address associated with hostname> (caused by Temporary failure in name resolution)', 'network', 'retry'],
    ['ERROR: [youtube] abc: This live event will begin in 3 hours.', 'upcoming', 'retry'],
    ['ERROR: [Instagram] abc: Requested content is not available, rate-limit reached or login required', 'ratelimit', 'login'],
    ['something odd happened', 'unknown', 'report'],
  ];
  it.each(cases)('%s', (raw, code, fix) => {
    expect(explain(raw)).toMatchObject({ code, fix });
  });

  it('bot checks are worth an engine update', () => {
    expect(explain("Sign in to confirm you're not a bot").engineFixable).toBe(true);
    expect(explain('Private video').engineFixable).toBe(false);
  });

  it('picks the error line', () => {
    expect(errorLine('WARNING: x\n[youtube] y\nERROR: [youtube] abc: Video unavailable\n')).toBe('[youtube] abc: Video unavailable');
  });
});

describe('app update', () => {
  const rel = (tag: string, prerelease = false, assets = ['OnePlace-arm64-v8a.apk', 'OnePlace-armeabi-v7a.apk', 'OnePlace-universal.apk']): GhRelease => ({
    tag_name: tag,
    prerelease,
    body: `notes ${tag}`,
    html_url: `https://github.com/x/releases/${tag}`,
    assets: assets.map((name) => ({ name, browser_download_url: `https://dl/${tag}/${name}`, size: 1 })),
  });

  it('parses build numbers from tags', () => {
    expect(buildOf('v1.0.57')).toBe(57);
    expect(buildOf('nope')).toBe(0);
  });

  it('picks the APK for the phone CPU, else universal', () => {
    const assets = rel('v1.0.2').assets!;
    expect(pickAsset(assets, ['arm64-v8a', 'armeabi-v7a'])?.name).toBe('OnePlace-arm64-v8a.apk');
    expect(pickAsset(assets, ['x86_64'])?.name).toBe('OnePlace-universal.apk');
  });

  it('stable ignores pre-releases; beta sees them', () => {
    const list = [rel('v1.0.10', true), rel('v1.0.8'), rel('v1.0.5')];
    expect(newest(list, 'stable', 5, ['arm64-v8a'])?.build).toBe(8);
    expect(newest(list, 'beta', 5, ['arm64-v8a'])?.build).toBe(10);
    expect(newest(list, 'stable', 8, ['arm64-v8a'])).toBeUndefined();
    expect(newest(list, 'beta', 8, ['arm64-v8a'])?.url).toBe('https://dl/v1.0.10/OnePlace-arm64-v8a.apk');
  });
});

describe('remote config', () => {
  it('keeps only safe options and valid fields', () => {
    const cfg = parseRemoteConfig({
      siteArgs: { youtube: ['--extractor-args', 'youtube:player_client=tv', '--exec', 'x'], 'bad site!': ['--force-ipv4'] },
      announcement: { id: 'yt-oct', text: { en: 'Update the engine', hi: 'इंजन अपडेट करें' }, url: 'javascript:alert(1)', level: 'warn' },
      minYtDlp: '2026.10.01',
      disabled: ['quickTargets', 5],
    });
    expect(cfg.siteArgs).toEqual({ youtube: ['--extractor-args', 'youtube:player_client=tv'] });
    expect(cfg.announcement).toEqual({ id: 'yt-oct', text: { en: 'Update the engine', hi: 'इंजन अपडेट करें' }, level: 'warn' });
    expect(cfg.minYtDlp).toBe('2026.10.01');
    expect(cfg.disabled).toEqual(['quickTargets']);
    expect(parseRemoteConfig(null)).toEqual({ siteArgs: {}, disabled: [] });
  });

  it('compares yt-dlp versions including nightly tags', () => {
    expect(olderThan('2026.09.30', '2026.10.01')).toBe(true);
    expect(olderThan('2026.10.01.233000', '2026.10.01')).toBe(false);
    expect(olderThan(undefined, '2026.10.01')).toBe(false);
  });
});

describe('thumbnails', () => {
  it('YouTube sizes come from the id, biggest first with fallbacks', () => {
    const t = youtubeThumbs('dQw4w9WgXcQ');
    expect(t[0].urls[0]).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    expect(t[0].urls.at(-1)).toContain('hqdefault');
    expect(thumbChoices({ site: 'youtube', id: 'dQw4w9WgXcQ' })).toHaveLength(5);
  });

  it('other sites use the largest images from the engine list', () => {
    const c = thumbChoices({ site: 'instagram' }, [
      { url: 'https://a/small.jpg', width: 150, height: 150 },
      { url: 'https://a/big.jpg', width: 1080, height: 1350 },
      { url: 'https://a/big.jpg', width: 1080, height: 1350 },
    ]);
    expect(c.map((x) => x.urls[0])).toEqual(['https://a/big.jpg', 'https://a/small.jpg']);
    expect(c[0].label).toBe('1080×1350');
    expect(thumbChoices({ site: 'other' }, [], 'https://f/b.jpg')[0].urls).toEqual(['https://f/b.jpg']);
  });
});

describe('format helpers', () => {
  it('formats sizes and durations', () => {
    expect(bytes(96 * 1024 * 1024)).toBe('96 MB');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(undefined)).toBe('');
    expect(duration(225)).toBe('3:45');
    expect(duration(3723)).toBe('1:02:03');
  });
});

describe('instagram login', () => {
  it('a login redirect asks for login', () => {
    expect(explain('AbortExtraction: HTTP redirect to login page (https://www.instagram.com/accounts/login/)').fix).toBe('login');
  });
});
