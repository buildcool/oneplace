import { useState } from 'react';
import type { Announcement } from '../core/remoteConfig.ts';
import { HOME_SITES, siteInfo } from '../core/sites.ts';
import type { Job } from '../core/types.ts';
import type { Update } from '../core/update.ts';
import type { EngineStatus } from '../engine/index.ts';
import { useT, type Lang } from '../i18n.ts';
import { Icon, LogoMark } from './Icon.tsx';
import { Progress, SectionTitle, SiteAvatar, Thumb } from './common.tsx';
import { jobIcon } from './jobs.ts';
import { openExternal } from './report.ts';

interface Props {
  lang: Lang;
  status?: EngineStatus;
  jobs: Job[];
  clip?: string;
  announcement?: Announcement;
  update?: Update;
  onLink: (text: string) => void;
  onPaste: () => Promise<string | undefined>;
  onDismissClip: () => void;
  onDismissAnnouncement: () => void;
  onShowUpdate: () => void;
  onDownloads: () => void;
  onLibrary: () => void;
  onSites: () => void;
  onOpenJob: (job: Job) => void;
  onRetryEngine: () => void;
}

export function Home(p: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const active = p.jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const running = active.filter((j) => j.status === 'running' && j.progress >= 0);
  const avg = running.length ? running.reduce((n, j) => n + j.progress, 0) / running.length : -1;
  const recent = p.jobs.filter((j) => j.status === 'done').slice(0, 8);

  const submit = (value: string) => {
    if (!value.trim()) return;
    p.onLink(value);
    setText('');
  };

  return (
    <>
      <header className="topbar">
        <div className="logo">
          <LogoMark />
          <span className="logo-text">OnePlace</span>
          <span className="logo-by">by buildcool</span>
        </div>
      </header>
      <main className="page">
        <section className="hero">
          <h2>{t('home.tagline')}</h2>
          <form
            className="linkbox"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
          >
            <Icon name="link" size={20} />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('home.paste')}
              inputMode="url"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={t('home.paste')}
            />
            {text ? (
              <button type="submit" className="go-btn">
                <Icon name="download" size={18} /> {t('home.go')}
              </button>
            ) : (
              <button
                type="button"
                className="go-btn"
                onClick={async () => {
                  const v = await p.onPaste();
                  if (v) submit(v);
                }}
              >
                <Icon name="paste" size={18} /> {t('home.pasteBtn')}
              </button>
            )}
          </form>
          <p className="hint">{t('home.shareHint')}</p>
        </section>

        {p.status?.preparing ? (
          <div className="banner">
            <span className="spinner" style={{ color: 'var(--brand)' }} />
            <div className="grow">{t('engine.preparing')}</div>
          </div>
        ) : null}
        {p.status?.error && !p.status.ready ? (
          <div className="banner bad">
            <Icon name="alert" />
            <div className="grow">
              <b>{t('engine.failed')}</b>
              <span className="small">{p.status.error}</span>
            </div>
            <button type="button" className="btn small" onClick={p.onRetryEngine}>
              {t('fix.retry')}
            </button>
          </div>
        ) : null}

        {p.clip ? (
          <div className="clipchip">
            <button type="button" className="grow" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }} onClick={() => p.onLink(p.clip!)}>
              <Icon name="paste" />
              <span style={{ minWidth: 0 }}>
                <small>{t('home.copied')}</small>
                <span className="url">{p.clip}</span>
              </span>
            </button>
            <button type="button" className="btn small" aria-label={t('sheet.download')} onClick={() => p.onLink(p.clip!)}>
              <Icon name="download" size={16} />
            </button>
            <button type="button" className="iconbtn" style={{ width: 34, height: 34 }} aria-label={t('common.close')} onClick={p.onDismissClip}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : null}

        {p.update ? (
          <button type="button" className="banner" style={{ width: '100%', textAlign: 'left' }} onClick={p.onShowUpdate}>
            <Icon name="update" />
            <div className="grow">
              <b>{t('up.banner', { v: p.update.version })}</b>
            </div>
            <Icon name="chevron" size={18} />
          </button>
        ) : null}

        {p.announcement ? (
          <div className={`banner${p.announcement.level === 'warn' ? ' warn' : ''}`}>
            <Icon name="info" />
            <div className="grow">
              {p.announcement.text[p.lang] ?? p.announcement.text.en}
              {p.announcement.url ? (
                <button type="button" className="small" style={{ display: 'block', color: 'var(--brand)', fontWeight: 600, marginTop: 4 }} onClick={() => openExternal(p.announcement!.url!)}>
                  {t('home.seeAll')} →
                </button>
              ) : null}
            </div>
            <button type="button" className="iconbtn" style={{ width: 32, height: 32 }} aria-label="Dismiss" onClick={p.onDismissAnnouncement}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ) : null}

        {active.length ? (
          <button type="button" className="card" style={{ display: 'block', width: '100%', padding: 14, marginTop: 14, textAlign: 'left' }} onClick={p.onDownloads}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Icon name="download" />
              <b className="grow" style={{ flex: 1 }}>
                {t('home.active', { n: active.length })}
              </b>
              <span className="muted small">{avg >= 0 ? `${Math.round(avg)}%` : ''}</span>
            </div>
            <Progress value={avg} />
          </button>
        ) : null}

        {recent.length ? (
          <>
            <SectionTitle
              action={
                <button type="button" onClick={p.onLibrary}>
                  {t('home.seeAll')}
                </button>
              }
            >
              {t('home.recent')}
            </SectionTitle>
            <div className="recent">
              {recent.map((j) => (
                <button key={j.id} type="button" onClick={() => p.onOpenJob(j)}>
                  <Thumb src={j.thumb} icon={jobIcon(j)} />
                  <div className="t">{j.title}</div>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <SectionTitle
          action={
            <button type="button" onClick={p.onSites}>
              {t('home.allSites')}
            </button>
          }
        >
          {t('home.sites')}
        </SectionTitle>
        <div className="sites">
          {HOME_SITES.map((id) => {
            const s = siteInfo(id);
            return (
              <button key={id} type="button" className="site" onClick={() => s.home && openExternal(s.home)}>
                <SiteAvatar site={id} />
                <span>{s.name.replace(' (Twitter)', '')}</span>
              </button>
            );
          })}
        </div>

        <div className="banner" style={{ marginTop: 18 }}>
          <Icon name="bolt" />
          <div className="grow small">{t('home.tip')}</div>
        </div>
      </main>
    </>
  );
}
