import { describe, expect, it } from 'vitest';
import {
  addVisit,
  blankTab,
  dayLabel,
  defaultShortcuts,
  displayHost,
  nextActive,
  pageKey,
  parseSuggest,
  retitle,
  saveableTabs,
  searchTerms,
  searchVisits,
  suggestions,
  toUrl,
  toggleBookmark,
  topSites,
  HISTORY_MAX,
  type Visit,
} from '../src/core/browser.ts';

describe('address or search', () => {
  it('opens addresses as they are and adds https://', () => {
    expect(toUrl('https://www.youtube.com/watch?v=abc')).toEqual({ url: 'https://www.youtube.com/watch?v=abc', search: false });
    expect(toUrl('instagram.com')).toEqual({ url: 'https://instagram.com/', search: false });
    expect(toUrl('m.example.co.in/path?x=1')).toEqual({ url: 'https://m.example.co.in/path?x=1', search: false });
    expect(toUrl('example.com:8080/a')!.url).toBe('https://example.com:8080/a');
    expect(toUrl('localhost:5173')!.url).toBe('http://localhost:5173');
    expect(toUrl('192.168.1.1')!.url).toBe('http://192.168.1.1');
  });

  it('searches words, with the chosen engine', () => {
    expect(toUrl('arijit singh songs')).toEqual({ url: 'https://www.google.com/search?q=arijit%20singh%20songs', search: true });
    expect(toUrl('cats', 'duckduckgo')!.url).toBe('https://duckduckgo.com/?q=cats');
    expect(toUrl('youtube')!.search).toBe(true);
    expect(toUrl('1.5')!.search).toBe(true);
  });

  it('never opens other kinds of links from typing', () => {
    expect(toUrl('javascript:alert(1)')!.search).toBe(true);
    expect(toUrl('intent://scan#Intent;end')!.search).toBe(true);
    expect(toUrl('file:///sdcard/x')!.search).toBe(true);
    expect(toUrl('   ')).toBeUndefined();
  });

  it('shows the words of a search again', () => {
    expect(searchTerms('https://www.google.com/search?q=kesariya+song')).toBe('kesariya song');
    expect(searchTerms('https://m.youtube.com/results?search_query=lofi')).toBe('lofi');
    expect(searchTerms('https://music.youtube.com/search?q=arijit')).toBe('arijit');
    expect(searchTerms('https://example.com/search?q=x')).toBeUndefined();
  });

  it('names sites by their main host', () => {
    expect(displayHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(displayHost('https://m.facebook.com/')).toBe('facebook.com');
    expect(displayHost('not a url')).toBe('not a url');
  });
});

describe('history', () => {
  it('keeps each page once, newest first, counting visits', () => {
    let h: Visit[] = [];
    h = addVisit(h, { url: 'https://a.com/x', title: 'A' }, 1);
    h = addVisit(h, { url: 'https://b.com/', title: 'B' }, 2);
    h = addVisit(h, { url: 'https://a.com/x#frag', title: '' }, 3);
    expect(h.map((v) => v.url)).toEqual(['https://a.com/x#frag', 'https://b.com/']);
    expect(h[0]!.visits).toBe(2);
    expect(h[0]!.title).toBe('A');
    expect(addVisit(h, { url: 'about:blank' })).toBe(h);
  });

  it('caps the list', () => {
    let h: Visit[] = [];
    for (let i = 0; i < HISTORY_MAX + 20; i++) h = addVisit(h, { url: `https://s${i}.com/` }, i);
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0]!.url).toBe(`https://s${HISTORY_MAX + 19}.com/`);
  });

  it('adds titles that arrive later and finds pages by words', () => {
    let h = addVisit([], { url: 'https://www.jiosaavn.com/song/x', title: '' }, 1);
    h = retitle(h, 'https://www.jiosaavn.com/song/x', 'Kesariya – JioSaavn');
    h = addVisit(h, { url: 'https://example.com/', title: 'Example' }, 2);
    expect(searchVisits(h, 'kesariya').map((v) => v.title)).toEqual(['Kesariya – JioSaavn']);
    expect(searchVisits(h, 'jio song')).toHaveLength(1);
    expect(searchVisits(h, 'nothing')).toHaveLength(0);
  });

  it('labels days', () => {
    const now = new Date(2026, 9, 30, 15).getTime();
    expect(dayLabel(new Date(2026, 9, 30, 1).getTime(), now)).toBe('today');
    expect(dayLabel(new Date(2026, 9, 29, 23).getTime(), now)).toBe('yesterday');
    expect(dayLabel(new Date(2026, 9, 20, 12).getTime(), now)).toMatch(/^2026-10-2/);
  });
});

