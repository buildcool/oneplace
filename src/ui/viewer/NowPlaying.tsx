import { useRef, useState } from 'react';
import { duration } from '../../core/format.ts';
import type { MediaItem } from '../../core/media.ts';
import { siteInfo } from '../../core/sites.ts';
import { livePosition, player, usePlayer } from '../../engine/player.ts';
import { useT } from '../../i18n.ts';
import { useBack } from '../back.ts';
import { Icon } from '../Icon.tsx';
import { Eq } from '../Library.tsx';
import { fileSrc, SeekBar, Sheet, Thumb, useTicker } from '../common.tsx';

interface Props {
  cur?: MediaItem;
  queue: MediaItem[];
  /** The karaoke copy of this song, or the original when this is the karaoke copy. */
  alt?: MediaItem;
  onClose: () => void;
  onMenu: (it: MediaItem) => void;
  onSwap: (to: MediaItem) => void;
  /** A video playing as sound only: show its picture again. */
  onWatch: () => void;
  onToast: (text: string) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP = [15, 30, 45, 60];

/** Full-screen music player: big cover, seek bar, shuffle/repeat, speed, sleep timer, up next. */
export function NowPlaying({ cur, queue, alt, onClose, onMenu, onSwap, onWatch, onToast }: Props) {
  const t = useT();
  const ps = usePlayer();
  const [sheet, setSheet] = useState<'sleep' | 'queue' | undefined>();
  const [scrub, setScrub] = useState<number | null>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | undefined>(undefined);
  const now = useTicker(ps.playing || ps.sleepAt > 0, 250);
  const pos = scrub ?? livePosition(ps, now);
  useBack(true, onClose);

  const cover = cur?.thumbs ?? [];
  const bg = fileSrc(cover.find((s) => !s.startsWith('content:')));
  const repeat = ps.repeat === 'one' ? 2 : ps.repeat === 'all' ? 1 : 0;
  const sleepLeft = ps.sleepAt > 0 ? Math.max(0, (ps.sleepAt - now) / 1000) : 0;
  const isKaraoke = cur?.stem === 'music';

  return (
    <div className="np" role="dialog" aria-label={t('np.title')} style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}>
      <div className="np-bg" aria-hidden>
        {bg ? <img src={bg} alt="" /> : null}
      </div>
      <header
        className="np-top"
        onPointerDown={(e) => {
          start.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => start.current !== undefined && setDrag(Math.max(0, e.clientY - start.current))}
        onPointerUp={() => {
          if (drag > 100) onClose();
          start.current = undefined;
          setDrag(0);
        }}
      >
        <button type="button" className="iconbtn light" aria-label={t('act.minimize')} onClick={onClose}>
          <Icon name="down" size={26} />
        </button>
        <span className="np-cap">{t('np.title')}</span>
        {cur ? (
          <button type="button" className="iconbtn light" aria-label={t('act.info')} onClick={() => onMenu(cur)}>
            <Icon name="more" />
          </button>
        ) : (
          <span style={{ width: 42 }} />
        )}
      </header>

      <div className={`np-art${ps.playing ? ' on' : ''}`}>
        <Thumb srcs={cover} icon={cur?.kind === 'video' ? 'video' : 'music'} square>
          {cur?.kind === 'video' ? (
            <button type="button" className="np-watch" onClick={onWatch}>
              <Icon name="video" size={18} /> {t('act.view')}
            </button>
          ) : null}
        </Thumb>
      </div>

      <div className="np-meta">
        <h2>{cur?.title ?? '…'}</h2>
        <p>{cur ? [cur.artist, siteInfo(cur.site).name].filter(Boolean).join(' · ') : ''}</p>
        {alt ? (
          <button type="button" className="np-vocals" role="switch" aria-checked={!isKaraoke} onClick={() => onSwap(alt)}>
            <Icon name={isKaraoke ? 'micOff' : 'mic'} size={16} />
            {t('np.vocals')}
            <span className="switch" aria-checked={!isKaraoke} />
          </button>
        ) : null}
      </div>

      <div className="np-seek">
        <SeekBar
          pos={pos}
          dur={ps.duration}
          buffered={ps.buffered}
          label={t('act.seek')}
          onScrub={setScrub}
          onSeek={(s) => void player.control('seek', s)}
        />
        <div className="np-times">
          <span>{duration(pos)}</span>
          <span>{duration(ps.duration)}</span>
        </div>
      </div>

      <div className="np-controls">
        <button type="button" className={`iconbtn light${ps.shuffle ? ' on' : ''}`} aria-pressed={ps.shuffle} aria-label={t('lib.shuffle')} onClick={() => void player.control('shuffle', ps.shuffle ? 0 : 1)}>
          <Icon name="shuffle" />
        </button>
        <button type="button" className="np-skip" aria-label={t('act.prev')} onClick={() => void player.control('prev')}>
          <Icon name="prev" fill size={30} />
        </button>
        <button type="button" className="np-play" aria-label={ps.playing ? t('act.pause') : t('act.play')} onClick={() => void player.control(ps.ended ? 'play' : 'toggle')}>
          {ps.playing || (ps.buffering && ps.playWhenReady) ? <Icon name="pause" fill size={34} /> : <Icon name="play" fill size={34} />}
        </button>
        <button type="button" className="np-skip" aria-label={t('act.next')} disabled={ps.index >= ps.count - 1 && ps.repeat !== 'all'} onClick={() => void player.control('next')}>
          <Icon name="next" fill size={30} />
        </button>
        <button type="button" className={`iconbtn light${repeat ? ' on' : ''}`} aria-label={t('act.repeat')} aria-pressed={repeat > 0} onClick={() => void player.control('repeat', (repeat + 1) % 3)}>
          <Icon name={repeat === 2 ? 'repeatOne' : 'repeat'} />
        </button>
      </div>

      <div className="np-extra">
        <button
          type="button"
          onClick={() => {
            const next = SPEEDS[(SPEEDS.findIndex((v) => Math.abs(v - ps.speed) < 0.01) + 1) % SPEEDS.length]!;
            void player.control('speed', next);
          }}
          aria-label={t('act.speed')}
        >
          <Icon name="speed" size={20} />
          <span>{`${ps.speed}×`}</span>
        </button>
        <button type="button" className={ps.sleepAt ? 'on' : ''} onClick={() => setSheet('sleep')} aria-label={t('act.sleep')}>
          <Icon name="timer" size={20} />
          <span>{ps.sleepAt === -1 ? t('np.sleepEnd') : sleepLeft ? duration(sleepLeft) : t('act.sleep')}</span>
        </button>
        <button type="button" onClick={() => setSheet('queue')} aria-label={t('act.queue')}>
          <Icon name="queue" size={20} />
          <span>{ps.count > 1 ? `${ps.index + 1}/${ps.count}` : t('act.queue')}</span>
        </button>
      </div>

      {sheet === 'sleep' ? (
        <Sheet onClose={() => setSheet(undefined)} label={t('act.sleep')}>
          <h3>{t('act.sleep')}</h3>
          <div className="card group" style={{ marginBottom: 12 }}>
            {SLEEP.map((m) => (
              <button
                key={m}
                type="button"
                className="row"
                onClick={() => {
                  void player.control('sleep', m);
                  onToast(t('np.sleepSet', { n: m }));
                  setSheet(undefined);
                }}
              >
                <Icon name="timer" />
                <span className="grow title">{t('np.sleepMin', { n: m })}</span>
              </button>
            ))}
            <button
              type="button"
              className="row"
              onClick={() => {
                void player.control('sleep', -1);
                onToast(t('np.sleepSong'));
                setSheet(undefined);
              }}
            >
              <Icon name="music" />
              <span className="grow title">{t('np.sleepEnd')}</span>
            </button>
            {ps.sleepAt ? (
              <button
                type="button"
                className="row"
                onClick={() => {
                  void player.control('sleep', 0);
                  setSheet(undefined);
                }}
              >
                <Icon name="close" />
                <span className="grow title">{t('common.off')}</span>
              </button>
            ) : null}
          </div>
        </Sheet>
      ) : null}

      {sheet === 'queue' ? (
        <Sheet onClose={() => setSheet(undefined)} label={t('act.queue')}>
          <h3>{t('act.queue')}</h3>
          <div className="card songs" style={{ marginBottom: 12 }}>
            {queue.map((it, i) => (
              <div key={it.key} className={`song${it.key === ps.id ? ' now' : ''}`}>
                <button
                  type="button"
                  className="song-main"
                  onClick={() => {
                    void player.control('jump', i);
                    setSheet(undefined);
                  }}
                >
                  <Thumb srcs={it.thumbs} icon={it.kind === 'video' ? 'video' : 'music'} square>
                    {it.key === ps.id ? <Eq /> : null}
                  </Thumb>
                  <span className="grow">
                    <span className="title">{it.title}</span>
                    <span className="sub">{[it.artist, it.dur ? duration(it.dur) : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

/** Small bar above the tabs while something plays: tap to open the player. */
export function MiniPlayer({ cur, onOpen }: { cur?: MediaItem; onOpen: () => void }) {
  const t = useT();
  const ps = usePlayer();
  const now = useTicker(ps.playing, 500);
  const pos = livePosition(ps, now);
  const pct = ps.duration > 0 ? Math.min(100, (pos / ps.duration) * 100) : 0;
  return (
    <div className="mini" role="region" aria-label={t('np.title')}>
      <button type="button" className="mini-main" onClick={onOpen}>
        <Thumb srcs={cur?.thumbs ?? []} icon={cur?.kind === 'video' ? 'video' : 'music'} square>
          {ps.playing ? <Eq /> : null}
        </Thumb>
        <span className="grow">
          <b>{cur?.title ?? '…'}</b>
          <span>{cur ? cur.artist ?? siteInfo(cur.site).name : ''}</span>
        </span>
      </button>
      <button type="button" className="iconbtn" aria-label={ps.playing ? t('act.pause') : t('act.play')} onClick={() => void player.control(ps.ended ? 'play' : 'toggle')}>
        <Icon name={ps.playing ? 'pause' : 'play'} fill />
      </button>
      {ps.index < ps.count - 1 ? (
        <button type="button" className="iconbtn" aria-label={t('act.next')} onClick={() => void player.control('next')}>
          <Icon name="next" fill />
        </button>
      ) : (
        <button type="button" className="iconbtn" aria-label={t('act.stop')} onClick={() => void player.control('stop')}>
          <Icon name="close" />
        </button>
      )}
      <i className="mini-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
