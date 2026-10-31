import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ENGINES,
  addVisit,
  blankTab,
  displayHost,
  fill,
  isBookmarked,
  newTabId,
  nextActive,
  pageKey,
  retitle,
  historyBus,
  saveableTabs,
  siteOf,
  store,
  toggleBookmark,
  topSites,
  type Shortcut,
  type TabInfo,
} from '../../core/browser.ts';
import { BUNDLED_RULES, loadBrowserRules } from '../../core/browserRules.ts';
import { counts, downloadedKeys, foundKey, mediaRequest, mergeFound, thisPage, type Found, type PageContext } from '../../core/finder.ts';
import { detect } from '../../core/links.ts';
import { isMusic, quickRequest, type Settings } from '../../core/settings.ts';
import { SITES } from '../../core/sites.ts';
import type { Job, JobRequest } from '../../core/types.ts';
import { engine } from '../../engine/index.ts';
import { browser, type ContextTarget, type PageDownload, type PlayRequest, type RawFound } from '../../engine/browser.ts';
import { useT } from '../../i18n.ts';
import { useBack } from '../back.ts';
import { Icon, type IconName } from '../Icon.tsx';
import { openExternal } from '../report.ts';
import { BrowserBar, type BarToast } from './BrowserBar.tsx';
import { BrowserMenu, ContextSheet, ExternalSheet, PageDownloadSheet, ShortcutSheet } from './BrowserSheets.tsx';
import { FinderSheet } from './FinderSheet.tsx';
import { AllSitesPage, BookmarksPage, HistoryPage } from './HistoryPage.tsx';
import { Omnibox } from './Omnibox.tsx';
import { StartPage } from './StartPage.tsx';
import { TabSwitcher } from './TabSwitcher.tsx';

export interface BrowseRequest {
  url: string;
  /** Open the content finder once the page has loaded ("Find it on the page"). */
  finder?: boolean;
  at: number;
}

interface Props {
  /** The Browse tab is on screen. */
  shown: boolean;
  /** An app sheet is open over the browser. */
  covered: boolean;
  /** A full-screen app screen (video, music player…) is over the browser. */
  hidden: boolean;
  settings: Settings;
  jobs: Job[];
  sessions: string[];
  clip?: string;
  toast?: BarToast;
  miniShown: boolean;
  /** Remote config switched the ad blocker off (it misbehaved somewhere). */
  adblockOff?: boolean;
  /** YouTube and YT Music videos and songs tapped in a page play in OnePlace's player. */
  takeover?: boolean;
  onPlay?: (r: PlayRequest) => void;
  request?: BrowseRequest;
  onRequestDone: () => void;
  /** A page fills the screen (the app's bottom bar hides). */
  onPageMode: (on: boolean) => void;
  /** The full download sheet for a link. */
  onLink: (url: string) => void;
  onAdd: (reqs: JobRequest[]) => void;
  onDownloads: () => void;
  onSettings: () => void;
  onSessions: () => void;
  onToastDone: () => void;
  onCopy: (text: string) => void;
  say: (text: string, action?: { label: string; run: () => void }) => void;
}

type Tab = TabInfo & { userAgent?: string };
type Layer = 'omnibox' | 'menu' | 'finder' | 'tabs' | 'history' | 'bookmarks' | 'sites';

interface Finds {
  items: Found[];
  view?: Found;
}

function toFound(raw: RawFound, now = Date.now()): Found {
  const f: Found = { ...raw, key: foundKey(raw.url, raw.source), at: now };
  if (raw.source === 'link') {
    const d = detect(raw.url);
    if (d.site !== 'other') {
      f.site = d.site;
      f.linkKind = d.kind;
      f.kind = isMusic(d) ? 'audio' : 'video';
    }
  }
  return f;
}

/** "#fff" and "#0e0d17" → is it a light colour? (undefined: not a colour we can read). */
function isLight(color?: string): boolean | undefined {
  const m = color?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 150;
}

const ERROR_ICON: Record<string, IconName> = { offline: 'wifiOff', dns: 'search', ssl: 'lock', crash: 'alert' };

function useAppDark(theme: Settings['theme']): boolean {
  const [system, setSystem] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && system);
}

