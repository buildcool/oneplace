import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bytes, duration } from '../core/format.ts';
import {
  groupByDate,
  isVertical,
  mediaItems,
  resLabel,
  searchItems,
  sortItems,
  watched,
  type DateKey,
  type MediaItem,
  type MediaKind,
  type Positions,
  type SortKey,
} from '../core/media.ts';
import { siteInfo } from '../core/sites.ts';
import type { Job } from '../core/types.ts';
import { useT, type T } from '../i18n.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Empty, Sheet, SiteAvatar, Thumb, usePress } from './common.tsx';

type View = 'all' | MediaKind;

interface Props {
  jobs: Job[];
  lang: string;
  sort: SortKey;
  positions: Positions;
  /** The Library item that is playing now (for the moving bars). */
  playingKey?: string;
  onSort: (s: SortKey) => void;
  onOpen: (item: MediaItem, list: MediaItem[]) => void;
  onPlayAll: (list: MediaItem[], shuffle: boolean) => void;
  onMenu: (item: MediaItem) => void;
  onShare: (items: MediaItem[]) => void;
  onDelete: (items: MediaItem[]) => void;
  /** Library opened: look for files deleted in other apps. */
  onCheck: () => void;
}

const KIND_ICON: Record<MediaKind, IconName> = { video: 'video', audio: 'music', image: 'image' };
const SORTS: SortKey[] = ['new', 'old', 'big', 'long', 'name'];

export function dateLabel(key: DateKey, t: T, lang: string): string {
  if (key === 'today') return t('lib.today');
  if (key === 'yesterday') return t('lib.yesterday');
  if (key === 'week') return t('lib.week');
  const [y, m] = key.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions = { month: 'long', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) };
  return new Date(y!, m!, 1).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', opts);
}

