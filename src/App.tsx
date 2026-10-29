import { App as CapApp } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explain } from './core/errors.ts';
import { detect, findUrls } from './core/links.ts';
import { loadPositions, mediaItems, resumeAt, savePosition, type MediaItem, type Positions } from './core/media.ts';
import { EMPTY_CONFIG, loadRemoteConfig, type RemoteConfig } from './core/remoteConfig.ts';
import { buildRequest, canAutoStart, editRequest, loadSettings, quickRequest, quickTemplates, saveSettings, videoSpec, type Settings } from './core/settings.ts';
import { SITES } from './core/sites.ts';
import type { EditSpec, Job, SiteId } from './core/types.ts';
import { checkForUpdate, type Update } from './core/update.ts';
import { engine, type EngineStatus } from './engine/index.ts';
import { livePosition, player, playerNow, usePlayerCoarse, watchPlayer } from './engine/player.ts';
import type { KaraokeStatus } from './engine/types.ts';
import { LangContext, defaultLang, translate, type Key, type Vars } from './i18n.ts';
import { nativeStrings } from './strings.ts';
import { handleBack } from './ui/back.ts';
import { DownloadSheet } from './ui/DownloadSheet.tsx';
import { Downloads } from './ui/Downloads.tsx';
import { Home } from './ui/Home.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { JobMenu } from './ui/JobMenu.tsx';
import { Library } from './ui/Library.tsx';
import { Onboarding } from './ui/Onboarding.tsx';
import { AboutPage, SitesPage, TestPage } from './ui/Pages.tsx';
import { Settings as SettingsScreen, type Page } from './ui/Settings.tsx';
import { UpdateSheet } from './ui/UpdateSheet.tsx';
import { openExternal } from './ui/report.ts';
import { ImageViewer } from './ui/viewer/ImageViewer.tsx';
import { InfoSheet, ItemMenu, KaraokeSheet } from './ui/viewer/ItemSheets.tsx';
import { MiniPlayer, NowPlaying } from './ui/viewer/NowPlaying.tsx';
import { counterpart, toPlayItem } from './ui/viewer/play.ts';
import { VideoPlayer } from './ui/viewer/VideoPlayer.tsx';

type Tab = 'home' | 'downloads' | 'library' | 'more';
const native = Capacitor.isNativePlatform();
/** Pixels rarely kill background work; every other maker (Xiaomi, Oppo, Vivo, Realme, Samsung, Lava…) may. */
const PIXEL = /^google$/i;

/** Copied this recently = copied to download it now. */
const FRESH_CLIP_MS = 5 * 60_000;

function upsert(list: Job[], j: Job): Job[] {
  const i = list.findIndex((x) => x.id === j.id);
  if (i < 0) return [j, ...list];
  const next = list.slice();
  next[i] = j;
  return next;
}

/** The music queue's items, kept so the mini player knows them after the app was closed. */
const QUEUE_KEY = 'op.queue';

