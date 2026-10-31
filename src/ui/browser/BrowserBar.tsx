import { forwardRef, useRef, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { displayHost, type TabInfo } from '../../core/browser.ts';
import { useT } from '../../i18n.ts';
import { Icon } from '../Icon.tsx';

export interface BarToast {
  text: string;
  action?: { label: string; run: () => void };
}

interface Props {
  tab: TabInfo;
  /** Downloadable things found on the page. */
  count: number;
  /** Shown for a moment when something downloadable appears ("Download reel"). */
  label?: string;
  collapsed: boolean;
  tabsCount: number;
  top: boolean;
  toast?: BarToast;
  onToastDone: () => void;
  find?: { query: string; index: number; count: number };
  onFind: (q: string) => void;
  onFindNext: (forward: boolean) => void;
  onFindClose: () => void;
  onAddress: () => void;
  onAddressHold: () => void;
  onFinder: () => void;
  onTabs: () => void;
  onMenu: () => void;
  onSwipe: (dir: -1 | 1) => void;
  onExpand: () => void;
}

/**
 * The page's bar: address (tap to type, swipe to change tab, hold for copy/paste, swipe up for tabs), the
 * download finder, tabs and menu. Messages appear inside it so nothing ever covers the page.
 */
export const BrowserBar = forwardRef<HTMLDivElement, Props>(function BrowserBar(p, ref) {
  const t = useT();
  const start = useRef<{ x: number; y: number; at: number } | undefined>(undefined);
  const handled = useRef(false);
  const hold = useRef<number | undefined>(undefined);
  const host = displayHost(p.tab.url);
  const loading = p.tab.loading && p.tab.progress < 100;

  const gesture = {
    onPointerDown: (e: RPointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY, at: Date.now() };
      handled.current = false;
      window.clearTimeout(hold.current);
      hold.current = window.setTimeout(() => {
        handled.current = true;
        navigator.vibrate?.(15);
        p.onAddressHold();
      }, 500);
    },
    onPointerMove: (e: RPointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) window.clearTimeout(hold.current);
    },
    onPointerUp: (e: RPointerEvent) => {
      window.clearTimeout(hold.current);
      const s = start.current;
      start.current = undefined;
      if (!s || handled.current) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 45) {
        handled.current = true;
        p.onSwipe(dx < 0 ? 1 : -1);
      } else if (dy < -45 && Math.abs(dx) < 50) {
        handled.current = true;
        p.onTabs();
      }
    },
    onPointerCancel: () => window.clearTimeout(hold.current),
    onClick: () => {
      if (!handled.current) p.onAddress();
    },
    onContextMenu: (e: RMouseEvent) => e.preventDefault(),
  };

  let body;
  if (p.find) {
    body = (
      <div className="bb-row bb-findrow">
        <input
          autoFocus
          value={p.find.query}
          onChange={(e) => p.onFind(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && p.onFindNext(true)}
          placeholder={t('br.find')}
          aria-label={t('br.find')}
          enterKeyHint="search"
        />
        <span className="bb-findn">{p.find.query ? (p.find.count ? `${p.find.index}/${p.find.count}` : t('br.noMatches')) : ''}</span>
        <button type="button" className="iconbtn" aria-label="Previous" onClick={() => p.onFindNext(false)}>
          <Icon name="up" />
        </button>
        <button type="button" className="iconbtn" aria-label="Next" onClick={() => p.onFindNext(true)}>
          <Icon name="down" />
        </button>
        <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={p.onFindClose}>
          <Icon name="close" />
        </button>
      </div>
    );
  } else if (p.toast) {
    const toast = p.toast;
    body = (
      <div className="bb-row bb-toast" role="status">
        <Icon name="check" size={18} />
        <span className="grow">{toast.text}</span>
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action!.run();
              p.onToastDone();
            }}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
    );
  } else if (p.collapsed) {
    body = (
      <button type="button" className="bb-mini" onClick={p.onExpand}>
        {p.tab.private ? <Icon name="incognito" size={13} /> : p.tab.secure ? <Icon name="lock" size={12} /> : null}
        <span>{host}</span>
        {p.count ? <i className="bb-dot" /> : null}
      </button>
    );
  } else {
    body = (
      <div className="bb-row">
        <button type="button" className="bb-pill" aria-label={`${host}. ${t('br.search')}`} {...gesture}>
          {p.tab.private ? (
            <Icon name="incognito" size={16} />
          ) : p.tab.secure ? (
            <Icon name="lock" size={14} />
          ) : (
            <span className="bb-warn" title={t('br.notSecure')}>
              !
            </span>
          )}
          <span className="bb-host">{host || t('br.search')}</span>
          {p.tab.blocked > 0 ? (
            <span className="bb-shield" aria-label={t('br.blocked', { n: p.tab.blocked })}>
              <Icon name="shield" size={12} />
              {p.tab.blocked > 99 ? '99+' : p.tab.blocked}
            </span>
          ) : null}
        </button>
        <button type="button" className={`bb-find${p.count ? ' lit' : ''}${p.label ? ' wide' : ''}`} aria-label={t('br.finder')} onClick={p.onFinder}>
          <Icon name="download" size={20} />
          {p.label ? <span className="bb-label">{p.label}</span> : p.count ? <span className="bb-count">{p.count > 99 ? '99+' : p.count}</span> : null}
        </button>
        <button type="button" className="bb-btn" aria-label={t('br.tabsBtn', { n: p.tabsCount })} onClick={p.onTabs}>
          <span className="bb-tabn">{p.tabsCount > 99 ? ':)' : p.tabsCount}</span>
        </button>
        <button type="button" className="bb-btn" aria-label={t('br.menu')} onClick={p.onMenu}>
          <Icon name="more" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className={`bb${p.collapsed && !p.find && !p.toast ? ' small' : ''}${p.tab.private ? ' private' : ''}${p.top ? ' top' : ''}`}>
      <i className="bb-progress" style={{ transform: `scaleX(${loading ? Math.max(0.08, p.tab.progress / 100) : 1})`, opacity: loading ? 1 : 0 }} />
      {body}
    </div>
  );
});