export function Library(p: Props) {
  const t = useT();
  const items = useMemo(() => mediaItems(p.jobs), [p.jobs]);
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const selecting = selected.size > 0;
  const mainRef = useRef<HTMLElement>(null);

  const { onCheck } = p;
  useEffect(() => onCheck(), [onCheck]);

  const counts = useMemo(() => {
    const c = { all: items.length, video: 0, audio: 0, image: 0 };
    for (const it of items) c[it.kind]++;
    return c;
  }, [items]);
  const list = useMemo(() => {
    const kind = view === 'all' ? items : items.filter((it) => it.kind === view);
    return sortItems(searchItems(kind, query), p.sort);
  }, [items, view, query, p.sort]);
  const totalSize = useMemo(() => items.reduce((n, it) => n + (it.file.size || 0), 0), [items]);

  const toggle = (it: MediaItem) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(it.key)) next.delete(it.key);
      else next.add(it.key);
      return next;
    });
  const pick = (it: MediaItem, from: MediaItem[]) => (selecting ? toggle(it) : p.onOpen(it, from));
  const chosen = () => items.filter((it) => selected.has(it.key));
  const go = (v: View) => {
    setView(v);
    mainRef.current?.scrollIntoView({ block: 'start' });
    window.scrollTo({ top: 0 });
  };

  const tile = { selected, selecting, positions: p.positions, playingKey: p.playingKey, onPick: pick, onLong: toggle, onMenu: p.onMenu };

  let content;
  if (!items.length) {
    content = <Empty icon="grid" title={t('lib.empty')} sub={t('lib.emptyHint')} />;
  } else if (query && !list.length) {
    content = <Empty icon="search" title={t('lib.noResults', { q: query })} />;
  } else if (view === 'all' && !query) {
    content = <Overview items={items} t={t} go={go} onPlayAll={p.onPlayAll} tile={tile} />;
  } else if (!list.length) {
    const empty = view === 'video' ? 'lib.emptyVideo' : view === 'audio' ? 'lib.emptyMusic' : 'lib.emptyPhotos';
    content = <Empty icon={KIND_ICON[view as MediaKind] ?? 'grid'} title={t(empty)} sub={t('lib.emptyHint')} />;
  } else if (view === 'audio') {
    content = (
      <>
        <div className="songs-head">
          <button type="button" className="btn" onClick={() => p.onPlayAll(list, false)}>
            <Icon name="play" fill size={18} /> {t('lib.playAll')}
          </button>
          <button type="button" className="btn tonal" onClick={() => p.onPlayAll(list, true)}>
            <Icon name="shuffle" size={18} /> {t('lib.shuffle')}
          </button>
        </div>
        <div className="card songs">
          {list.map((it) => (
            <SongRow key={it.key} it={it} list={list} {...tile} />
          ))}
        </div>
      </>
    );
  } else if (view === 'all') {
    content = (
      <div className="card songs">
        {list.map((it) => (
          <SongRow key={it.key} it={it} list={list} {...tile} />
        ))}
      </div>
    );
  } else {
    const groups = p.sort === 'new' || p.sort === 'old' ? groupByDate(list) : [{ key: '' as DateKey, items: list }];
    content = groups.map((g) => (
      <section key={g.key || 'all'}>
        {g.key ? <h3 className="date-head">{dateLabel(g.key, t, p.lang)}</h3> : null}
        <div className={view === 'image' ? 'pgrid' : 'vgrid'}>
          {g.items.map((it) => (view === 'image' ? <PhotoTile key={it.key} it={it} list={list} {...tile} /> : <VideoCard key={it.key} it={it} list={list} {...tile} />))}
        </div>
      </section>
    ));
  }

  return (
    <>
      <header className="topbar lib-top">
        {selecting ? (
          <>
            <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={() => setSelected(new Set())}>
              <Icon name="close" />
            </button>
            <h1>{t('lib.selected', { n: selected.size })}</h1>
            <button type="button" className="iconbtn" aria-label={t('lib.selectAll')} onClick={() => setSelected(new Set((list.length ? list : items).map((it) => it.key)))}>
              <Icon name="selectAll" />
            </button>
            <button type="button" className="iconbtn" aria-label={t('act.share')} onClick={() => p.onShare(chosen())}>
              <Icon name="share" />
            </button>
            <button type="button" className="iconbtn danger" aria-label={t('act.delete')} onClick={() => setConfirm(true)}>
              <Icon name="trash" />
            </button>
          </>
        ) : searching ? (
          <>
            <button
              type="button"
              className="iconbtn"
              aria-label={t('common.back')}
              onClick={() => {
                setSearching(false);
                setQuery('');
              }}
            >
              <Icon name="back" />
            </button>
            <input className="lib-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('lib.search')} aria-label={t('lib.search')} enterKeyHint="search" />
            {query ? (
              <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={() => setQuery('')}>
                <Icon name="close" />
              </button>
            ) : null}
          </>
        ) : (
          <>
            <h1>{t('tab.library')}</h1>
            {items.length ? (
              <>
                <button type="button" className="iconbtn" aria-label={t('lib.search')} onClick={() => setSearching(true)}>
                  <Icon name="search" />
                </button>
                <button type="button" className="iconbtn" aria-label={t('lib.sort')} onClick={() => setSortOpen(true)}>
                  <Icon name="sort" />
                </button>
              </>
            ) : null}
          </>
        )}
      </header>
      <main className="page lib" ref={mainRef}>
        {items.length && !searching && !selecting ? <p className="lib-stats">{t('lib.stats', { n: items.length, size: bytes(totalSize) })}</p> : null}
        {items.length ? (
          <div className="chips lib-chips" role="tablist">
            {(['all', 'video', 'audio', 'image'] as View[]).map((v) => (
              <button key={v} type="button" role="tab" className="chip" aria-pressed={view === v} aria-selected={view === v} onClick={() => go(v)}>
                {v !== 'all' ? <Icon name={KIND_ICON[v as MediaKind]} size={16} /> : null}
                {t(v === 'all' ? 'lib.all' : v === 'video' ? 'lib.videos' : v === 'audio' ? 'lib.music' : 'lib.photos')}
                <span className="count">{counts[v]}</span>
              </button>
            ))}
          </div>
        ) : null}
        {content}
        {items.length ? <p className="note lib-where">{t('lib.where')}</p> : null}
      </main>

      {sortOpen ? (
        <Sheet onClose={() => setSortOpen(false)} label={t('lib.sort')}>
          <h3>{t('lib.sort')}</h3>
          <div className="opts" style={{ marginBottom: 12 }}>
            {SORTS.map((k) => (
              <button
                key={k}
                type="button"
                className="opt"
                role="radio"
                aria-checked={p.sort === k}
                onClick={() => {
                  p.onSort(k);
                  setSortOpen(false);
                }}
              >
                <span className="radio" />
                <span className="grow l">{t(`sort.${k}`)}</span>
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}

      {confirm ? (
        <Sheet onClose={() => setConfirm(false)} label={t('act.delete')}>
          <h3>{t('lib.deleteQ', { n: selected.size })}</h3>
          <p className="muted" style={{ marginTop: -4 }}>
            {t('lib.deleteSub')}
          </p>
          <div className="stack" style={{ margin: '16px 0 12px' }}>
            <button
              type="button"
              className="btn block danger big"
              onClick={() => {
                p.onDelete(chosen());
                setSelected(new Set());
                setConfirm(false);
              }}
            >
              <Icon name="trash" /> {t('act.delete')}
            </button>
            <button type="button" className="btn block plain" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

// ---------- "All": shelves ----------

interface TileProps {
  selected: Set<string>;
  selecting: boolean;
  positions: Positions;
  playingKey?: string;
  onPick: (it: MediaItem, list: MediaItem[]) => void;
  onLong: (it: MediaItem) => void;
  onMenu: (it: MediaItem) => void;
}

function Overview({ items, t, go, onPlayAll, tile }: { items: MediaItem[]; t: T; go: (v: View) => void; onPlayAll: (l: MediaItem[], shuffle: boolean) => void; tile: TileProps }) {
  const videos = items.filter((it) => it.kind === 'video');
  const wide = videos.filter((it) => !isVertical(it));
  const tall = videos.filter((it) => isVertical(it));
  const songs = items.filter((it) => it.kind === 'audio');
  const photos = items.filter((it) => it.kind === 'image');
  const going = items
    .filter((it) => it.kind !== 'image' && watched(tile.positions, it.file.uri) > 0.01)
    .sort((a, b) => (tile.positions[b.file.uri]?.[2] ?? 0) - (tile.positions[a.file.uri]?.[2] ?? 0))
    .slice(0, 10);
  const latest = items.slice(0, 6);
  return (
    <>
      <div className="hero-rail" role="list">
        {latest.map((it) => (
          <HeroCard key={it.key} it={it} list={latest} {...tile} />
        ))}
      </div>

      {going.length ? (
        <Shelf title={t('lib.continue')}>
          {going.map((it) => (
            <VideoCard key={it.key} it={it} list={going} {...tile} rail />
          ))}
        </Shelf>
      ) : null}

      {wide.length ? (
        <Shelf title={t('lib.videos')} more={t('home.seeAll')} onMore={() => go('video')}>
          {wide.slice(0, 12).map((it) => (
            <VideoCard key={it.key} it={it} list={wide} {...tile} rail />
          ))}
        </Shelf>
      ) : null}

      {tall.length ? (
        <Shelf title={t('lib.shorts')} more={t('home.seeAll')} onMore={() => go('video')} variant="tall">
          {tall.slice(0, 12).map((it) => (
            <ReelCard key={it.key} it={it} list={tall} {...tile} />
          ))}
        </Shelf>
      ) : null}

      {songs.length ? (
        <Shelf
          title={t('lib.music')}
          more={t('home.seeAll')}
          onMore={() => go('audio')}
          variant="square"
          extra={
            <button type="button" className="mini-btn" aria-label={t('lib.shuffle')} onClick={() => onPlayAll(songs, true)}>
              <Icon name="shuffle" size={16} />
            </button>
          }
        >
          {songs.slice(0, 12).map((it) => (
            <SongCard key={it.key} it={it} list={songs} {...tile} />
          ))}
        </Shelf>
      ) : null}

      {photos.length ? (
        <section className="shelf">
          <div className="shelf-head">
            <h3>{t('lib.photos')}</h3>
            <button type="button" onClick={() => go('image')}>
              {t('home.seeAll')}
            </button>
          </div>
          <div className="pgrid mosaic">
            {photos.slice(0, 6).map((it, i) => (
              <PhotoTile key={it.key} it={it} list={photos} {...tile} more={i === 5 && photos.length > 6 ? photos.length - 6 : 0} onMore={() => go('image')} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Shelf({ title, more, onMore, extra, variant, children }: { title: string; more?: string; onMore?: () => void; extra?: ReactNode; variant?: 'tall' | 'square'; children: ReactNode }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h3>{title}</h3>
        {extra}
        {more ? (
          <button type="button" onClick={onMore}>
            {more}
          </button>
        ) : null}
      </div>
      <div className={`rail${variant ? ` ${variant}` : ''}`} role="list">
        {children}
      </div>
    </section>
  );
}

// ---------- tiles ----------

type ItemProps = TileProps & { it: MediaItem; list: MediaItem[] };

function SelectMark({ on }: { on: boolean }) {
  return (
    <span className={`selmark${on ? ' on' : ''}`} aria-hidden>
      <Icon name={on ? 'checkCircle' : 'circle'} size={22} />
    </span>
  );
}

/** Moving bars on whatever is playing now. */
export function Eq() {
  return (
    <span className="eq" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

function meta(it: MediaItem): string {
  return [siteInfo(it.site).name, it.dur ? duration(it.dur) : bytes(it.file.size)].filter(Boolean).join(' · ');
}

function HeroCard({ it, list, selected, selecting, onPick, onLong, playingKey }: ItemProps) {
  const t = useT();
  const press = usePress(() => onPick(it, list), () => onLong(it));
  return (
    <button type="button" className="hero-card" role="listitem" aria-label={it.title} {...press}>
      <Thumb srcs={it.thumbs} icon={KIND_ICON[it.kind]} blur>
        <span className="hero-shade" />
        <span className="hero-text">
          <span className="kindtag">
            <Icon name={KIND_ICON[it.kind]} size={14} /> {t(it.kind === 'video' ? 'lib.videos' : it.kind === 'audio' ? 'lib.music' : 'lib.photos')}
          </span>
          <b>{it.title}</b>
          <span className="hero-meta">
            <SiteAvatar site={it.site} size={18} /> {meta(it)}
          </span>
        </span>
        {it.kind !== 'image' ? <span className="hero-play">{playingKey === it.key ? <Eq /> : <Icon name="play" fill size={22} />}</span> : null}
        {selecting ? <SelectMark on={selected.has(it.key)} /> : null}
      </Thumb>
    </button>
  );
}

function VideoCard({ it, list, selected, selecting, positions, playingKey, onPick, onLong, rail }: ItemProps & { rail?: boolean }) {
  const t = useT();
  const press = usePress(() => onPick(it, list), () => onLong(it));
  const seen = watched(positions, it.file.uri);
  const res = resLabel(it.w, it.h);
  return (
    <button type="button" className={`vcard${rail ? ' in-rail' : ''}${selected.has(it.key) ? ' picked' : ''}`} role={rail ? 'listitem' : undefined} {...press}>
      <Thumb srcs={it.thumbs} icon={KIND_ICON[it.kind]} blur={isVertical(it)} dur={it.dur}>
        {res ? <span className="badge">{res}</span> : null}
        {it.stem ? <span className="badge accent">{t(it.stem === 'music' ? 'lib.karaoke' : 'lib.vocals')}</span> : null}
        {seen > 0.01 ? (
          <span className="seen">
            <i style={{ width: `${Math.round(seen * 100)}%` }} />
          </span>
        ) : null}
        {playingKey === it.key ? <Eq /> : null}
        {selecting ? <SelectMark on={selected.has(it.key)} /> : null}
      </Thumb>
      <span className="t">{it.title}</span>
      <span className="m">
        <SiteAvatar site={it.site} size={16} />
        <span>{[it.part ? `${it.part.n}/${it.part.of}` : '', bytes(it.file.size)].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  );
}

function ReelCard({ it, list, selected, selecting, onPick, onLong, playingKey }: ItemProps) {
  const press = usePress(() => onPick(it, list), () => onLong(it));
  return (
    <button type="button" className={`reel${selected.has(it.key) ? ' picked' : ''}`} role="listitem" aria-label={it.title} {...press}>
      <Thumb srcs={it.thumbs} icon="video">
        <span className="reel-shade" />
        <span className="reel-t">{it.title}</span>
        {it.dur ? <span className="reel-dur">{duration(it.dur)}</span> : null}
        {playingKey === it.key ? <Eq /> : null}
        {selecting ? <SelectMark on={selected.has(it.key)} /> : null}
      </Thumb>
    </button>
  );
}

function SongCard({ it, list, selected, selecting, onPick, onLong, playingKey }: ItemProps) {
  const press = usePress(() => onPick(it, list), () => onLong(it));
  return (
    <button type="button" className={`songcard${selected.has(it.key) ? ' picked' : ''}`} role="listitem" {...press}>
      <Thumb srcs={it.thumbs} icon="music" square>
        {playingKey === it.key ? (
          <Eq />
        ) : (
          <span className="cover-play">
            <Icon name="play" fill size={16} />
          </span>
        )}
        {selecting ? <SelectMark on={selected.has(it.key)} /> : null}
      </Thumb>
      <span className="t">{it.title}</span>
      <span className="m">{it.artist ?? siteInfo(it.site).name}</span>
    </button>
  );
}

function SongRow({ it, list, selected, selecting, playingKey, onPick, onLong, onMenu }: ItemProps) {
  const t = useT();
  const press = usePress(() => onPick(it, list), () => onLong(it));
  const now = playingKey === it.key;
  return (
    <div className={`song${now ? ' now' : ''}${selected.has(it.key) ? ' picked' : ''}`}>
      <button type="button" className="song-main" {...press}>
        <Thumb srcs={it.thumbs} icon={KIND_ICON[it.kind]} square={it.kind !== 'video'}>
          {now ? <Eq /> : null}
          {selecting ? <SelectMark on={selected.has(it.key)} /> : null}
        </Thumb>
        <span className="grow">
          <span className="title">
            {it.title}
            {it.stem ? <span className="tag brand">{t(it.stem === 'music' ? 'lib.karaoke' : 'lib.vocals')}</span> : null}
          </span>
          <span className="sub">{[it.artist, meta(it)].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      {!selecting ? (
        <button type="button" className="iconbtn" aria-label={t('act.info')} onClick={() => onMenu(it)}>
          <Icon name="more" />
        </button>
      ) : null}
    </div>
  );
}

function PhotoTile({ it, list, selected, selecting, onPick, onLong, more, onMore }: ItemProps & { more?: number; onMore?: () => void }) {
  const press = usePress(() => (more && !selecting ? onMore?.() : onPick(it, list)), () => onLong(it));
  return (
    <button type="button" className={`ptile${selected.has(it.key) ? ' picked' : ''}`} aria-label={it.title} {...press}>
      <Thumb srcs={it.thumbs} icon="image" square>
        {it.part ? (
          <span className="stack-badge">
            <Icon name="photos" size={14} />
          </span>
        ) : null}
        {more ? <span className="more-over">+{more}</span> : null}
        {selecting ? <SelectMark on={selected.has(it.key)} /> : null}
      </Thumb>
    </button>
  );
}
