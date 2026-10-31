import { useMemo, useState } from 'react';
import { displayHost, type TabInfo } from '../../core/browser.ts';
import { bytes } from '../../core/format.ts';
import { foundMeta, isDownloaded, matches, nameFromUrl, qualityLabel, sortFound, type FinderFilter, type Found } from '../../core/finder.ts';
import { isMusic } from '../../core/settings.ts';
import { KIND_LABEL, siteInfo } from '../../core/sites.ts';
import { useT } from '../../i18n.ts';
import { Icon, type IconName } from '../Icon.tsx';
import { Sheet, Thumb } from '../common.tsx';

interface Props {
  tab: TabInfo;
  page?: Found;
  view?: Found;
  items: Found[];
  downloaded: Set<string>;
  /** This page: [audio] = MP3. */
  onPage: (audio: boolean) => void;
  /** The full download sheet for a supported link (qualities, photos, playlists…). */
  onLink: (url: string) => void;
  /** One tap: a supported link with your usual quality. */
  onQuick: (f: Found) => void;
  /** A file or stream found on the page. */
  onMedia: (f: Found, o?: { height?: number; audio?: boolean }) => void;
  onMany: (list: Found[]) => void;
  onClose: () => void;
}

const KIND_ICON: Record<Found['kind'], IconName> = { video: 'video', audio: 'music', image: 'image', file: 'download' };

function titleOf(f: Found): string {
  if (f.title) return f.title;
  if (f.linkKind && f.site) return `${siteInfo(f.site).name} · ${KIND_LABEL[f.linkKind]}`;
  return nameFromUrl(f.url) || displayHost(f.url);
}

const isLink = (f: Found) => f.source === 'link' || f.source === 'page' || !!f.linkKind;

