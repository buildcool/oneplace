import { errorLine, explain } from '../core/errors.ts';
import { bytes, duration } from '../core/format.ts';
import { siteInfo } from '../core/sites.ts';
import type { Job } from '../core/types.ts';
import type { Key, T } from '../i18n.ts';
import type { IconName } from './Icon.tsx';

const POSTPROCESS = /\[(Merger|ExtractAudio|EmbedThumbnail|Metadata|FixupM\w+|ThumbnailsConvertor|VideoConvertor|VideoRemuxer|ModifyChapters|SponsorBlock)\]/;

export const totalSize = (j: Job) => j.files.reduce((n, f) => n + (f.size || 0), 0);

export function jobIcon(j: Pick<Job, 'mode' | 'dest'>): IconName {
  return j.mode === 'audio' ? 'music' : j.dest === 'image' ? 'image' : 'video';
}

/** One line under a job: progress while running, size when done, the reason when failed. */
export function jobLine(j: Job, t: T): string {
  switch (j.status) {
    case 'queued':
      return j.line || t('st.queued');
    case 'paused':
      return t('st.paused');
    case 'running': {
      if (j.progress < 0) return j.line && !POSTPROCESS.test(j.line) ? j.line : t('st.starting');
      if (j.progress >= 99.5 || POSTPROCESS.test(j.line ?? '')) return t('st.processing');
      return [`${Math.round(j.progress)}%`, j.speed, j.eta > 0 ? t('st.left', { time: duration(j.eta) }) : ''].filter(Boolean).join(' · ');
    }
    case 'done':
      return [bytes(totalSize(j)), j.files.length > 1 ? `${j.files.length} files` : ''].filter(Boolean).join(' · ');
    case 'canceled':
      return t('err.canceled');
    case 'failed':
      return failText(j, t);
  }
}

export function failText(j: Job, t: T): string {
  const { code } = explain(j.error);
  return t(`err.${code}` as Key, { site: siteInfo(j.site).name });
}

export const failDetail = (j: Job) => errorLine(j.error);
