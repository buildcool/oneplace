import { useRef, useState, type ReactNode } from 'react';
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

/** Thumbnail with a placeholder while loading and when the image fails. */
export function Thumb({ src, dur, icon = 'video', square, children }: { src?: string; dur?: number; icon?: IconName; square?: boolean; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`thumb${square ? ' square' : ''}`}>
      {src && !failed ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null}
      {!src || failed ? (
        <span className="ph">
          <Icon name={icon} size={26} />
        </span>
      ) : null}
      {dur ? <span className="dur">{fmtDuration(dur)}</span> : null}
      {children}
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
