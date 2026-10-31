import { useRef, useState } from 'react';
import { displayHost, type TabInfo } from '../../core/browser.ts';
import { useT } from '../../i18n.ts';
import { useBack } from '../back.ts';
import { Icon } from '../Icon.tsx';
import { fileSrc } from '../common.tsx';
import { SiteIcon } from './parts.tsx';

interface Props {
  tabs: TabInfo[];
  activeId?: string;
  privateOk: boolean;
  startPrivate: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: (priv: boolean) => void;
  onNew: (priv: boolean) => void;
  onHome: () => void;
  onDismiss: () => void;
}

/** One tab: tap to open, swipe sideways or ✕ to close. */
function Card({ tab, active, onSelect, onClose }: { tab: TabInfo; active: boolean; onSelect: () => void; onClose: () => void }) {
  const t = useT();
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const swiping = useRef(false);
  return (
    <div
      className={`ts-card${active ? ' on' : ''}`}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.2, 1 - Math.abs(dx) / 220), transition: 'none' } : undefined}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY };
        swiping.current = false;
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const mx = e.clientX - s.x;
        if (!swiping.current && Math.abs(mx) > 14 && Math.abs(mx) > Math.abs(e.clientY - s.y)) swiping.current = true;
        if (swiping.current) setDx(mx);
      }}
      onPointerUp={() => {
        start.current = undefined;
        if (Math.abs(dx) > 110) onClose();
        setDx(0);
      }}
      onPointerCancel={() => {
        start.current = undefined;
        setDx(0);
      }}
    >
      <button type="button" className="ts-main" onClick={() => !swiping.current && onSelect()}>
        <span className="ts-head">
          <SiteIcon url={tab.url} icon={tab.icon} size={18} />
          <span className="ts-title">{tab.title || displayHost(tab.url)}</span>
        </span>
        <span className="ts-shot">
          {tab.thumb ? <img src={`${fileSrc(tab.thumb)}?v=${tab.thumbAt ?? 0}`} alt="" /> : <SiteIcon url={tab.url} icon={tab.icon} size={44} />}
        </span>
      </button>
      <button type="button" className="ts-x" aria-label={t('br.closeTab')} onClick={onClose}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

/** All tabs as cards, normal and private, with new-tab buttons. */
export function TabSwitcher(p: Props) {
  const t = useT();
  useBack(true, p.onDismiss);
  const [priv, setPriv] = useState(p.startPrivate);
  const list = p.tabs.filter((x) => x.private === priv);
  return (
    <div className={`ts${priv ? ' private' : ''}`} role="dialog" aria-modal="true" aria-label={t('br.nTabs', { n: p.tabs.length })}>
      <header className="ts-top">
        <button type="button" className="iconbtn" aria-label={t('br.home')} onClick={p.onHome}>
          <Icon name="home" />
        </button>
        {p.privateOk ? (
          <div className="seg ts-seg" role="group">
            <button type="button" aria-pressed={!priv} onClick={() => setPriv(false)}>
              {t('br.nTabs', { n: p.tabs.filter((x) => !x.private).length })}
            </button>
            <button type="button" aria-pressed={priv} onClick={() => setPriv(true)}>
              <Icon name="incognito" size={15} /> {t('br.private')}
            </button>
          </div>
        ) : (
          <h2 className="grow">{t('br.nTabs', { n: p.tabs.length })}</h2>
        )}
        <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={p.onDismiss}>
          <Icon name="close" />
        </button>
      </header>
      {priv ? <p className="ts-note">{t('br.privateNote')}</p> : null}
      {list.length ? (
        <div className="ts-grid">
          {list.map((x) => (
            <Card key={x.id} tab={x} active={x.id === p.activeId} onSelect={() => p.onSelect(x.id)} onClose={() => p.onClose(x.id)} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="art">
            <Icon name={priv ? 'incognito' : 'tabs'} size={40} />
          </div>
          <b>{t('br.noTabs')}</b>
        </div>
      )}
      <footer className="ts-foot">
        {list.length ? (
          <button type="button" className="btn ghost" onClick={() => p.onCloseAll(priv)}>
            {t('br.closeAll')}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn" onClick={() => p.onNew(priv)}>
          <Icon name="plus" size={18} /> {priv ? t('br.newPrivate') : t('br.newTab')}
        </button>
      </footer>
    </div>
  );
}
