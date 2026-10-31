import { displayHost, type Shortcut, type TabInfo } from '../../core/browser.ts';
import { bytes } from '../../core/format.ts';
import type { ContextTarget, PageDownload } from '../../engine/browser.ts';
import { useT } from '../../i18n.ts';
import { Icon } from '../Icon.tsx';
import { Row, Sheet, SwitchRow, Thumb } from '../common.tsx';
import { SiteIcon } from './parts.tsx';

export function BrowserMenu(p: {
  tab: TabInfo;
  bookmarked: boolean;
  /** This site's ad blocker (read when the menu opens). */
  adblock?: { adblock: boolean; level: string };
  privateOk: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onBookmark: () => void;
  onShare: () => void;
  onNewTab: () => void;
  onNewPrivate: () => void;
  onFind: () => void;
  onDesktop: () => void;
  onAdblock: (on: boolean) => void;
  onBookmarks: () => void;
  onHistory: () => void;
  onDownloads: () => void;
  onOpenOther: () => void;
  onCopy: () => void;
  onHome: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const act = (f: () => void) => () => {
    p.onClose();
    f();
  };
  return (
    <Sheet label={t('br.menu')} onClose={p.onClose}>
      <div className="bm-head">
        <SiteIcon url={p.tab.url} icon={p.tab.icon} size={36} />
        <span className="grow">
          <b>{p.tab.title || displayHost(p.tab.url)}</b>
          <span className="muted small">
            {p.tab.secure ? <Icon name="lock" size={12} /> : `${t('br.notSecure')} · `}
            {displayHost(p.tab.url)}
          </span>
        </span>
      </div>
      <div className="bm-icons">
        <button type="button" disabled={!p.tab.canBack} aria-label={t('common.back')} onClick={act(p.onBack)}>
          <Icon name="back" />
        </button>
        <button type="button" disabled={!p.tab.canForward} aria-label={t('br.forward')} onClick={act(p.onForward)}>
          <Icon name="chevron" />
        </button>
        <button type="button" aria-label={p.tab.loading ? t('br.stop') : t('br.reload')} onClick={act(p.onReload)}>
          <Icon name={p.tab.loading ? 'close' : 'refresh'} />
        </button>
        <button type="button" className={p.bookmarked ? 'on' : ''} aria-label={t('br.bookmark')} aria-pressed={p.bookmarked} onClick={act(p.onBookmark)}>
          <Icon name="star" fill={p.bookmarked} />
        </button>
        <button type="button" aria-label={t('act.share')} onClick={act(p.onShare)}>
          <Icon name="share" />
        </button>
      </div>
      <div className="card group">
        <Row icon="plus" title={t('br.newTab')} onClick={act(p.onNewTab)} />
        {p.privateOk ? <Row icon="incognito" title={t('br.newPrivate')} onClick={act(p.onNewPrivate)} /> : null}
        <Row icon="search" title={t('br.find')} onClick={act(p.onFind)} />
        <SwitchRow icon="desktop" title={t('br.desktop')} on={p.tab.desktop} onChange={() => p.onDesktop()} />
        {p.adblock && p.adblock.level !== 'off' ? (
          <SwitchRow
            icon="shield"
            title={t('br.adsSite')}
            sub={p.tab.blocked ? t('br.blocked', { n: p.tab.blocked }) : undefined}
            on={p.adblock.adblock}
            onChange={(v) => p.onAdblock(v)}
          />
        ) : null}
      </div>
      <div className="card group">
        <Row icon="star" title={t('br.bookmarks')} onClick={act(p.onBookmarks)} />
        <Row icon="clock" title={t('br.history')} onClick={act(p.onHistory)} />
        <Row icon="list" title={t('tab.downloads')} onClick={act(p.onDownloads)} />
        <Row icon="home" title={t('br.home')} onClick={act(p.onHome)} />
      </div>
      <div className="card group">
        <Row icon="copy" title={t('act.copyLink')} onClick={act(p.onCopy)} />
        <Row icon="external" title={t('br.openOther')} onClick={act(p.onOpenOther)} />
        <Row icon="sliders" title={t('set.browser')} onClick={act(p.onSettings)} />
      </div>
    </Sheet>
  );
}

/** Long-press on a link, photo or video in a page. */
export function ContextSheet(p: {
  target: ContextTarget;
  onOpenTab: (url: string, background: boolean) => void;
  onCopy: (url: string) => void;
  onShare: (url: string) => void;
  onDownloadLink: (url: string) => void;
  onSavePhoto: (url: string) => void;
  onSaveVideo: (url: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const x = p.target;
  const act = (f: () => void) => () => {
    p.onClose();
    f();
  };
  const head = x.link ?? x.post ?? x.video ?? x.image ?? '';
  return (
    <Sheet label={head} onClose={p.onClose}>
      <div className="cx-head">
        {x.image || x.poster ? <Thumb srcs={[x.image ?? x.poster!]} square={!!x.image} /> : <SiteIcon url={head} size={36} />}
        <span className="grow">
          {x.linkText ? <b>{x.linkText}</b> : null}
          <span className="cx-url">{head}</span>
        </span>
      </div>
      <div className="card group">
        {x.video || x.post ? <Row icon="video" title={t('cx.saveVideo')} onClick={act(() => (x.post ? p.onDownloadLink(x.post) : p.onSaveVideo(x.video!)))} /> : null}
        {x.image ? <Row icon="image" title={t('cx.savePhoto')} onClick={act(() => p.onSavePhoto(x.image!))} /> : null}
        {x.link ? (
          <>
            <Row icon="download" title={t('cx.download')} onClick={act(() => p.onDownloadLink(x.link!))} />
            <Row icon="plus" title={t('cx.openNew')} onClick={act(() => p.onOpenTab(x.link!, false))} />
            <Row icon="tabs" title={t('cx.openBg')} onClick={act(() => p.onOpenTab(x.link!, true))} />
            <Row icon="copy" title={t('act.copyLink')} onClick={act(() => p.onCopy(x.link!))} />
            <Row icon="share" title={t('cx.shareLink')} onClick={act(() => p.onShare(x.link!))} />
          </>
        ) : null}
        {x.image ? (
          <>
            <Row icon="external" title={t('cx.openPhoto')} onClick={act(() => p.onOpenTab(x.image!, false))} />
            <Row icon="copy" title={t('cx.copyPhoto')} onClick={act(() => p.onCopy(x.image!))} />
          </>
        ) : null}
        {x.video && !x.link ? <Row icon="copy" title={t('cx.copyVideo')} onClick={act(() => p.onCopy(x.video!))} /> : null}
      </div>
    </Sheet>
  );
}

/** A page offered a file (its own "Download" button). */
export function PageDownloadSheet(p: { d: PageDownload; onDownload: () => void; onClose: () => void }) {
  const t = useT();
  const blob = p.d.url.startsWith('blob:') || p.d.url.startsWith('data:');
  return (
    <Sheet
      label={t('pd.title')}
      onClose={p.onClose}
      foot={
        blob ? undefined : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={p.onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 2 }}
              onClick={() => {
                p.onClose();
                p.onDownload();
              }}
            >
              <Icon name="download" size={18} /> {t('sheet.download')}
            </button>
          </div>
        )
      }
    >
      <h3>{t('pd.title')}</h3>
      <div className="row">
        <span className="ic">
          <Icon name={p.d.mime.startsWith('video/') ? 'video' : p.d.mime.startsWith('audio/') ? 'music' : p.d.mime.startsWith('image/') ? 'image' : 'download'} />
        </span>
        <span className="grow">
          <span className="title">{p.d.name || displayHost(p.d.url)}</span>
          <span className="sub">{[bytes(p.d.size > 0 ? p.d.size : undefined), displayHost(p.d.url)].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      {blob ? <p className="muted">{t('pd.blob')}</p> : null}
    </Sheet>
  );
}

/** A page wants to open another app: only after a tap, and only if you agree. */
export function ExternalSheet(p: { url: string; onOpen: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet
      label={t('ex.title')}
      onClose={p.onClose}
      foot={
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={p.onClose}>
            {t('ex.stay')}
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            onClick={() => {
              p.onClose();
              p.onOpen();
            }}
          >
            <Icon name="external" size={18} /> {t('ex.open')}
          </button>
        </div>
      }
    >
      <h3>{t('ex.title')}</h3>
      <p className="muted">{t('ex.sub')}</p>
    </Sheet>
  );
}

/** Long-press on a site on the start page. */
export function ShortcutSheet(p: { s: Shortcut; onOpen: () => void; onPin: () => void; onRemove: () => void; onClose: () => void }) {
  const t = useT();
  const act = (f: () => void) => () => {
    p.onClose();
    f();
  };
  return (
    <Sheet label={p.s.title} onClose={p.onClose}>
      <div className="bm-head">
        <SiteIcon url={p.s.url} size={36} />
        <span className="grow">
          <b>{p.s.title}</b>
          <span className="muted small">{displayHost(p.s.url)}</span>
        </span>
      </div>
      <div className="card group">
        <Row icon="external" title={t('act.open')} onClick={act(p.onOpen)} />
        <Row icon="pin" title={t('br.pin')} onClick={act(p.onPin)} />
        <Row icon="trash" title={t('br.remove')} onClick={act(p.onRemove)} />
      </div>
    </Sheet>
  );
}
