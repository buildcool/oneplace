import { useEffect, useState } from 'react';
import { bytes } from '../core/format.ts';
import type { Settings as S, VideoQuality } from '../core/settings.ts';
import { SITES } from '../core/sites.ts';
import type { SiteId } from '../core/types.ts';
import { RELEASES_PAGE } from '../core/update.ts';
import type { EngineStatus } from '../engine/index.ts';
import type { KaraokeStatus } from '../engine/types.ts';
import { LANGS, useT } from '../i18n.ts';
import { Icon } from './Icon.tsx';
import { Row, SectionTitle, Seg, SiteAvatar, SwitchRow } from './common.tsx';
import { openExternal, reportUrl } from './report.ts';

export type Page = 'sites' | 'about' | 'test';

const LOGIN_SITES: SiteId[] = ['instagram', 'facebook', 'x', 'tiktok', 'reddit', 'pinterest', 'threads', 'youtube'];

interface Props {
  settings: S;
  update: (patch: Partial<S>) => void;
  status?: EngineStatus;
  sessions: string[];
  battery?: boolean;
  notifications?: boolean;
  onLogin: (site: SiteId) => void;
  onLogout: (site: SiteId) => void;
  onUpdateEngine: () => Promise<string>;
  onCheckApp: () => Promise<string>;
  onBattery: () => void;
  onNotifications: () => void;
  onAddTile: () => Promise<boolean>;
  /** Small floating video window possible (Android 8+). */
  pipOk: boolean;
  onKaraokeStatus: () => Promise<KaraokeStatus>;
  onKaraokeDelete: () => Promise<void>;
  onPage: (p: Page) => void;
}

