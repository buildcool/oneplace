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
import { Icon, type IconName } from '../Icon.tsx';
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

/** Phone edges where Android's own gestures start (back, system bars): no player gestures there. */
const EDGE_X = 28;
const EDGE_Y = 44;

/** Landscape videos turn the phone sideways (like MX Player); Shorts and Reels stay upright. */
export function orientOf(w?: number, h?: number): Orientation {
  if (!w || !h) return 'auto';
  return w > h * 1.1 ? 'landscape' : h > w * 1.1 ? 'portrait' : 'auto';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // only a preference
  }
}

/** Clear [value] after [ms]: short-lived pills and hints fade away by themselves. */
function useLater(value: unknown, ms: number, clear: () => void) {
  useEffect(() => {
    if (!value) return;
    const id = window.setTimeout(clear, ms);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

function levelIcon(kind: 'bright' | 'vol', v: number): IconName {
  if (kind === 'bright') return v < 0.34 ? 'sunDim' : 'sun';
  return v <= 0.001 ? 'volumeOff' : v < 0.5 ? 'volumeLow' : 'volume';
}

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
  const [seekHud, setSeekHud] = useState<{ to: number; from: number } | null>(null);
  // Brightness/volume: kept after the gesture so the bar can fade out instead of vanishing.
  const [level, setLevel] = useState<{ kind: 'bright' | 'vol'; v: number } | null>(null);
  const [levelOn, setLevelOn] = useState(false);
  const [notice, setNotice] = useState<{ text: string; icon?: IconName; key: number } | null>(null);
  const [boost, setBoost] = useState(false);
  const [ripple, setRipple] = useState<{ side: Side; n: number; key: number } | null>(null);
  const [resumed, setResumed] = useState(0);
  const [pip, setPip] = useState(false);
  const [remain, setRemain] = useState(() => readFlag('op.vpRemain'));
  const [tip, setTip] = useState(() => !readFlag('op.vpTip'));
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
      if (scrubbing.current) void player.control('scrubEnd', scrubAt.current);
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

  // Pausing or reaching the end brings the controls back (a tap can still hide them, to see the frame clean).
  useEffect(() => {
    if (!ps.playing && !scrubbing.current && !boost) setShown(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ps.playing, ps.ended]);

  // Controls hide by themselves while playing.
  useEffect(() => {
    if (!shown || scrub !== null || speeds || (!ps.playing && !locked)) return;
    const id = window.setTimeout(() => setShown(false), locked ? 2000 : 3500);
    return () => window.clearTimeout(id);
  }, [shown, ps.playing, scrub, speeds, locked, poke]);

  useLater(resumed, 6000, () => setResumed(0));
  useLater(ripple, 700, () => setRipple(null));
  useLater(notice, 1300, () => setNotice(null));
  useLater(tip, 7000, () => dismissTip());

  const touch = () => {
    setShown(true);
    setPoke((n) => n + 1);
  };
  const say = (text: string, icon?: IconName) => setNotice({ text, icon, key: Date.now() });
  const dismissTip = () => {
    if (!tip) return;
    setTip(false);
    writeFlag('op.vpTip', true);
  };

  // ---------- scrubbing: the picture follows the finger, then one exact seek at the end ----------
  const scrubbing = useRef(false);
  const scrubAt = useRef(0);
  const lastScrub = useRef(0);
  const scrubTo = (sec: number) => {
    scrubAt.current = sec;
    if (!scrubbing.current) {
      scrubbing.current = true;
      void player.control('scrubStart');
    }
    const at = Date.now();
    if (at - lastScrub.current > 90) {
      lastScrub.current = at;
      void player.control('scrub', sec);
    }
  };
  const scrubDone = (sec: number) => {
    if (scrubbing.current) {
      scrubbing.current = false;
      void player.control('scrubEnd', sec);
    } else void player.control('seek', sec);
  };

  // ---------- gestures ----------
  const bright = useRef<number | undefined>(undefined);
  const vol = useRef<number | undefined>(undefined);
  const boostFrom = useRef(1);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<
    { x0: number; y0: number; mode?: 'seek' | 'bright' | 'vol' | 'pinch' | 'boost' | 'none'; base: number; dist0?: number; moved: boolean; target?: number; last?: number } | undefined
  >(undefined);
  const lastSend = useRef(0);
  const holdTimer = useRef<number | undefined>(undefined);
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

  const endBoost = () => {
    if (!boost) return;
    setBoost(false);
    void player.control('speed', boostFrom.current);
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (pip) return;
    dismissTip();
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    window.clearTimeout(holdTimer.current);
    if (pts.current.size === 2 && !locked) {
      const [a, b] = [...pts.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      g.current = { x0: 0, y0: 0, mode: 'pinch', base: 0, dist0: Math.hypot(a.x - b.x, a.y - b.y), moved: true };
      return;
    }
    if (pts.current.size !== 1) return;
    g.current = { x0: e.clientX, y0: e.clientY, base: 0, moved: false };
    // Press and hold: 2× speed while the finger stays down (like YouTube).
    if (!locked && ps.playing) {
      holdTimer.current = window.setTimeout(() => {
        const s = g.current;
        if (!s || s.moved || s.mode) return;
        s.mode = 'boost';
        boostFrom.current = ps.speed;
        setBoost(true);
        setShown(false);
        navigator.vibrate?.(15);
        void player.control('speed', 2);
      }, 450);
    }
  };

  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (!s || locked || s.mode === 'boost' || s.mode === 'none') return;
    const r = e.currentTarget.getBoundingClientRect();
    if (s.mode === 'pinch') {
      if (pts.current.size < 2) return;
      const [a, b] = [...pts.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const want = d > (s.dist0 ?? d) * 1.15 ? true : d < (s.dist0 ?? d) * 0.87 ? false : undefined;
      if (want !== undefined && want !== fill) {
        setFill(want);
        void player.video({ show: true, fill: want });
        say(want ? t('act.fill') : t('act.fit'), want ? 'expand' : 'shrink');
      }
      return;
    }
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.moved) {
      if (Math.hypot(dx, dy) < 16) return;
      s.moved = true;
      window.clearTimeout(holdTimer.current);
      const x0 = s.x0 - r.left;
      const y0 = s.y0 - r.top;
      if (Math.abs(dx) > Math.abs(dy)) {
        // Not from the very sides: that is Android's back gesture.
        s.mode = ps.duration > 0 && x0 > EDGE_X && x0 < r.width - EDGE_X ? 'seek' : 'none';
        s.base = livePosition(ps);
      } else {
        // Not from the very top or bottom: that pulls Android's bars in.
        s.mode = y0 < EDGE_Y || y0 > r.height - EDGE_Y ? 'none' : x0 < r.width / 2 ? 'bright' : 'vol';
        s.base = (s.mode === 'bright' ? bright.current : vol.current) ?? 0.5;
      }
      if (s.mode === 'none') return;
    }
    if (s.mode === 'seek') {
      const span = Math.min(ps.duration, 180);
      const target = clamp(s.base + (dx / r.width) * span, 0, ps.duration);
      s.target = target;
      setScrub(target);
      setSeekHud({ to: target, from: s.base });
      scrubTo(target);
    } else if (s.mode === 'bright' || s.mode === 'vol') {
      const v = clamp(s.base - dy / (r.height * 0.7), 0, 1);
      // A small tick when it reaches the top or the bottom.
      if ((v === 0 || v === 1) && s.last !== v) navigator.vibrate?.(8);
      s.last = v;
      setLevel({ kind: s.mode, v });
      setLevelOn(true);
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
    window.clearTimeout(holdTimer.current);
    const s = g.current;
    if (!s || pts.current.size > 0) return;
    g.current = undefined;
    if (s.mode === 'pinch' || s.mode === 'none') return;
    if (s.mode === 'boost') return endBoost();
    if (s.mode === 'seek' && s.target !== undefined) {
      scrubDone(s.target);
      setScrub(null);
      setSeekHud(null);
      return;
    }
    if (s.mode === 'bright' || s.mode === 'vol') {
      if (s.mode === 'bright' && bright.current !== undefined) void player.screen({ brightness: Math.max(0.02, bright.current) });
      if (s.mode === 'vol' && vol.current !== undefined) void player.volume(vol.current);
      window.setTimeout(() => setLevelOn(false), 600);
      return;
    }
    if (!s.moved) {
      const r = e.currentTarget.getBoundingClientRect();
      tap(e.clientX - r.left, r.width);
    }
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
    say(!fill ? t('act.fill') : t('act.fit'), !fill ? 'expand' : 'shrink');
  };
  const goPip = async () => {
    if (!(await player.pip())) p.onToast(t('vp.pipOff'));
  };

  const hasPrev = ps.index > 0;
  const hasNext = ps.index < ps.count - 1;
  // Dragging the seek bar keeps the controls up; swiping over the picture shows only the pill, so the
  // frames being scrubbed through are not dimmed.
  const show = !pip && !boost && !seekHud && (shown || (!locked && scrub !== null));
  const res = resLabel(vw, vh);
  // While scrubbing the player holds still on purpose: no spinner for that.
  const waiting = ps.buffering && ps.playWhenReady && !ps.error && scrub === null;
  const pct = (v: number) => `${ps.duration > 0 ? Math.min(100, (v / ps.duration) * 100) : 0}%`;
  const seekDelta = seekHud ? seekHud.to - seekHud.from : 0;

  return (
    <div className={`vp${show ? ' show' : ''}${pip ? ' pip' : ''}`} role="dialog" aria-label={cur.title}>
      <div className="vp-gest" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />

      {ripple ? (
        <div key={ripple.key} className={`vp-ripple ${ripple.side}`} aria-hidden>
          <span className="vp-arrows">
            <i />
            <i />
            <i />
          </span>
          <b>{ripple.n * 10} s</b>
        </div>
      ) : null}

      {level ? (
        <div className={`vp-level ${level.kind === 'bright' ? 'l' : 'r'}${levelOn ? ' on' : ''}`} role="status" aria-label={`${t(level.kind === 'bright' ? 'vp.brightness' : 'vp.volume')} ${Math.round(level.v * 100)}%`}>
          <Icon name={levelIcon(level.kind, level.v)} size={18} />
          <span className="vp-level-track">
            <i style={{ height: `${Math.round(level.v * 100)}%` }} />
          </span>
          <span className="vp-level-num">{Math.round(level.v * 100)}</span>
        </div>
      ) : null}

      {seekHud ? (
        <div className="vp-pill" role="status">
          <b>
            {seekDelta >= 0 ? '+' : '−'}
            {duration(Math.abs(seekDelta))}
          </b>
          <span>
            {duration(seekHud.to)} / {duration(ps.duration)}
          </span>
        </div>
      ) : boost ? (
        <div className="vp-pill" role="status">
          <Icon name="fast" size={16} fill />
          <b>{t('vp.boost')}</b>
        </div>
      ) : notice ? (
        <div key={notice.key} className="vp-pill" role="status">
          {notice.icon ? <Icon name={notice.icon} size={16} /> : null}
          <span>{notice.text}</span>
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

      {resumed && show && !speeds ? (
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

      {tip && !pip && !ps.error ? (
        <button type="button" className="vp-tip" onClick={dismissTip}>
          {t('vp.tip')}
        </button>
      ) : null}

      {!show && !pip && ps.duration > 0 ? (
        <span className="vp-thin" aria-hidden>
          <i style={{ width: pct(pos) }} />
        </span>
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
            {speeds ? (
              <div className="vp-speedbar" role="radiogroup" aria-label={t('act.speed')}>
                {SPEEDS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={Math.abs(ps.speed - v) < 0.01}
                    onClick={() => {
                      void player.control('speed', v);
                      setSpeeds(false);
                      touch();
                    }}
                  >
                    {v === 1 ? t('common.normal') : `${v}×`}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="vp-time">
              <span>{duration(pos)}</span>
              <button
                type="button"
                aria-label={t('vp.timeLeft')}
                onClick={() => {
                  touch();
                  setRemain(!remain);
                  writeFlag('op.vpRemain', !remain);
                }}
              >
                {remain && ps.duration > 0 ? `−${duration(Math.max(0, ps.duration - pos))}` : duration(ps.duration)}
              </button>
            </div>
            <SeekBar
              pos={pos}
              dur={ps.duration}
              buffered={ps.buffered}
              label={t('act.seek')}
              onScrub={(s) => {
                setPoke((n) => n + 1);
                if (s === null) {
                  setScrub(null);
                  // Cancelled drag: settle where the finger was.
                  if (scrubbing.current) scrubDone(scrubAt.current);
                  return;
                }
                setScrub(s);
                scrubTo(s);
              }}
              onSeek={(s) => {
                scrubDone(s);
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
                  setSpeeds(false);
                  say(t('vp.locked'), 'lock');
                }}
              >
                <Icon name="lock" size={20} />
              </button>
              <button type="button" aria-label={t('act.speed')} aria-expanded={speeds} className={speeds ? 'on' : ''} onClick={() => (touch(), setSpeeds(!speeds))}>
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
    </div>
  );
}