/**
 * The in-app browser: start page, tabs, the page with its bar, and everything over it (address panel,
 * tab switcher, menu, content finder, long-press and download sheets). The pages themselves are native
 * WebViews placed in the area this screen leaves free (browser/BrowserLayer.kt).
 */
export function Browse(p: Props) {
  const t = useT();
  const s = p.settings;
  const [tabs, setTabs] = useState<Tab[]>(() => store.tabs().list.map((x) => ({ ...blankTab(x.id, x.url), title: x.title, icon: x.icon, thumb: x.thumb, loading: false })));
  const [activeId, setActiveId] = useState<string | undefined>(() => store.tabs().active);
  const [pageMode, setPageMode] = useState(false);
  const [privateOk, setPrivateOk] = useState(false);
  const [finds, setFinds] = useState<Record<string, Finds>>({});
  const [history, setHistory] = useState(store.history);
  const [bookmarks, setBookmarks] = useState(store.bookmarks);
  const [prefs, setPrefs] = useState(store.shortcuts);
  const [layer, setLayer] = useState<Layer>();
  const [omni, setOmni] = useState<{ url: string; newTab: boolean; private: boolean }>({ url: '', newTab: true, private: false });
  const [switcherPrivate, setSwitcherPrivate] = useState(false);
  const [ctx, setCtx] = useState<ContextTarget>();
  const [dl, setDl] = useState<PageDownload>();
  const [ext, setExt] = useState<string>();
  const [shortcut, setShortcut] = useState<Shortcut>();
  const [collapsed, setCollapsed] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [find, setFind] = useState<{ query: string; index: number; count: number }>();
  const [label, setLabel] = useState<string>();
  const [siteAd, setSiteAd] = useState<{ adblock: boolean; level: string }>();
  const [rules, setRules] = useState(BUNDLED_RULES);
  const appDark = useAppDark(s.theme);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const visitedUrl = useRef<Record<string, string>>({});
  const parents = useRef<Record<string, string>>({});
  const finderWhenLoaded = useRef<string | undefined>(undefined);
  const labeled = useRef(new Set<string>());
  const loginChecked = useRef<Record<string, number>>({});
  const statusRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);

  const active = tabs.find((x) => x.id === activeId);
  const page = pageMode && !!active;
  const fd = active ? finds[active.id] : undefined;
  const pageFound = useMemo(() => (active ? thisPage(active) : undefined), [active?.url, active?.pageTitle, active?.title, active?.image]);
  const items = fd?.items ?? [];
  const count = items.filter((f) => counts(f) && f.key !== pageFound?.key).length + (pageFound ? 1 : 0);
  const downloaded = useMemo(() => downloadedKeys(p.jobs), [p.jobs]);
  const overlay = !!layer || !!ctx || !!dl || !!ext || p.covered;

  // ---------- the app around the browser ----------

  useEffect(() => p.onPageMode(p.shown && page), [p.shown, page]);
  useEffect(() => {
    const root = document.documentElement.classList;
    root.toggle('browser-open', p.shown && page);
    root.toggle('bar-top', p.shown && page && s.barTop);
    return () => {
      root.remove('browser-open');
      root.remove('bar-top');
    };
  }, [p.shown, page, s.barTop]);

  useEffect(() => {
    loadBrowserRules()
      .then(setRules)
      .catch(() => {});
    browser
      .state()
      .then((st) => setPrivateOk(st.privateOk))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void browser
      .configure({ adblock: p.adblockOff ? 'off' : s.adblock, thirdPartyCookies: s.thirdPartyCookies, darkPages: s.darkPages, appDark, hideBars: s.hideBars, takeover: !!p.takeover, rules })
      .catch(() => {});
  }, [s.adblock, p.adblockOff, s.thirdPartyCookies, s.darkPages, appDark, s.hideBars, p.takeover, rules]);

  const onPlay = useRef(p.onPlay);
  onPlay.current = p.onPlay;

  // Remember tabs (not private ones), history, bookmarks and the start page's sites.
  useEffect(() => {
    const id = window.setTimeout(() => store.setTabs(saveableTabs(tabs, activeId)), 700);
    return () => window.clearTimeout(id);
  }, [tabs, activeId]);
  useEffect(() => {
    const id = window.setTimeout(() => store.setHistory(history), 1000);
    return () => window.clearTimeout(id);
  }, [history]);
  useEffect(() => historyBus.onClear(() => setHistory([])), []);
  useEffect(() => store.setBookmarks(bookmarks), [bookmarks]);
  useEffect(() => store.setShortcuts(prefs), [prefs]);

  // ---------- what the pages report ----------

  useEffect(() => {
    const offs = [
      browser.on('tab', (d) => {
        setTabs((ts) => (ts.some((x) => x.id === d.id) ? ts.map((x) => (x.id === d.id ? { ...x, ...d, error: d.error } : x)) : ts));
        if (!d.private && d.url && /^https?:/i.test(d.url) && !d.error) {
          if (visitedUrl.current[d.id] !== d.url) {
            visitedUrl.current[d.id] = d.url;
            setHistory((h) => addVisit(h, { url: d.url, title: d.title }));
          } else if (d.title) setHistory((h) => retitle(h, d.url, d.title));
        }
        if (finderWhenLoaded.current === d.id && !d.loading) {
          finderWhenLoaded.current = undefined;
          window.setTimeout(() => setLayer((l) => l ?? 'finder'), 1200);
        }
      }),
      browser.on('finder', (d) => {
        setFinds((all) => {
          const cur = d.reset ? { items: [] } : (all[d.id] ?? { items: [] });
          const now = Date.now();
          const next: Finds = { ...cur };
          if (d.items?.length) next.items = mergeFound(cur.items, d.items.map((r) => toFound(r, now)));
          if (d.view !== undefined) next.view = d.view ? toFound(d.view, now) : undefined;
          return { ...all, [d.id]: next };
        });
      }),
      browser.on('context', (d) => d.id === activeRef.current && setCtx(d)),
      browser.on('download', (d) => setDl(d)),
      browser.on('external', (d) => d.id === activeRef.current && setExt(d.url)),
      browser.on('popup', () => p.say(t('br.popup'))),
      browser.on('newTab', (d) => {
        parents.current[d.id] = d.parent;
        setTabs((ts) => {
          const i = ts.findIndex((x) => x.id === d.parent);
          const next = ts.slice();
          next.splice(i < 0 ? ts.length : i + 1, 0, blankTab(d.id, '', d.private));
          return next;
        });
        setActiveId(d.id);
        setPageMode(true);
        void browser.select({ id: d.id, private: d.private });
      }),
      browser.on('closed', (d) => closeTab(d.id)),
      browser.on('bars', (d) => setCollapsed(d.collapsed)),
      browser.on('fullscreen', (d) => setFullscreen(d.on)),
      browser.on('keyboard', (d) => setKeyboard(d.open)),
      browser.on('find', (d) => setFind((f) => (f ? { ...f, index: d.index, count: d.count } : f))),
      // A YouTube video or song tapped in a page: OnePlace's player takes it (no ads).
      browser.on('play', (d) => onPlay.current?.(d)),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- where the page goes on screen ----------

  const lastLayout = useRef('');
  useLayoutEffect(() => {
    const visible = p.shown && page && !p.hidden && !active?.error;
    const send = () => {
      let top = 0;
      let bottom = 0;
      if (visible) {
        const status = statusRef.current?.getBoundingClientRect().bottom ?? 0;
        const chrome = chromeRef.current?.getBoundingClientRect();
        const mini = p.miniShown ? document.querySelector('.mini')?.getBoundingClientRect().top : undefined;
        const h = window.innerHeight;
        if (s.barTop) {
          top = chrome && chrome.height ? chrome.bottom : status;
          bottom = mini ? h - mini : 0;
        } else {
          top = status;
          const above = Math.min(chrome && chrome.height ? chrome.top : h, mini ?? h);
          bottom = h - above;
        }
      }
      const key = `${Math.round(top)}|${Math.round(bottom)}|${visible}|${overlay}`;
      if (key === lastLayout.current) return;
      lastLayout.current = key;
      void browser.layout({ top: Math.round(top), bottom: Math.round(bottom), visible, overlay }).catch(() => {});
    };
    send();
    const raf = requestAnimationFrame(send);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(send) : undefined;
    if (chromeRef.current) ro?.observe(chromeRef.current);
    if (statusRef.current) ro?.observe(statusRef.current);
    window.addEventListener('resize', send);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [p.shown, page, p.hidden, active?.error, overlay, s.barTop, p.miniShown, collapsed, keyboard, fullscreen, find !== undefined, !!p.toast]);

  // Bar height for the mini player above it.
  useLayoutEffect(() => {
    const h = chromeRef.current?.getBoundingClientRect().height;
    if (h) document.documentElement.style.setProperty('--bb-h', `${Math.round(h)}px`);
  });

  // ---------- tabs ----------

  const openTab = useCallback((url: string, o: { private?: boolean; background?: boolean } = {}) => {
    const id = newTabId();
    setTabs((ts) => [...ts, blankTab(id, url, !!o.private)]);
    void browser.open({ id, url, private: o.private, background: o.background });
    if (!o.background) {
      setActiveId(id);
      setPageMode(true);
      setCollapsed(false);
    }
    return id;
  }, []);

  const selectTab = useCallback((id: string) => {
    const tb = tabsRef.current.find((x) => x.id === id);
    if (!tb) return;
    setActiveId(id);
    setPageMode(true);
    setCollapsed(false);
    setFind(undefined);
    void browser.select({ id, url: tb.url, private: tb.private });
  }, []);

  const closeTab = useCallback((id: string) => {
    const ts = tabsRef.current;
    const next = nextActive(ts, id, activeRef.current);
    const nextTab = ts.find((x) => x.id === next);
    setTabs(ts.filter((x) => x.id !== id));
    setFinds((all) => {
      const { [id]: _gone, ...rest } = all;
      return rest;
    });
    delete visitedUrl.current[id];
    void browser.close(id);
    if (activeRef.current === id) {
      setActiveId(next);
      if (nextTab) void browser.select({ id: nextTab.id, url: nextTab.url, private: nextTab.private });
      else setPageMode(false);
    }
  }, []);

  /** The address panel's choice: the current tab, or a new one from the start page / "New tab". */
  const go = (url: string) => {
    setLayer(undefined);
    if (omni.newTab || !active) {
      openTab(url, { private: omni.private });
      return;
    }
    setTabs((ts) => ts.map((x) => (x.id === active.id ? { ...x, url, loading: true, error: undefined } : x)));
    void browser.navigate(active.id, url);
    setPageMode(true);
  };

  const showOmnibox = (o: { newTab: boolean; private?: boolean }) => {
    setOmni({ url: o.newTab ? '' : (active?.url ?? ''), newTab: o.newTab, private: !!o.private });
    setLayer('omnibox');
  };

  const showTabs = async () => {
    if (page) await browser.capture().catch(() => {});
    setSwitcherPrivate(!!active?.private);
    setLayer('tabs');
  };

  const swipeTab = (dir: -1 | 1) => {
    if (!active) return;
    const same = tabs.filter((x) => x.private === active.private);
    const i = same.findIndex((x) => x.id === active.id);
    const to = same[i + dir];
    if (to) selectTab(to.id);
  };

  // Requests from elsewhere in the app (site buttons, "Original post", "Find it on the page").
  useEffect(() => {
    if (!p.request) return;
    const id = openTab(p.request.url);
    if (p.request.finder) finderWhenLoaded.current = id;
    p.onRequestDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.request?.at]);

  // Android back inside a page: full screen, find bar, the page's own history, then the start page.
  useBack(p.shown && page, () => {
    if (fullscreen) {
      void browser.exitFullscreen();
      return;
    }
    if (find) {
      setFind(undefined);
      if (active) void browser.find({ id: active.id, clear: true });
      return;
    }
    const id = active!.id;
    void browser.back(id).then((handled) => {
      if (handled) return;
      const parent = parents.current[id];
      if (parent && tabsRef.current.some((x) => x.id === parent)) {
        closeTab(id);
        selectTab(parent);
      } else setPageMode(false);
    });
  });

  // ---------- small things around the page ----------

  // "Download reel" in the bar for a moment, once per page, when something downloadable shows up.
  useEffect(() => {
    if (!active || !count) return;
    const key = pageKey(active.url);
    if (labeled.current.has(key)) return;
    labeled.current.add(key);
    const kind = pageFound?.linkKind;
    setLabel(
      kind === 'reel'
        ? t('br.found.reel')
        : kind === 'song'
          ? t('br.found.song')
          : kind === 'post'
            ? t('br.found.photo')
            : kind
              ? t('br.found.video')
              : t('br.found.any', { n: count }),
    );
    const id = window.setTimeout(() => setLabel(undefined), 2400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.url, count > 0]);

  // A login made in the browser is kept for downloads.
  useEffect(() => {
    if (!active || active.private || active.loading) return;
    const site = siteOf(active.url);
    const info = site ? SITES[site] : undefined;
    if (!site || !info?.login) return;
    const now = Date.now();
    if (now - (loginChecked.current[site] ?? 0) < 60_000) return;
    loginChecked.current[site] = now;
    const had = p.sessions.includes(site);
    engine
      .checkLogin({ site, cookieUrls: info.cookieUrls ?? [info.login] })
      .then((ok) => {
        if (ok === had) return;
        p.onSessions();
        if (ok) p.say(t('br.loggedIn', { site: info.name }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.url, active?.loading]);

  // ---------- downloads ----------

  const pageCtx = (tb: Tab): PageContext => ({ pageUrl: tb.url, pageTitle: tb.pageTitle || tb.title, userAgent: tb.userAgent, private: tb.private });
  const addMedia = (f: Found, o?: { height?: number; audio?: boolean }) => {
    if (!active) return;
    setLayer(undefined);
    p.onAdd([mediaRequest(f, pageCtx(active), s, o)]);
  };
  const addQuick = (url: string, audio?: boolean) => {
    const link = detect(url);
    setLayer(undefined);
    p.onAdd([quickRequest(link, s, audio ? 'audio' : isMusic(link) ? 'audio' : 'video')]);
  };
  const addMany = (list: Found[]) => {
    if (!active) return;
    setLayer(undefined);
    const ctxt = pageCtx(active);
    p.onAdd(list.map((f) => (f.linkKind ? quickRequest(detect(f.url), s) : mediaRequest(f, ctxt, s))));
  };
  const openLink = (url: string) => {
    setLayer(undefined);
    p.onLink(url);
  };

  // ---------- drawing ----------

  const shortcuts = useMemo(() => topSites(prefs, history), [prefs, history]);
  const statusLight = isLight(active?.theme);
  const statusColor = active?.theme && statusLight !== undefined && statusLight === !appDark ? active.theme : undefined;

  const layers = (
    <>
      {layer === 'omnibox' ? (
        <Omnibox
          url={omni.url}
          engine={s.searchEngine}
          remote={s.searchSuggest}
          privateTab={omni.private || (!omni.newTab && !!active?.private)}
          history={history}
          bookmarks={bookmarks}
          tabs={tabs}
          activeId={activeId}
          clip={p.clip}
          onGo={go}
          onTab={(id) => {
            setLayer(undefined);
            selectTab(id);
          }}
          onClose={() => setLayer(undefined)}
        />
      ) : null}
      {layer === 'tabs' ? (
        <TabSwitcher
          tabs={tabs}
          activeId={page ? activeId : undefined}
          privateOk={privateOk}
          startPrivate={switcherPrivate}
          onSelect={(id) => {
            setLayer(undefined);
            selectTab(id);
          }}
          onClose={closeTab}
          onCloseAll={(priv) => tabs.filter((x) => x.private === priv).forEach((x) => closeTab(x.id))}
          onNew={(priv) => showOmnibox({ newTab: true, private: priv })}
          onHome={() => {
            setLayer(undefined);
            setPageMode(false);
          }}
          onDismiss={() => setLayer(undefined)}
        />
      ) : null}
      {layer === 'history' ? (
        <HistoryPage
          history={history}
          onOpen={(url) => {
            setLayer(undefined);
            if (page && active) go(url);
            else openTab(url);
          }}
          onRemove={(url) => setHistory((h) => h.filter((v) => pageKey(v.url) !== pageKey(url)))}
          onClear={() => setHistory([])}
          onClose={() => setLayer(undefined)}
        />
      ) : null}
      {layer === 'bookmarks' ? (
        <BookmarksPage
          bookmarks={bookmarks}
          onOpen={(url) => {
            setLayer(undefined);
            openTab(url);
          }}
          onRemove={(url) => setBookmarks((b) => toggleBookmark(b, { url }))}
          onClose={() => setLayer(undefined)}
        />
      ) : null}
      {layer === 'sites' ? (
        <AllSitesPage
          onOpen={(url) => {
            setLayer(undefined);
            openTab(url);
          }}
          onClose={() => setLayer(undefined)}
        />
      ) : null}
      {shortcut ? (
        <ShortcutSheet
          s={shortcut}
          onOpen={() => openTab(shortcut.url)}
          onPin={() => setPrefs((pr) => ({ ...pr, pinned: [shortcut, ...pr.pinned.filter((x) => x.url !== shortcut.url)].slice(0, 12) }))}
          onRemove={() => setPrefs((pr) => ({ pinned: pr.pinned.filter((x) => x.url !== shortcut.url), hidden: [...new Set([...pr.hidden, displayHost(shortcut.url)])] }))}
          onClose={() => setShortcut(undefined)}
        />
      ) : null}
    </>
  );

  if (!p.shown) return null;

  if (!page) {
    return (
      <>
        <StartPage
          tabs={tabs}
          shortcuts={shortcuts}
          history={history}
          bookmarks={bookmarks}
          clip={p.clip}
          onSearch={() => showOmnibox({ newTab: true })}
          onOpen={(url) => openTab(url)}
          onTab={selectTab}
          onCloseTab={closeTab}
          onTabs={() => void showTabs()}
          onShortcutMenu={setShortcut}
          onAllSites={() => setLayer('sites')}
          onHistory={() => setLayer('history')}
          onBookmarks={() => setLayer('bookmarks')}
          onDownloadClip={(url) => p.onLink(url)}
        />
        {layers}
      </>
    );
  }

  const tab = active!;
  const err = tab.error;
  return (
    <>
      <div ref={statusRef} className="bw-status" style={statusColor ? { background: statusColor } : undefined} />
      {err ? (
        <div className={`bw-error${s.barTop ? ' top' : ''}`}>
          <div className="empty">
            <div className="art">
              <Icon name={ERROR_ICON[err.code] ?? 'alert'} size={40} />
            </div>
            <b>{err.code === 'offline' ? t('be.offline') : err.code === 'dns' ? t('be.dns') : err.code === 'ssl' ? t('be.ssl') : err.code === 'crash' ? t('be.crash') : t('be.other')}</b>
            <span>{err.code === 'offline' ? t('be.offlineSub') : err.code === 'dns' ? t('be.dnsSub') : err.code === 'ssl' ? t('be.sslSub') : err.code === 'crash' ? t('be.crashSub') : displayHost(tab.url)}</span>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => void browser.reload(tab.id)}>
                <Icon name="refresh" size={18} /> {t('fix.retry')}
              </button>
              {err.code === 'dns' ? (
                <button type="button" className="btn tonal" onClick={() => go(fill(ENGINES[s.searchEngine].search, displayHost(tab.url)))}>
                  <Icon name="search" size={18} /> {t('be.searchInstead')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {!keyboard && !fullscreen ? (
        <div ref={chromeRef} className={`bw-chrome${s.barTop ? ' top' : ''}`}>
          <BrowserBar
            tab={tab}
            count={count}
            label={label}
            collapsed={collapsed && s.hideBars}
            tabsCount={tabs.filter((x) => x.private === tab.private).length}
            top={s.barTop}
            toast={p.toast}
            onToastDone={p.onToastDone}
            find={find}
            onFind={(q) => {
              setFind({ query: q, index: 0, count: 0 });
              void browser.find({ id: tab.id, query: q });
            }}
            onFindNext={(fw) => void browser.find({ id: tab.id, next: fw })}
            onFindClose={() => {
              setFind(undefined);
              void browser.find({ id: tab.id, clear: true });
            }}
            onAddress={() => showOmnibox({ newTab: false })}
            onAddressHold={() => p.onCopy(tab.url)}
            onFinder={() => setLayer('finder')}
            onTabs={() => void showTabs()}
            onMenu={() => {
              setSiteAd(undefined);
              browser
                .site(displayHost(tab.url))
                .then(setSiteAd)
                .catch(() => {});
              setLayer('menu');
            }}
            onSwipe={swipeTab}
            onExpand={() => setCollapsed(false)}
          />
        </div>
      ) : null}

      {layers}

      {layer === 'menu' ? (
        <BrowserMenu
          tab={tab}
          bookmarked={isBookmarked(bookmarks, tab.url)}
          adblock={siteAd}
          privateOk={privateOk}
          onBack={() => void browser.back(tab.id)}
          onForward={() => void browser.forward(tab.id)}
          onReload={() => void (tab.loading ? browser.stop(tab.id) : browser.reload(tab.id))}
          onBookmark={() => {
            const had = isBookmarked(bookmarks, tab.url);
            setBookmarks((b) => toggleBookmark(b, { url: tab.url, title: tab.title }));
            p.say(had ? t('br.unbookmarked') : t('br.bookmarked'));
          }}
          onShare={() => void browser.shareText(tab.url).catch(() => p.onCopy(tab.url))}
          onNewTab={() => showOmnibox({ newTab: true })}
          onNewPrivate={() => showOmnibox({ newTab: true, private: true })}
          onFind={() => setFind({ query: '', index: 0, count: 0 })}
          onDesktop={() => void browser.desktop(tab.id, !tab.desktop)}
          onAdblock={(on) =>
            void browser
              .site(displayHost(tab.url), on)
              .then((r) => {
                setSiteAd(r);
                void browser.reload(tab.id);
              })
              .catch(() => {})
          }
          onBookmarks={() => setLayer('bookmarks')}
          onHistory={() => setLayer('history')}
          onDownloads={p.onDownloads}
          onOpenOther={() => openExternal(tab.url)}
          onCopy={() => p.onCopy(tab.url)}
          onHome={() => setPageMode(false)}
          onSettings={p.onSettings}
          onClose={() => setLayer((l) => (l === 'menu' ? undefined : l))}
        />
      ) : null}

      {layer === 'finder' ? (
        <FinderSheet
          tab={tab}
          page={pageFound}
          view={fd?.view}
          items={items}
          downloaded={downloaded}
          onPage={(audio) => pageFound && addQuick(pageFound.url, audio)}
          onPlay={
            pageFound && onPlay.current
              ? () => {
                  setLayer(undefined);
                  onPlay.current?.({ id: tab.id, url: pageFound.url, music: pageFound.kind === 'audio', title: pageFound.title, thumb: pageFound.thumb ?? tab.image });
                }
              : undefined
          }
          onLink={openLink}
          onQuick={(f) => addQuick(f.url)}
          onMedia={addMedia}
          onMany={addMany}
          onClose={() => setLayer(undefined)}
        />
      ) : null}

      {ctx ? (
        <ContextSheet
          target={ctx}
          onOpenTab={(url, bg) => {
            openTab(url, { private: tab.private, background: bg });
            if (bg) p.say(t('br.inBackground'));
          }}
          onCopy={p.onCopy}
          onShare={(url) => void browser.shareText(url).catch(() => p.onCopy(url))}
          onDownloadLink={openLink}
          onSavePhoto={(url) => addMedia({ key: foundKey(url, 'image'), url, kind: 'image', source: 'image', at: Date.now() })}
          onSaveVideo={(url) => addMedia({ key: foundKey(url, 'media'), url, kind: 'video', source: 'media', at: Date.now() })}
          onClose={() => setCtx(undefined)}
        />
      ) : null}

      {dl ? (
        <PageDownloadSheet
          d={dl}
          onDownload={() => {
            const kind = dl.mime.startsWith('video/') ? 'video' : dl.mime.startsWith('audio/') ? 'audio' : dl.mime.startsWith('image/') ? 'image' : 'file';
            const ctxt: PageContext = { pageUrl: dl.page || tab.url, pageTitle: dl.name.replace(/\.[a-z0-9]{2,5}$/i, ''), userAgent: dl.ua || tab.userAgent, private: tab.private };
            p.onAdd([mediaRequest({ key: foundKey(dl.url, 'media'), url: dl.url, kind, source: 'media', size: dl.size > 0 ? dl.size : undefined, at: Date.now() }, ctxt, s)]);
          }}
          onClose={() => setDl(undefined)}
        />
      ) : null}

      {ext ? (
        <ExternalSheet
          url={ext}
          onOpen={() =>
            void browser
              .openApp(ext)
              .then((ok) => !ok && p.say(t('ex.none')))
              .catch(() => p.say(t('ex.none')))
          }
          onClose={() => setExt(undefined)}
        />
      ) : null}
    </>
  );
}