describe('bookmarks and start page', () => {
  it('toggles a bookmark for the same page', () => {
    let b = toggleBookmark([], { url: 'https://a.com/x?utm_source=y', title: 'A' }, 1);
    expect(b).toHaveLength(1);
    b = toggleBookmark(b, { url: 'https://a.com/x' });
    expect(b).toHaveLength(0);
    expect(pageKey('https://a.com/x/#top')).toBe('https://a.com/x');
  });

  it('lists pinned sites first, then built-in ones, then often-visited hosts; removed ones stay away', () => {
    const now = 10 * 86_400_000;
    let h: Visit[] = [];
    for (let i = 0; i < 4; i++) h = addVisit(h, { url: `https://news.example.org/p${i}` }, now - i);
    const sites = topSites({ pinned: [{ url: 'https://pinned.dev/', title: 'Pinned' }], hidden: ['facebook.com'] }, h, 30, now);
    expect(sites[0]!.title).toBe('Pinned');
    expect(sites.some((s) => s.url.includes('facebook'))).toBe(false);
    expect(sites.some((s) => s.title === 'news.example.org')).toBe(true);
    expect(defaultShortcuts().every((s) => s.url.startsWith('https://'))).toBe(true);
  });
});

describe('tabs', () => {
  const tabs = ['a', 'b', 'c'].map((id) => blankTab(id, `https://${id}.com/`));

  it('picks the neighbour after closing the tab on screen', () => {
    expect(nextActive(tabs, 'b', 'b')).toBe('c');
    expect(nextActive(tabs, 'c', 'c')).toBe('b');
    expect(nextActive(tabs, 'a', 'c')).toBe('c');
    expect(nextActive([tabs[0]!], 'a', 'a')).toBeUndefined();
  });

  it('never keeps private tabs', () => {
    const saved = saveableTabs([...tabs, { ...blankTab('p', 'https://secret.com/', true) }], 'p');
    expect(saved.list.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(saved.active).toBe('a');
  });
});

describe('address panel suggestions', () => {
  const history = addVisit(addVisit([], { url: 'https://www.instagram.com/reel/abc/', title: 'Reel by someone' }, 1), { url: 'https://news.com/', title: 'News' }, 2);
  const base = { engine: 'google' as const, history, bookmarks: [], tabs: [] };

  it('starts with what the text does, then history, sites and the engine’s guesses', () => {
    const rows = suggestions({ ...base, input: 'insta', remote: ['instagram login', 'insta'] });
    expect(rows[0]).toMatchObject({ kind: 'search', title: 'insta' });
    expect(rows.some((r) => r.kind === 'history' && r.url.includes('/reel/'))).toBe(true);
    expect(rows.some((r) => r.kind === 'site' && r.title === 'Instagram')).toBe(true);
    expect(rows.filter((r) => r.kind === 'suggest').map((r) => r.title)).toEqual(['instagram login']);
  });

  it('offers to open a typed address and the copied link', () => {
    const rows = suggestions({ ...base, input: 'example.com', clip: 'https://example.com/video/1' });
    expect(rows[0]).toMatchObject({ kind: 'go', url: 'https://example.com/' });
    expect(rows.some((r) => r.kind === 'clip')).toBe(true);
    expect(suggestions({ ...base, input: '', clip: 'https://x.com/a/status/1' })).toEqual([{ kind: 'clip', title: 'https://x.com/a/status/1', url: 'https://x.com/a/status/1' }]);
  });

  it('switches to an open tab instead of opening it twice', () => {
    const rows = suggestions({ ...base, input: 'news', tabs: [{ ...blankTab('t1', 'https://news.com/'), title: 'News' }] });
    expect(rows.find((r) => r.url === 'https://news.com/')?.kind).toBe('tab');
  });

  it('reads OpenSearch suggestion answers', () => {
    expect(parseSuggest(['q', ['a', 'b', 3]])).toEqual(['a', 'b']);
    expect(parseSuggest({ nope: 1 })).toEqual([]);
  });
});
