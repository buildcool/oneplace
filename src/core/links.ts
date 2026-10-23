import type { Link, LinkKind, SiteId } from './types.ts';

// Finding, cleaning and recognising links. Everything here is pure so it is unit-tested.

const URL_CHARS = "A-Za-z0-9\\-._~:/?#\\[\\]@!$&()*+,;=%";
const SCHEME_URL = new RegExp(`https?://[${URL_CHARS}]+`, 'gi');

/** Hosts people paste without "https://" (e.g. "youtu.be/abc" in a WhatsApp message). */
const BARE_HOSTS = [
  'youtu.be',
  'youtube.com',
  'music.youtube.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'vm.tiktok.com',
  'reddit.com',
  'pin.it',
  'pinterest.com',
  'threads.net',
  'threads.com',
  'soundcloud.com',
  'jiosaavn.com',
  'snapchat.com',
  'vimeo.com',
  'dailymotion.com',
  'twitch.tv',
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BARE_URL = new RegExp(
  `(?:^|[^A-Za-z0-9./@:-])((?:www\\.|m\\.)?(?:${BARE_HOSTS.map(escapeRe).join('|')})/[${URL_CHARS}]*)`,
  'gi',
);

/** Strip punctuation that ends a sentence rather than the link: "…/abc)." → "…/abc". */
function trimTail(url: string): string {
  let s = url;
  for (;;) {
    const last = s.at(-1);
    if (!last) return s;
    if ('.,;:!?\'"'.includes(last)) {
      s = s.slice(0, -1);
      continue;
    }
    const pairs: Record<string, string> = { ')': '(', ']': '[' };
    const open = pairs[last];
    if (open && s.split(open).length < s.split(last).length) {
      s = s.slice(0, -1);
      continue;
    }
    return s;
  }
}

/** All links in a piece of shared/pasted text, in order, without duplicates. */
export function findUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    const t = trimTail(u);
    if (t.length < 10 || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  const spans: [number, number][] = [];
  for (const m of text.matchAll(SCHEME_URL)) {
    spans.push([m.index, m.index + m[0].length]);
    add(m[0]);
  }
  for (const m of text.matchAll(BARE_URL)) {
    const start = m.index + m[0].indexOf(m[1]);
    if (spans.some(([a, b]) => start >= a && start < b)) continue;
    add(`https://${m[1]}`);
  }
  return out;
}

/** "www.youtube.com" → "youtube.com", "m.facebook.com" → "facebook.com". */
export function baseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www|m|mobile|web|mbasic|touch|old|new|np|amp)\./, '');
}

const TRACKING_ANY = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'igsh',
  'igshid',
  'mibextid',
  'rdid',
  'share_url',
  'sfnsn',
  'wtsid',
  'ref_src',
  'ref_url',
  '_rdr',
  'xmt',
  'is_from_webapp',
  'sender_device',
  'web_id',
  'share_app_id',
  'share_link_id',
  'share_item_id',
  'u_code',
  'preview_pb',
  'checksum',
  'sec_user_id',
  'utm',
]);
const TRACKING_BY_SITE: Partial<Record<string, string[]>> = {
  youtube: ['si', 'feature', 'pp', 'ab_channel'],
  x: ['s', 't'],
  tiktok: ['_r', '_t', 'timestamp', 'lang'],
};

function siteKeyForHost(host: string): string {
  if (/(^|\.)youtube(-nocookie)?\.com$|^youtu\.be$/.test(host)) return 'youtube';
  if (/^(x|twitter)\.com$/.test(host)) return 'x';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  return '';
}

/** Remove tracking parameters and the #fragment. Leaves the URL untouched when nothing changes. */
export function cleanUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  const host = baseHost(u.hostname);
  const extra = TRACKING_BY_SITE[siteKeyForHost(host)] ?? [];
  let changed = !!u.hash;
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_ANY.has(key) || key.startsWith('utm_') || extra.includes(key)) {
      u.searchParams.delete(key);
      changed = true;
    }
  }
  if (u.hostname === 'm.youtube.com') {
    u.hostname = 'www.youtube.com';
    changed = true;
  }
  return changed ? u.toString() : raw;
}

type Hit = Omit<Link, 'url'>;
type Rule = (host: string, seg: string[], q: URLSearchParams) => Hit | undefined;

const hit = (site: SiteId, kind: LinkKind, id?: string | null, extra?: Partial<Hit>): Hit => ({
  site,
  kind,
  ...(id ? { id } : {}),
  ...extra,
});

