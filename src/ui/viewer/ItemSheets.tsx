import { useEffect, useState } from 'react';
import { bytes, duration } from '../../core/format.ts';
import { resLabel, type MediaItem } from '../../core/media.ts';
import type { EditSpec } from '../../core/types.ts';
import { siteInfo } from '../../core/sites.ts';
import type { KaraokeStatus } from '../../engine/types.ts';
import { useT } from '../../i18n.ts';
import { Icon, type IconName } from '../Icon.tsx';
import { Seg, Sheet, SiteAvatar, Thumb } from '../common.tsx';

interface MenuProps {
  item: MediaItem;
  /** The karaoke copy (or the original) of this item, to play instead. */
  alt?: MediaItem;
  /** Already open in the player/viewer: no "Play" row. */
  inPlayer?: boolean;
  onClose: () => void;
  onOpen: (it: MediaItem) => void;
  onOpenWith: (it: MediaItem) => void;
  onShare: (it: MediaItem) => void;
  onKaraoke: (it: MediaItem) => void;
  onInfo: (it: MediaItem) => void;
  onSwap: (to: MediaItem) => void;
  onSource: (it: MediaItem) => void;
  onCopyLink: (it: MediaItem) => void;
  onDelete: (it: MediaItem) => void;
  /** Played from a link: download it, share its link. */
  onDownloadLink?: (it: MediaItem) => void;
  onShareLink?: (it: MediaItem) => void;
}

