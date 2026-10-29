import { Capacitor } from '@capacitor/core';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { duration as fmtDuration } from '../core/format.ts';
import { siteInfo } from '../core/sites.ts';
import { useBack } from './back.ts';
import { Icon, type IconName } from './Icon.tsx';

export function SiteAvatar({ site, size }: { site: string; size?: number }) {
  const s = siteInfo(site);
  const light = ['#FFFC00', '#25F4EE', '#53FC18'].includes(s.color);
  return (
    <span className="avatar" style={{ background: s.color, color: light ? '#111' : '#fff', ...(size ? { width: size, height: size } : {}) }} aria-hidden>
      {s.name[0]}
    </span>
  );
}

/** A picture the WebView can load: files on the phone and content:// go through Capacitor's local server. */
export function fileSrc(s?: string): string | undefined {
  if (!s) return undefined;
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  if (!Capacitor.isNativePlatform()) return /^(mock|content|file):/.test(s) || s.startsWith('/') ? undefined : s;
  return Capacitor.convertFileSrc(s.startsWith('/') ? `file://${s}` : s);
}

/**
 * Thumbnail that tries each picture in turn (the phone's own copy first, then the site's, then a frame
 * from the video) and shows an icon when none loads. "blur" fills the frame with a blurred copy, for
 * pictures that do not match its shape (vertical videos in a wide tile).
 */
export function Thumb({
  src,
  srcs,
  dur,
  icon = 'video',
  square,
  blur,
  children,
}: {
  src?: string;
  srcs?: string[];
  dur?: number;
  icon?: IconName;
  square?: boolean;
  blur?: boolean;
  children?: ReactNode;
}) {
  const list = useMemo(() => (srcs ?? (src ? [src] : [])).map(fileSrc).filter((x): x is string => !!x), [src, srcs?.join('|')]);
  const [failed, setFailed] = useState<string[]>([]);
  const cur = list.find((x) => !failed.includes(x));
  return (
    <div className={`thumb${square ? ' square' : ''}${blur && cur ? ' blur' : ''}`}>
      {cur ? (
        <>
          {blur ? <img className="bg" src={cur} alt="" aria-hidden referrerPolicy="no-referrer" /> : null}
          <img key={cur} src={cur} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed((f) => [...f, cur])} />
        </>
      ) : (
        <span className="ph">
          <Icon name={icon} size={26} />
        </span>
      )}
      {dur ? <span className="dur">{fmtDuration(dur)}</span> : null}
      {children}
    </div>
  );
}

/** Re-render every [ms] while [on] (a playing clock). */
export function useTicker(on: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}

/** Tap, or press and hold (~0.45 s) without moving: for tiles that can be selected. */
export function usePress(onTap: () => void, onLong: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const longed = useRef(false);
  const stop = () => {
    window.clearTimeout(timer.current);
    start.current = undefined;
  };
  return {
    onPointerDown: (e: RPointerEvent) => {
      longed.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        longed.current = true;
        navigator.vibrate?.(18);
        onLong();
      }, 450);
    },
    onPointerMove: (e: RPointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onClick: () => {
      if (!longed.current) onTap();
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

/** Seek bar: drag (with a time bubble) or tap to jump. [onScrub] gets the time while dragging, then null. */
export function SeekBar({
  pos,
  dur,
  buffered = 0,
  onSeek,
  onScrub,
  label,
}: {
  pos: number;
  dur: number;
  buffered?: number;
  onSeek: (sec: number) => void;
  onScrub?: (sec: number | null) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * dur;
  };
  const pct = (v: number) => `${dur > 0 ? Math.min(100, Math.max(0, (v / dur) * 100)) : 0}%`;
  const shown = drag ?? pos;
  return (
    <div
      ref={ref}
      className={`seek${drag !== null ? ' dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(dur)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={fmtDuration(shown)}
      onPointerDown={(e) => {
        if (!dur) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const s = at(e.clientX);
        setDrag(s);
        onScrub?.(s);
      }}
      onPointerMove={(e) => {
        if (drag === null) return;
        const s = at(e.clientX);
        setDrag(s);
        onScrub?.(s);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        onSeek(at(e.clientX));
        setDrag(null);
        onScrub?.(null);
      }}
      onPointerCancel={() => {
        setDrag(null);
        onScrub?.(null);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, pos - 5));
        if (e.key === 'ArrowRight') onSeek(Math.min(dur, pos + 5));
      }}
    >
      <div className="track">
        <i className="buf" style={{ width: pct(buffered) }} />
        <i className="fill" style={{ width: pct(shown) }} />
      </div>
      <i className="knob" style={{ left: pct(shown) }} />
      {drag !== null ? (
        <span className="bubble" style={{ left: pct(drag) }}>
          {fmtDuration(drag)}
        </span>
      ) : null}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  const indet = value < 0;
  return (
    <div className={`progress${indet ? ' indet' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indet ? undefined : Math.round(value)}>
      <i style={{ width: `${indet ? 35 : Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={String(o.id)} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bottom sheet: closes on scrim tap, Android back, or a downward swipe on the handle. */
export function Sheet({ onClose, children, foot, label }: { onClose: () => void; children: ReactNode; foot?: ReactNode; label: string }) {
  useBack(true, onClose);
  const start = useRef<number | undefined>(undefined);
  const [drag, setDrag] = useState(0);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}>
        <div
          className="grab"
          onPointerDown={(e) => {
            start.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current !== undefined && setDrag(Math.max(0, e.clientY - start.current))}
          onPointerUp={() => {
            if (drag > 90) onClose();
            start.current = undefined;
            setDrag(0);
          }}
        />
        <div className="body">{children}</div>
        {foot ? <div className="foot">{foot}</div> : null}
      </div>
    </>
  );
}

export function Empty({ icon, title, sub, children }: { icon: IconName; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="art">
        <Icon name={icon} size={40} />
      </div>
      <b>{title}</b>
      {sub ? <span>{sub}</span> : null}
      {children}
    </div>
  );
}

export function Row({
  icon,
  title,
  sub,
  trail,
  onClick,
  children,
}: {
  icon?: IconName;
  title: ReactNode;
  sub?: ReactNode;
  trail?: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const inner = (
    <>
      {icon ? (
        <span className="ic">
          <Icon name={icon} />
        </span>
      ) : null}
      <span className="grow">
        <span className="title">{title}</span>
        {sub ? <span className="sub">{sub}</span> : null}
      </span>
      {trail !== undefined ? <span className="trail">{trail}</span> : onClick ? <Icon name="chevron" size={18} /> : null}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className="row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="row">{inner}</div>
  );
}

/** A row whose trailing control is a switch; the whole row toggles. */
export function SwitchRow({ icon, title, sub, on, onChange }: { icon?: IconName; title: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="row" onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      {icon ? (
        <span className="ic">
          <Icon name={icon} />
        </span>
      ) : null}
      <span className="grow">
        <span className="title">{title}</span>
        {sub ? <span className="sub">{sub}</span> : null}
      </span>
      <span className="switch" aria-checked={on} />
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {action}
    </div>
  );
}

export function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  useBack(true, onBack);
  return (
    <>
      <header className="topbar subpage-head">
        <button type="button" className="iconbtn" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1>{title}</h1>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
