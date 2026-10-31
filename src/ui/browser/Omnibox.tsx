import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINES, YOUTUBE_SEARCH, YTMUSIC_SEARCH, fill, searchTerms, suggestions, type Bookmark, type SearchEngine, type Suggestion, type TabInfo, type Visit } from '../../core/browser.ts';
import { browser } from '../../engine/browser.ts';
import { useT } from '../../i18n.ts';
import { useBack } from '../back.ts';
import { Icon, type IconName } from '../Icon.tsx';
import { SiteIcon } from './parts.tsx';

interface Props {
  /** The page being edited (empty for a new one). */
  url: string;
  engine: SearchEngine;
  remote: boolean;
  privateTab: boolean;
  history: Visit[];
  bookmarks: Bookmark[];
  tabs: TabInfo[];
  activeId?: string;
  clip?: string;
  onGo: (url: string) => void;
  onTab: (id: string) => void;
  onClose: () => void;
}

const ICON: Record<Suggestion['kind'], IconName> = {
  go: 'globe',
  search: 'search',
  clip: 'paste',
  tab: 'tabs',
  bookmark: 'star',
  history: 'clock',
  site: 'globe',
  suggest: 'search',
};

/** Type an address or a search: suggestions from your tabs, bookmarks, history, sites and the search engine. */
export function Omnibox(p: Props) {
  const t = useT();
  useBack(true, p.onClose);
  const start = searchTerms(p.url) ?? p.url;
  const [text, setText] = useState(start);
  const [remote, setRemote] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // The search engine's guesses, a moment after typing stops (never from private tabs).
  useEffect(() => {
    const q = text.trim();
    if (!p.remote || p.privateTab || !q || q === start || /^https?:\/\//i.test(q)) {
      setRemote([]);
      return;
    }
    let alive = true;
    const id = window.setTimeout(() => {
      browser
        .suggest(ENGINES[p.engine].suggest, q)
        .then((r) => alive && setRemote(r))
        .catch(() => {});
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [text, p.remote, p.privateTab, p.engine, start]);

  const rows = useMemo(
    () => suggestions({ input: text === start && p.url ? '' : text, engine: p.engine, history: p.history, bookmarks: p.bookmarks, tabs: p.tabs, activeId: p.activeId, remote, clip: p.clip }),
    [text, start, p.url, p.engine, p.history, p.bookmarks, p.tabs, p.activeId, remote, p.clip],
  );

  const pick = (s: Suggestion) => {
    if (s.kind === 'tab' && s.tabId) p.onTab(s.tabId);
    else p.onGo(s.url);
  };

  const submit = () => {
    const first = suggestions({ input: text, engine: p.engine, history: [], bookmarks: [], tabs: [] })[0];
    if (first) p.onGo(first.url);
  };

  const q = text.trim();
  return (
    <div className="ob" role="dialog" aria-modal="true" aria-label={t('br.search')}>
      <form
        className="ob-head"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="button" className="iconbtn" aria-label={t('common.back')} onClick={p.onClose}>
          <Icon name="back" />
        </button>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('br.search')}
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={t('br.search')}
        />
        {text ? (
          <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={() => setText('')}>
            <Icon name="close" size={18} />
          </button>
        ) : null}
      </form>
      {q && !/^https?:\/\//i.test(q) ? (
        <div className="chips ob-chips">
          <button type="button" className="chip" onClick={() => p.onGo(fill(YOUTUBE_SEARCH, q))}>
            <Icon name="play" size={14} /> {t('br.searchYt')}
          </button>
          <button type="button" className="chip" onClick={() => p.onGo(fill(YTMUSIC_SEARCH, q))}>
            <Icon name="music" size={14} /> {t('br.searchYtm')}
          </button>
        </div>
      ) : null}
      <div className="ob-list">
        {rows.map((s) => (
          <div key={`${s.kind}:${s.url}`} className="ob-row">
            <button type="button" className="ob-main" onClick={() => pick(s)}>
              {s.kind === 'history' || s.kind === 'bookmark' || s.kind === 'site' || s.kind === 'tab' ? (
                <SiteIcon url={s.url} size={28} />
              ) : (
                <span className="ob-ic">
                  <Icon name={ICON[s.kind]} size={18} />
                </span>
              )}
              <span className="grow">
                <span className="title">{s.kind === 'search' ? t('br.searchFor', { q: s.title }) : s.title}</span>
                {s.kind === 'tab' ? <span className="sub">{t('br.switchTab')}</span> : s.kind === 'clip' ? <span className="sub">{t('br.copiedOpen')}</span> : s.sub ? <span className="sub">{s.sub}</span> : null}
              </span>
            </button>
            {s.kind === 'suggest' || s.kind === 'history' ? (
              <button type="button" className="iconbtn ob-fill" aria-label={t('br.useText')} onClick={() => setText(s.kind === 'suggest' ? `${s.title} ` : s.url)}>
                <Icon name="up" size={18} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
