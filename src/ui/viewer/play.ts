import type { MediaItem } from '../../core/media.ts';
import { siteInfo } from '../../core/sites.ts';
import type { PlayItem } from '../../engine/player.ts';

/** What the native player needs to play a Library item (and show it on the lock screen). */
export function toPlayItem(it: MediaItem): PlayItem {
  // A picture saved on the phone works offline on the lock screen; the site's link is the fallback.
  const art = it.thumbs.find((s) => s.startsWith('/')) ?? it.thumbs.find((s) => s.startsWith('http'));
  return {
    id: it.key,
    uri: it.file.uri,
    title: it.title,
    artist: it.artist ?? siteInfo(it.site).name,
    ...(art ? { art } : {}),
    ...(it.subs.length ? { subs: it.subs.map((s) => ({ uri: s.uri, name: s.name })) } : {}),
  };
}

/** The karaoke copy of a song, or the original of a karaoke copy (for the "Vocals" switch). */
export function counterpart(it: MediaItem | undefined, all: MediaItem[]): MediaItem | undefined {
  if (!it) return undefined;
  if (it.editOf && it.stem === 'music') return all.find((x) => x.key === it.editOf);
  return all.find((x) => x.editOf === it.key && x.stem === 'music' && x.kind === it.kind);
}