export function Settings(p: Props) {
  const t = useT();
  const s = p.settings;
  const [engineMsg, setEngineMsg] = useState<string>();
  const [engineBusy, setEngineBusy] = useState(false);
  const [appMsg, setAppMsg] = useState<string>();
  const [appBusy, setAppBusy] = useState(false);
  const [tileMsg, setTileMsg] = useState<string>();
  const [kar, setKar] = useState<KaraokeStatus>();
  const qualities: VideoQuality[] = ['best', 2160, 1440, 1080, 720, 480, 360];
  const { onKaraokeStatus } = p;
  useEffect(() => {
    onKaraokeStatus()
      .then(setKar)
      .catch(() => {});
  }, [onKaraokeStatus]);

  return (
    <>
      <header className="topbar">
        <h1>{t('tab.more')}</h1>
      </header>
      <main className="page">
        <SectionTitle>{t('set.appearance')}</SectionTitle>
        <div className="card group">
          <div className="row stack">
            <span className="title">{t('set.theme')}</span>
            <Seg
              value={s.theme}
              options={[
                { id: 'system', label: t('set.theme.system') },
                { id: 'light', label: t('set.theme.light') },
                { id: 'dark', label: t('set.theme.dark') },
              ]}
              onChange={(theme) => p.update({ theme })}
            />
          </div>
          <SwitchRow icon="moon" title={t('set.amoled')} on={s.amoled} onChange={(amoled) => p.update({ amoled })} />
          {(p.status?.sdk ?? 0) >= 31 ? <SwitchRow icon="palette" title={t('set.dynamic')} on={s.dynamicColor} onChange={(dynamicColor) => p.update({ dynamicColor })} /> : null}
          <div className="row stack">
            <span className="title">{t('set.language')}</span>
            <Seg value={s.lang} options={LANGS.map((l) => ({ id: l.id, label: l.name }))} onChange={(lang) => p.update({ lang })} />
          </div>
        </div>

        <SectionTitle>{t('set.downloads')}</SectionTitle>
        <div className="card group">
          <div className="row stack">
            <span className="title">{t('set.videoQuality')}</span>
            <div className="chips">
              {qualities.map((q) => (
                <button key={q} type="button" className="chip" aria-pressed={s.videoQuality === q} onClick={() => p.update({ videoQuality: q })}>
                  {q === 'best' ? t('set.best') : q >= 2160 ? '4K' : q === 1440 ? '2K' : `${q}p`}
                </button>
              ))}
            </div>
          </div>
          <SwitchRow icon="video" title={t('set.compat')} on={s.compat} onChange={(compat) => p.update({ compat })} />
          <div className="row stack">
            <span className="title">{t('set.audioFormat')}</span>
            <Seg
              value={s.audioFormat}
              options={[
                { id: 'mp3', label: 'MP3' },
                { id: 'm4a', label: 'M4A' },
                { id: 'original', label: t('audio.original') },
              ]}
              onChange={(audioFormat) => p.update({ audioFormat })}
            />
          </div>
          {s.audioFormat === 'mp3' ? (
            <div className="row stack">
              <span className="title">{t('set.mp3Bitrate')}</span>
              <Seg
                value={s.mp3Bitrate}
                options={([320, 192, 128] as const).map((k) => ({ id: k, label: `${k} kbps` }))}
                onChange={(mp3Bitrate) => p.update({ mp3Bitrate })}
              />
            </div>
          ) : null}
          <SwitchRow icon="music" title={t('set.cover')} on={s.embedCover} onChange={(embedCover) => p.update({ embedCover })} />
          {s.embedCover ? <SwitchRow icon="image" title={t('set.square')} on={s.squareCover} onChange={(squareCover) => p.update({ squareCover })} /> : null}
          <div className="row stack">
            <span className="title">{t('set.concurrency')}</span>
            <Seg value={s.concurrency} options={([1, 2, 3] as const).map((n) => ({ id: n, label: String(n) }))} onChange={(concurrency) => p.update({ concurrency })} />
          </div>
          <SwitchRow icon="globe" title={t('set.wifiOnly')} on={s.wifiOnly} onChange={(wifiOnly) => p.update({ wifiOnly })} />
          <SwitchRow icon="paste" title={t('set.clipboard')} on={s.clipboardChip} onChange={(clipboardChip) => p.update({ clipboardChip })} />
          <SwitchRow icon="download" title={t('set.autoCopied')} sub={t('set.autoCopiedSub')} on={s.autoCopied} onChange={(autoCopied) => p.update({ autoCopied })} />
          <SwitchRow icon="check" title={t('sheet.remember')} on={s.rememberChoice} onChange={(rememberChoice) => p.update({ rememberChoice })} />
        </div>

        <SectionTitle>{t('set.share')}</SectionTitle>
        <div className="card group">
          <SwitchRow icon="bolt" title={t('set.quick')} sub={t('set.quickSub')} on={s.quickTargets} onChange={(quickTargets) => p.update({ quickTargets })} />
          <Row
            icon="grid"
            title={t('set.tile')}
            sub={tileMsg ?? t('set.tileSub')}
            onClick={async () => setTileMsg((await p.onAddTile()) ? t('set.tileAdded') : t('set.tileManual'))}
          />
        </div>

        <SectionTitle>{t('set.player')}</SectionTitle>
        <div className="card group">
          <div className="row stack">
            <span className="title">{t('set.openIn')}</span>
            <Seg
              value={s.openIn}
              options={[
                { id: 'app', label: t('set.openApp') },
                { id: 'other', label: t('set.openOther') },
              ]}
              onChange={(openIn) => p.update({ openIn })}
            />
          </div>
          <div className="row stack">
            <span className="title">{t('set.leave')}</span>
            <Seg
              value={!p.pipOk && s.leaveVideo === 'pip' ? 'pause' : s.leaveVideo}
              options={[
                ...(p.pipOk ? [{ id: 'pip' as const, label: t('set.leavePip') }] : []),
                { id: 'audio' as const, label: t('set.leaveAudio') },
                { id: 'pause' as const, label: t('set.leavePause') },
              ]}
              onChange={(leaveVideo) => p.update({ leaveVideo })}
            />
          </div>
          <SwitchRow icon="replay" title={t('set.resume')} on={s.resume} onChange={(resume) => p.update({ resume })} />
          <Row
            icon="micOff"
            title={t('set.karaoke')}
            sub={kar?.installed ? t('set.karaokeOn', { size: bytes(kar.bytes) }) : t('set.karaokeOff', { mb: Math.round((kar?.download ?? 51_000_000) / 1_000_000) })}
            onClick={
              kar?.installed
                ? async () => {
                    await p.onKaraokeDelete();
                    setKar(await p.onKaraokeStatus().catch(() => undefined));
                  }
                : undefined
            }
            trail={kar?.installed ? <Icon name="trash" size={18} /> : ''}
          />
        </div>

        <SectionTitle>{t('set.accounts')}</SectionTitle>
        <div className="card group">
          <div className="row">
            <span className="sub" style={{ margin: 0 }}>
              {t('set.accountsSub')}
            </span>
          </div>
          {LOGIN_SITES.map((id) => {
            const on = p.sessions.includes(id);
            return (
              <button key={id} type="button" className="row" onClick={() => (on ? p.onLogout(id) : p.onLogin(id))}>
                <SiteAvatar site={id} />
                <span className="grow">
                  <span className="title">{SITES[id].name}</span>
                  <span className="sub">{on ? t('set.loggedIn') : id === 'youtube' ? t('set.googleNote') : t('set.logIn')}</span>
                </span>
                {on ? <span className="status-dot" style={{ background: 'var(--good)' }} /> : <Icon name="chevron" size={18} />}
              </button>
            );
          })}
        </div>

        <SectionTitle>{t('set.engine')}</SectionTitle>
        <div className="card group">
          <Row icon="cpu" title="yt-dlp" trail={p.status?.ytdlp ?? '…'} />
          <Row icon="photos" title="gallery-dl" trail={p.status?.gallerydl ?? '…'} />
          <div className="row stack">
            <span className="title">{t('set.engineChannel')}</span>
            <Seg
              value={s.ytdlpChannel}
              options={[
                { id: 'nightly', label: t('set.nightly') },
                { id: 'stable', label: t('set.stable') },
              ]}
              onChange={(ytdlpChannel) => p.update({ ytdlpChannel })}
            />
          </div>
          <SwitchRow icon="refresh" title={t('set.autoEngine')} on={s.autoEngineUpdate} onChange={(autoEngineUpdate) => p.update({ autoEngineUpdate })} />
          <div className="row">
            <span className="grow sub" style={{ margin: 0 }}>
              {engineMsg ?? ''}
            </span>
            <button
              type="button"
              className="btn small tonal"
              disabled={engineBusy}
              onClick={async () => {
                setEngineBusy(true);
                setEngineMsg(t('fix.updating'));
                try {
                  setEngineMsg(await p.onUpdateEngine());
                } finally {
                  setEngineBusy(false);
                }
              }}
            >
              {engineBusy ? <span className="spinner" /> : <Icon name="refresh" size={16} />} {t('set.updateNow')}
            </button>
          </div>
        </div>

        <SectionTitle>{t('set.app')}</SectionTitle>
        <div className="card group">
          <Row icon="info" title={t('set.version', { v: p.status?.appVersion ?? '…' })} onClick={() => openExternal(RELEASES_PAGE)} />
          <div className="row stack">
            <span className="title">{t('set.appChannel')}</span>
            <Seg
              value={s.appChannel}
              options={[
                { id: 'stable', label: t('set.stable') },
                { id: 'beta', label: t('set.beta') },
              ]}
              onChange={(appChannel) => p.update({ appChannel })}
            />
          </div>
          <SwitchRow icon="update" title={t('set.autoApp')} on={s.autoAppUpdate} onChange={(autoAppUpdate) => p.update({ autoAppUpdate })} />
          <div className="row">
            <span className="grow sub" style={{ margin: 0 }}>
              {appMsg ?? ''}
            </span>
            <button
              type="button"
              className="btn small tonal"
              disabled={appBusy}
              onClick={async () => {
                setAppBusy(true);
                try {
                  setAppMsg(await p.onCheckApp());
                } finally {
                  setAppBusy(false);
                }
              }}
            >
              {appBusy ? <span className="spinner" /> : <Icon name="update" size={16} />} {t('set.checkNow')}
            </button>
          </div>
        </div>

        <SectionTitle>{t('set.phone')}</SectionTitle>
        <div className="card group">
          <Row icon="battery" title={t('set.battery')} sub={p.battery ? t('set.batteryOn') : t('set.batteryOff')} onClick={p.battery ? p.onBattery : undefined} trail={p.battery ? undefined : ''} />
          <Row
            icon="bell"
            title={t('set.notifications')}
            sub={p.notifications === false ? t('set.notifOff') : t('set.notifOn')}
            onClick={p.notifications === false ? p.onNotifications : undefined}
            trail={p.notifications === false ? undefined : ''}
          />
        </div>

        <SectionTitle>OnePlace</SectionTitle>
        <div className="card group" style={{ marginBottom: 12 }}>
          <Row icon="globe" title={t('set.sites')} onClick={() => p.onPage('sites')} />
          <Row icon="shield" title={t('set.about')} onClick={() => p.onPage('about')} />
          <Row icon="flask" title={t('set.test')} onClick={() => p.onPage('test')} />
          <Row icon="bug" title={t('set.report')} onClick={() => openExternal(reportUrl({ status: p.status }))} />
        </div>
        <p className="small muted credit-foot">
          OnePlace {p.status?.appVersion ?? ''} · {t('about.madeBy')}
          {p.status?.official ? ` · ${t('about.official')} ✓` : ''}
        </p>
      </main>
    </>
  );
}
