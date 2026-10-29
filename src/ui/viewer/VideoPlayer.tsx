import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { duration } from '../../core/format.ts';
import { loadPositions, resLabel, resumeAt, type MediaItem } from '../../core/media.ts';
import type { Settings } from '../../core/settings.ts';
import { siteInfo } from '../../core/sites.ts';
import { livePosition, player, usePlayer, type Orientation } from '../../engine/player.ts';
import { useT } from '../../i18n.ts';
import { useBack } from '../back.ts';
import { Icon } from '../Icon.tsx';
import { SeekBar, useTicker } from '../common.tsx';
import { toPlayItem } from './play.ts';

interface Props {
  items: MediaItem[];
  index: number;
  settings: Settings;
  /** This queue is already playing (back from the mini player): show it without starting again. */
  resume?: boolean;
  /** Small floating window possible on this phone (Android 8+). */
  pipOk: boolean;
  /** keepPlaying: the sound goes on in the background (mini player). */
  onClose: (keepPlaying: boolean) => void;
  onMenu: (it: MediaItem) => void;
  onOpenWith: (it: MediaItem) => void;
  onToast: (text: string) => void;
}

type Side = 'l' | 'c' | 'r';
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const native = Capacitor.isNativePlatform();

/** Landscape videos turn the phone sideways (like MX Player); Shorts and Reels stay upright. */
export function orientOf(w?: number, h?: number): Orientation {
  if (!w || !h) return 'auto';
  return w > h * 1.1 ? 'landscape' : h > w * 1.1 ? 'portrait' : 'auto';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function VideoPlayer(p: Props) {
  const t = useT();
  const ps = usePlayer();
  const cur = p.items.find((x) => x.key === ps.id) ?? p.items[p.index]!;
  const [shown, setShown] = useState(true);
  const [poke, setPoke] = useState(0);
  const [locked, setLocked] = useState(false);
  const [fill, setFill] = useState(false);
  const [rot, setRot] = useState<Orientation>();
  const [speeds, setSpeeds] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hud, setHud] = useState<{ kind: 'bright' | 'vol' | 'seek'; v: number; from?: number } | null>(null);
  const [ripple, setRipple] = useState<{ side: Side; n: number; key: number } | null>(null);
  const [resumed, setResumed] = useState(0);
  const [pip, setPip] = useState(false);
  const now = useTicker(ps.playing && !pip);
  const pos = scrub ?? livePosition(ps, now);
  const vw = ps.videoW || cur.w || 0;
  const vh = ps.videoH || cur.h || 0;

  const close = (keep = false) => p.onClose(keep);
  useBack(true, () => (speeds ? setSpeeds(false) : locked ? setShown(true) : close()));

  // Open: start the queue (unless it already plays), show the picture behind the page, go full screen.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('video-open');
    const first = p.items[p.index]!;
    const saved = loadPositions()[first.file.uri]?.[0];
    const at = !p.resume && p.settings.resume && (first.dur ?? 61) >= 60 ? resumeAt(saved, first.dur) : 0;
    if (!p.resume) void player.load({ items: p.items.map(toPlayItem), index: p.index, position: at, video: true });
    if (at) setResumed(at);
    void player.video({ show: true, fill: false });
    void player.screen({ immersive: true, keepOn: true, orientation: orientOf(first.w, first.h) }).then((s) => (bright.current = s.brightness));
    void player.volume().then((v) => (vol.current = v));
    const off = player.onPip(setPip);
    return () => {
      off();
      root.classList.remove('video-open');
      void player.video({ show: false });
      void player.screen({ immersive: false, keepOn: false, orientation: 'auto', brightness: -1 });
      void player.pipConfig({ auto: false, w: 16, h: 9 });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the real size is known, turn the phone the right way (unless the user rotated by hand).
  useEffect(() => {
    if (!rot) void player.screen({ orientation: orientOf(vw, vh) });
  }, [vw, vh, rot]);

  useEffect(() => {
    void player.pipConfig({ auto: p.settings.leaveVideo === 'pip' && p.pipOk, w: vw || 16, h: vh || 9 });
  }, [p.settings.leaveVideo, p.pipOk, vw, vh]);

  // Leaving the app: the small window takes over by itself; otherwise keep only the sound, or pause.
  useEffect(() => {
    if (!native) return;
    const h = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void player.video({ show: true, fill });
        return;
      }
      window.setTimeout(async () => {
        if (await player.pipActive().catch(() => false)) return;
        if (p.settings.leaveVideo === 'audio') void player.video({ show: false });
        else void player.control('pause');
      }, 400);
    });
    return () => void h.then((x) => x.remove());
  }, [fill, p.settings.leaveVideo]);

  // Controls hide by themselves while playing.
  useEffect(() => {
    if (!shown || scrub !== null || speeds || (!ps.playing && !locked)) return;
    const id = window.setTimeout(() => setShown(false), locked ? 2000 : 3500);
    return () => window.clearTimeout(id);
  }, [shown, ps.playing, scrub, speeds, locked, poke]);

  useEffect(() => {
    if (!resumed) return;
    const id = window.setTimeout(() => setResumed(0), 6000);
    return () => window.clearTimeout(id);
  }, [resumed]);

  useEffect(() => {
    if (!ripple) return;
    const id = window.setTimeout(() => setRipple(null), 650);
    return () => window.clearTimeout(id);
  }, [ripple]);

  const touch = () => {
    setShown(true);
    setPoke((n) => n + 1);
  };

  // ---------- gestures ----------
  const bright = useRef<number | undefined>(undefined);
  const vol = useRef<number | undefined>(undefined);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ x0: number; y0: number; mode?: 'seek' | 'bright' | 'vol' | 'pinch'; base: number; dist0?: number; moved: boolean; target?: number } | undefined>(undefined);
  const lastSend = useRef(0);
  const taps = useRef<{ t: number; side: Side } | undefined>(undefined);
  const burst = useRef<{ side: Side; t: number; n: number } | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);

  const seekTap = (side: Side) => {
    const at = Date.now();
    const b = burst.current;
    const n = b && b.side === side && at - b.t < 800 ? b.n + 1 : 1;
    burst.current = { side, t: at, n };
    void player.control('seekBy', side === 'l' ? -10 : 10);
    setRipple({ side, n, key: at });
  };

  const tap = (x: number, width: number) => {
    const side: Side = x < width * 0.35 ? 'l' : x > width * 0.65 ? 'r' : 'c';
    const at = Date.now();
    if (locked) {
      setShown((v) => !v);
      setPoke((n) => n + 1);
      return;
    }
    const b = burst.current;
    if (b && side !== 'c' && b.side === side && at - b.t < 800) return seekTap(side);
    const prev = taps.current;
    if (prev && at - prev.t < 280 && prev.side === side) {
      window.clearTimeout(tapTimer.current);
      taps.current = undefined;
      if (side === 'c') void player.control('toggle');
      else seekTap(side);
      return;
    }
    taps.current = { t: at, side };
    tapTimer.current = window.setTimeout(() => {
      taps.current = undefined;
      setShown((v) => !v);
      setPoke((n) => n + 1);
    }, 280);
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (pip) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2 && !locked) {
      const [a, b] = [...pts.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      g.current = { x0: 0, y0: 0, mode: 'pinch', base: 0, dist0: Math.hypot(a.x - b.x, a.y - b.y), moved: true };
      return;
    }
    if (pts.current.size === 1) g.current = { x0: e.clientX, y0: e.clientY, base: 0, moved: false };
  };

  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (!s || locked) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (s.mode === 'pinch') {
      if (pts.current.size < 2) return;
      const [a, b] = [...pts.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const want = d > (s.dist0 ?? d) * 1.15 ? true : d < (s.dist0 ?? d) * 0.87 ? false : undefined;
      if (want !== undefined && want !== fill) {
        setFill(want);
        void player.video({ show: true, fill: want });
      }
      return;
    }
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.moved) {
      if (Math.hypot(dx, dy) < 16) return;
      s.moved = true;
      if (Math.abs(dx) > Math.abs(dy)) {
        s.mode = ps.duration > 0 ? 'seek' : undefined;
        s.base = livePosition(ps);
      } else {
        s.mode = s.x0 - r.left < r.width / 2 ? 'bright' : 'vol';
        s.base = (s.mode === 'bright' ? bright.current : vol.current) ?? 0.5;
      }
    }
    if (s.mode === 'seek') {
      const span = Math.min(ps.duration, 180);
      const target = clamp(s.base + (dx / r.width) * span, 0, ps.duration);
      s.target = target;
      setScrub(target);
      setHud({ kind: 'seek', v: target, from: s.base });
    } else if (s.mode === 'bright' || s.mode === 'vol') {
      const v = clamp(s.base - dy / (r.height * 0.7), 0, 1);
      setHud({ kind: s.mode, v });
      const at = Date.now();
      if (at - lastSend.current > 50) {
        lastSend.current = at;
        if (s.mode === 'bright') {
          bright.current = v;
          void player.screen({ brightness: Math.max(0.02, v) });
        } else {
          vol.current = v;
          void player.volume(v);
        }
      }
    }
  };

  const up = (e: RPointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId);
    const s = g.current;
    if (!s || pts.current.size > 0) return;
    g.current = undefined;
    if (s.mode === 'pinch') return;
    if (s.mode === 'seek' && s.target !== undefined) {
      void player.control('seek', s.target);
      setScrub(null);
    }
    if (s.mode === 'bright' && bright.current !== undefined) void player.screen({ brightness: Math.max(0.02, bright.current) });
    if (s.mode === 'vol' && vol.current !== undefined) void player.volume(vol.current);
    if (s.mode) {
      window.setTimeout(() => setHud(null), 500);
      return;
    }
    if (!s.moved) tap(e.clientX - e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().width);
  };

  // ---------- actions ----------
  const toggle = () => {
    touch();
    void player.control(ps.ended ? 'play' : 'toggle');
  };
  const rotate = () => {
    touch();
    const next: Orientation = (rot ?? orientOf(vw, vh)) === 'landscape' ? 'portrait' : 'landscape';
    setRot(next);
    void player.screen({ orientation: next });
  };
  const fillToggle = () => {
    touch();
    setFill(!fill);
    void player.video({ show: true, fill: !fill });
  };
  const goPip = async () => {
    if (!(await player.pip())) p.onToast(t('vp.pipOff'));
  };

  const hasPrev = ps.index > 0;
  const hasNext = ps.index < ps.count - 1;
  const show = !pip && (shown || (!locked && (!ps.playing || scrub !== null)));
  const res = resLabel(vw, vh);
  const waiting = ps.buffering && ps.playWhenReady && !ps.error;

  return (
    <div className={`vp${show ? ' show' : ''}${pip ? ' pip' : ''}`} role="dialog" aria-label={cur.title}>
      <div className="vp-gest" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />

      {ripple ? (
        <div key={ripple.key} className={`vp-ripple ${ripple.side}`} aria-hidden>
          <Icon name={ripple.side === 'l' ? 'replay' : 'refresh'} size={26} />
          <b>{ripple.n * 10} s</b>
        </div>
      ) : null}

      {hud ? (
        <div className={`vp-hud ${hud.kind}`} aria-live="polite">
          {hud.kind === 'seek' ? (
            <>
              <b>{duration(hud.v)}</b>
              <span>
                {hud.v >= (hud.from ?? 0) ? '+' : '−'}
                {duration(Math.abs(hud.v - (hud.from ?? 0)))}
              </span>
            </>
          ) : (
            <>
              <Icon name={hud.kind === 'bright' ? 'sun' : 'volume'} size={20} />
              <span className="vp-level">
                <i style={{ height: `${Math.round(hud.v * 100)}%` }} />
              </span>
              <b>{Math.round(hud.v * 100)}</b>
            </>
          )}
        </div>
      ) : null}

      {waiting && !pip ? <span className="spinner vp-spin" aria-label="…" /> : null}

      {ps.error && !pip ? (
        <div className="vp-error">
          <Icon name="alert" size={30} />
          <b>{t('vp.cantPlay')}</b>
          <span>{t('vp.cantPlaySub')}</span>
          <button type="button" className="btn" onClick={() => p.onOpenWith(cur)}>
            <Icon name="openWith" size={18} /> {t('act.openWith')}
          </button>
          <button type="button" className="btn plain" onClick={() => close()}>
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {resumed && show ? (
        <div className="vp-resume">
          <span>{t('vp.resumed', { time: duration(resumed) })}</span>
          <button
            type="button"
            onClick={() => {
              void player.control('seek', 0);
              setResumed(0);
            }}
          >
            {t('vp.startOver')}
          </button>
        </div>
      ) : null}

      {locked ? (
        show ? (
          <button
            type="button"
            className="vp-unlock"
            onClick={() => {
              setLocked(false);
              touch();
            }}
          >
            <Icon name="unlock" size={20} /> {t('act.unlock')}
          </button>
        ) : null
      ) : (
        <>
          <header className="vp-top">
            <button type="button" className="iconbtn light" aria-label={t('common.back')} onClick={() => close()}>
              <Icon name="back" />
            </button>
            <div className="vp-title">
              <b>{cur.title}</b>
              <span>{[siteInfo(cur.site).name, res, ps.count > 1 ? `${ps.index + 1}/${ps.count}` : ''].filter(Boolean).join(' · ')}</span>
            </div>
            {cur.subs.length ? (
              <button type="button" className={`iconbtn light${ps.subs ? ' on' : ''}`} aria-pressed={ps.subs} aria-label={t('act.subs')} onClick={() => void player.control('subs', ps.subs ? 0 : 1)}>
                <Icon name="cc" />
              </button>
            ) : null}
            <button type="button" className="iconbtn light" aria-label={t('act.info')} onClick={() => p.onMenu(cur)}>
              <Icon name="more" />
            </button>
          </header>

          <div className="vp-mid">
            <button type="button" className="vp-skip" disabled={!hasPrev} aria-label={t('act.prev')} onClick={() => (touch(), void player.control('prev'))}>
              <Icon name="prev" fill size={26} />
            </button>
            <button type="button" className="vp-play" aria-label={ps.playing ? t('act.pause') : t('act.play')} onClick={toggle}>
              {ps.ended ? <Icon name="replay" size={34} /> : ps.playing || waiting ? <Icon name="pause" fill size={34} /> : <Icon name="play" fill size={34} />}
            </button>
            <button type="button" className="vp-skip" disabled={!hasNext} aria-label={t('act.next')} onClick={() => (touch(), void player.control('next'))}>
              <Icon name="next" fill size={26} />
            </button>
          </div>

          <footer className="vp-bottom">
            <div className="vp-time">
              <span>{duration(pos)}</span>
              <span>{duration(ps.duration)}</span>
            </div>
            <SeekBar
              pos={pos}
              dur={ps.duration}
              buffered={ps.buffered}
              label={t('act.seek')}
              onScrub={(s) => {
                setScrub(s);
                setPoke((n) => n + 1);
              }}
              onSeek={(s) => {
                void player.control('seek', s);
                touch();
              }}
            />
            <div className="vp-tools">
              <button
                type="button"
                aria-label={t('act.lock')}
                onClick={() => {
                  setLocked(true);
                  setShown(false);
                }}
              >
                <Icon name="lock" size={20} />
              </button>
              <button type="button" aria-label={t('act.speed')} onClick={() => (touch(), setSpeeds(true))}>
                <span className="vp-speed">{`${ps.speed}×`}</span>
              </button>
              <button type="button" aria-label={fill ? t('act.fit') : t('act.fill')} aria-pressed={fill} onClick={fillToggle}>
                <Icon name={fill ? 'shrink' : 'expand'} size={20} />
              </button>
              <button type="button" aria-label={t('act.rotate')} onClick={rotate}>
                <Icon name="rotate" size={20} />
              </button>
              <button type="button" aria-label={t('act.background')} onClick={() => close(true)}>
                <Icon name="headphones" size={20} />
              </button>
              {p.pipOk ? (
                <button type="button" aria-label={t('act.pip')} onClick={() => void goPip()}>
                  <Icon name="pip" size={20} />
                </button>
              ) : null}
            </div>
          </footer>
        </>
      )}

      {speeds ? (
        <div className="vp-speeds" role="dialog" aria-label={t('act.speed')} onClick={() => setSpeeds(false)}>
          <div className="vp-speed-list" onClick={(e) => e.stopPropagation()}>
            <b>{t('act.speed')}</b>
            {SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={Math.abs(ps.speed - v) < 0.01}
                onClick={() => {
                  void player.control('speed', v);
                  setSpeeds(false);
                  touch();
                }}
              >
                {v === 1 ? `1× · ${t('common.normal')}` : `${v}×`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