const IG_RESERVED = new Set([
  'explore',
  'accounts',
  'direct',
  'about',
  'legal',
  'developer',
  'reels',
  'p',
  'tv',
  'stories',
  's',
  'share',
  'web',
  'api',
  'challenge',
  'emails',
  'directory',
]);
const X_RESERVED = new Set(['home', 'explore', 'search', 'i', 'settings', 'messages', 'notifications', 'login', 'compose', 'hashtag']);

const youtube: Rule = (host, seg, q) => {
  if (host === 'youtu.be') return seg[0] ? hit('youtube', 'video', seg[0], q.get('list') ? { listId: q.get('list')! } : {}) : undefined;
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return undefined;
  const music = host === 'music.youtube.com';
  const site: SiteId = music ? 'ytmusic' : 'youtube';
  const [a, b] = seg;
  const list = q.get('list');
  if (a === 'watch' || (!a && q.get('v'))) return hit(site, music ? 'song' : 'video', q.get('v'), list ? { listId: list } : {});
  if (a === 'shorts' && b) return hit(site, 'short', b);
  if (a === 'live' && b) return hit(site, 'live', b);
  if ((a === 'embed' || a === 'v' || a === 'e' || a === 'clip') && b) return hit(site, 'video', b);
  if (a === 'playlist' && list) return hit(site, list.startsWith('OLAK5uy_') ? 'album' : 'playlist', undefined, { listId: list });
  if (a === 'browse' && b?.startsWith('MPRE')) return hit(site, 'album', b);
  if (a?.startsWith('@') || a === 'channel' || a === 'c' || a === 'user') return hit(site, 'channel', a?.startsWith('@') ? a : b);
  return hit(site, 'unknown');
};

const instagram: Rule = (host, seg) => {
  if (!/^(instagram\.com|instagr\.am|ddinstagram\.com)$/.test(host)) return undefined;
  const site: SiteId = 'instagram';
  if (seg[0] === 'share') return hit(site, 'unknown', undefined, { short: true });
  if (seg[0] === 'reels' && seg[1] === 'audio') return hit(site, 'audio', seg[2]);
  if (seg[0] === 'stories') return seg[1] === 'highlights' ? hit(site, 'highlight', seg[2]) : hit(site, 'story', seg[2] ?? seg[1]);
  if (seg[0] === 's') return hit(site, 'highlight', undefined, { short: true });
  // /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE, also /<user>/p/CODE
  for (let i = 0; i < Math.min(seg.length - 1, 2); i++) {
    const [k, code] = [seg[i], seg[i + 1]];
    if (k === 'p') return hit(site, 'post', code);
    if (k === 'reel' || k === 'reels' || k === 'tv') return hit(site, 'reel', code);
  }
  if (seg.length === 1 && !IG_RESERVED.has(seg[0])) return hit(site, 'profile', seg[0]);
  return hit(site, 'unknown');
};

const facebook: Rule = (host, seg, q) => {
  if (host === 'fb.watch' || host === 'fb.gg') return hit('facebook', 'video', undefined, { short: true });
  if (!/^(facebook\.com|fb\.com)$/.test(host)) return undefined;
  const site: SiteId = 'facebook';
  if (seg[0] === 'share') {
    const kind: LinkKind = seg[1] === 'r' ? 'reel' : seg[1] === 'v' ? 'video' : seg[1] === 'p' ? 'post' : 'unknown';
    return hit(site, kind, undefined, { short: true });
  }
  if (seg[0] === 'reel' && seg[1]) return hit(site, 'reel', seg[1]);
  if (seg[0] === 'watch' || seg[0] === 'video.php') return hit(site, 'video', q.get('v'));
  if (seg[1] === 'videos' && seg[2]) return hit(site, 'video', seg.at(-1));
  if (seg[0] === 'stories') return hit(site, 'story');
  if (seg[0] === 'photo' || seg[0] === 'photo.php' || seg[1] === 'photos') return hit(site, 'post', q.get('fbid'));
  if (seg[1] === 'posts' || seg[2] === 'permalink' || seg[0] === 'permalink.php' || seg[0] === 'story.php') return hit(site, 'post');
  return hit(site, 'unknown');
};

