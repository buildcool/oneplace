import { displayHost, type Bookmark, type Shortcut, type TabInfo, type Visit } from '../../core/browser.ts';
import { useT } from '../../i18n.ts';
import { Icon } from '../Icon.tsx';
import { SectionTitle, fileSrc, usePress } from '../common.tsx';
import { SiteIcon } from './parts.tsx';

interface Props {
  tabs: TabInfo[];
  shortcuts: Shortcut[];
  history: Visit[];
  bookmarks: Bookmark[];
  clip?: string;
  onSearch: () => void;
  onOpen: (url: string) => void;
  onTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onTabs: () => void;
  onShortcutMenu: (s: Shortcut) => void;
  onAllSites: () => void;
  onHistory: () => void;
  onBookmarks: () => void;
  onDownloadClip: (url: string) => void;
}

function ShortcutButton({ s, onOpen, onMenu }: { s: Shortcut; onOpen: (url: string) => void; onMenu: (s: Shortcut) => void }) {
  const press = usePress(
    () => onOpen(s.url),
    () => onMenu(s),
  );
  return (
    <button type="button" className="bs-site" {...press}>
      <SiteIcon url={s.url} size={46} />
      <span>{s.title}</span>
    </button>
  );
}

/** Browse with no page open: search, YouTube cards, sites, your tabs, bookmarks and recent pages. */
export function StartPage(p: Props) {
  const t = useT();
  const open = p.tabs.filter((x) => !x.private);
  return (
    <>
      <header className="topbar">
        <h1>{t('tab.browse')}</h1>
        <button type="button" className="iconbtn" aria-label={t('br.history')} onClick={p.onHistory}>
          <Icon name="clock" />
        </button>
        <button type="button" className="iconbtn bs-tabcount" aria-label={t('br.tabsBtn', { n: p.tabs.length })} onClick={p.onTabs}>
          <Icon name="tabs" />
          {p.tabs.length ? <span className="badge">{p.tabs.length}</span> : null}
        </button>
      </header>
      <main className="page bs">
        <button type="button" className="bs-search" onClick={p.onSearch}>
          <Icon name="search" size={20} />
          <span>{t('br.search')}</span>
        </button>

        {p.clip ? (
          <div className="clipchip">
            <button type="button" className="grow" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }} onClick={() => p.onOpen(p.clip!)}>
              <Icon name="link" />
              <span style={{ minWidth: 0 }}>
                <small>{t('br.copiedOpen')}</small>
                <span className="url">{p.clip}</span>
              </span>
            </button>
            <button type="button" className="btn small" aria-label={t('sheet.download')} onClick={() => p.onDownloadClip(p.clip!)}>
              <Icon name="download" size={16} />
            </button>
          </div>
        ) : null}

        <div className="bs-hero">
          <button type="button" className="bs-card yt" onClick={() => p.onOpen('https://m.youtube.com/')}>
            <span className="bs-mark">
              <Icon name="play" size={18} fill />
            </span>
            <b>YouTube</b>
            <small>{t('br.ytSub')}</small>
          </button>
          <button type="button" className="bs-card ytm" onClick={() => p.onOpen('https://music.youtube.com/')}>
            <span className="bs-mark">
              <Icon name="music" size={18} />
            </span>
            <b>YouTube Music</b>
            <small>{t('br.ytSub')}</small>
          </button>
        </div>

        <SectionTitle
          action={
            <button type="button" onClick={p.onAllSites}>
              {t('br.allSites')}
            </button>
          }
        >
          {t('br.sites')}
        </SectionTitle>
        <div className="bs-grid">
          {p.shortcuts.map((s) => (
            <ShortcutButton key={s.url} s={s} onOpen={p.onOpen} onMenu={p.onShortcutMenu} />
          ))}
        </div>

        {open.length ? (
          <>
            <SectionTitle
              action={
                <button type="button" onClick={p.onTabs}>
                  {t('home.seeAll')}
                </button>
              }
            >
              {t('br.tabs')}
            </SectionTitle>
            <div className="bs-tabs">
              {open.slice(0, 12).map((x) => (
                <div key={x.id} className="bs-tab">
                  <button type="button" className="bs-tab-main" onClick={() => p.onTab(x.id)}>
                    <span className="bs-tab-shot">
                      {x.thumb ? <img src={`${fileSrc(x.thumb)}?v=${x.thumbAt ?? 0}`} alt="" /> : <SiteIcon url={x.url} icon={x.icon} size={34} />}
                    </span>
                    <span className="bs-tab-title">{x.title || displayHost(x.url)}</span>
                  </button>
                  <button type="button" className="bs-tab-x" aria-label={t('br.closeTab')} onClick={() => p.onCloseTab(x.id)}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {p.bookmarks.length ? (
          <>
            <SectionTitle
              action={
                <button type="button" onClick={p.onBookmarks}>
                  {t('home.seeAll')}
                </button>
              }
            >
              {t('br.bookmarks')}
            </SectionTitle>
            <div className="card group">
              {p.bookmarks.slice(0, 4).map((b) => (
                <button key={b.url} type="button" className="row" onClick={() => p.onOpen(b.url)}>
                  <SiteIcon url={b.url} size={32} />
                  <span className="grow">
                    <span className="title">{b.title}</span>
                    <span className="sub">{displayHost(b.url)}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {p.history.length ? (
          <>
            <SectionTitle
              action={
                <button type="button" onClick={p.onHistory}>
                  {t('br.history')}
                </button>
              }
            >
              {t('br.recent')}
            </SectionTitle>
            <div className="card group">
              {p.history.slice(0, 5).map((v) => (
                <button key={v.url} type="button" className="row" onClick={() => p.onOpen(v.url)}>
                  <SiteIcon url={v.url} size={32} />
                  <span className="grow">
                    <span className="title">{v.title}</span>
                    <span className="sub">{displayHost(v.url)}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className="banner" style={{ marginTop: 18 }}>
          <Icon name="download" />
          <div className="grow small">{t('br.tip')}</div>
        </div>
      </main>
    </>
  );
}
