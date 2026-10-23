import { useEffect, useMemo, useState } from 'react';
import { explain, type Explained } from '../core/errors.ts';
import { bytes } from '../core/format.ts';
import { parseGallery, parseJson, parseYtInfo, type AudioOption, type Gallery, type Media, type VideoOption, type YtInfo } from '../core/formats.ts';
import { infoArgs } from '../core/info.ts';
import { detect, findUrls } from '../core/links.ts';
import { audioSpec, buildRequest, videoSpec, type Settings } from '../core/settings.ts';
import { KIND_LABEL, enginesFor, needsLogin, siteInfo } from '../core/sites.ts';
import { thumbChoices } from '../core/thumbs.ts';
import type { DownloadSpec, EngineId, ImageFormat, Job, JobRequest, Link } from '../core/types.ts';
import { engine, type EngineStatus, type InfoResult } from '../engine/index.ts';
import { useT, type Key } from '../i18n.ts';
import { Icon } from './Icon.tsx';
import { Progress, Seg, Sheet, SiteAvatar, Switch, Thumb } from './common.tsx';
import { openExternal, reportUrl } from './report.ts';

type Tab = 'video' | 'audio' | 'photos' | 'thumb';

interface Loaded {
  link: Link;
  engine: EngineId;
  raw?: YtInfo;
  gallery?: Gallery;
  ms: number;
}

interface Props {
  input: string;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  status?: EngineStatus;
  sessions: string[];
  onClose: () => void;
  onAdded: (job: Job | undefined, count?: number) => void;
  onLogin: (site: string) => Promise<void>;
  onError: (text: string) => void;
}

const MUSIC_SITES = new Set(['ytmusic', 'soundcloud', 'jiosaavn', 'bandcamp', 'mixcloud', 'audiomack']);
const VAGUE = new Set(['unknown', 'novideo', 'unsupported']);
const RES_CHOICES = [2160, 1440, 1080, 720, 480, 360] as const;

export function DownloadSheet(props: Props) {
  const urls = useMemo(() => findUrls(props.input), [props.input]);
  if (urls.length > 1) return <MultiSheet {...props} urls={urls} />;
  return <SingleSheet {...props} url={urls[0]} />;
}