const xRule: Rule = (host, seg) => {
  if (host === 't.co') return hit('x', 'unknown', undefined, { short: true });
  if (!/^(x\.com|twitter\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com)$/.test(host)) return undefined;
  const i = seg.indexOf('status');
  if (i >= 0 && seg[i + 1]) return hit('x', 'post', seg[i + 1]);
  if (seg[0] === 'i' && seg[1] === 'spaces' && seg[2]) return hit('x', 'audio', seg[2]);
  if (seg.length === 1 && !X_RESERVED.has(seg[0])) return hit('x', 'profile', seg[0]);
  return hit('x', 'unknown');
};

const tiktok: Rule = (host, seg) => {
  if (/^(vm|vt)\.tiktok\.com$/.test(host)) return hit('tiktok', 'video', undefined, { short: true });
  if (host !== 'tiktok.com') return undefined;
  if (seg[0] === 't') return hit('tiktok', 'video', undefined, { short: true });
  if (seg[1] === 'video' && seg[2]) return hit('tiktok', 'video', seg[2]);
  if (seg[1] === 'photo' && seg[2]) return hit('tiktok', 'post', seg[2]);
  if (seg.length === 1 && seg[0].startsWith('@')) return hit('tiktok', 'profile', seg[0]);
  return hit('tiktok', 'unknown');
};

const reddit: Rule = (host, seg) => {
  if (host === 'redd.it') return hit('reddit', 'post', seg[0], { short: true });
  if (host === 'v.redd.it') return hit('reddit', 'video', seg[0], { short: true });
  if (host !== 'reddit.com') return undefined;
  if (seg[0] === 'r' && seg[2] === 'comments' && seg[3]) return hit('reddit', 'post', seg[3]);
  if (seg[0] === 'r' && seg[2] === 's') return hit('reddit', 'post', undefined, { short: true });
  if (seg[0] === 'comments' && seg[1]) return hit('reddit', 'post', seg[1]);
  if ((seg[0] === 'user' || seg[0] === 'u') && seg[1]) return hit('reddit', 'profile', seg[1]);
  if (seg[0] === 'r' && seg[1] && seg.length === 2) return hit('reddit', 'channel', seg[1]);
  return hit('reddit', 'unknown');
};

const pinterest: Rule = (host, seg) => {
  if (host === 'pin.it') return hit('pinterest', 'post', undefined, { short: true });
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(host)) return undefined;
  if (seg[0] === 'pin' && seg[1]) return hit('pinterest', 'post', seg[1]);
  if (seg.length === 2) return hit('pinterest', 'album');
  if (seg.length === 1) return hit('pinterest', 'profile', seg[0]);
  return hit('pinterest', 'unknown');
};

