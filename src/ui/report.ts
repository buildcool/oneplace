import { REPO } from '../core/update.ts';
import type { EngineStatus } from '../engine/index.ts';

/** A pre-filled GitHub issue. The user sees and edits it before anything is sent. */
export function reportUrl(o: { site?: string; kind?: string; error?: string; status?: EngineStatus }): string {
  const s = o.status;
  const lines = [
    '**What happened**',
    o.error ? '```\n' + o.error.slice(-1500) + '\n```' : '(describe the problem)',
    '',
    `**Site**: ${o.site ?? '?'}${o.kind ? ` (${o.kind})` : ''}`,
  ];
  if (s) {
    lines.push(`**App**: ${s.appVersion} (build ${s.build}, ${s.official ? 'official' : 'unofficial'}) · Android SDK ${s.sdk} · ${s.abis[0] ?? '?'}`);
    lines.push(`**yt-dlp**: ${s.ytdlp ?? '?'} · **gallery-dl**: ${s.gallerydl ?? '?'}`);
  }
  lines.push('', '**Link** (optional, leave out private links):', '');
  const body = lines.join('\n');
  const title = `[${o.site ?? 'app'}] ${(o.error ?? 'Problem').split('\n').at(-1)?.slice(0, 80) ?? 'Problem'}`;
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}
