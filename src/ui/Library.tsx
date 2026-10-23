import { Capacitor } from '@capacitor/core';
import { useState } from 'react';
import { bytes } from '../core/format.ts';
import type { Job } from '../core/types.ts';
import { useT } from '../i18n.ts';
import { Icon } from './Icon.tsx';
import { Empty, Thumb } from './common.tsx';
import { jobIcon, totalSize } from './jobs.ts';

type Filter = 'all' | 'video' | 'audio' | 'image';

/** Local preview for photos we saved (content:// works through Capacitor's local server). */
export function previewOf(j: Job): string | undefined {
  const img = j.files.find((f) => f.mime.startsWith('image/'));
  if (img?.uri && Capacitor.isNativePlatform()) return Capacitor.convertFileSrc(img.uri);
  return j.thumb;
}

export function Library({ jobs, onOpen, onMenu }: { jobs: Job[]; onOpen: (j: Job) => void; onMenu: (j: Job) => void }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const done = jobs.filter((j) => j.status === 'done');
  const shown = done.filter((j) => filter === 'all' || j.dest === filter);
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('lib.all') },
    { id: 'video', label: t('lib.videos') },
    { id: 'audio', label: t('lib.music') },
    { id: 'image', label: t('lib.photos') },
  ];
  return (
    <>
      <header className="topbar">
        <h1>{t('tab.library')}</h1>
      </header>
      <main className="page">
        <div className="chips" style={{ marginBottom: 14 }}>
          {filters.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="muted small">{f.id === 'all' ? done.length : done.filter((j) => j.dest === f.id).length}</span>
            </button>
          ))}
        </div>
        {!shown.length ? (
          <Empty icon="grid" title={t('lib.empty')} sub={t('lib.where')} />
        ) : (
          <div className="grid">
            {shown.map((j) => (
              <button
                key={j.id}
                type="button"
                className="tile"
                onClick={() => onOpen(j)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMenu(j);
                }}
              >
                <Thumb src={previewOf(j)} icon={jobIcon(j)} square={j.dest === 'image'}>
                  <span className="kind">
                    <Icon name={jobIcon(j)} size={15} />
                  </span>
                </Thumb>
                <div className="t">{j.title}</div>
                <div className="m">
                  {[bytes(totalSize(j)), j.files.length > 1 ? `${j.files.length} files` : '', j.finishedAt ? new Date(j.finishedAt).toLocaleDateString() : '']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </button>
            ))}
          </div>
        )}
        <p className="note" style={{ textAlign: 'center', marginTop: 18 }}>
          {t('lib.where')}
        </p>
      </main>
    </>
  );
}

