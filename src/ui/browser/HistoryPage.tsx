import { useMemo, useState, type ReactNode } from 'react';
import { dayLabel, displayHost, searchVisits, type Bookmark, type Visit } from '../../core/browser.ts';
import { SITES } from '../../core/sites.ts';
import { useT } from '../../i18n.ts';
import { useBack } from '../back.ts';
import { Icon } from '../Icon.tsx';
import { SectionTitle, SiteAvatar } from '../common.tsx';
import { SiteIcon, timeLabel } from './parts.tsx';

/** A full-screen page over the browser (history, bookmarks, all sites). */
function Layer({ title, onClose, children, action }: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  const t = useT();
  useBack(true, onClose);
  return (
    <div className="bh" role="dialog" aria-modal="true" aria-label={title}>
      <header className="topbar subpage-head">
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t('common.back')}>
          <Icon name="back" />
        </button>
        <h1>{title}</h1>
        {action}
      </header>
      <main className="page">{children}</main>
    </div>
  );
}

export function HistoryPage(p: { history: Visit[]; onOpen: (url: string) => void; onRemove: (url: string) => void; onClear: () => void; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const list = useMemo(() => (q.trim() ? searchVisits(p.history, q, 200) : p.history.slice(0, 400)), [p.history, q]);
  const groups = useMemo(() => {
    const out: { label: string; items: Visit[] }[] = [];
    for (const v of list) {
      const d = dayLabel(v.at);
      const label = d === 'today' ? t('hi.today') : d === 'yesterday' ? t('hi.yesterday') : new Date(v.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      const last = out.at(-1);
      if (last && last.label === label) last.items.push(v);
      else out.push({ label, items: [v] });
    }
    return out;
  }, [list, t]);
  return (
    <Layer
      title={t('br.history')}
      onClose={p.onClose}
      action={
        p.history.length ? (
          <button type="button" className="btn small ghost" onClick={p.onClear}>
            {t('hi.clear')}
          </button>
        ) : undefined
      }
    >
      <div className="linkbox bh-search">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hi.search')} aria-label={t('hi.search')} />
      </div>
      {!list.length ? (
        <div className="empty">
          <div className="art">
            <Icon name="clock" size={40} />
          </div>
          <b>{t('hi.empty')}</b>
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.label}>
          <SectionTitle>{g.label}</SectionTitle>
          <div className="card group">
            {g.items.map((v) => (
              <div key={v.url} className="row">
                <button type="button" className="bh-main" onClick={() => p.onOpen(v.url)}>
                  <SiteIcon url={v.url} size={32} />
                  <span className="grow">
                    <span className="title">{v.title}</span>
                    <span className="sub">
                      {timeLabel(v.at)} · {displayHost(v.url)}
                    </span>
                  </span>
                </button>
                <button type="button" className="iconbtn" aria-label={t('br.remove')} onClick={() => p.onRemove(v.url)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Layer>
  );
}

export function BookmarksPage(p: { bookmarks: Bookmark[]; onOpen: (url: string) => void; onRemove: (url: string) => void; onClose: () => void }) {
  const t = useT();
  return (
    <Layer title={t('br.bookmarks')} onClose={p.onClose}>
      {!p.bookmarks.length ? (
        <div className="empty">
          <div className="art">
            <Icon name="star" size={40} />
          </div>
          <b>{t('bk.empty')}</b>
          <span>{t('bk.hint')}</span>
        </div>
      ) : (
        <div className="card group" style={{ marginTop: 12 }}>
          {p.bookmarks.map((b) => (
            <div key={b.url} className="row">
              <button type="button" className="bh-main" onClick={() => p.onOpen(b.url)}>
                <SiteIcon url={b.url} size={32} />
                <span className="grow">
                  <span className="title">{b.title}</span>
                  <span className="sub">{displayHost(b.url)}</span>
                </span>
              </button>
              <button type="button" className="iconbtn" aria-label={t('br.remove')} onClick={() => p.onRemove(b.url)}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Layer>
  );
}

/** Every site OnePlace supports, searchable; tapping one opens it. */
export function AllSitesPage(p: { onOpen: (url: string) => void; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const sites = Object.values(SITES).filter((s) => s.home && s.id !== 'other' && (!q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <Layer title={t('br.allSites')} onClose={p.onClose}>
      <div className="linkbox bh-search">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('br.search')} aria-label={t('br.search')} />
      </div>
      <div className="card group" style={{ marginTop: 12 }}>
        {sites.map((s) => (
          <button key={s.id} type="button" className="row" onClick={() => p.onOpen(s.home!)}>
            <SiteAvatar site={s.id} />
            <span className="grow">
              <span className="title">{s.name}</span>
              <span className="sub">{s.what}</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
      </div>
    </Layer>
  );
}