/** What you can do with one video, song or photo. */
export function ItemMenu(p: MenuProps) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const it = p.item;
  const row = (icon: IconName, label: string, run: () => void, danger = false) => (
    <button
      type="button"
      className={`row${danger ? ' danger' : ''}`}
      onClick={() => {
        run();
        p.onClose();
      }}
    >
      <span className="ic">
        <Icon name={icon} />
      </span>
      <span className="grow title">{label}</span>
    </button>
  );
  return (
    <Sheet onClose={p.onClose} label={it.title}>
      <div className="media" style={{ gridTemplateColumns: it.kind === 'video' ? '112px 1fr' : '72px 1fr' }}>
        <Thumb srcs={it.thumbs} icon={it.kind === 'video' ? 'video' : it.kind === 'audio' ? 'music' : 'image'} square={it.kind !== 'video'} />
        <div style={{ minWidth: 0 }}>
          <div className="title">{it.title}</div>
          <div className="by">
            <SiteAvatar site={it.site} />
            <span>{[it.dur ? duration(it.dur) : '', bytes(it.file.size)].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
      </div>
      {it.stream ? (
        <div className="card group" style={{ marginBottom: 12 }}>
          {p.onDownloadLink ? row('download', t('sheet.download'), () => p.onDownloadLink!(it)) : null}
          {p.onShareLink ? row('share', t('cx.shareLink'), () => p.onShareLink!(it)) : null}
          {row('copy', t('act.copyLink'), () => p.onCopyLink(it))}
          {row('globe', t('yt.openPage'), () => p.onSource(it))}
        </div>
      ) : confirm ? (
        <div className="card group" style={{ marginBottom: 12 }}>
          <div className="row">
            <span className="grow">
              <span className="title">{t('lib.deleteQ', { n: 1 })}</span>
              <span className="sub">{t('lib.deleteSub')}</span>
            </span>
          </div>
          {row('trash', t('act.delete'), () => p.onDelete(it), true)}
          <button type="button" className="row" onClick={() => setConfirm(false)}>
            <span className="ic">
              <Icon name="close" />
            </span>
            <span className="grow title">{t('common.cancel')}</span>
          </button>
        </div>
      ) : (
        <>
          <div className="card group" style={{ marginBottom: 12 }}>
            {!p.inPlayer ? row(it.kind === 'image' ? 'image' : 'play', it.kind === 'image' ? t('act.view') : t('act.play'), () => p.onOpen(it)) : null}
            {p.alt ? row(p.alt.stem === 'music' ? 'micOff' : 'mic', p.alt.stem === 'music' ? t('vp.karaokeVersion') : t('vp.withVocals'), () => p.onSwap(p.alt!)) : null}
            {row('openWith', t('act.openWith'), () => p.onOpenWith(it))}
            {row('share', t('act.share'), () => p.onShare(it))}
            {it.kind !== 'image' && !it.stem ? row('micOff', t('act.karaoke'), () => p.onKaraoke(it)) : null}
            {row('info', t('act.info'), () => p.onInfo(it))}
            {row('external', t('act.source'), () => p.onSource(it))}
            {row('copy', t('act.copyLink'), () => p.onCopyLink(it))}
          </div>
          <div className="card group" style={{ marginBottom: 8 }}>
            <button type="button" className="row danger" onClick={() => setConfirm(true)}>
              <span className="ic">
                <Icon name="trash" />
              </span>
              <span className="grow title">{t('act.delete')}</span>
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

const FOLDER: Record<MediaItem['kind'], string> = { video: 'Movies/OnePlace', audio: 'Music/OnePlace', image: 'Pictures/OnePlace' };

export function InfoSheet({ item, onClose, onSource }: { item: MediaItem; onClose: () => void; onSource: (it: MediaItem) => void }) {
  const t = useT();
  const f = item.file;
  const res = item.w && item.h ? `${item.w} × ${item.h}${resLabel(item.w, item.h) ? ` (${resLabel(item.w, item.h)})` : ''}` : '';
  const rows: [string, string][] = [
    [t('info.name'), f.name],
    [t('info.size'), bytes(f.size)],
    [t('info.type'), f.mime],
    [t('info.res'), res],
    [t('info.length'), item.dur ? duration(item.dur) : ''],
    [t('info.from'), siteInfo(item.site).name],
    [t('info.date'), new Date(item.date).toLocaleString()],
    [t('info.folder'), FOLDER[item.kind]],
  ];
  return (
    <Sheet onClose={onClose} label={t('act.info')}>
      <h3>{t('act.info')}</h3>
      <div className="card group info" style={{ marginBottom: 12 }}>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="row">
              <span className="info-k">{k}</span>
              <span className="info-v">{v}</span>
            </div>
          ))}
        <button type="button" className="row" onClick={() => onSource(item)}>
          <span className="info-k">{t('act.source')}</span>
          <span className="info-v link">{item.url}</span>
        </button>
      </div>
    </Sheet>
  );
}

interface KaraokeProps {
  item: MediaItem;
  status?: KaraokeStatus;
  onClose: () => void;
  onStart: (keep: EditSpec['keep'], as: EditSpec['as']) => void;
}

/** "Remove vocals": what to keep, video or MP3, and the one-time download explained before it happens. */
export function KaraokeSheet({ item, status, onClose, onStart }: KaraokeProps) {
  const t = useT();
  const [keep, setKeep] = useState<EditSpec['keep']>('music');
  const [as, setAs] = useState<EditSpec['as']>('video');
  const [cellular, setCellular] = useState(false);
  useEffect(() => {
    const c = (navigator as Navigator & { connection?: { type?: string } }).connection;
    setCellular(c?.type === 'cellular');
  }, []);
  const opts: { id: EditSpec['keep']; label: string; sub: string; icon: IconName }[] = [
    { id: 'music', label: t('kar.music'), sub: t('kar.musicSub'), icon: 'micOff' },
    { id: 'vocals', label: t('kar.vocals'), sub: t('kar.vocalsSub'), icon: 'mic' },
    { id: 'both', label: t('kar.both'), sub: t('kar.bothSub'), icon: 'photos' },
  ];
  const minutes = item.dur ? Math.max(1, Math.round((item.dur * 0.3) / 60)) : 0;
  return (
    <Sheet
      onClose={onClose}
      label={t('kar.title')}
      foot={
        <button type="button" className="btn block big" onClick={() => onStart(keep, as)}>
          <Icon name="micOff" /> {t('kar.title')}
        </button>
      }
    >
      <h3>{t('kar.title')}</h3>
      <p className="muted" style={{ margin: '-6px 0 12px' }}>
        {t('kar.sub')}
      </p>
      <div className="media" style={{ gridTemplateColumns: '64px 1fr', marginBottom: 12 }}>
        <Thumb srcs={item.thumbs} icon={item.kind === 'video' ? 'video' : 'music'} square />
        <div style={{ minWidth: 0 }}>
          <div className="title">{item.title}</div>
          <div className="by">
            <SiteAvatar site={item.site} />
            <span>{item.dur ? duration(item.dur) : ''}</span>
          </div>
        </div>
      </div>
      <div className="section-title" style={{ margin: '8px 2px 8px' }}>
        <span>{t('kar.keep')}</span>
      </div>
      <div className="opts">
        {opts.map((o) => (
          <button key={o.id} type="button" className="opt" role="radio" aria-checked={keep === o.id} onClick={() => setKeep(o.id)}>
            <span className="radio" />
            <span className="grow">
              <span className="l">{o.label}</span>
              <span className="s">{o.sub}</span>
            </span>
            <Icon name={o.icon} size={20} />
          </button>
        ))}
      </div>
      {item.kind === 'video' ? (
        <>
          <div className="section-title" style={{ margin: '16px 2px 8px' }}>
            <span>{t('kar.as')}</span>
          </div>
          <Seg
            value={as}
            options={[
              { id: 'video', label: t('tab.video') },
              { id: 'audio', label: 'MP3' },
            ]}
            onChange={setAs}
          />
        </>
      ) : null}
      {status && !status.installed ? (
        <div className="banner" style={{ marginTop: 14 }}>
          <Icon name="download" />
          <div className="grow small">
            {t('kar.firstTime', { mb: Math.round(status.download / 1_000_000) })}
            {cellular ? <b style={{ marginTop: 4 }}>{t('kar.wifi')}</b> : null}
          </div>
        </div>
      ) : null}
      <p className="note">
        {minutes ? `${t('kar.time', { n: minutes })} ` : ''}
        {t('kar.quality')}
      </p>
    </Sheet>
  );
}