/** Simple host → site rules for everything else. */
const SIMPLE: { site: SiteId; host: RegExp; kind: (seg: string[], host: string) => LinkKind; short?: RegExp }[] = [
  {
    site: 'snapchat',
    host: /^(snapchat\.com|story\.snapchat\.com|t\.snapchat\.com)$/,
    short: /^t\.snapchat\.com$/,
    kind: (s) => (s[0] === 'spotlight' ? 'video' : s[0] === 'add' || s[0]?.startsWith('@') ? 'profile' : 'story'),
  },
  {
    site: 'threads',
    host: /^threads\.(net|com)$/,
    kind: (s) => (s[1] === 'post' ? 'post' : s.length === 1 && s[0].startsWith('@') ? 'profile' : 'unknown'),
  },
  {
    site: 'linkedin',
    host: /^(linkedin\.com|lnkd\.in)$/,
    short: /^lnkd\.in$/,
    kind: (s) => (s[0] === 'posts' || s[0] === 'feed' || s[0] === 'events' ? 'post' : 'unknown'),
  },
  { site: 'tumblr', host: /(^|\.)tumblr\.com$/, kind: (s) => (s.length >= 2 ? 'post' : 'profile') },
  {
    site: 'bluesky',
    host: /^bsky\.app$/,
    kind: (s) => (s[2] === 'post' ? 'post' : s[0] === 'profile' ? 'profile' : 'unknown'),
  },
  { site: 'imgur', host: /^(i\.)?imgur\.com$/, kind: (s) => (s[0] === 'a' || s[0] === 'gallery' ? 'album' : 'post') },
  { site: 'vimeo', host: /^(player\.)?vimeo\.com$/, kind: () => 'video' },
  { site: 'dailymotion', host: /^(dailymotion\.com|dai\.ly)$/, kind: () => 'video' },
  {
    site: 'twitch',
    host: /^(clips\.)?twitch\.tv$/,
    kind: (s, h) => (h.startsWith('clips.') || s[0] === 'videos' || s[1] === 'clip' || s[1] === 'videos' ? 'video' : s.length === 1 ? 'live' : 'video'),
  },
  { site: 'kick', host: /^kick\.com$/, kind: (s) => (s.length === 1 ? 'live' : 'video') },
  {
    site: 'soundcloud',
    host: /^(on\.)?soundcloud\.com$/,
    short: /^on\.soundcloud\.com$/,
    kind: (s) => (s[1] === 'sets' ? 'album' : s.length >= 2 ? 'song' : 'profile'),
  },
  { site: 'bandcamp', host: /(^|\.)bandcamp\.com$/, kind: (s) => (s[0] === 'track' ? 'song' : s[0] === 'album' ? 'album' : 'profile') },
  { site: 'mixcloud', host: /^mixcloud\.com$/, kind: (s) => (s.length >= 2 ? 'audio' : 'profile') },
  {
    site: 'audiomack',
    host: /^audiomack\.com$/,
    kind: (s) => (s[1] === 'song' ? 'song' : s[1] === 'album' ? 'album' : s[1] === 'playlist' ? 'playlist' : 'profile'),
  },
  {
    site: 'jiosaavn',
    host: /^jiosaavn\.com$/,
    kind: (s) => (s[0] === 'song' ? 'song' : s[0] === 'album' ? 'album' : s[0] === 'featured' || s[1] === 'playlist' ? 'playlist' : 'profile'),
  },
  { site: 'bilibili', host: /^(bilibili\.com|bilibili\.tv|b23\.tv)$/, short: /^b23\.tv$/, kind: () => 'video' },
  { site: 'rumble', host: /^rumble\.com$/, kind: () => 'video' },
  { site: 'streamable', host: /^streamable\.com$/, kind: () => 'video' },
  { site: 'ninegag', host: /^9gag\.com$/, kind: () => 'post' },
  { site: 'likee', host: /^(l\.)?likee\.(video|com)$/, kind: () => 'video' },
  { site: 'sharechat', host: /^sharechat\.com$/, kind: () => 'post' },
  { site: 'moj', host: /^mojapp\.in$/, kind: () => 'video' },
  {
    site: 'terabox',
    host: /^(terabox\.com|terabox\.app|teraboxapp\.com|1024terabox\.com|4funbox\.com|mirrobox\.com|nephobox\.com|freeterabox\.com|momerybox\.com|tibibox\.com|teraboxlink\.com|terasharelink\.com)$/,
    kind: () => 'post',
  },
  { site: 'gdrive', host: /^drive\.google\.com$/, kind: (s) => (s[0] === 'drive' && s[1] === 'folders' ? 'album' : 'post') },
  { site: 'dropbox', host: /^dropbox\.com$/, kind: () => 'post' },
  { site: 'archive', host: /^archive\.org$/, kind: () => 'video' },
];

const GENERIC_SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.ly|rb\.gy|cutt\.ly|is\.gd|goo\.gl|shorturl\.at|s\.id|ow\.ly|buff\.ly)$/;

/** Which site a link belongs to, what it points at (video, reel, post…) and its id. */
export function detect(raw: string): Link {
  const url = cleanUrl(raw.trim());
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, site: 'other', kind: 'unknown' };
  }
  const host = baseHost(u.hostname);
  const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponentSafe);
  for (const rule of [youtube, instagram, facebook, xRule, tiktok, reddit, pinterest]) {
    const h = rule(host, seg, u.searchParams);
    if (h) return { url, ...h };
  }
  for (const r of SIMPLE) {
    if (r.host.test(host)) return { url, site: r.site, kind: r.kind(seg, host), ...(r.short?.test(host) ? { short: true } : {}) };
  }
  if (GENERIC_SHORTENERS.test(host)) return { url, site: 'other', kind: 'unknown', short: true };
  return { url, site: 'other', kind: 'unknown' };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** First supported-looking link in shared text, already detected. */
export function firstLink(text: string): Link | undefined {
  const url = findUrls(text)[0];
  return url ? detect(url) : undefined;
}

/** Kinds that point at many videos/songs (yt-dlp playlists: download all or the first N). */
export const isCollection = (kind: LinkKind) => kind === 'playlist' || kind === 'channel' || kind === 'album' || kind === 'profile';
