import { useState } from 'react';
import { displayHost, siteOf } from '../../core/browser.ts';
import { SiteAvatar, fileSrc } from '../common.tsx';

const COLORS = ['#5b4cf0', '#0ea5e9', '#16a34a', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#f97316', '#64748b', '#db2777'];

/** A stable colour for a host, for letter avatars of sites OnePlace has no colour for. */
export function hostColor(host: string): string {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}

/** The site's own icon once seen, else OnePlace's avatar for known sites, else a letter. */
export function SiteIcon({ url, icon, size = 40 }: { url: string; icon?: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const src = icon && !bad ? fileSrc(icon) : undefined;
  if (src) return <img className="site-ico" src={src} alt="" style={{ width: size, height: size }} onError={() => setBad(true)} />;
  const site = siteOf(url);
  if (site) return <SiteAvatar site={site} size={size} />;
  const host = displayHost(url);
  return (
    <span className="avatar" style={{ width: size, height: size, background: hostColor(host), color: '#fff' }} aria-hidden>
      {(host[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** "16:05" today, "Mon 16:05" this week, else the date. */
export function timeLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (now - at < 86_400_000 && new Date(now).getDate() === d.getDate()) return hm;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