/** What the page has to download: the page itself, what's on screen, links, files and photos. */
export function FinderSheet(p: Props) {
  const t = useT();
  const [filter, setFilter] = useState<FinderFilter>('all');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string>();

  const list = useMemo(() => sortFound(p.items.filter((f) => f.key !== p.page?.key && f.key !== p.view?.key)), [p.items, p.page, p.view]);
  const shown = list.filter((f) => matches(f, filter));
  const photos = list.filter((f) => f.kind === 'image' && !f.drm);
  const count = (fl: FinderFilter) => list.filter((f) => matches(f, fl)).length;
  const filters: { id: FinderFilter; label: string }[] = [
    { id: 'all', label: t('fd.all') },
    { id: 'video', label: t('fd.videos') },
    { id: 'audio', label: t('fd.audio') },
    { id: 'image', label: t('fd.photos') },
  ];

  const download = (f: Found) => {
    if (isLink(f)) p.onQuick(f);
    else p.onMedia(f);
  };
  const tap = (f: Found) => {
    if (f.drm) return;
    if (selecting) {
      const next = new Set(picked);
      if (next.has(f.key)) next.delete(f.key);
      else next.add(f.key);
      setPicked(next);
      return;
    }
    if (isLink(f)) p.onLink(f.url);
    else if (f.variants && f.variants.length > 1) setOpen(open === f.key ? undefined : f.key);
    else p.onMedia(f);
  };

  const row = (f: Found, label?: string) => {
    const done = isDownloaded(f, p.downloaded);
    return (
      <div key={f.key} className="fd-item">
        <div className={`fd-row${f.drm ? ' drm' : ''}`}>
          <button type="button" className="fd-main" onClick={() => tap(f)}>
            <Thumb srcs={[f.thumb, f.kind === 'image' ? f.url : undefined].filter((x): x is string => !!x)} icon={KIND_ICON[f.kind]} square={f.kind === 'image'} />
            <span className="grow">
              {label ? <span className="fd-tag">{label}</span> : null}
              <span className="title">{titleOf(f)}</span>
              <span className="sub">{f.drm ? t('fd.drm') : foundMeta(f) || displayHost(f.url)}</span>
            </span>
          </button>
          {f.drm ? (
            <span className="fd-state" aria-label={t('fd.drm')}>
              <Icon name="lock" size={18} />
            </span>
          ) : selecting ? (
            <span className={`fd-check${picked.has(f.key) ? ' on' : ''}`} aria-hidden>
              <Icon name="check" size={16} />
            </span>
          ) : done ? (
            <span className="fd-state done" aria-label={t('fd.downloaded')}>
              <Icon name="checkCircle" size={20} />
            </span>
          ) : (
            <button type="button" className="fd-dl" aria-label={t('sheet.download')} onClick={() => download(f)}>
              <Icon name="download" size={20} />
            </button>
          )}
        </div>
        {open === f.key && f.variants ? (
          <div className="chips fd-q" aria-label={t('fd.quality')}>
            {f.variants.map((v, i) => (
              <button key={i} type="button" className="chip" onClick={() => p.onMedia(f, { height: v.height })}>
                {qualityLabel(v.height) || `${Math.round((v.bandwidth ?? 0) / 1000)} kbps`}
                {v.size ? <small> · {bytes(v.size)}</small> : null}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => p.onMedia(f, { audio: true })}>
              <Icon name="music" size={14} /> {t('fd.mp3')}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const page = p.page;
  const empty = !page && !p.view && !list.length;
  const chosen = list.filter((f) => picked.has(f.key));
  return (
    <Sheet
      label={t('fd.title')}
      onClose={p.onClose}
      foot={
        selecting ? (
          <button type="button" className="btn block" disabled={!chosen.length} onClick={() => p.onMany(chosen)}>
            <Icon name="download" size={18} /> {t('fd.downloadN', { n: chosen.length })}
          </button>
        ) : undefined
      }
    >
      <div className="fd-head">
        <h3>{t('fd.title')}</h3>
        <span className="muted small grow">{displayHost(p.tab.url)}</span>
        {list.length ? (
          <button
            type="button"
            className="btn small tonal"
            onClick={() => {
              setSelecting(!selecting);
              setPicked(new Set());
            }}
          >
            {selecting ? t('common.cancel') : t('fd.select')}
          </button>
        ) : null}
      </div>

      {page ? (
        <div className="fd-page">
          <Thumb srcs={[page.thumb ?? p.tab.image].filter((x): x is string => !!x)} icon={KIND_ICON[page.kind]} />
          <div className="fd-page-text">
            <b>{page.title || titleOf(page)}</b>
            <span className="muted small">
              {siteInfo(page.site ?? 'other').name}
              {page.linkKind ? ` · ${KIND_LABEL[page.linkKind]}` : ''}
              {isDownloaded(page, p.downloaded) ? ` · ✓ ${t('fd.downloaded')}` : ''}
            </span>
          </div>
          <div className="fd-page-btns">
            {page.site && isMusic({ site: page.site, kind: page.linkKind ?? 'unknown' }) ? null : (
              <button type="button" className="btn" onClick={() => p.onPage(false)}>
                <Icon name={page.linkKind === 'post' ? 'image' : 'video'} size={18} /> {page.linkKind === 'post' ? t('fd.photos') : t('fd.video')}
              </button>
            )}
            <button type="button" className="btn tonal" onClick={() => p.onPage(true)}>
              <Icon name="music" size={18} /> {t('fd.mp3')}
            </button>
            <button type="button" className="btn ghost" onClick={() => p.onLink(page.url)}>
              {t('fd.more')}
            </button>
          </div>
        </div>
      ) : null}

      {p.view && p.view.key !== page?.key ? row(p.view, t('fd.onScreen')) : null}

      {list.length ? (
        <div className="chips fd-filters">
          {filters.map((f) => {
            const n = count(f.id);
            if (f.id !== 'all' && !n) return null;
            return (
              <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} {n ? <small>{n}</small> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {shown.map((f) => row(f))}

      {photos.length > 1 && (filter === 'all' || filter === 'image') && !selecting ? (
        <button type="button" className="btn tonal block fd-all" onClick={() => p.onMany(photos)}>
          <Icon name="photos" size={18} /> {t('fd.allPhotos', { n: photos.length })}
        </button>
      ) : null}

      {empty ? (
        <div className="empty">
          <div className="art">
            <Icon name="search" size={40} />
          </div>
          <b>{t('fd.empty')}</b>
          <span>{t('fd.emptySub')}</span>
        </div>
      ) : null}

      {!page ? (
        <button type="button" className="btn ghost block fd-checkpage" onClick={() => p.onLink(p.tab.url)}>
          <Icon name="sparkle" size={18} /> {t('fd.check')}
        </button>
      ) : null}
    </Sheet>
  );
}
