// Turns engine error output into a short, honest explanation plus one button that can fix it.

import { detect, drmService } from './links.ts';
import { SITES } from './sites.ts';

export type ErrorCode =
  | 'login'
  | 'private'
  | 'unavailable'
  | 'members'
  | 'age'
  | 'geo'
  | 'drm'
  | 'upcoming'
  | 'format'
  | 'unsupported'
  | 'novideo'
  | 'ratelimit'
  | 'extractor'
  | 'forbidden'
  | 'network'
  | 'space'
  | 'canceled'
  | 'nosource'
  | 'aisetup'
  | 'aifail'
  | 'unknown';

/** What the fix button does. */
export type FixAction = 'login' | 'update' | 'retry' | 'retryBest' | 'photos' | 'folder' | 'report' | 'none';

export interface Explained {
  code: ErrorCode;
  fix: FixAction;
  /** True when updating the engine might fix it (the queue does this once by itself). */
  engineFixable: boolean;
}

const RULES: [RegExp, ErrorCode][] = [
  [/no space left|ENOSPC|disk full/i, 'space'],
  // Vocal remover (android/.../edit/VocalRemover.kt).
  [/Vocal remover: the original file is gone/i, 'nosource'],
  [/Vocal remover download failed/i, 'aisetup'],
  [/Vocal remover failed/i, 'aifail'],
  [/DRM|protected by digital rights/i, 'drm'],
  [/There is no video in this post|No video could be found|No video formats found|no media found/i, 'novideo'],
  [/Premieres in|This live event will begin|will begin in a few moments|Scheduled for/i, 'upcoming'],
  [/members[- ]only|Join this channel|available to this channel's members/i, 'members'],
  [/confirm your age|age[- ]restricted|inappropriate for some users/i, 'age'],
  [/Private video|This account is private|private account|is private/i, 'private'],
  [/not available in your country|geo[- ]?restrict|blocked it in your country/i, 'geo'],
  [/rate[- ]?limit|Too Many Requests|HTTP Error 429|blocked by network security|temporarily blocked/i, 'ratelimit'],
  [/Sign in to confirm|login required|log in to|requires? (?:a )?login|use --cookies|authentication|cookies? (?:are|is) (?:needed|required)|not logged in|redirect to login|login page|AuthRequired|AuthorizationError/i, 'login'],
  [/Video unavailable|has been removed|no longer available|does not exist|HTTP Error 404|Not Found|deleted/i, 'unavailable'],
  [/Requested format is not available/i, 'format'],
  [/Unsupported URL|No suitable extractor|Unsupported site|no extractor found/i, 'unsupported'],
  // Network problems before "extractor": "Unable to download webpage: <urlopen error …>" is the network.
  [
    /timed out|Timeout|Network is unreachable|Temporary failure in name resolution|No address associated with hostname|Connection (?:reset|refused|aborted)|getaddrinfo|EOF occurred|Remote end closed|No route to host|IncompleteRead|urlopen error/i,
    'network',
  ],
  [/HTTP Error 403|Forbidden/i, 'forbidden'],
  [
    /Unable to extract|ExtractorError|nsig|n challenge|signature (?:extraction|function)|JS challenge|jsinterp|KeyError|IndexError|TypeError|Failed to parse JSON|Unable to download (?:API|webpage|JSON)|please report this issue/i,
    'extractor',
  ],
  [/CanceledException|canceled|cancelled/i, 'canceled'],
];

const FIX: Record<ErrorCode, FixAction> = {
  login: 'login',
  private: 'login',
  members: 'login',
  age: 'login',
  unavailable: 'none',
  geo: 'none',
  drm: 'none',
  upcoming: 'retry',
  format: 'retryBest',
  unsupported: 'report',
  novideo: 'photos',
  ratelimit: 'login',
  extractor: 'update',
  forbidden: 'update',
  network: 'retry',
  space: 'folder',
  canceled: 'retry',
  nosource: 'none',
  aisetup: 'retry',
  aifail: 'report',
  unknown: 'report',
};

/** Pass the link when known: some answers depend on the site, not only on the message. */
export function explain(raw: string | undefined, url?: string): Explained {
  const text = raw ?? '';
  // Netflix & co. fail in odd ways (timeouts, "unsupported", "log in"); the real reason is always DRM.
  const code: ErrorCode = url && drmService(url) ? 'drm' : (RULES.find(([re]) => re.test(text))?.[1] ?? 'unknown');
  // YouTube's "Sign in to confirm you're not a bot" is often fixed by a newer yt-dlp too.
  const engineFixable = code === 'extractor' || code === 'forbidden' || code === 'unknown' || /not a bot/i.test(text);
  // A "Log in" button only helps on sites OnePlace has a login page for.
  const fix = FIX[code] === 'login' && url && !SITES[detect(url).site]?.login ? 'none' : FIX[code];
  return { code, fix, engineFixable };
}

/** The last "ERROR:" line, for showing under the friendly text and in bug reports. */
export function errorLine(raw: string | undefined): string {
  const lines = (raw ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find((l) => /^ERROR:|Error|error:/i.test(l)) ?? lines.at(-1) ?? '';
  return err.replace(/^ERROR:\s*/, '').slice(0, 300);
}
