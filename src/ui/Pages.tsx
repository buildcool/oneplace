import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { parseGallery, parseJson, parseYtInfo, type YtInfo } from '../core/formats.ts';
import { infoArgs } from '../core/info.ts';
import { detect, findUrls } from '../core/links.ts';
import { SITES, enginesFor, type SupportStatus } from '../core/sites.ts';
import type { EngineId } from '../core/types.ts';
import { REPO } from '../core/update.ts';
import { engine, type EngineStatus } from '../engine/index.ts';
import { useT } from '../i18n.ts';
import { Icon, LogoMark } from './Icon.tsx';
import { SectionTitle, SiteAvatar, SubPage } from './common.tsx';
import { openExternal } from './report.ts';

export function SitesPage({ onBack }: { onBack: () => void }) {
  const t = useT();
  const groups: { status: SupportStatus; label: string; color: string }[] = [
    { status: 'works', label: t('sites.works'), color: 'var(--good)' },
    { status: 'login', label: t('sites.login'), color: 'var(--warn)' },
    { status: 'best', label: t('sites.best'), color: 'var(--faint)' },
  ];
  const all = Object.values(SITES).filter((s) => s.id !== 'other');
  return (
    <SubPage title={t('set.sites')} onBack={onBack}>
      {groups.map((g) => (
        <div key={g.status}>
          <SectionTitle>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="status-dot" style={{ background: g.color }} /> {g.label}
            </span>
          </SectionTitle>
          <div className="card group">
            {all
              .filter((s) => s.status === g.status)
              .map((s) => (
                <div key={s.id} className="row">
                  <SiteAvatar site={s.id} />
                  <span className="grow">
                    <span className="title">{s.name}</span>
                    <span className="sub">{s.what}</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      ))}
      <p className="note">{t('sites.more')}</p>
      <div className="banner bad" style={{ marginBottom: 24 }}>
        <Icon name="shield" />
        <div className="grow small">{t('sites.never')}</div>
      </div>
    </SubPage>
  );
}

const LICENCES = [
  ['OnePlace © 2026 buildcool', 'GPL-3.0 + terms'],
  ['youtubedl-android', 'GPL-3.0'],
  ['yt-dlp', 'Unlicense'],
  ['gallery-dl', 'GPL-2.0'],
  ['FFmpeg', 'LGPL / GPL'],
  ['Python', 'PSF'],
  ['QuickJS', 'MIT'],
  ['aria2', 'GPL-2.0'],
  ['requests, urllib3, certifi', 'Apache-2.0 / MIT / MPL-2.0'],
  ['Capacitor, React', 'MIT'],
];

export function AboutPage({ onBack, status }: { onBack: () => void; status?: EngineStatus }) {
  const t = useT();
  const official = status?.official;
  return (
    <SubPage title={t('set.about')} onBack={onBack}>
      <div className="card credit">
        <LogoMark size={48} />
        <div className="grow">
          <b style={{ fontSize: 18 }}>OnePlace</b>
          <span>{t('about.madeBy')}</span>
          <span className="small muted">© 2026 buildcool · GPL-3.0</span>
        </div>
      </div>
      {status && status.official !== undefined ? (
        <div className={`banner ${official ? 'good' : 'warn'}`}>
          <Icon name={official ? 'check' : 'alert'} />
          <div className="grow small">
            <b>{t(official ? 'about.official' : 'about.unofficial')}</b>
            <div>{t(official ? 'about.officialSub' : 'about.unofficialSub')}</div>
          </div>
        </div>
      ) : null}
      <div className="card" style={{ padding: 16, marginTop: 8 }}>
        <p style={{ margin: 0 }}>{t('about.body')}</p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {status ? `${status.appVersion} · yt-dlp ${status.ytdlp ?? '?'} · gallery-dl ${status.gallerydl ?? '?'}` : ''}
        </p>
      </div>
      <SectionTitle>{t('about.calls')}</SectionTitle>
      <div className="card group">
        {(['about.call1', 'about.call2', 'about.call3', 'about.call4'] as const).map((k) => (
          <div key={k} className="row">
            <span className="ic">
              <Icon name="globe" />
            </span>
            <span className="grow">{t(k)}</span>
          </div>
        ))}
      </div>
      <div className="banner warn">
        <Icon name="shield" />
        <div className="grow small">{t('about.legal')}</div>
      </div>
      <SectionTitle>{t('about.licenses')}</SectionTitle>
      <p className="note">{t('about.licenseNote')}</p>
      <div className="card group">
        {LICENCES.map(([name, lic]) => (
          <div key={name} className="row">
            <span className="grow title">{name}</span>
            <span className="trail">{lic}</span>
          </div>
        ))}
      </div>
      <button type="button" className="btn block tonal" style={{ marginTop: 16 }} onClick={() => openExternal(`https://github.com/${REPO}`)}>
        <Icon name="code" /> {t('about.source')}
      </button>
      <button type="button" className="btn block plain" style={{ margin: '8px 0 24px' }} onClick={() => openExternal('https://github.com/buildcool')}>
        <Icon name="user" /> {t('about.maker')}
      </button>
    </SubPage>
  );
}

interface TestLine {
  label: string;
  ok: boolean;
  ms: number;
  detail: string;
}

/** Engine test: reads a link with every engine and reports timings (used for the P0 spike). */
export function TestPage({ onBack, status }: { onBack: () => void; status?: EngineStatus }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<TestLine[]>([]);
  const [queue, setQueue] = useState<Record<string, unknown>>();
  useEffect(() => {
    const read = () =>
      engine
        .debug()
        .then(setQueue)
        .catch(() => {});
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, []);

  async function run() {
    const u = findUrls(url)[0];
    if (!u) return;
    setBusy(true);
    const out: TestLine[] = [];
    const push = (l: TestLine) => {
      out.push(l);
      setLines([...out]);
    };
    let link = detect(u);
    const t0 = Date.now();
    if (link.short) {
      try {
        const r = await engine.resolve(link.url);
        link = { ...detect(r), short: false };
        push({ label: 'resolve', ok: true, ms: Date.now() - t0, detail: r });
      } catch (e) {
        push({ label: 'resolve', ok: false, ms: Date.now() - t0, detail: String(e) });
      }
    }
    const engines: EngineId[] = [...new Set<EngineId>([...enginesFor(link), 'ytdlp', 'gallerydl'])];
    for (const eng of engines) {
      const t1 = Date.now();
      try {
        const r = await engine.info({ url: link.url, engine: eng, args: infoArgs(link, eng), site: link.site });
        let detail = `${(r.json.length / 1024).toFixed(0)} KB JSON`;
        if (eng === 'ytdlp') {
          const m = parseYtInfo(JSON.parse(r.json) as YtInfo, true);
          detail += ` · ${m.title.slice(0, 40)} · ${m.video.length} video / ${m.audio.length} audio${m.playlist ? ` · ${m.playlist.count} items` : ''}`;
        } else {
          const g = parseGallery(parseJson(r.json));
          detail += g.error ? ` · ${g.error}` : ` · ${g.items.length} items (${g.items.filter((i) => i.isVideo).length} videos)`;
        }
        push({ label: eng, ok: true, ms: Date.now() - t1, detail });
      } catch (e) {
        push({ label: eng, ok: false, ms: Date.now() - t1, detail: String((e as Error)?.message ?? e).slice(-400) });
      }
    }
    setBusy(false);
  }

  const report = () =>
    [
      `OnePlace ${status?.appVersion} · SDK ${status?.sdk} · ${status?.abis.join(',')} · ${status?.maker}`,
      `yt-dlp ${status?.ytdlp} · gallery-dl ${status?.gallerydl}`,
      `site ${detect(findUrls(url)[0] ?? '').site}`,
      `queue ${JSON.stringify(queue ?? {})}`,
      ...lines.map((l) => `${l.ok ? 'OK ' : 'ERR'} ${l.label} ${(l.ms / 1000).toFixed(1)}s ${l.detail}`),
    ].join('\n');

  return (
    <SubPage title={t('set.test')} onBack={onBack}>
      <p className="note">{t('test.body')}</p>
      <div className="card" style={{ padding: 12, marginTop: 10 }}>
        <div className="linkbox" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>
          <Icon name="link" size={20} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('home.paste')} inputMode="url" autoComplete="off" />
        </div>
        <button type="button" className="btn block" style={{ marginTop: 10 }} disabled={busy || !url} onClick={run}>
          {busy ? <span className="spinner" /> : <Icon name="flask" />} {t('test.run')}
        </button>
      </div>
      {status ? (
        <p className="mono muted" style={{ marginTop: 12 }}>
          {`SDK ${status.sdk} · ${status.abis.join(', ')} · ${status.maker}\nyt-dlp ${status.ytdlp ?? '?'} · gallery-dl ${status.gallerydl ?? '?'}`}
        </p>
      ) : null}
      {queue ? <p className="mono muted">{'queue ' + JSON.stringify(queue, null, 1).replace(/[{}"]/g, '').trim()}</p> : null}
      {lines.length ? (
        <div className="card group" style={{ marginTop: 12 }}>
          {lines.map((l, i) => (
            <div key={i} className="row">
              <span className="status-dot" style={{ background: l.ok ? 'var(--good)' : 'var(--bad)' }} />
              <span className="grow">
                <span className="title">
                  {l.label} · {(l.ms / 1000).toFixed(1)} s
                </span>
                <span className="sub mono">{l.detail}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {lines.length && !busy ? (
        <button
          type="button"
          className="btn block tonal"
          style={{ margin: '12px 0 24px' }}
          onClick={async () => {
            if (Capacitor.isNativePlatform()) await Clipboard.write({ string: report() });
            else await navigator.clipboard?.writeText(report());
          }}
        >
          <Icon name="copy" /> {t('test.copy')}
        </button>
      ) : null}
    </SubPage>
  );
}

