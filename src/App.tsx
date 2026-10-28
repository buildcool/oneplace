import { App as CapApp } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { explain } from './core/errors.ts';
import { detect, findUrls } from './core/links.ts';
import { EMPTY_CONFIG, loadRemoteConfig, type RemoteConfig } from './core/remoteConfig.ts';
import { buildRequest, canAutoStart, loadSettings, quickRequest, quickTemplates, saveSettings, videoSpec, type Settings } from './core/settings.ts';
import { SITES } from './core/sites.ts';
import type { Job, SiteId } from './core/types.ts';
import { checkForUpdate, type Update } from './core/update.ts';
import { engine, type EngineStatus } from './engine/index.ts';
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
    ];
    (async () => {
      const s = await engine.status().catch(() => undefined);
      if (s) setStatus(s);
      setJobs(await engine.jobs().catch(() => []));
      const pending = await engine.pendingShare().catch(() => undefined);
      if (pending) openLink(pending);
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
        onOpenJob={(j) => void engine.open(j.id).catch(() => setMenuJob(j))}
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
        onOpen={(j) => void engine.open(j.id).catch(() => setMenuJob(j))}
        onMenu={setMenuJob}
        onClearFinished={() => void removeJobs(jobs.filter((j) => j.status === 'done' || j.status === 'canceled').map((j) => j.id), false)}
      />
    );
  else if (tab === 'library') screen = <Library jobs={jobs} onOpen={(j) => void engine.open(j.id).catch(() => setMenuJob(j))} onMenu={setMenuJob} />;
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
        onPage={setPage}
      />
    );

  return (
    <LangContext.Provider value={settings.lang}>
      <div className="app">{screen}</div>

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
          onOpen={(j) => void engine.open(j.id)}
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

      {toast ? (
        <div className="toast" role="status">
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
