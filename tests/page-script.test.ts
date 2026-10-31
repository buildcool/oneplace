import { describe, expect, it } from 'vitest';
import { bigImage, contentLink, fetchable, hideCss, hostMatches, largestSrc, prune, rulesFor, tidy } from '../src/page/logic.ts';
import { encodeBlocklist, fnv1a64, parseDomains } from '../scripts/adblock.ts';

describe('page script', () => {
  it('applies a site’s rules to its subdomains', () => {
    expect(hostMatches('m.youtube.com', 'youtube.com')).toBe(true);
    expect(hostMatches('notyoutube.com', 'youtube.com')).toBe(false);
    expect(rulesFor({ 'youtube.com': 1, 'music.youtube.com': 2, 'x.com': 3 }, 'music.youtube.com')).toEqual([1, 2]);
  });

  it('builds its own hiding CSS and refuses anything that could load or leak', () => {
    expect(hideCss(['.ad', 'ytm-promoted-video-renderer'])).toBe('.ad,\nytm-promoted-video-renderer { display: none !important; }');
    expect(hideCss(['a{color:red}', 'input[value^="a"]{background:url(https://evil/a)}', '@import x', '.ok'])).toBe('.ok { display: none !important; }');
    expect(hideCss([])).toBe('');
  });

  it('picks the largest picture of a srcset', () => {
    expect(largestSrc('a.jpg 320w, https://cdn/b.jpg 1080w, c.jpg 640w', 'https://site.com/p/')).toBe('https://cdn/b.jpg');
    expect(largestSrc('x1.jpg 1x, x2.jpg 2x', 'https://site.com/')).toBe('https://site.com/x2.jpg');
    expect(largestSrc('', 'https://site.com/')).toBeUndefined();
  });

  it('reports only fetchable media and real posts', () => {
    expect(fetchable('blob:https://x/1')).toBe(false);
    expect(fetchable('https://cdn/v.mp4')).toBe(true);
    expect(contentLink('/reel/ABC123/', 'https://www.instagram.com/')).toEqual({ url: 'https://www.instagram.com/reel/ABC123/', site: 'instagram', kind: 'reel' });
    expect(contentLink('/explore/', 'https://www.instagram.com/')).toBeUndefined();
    expect(contentLink('javascript:void(0)', 'https://a.com/')).toBeUndefined();
    expect(contentLink('/watch?v=abcdefghijk', 'https://m.youtube.com/')?.kind).toBe('video');
    expect(bigImage(1080, 1350)).toBe(true);
    expect(bigImage(64, 64)).toBe(false);
    expect(tidy('  a \n  b  ')).toBe('a b');
    expect(tidy('x'.repeat(130))).toHaveLength(120);
  });

  it('removes ad slots from page data', () => {
    const data = { playerResponse: { adPlacements: [1], videoDetails: { id: 'x' } }, playerAds: [2] };
    expect(prune(data, ['playerResponse.adPlacements', 'playerAds', 'adSlots'])).toBe(true);
    expect(data).toEqual({ playerResponse: { videoDetails: { id: 'x' } } });
    expect(prune(data, ['adSlots'])).toBe(false);
    expect(prune(null, ['a'])).toBe(false);
  });
});

describe('ad block list file', () => {
  it('hashes like the app (FNV-1a 64, signed)', () => {
    // Known FNV-1a 64 test vectors.
    expect(BigInt.asUintN(64, fnv1a64(''))).toBe(0xcbf29ce484222325n);
    expect(BigInt.asUintN(64, fnv1a64('a'))).toBe(0xaf63dc4c8601ec8cn);
    expect(BigInt.asUintN(64, fnv1a64('foobar'))).toBe(0x85944171f73967e8n);
  });

  it('reads domain lists and writes a sorted, unique table', () => {
    expect(parseDomains('# comment\n\nads.example.com\n*.tracker.net\n||x.io^\nlocalhost\nbad entry\n')).toEqual(['ads.example.com', 'tracker.net', 'x.io']);
    const bin = encodeBlocklist(['b.com', 'a.com', 'b.com']);
    const v = new DataView(bin.buffer);
    expect(v.getInt32(0)).toBe(0x4f504231);
    expect(v.getInt32(4)).toBe(2);
    expect(v.getBigInt64(8) < v.getBigInt64(16)).toBe(true);
    expect(bin.length).toBe(24);
  });
});