function readLocal(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not fatal
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(defaultLang()));
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const t = (key: Key, vars?: Vars) => translate(settings.lang, key, vars);

  const [tab, setTab] = useState<Tab>('home');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [page, setPage] = useState<Page>();
  const [sheetInput, setSheetInput] = useState<string>();
  const [menuJob, setMenuJob] = useState<Job>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<EngineStatus>();
  const [remote, setRemote] = useState<RemoteConfig>(EMPTY_CONFIG);
  const [appUpdate, setAppUpdate] = useState<Update>();
  const [showUpdate, setShowUpdate] = useState(false);
  const [clip, setClip] = useState<string>();
  const lastClip = useRef(readLocal('op.clip'));
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } }>();
  const [sessions, setSessions] = useState<string[]>([]);
  const [battery, setBattery] = useState<boolean>();
  const [notif, setNotif] = useState<boolean>();
  const [dismissedAnn, setDismissedAnn] = useState(readLocal('op.ann'));
  // Built-in player and viewers.
  const [viewer, setViewer] = useState<{ kind: 'image' | 'video'; items: MediaItem[]; index: number; resume?: boolean }>();
  const ps = usePlayerCoarse();
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [npOpen, setNpOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState<MediaItem>();
  const [info, setInfo] = useState<MediaItem>();
  const [karaoke, setKaraoke] = useState<MediaItem>();
  const [karaokeStatus, setKaraokeStatus] = useState<KaraokeStatus>();
  const [positions, setPositions] = useState<Positions>(() => loadPositions());
  const [openId, setOpenId] = useState<string>();

  const say = useCallback((text: string, action?: { label: string; run: () => void }) => setToast({ text, action }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(undefined), toast.action ? 5000 : 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const openLink = useCallback((text: string) => {
    setSheetInput(text);
    setMenuJob(undefined);
  }, []);

  // Theme: light/dark/system + AMOLED, mirrored to the status/navigation bar icons.
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches);
      const root = document.documentElement;
      root.dataset.theme = dark ? 'dark' : 'light';
      if (settings.amoled) root.dataset.amoled = '';
      else delete root.dataset.amoled;
      root.lang = settings.lang === 'hi' ? 'hi' : 'en';
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? (settings.amoled ? '#000000' : '#0e0d17') : '#f5f5fa');
      if (native) void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, settings.amoled, settings.lang]);

  // Wallpaper colours (Android 12+).
  useEffect(() => {
    const root = document.documentElement;
    if (!settings.dynamicColor) {
      root.style.removeProperty('--dyn-light');
      root.style.removeProperty('--dyn-dark');
      return;
    }
    engine
      .systemColors()
      .then((c) => {
        if (c.light) root.style.setProperty('--dyn-light', c.light);
        if (c.dark) root.style.setProperty('--dyn-dark', c.dark);
      })
      .catch(() => {});
  }, [settings.dynamicColor]);

  const refreshPhone = useCallback(() => {
    engine.batteryOptimized().then(setBattery).catch(() => {});
    engine.notificationsAllowed().then(setNotif).catch(() => {});
  }, []);

  // Engine start, job list, shares, and native events.
  useEffect(() => {
    const offs = [
      engine.onJob((j) => setJobs((list) => upsert(list, j))),
      engine.onShared((text) => openLink(text)),
      engine.onStatus((s) => setStatus(s)),
      engine.onOpenJob((id) => setOpenId(id)),
    ];
    (async () => {
      const s = await engine.status().catch(() => undefined);
      if (s) setStatus(s);
      setJobs(await engine.jobs().catch(() => []));
      const pending = await engine.pendingShare().catch(() => undefined);
      if (pending) openLink(pending);
      const open = await engine.pendingOpen().catch(() => undefined);
      if (open) setOpenId(open);
      setSessions(await engine.sessions().catch(() => []));
      if (s && !s.ready) {
        engine
          .prepare()
          .then(setStatus)
          .catch((e) => setStatus((st) => (st ? { ...st, preparing: false, error: String((e as Error)?.message ?? e) } : st)));
      }
    })();
    refreshPhone();
    loadRemoteConfig()
      .then(setRemote)
      .catch(() => {});
    return () => offs.forEach((off) => off());
  }, [openLink, refreshPhone]);

  // Settings the native side needs even when this UI is closed (1-tap shares, queue, notifications).
  useEffect(() => {
    void engine
      .configure({
        concurrency: settings.concurrency,
        wifiOnly: settings.wifiOnly,
        ytdlpChannel: settings.ytdlpChannel,
        autoEngineUpdate: settings.autoEngineUpdate,
        quickTargets: settings.quickTargets,
        quick: quickTemplates(settings),
        siteArgs: remote.siteArgs,
        minYtDlp: remote.minYtDlp,
        fastYouTube: !remote.disabled.includes('fastYouTube'),
        openIn: settings.openIn,
        strings: nativeStrings(settings.lang),
      })
      .catch(() => {});
  }, [settings, remote]);

  // App updates from GitHub Releases.
  useEffect(() => {
    if (!status?.build || !settings.autoAppUpdate) return;
    checkForUpdate({ build: status.build, channel: settings.appChannel, abis: status.abis })
      .then((u) => setAppUpdate(u && u.build !== settings.skippedBuild ? u : undefined))
      .catch(() => {});
  }, [status?.build, status?.abis, settings.appChannel, settings.autoAppUpdate, settings.skippedBuild]);

  // A link copied just before opening OnePlace starts downloading at once; older ones are offered on Home.
  // (Since Android 10 apps can read the clipboard only while they are in front, so this is the soonest.)
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const checkClipboard = useCallback(async () => {
    if (!native || (!settings.clipboardChip && !settings.autoCopied)) return;
    try {
      const { text, at } = await engine.clip();
      const url = findUrls(text ?? '')[0];
      if (!url || url === lastClip.current) return;
      if (settings.autoCopied && at > 0 && Date.now() - at < FRESH_CLIP_MS && (await startCopied(url))) return;
      if (settings.clipboardChip) setClip(url);
    } catch {
      // clipboard not readable right now
    }
  }, [settings.clipboardChip, settings.autoCopied]);

  /** Download a just-copied link with the usual settings. False when it needs the sheet (playlists, photos…). */
  const startCopied = async (url: string): Promise<boolean> => {
    const link = detect(url);
    if (!canAutoStart(link, sessionsRef.current.includes(link.site))) return false;
    lastClip.current = url;
    writeLocal('op.clip', url);
    const tr = (key: Key) => translate(settingsRef.current.lang, key);
    try {
      const job = await engine.enqueue(quickRequest(link, settingsRef.current));
      setJobs((list) => upsert(list, job));
      say(tr('auto.started'), { label: tr('tab.downloads'), run: () => setTab('downloads') });
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!settings.onboarded) return;
    void checkClipboard();
    if (!native) return;
    const h = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      setTimeout(() => void checkClipboard(), 350);
      refreshPhone();
    });
    return () => void h.then((x) => x.remove());
  }, [checkClipboard, refreshPhone, settings.onboarded]);

  // Android back: close the top layer, then go Home, then leave the app running in the background.
  useEffect(() => {
    if (!native) return;
    const h = CapApp.addListener('backButton', () => {
      if (handleBack()) return;
      if (tabRef.current !== 'home') setTab('home');
      else void CapApp.minimizeApp();
    });
    return () => void h.then((x) => x.remove());
  }, []);

  const forgetClip = () => {
    if (clip) {
      lastClip.current = clip;
      writeLocal('op.clip', clip);
    }
    setClip(undefined);
  };

  const pasteFromClipboard = async (): Promise<string | undefined> => {
    try {
      const value = native ? (await Clipboard.read()).value : await navigator.clipboard.readText();
      if (value?.trim()) return value;
    } catch {
      // fall through
    }
    say(t('home.clipboardEmpty'));
    return undefined;
  };

  const login = async (site: string) => {
    const s = SITES[site as SiteId];
    if (!s?.login) return;
    const r = await engine.login({ site, url: s.login, cookieUrls: s.cookieUrls ?? [s.login], title: s.name }).catch(() => ({ saved: false }));
    setSessions(await engine.sessions().catch(() => []));
    if (native) say(r.saved ? t('set.loggedInOk', { site: s.name }) : t('set.loginMissing', { site: s.name }));
  };

  const logout = async (site: SiteId) => {
    const s = SITES[site];
    await engine.logout({ site, cookieUrls: s.cookieUrls ?? [] }).catch(() => {});
    setSessions(await engine.sessions().catch(() => []));
    say(t('set.loggedOut', { site: s.name }));
  };

  const added = (job: Job | undefined, count = 1) => {
    setSheetInput(undefined);
    if (job) setJobs((list) => upsert(list, job));
    if (native) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    say(count > 1 ? `${t('sheet.added')} (${count})` : t('sheet.added'), { label: t('tab.downloads'), run: () => setTab('downloads') });
  };

  const fixJob = async (j: Job) => {
    const { fix } = explain(j.error, j.url);
    const link = detect(j.url);
    if (fix === 'login') {
      await login(j.site);
      await engine.retry(j.id);
    } else if (fix === 'update') {
      say(t('fix.updating'));
      await engine.updateEngines(true).then(setStatus).catch(() => {});
      await engine.retry(j.id);
    } else if (fix === 'photos') {
      await engine.enqueue(buildRequest({ link, engine: 'gallerydl', spec: { mode: 'photo' }, title: j.title, thumb: j.thumb })).then((nj) => setJobs((l) => upsert(l, nj)));
    } else if (fix === 'retryBest') {
      await engine.enqueue(buildRequest({ link, engine: 'ytdlp', spec: videoSpec(settings), title: j.title, thumb: j.thumb })).then((nj) => setJobs((l) => upsert(l, nj)));
    } else await engine.retry(j.id);
  };

  const removeJobs = async (ids: string[], deleteFiles: boolean) => {
    await engine.remove(ids, deleteFiles).catch(() => {});
    setJobs((list) => list.filter((j) => !ids.includes(j.id)));
  };

  // ---------- built-in player and viewers ----------

  const items = useMemo(() => mediaItems(jobs), [jobs]);
  const byKey = useMemo(() => new Map(items.map((it) => [it.key, it])), [items]);
  const current = ps.id ? byKey.get(ps.id) : undefined;
  const tr = (key: Key, vars?: Vars) => translate(settingsRef.current.lang, key, vars);

  // Remember where videos and long recordings were left (every 5 s while playing, and on pause).
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;
  useEffect(() => {
    let last = 0;
    let wasPlaying = false;
    return watchPlayer((s) => {
      const it = s.id ? byKeyRef.current.get(s.id) : undefined;
      const stopped = wasPlaying && !s.playing;
      wasPlaying = s.playing;
      if (!it || it.kind === 'image' || !s.duration || s.duration < (it.kind === 'video' ? 60 : 600)) return;
      const at = Date.now();
      if (!stopped && at - last < 5000) return;
      last = at;
      setPositions(savePosition(it.file.uri, s.ended ? s.duration : livePosition(s), s.duration));
    });
  }, []);

  // The music queue survives the app being closed while it plays.
  useEffect(() => {
    if (queue.length || ps.idle || !items.length) return;
    const keys = (readLocal(QUEUE_KEY) ?? '').split('\n');
    const list = keys.map((k) => byKey.get(k)).filter((x): x is MediaItem => !!x);
    if (list.length) setQueue(list);
  }, [queue.length, ps.idle, items.length, byKey]);

  const setPlayQueue = (list: MediaItem[]) => {
    setQueue(list);
    writeLocal(QUEUE_KEY, list.map((it) => it.key).join('\n'));
  };

  const playAudio = (list: MediaItem[], index: number, shuffle = false) => {
    const it = list[index];
    if (!it) return;
    const at = settingsRef.current.resume && (it.dur ?? 0) >= 600 ? resumeAt(loadPositions()[it.file.uri]?.[0], it.dur) : 0;
    setPlayQueue(list);
    void player
      .load({ items: list.map(toPlayItem), index, position: at, video: false })
      .then(() => player.control('shuffle', shuffle ? 1 : 0))
      .catch(() => say(tr('vp.cantPlay')));
    setNpOpen(true);
  };

  /** Open a Library item: photos in the viewer, videos in the player, songs in the music player (or another app). */
  const openItem = (it: MediaItem, list: MediaItem[]) => {
    if (settingsRef.current.openIn === 'other') {
      void engine.open(it.jobId, it.index, { uri: it.file.uri }).catch(() => say(tr('err.noApp')));
      return;
    }
    const same = list.filter((x) => x.kind === it.kind);
    const index = Math.max(0, same.findIndex((x) => x.key === it.key));
    if (it.kind === 'image') setViewer({ kind: 'image', items: same, index });
    else if (it.kind === 'video') {
      setNpOpen(false);
      setViewer({ kind: 'video', items: same, index });
    } else playAudio(same, index);
  };

  /** A finished download from Downloads, Home or its notification. */
  const openJob = (j: Job) => {
    const list = mediaItems([j]);
    if (list.length) openItem(list[0]!, list);
    else setMenuJob(j);
  };

  // "Downloaded" notification tapped: show that download once the list is loaded.
  useEffect(() => {
    if (!openId) return;
    const j = jobs.find((x) => x.id === openId);
    if (!j) return;
    setOpenId(undefined);
    openJob(j);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, jobs]);

  const closeVideo = (keepPlaying: boolean) => {
    const v = viewer;
    setViewer(undefined);
    if (keepPlaying && v) {
      setPlayQueue(v.items);
      say(tr('vp.background'));
    } else void player.control('stop');
  };

  /** Mini player tapped: a video playing as sound gets its picture back, music opens the player. */
  const openNowPlaying = () => {
    if (current?.kind === 'video') {
      const vids = queue.filter((x) => x.kind === 'video');
      const list = vids.length ? vids : [current];
      setViewer({ kind: 'video', items: list, index: Math.max(0, list.findIndex((x) => x.key === current.key)), resume: true });
    } else setNpOpen(true);
  };

  /** Karaoke copy ↔ original, at the same moment of the song. */
  const swap = (to: MediaItem) => {
    const from = current;
    if (!from) return openItem(to, [to]);
    const base = viewer?.kind === 'video' ? viewer.items : queue.length ? queue : [from];
    const list = base.map((x) => (x.key === from.key ? to : x));
    const index = Math.max(0, list.findIndex((x) => x.key === to.key));
    setPlayQueue(list);
    if (viewer?.kind === 'video') setViewer({ ...viewer, items: list, index, resume: true });
    void player.load({ items: list.map(toPlayItem), index, position: livePosition(playerNow()), video: viewer?.kind === 'video' });
  };

  const refs = (list: MediaItem[]) => list.map((it) => ({ id: it.jobId, uri: it.file.uri }));

  const deleteItems = async (list: MediaItem[]) => {
    if (list.some((it) => it.key === ps.id)) await player.control('stop').catch(() => {});
    await engine.removeFiles(refs(list)).catch(() => {});
    setJobs(await engine.jobs().catch(() => jobs));
    if (viewer) {
      const left = viewer.items.filter((x) => !list.some((d) => d.key === x.key));
      if (!left.length || viewer.kind === 'video') setViewer(undefined);
      else setViewer({ ...viewer, items: left, index: Math.min(viewer.index, left.length - 1) });
    }
    say(tr('lib.deleted'));
  };

  const openWith = (it: MediaItem) => void engine.open(it.jobId, it.index, { uri: it.file.uri, chooser: true }).catch(() => say(tr('err.noApp')));

  const askKaraoke = (it: MediaItem) => {
    setKaraoke(it);
    setKaraokeStatus(undefined);
    engine
      .karaoke()
      .then(setKaraokeStatus)
      .catch(() => {});
  };

  const startKaraoke = async (it: MediaItem, keep: EditSpec['keep'], as: EditSpec['as']) => {
    const job = jobs.find((j) => j.id === it.jobId);
    setKaraoke(undefined);
    if (!job) return;
    try {
      const nj = await engine.enqueue(editRequest({ job, index: it.index, title: it.title, isVideo: it.kind === 'video', keep, as, bitrate: settingsRef.current.mp3Bitrate }));
      setJobs((l) => upsert(l, nj));
      say(tr('kar.started'), {
        label: tr('tab.downloads'),
        run: () => {
          setViewer(undefined);
          setNpOpen(false);
          setPage(undefined);
          setTab('downloads');
        },
      });
    } catch (e) {
      say(String((e as Error)?.message ?? e));
    }
  };

  const copyLink = async (url: string) => {
    if (native) await Clipboard.write({ string: url }).catch(() => {});
    else await navigator.clipboard?.writeText(url).catch(() => {});
    say(tr('common.copied'));
  };

  const checkFiles = useCallback(() => {
    engine
      .checkFiles()
      .then((n) => (n ? engine.jobs().then(setJobs) : undefined))
      .catch(() => {});
  }, []);

  const karaokeStatusOf = useCallback(() => engine.karaoke(), []);
  const pipOk = native && (status?.sdk ?? 0) >= 26;
  const showMini = !ps.idle && !!ps.id && !npOpen && viewer?.kind !== 'video' && settings.onboarded;

  const activeCount = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

  // While downloads are active, re-read the list every 2 s so the screen never shows a stale state.
  useEffect(() => {
    if (!activeCount) return;
    const id = setInterval(() => {
      engine
        .jobs()
        .then(setJobs)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [activeCount]);
  const announcement = remote.announcement && remote.announcement.id !== dismissedAnn ? remote.announcement : undefined;

  const nav: { id: Tab; icon: IconName; label: string; badge?: number }[] = [
    { id: 'home', icon: 'home', label: t('tab.home') },
    { id: 'downloads', icon: 'list', label: t('tab.downloads'), badge: activeCount },
    { id: 'library', icon: 'grid', label: t('tab.library') },
    { id: 'more', icon: 'sliders', label: t('tab.more') },
  ];

  let screen;
  if (page === 'sites') screen = <SitesPage onBack={() => setPage(undefined)} />;
  else if (page === 'about') screen = <AboutPage onBack={() => setPage(undefined)} status={status} />;
  else if (page === 'test') screen = <TestPage onBack={() => setPage(undefined)} status={status} />;
  else if (tab === 'home')
    screen = (
      <Home
        lang={settings.lang}
        status={status}
        jobs={jobs}
        clip={clip}
        announcement={announcement}
        update={appUpdate}
        onLink={(text) => {
          if (text === clip) forgetClip();
          openLink(text);
        }}
        onPaste={pasteFromClipboard}
        onDismissClip={forgetClip}
        onDismissAnnouncement={() => {
          if (remote.announcement) {
            writeLocal('op.ann', remote.announcement.id);
            setDismissedAnn(remote.announcement.id);
          }
        }}
        onShowUpdate={() => setShowUpdate(true)}
        onDownloads={() => setTab('downloads')}
        onLibrary={() => setTab('library')}
        onSites={() => {
          setTab('more');
          setPage('sites');
        }}
        onOpenJob={openJob}
        onRetryEngine={() =>
          engine
            .prepare()
            .then(setStatus)
            .catch(() => {})
        }
      />
    );
  else if (tab === 'downloads')
    screen = (
      <Downloads
        jobs={jobs}
        onCancel={(j) => void engine.cancel(j.id)}
        onRetry={(j) => void engine.retry(j.id)}
        onFix={(j) => void fixJob(j)}
        onOpen={openJob}
        onMenu={setMenuJob}
        onClearFinished={() => void removeJobs(jobs.filter((j) => j.status === 'done' || j.status === 'canceled').map((j) => j.id), false)}
      />
    );
  else if (tab === 'library')
    screen = (
      <Library
        jobs={jobs}
        lang={settings.lang}
        sort={settings.libSort}
        positions={positions}
        playingKey={ps.playing ? ps.id : undefined}
        onSort={(libSort) => update({ libSort })}
        onOpen={openItem}
        onPlayAll={(list, shuffle) => playAudio(list, shuffle ? Math.floor(Math.random() * list.length) : 0, shuffle)}
        onMenu={setItemMenu}
        onShare={(list) => void engine.shareFiles(refs(list)).catch(() => {})}
        onDelete={(list) => void deleteItems(list)}
        onCheck={checkFiles}
      />
    );
  else
    screen = (
      <SettingsScreen
        settings={settings}
        update={update}
        status={status}
        sessions={sessions}
        battery={battery}
        notifications={notif}
        onLogin={(site) => void login(site)}
        onLogout={(site) => void logout(site)}
        onUpdateEngine={async () => {
          try {
            const r = await engine.updateEngines(true);
            setStatus(r);
            return r.changed ? t('set.updated', { v: r.ytdlp ?? '' }) : t('set.upToDate');
          } catch (e) {
            return String((e as Error)?.message ?? e);
          }
        }}
        onCheckApp={async () => {
          if (!status?.build) return t('set.noUpdate');
          try {
            const u = await checkForUpdate({ build: status.build, channel: settings.appChannel, abis: status.abis, force: true });
            if (!u) return t('set.noUpdate');
            setAppUpdate(u);
            setShowUpdate(true);
            return t('up.banner', { v: u.version });
          } catch (e) {
            return t('set.checkFailed', { error: String((e as Error)?.message ?? e) });
          }
        }}
        onBattery={() => void engine.openBatterySettings()}
        onNotifications={() => void engine.requestNotifications().then(setNotif)}
        onAddTile={() => engine.addTile().catch(() => false)}
        pipOk={pipOk}
        onKaraokeStatus={karaokeStatusOf}
        onKaraokeDelete={async () => {
          await engine.deleteKaraoke().catch(() => {});
          say(t('set.karaokeDeleted'));
        }}
        onPage={setPage}
      />
    );

  return (
    <LangContext.Provider value={settings.lang}>
      <div className={`app${showMini ? ' with-mini' : ''}`}>{screen}</div>

      {showMini ? <MiniPlayer cur={current} onOpen={openNowPlaying} /> : null}

      <nav className="nav" aria-label="Main">
        {nav.map((n) => (
          <button
            key={n.id}
            type="button"
            aria-current={tab === n.id && !page ? 'page' : undefined}
            onClick={() => {
              setPage(undefined);
              setTab(n.id);
            }}
          >
            <span className="pill">
              <Icon name={n.icon} />
              {n.badge ? <span className="badge">{n.badge}</span> : null}
            </span>
            {n.label}
          </button>
        ))}
      </nav>

      {sheetInput !== undefined ? (
        <DownloadSheet
          key={sheetInput}
          input={sheetInput}
          settings={settings}
          update={update}
          status={status}
          sessions={sessions}
          onClose={() => setSheetInput(undefined)}
          onAdded={added}
          onLogin={login}
          onError={(text) => say(text)}
        />
      ) : null}

      {menuJob ? (
        <JobMenu
          job={jobs.find((j) => j.id === menuJob.id) ?? menuJob}
          onClose={() => setMenuJob(undefined)}
          onOpen={openJob}
          onOpenWith={(j) => void engine.open(j.id, 0, { chooser: true }).catch(() => say(t('err.noApp')))}
          onShare={(j) => void engine.share(j.id)}
          onRetry={(j) => void engine.retry(j.id)}
          onRemove={(j, deleteFiles) => void removeJobs([j.id], deleteFiles)}
          onToast={say}
        />
      ) : null}

      {showUpdate && appUpdate ? (
        <UpdateSheet
          update={appUpdate}
          onClose={() => setShowUpdate(false)}
          onSkip={() => {
            update({ skippedBuild: appUpdate.build });
            setShowUpdate(false);
            setAppUpdate(undefined);
          }}
        />
      ) : null}

      {viewer?.kind === 'image' ? (
        <ImageViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(undefined)} onShare={(it) => void engine.share(it.jobId, it.file.uri).catch(() => {})} onMenu={setItemMenu} />
      ) : null}

      {viewer?.kind === 'video' ? (
        <VideoPlayer
          key={viewer.items[0]?.key}
          items={viewer.items}
          index={viewer.index}
          resume={viewer.resume}
          settings={settings}
          pipOk={pipOk}
          onClose={closeVideo}
          onMenu={setItemMenu}
          onOpenWith={openWith}
          onToast={say}
        />
      ) : null}

      {npOpen && !ps.idle ? (
        <NowPlaying
          cur={current}
          queue={queue.length ? queue : current ? [current] : []}
          alt={counterpart(current, items)}
          onClose={() => setNpOpen(false)}
          onMenu={setItemMenu}
          onSwap={swap}
          onWatch={() => {
            setNpOpen(false);
            openNowPlaying();
          }}
          onToast={say}
        />
      ) : null}

      {itemMenu ? (
        <ItemMenu
          item={byKey.get(itemMenu.key) ?? itemMenu}
          alt={counterpart(byKey.get(itemMenu.key) ?? itemMenu, items)}
          inPlayer={itemMenu.key === ps.id && (npOpen || viewer?.kind === 'video')}
          onClose={() => setItemMenu(undefined)}
          onOpen={(it) => openItem(it, items)}
          onOpenWith={openWith}
          onShare={(it) => void engine.share(it.jobId, it.file.uri).catch(() => {})}
          onKaraoke={askKaraoke}
          onInfo={setInfo}
          onSwap={swap}
          onSource={(it) => openExternal(it.url)}
          onCopyLink={(it) => void copyLink(it.url)}
          onDelete={(it) => void deleteItems([it])}
        />
      ) : null}

      {info ? <InfoSheet item={info} onClose={() => setInfo(undefined)} onSource={(it) => openExternal(it.url)} /> : null}

      {karaoke ? <KaraokeSheet item={karaoke} status={karaokeStatus} onClose={() => setKaraoke(undefined)} onStart={(keep, as) => void startKaraoke(karaoke, keep, as)} /> : null}

      {toast ? (
        <div className={`toast${showMini ? ' above-mini' : ''}`} role="status">
          <span className="grow">{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action!.run();
                setToast(undefined);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {!settings.onboarded ? (
        <Onboarding
          onDone={() => update({ onboarded: true })}
          onNotifications={async () => setNotif(await engine.requestNotifications().catch(() => false))}
          onBattery={status && !PIXEL.test(status.maker) ? () => void engine.openBatterySettings() : undefined}
        />
      ) : null}
    </LangContext.Provider>
  );
}