function SingleSheet({ url, settings, update, status, sessions, onClose, onAdded, onLogin, onError }: Props & { url?: string }) {
  const t = useT();
  const [phase, setPhase] = useState<'resolving' | 'reading' | 'ready' | 'error'>('reading');
  const [step, setStep] = useState<Key>('sheet.reading');
  const [data, setData] = useState<Loaded>();
  const [err, setErr] = useState<{ ex: Explained; raw: string; link?: Link }>();
  const [whole, setWhole] = useState(false);
  const [forced, setForced] = useState<EngineId>();
  const [attempt, setAttempt] = useState(0);
  const [fixing, setFixing] = useState(false);
  const [details, setDetails] = useState(false);

  const [tab, setTab] = useState<Tab>('video');
  const [compat, setCompat] = useState(settings.compat);
  const [vKey, setVKey] = useState<string>();
  const [aKey, setAKey] = useState<AudioOption['key']>('mp3-320');
  const [cover, setCover] = useState(settings.embedCover);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [thumbKey, setThumbKey] = useState<string>();
  const [thumbFmt, setThumbFmt] = useState<ImageFormat>('jpg');
  const [square, setSquare] = useState(false);
  const [count, setCount] = useState<number | 'all'>('all');
  const [plRes, setPlRes] = useState<number | 'best'>(settings.videoQuality);
  const [busy, setBusy] = useState(false);

  // Read the link: resolve short links, then ask each engine in turn until one finds something.
  useEffect(() => {
    if (!url) {
      setErr({ ex: explain(''), raw: '' });
      setPhase('error');
      return;
    }
    let alive = true;
    (async () => {
      setErr(undefined);
      setData(undefined);
      let link = detect(url);
      if (link.short) {
        setPhase('resolving');
        try {
          const final = await engine.resolve(link.url);
          if (final && final !== link.url) link = { ...detect(final), short: false };
        } catch {
          // keep the short link; yt-dlp follows redirects itself
        }
      }
      if (!alive) return;
      setPhase('reading');
      setStep('sheet.reading');
      let first: { ex: Explained; raw: string } | undefined;
      const order = forced ? [forced] : enginesFor(link, sessions.includes(link.site));
      for (const [i, eng] of order.entries()) {
        if (i > 0) setStep(eng === 'gallerydl' ? 'sheet.tryingPhotos' : 'sheet.reading2');
        try {
          const r = await engine.info({ url: link.url, engine: eng, args: infoArgs(link, eng, whole), site: link.site });
          if (!alive) return;
          const loaded = parseResult(r, link);
          if (loaded) {
            setData(loaded);
            setPhase('ready');
            return;
          }
        } catch (e) {
          if (!alive) return;
          const raw = String((e as Error)?.message ?? e);
          const ex = explain(raw);
          if (!first || (VAGUE.has(first.ex.code) && !VAGUE.has(ex.code))) first = { ex, raw };
        }
      }
      if (!alive) return;
      setErr({ ...(first ?? { ex: explain('There is no video in this post'), raw: '' }), link });
      setPhase('error');
    })();
    return () => {
      alive = false;
      void engine.cancelInfo();
    };
  }, [url, whole, forced, attempt]);

  const media: Media | undefined = useMemo(() => (data?.raw ? parseYtInfo(data.raw, compat) : undefined), [data, compat]);
  const gallery = data?.gallery;
  const link = data?.link ?? err?.link;
  const site = siteInfo(link?.site ?? 'other');
  const thumbs = useMemo(() => (data ? thumbChoices(data.link, media?.thumbnails, media?.thumb ?? gallery?.items[0]?.preview) : []), [data, media, gallery]);

  // First selection when a link has been read.
  useEffect(() => {
    if (!data) return;
    const m = data.raw ? parseYtInfo(data.raw, settings.compat) : undefined;
    const musicy = MUSIC_SITES.has(data.link.site) || data.link.kind === 'song' || data.link.kind === 'audio';
    setTab(data.gallery ? 'photos' : m && !m.video.length && !m.playlist ? 'audio' : musicy ? 'audio' : 'video');
    if (m) setVKey(pickVideo(m.video, settings));
    setAKey(pickAudio(settings));
    if (data.gallery) setPicked(new Set(data.gallery.items.map((i) => i.num)));
    setThumbKey(thumbChoices(data.link, m?.thumbnails, m?.thumb)[0]?.key);
    setSquare(data.link.site === 'ytmusic');
    setCount('all');
  }, [data]);

  const vOpt = media?.video.find((o) => o.key === vKey) ?? media?.video[0];
  const aOpt = media?.audio.find((o) => o.key === aKey);
  const isPlaylist = !!media?.playlist;
  const profileQueue = !!gallery && !gallery.items.length && gallery.queued > 0;
  const tabs: Tab[] = gallery
    ? [...(['photos'] as Tab[]), ...(gallery.items.some((i) => i.isVideo) ? (['audio'] as Tab[]) : [])]
    : isPlaylist
      ? ['video', 'audio']
      : [...(media?.video.length ? (['video'] as Tab[]) : []), 'audio', ...(thumbs.length ? (['thumb'] as Tab[]) : [])];

  const size = tab === 'video' && !isPlaylist ? vOpt?.size : tab === 'audio' && !isPlaylist ? aOpt?.size : undefined;
  const canDownload =
    phase === 'ready' &&
    !media?.drm &&
    (tab === 'video' ? isPlaylist || !!vOpt : tab === 'audio' ? true : tab === 'photos' ? picked.size > 0 || profileQueue : !!thumbKey);

  async function start() {
    if (!data) return;
    setBusy(true);
    const { link: l } = data;
    const title = media?.title ?? gallery?.title ?? l.url;
    const thumb = media?.thumb ?? gallery?.items.find((i) => i.preview)?.preview;
    const plEnd = count === 'all' ? undefined : count;
    let req: JobRequest;
    if (tab === 'video') {
      const spec: DownloadSpec = isPlaylist
        ? videoSpec({ ...settings, compat }, { playlist: true, playlistEnd: plEnd, maxRes: plRes === 'best' ? undefined : plRes })
        : { mode: 'video', formatId: vOpt?.formatSel, compat, maxRes: vOpt?.res || undefined };
      req = buildRequest({ link: l, engine: 'ytdlp', spec, title, thumb });
    } else if (tab === 'audio') {
      const fmt = aKey === 'original' ? 'original' : aKey === 'm4a' ? 'm4a' : 'mp3';
      const spec = audioSpec(settings, {
        audio: fmt,
        bitrate: aKey.startsWith('mp3') ? Number(aKey.split('-')[1]) : settings.mp3Bitrate,
        embedCover: cover,
        ...(isPlaylist ? { playlist: true, playlistEnd: plEnd } : {}),
      });
      req = buildRequest({ link: l, engine: 'ytdlp', spec, title, thumb });
    } else if (tab === 'photos') {
      const all = gallery && picked.size === gallery.items.length;
      req = buildRequest({
        link: l,
        engine: 'gallerydl',
        spec: { mode: 'photo', range: all ? undefined : compressRange([...picked]), playlistEnd: profileQueue ? plEnd : undefined },
        title,
        thumb,
      });
    } else {
      const c = thumbs.find((x) => x.key === thumbKey) ?? thumbs[0];
      req = buildRequest({
        link: l,
        engine: 'http',
        spec: { mode: 'thumbnail' },
        title,
        thumb: c?.urls[0],
        httpUrls: c?.urls,
        imageFormat: thumbFmt,
        crop: square ? 'square' : undefined,
      });
    }
    try {
      const job = await engine.enqueue(req);
      if (settings.rememberChoice) {
        if (tab === 'video' && vOpt && !isPlaylist) update({ lastVideoKey: vOpt.label });
        if (tab === 'audio') update({ lastAudioKey: aKey });
      }
      onAdded(job);
    } catch (e) {
      onError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function fix(ex: Explained) {
    if (!link) return;
    if (ex.fix === 'login') {
      await onLogin(link.site);
      setAttempt((a) => a + 1);
    } else if (ex.fix === 'update') {
      setFixing(true);
      try {
        await engine.updateEngines(true);
      } finally {
        setFixing(false);
      }
      setAttempt((a) => a + 1);
    } else if (ex.fix === 'photos') setForced('gallerydl');
    else if (ex.fix === 'report') openExternal(reportUrl({ site: link.site, kind: link.kind, error: err?.raw, status }));
    else setAttempt((a) => a + 1);
  }

  const foot =
    phase === 'ready' ? (
      <button type="button" className="btn big block" disabled={!canDownload || busy} onClick={start}>
        {busy ? <span className="spinner" /> : <Icon name="download" />}
        {tab === 'thumb' ? t('thumb.format') + ' ' + thumbFmt.toUpperCase() : t('sheet.download')}
        {size ? ` · ${bytes(size)}` : tab === 'photos' && !profileQueue ? ` · ${picked.size}` : ''}
      </button>
    ) : phase === 'error' ? (
      <button type="button" className="btn big block plain" onClick={onClose}>
        {t('common.close')}
      </button>
    ) : (
      <button type="button" className="btn big block plain" onClick={onClose}>
        {t('common.cancel')}
      </button>
    );

  return (
    <Sheet onClose={onClose} foot={foot} label={t('sheet.download')}>
      {phase === 'resolving' || phase === 'reading' ? (
        <Loading text={t(phase === 'resolving' ? 'sheet.resolving' : step)} sub={phase === 'reading' && step === 'sheet.reading' ? t('sheet.reading2') : undefined} site={link?.site ?? detect(url ?? '').site} />
      ) : null}

      {phase === 'error' && err ? (
        <div className="stack" style={{ padding: '8px 0 4px' }}>
          {link ? <LinkLine link={link} /> : null}
          <div className="banner bad">
            <Icon name="alert" />
            <div className="grow">
              <b>{url ? t(`err.${err.ex.code}` as Key, { site: site.name }) : t('home.noLink')}</b>
              {err.raw ? (
                <button type="button" className="small muted" onClick={() => setDetails((d) => !d)} style={{ marginTop: 4 }}>
                  {t('act.details')} {details ? '▴' : '▾'}
                </button>
              ) : null}
              {details ? <div className="mono" style={{ marginTop: 6 }}>{err.raw.slice(-1200)}</div> : null}
            </div>
          </div>
          {url && err.ex.fix !== 'none' ? (
            <button type="button" className="btn block" disabled={fixing} onClick={() => fix(err.ex)}>
              {fixing ? <span className="spinner" /> : null}
              {fixing ? t('fix.updating') : t(`fix.${err.ex.fix}` as Key)}
            </button>
          ) : null}
          {url && err.ex.fix !== 'retry' ? (
            <button type="button" className="btn block tonal" onClick={() => setAttempt((a) => a + 1)}>
              <Icon name="refresh" size={18} /> {t('fix.retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === 'ready' && data ? (
        <>
          <div className="media">
            <Thumb src={media?.thumb ?? gallery?.items.find((i) => i.preview)?.preview} dur={media?.duration} icon={gallery ? 'image' : 'video'} />
            <div style={{ minWidth: 0 }}>
              <div className="title">{media?.title ?? gallery?.title}</div>
              <div className="by">
                <SiteAvatar site={data.link.site} />
                <span>{[site.name, media?.author ?? gallery?.author].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="by small">{KIND_LABEL[data.link.kind]}{isPlaylist ? ` · ${t('sheet.items', { n: media!.playlist!.count })}` : ''}</div>
            </div>
          </div>

          {needsLogin(data.link) && !sessions.includes(data.link.site) ? (
            <div className="banner warn">
              <Icon name="user" />
              <div className="grow">{t('sheet.loginHint')}</div>
              <button type="button" className="btn small" onClick={() => onLogin(data.link.site).then(() => setAttempt((a) => a + 1))}>
                {t('fix.login')}
              </button>
            </div>
          ) : null}
          {data.link.listId && !whole && !isPlaylist ? (
            <div className="banner">
              <Icon name="list" />
              <div className="grow">{t('pl.inList')}</div>
              <button type="button" className="btn small tonal" onClick={() => setWhole(true)}>
                {t('pl.whole')}
              </button>
            </div>
          ) : null}
          {media?.isLive ? (
            <div className="banner warn">
              <Icon name="info" />
              <div className="grow">{t('sheet.live')}</div>
            </div>
          ) : null}
          {media?.drm ? (
            <div className="banner bad">
              <Icon name="shield" />
              <div className="grow">{t('err.drm')}</div>
            </div>
          ) : null}

          {tabs.length > 1 ? (
            <div className="tabs" role="tablist">
              {tabs.map((x) => (
                <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>
                  <Icon name={x === 'video' ? 'video' : x === 'audio' ? 'music' : x === 'photos' ? 'photos' : 'image'} size={18} />
                  {t(x === 'thumb' ? 'tab.thumb' : x === 'photos' ? 'tab.photos' : x === 'audio' ? 'tab.audio' : 'tab.video')}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ height: 8 }} />
          )}

          {(isPlaylist || profileQueue) && (tab !== 'thumb') ? (
            <>
              <div className="chips" style={{ marginBottom: 12 }}>
                {(['all', 10, 25, 50] as const)
                  .filter((c) => c === 'all' || (media?.playlist?.count ?? 100) > c)
                  .map((c) => (
                    <button key={String(c)} type="button" className="chip" aria-pressed={count === c} onClick={() => setCount(c)}>
                      {c === 'all' ? t('pl.all') : t('pl.first', { n: c })}
                    </button>
                  ))}
              </div>
              {media?.playlist?.entries.length ? (
                <div className="note" style={{ margin: '0 2px 12px' }}>
                  {media.playlist.entries.slice(0, 4).map((e, i) => (
                    <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {i + 1}. {e.title}
                    </div>
                  ))}
                  {media.playlist.count > 4 ? <div>…</div> : null}
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'video' && isPlaylist ? (
            <>
              <div className="chips" style={{ marginBottom: 8 }}>
                {(['best', ...RES_CHOICES] as const).map((r) => (
                  <button key={r} type="button" className="chip" aria-pressed={plRes === r} onClick={() => setPlRes(r)}>
                    {r === 'best' ? t('set.best') : `${r}p`}
                  </button>
                ))}
              </div>
              <CompatLine compat={compat} setCompat={setCompat} />
            </>
          ) : null}

          {tab === 'video' && !isPlaylist && media ? (
            <>
              <div className="opts" role="radiogroup">
                {media.video.map((o) => (
                  <VideoRow key={o.key} o={o} on={o.key === vOpt?.key} pick={() => setVKey(o.key)} />
                ))}
              </div>
              <CompatLine compat={compat} setCompat={setCompat} />
            </>
          ) : null}

          {tab === 'audio' ? (
            <>
              <div className="opts" role="radiogroup">
                {(media?.audio.length ? media.audio : defaultAudio()).map((o) => (
                  <button key={o.key} type="button" className="opt" role="radio" aria-checked={aKey === o.key} onClick={() => setAKey(o.key)}>
                    <span className="radio" />
                    <span className="grow">
                      <span className="l">
                        {o.key === 'original' ? t('audio.original') : o.key === 'm4a' ? t('audio.m4a') : t('audio.mp3', { kbps: o.key.split('-')[1] })}
                        {o.key === 'original' ? <span className="tag brand">HQ</span> : null}
                      </span>
                      <span className="s">
                        {o.key === 'original' ? t('audio.originalSub') : o.key === 'm4a' ? t('audio.forOld') : o.converted ? t('audio.converted') : ''}
                      </span>
                    </span>
                    {!isPlaylist && o.size ? <span className="size">{o.approx ? '≈ ' : ''}{bytes(o.size)}</span> : null}
                  </button>
                ))}
              </div>
              {media?.sourceKbps ? <p className="note">{t('audio.source', { kbps: media.sourceKbps })}</p> : null}
              <button type="button" className="toggle-line" onClick={() => setCover(!cover)}>
                <span className="grow">{t('audio.cover')}</span>
                <Switch on={cover} onChange={setCover} />
              </button>
            </>
          ) : null}

          {tab === 'photos' && gallery ? (
            profileQueue ? (
              <p className="note">{t('sheet.items', { n: gallery.queued })}</p>
            ) : (
              <>
                <div className="section-title" style={{ margin: '0 2px 10px' }}>
                  <span>{t('photos.count', { n: picked.size, total: gallery.items.length })}</span>
                  <button type="button" onClick={() => setPicked(picked.size === gallery.items.length ? new Set() : new Set(gallery.items.map((i) => i.num)))}>
                    {picked.size === gallery.items.length ? t('photos.none') : t('photos.all')}
                  </button>
                </div>
                <div className="photos">
                  {gallery.items.map((it) => {
                    const on = picked.has(it.num);
                    return (
                      <button
                        key={it.num}
                        type="button"
                        className="photo"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => {
                          const next = new Set(picked);
                          if (on) next.delete(it.num);
                          else next.add(it.num);
                          setPicked(next);
                        }}
                      >
                        {it.preview ? <img src={it.preview} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                        <span className="check">{on ? <Icon name="check" size={14} /> : null}</span>
                        {it.isVideo ? (
                          <span className="vid">
                            <Icon name="play" size={18} fill />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            )
          ) : null}

          {tab === 'thumb' ? <ThumbTab thumbs={thumbs} thumbKey={thumbKey} setThumbKey={setThumbKey} fmt={thumbFmt} setFmt={setThumbFmt} square={square} setSquare={setSquare} /> : null}
        </>
      ) : null}
    </Sheet>
  );
}

function CompatLine({ compat, setCompat }: { compat: boolean; setCompat: (v: boolean) => void }) {
  const t = useT();
  return (
    <button type="button" className="toggle-line" onClick={() => setCompat(!compat)}>
      <span className="grow">
        {t('sheet.compat')}
        {!compat ? <small>{t('sheet.compatOff')}</small> : null}
      </span>
      <Switch on={compat} onChange={setCompat} />
    </button>
  );
}

function VideoRow({ o, on, pick }: { o: VideoOption; on: boolean; pick: () => void }) {
  return (
    <button type="button" className="opt" role="radio" aria-checked={on} onClick={pick}>
      <span className="radio" />
      <span className="grow">
        <span className="l">
          {o.label}
          {o.res >= 2160 ? <span className="tag brand">UHD</span> : o.res >= 1080 ? <span className="tag">HD</span> : null}
        </span>
        <span className="s">{[o.codec, o.container].filter(Boolean).join(' · ')}</span>
      </span>
      {o.size ? (
        <span className="size">
          {o.approx ? '≈ ' : ''}
          {bytes(o.size)}
        </span>
      ) : null}
    </button>
  );
}

function ThumbTab(p: {
  thumbs: ReturnType<typeof thumbChoices>;
  thumbKey?: string;
  setThumbKey: (k: string) => void;
  fmt: ImageFormat;
  setFmt: (f: ImageFormat) => void;
  square: boolean;
  setSquare: (v: boolean) => void;
}) {
  const t = useT();
  const choice = p.thumbs.find((c) => c.key === p.thumbKey) ?? p.thumbs[0];
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [choice?.key]);
  if (!choice) return <p className="note">{t('thumb.missing')}</p>;
  return (
    <>
      <div className={`thumbpreview${p.square ? ' square' : ''}`}>
        {choice.urls[idx] ? (
          <img src={choice.urls[idx]} alt="" referrerPolicy="no-referrer" onError={() => setIdx((i) => (i + 1 < choice.urls.length ? i + 1 : i))} />
        ) : null}
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {p.thumbs.map((c) => (
          <button key={c.key} type="button" className="chip" aria-pressed={c.key === choice.key} onClick={() => p.setThumbKey(c.key)}>
            {c.label}
            {c.width && c.height && c.label !== `${c.width}×${c.height}` ? <span className="muted small">{c.width}×{c.height}</span> : null}
          </button>
        ))}
      </div>
      <Seg
        value={p.fmt}
        options={(['jpg', 'png', 'webp', 'original'] as const).map((f) => ({ id: f, label: f === 'original' ? 'Original' : f.toUpperCase() }))}
        onChange={p.setFmt}
      />
      <button type="button" className="toggle-line" onClick={() => p.setSquare(!p.square)}>
        <span className="grow">{t('thumb.square')}</span>
        <Switch on={p.square} onChange={p.setSquare} />
      </button>
    </>
  );
}

function Loading({ text, sub, site }: { text: string; sub?: string; site: string }) {
  return (
    <div style={{ padding: '6px 0 10px' }} aria-busy="true">
      <div className="media">
        <div className="thumb skel" />
        <div className="stack" style={{ gap: 8, paddingTop: 4 }}>
          <div className="skel" style={{ height: 14, width: '92%' }} />
          <div className="skel" style={{ height: 14, width: '70%' }} />
          <div className="skel" style={{ height: 12, width: '40%' }} />
        </div>
      </div>
      <div className="steps">
        <SiteAvatar site={site} />
        <span className="grow">
          <b style={{ color: 'var(--text)' }}>{text}</b>
          {sub ? <span className="muted small"> · {sub}</span> : null}
        </span>
      </div>
      <Progress value={-1} />
      <div className="opts" style={{ marginTop: 14 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skel" style={{ height: 56, borderRadius: 16 }} />
        ))}
      </div>
    </div>
  );
}

function LinkLine({ link }: { link: Link }) {
  return (
    <div className="by" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
      <SiteAvatar site={link.site} />
      <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{link.url}</span>
    </div>
  );
}

/** Several links at once: download them all with the default video or audio settings. */
function MultiSheet({ urls, settings, onClose, onAdded, onError }: Props & { urls: string[] }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const links = useMemo(() => urls.map((u) => detect(u)), [urls]);
  async function all(mode: 'video' | 'audio') {
    setBusy(true);
    try {
      for (const l of links) {
        const spec = mode === 'video' ? videoSpec(settings) : audioSpec(settings);
        await engine.enqueue(buildRequest({ link: l, engine: 'ytdlp', spec, title: l.url }));
      }
      onAdded(undefined, links.length);
    } catch (e) {
      onError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      onClose={onClose}
      label={t('sheet.download')}
      foot={
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn big tonal" style={{ flex: 1 }} disabled={busy} onClick={() => all('audio')}>
            <Icon name="music" /> {t('tab.audio')}
          </button>
          <button type="button" className="btn big" style={{ flex: 1 }} disabled={busy} onClick={() => all('video')}>
            <Icon name="video" /> {t('tab.video')}
          </button>
        </div>
      }
    >
      <h3>{t('sheet.items', { n: links.length })}</h3>
      <div className="stack">
        {links.map((l) => (
          <LinkLine key={l.url} link={l} />
        ))}
      </div>
    </Sheet>
  );
}

// ---------- helpers ----------

function parseResult(r: InfoResult, link: Link): Loaded | undefined {
  const json = parseJson(r.json);
  if (r.engine === 'gallerydl') {
    const g = parseGallery(json);
    if (g.items.length || g.queued) return { link, engine: 'gallerydl', gallery: g, ms: r.ms };
    if (g.error) throw new Error(g.error);
    return undefined;
  }
  const info = json as YtInfo | undefined;
  if (!info || typeof info !== 'object') return undefined;
  const hasMedia = !!info.formats?.length || !!info.url || !!info.entries?.length;
  return hasMedia ? { link, engine: 'ytdlp', raw: info, ms: r.ms } : undefined;
}

function pickVideo(opts: VideoOption[], s: Settings): string | undefined {
  if (!opts.length) return undefined;
  if (s.rememberChoice && s.lastVideoKey) {
    const hit = opts.find((o) => o.label === s.lastVideoKey);
    if (hit) return hit.key;
  }
  const cap = s.videoQuality === 'best' ? Infinity : s.videoQuality;
  return (opts.find((o) => o.res <= cap) ?? opts[opts.length - 1]).key;
}

function pickAudio(s: Settings): AudioOption['key'] {
  if (s.rememberChoice && s.lastAudioKey) return s.lastAudioKey as AudioOption['key'];
  if (s.audioFormat === 'original' || s.audioFormat === 'opus') return 'original';
  if (s.audioFormat === 'm4a') return 'm4a';
  return s.mp3Bitrate === 128 ? 'mp3-128' : s.mp3Bitrate === 192 ? 'mp3-192' : 'mp3-320';
}

function defaultAudio(): AudioOption[] {
  return [
    { key: 'original', approx: true, converted: false },
    { key: 'mp3-320', approx: true, converted: true },
    { key: 'mp3-192', approx: true, converted: true },
    { key: 'mp3-128', approx: true, converted: true },
    { key: 'm4a', approx: true, converted: true },
  ];
}

/** [1,2,3,5,7,8] → "1-3,5,7-8" (gallery-dl --range). */
export function compressRange(nums: number[]): string {
  const s = [...nums].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j;
  }
  return parts.join(',');
}
