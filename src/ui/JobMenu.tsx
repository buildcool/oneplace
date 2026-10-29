import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';
import { useState } from 'react';
import type { Job } from '../core/types.ts';
import { useT } from '../i18n.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Sheet, SiteAvatar, Thumb } from './common.tsx';
import { jobThumbs } from '../core/media.ts';
import { jobIcon, jobLine } from './jobs.ts';
import { openExternal } from './report.ts';

interface Props {
  job: Job;
  onClose: () => void;
  onOpen: (j: Job) => void;
  onOpenWith: (j: Job) => void;
  onShare: (j: Job) => void;
  onRetry: (j: Job) => void;
  onRemove: (j: Job, deleteFiles: boolean) => void;
  onToast: (text: string) => void;
}

export function JobMenu({ job, onClose, onOpen, onOpenWith, onShare, onRetry, onRemove, onToast }: Props) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const done = job.status === 'done' && job.files.length > 0;
  const item = (icon: IconName, label: string, run: () => void, danger = false) => (
    <button type="button" className="row" style={danger ? { color: 'var(--bad)' } : undefined} onClick={run}>
      <span className="ic" style={danger ? { color: 'var(--bad)' } : undefined}>
        <Icon name={icon} />
      </span>
      <span className="grow title">{label}</span>
    </button>
  );
  return (
    <Sheet onClose={onClose} label={job.title}>
      <div className="media" style={{ gridTemplateColumns: '96px 1fr' }}>
        <Thumb srcs={jobThumbs(job)} icon={jobIcon(job)} />
        <div style={{ minWidth: 0 }}>
          <div className="title" style={{ fontWeight: 700, fontSize: 14 }}>
            {job.title}
          </div>
          <div className="by" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
            <SiteAvatar site={job.site} />
            <span>{jobLine(job, t)}</span>
          </div>
        </div>
      </div>
      <div className="card group" style={{ marginBottom: 12 }}>
        {done ? item(job.dest === 'image' ? 'image' : 'play', job.dest === 'image' ? t('act.view') : t('act.play'), () => (onOpen(job), onClose())) : null}
        {done ? item('openWith', t('act.openWith'), () => (onOpenWith(job), onClose())) : null}
        {done ? item('share', t('act.share'), () => (onShare(job), onClose())) : null}
        {job.status === 'failed' || job.status === 'canceled' || (done && job.error) ? item('refresh', t('act.retry'), () => (onRetry(job), onClose())) : null}
        {job.status === 'done' && !done ? item('download', t('act.again'), () => (onRetry(job), onClose())) : null}
        {item('external', t('act.source'), () => openExternal(job.url))}
        {item('copy', t('act.copyLink'), async () => {
          if (Capacitor.isNativePlatform()) await Clipboard.write({ string: job.url });
          else await navigator.clipboard?.writeText(job.url);
          onToast(t('common.copied'));
          onClose();
        })}
      </div>
      <div className="card group" style={{ marginBottom: 8 }}>
        {!confirm
          ? item('trash', t('act.delete'), () => (done ? setConfirm(true) : (onRemove(job, false), onClose())), true)
          : (
            <>
              {item('trash', t('act.deleteFile'), () => (onRemove(job, true), onClose()), true)}
              {item('close', t('act.removeOnly'), () => (onRemove(job, false), onClose()))}
            </>
          )}
      </div>
    </Sheet>
  );
}
