import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { siteInfo } from '../../core/sites.ts';
import type { MediaItem } from '../../core/media.ts';
import { useT } from '../../i18n.ts';
import { useBack } from '../back.ts';
import { Icon } from '../Icon.tsx';
import { fileSrc } from '../common.tsx';

interface Props {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onShare: (it: MediaItem) => void;
  onMenu: (it: MediaItem) => void;
}

interface Pt {
  x: number;
  y: number;
}

const MAX_ZOOM = 5;

/**
 * Full-screen photos: swipe left/right for the next one, pinch or double-tap to zoom, drag to look
 * around a zoomed photo, drag down to close, tap to hide the bars.
 */
export function ImageViewer({ items, index, onClose, onShare, onMenu }: Props) {
  const t = useT();
  useBack(true, onClose);
  const [i, setI] = useState(Math.min(index, items.length - 1));
  const [chrome, setChrome] = useState(true);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [anim, setAnim] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const pts = useRef(new Map<number, Pt>());
  const g = useRef<{ mode?: 'pan' | 'page' | 'close' | 'pinch'; start: Pt; z0: { s: number; x: number; y: number }; dist0?: number; mid0?: Pt; moved: boolean; t0: number } | undefined>(undefined);
  const lastTap = useRef<{ t: number; p: Pt } | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const it = items[i];

  // The list can shrink (photo deleted): stay inside it.
  useEffect(() => {
    if (!items.length) onClose();
    else if (i >= items.length) setI(items.length - 1);
  }, [items.length, i, onClose]);

  const size = () => {
    const r = stage.current?.getBoundingClientRect();
    return { w: r?.width ?? window.innerWidth, h: r?.height ?? window.innerHeight, left: r?.left ?? 0, top: r?.top ?? 0 };
  };

  /** Keep a zoomed photo from being dragged off screen. */
  const clamp = (s: number, x: number, y: number) => {
    const { w, h } = size();
    const el = img.current;
    const nw = el?.naturalWidth || w;
    const nh = el?.naturalHeight || h;
    const fit = Math.min(w / nw, h / nh);
    const mx = Math.max(0, (nw * fit * s - w) / 2);
    const my = Math.max(0, (nh * fit * s - h) / 2);
    return { s, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };

  const go = (to: number) => {
    const { w } = size();
    if (to < 0 || to >= items.length) {
      setAnim(true);
      setDx(0);
      return;
    }
    setAnim(true);
    setDx(to > i ? -w : w);
    window.setTimeout(() => {
      setAnim(false);
      setDx(0);
      setZ({ s: 1, x: 0, y: 0 });
      setI(to);
    }, 220);
  };

  const rel = (e: { clientX: number; clientY: number }): Pt => {
    const { w, h, left, top } = size();
    return { x: e.clientX - left - w / 2, y: e.clientY - top - h / 2 };
  };

  const tap = (p: Pt) => {
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < 300 && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < 40) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = undefined;
      setAnim(true);
      // Double tap: zoom in on that spot, or back out.
      if (z.s > 1.05) setZ({ s: 1, x: 0, y: 0 });
      else setZ(clamp(2.5, -p.x * 1.5, -p.y * 1.5));
      return;
    }
    lastTap.current = { t: now, p };
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = undefined;
      setChrome((c) => !c);
    }, 300);
  };

  const down = (e: RPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnim(false);
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()] as [Pt, Pt];
      g.current = { mode: 'pinch', start: rel(e), z0: z, dist0: Math.hypot(a.x - b.x, a.y - b.y), mid0: rel({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }), moved: true, t0: Date.now() };
    } else {
      g.current = { start: { x: e.clientX, y: e.clientY }, z0: z, moved: false, t0: Date.now() };
    }
  };

  const move = (e: RPointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (!s) return;
    if (s.mode === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()] as [Pt, Pt];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = rel({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      const sc = Math.min(MAX_ZOOM, Math.max(1, s.z0.s * (dist / (s.dist0 || dist))));
      const k = sc / s.z0.s;
      setZ({ s: sc, x: mid.x - (s.mid0!.x - s.z0.x) * k, y: mid.y - (s.mid0!.y - s.z0.y) * k });
      return;
    }
    const ddx = e.clientX - s.start.x;
    const ddy = e.clientY - s.start.y;
    if (!s.moved && Math.hypot(ddx, ddy) > 8) {
      s.moved = true;
      s.mode = z.s > 1.05 ? 'pan' : Math.abs(ddx) > Math.abs(ddy) ? 'page' : 'close';
    }
    if (s.mode === 'pan') setZ(clamp(s.z0.s, s.z0.x + ddx, s.z0.y + ddy));
    else if (s.mode === 'page') setDx(ddx * (i === 0 && ddx > 0 ? 0.3 : i === items.length - 1 && ddx < 0 ? 0.3 : 1));
    else if (s.mode === 'close') setDy(ddy);
  };

  const up = (e: RPointerEvent) => {
    pts.current.delete(e.pointerId);
    const s = g.current;
    if (!s) return;
    if (s.mode === 'pinch') {
      if (pts.current.size === 0) {
        setAnim(true);
        setZ((cur) => (cur.s < 1.05 ? { s: 1, x: 0, y: 0 } : clamp(cur.s, cur.x, cur.y)));
        g.current = undefined;
      }
      return;
    }
    g.current = undefined;
    const fast = Date.now() - s.t0 < 250;
    if (!s.moved) return tap(rel(e));
    if (s.mode === 'page') {
      const { w } = size();
      const ddx = e.clientX - s.start.x;
      if (ddx < -w * 0.2 || (fast && ddx < -40)) go(i + 1);
      else if (ddx > w * 0.2 || (fast && ddx > 40)) go(i - 1);
      else go(i);
    } else if (s.mode === 'close') {
      if (Math.abs(e.clientY - s.start.y) > 110) onClose();
      else {
        setAnim(true);
        setDy(0);
      }
    } else if (s.mode === 'pan') {
      setAnim(true);
      setZ((cur) => clamp(cur.s, cur.x, cur.y));
    }
  };

  if (!it) return null;
  const { w } = size();
  const fade = Math.max(0, 1 - Math.abs(dy) / 400);
  const slides = [i - 1, i, i + 1].filter((n) => n >= 0 && n < items.length);
  return (
    <div className="iv" role="dialog" aria-label={it.title} style={{ background: `rgba(0,0,0,${fade})` }}>
      <div
        ref={stage}
        className="iv-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {slides.map((n) => {
          const item = items[n]!;
          const off = (n - i) * w + dx;
          const cur = n === i;
          const transform = cur ? `translate(${off + z.x}px, ${dy + z.y}px) scale(${z.s * (dy ? Math.max(0.85, fade) : 1)})` : `translateX(${off}px)`;
          return (
            <div key={item.key} className={`iv-slide${anim ? ' anim' : ''}`} style={{ transform }}>
              <img className="iv-ph" src={fileSrc(item.thumbs.find((s) => !s.startsWith('content:')) ?? item.thumbs[0])} alt="" aria-hidden draggable={false} />
              <img ref={cur ? img : undefined} className="iv-img" src={fileSrc(item.file.uri)} alt={item.title} draggable={false} onLoad={(e) => (e.currentTarget.previousElementSibling as HTMLElement | null)?.classList.add('gone')} />
            </div>
          );
        })}
      </div>

      <header className={`iv-top${chrome && !dy ? '' : ' hide'}`}>
        <button type="button" className="iconbtn light" aria-label={t('common.back')} onClick={onClose}>
          <Icon name="back" />
        </button>
        <span className="iv-count">{items.length > 1 ? `${i + 1} / ${items.length}` : ''}</span>
        <button type="button" className="iconbtn light" aria-label={t('act.share')} onClick={() => onShare(it)}>
          <Icon name="share" />
        </button>
        <button type="button" className="iconbtn light" aria-label={t('act.info')} onClick={() => onMenu(it)}>
          <Icon name="more" />
        </button>
      </header>
      <footer className={`iv-bottom${chrome && !dy ? '' : ' hide'}`}>
        <b>{it.title}</b>
        <span>
          {siteInfo(it.site).name}
          {it.w && it.h ? ` · ${it.w}×${it.h}` : ''} · {new Date(it.date).toLocaleDateString()}
        </span>
      </footer>
    </div>
  );
}
