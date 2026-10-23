import { useState } from 'react';
import { explain } from '../core/errors.ts';
import type { Job } from '../core/types.ts';
import { useT, type Key } from '../i18n.ts';
import { Icon } from './Icon.tsx';
import { Empty, Progress, SectionTitle, SiteAvatar, Thumb } from './common.tsx';
import { failDetail, jobIcon, jobLine } from './jobs.ts';

interface Props {
  jobs: Job[];
  onCancel: (j: Job) => void;
  onRetry: (j: Job) => void;
  onFix: (j: Job) => void;
  onOpen: (j: Job) => void;
  onMenu: (j: Job) => void;
  onClearFinished: () => void;
}

export function Downloads(p: Props) {
  const t = useT();
  const active = p.jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'paused');
  const failed = p.jobs.filter((j) => j.status === 'failed');
  const done = p.jobs.filter((j) => j.status === 'done' || j.status === 'canceled');
  return (
    <>
      <header className="topbar">
        <h1>{t('tab.downloads')}</h1>
        {done.length ? (
          <button type="button" className="btn small plain" onClick={p.onClearFinished}>
            {t('dl.clear')}
          </button>
        ) : null}
      </header>
      <main className="page">
        {!p.jobs.length ? <Empty icon="download" title={t('dl.empty')} sub={t('dl.emptySub')} /> : null}
        {active.length ? (
          <>
            <SectionTitle>{t('dl.active')}</SectionTitle>
            <div className="jobs">
              {active.map((j) => (
                <JobCard key={j.id} j={j} {...p} />
              ))}
            </div>
          </>
        ) : null}
        {failed.length ? (
          <>
            <SectionTitle>{t('dl.failed')}</SectionTitle>
            <div className="jobs">
              {failed.map((j) => (
                <JobCard key={j.id} j={j} {...p} />
              ))}
            </div>
          </>
        ) : null}
        {done.length ? (
          <>
            <SectionTitle>{t('dl.done')}</SectionTitle>
            <div className="jobs">
              {done.slice(0, 200).map((j) => (
                <JobCard key={j.id} j={j} {...p} />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

function JobCard({ j, onCancel, onRetry, onFix, onOpen, onMenu }: Props & { j: Job }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const running = j.status === 'running' || j.status === 'queued';
  const fix = j.status === 'failed' ? explain(j.error).fix : 'none';
  return (
    <div className={`card job${j.status === 'failed' ? ' failed' : ''}`}>
      <button type="button" onClick={() => (j.status === 'done' ? onOpen(j) : onMenu(j))} aria-label={j.title}>
        <Thumb src={j.thumb} icon={jobIcon(j)} />
      </button>
      <div className="info">
        <div className="title">{j.title}</div>
        <div className="meta">
          <SiteAvatar site={j.site} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.status === 'failed' ? t('dl.failed') : jobLine(j, t)}</span>
        </div>
        {running ? <Progress value={j.status === 'queued' ? -1 : j.progress} /> : null}
        {j.status === 'failed' ? (
          <>
            <div className="err">{jobLine(j, t)}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {fix !== 'none' && fix !== 'retry' && fix !== 'report' ? (
                <button type="button" className="btn small" onClick={() => onFix(j)}>
                  {t(`fix.${fix}` as Key)}
                </button>
              ) : null}
              <button type="button" className="btn small tonal" onClick={() => onRetry(j)}>
                <Icon name="refresh" size={16} /> {t('act.retry')}
              </button>
              <button type="button" className="btn small ghost" onClick={() => setMore((m) => !m)}>
                {t('act.details')}
              </button>
            </div>
            {more ? <div className="mono" style={{ marginTop: 8 }}>{failDetail(j)}</div> : null}
          </>
        ) : null}
      </div>
      <div className="actions">
        {running ? (
          <button type="button" className="iconbtn" aria-label={t('act.cancel')} onClick={() => onCancel(j)}>
            <Icon name="close" />
          </button>
        ) : j.status === 'done' ? (
          <button type="button" className="iconbtn" aria-label={t('act.share')} onClick={() => onMenu(j)}>
            <Icon name="menu" />
          </button>
        ) : (
          <button type="button" className="iconbtn" aria-label={t('act.delete')} onClick={() => onMenu(j)}>
            <Icon name="menu" />
          </button>
        )}
      </div>
    </div>
  );
}
