import { isCollection } from './links.ts';
import type { EngineId, Link } from './types.ts';

// Arguments for the "what's in this link?" step. Shared by the app and the Termux dev tools.

/** Largest playlist/profile we list in the sheet (bigger ones still download fully when asked). */
export const LIST_LIMIT = 100;

export function infoArgs(link: Pick<Link, 'kind'>, engine: EngineId, wholePlaylist = false): string[] {
  const many = wholePlaylist || isCollection(link.kind);
  if (engine === 'gallerydl') return many ? ['-j', '--range', `1-${LIST_LIMIT}`] : ['-j'];
  return many ? ['-J', '--flat-playlist', '--yes-playlist', '-I', `1:${LIST_LIMIT}`] : ['-J', '--no-playlist'];
}
